# rebuild.py: the "one skin" clean-up. A Pixal3D model is several shells that cut through each other, so reducing it
# directly always shatters. Here the model is rebuilt as one closed skin, flattened, given a new texture layout, painted
# once from the original, and only then reduced: the full-detail model and the web model share that one texture.
#
#   blender --background --python rebuild.py -- <original.glb> <out folder> --name <label> [--web <triangles>]
#           [--full <triangles, default 900000>] [--texture 4096] [--strength 0.5] [--camera <camera.json>]
#
# Writes <out>/<name>-full.glb, <out>/<name>-web.glb, <out>/<name>-rebuilt.json and, with --camera, the sheet's tiles.
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cleanup as C
import spread as S

option = S.option
OUT, NAME = S.OUT, S.NAME
FULL = int(option('--full', 900000)); WEB = int(option('--web', 0)); TEXTURE = int(option('--texture', 4096)); STRENGTH = float(option('--strength', 0.5))
os.makedirs(OUT, exist_ok=True)
times = {}


def timed(name, started):
    times[name] = round(time.time() - started, 1); print('REBUILD', name, times[name], 's'); sys.stdout.flush()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new('w')
    original = S.load(S.SOURCE); original.name = 'original'
    co0, tris0 = S.arrays(original)
    lo, hi = co0.min(0), co0.max(0); diagonal = float(np.linalg.norm(hi - lo))
    tree = BVHTree.FromPolygons(co0.tolist(), tris0.tolist())
    _, area0, _ = C.face_frames(co0, tris0)
    report = {'name': NAME, 'source': S.SOURCE, 'original_triangles': int(len(tris0)), 'diagonal': diagonal}

    # 1. One closed skin: a voxel remesh keeps the outside surface and drops what is inside or doubled.
    t = time.time()
    skin = S.copy(original, 'skin')
    # Fine voxels: the originals have thin open sheets, and a coarser skin comes out full of holes.
    voxel = math.sqrt(2.0 * float(area0.sum()) / FULL) * 0.75
    S.apply(skin, 'REMESH', mode='VOXEL', voxel_size=voxel, use_smooth_shade=False)
    S.apply(skin, 'TRIANGULATE')
    S.drop_small_pieces(skin, 0.0005)
    report['voxel_percent_of_diagonal'] = round(100 * voxel / diagonal, 4)
    timed('one skin', t)

    # 2. Flatten: the same feature-preserving pass as cleanup.py, on the new skin.
    t = time.time()
    co, tris = S.arrays(skin)
    # Whether the model is organic is decided on the original (a fresh voxel skin has no flat faces yet).
    _, probe, _, _, _ = C.clean(co0, tris0, 0.0, 'full', option('--organic', 'auto'))
    report['original_flat_area_share'] = probe['flat_area_share']
    new, clean, _, _, _ = C.clean(co, tris, STRENGTH, 'full', 'on' if probe['organic'] else 'off')
    skin.data.vertices.foreach_set('co', np.asarray(new, np.float32).reshape(-1)); skin.data.update()
    # The rebuilt skin sits exactly where the original did: same bounds.
    co, tris = S.arrays(skin)
    lo2, hi2 = co.min(0), co.max(0)
    co = (co - (lo2 + hi2) / 2) * (diagonal / float(np.linalg.norm(hi2 - lo2))) + (lo + hi) / 2
    skin.data.vertices.foreach_set('co', co.astype(np.float32).reshape(-1)); skin.data.update()
    report['flatten'] = {k: clean.get(k) for k in ('flat_area_share', 'organic', 'flat_areas', 'roughness_before_degrees', 'roughness_final_degrees', 'moved_mean_percent', 'moved_max_percent')}
    timed('flatten', t)

    # 3. A new texture layout: whole plates in one piece each.
    t = time.time()
    S.activate(skin)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0015, area_weight=0.0)
    bpy.ops.object.mode_set(mode='OBJECT')
    timed('texture layout', t)

    # 4. Paint once, from the original, onto the new layout. Blender bakes where in space each texel of the new layout
    # sits; each texel then takes the original's colour, metal and roughness at the nearest point of the original's
    # surface. No rays are cast between the two models, so nothing is missed and nothing comes out black.
    t = time.time()
    where = bpy.data.images.new(NAME + '_where', TEXTURE, TEXTURE, alpha=True, float_buffer=True)
    where.colorspace_settings.name = 'Non-Color'
    material = bpy.data.materials.new(NAME + '_hull'); material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get('Principled BSDF'); output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    target = nodes.new('ShaderNodeTexImage'); target.image = where
    geometry = nodes.new('ShaderNodeNewGeometry'); emit = nodes.new('ShaderNodeEmission')
    shift = nodes.new('ShaderNodeVectorMath'); shift.operation = 'SUBTRACT'; shift.inputs[1].default_value = tuple(lo - 0.01 * diagonal)
    squeeze = nodes.new('ShaderNodeVectorMath'); squeeze.operation = 'SCALE'; squeeze.inputs['Scale'].default_value = 1.0 / (1.5 * diagonal)
    links.new(geometry.outputs['Position'], shift.inputs[0]); links.new(shift.outputs['Vector'], squeeze.inputs[0])
    links.new(squeeze.outputs['Vector'], emit.inputs['Color']); links.new(emit.outputs['Emission'], output.inputs['Surface'])
    skin.data.materials.clear(); skin.data.materials.append(material)
    nodes.active = target
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 1
    scene.view_settings.view_transform = 'Standard'
    # The picture starts at -1 everywhere, so the texels the bake did not touch can be told apart afterwards.
    where.pixels.foreach_set(np.full(TEXTURE * TEXTURE * 4, -1.0, np.float32)); where.update()
    scene.render.bake.use_selected_to_active = False; scene.render.bake.margin = 0; scene.render.bake.use_clear = False
    S.activate(skin); skin.hide_render = False
    bpy.ops.object.bake(type='EMIT')
    px = np.empty(TEXTURE * TEXTURE * 4, np.float32); where.pixels.foreach_get(px); px = px.reshape(TEXTURE, TEXTURE, 4)
    covered = px[:, :, 0] >= 0
    ys, xs = np.nonzero(covered)
    points = px[ys, xs, :3].astype(np.float64) * (1.5 * diagonal) + (lo - 0.01 * diagonal)
    hits = [tree.find_nearest(Vector(q)) for q in points.tolist()]
    face = np.array([h[2] for h in hits]); spot = np.array([list(h[0]) for h in hits])
    report['paint_texels'] = int(len(face)); report['paint_reach_percent'] = round(100 * float(np.mean([h[3] for h in hits])) / diagonal, 4)
    a3, b3, c3 = co0[tris0[face, 0]], co0[tris0[face, 1]], co0[tris0[face, 2]]
    v0, v1, v2 = b3 - a3, c3 - a3, spot - a3
    d00, d01, d11, d20, d21 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1), (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = np.maximum(d00 * d11 - d01 * d01, 1e-30)
    bv = (d11 * d20 - d01 * d21) / den; bw = (d00 * d21 - d01 * d20) / den; bu = 1 - bv - bw
    uv0 = np.empty(len(original.data.loops) * 2, np.float32); original.data.uv_layers.active.data.foreach_get('uv', uv0); uv0 = uv0.reshape(-1, 3, 2)
    at = uv0[face, 0] * bu[:, None] + uv0[face, 1] * bv[:, None] + uv0[face, 2] * bw[:, None]

    def source_image(socket):
        for m in original.data.materials:
            if not m or not m.use_nodes: continue
            for node in m.node_tree.nodes:
                if node.type != 'BSDF_PRINCIPLED' or not node.inputs[socket].links: continue
                n = node.inputs[socket].links[0].from_node
                while n and n.type != 'TEX_IMAGE':
                    n = next((i.links[0].from_node for i in n.inputs if i.links), None)
                if n and n.image: return n.image
        return None

    def transfer(image, name, colour):
        out = bpy.data.images.new(name, TEXTURE, TEXTURE, alpha=False)
        if not colour: out.colorspace_settings.name = 'Non-Color'
        grid = np.zeros((TEXTURE, TEXTURE, 4), np.float32); grid[:, :, 3] = 1
        if image is not None:
            w, h = image.size
            src = np.empty(w * h * 4, np.float32); image.pixels.foreach_get(src); src = src.reshape(h, w, 4)
            sx = np.clip((at[:, 0] % 1.0) * w, 0, w - 1).astype(int); sy = np.clip((at[:, 1] % 1.0) * h, 0, h - 1).astype(int)
            grid[ys, xs, :3] = src[sy, sx, :3]
        else:
            grid[ys, xs, :3] = (0.5, 0.8, 0.0)
        # The island edges are spread outwards so no seam shows where the texture is sampled between texels.
        empty = ~covered
        for _ in range(16):
            total = np.zeros_like(grid[:, :, :3]); count = np.zeros(empty.shape, np.float32)
            for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                ok = ~np.roll(empty, (dy, dx), axis=(0, 1)); total += np.roll(grid[:, :, :3], (dy, dx), axis=(0, 1)) * ok[:, :, None]; count += ok
            fill = empty & (count > 0)
            grid[:, :, :3][fill] = total[fill] / count[fill][:, None]
            empty = empty & ~fill
        out.pixels.foreach_set(grid.reshape(-1)); out.update()
        return out

    colour_image = transfer(source_image('Base Color'), NAME + '_colour', True)
    rough_image = transfer(source_image('Roughness') or source_image('Metallic'), NAME + '_metal_rough', False)
    for node in (target, geometry, emit, shift, squeeze): nodes.remove(node)
    bpy.data.images.remove(where)
    tex = nodes.new('ShaderNodeTexImage'); tex.image = colour_image
    mr = nodes.new('ShaderNodeTexImage'); mr.image = rough_image
    split = nodes.new('ShaderNodeSeparateColor')
    links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); links.new(mr.outputs['Color'], split.inputs['Color'])
    links.new(split.outputs['Green'], bsdf.inputs['Roughness']); links.new(split.outputs['Blue'], bsdf.inputs['Metallic'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    nodes.active = tex
    timed('paint', t)
    S.rebuild_normals(skin)
    full_far = S.surface_distance(skin, tree, diagonal)
    report['full'] = {'triangles': len(skin.data.polygons), 'moved_mean_percent': full_far[0], 'moved_max_percent': full_far[1], **S.checks(skin)}

    # 5. The web models: the same skin and the same texture, reduced in steps for distance.
    web, lods = None, []
    if WEB:
        t = time.time()
        source = skin
        for level, budget in enumerate((WEB, int(WEB * 0.37), int(WEB * 0.10))):
            lod, dropped = S.to_web(source, budget, f'lod{level}')
            far = S.surface_distance(lod, tree, diagonal)
            entry = {'level': level, 'triangles': len(lod.data.polygons), 'moved_mean_percent': far[0], 'moved_max_percent': far[1], **S.checks(lod)}
            lods.append((lod, entry)); source = lod
        web = lods[0][0]
        report['web'] = lods[0][1]; report['web_levels'] = [e for _, e in lods]
        timed('web models', t)
    report['seconds'] = times; report['total_seconds'] = round(sum(times.values()), 1)

    if S.CAMERA:
        cam = S.camera(S.CAMERA['target'], S.CAMERA['location'], S.CAMERA['up'], S.CAMERA['fov_y_degrees'])
        aim = (Vector(S.CAMERA['target']) - Vector(S.CAMERA['location'])).normalized()
        hit = tree.ray_cast(Vector(S.CAMERA['location']), aim)[0] or Vector(S.CAMERA['target'])
        distance = (Vector(S.CAMERA['location']) - hit).length
        radius = distance * math.tan(math.radians(S.CAMERA['fov_y_degrees']) / 2) * 0.22
        inset = S.camera(hit, S.CAMERA['location'], S.CAMERA['up'], math.degrees(2 * math.atan(radius * 0.9 / distance)))
        for obj, key in ((skin, 'rebuilt'), (web, 'rebuilt-web')):
            if obj is None: continue
            S.render(f'{OUT}/{NAME}-{key}.png', cam, {obj}, 'TEXTURE', S.W, S.H)
            S.render(f'{OUT}/{NAME}-{key}-shape.png', cam, {obj}, 'SINGLE', S.W, S.H)
            patch, _ = S.crop(obj, list(hit), radius)
            S.render(f'{OUT}/{NAME}-{key}-wire.png', inset, set(patch), 'OBJECT', S.INSET, S.INSET, cavity=False)
            for o in patch: bpy.data.objects.remove(o)

    web_out = option('--web-out')
    if web_out and lods:
        os.makedirs(web_out, exist_ok=True)
        for image, name in ((colour_image, 'colour'), (rough_image, 'metal-rough')):
            image.filepath_raw = f'{web_out}/{name}-{TEXTURE}.png'; image.file_format = 'PNG'; image.save()
        small = int(option('--web-texture', 2048))
        if small < TEXTURE:
            colour_image.scale(small, small); rough_image.scale(small, small)
        for lod, entry in lods:
            bpy.ops.object.select_all(action='DESELECT'); lod.select_set(True); bpy.context.view_layer.objects.active = lod
            bpy.ops.export_scene.gltf(filepath=f"{web_out}/lod{entry['level']}-plain.glb", export_format='GLB', use_selection=True, export_normals=True, export_yup=True, export_image_format='AUTO')
        report['bounds'] = [lo.round(6).tolist(), hi.round(6).tolist()]
        json.dump(report, open(f'{web_out}/report.json', 'w'), indent=1)
    if option('--keep-full'):
        bpy.ops.object.select_all(action='DESELECT'); skin.select_set(True); bpy.context.view_layer.objects.active = skin
        bpy.ops.export_scene.gltf(filepath=f'{OUT}/{NAME}-full.glb', export_format='GLB', use_selection=True, export_normals=True, export_yup=True)
    json.dump(report, open(f'{OUT}/{NAME}-rebuilt.json', 'w'), indent=1)
    print('REBUILD DONE', json.dumps(report))


main()

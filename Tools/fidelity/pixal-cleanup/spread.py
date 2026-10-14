# spread.py: one model through every clean-up technique, each rendered from the same camera at full detail and at web
# size, with a wireframe inset and the numbers for the sheet (compose.py puts the tiles together).
#
#   blender --background --python spread.py -- <original.glb> <out folder> --name <label> --camera <camera.json>
#           [--web <triangles>] [--current <the game's web model, decoded>] [--only a,b] [--metres <units per metre>]
#
# camera.json: {"location": [x, y, z], "target": [x, y, z], "up": [x, y, z], "fov_y_degrees": n} in Blender world space.
import bpy, bmesh, sys, os, json, math, time
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cleanup as C

argv = sys.argv[sys.argv.index('--') + 1:]
def option(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
SOURCE, OUT = argv[0], os.path.abspath(argv[1]).replace(os.sep, '/')
NAME = option('--name', 'model')
CAMERA = json.load(open(option('--camera'))) if option('--camera') else None
WEB = int(option('--web', 0))
CURRENT = option('--current')
ONLY = option('--only')
os.makedirs(OUT, exist_ok=True)
W, H, INSET = 800, 500, 260

TECHNIQUES = [
    ('original', 'No change: the original'),
    ('laplacian-light', 'Plain smoothing, light (5 passes)'),
    ('laplacian-strong', 'Plain smoothing, strong (40 passes)'),
    ('taubin', 'Taubin smoothing (built not to shrink)'),
    ('bilateral', 'Edge-keeping smoothing, 35 degree crease'),
    ('snap', 'Flat areas snapped flat, edges straightened'),
    ('planar-decimate', 'Flat faces merged, hard-edge normals'),
    ('voxel-fine', 'Rebuilt as a fine voxel mesh'),
    ('voxel-coarse', 'Rebuilt as a coarse voxel mesh'),
    ('normals-only', 'Shape untouched, shading normals rebuilt'),
    ('pick', 'MY PICK: edge-keeping smoothing + flat snap + rebuilt normals'),
]


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj


def load(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH']
    activate(meshes[0])
    for o in meshes: o.select_set(True)
    if len(meshes) > 1: bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if any(len(p.vertices) != 3 for p in obj.data.polygons):
        bm = bmesh.new(); bm.from_mesh(obj.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(obj.data); bm.free()
    for o in list(bpy.context.scene.objects):
        if o not in before and o is not obj: bpy.data.objects.remove(o)
    # A glTF splits vertices along its UV seams. Joined here (UVs live on the corners, so they are kept), the surface is
    # one skin again: smoothing does not tear it and reducing it does not open cracks.
    co = np.empty(len(obj.data.vertices) * 3, np.float32); obj.data.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=float(np.linalg.norm(co.max(0) - co.min(0))) * 1e-6)
    bm.to_mesh(obj.data); bm.free(); obj.data.update()
    return obj


def arrays(obj):
    mesh = obj.data
    co = np.empty(len(mesh.vertices) * 3, np.float32); mesh.vertices.foreach_get('co', co)
    tris = np.empty(len(mesh.polygons) * 3, np.int32); mesh.polygons.foreach_get('vertices', tris)
    return co.reshape(-1, 3).astype(np.float64), tris.reshape(-1, 3)


def copy(obj, name):
    new = obj.copy(); new.data = obj.data.copy(); new.name = name
    bpy.context.scene.collection.objects.link(new)
    return new


def rebuild_normals(obj, crease=35.0):
    """Area-weighted normals, hard across the crease angle, worked out on the surface with its seams joined."""
    co, tris = arrays(obj)
    if not len(tris): return
    diagonal = float(np.linalg.norm(co.max(0) - co.min(0)))
    _, first, joined = np.unique(np.round(co / (diagonal * 1e-6)).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    joined = joined.reshape(-1); tri = joined[tris]
    good = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    own, _, _ = C.face_frames(co, tris)
    normals = np.repeat(own, 3, axis=0).astype(np.float32)
    if good.any():
        normals.reshape(-1, 3, 3)[np.nonzero(good)[0]] = C.corner_normals(co[first], tri[good], crease).reshape(-1, 3, 3)
    try: obj.data.normals_split_custom_set([tuple(n) for n in normals.tolist()])
    except Exception as error: print('NORMALS', error)


def camera(target, location, up, fov):
    data = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', data); bpy.context.scene.collection.objects.link(cam)
    target, location, up = Vector(target), Vector(location), Vector(up)
    z = (location - target).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    cam.matrix_world = Matrix(((x.x, y.x, z.x, location.x), (x.y, y.y, z.y, location.y), (x.z, y.z, z.z, location.z), (0, 0, 0, 1)))
    distance = (location - target).length
    data.sensor_fit = 'VERTICAL'; data.angle_y = math.radians(fov); data.clip_start = distance / 200; data.clip_end = distance * 50
    return cam


def render(path, cam, visible, colour, width, height, cavity=True):
    scene = bpy.context.scene
    for o in scene.objects:
        if o.type == 'MESH': o.hide_render = o not in visible
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.engine = 'BLENDER_WORKBENCH'; scene.render.image_settings.file_format = 'PNG'
    shading = scene.display.shading
    shading.light = 'STUDIO'; shading.color_type = colour; shading.show_cavity = cavity; shading.cavity_type = 'BOTH'; shading.show_shadows = False
    shading.single_color = (0.74, 0.74, 0.74)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def crop(obj, target, radius):
    """The triangles near the target as a grey patch and a wire copy, for the inset."""
    co, tris = arrays(obj)
    centre = co[tris].mean(1)
    near = np.linalg.norm(centre - np.array(target), axis=1) < radius
    faces = tris[near]
    used, inverse = np.unique(faces.reshape(-1), return_inverse=True)
    out = []
    for name, colour in (('patch', (0.78, 0.78, 0.78, 1)), ('wire', (0.02, 0.02, 0.02, 1))):
        mesh = bpy.data.meshes.new(name); mesh.from_pydata(co[used].tolist(), [], inverse.reshape(-1, 3).tolist()); mesh.update()
        o = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(o); o.color = colour
        out.append(o)
    wire = out[1].modifiers.new('wire', 'WIREFRAME'); wire.thickness = radius * 0.006; wire.use_replace = True
    return out, int(near.sum())


def checks(obj):
    """Triangles that cut through others, loose pieces, flipped faces and folded pairs, on the surface with seams joined."""
    bm = bmesh.new(); bm.from_mesh(obj.data)
    co, _ = arrays(obj)
    diagonal = float(np.linalg.norm(co.max(0) - co.min(0)))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=diagonal * 1e-6)
    bm.faces.ensure_lookup_table(); bm.normal_update()
    total = sum(f.calc_area() for f in bm.faces) or 1.0
    tree = BVHTree.FromBMesh(bm, epsilon=diagonal * 1e-7)
    cutting = {i for pair in tree.overlap(tree) for i in pair}
    folded = set()
    for e in bm.edges:
        if len(e.link_faces) == 2 and e.link_faces[0].normal.dot(e.link_faces[1].normal) < -0.9:
            folded.update(f.index for f in e.link_faces)
    seen, pieces, small = set(), 0, 0
    for f in bm.faces:
        if f.index in seen: continue
        stack, area = [f], 0.0; seen.add(f.index)
        while stack:
            g = stack.pop(); area += g.calc_area()
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        pieces += 1
        if area < total * 0.0002: small += 1
    before = [f.normal.copy() for f in bm.faces]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    flipped = sum(1 for f, n in zip(bm.faces, before) if f.normal.dot(n) < 0)
    flipped = min(flipped, len(bm.faces) - flipped)
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    result = {'cutting_triangles': len(cutting), 'pieces': pieces, 'loose_small_pieces': small, 'flipped_faces': flipped, 'folded_faces': len(folded), 'open_edges': open_edges}
    bm.free()
    return result


def drop_small_pieces(obj, share=0.0002):
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
    total = sum(f.calc_area() for f in bm.faces) or 1.0
    seen, doomed = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        stack, piece, area = [f], [], 0.0; seen.add(f.index)
        while stack:
            g = stack.pop(); piece.append(g); area += g.calc_area()
            for v in g.verts:
                for h in v.link_faces:
                    if h.index not in seen: seen.add(h.index); stack.append(h)
        if area < total * share: doomed += piece
    if doomed: bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(obj.data); bm.free()
    return len(doomed)


def apply(obj, kind, **settings):
    activate(obj)
    m = obj.modifiers.new(kind, kind)
    for k, v in settings.items(): setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)


def to_web(obj, triangles, name):
    """The web-size model of a cleaned model: flat faces merged first, then reduced to the budget, slivers dropped."""
    web = copy(obj, name)
    if len(web.data.polygons) > triangles:
        if web.data.uv_layers:
            apply(web, 'DECIMATE', decimate_type='DISSOLVE', angle_limit=math.radians(2.0), delimit={'UV'})
            apply(web, 'TRIANGULATE')
        if len(web.data.polygons) > triangles:
            apply(web, 'DECIMATE', decimate_type='COLLAPSE', ratio=triangles / len(web.data.polygons))
            apply(web, 'TRIANGULATE')
    dropped = drop_small_pieces(web)
    rebuild_normals(web)
    return web, dropped


def surface_distance(obj, tree, diagonal):
    co, _ = arrays(obj)
    if len(co) > 400000: co = co[:: len(co) // 400000 + 1]
    d = np.array([tree.find_nearest(Vector(p))[3] for p in co.tolist()])
    return round(100 * float(d.mean()) / diagonal, 4), round(100 * float(d.max()) / diagonal, 4)


def carry_colour(obj, source, tree):
    """Vertex colours taken from the original's texture at the nearest point of its surface (no UVs on a rebuilt mesh)."""
    mesh = source.data
    image = next((n.image for m in mesh.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image), None)
    co, _ = arrays(obj)
    if image is None or not mesh.uv_layers: return False
    w, h = image.size
    pixels = np.empty(w * h * 4, np.float32); image.pixels.foreach_get(pixels); pixels = pixels.reshape(h, w, 4)
    uv = np.empty(len(mesh.loops) * 2, np.float32); mesh.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 3, 2)
    sco, stris = arrays(source)
    hits = [tree.find_nearest(Vector(p)) for p in co.tolist()]
    face = np.array([h[2] for h in hits]); point = np.array([list(h[0]) for h in hits])
    a, b, c = sco[stris[face, 0]], sco[stris[face, 1]], sco[stris[face, 2]]
    v0, v1, v2 = b - a, c - a, point - a
    d00, d01, d11, d20, d21 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1), (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = np.maximum(d00 * d11 - d01 * d01, 1e-30)
    v = (d11 * d20 - d01 * d21) / den; wgt = (d00 * d21 - d01 * d20) / den; u = 1 - v - wgt
    t = uv[face, 0] * u[:, None] + uv[face, 1] * v[:, None] + uv[face, 2] * wgt[:, None]
    x = np.clip((t[:, 0] % 1.0) * w, 0, w - 1).astype(int); y = np.clip((t[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    colour = pixels[y, x]; colour[:, 3] = 1
    layer = obj.data.color_attributes.new('carried', 'FLOAT_COLOR', 'POINT')
    layer.data.foreach_set('color', colour.reshape(-1)); obj.data.color_attributes.active_color = layer
    return True


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.world = bpy.data.worlds.new('w')
    original = load(SOURCE); original.name = 'original'
    co0, tris = arrays(original)
    diagonal = float(np.linalg.norm(co0.max(0) - co0.min(0)))
    tree = BVHTree.FromPolygons(co0.tolist(), tris.tolist())
    cam = camera(CAMERA['target'], CAMERA['location'], CAMERA['up'], CAMERA['fov_y_degrees'])
    distance = (Vector(CAMERA['location']) - Vector(CAMERA['target'])).length
    # The inset looks at the point of the surface in the middle of the picture.
    aim = (Vector(CAMERA['target']) - Vector(CAMERA['location'])).normalized()
    hit = tree.ray_cast(Vector(CAMERA['location']), aim)[0] or Vector(CAMERA['target'])
    distance = (Vector(CAMERA['location']) - hit).length
    radius = distance * math.tan(math.radians(CAMERA['fov_y_degrees']) / 2) * 0.22
    inset_cam = camera(hit, CAMERA['location'], CAMERA['up'], math.degrees(2 * math.atan(radius * 0.9 / distance)))
    CAMERA['inset'] = list(hit)
    results = {'name': NAME, 'source': SOURCE, 'diagonal': diagonal, 'triangles': int(len(tris)), 'techniques': []}

    def picture(obj, key, colour):
        render(f'{OUT}/{NAME}-{key}.png', cam, {obj}, colour, W, H)
        render(f'{OUT}/{NAME}-{key}-shape.png', cam, {obj}, 'SINGLE', W, H)
        patch, count = crop(obj, CAMERA['inset'], radius)
        render(f'{OUT}/{NAME}-{key}-wire.png', inset_cam, set(patch), 'OBJECT', INSET, INSET, cavity=False)
        for o in patch: bpy.data.objects.remove(o)

    for key, label in TECHNIQUES:
        if ONLY and key not in ONLY.split(','): continue
        started = time.time()
        obj = copy(original, key); colour = 'TEXTURE'; entry = {'key': key, 'label': label}
        if key == 'original':
            entry.update({'moved_mean_percent': 0, 'moved_max_percent': 0})
        elif key == 'normals-only':
            rebuild_normals(obj); entry.update({'moved_mean_percent': 0, 'moved_max_percent': 0})
        elif key in ('laplacian-light', 'laplacian-strong', 'taubin', 'bilateral', 'snap', 'pick'):
            method = {'laplacian-light': 'laplacian', 'laplacian-strong': 'laplacian', 'pick': 'full'}.get(key, key)
            new, report, _, _, _ = C.clean(co0, tris, 0.5, method, 'auto', passes={'laplacian-light': 5, 'laplacian-strong': 40}.get(key))
            obj.data.vertices.foreach_set('co', np.asarray(new, np.float32).reshape(-1)); obj.data.update()
            if key in ('bilateral', 'snap', 'pick'): rebuild_normals(obj)
            else:
                # Plain smoothing keeps smooth shading everywhere, as those methods do.
                rebuild_normals(obj, 180.0)
            entry.update({k: report.get(k) for k in ('moved_mean_percent', 'moved_max_percent', 'shrink_percent', 'flat_area_share', 'organic', 'flat_areas', 'roughness_before_degrees', 'roughness_final_degrees')})
        elif key == 'planar-decimate':
            apply(obj, 'DECIMATE', decimate_type='DISSOLVE', angle_limit=math.radians(4.0), delimit={'UV'})
            apply(obj, 'TRIANGULATE'); rebuild_normals(obj)
            entry['moved_mean_percent'], entry['moved_max_percent'] = surface_distance(obj, tree, diagonal)
        elif key in ('voxel-fine', 'voxel-coarse'):
            apply(obj, 'REMESH', mode='VOXEL', voxel_size=diagonal / (620 if key == 'voxel-fine' else 310), use_smooth_shade=False)
            apply(obj, 'TRIANGULATE')
            colour = 'VERTEX' if carry_colour(obj, original, tree) else 'SINGLE'
            rebuild_normals(obj)
            entry['moved_mean_percent'], entry['moved_max_percent'] = surface_distance(obj, tree, diagonal)
            entry['paint'] = 'carried over per vertex'
        entry['triangles'] = len(obj.data.polygons); entry['seconds'] = round(time.time() - started, 1)
        picture(obj, key, colour)
        if WEB:
            started = time.time()
            web, dropped = to_web(obj, WEB, key + '-web')
            entry['web'] = {'triangles': len(web.data.polygons), 'pieces_dropped_faces': dropped, 'seconds': round(time.time() - started, 1), **checks(web)}
            entry['web']['moved_mean_percent'], entry['web']['moved_max_percent'] = surface_distance(web, tree, diagonal)
            picture(web, key + '-web', colour)
            bpy.data.objects.remove(web)
        bpy.data.objects.remove(obj)
        results['techniques'].append(entry)
        print('SPREAD', json.dumps(entry)); sys.stdout.flush()
        json.dump(results, open(f'{OUT}/{NAME}.json', 'w'), indent=1)
    if CURRENT:
        current = load(CURRENT); current.name = 'current'
        results['current_web'] = {'triangles': len(current.data.polygons), **checks(current)}
        picture(current, 'current-web', 'SINGLE')
        print('SPREAD current', json.dumps(results['current_web']))
    json.dump(results, open(f'{OUT}/{NAME}.json', 'w'), indent=1)
    print('SPREAD DONE')


if __name__ == '__main__':
    main()

# recolour.py: a model's own texture recoloured to another paint, keeping every bit of its own detail.
#
#   blender --background --python recolour.py -- <model.glb> <paint.png> <out.png> [--passes 30] [--detail 0.45,1.9]
#
# <paint.png> is a picture in the model's own texture layout that has the wanted colours in roughly the right places (for
# Hard Burn: the game's faction paint projected onto the hull, which is right in the large and smeared in the small).
# Only its low frequencies are used: the paint and the model's own texture are both averaged over the surface (--passes
# rounds of neighbour averaging on the mesh, about 35 cm on a 100 m hull at 30), and each texel of the result is the
# averaged paint colour times how much lighter or darker the model's own texture is there than its own average. So the
# colour comes from the paint and all the detail from the original texture, which already fits the mesh.
import bpy, sys, os
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def option(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
LUM = np.array([0.2126, 0.7152, 0.0722])


def pixels(image):
    w, h = image.size
    a = np.empty(w * h * 4, np.float32); image.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def recolour(obj, paint, passes=30, detail=(0.45, 1.9)):
    """The recoloured texture as an (h, w, 4) array for obj, whose material's colour texture is the original."""
    mesh = obj.data
    base = next(n.image for m in mesh.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].links and n.outputs['Color'].links[0].to_socket.name == 'Base Color')
    own = pixels(base); h, w = own.shape[:2]
    want = pixels(paint)
    if want.shape[:2] != (h, w):
        paint.scale(w, h); want = pixels(paint)
    count = len(mesh.vertices)
    co = np.empty(count * 3, np.float32); mesh.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    loop_v = np.empty(len(mesh.loops), np.int32); mesh.loops.foreach_get('vertex_index', loop_v)
    uv = np.empty(len(mesh.loops) * 2, np.float32); mesh.uv_layers.active.data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    x = np.clip((uv[:, 0] % 1.0) * w, 0, w - 1).astype(int); y = np.clip((uv[:, 1] % 1.0) * h, 0, h - 1).astype(int)
    # One value per point of the surface: vertices at the same place (split along texture seams) share it.
    diagonal = float(np.linalg.norm(co.max(0) - co.min(0)))
    _, joined = np.unique(np.round(co / (diagonal * 1e-6)).astype(np.int64), axis=0, return_inverse=True)
    joined = joined.reshape(-1); points = int(joined.max()) + 1
    at = joined[loop_v]
    hits = np.maximum(np.bincount(at, minlength=points), 1)[:, None]
    def gather(img):
        return np.stack([np.bincount(at, weights=img[y, x, k], minlength=points) for k in range(3)], axis=1) / hits
    own_v, want_v = gather(own), gather(want)
    tris = np.empty(len(mesh.polygons) * 3, np.int32); mesh.polygons.foreach_get('vertices', tris); tri = joined[tris.reshape(-1, 3)]
    a = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2]]); b = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0]])
    links = np.maximum(np.bincount(a, minlength=points) + np.bincount(b, minlength=points), 1)[:, None]
    def spread(v):
        for _ in range(passes):
            total = np.stack([np.bincount(a, weights=v[b, k], minlength=points) + np.bincount(b, weights=v[a, k], minlength=points) for k in range(3)], axis=1)
            v = 0.5 * v + 0.5 * total / links
        return v
    own_low, want_low = spread(own_v), spread(want_v)
    # The two averaged fields drawn into the texture layout (Blender's bake is the rasteriser here).
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 1
    scene.render.bake.use_selected_to_active = False; scene.render.bake.margin = 8; scene.render.bake.use_clear = True
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj; obj.hide_render = False
    material = mesh.materials[0]; nodes, links_ = material.node_tree.nodes, material.node_tree.links
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL'); old = output.inputs['Surface'].links[0].from_socket if output.inputs['Surface'].links else None
    attribute = nodes.new('ShaderNodeAttribute'); emit = nodes.new('ShaderNodeEmission'); target = nodes.new('ShaderNodeTexImage')
    links_.new(attribute.outputs['Color'], emit.inputs['Color']); links_.new(emit.outputs['Emission'], output.inputs['Surface'])
    nodes.active = target
    baked = []
    for name, field in (('own_low', own_low), ('want_low', want_low)):
        layer = mesh.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
        rgba = np.ones((count, 4), np.float32); rgba[:, :3] = field[joined]
        layer.data.foreach_set('color', rgba.reshape(-1))
        image = bpy.data.images.new(name, w, h, alpha=False, float_buffer=True); image.colorspace_settings.name = 'Non-Color'
        attribute.attribute_name = name; target.image = image
        bpy.ops.object.bake(type='EMIT')
        baked.append(pixels(image)[:, :, :3].copy())
        bpy.data.images.remove(image)
    for node in (attribute, emit, target): nodes.remove(node)
    if old: links_.new(old, output.inputs['Surface'])
    own_img, want_img = baked
    covered = want_img.sum(2) > 1e-4
    lum_own = own[:, :, :3] @ LUM; lum_low = own_img @ LUM
    lift = np.clip(lum_own / np.maximum(lum_low, 0.02), detail[0], detail[1])
    out = own.copy()
    out[:, :, :3] = np.where(covered[:, :, None], np.clip(want_img * lift[:, :, None], 0, 1), own[:, :, :3])
    return out, {'texels_recoloured_percent': round(100 * float(covered.mean()), 1), 'passes': passes}


def main():
    model, paint_file, out_file = argv[0], argv[1], argv[2]
    passes = int(option('--passes', 30)); lo, hi = (float(v) for v in option('--detail', '0.45,1.9').split(','))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=model)
    obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    paint = bpy.data.images.load(paint_file)
    out, report = recolour(obj, paint, passes, (lo, hi))
    h, w = out.shape[:2]
    image = bpy.data.images.new('recoloured', w, h, alpha=False)
    image.pixels.foreach_set(out.reshape(-1)); image.filepath_raw = os.path.abspath(out_file); image.file_format = 'PNG'; image.save()
    print('RECOLOUR', report, out_file)


if __name__ == '__main__':
    main()

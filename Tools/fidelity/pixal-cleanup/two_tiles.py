# two_tiles.py: the TDF capital from the judge's two close cameras (guns 3 and 12) and the deck camera.
#   shape only: the original, the pick, and the pick at double strength with larger flat areas
#   with paint: the original's own texture, the projected paint build C uses, and the original's texture recoloured
# blender --background --python two_tiles.py -- <repaired original.glb> <out folder> <cleaned.glb> <projected paint.png> <recoloured.png>
import bpy, sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cleanup as C
import spread as S

argv = sys.argv[sys.argv.index('--') + 1:]
source, out, cleaned_file, projected_file, recoloured_file = argv[0], os.path.abspath(argv[1]).replace(os.sep, '/'), argv[2], argv[3], argv[4]
os.makedirs(out, exist_ok=True)
work = os.path.dirname(os.path.abspath(__file__)) + '/work/'
cameras = {k: json.load(open(work + 'camera-tdf-%s.json' % k)) for k in ('gun-3', 'gun-12', 'deck')}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.world = bpy.data.worlds.new('w')
cams = {k: S.camera(c['target'], c['location'], c['up'], c['fov_y_degrees']) for k, c in cameras.items()}
original = S.load(source); original.name = 'original'
co0, tris = S.arrays(original)
report = {}


def shots(obj, name, colour):
    for key, cam in cams.items():
        S.render(f'{out}/{key}-{name}.png', cam, {obj}, colour, 960, 600)


shots(original, 'shape-original', 'SINGLE')
shots(original, 'paint-original', 'TEXTURE')
for name, strength, snap in (('pick', 0.5, (2.0, 5.0)), ('strong', 1.0, (4.0, 9.0))):
    obj = S.copy(original, name)
    new, r, _, _, _ = C.clean(co0, tris, strength, 'full', 'off', snap=snap)
    obj.data.vertices.foreach_set('co', np.asarray(new, np.float32).reshape(-1)); obj.data.update(); S.rebuild_normals(obj)
    report[name] = {k: r.get(k) for k in ('strength', 'flat_areas', 'flat_area_share_snapped', 'roughness_before_degrees', 'roughness_final_degrees', 'moved_mean_percent', 'moved_max_percent')}
    shots(obj, 'shape-' + name, 'SINGLE')
    bpy.data.objects.remove(obj)
bpy.data.objects.remove(original)
# The mesh Unreal draws, with each paint.
hull = S.load(cleaned_file)
node = next(n for m in hull.data.materials if m and m.use_nodes for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image)
for name, file in (('paint-projected', projected_file), ('paint-recoloured', recoloured_file)):
    node.image = bpy.data.images.load(file)
    shots(hull, name, 'TEXTURE')
json.dump(report, open(out + '/report.json', 'w'), indent=1)
print('TILES DONE', json.dumps(report))

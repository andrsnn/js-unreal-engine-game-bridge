# blender --background --python auto_camera.py -- <model.glb> <out camera.json> [--look high|middle] [--close 0.5]:
# a three-quarter camera for any model: it looks at the surface from the front right and above. "--look high" aims at the
# upper part (a statue's head); --close is the distance as a share of the model's diagonal.
import bpy, sys, json, math
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
argv = sys.argv[sys.argv.index('--') + 1:]
def option(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])
points, faces = [], []
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    base = len(points)
    points += [list(o.matrix_world @ v.co) for v in o.data.vertices]
    faces += [[base + i for i in p.vertices] for p in o.data.polygons]
co = np.array(points); lo, hi = co.min(0), co.max(0); centre = (lo + hi) / 2; size = hi - lo; diagonal = float(np.linalg.norm(size))
tree = BVHTree.FromPolygons(points, faces)
up = Vector((0, 0, 1))
aim_at = Vector(centre) + up * (float(size[2]) * (0.33 if option('--look', 'middle') == 'high' else 0.08))
direction = Vector((0.62, -0.70, 0.36)).normalized()
start = aim_at + direction * diagonal * 2
hit = tree.ray_cast(start, -direction)[0] or aim_at
distance = diagonal * float(option('--close', 0.5))
json.dump({'location': list(hit + direction * distance), 'target': list(hit), 'up': list(up), 'fov_y_degrees': 30.0, 'diagonal': diagonal}, open(argv[1], 'w'), indent=1)
print('CAMERA', argv[1], 'diagonal', round(diagonal, 4))

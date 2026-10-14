# blender --background --python ship_camera.py -- <ship key in mounts.json> <original.glb> <repair receipt.json> <out camera.json>:
# a camera over the middle of a Hard Burn hull's top deck, in the Blender world space of its imported original. From the Pixal3D original of the TDF capital, as made, with its own texture,
# from the same camera as the judge's close-up of its first turret (loadout slot 0), plus the same view shaded without
# texture, so the shape shows on its own. The ship's frame is found from the game's repair receipt (its axes) and from
# the hull's size in the mount export; the sign of each axis is the one that puts the gun seats on the plating.
import bpy, json, math, itertools
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

O = 'H:/captures/jsgb-goal/'
import sys
argv = sys.argv[sys.argv.index('--') + 1:]
SHIP, SRC, RECEIPT, OUTFILE = argv[0], argv[1], argv[2], argv[3]
mounts = json.load(open('G:/JsGameBridge-fidelity-order/mounts.json', encoding='utf-8'))
ship = next(s for s in mounts['list'] if s['ship'] == SHIP)
receipt = json.load(open(RECEIPT))
basis = np.array(receipt['frame']['basis'])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
mesh = obj.data
print('ORIGINAL triangles', sum(len(p.vertices) - 2 for p in mesh.polygons), 'vertices', len(mesh.vertices))
world = np.array([obj.matrix_world @ v.co for v in mesh.vertices])
# Blender's importer turns glTF's +Y up into +Z up: (x, y, z) -> (x, -z, y). The receipt's axes are in glTF's frame.
to_blender = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]])
axes = (to_blender @ basis.T).T          # the receipt's three axes, in Blender's frame
hull = ship['hull']; want = np.array([hull['width'], hull['height'], hull['length']])
best = None
for perm in itertools.permutations(range(3)):
    A = axes[list(perm)]                  # rows: candidate ship x (port), y (up), z (bow)
    local = world @ A.T
    size = local.max(0) - local.min(0)
    ratio = size / size[2] - want / want[2]
    err = float(np.abs(ratio).sum())
    if best is None or err < best[0]: best = (err, perm, size)
err, perm, size = best
A = axes[list(perm)]; scale = hull['length'] / size[2]
print('AXES permutation', perm, 'size in ship units', (size * scale).round(2).tolist(), 'export', want.tolist(), 'ratio error', round(err, 4))
depsgraph = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(obj, depsgraph)
local = world @ A.T
centre_export = np.array(hull['centre'])
choice = None
for signs in itertools.product([1, -1], repeat=3):
    S = np.array(signs)
    loc = local * S
    centre = (loc.max(0) + loc.min(0)) / 2
    def to_world(p):                      # a point in ship space -> Blender world
        q = (np.array(p) - centre_export) / scale + centre
        return Vector((q * S) @ A)
    # The game trimmed this hull (the original stands taller), so the bounds' centres don't meet exactly: the frame is
    # slid until the gun seats lie on the plating.
    shift = Vector((0, 0, 0))
    for step in range(40):
        moves = [Vector(bvh.find_nearest(to_world(g['seat']) + shift)[0]) - (to_world(g['seat']) + shift) for g in ship['guns']]
        shift += sum(moves, Vector((0, 0, 0))) / len(moves)
    placed = (lambda f, s: (lambda p: f(p) + s))(to_world, shift.copy())
    d = [bvh.find_nearest(placed(g['seat']))[3] * scale for g in ship['guns']]
    if choice is None or np.mean(d) < choice[0]: choice = (float(np.mean(d)), signs, placed, float(np.max(d)))
print('SIGNS', choice[1], 'mean distance of the 18 gun seats from the original surface', round(choice[0], 3), 'ship units, worst', round(choice[3], 3))
to_world = choice[2]

# The top deck near the centre line, a little aft of the middle: looked at from above the starboard bow quarter.
hull_c = np.array(hull['centre'])
above = to_world(hull_c + np.array([hull['width'] * 0.04, hull['height'], -hull['length'] * 0.02]))
down = (to_world(hull_c + np.array([hull['width'] * 0.04, -hull['height'], -hull['length'] * 0.02])) - above).normalized()
hit = bvh.ray_cast(above, down)[0] or to_world(hull_c)
def direction(v): return (to_world(hull_c + np.array(v)) - to_world(hull_c)).normalized()
right, up, forward = direction([1, 0, 0]), direction([0, 1, 0]), direction([0, 0, 1])
view = (0.30 * right + 0.80 * up + 0.52 * forward).normalized()
distance = hull['length'] / scale * 0.42
json.dump({'location': list(hit + view * distance), 'target': list(hit), 'up': list(up), 'fov_y_degrees': 30.0, 'units_per_metre': 1 / scale,
           'diagonal_metres': float(np.linalg.norm(world.max(0) - world.min(0)) * scale), 'note': SHIP + ' top deck near the centre line'}, open(OUTFILE, 'w'), indent=1)
print('CAMERA', OUTFILE)

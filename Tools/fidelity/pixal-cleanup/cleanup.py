# cleanup.py: takes a Pixal3D GLB and writes a cleaned GLB. Flat areas are made flat, straight edges straight, small lumps
# and ripples go; hard edges, panel lines, small detail (turrets, antennas, greebles) and the silhouette stay. Vertices
# only move: the triangles, the UVs and the textures are the file's own, so the texture still lines up. The model keeps
# its size, origin and scale.
#
#   blender --background --python cleanup.py -- <in.glb> <out.glb> [--strength 0.5] [--organic auto|on|off]
#           [--method full|bilateral|taubin] [--crease 35] [--report <file.json>] [--straighten]
#           [--web-out <folder> [--web-triangles 115000] [--web-texture 2048]]
#
# --strength 0..1 (0.5 is the safe default): how hard it flattens. It sets how far a vertex may move (1.2% of the model's
#   diagonal at 1, 0.6% at the default), how many passes run, and how different two faces' directions may be and still be
#   treated as one surface.
# --organic auto (default): a model with few large flat areas (a statue, a creature) is left mostly alone: it gets a fifth
#   of the strength. "on" treats every model that way, "off" never does. Inside a hard-surface model, the parts that are
#   not flat (a figurehead, a dome) also get only a fifth of the movement.
# --straighten: also pulls crease lines that run in little steps straight (within the plate's own plane) and closes up
#   torn slivers (needle-thin triangles have their shortest side collapsed).
# --method full (default) = feature-preserving normal filtering, then vertices moved to fit the filtered normals, then
#   large flat regions snapped onto their planes. "bilateral" leaves the snapping out. "taubin" is plain Taubin smoothing
#   that stops at creases, kept for comparison (it shrinks lumps less and rounds edges more; see the report's numbers).
#
# --web-out <folder>: the web models as well, from the same run and the same input, so both sit in the same place at the
#   same scale and a gun seat on one is a gun seat on the other. A Pixal3D model is several shells that cut through
#   each other and reducing it directly shatters it, so the web side is rebuilt as one closed skin first (rebuild.py):
#   lod0.glb at --web-triangles, lod1.glb at 37% of that and lod2.glb at 10%, meshopt compressed, one material, colour
#   and metal-roughness textures at --web-texture (the 4096 versions are written beside them), and report.json with
#   each level's triangles, triangles cutting through others, loose pieces, flipped and folded faces.
#
# How it works (numbers are per model, in its own units):
#   1. Vertices at the same position are treated as one (a glTF splits them along UV seams), so seams don't tear.
#   2. Face normals are filtered: each face takes the area-weighted average of its edge neighbours, weighted by how alike
#      their directions are (bilateral), over many passes. Flat areas converge on one direction; a crease stays a crease.
#   3. Vertices move so each face fits its filtered normal.
#   4. Faces whose filtered normals agree are grown into regions. A region that is large and really planar is a flat area:
#      its vertices are projected onto its plane, and a vertex shared by two flat areas lands on the line where they meet.
#   5. Every vertex's move is scaled by how much of its surroundings is flat area, and capped. The model's bounds are
#      put back exactly where they were.
#   6. Normals are rebuilt on the joined-up surface: weighted by face area, hard across the crease angle.
import bpy, sys, json, math, time
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def option(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
SOURCE = OUT = REPORT = None
STRENGTH, ORGANIC, METHOD, CREASE, STRAIGHTEN = 0.5, 'auto', 'full', 35.0, False
DEBUG = {}                   # filled by clean() for the debug pictures
ORGANIC_SHARE = 0.2          # the share of the strength an organic model, or a non-flat part, gets
PLANAR_LIMIT = 0.25          # a model with less of its area in flat regions than this is organic


def unit(v):
    return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-20)


def scatter(index, values, size):
    """Sums rows of values into size rows by index (np.add.at, but fast)."""
    if values.ndim == 1:
        return np.bincount(index, weights=values, minlength=size)
    return np.stack([np.bincount(index, weights=values[:, k], minlength=size) for k in range(values.shape[1])], axis=1)


def face_frames(co, tri):
    a, b, c = co[tri[:, 0]], co[tri[:, 1]], co[tri[:, 2]]
    cross = np.cross(b - a, c - a)
    length = np.linalg.norm(cross, axis=1)
    return cross / np.maximum(length, 1e-20)[:, None], length / 2, (a + b + c) / 3


def components(count, ea, eb):
    """Labels of the connected components of a graph on count nodes with edges ea-eb."""
    parent = np.arange(count)
    while True:
        ra, rb = parent[ea], parent[eb]
        lo, hi = np.minimum(ra, rb), np.maximum(ra, rb)
        change = lo != hi
        if not change.any():
            return parent
        np.minimum.at(parent, hi[change], lo[change])
        while True:
            grand = parent[parent]
            if np.array_equal(grand, parent):
                break
            parent = grand


def clean(co, tris, strength, method, treat_organic, passes=None, snap=(2.0, 5.0), straighten=False, absorb=None):
    """New positions for co (n x 3) under triangles tris (m x 3 vertex indices), and the measurements."""
    started = time.time()
    absorb = straighten if absorb is None else absorb
    lo, hi = co.min(0), co.max(0)
    diagonal = float(np.linalg.norm(hi - lo))
    # 1. One vertex per position.
    quantum = diagonal * 1e-6
    _, first, joined = np.unique(np.round(co / quantum).astype(np.int64), axis=0, return_index=True, return_inverse=True)
    joined = joined.reshape(-1)
    points = co[first].astype(np.float64)
    tri = joined[tris]
    good = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2])
    tri = tri[good]
    faces, count = len(tri), len(points)
    normal0, area, centre0 = face_frames(points, tri)
    good_area = area > (diagonal * 1e-7) ** 2
    # Faces that share an edge.
    edge_v = np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]])
    edge_f = np.tile(np.arange(faces), 3)
    key = np.minimum(edge_v[:, 0], edge_v[:, 1]).astype(np.int64) * count + np.maximum(edge_v[:, 0], edge_v[:, 1])
    order = np.argsort(key, kind='stable')
    same = key[order][1:] == key[order][:-1]
    pa, pb = edge_f[order[:-1]][same], edge_f[order[1:]][same]
    corner_v, corner_f = tri.reshape(-1), np.repeat(np.arange(faces), 3)
    degree = np.maximum(np.bincount(corner_v, minlength=count), 1)

    def filtered(normal, sigma, passes):
        n = normal.copy()
        for _ in range(passes):
            d = n[pa] - n[pb]
            w = np.exp(-(d * d).sum(1) / (2 * sigma * sigma))
            total = n * area[:, None]
            total += scatter(pa, n[pb] * (w * area[pb])[:, None], faces) + scatter(pb, n[pa] * (w * area[pa])[:, None], faces)
            n = unit(total)
        return n

    def regions(n, pair_degrees=2.0, spread_degrees=5.0, min_share=0.0004, min_faces=24):
        """Flat areas: faces grown together while neighbours' filtered normals agree, kept when large and planar."""
        agree = (n[pa] * n[pb]).sum(1) > math.cos(math.radians(pair_degrees))
        label = components(faces, pa[agree], pb[agree])
        _, label = np.unique(label, return_inverse=True)
        label = label.reshape(-1)
        size = np.bincount(label)
        region_area = np.bincount(label, weights=area)
        plane_n = unit(scatter(label, n * area[:, None], len(size)))
        # How far the region's own (unfiltered) faces lean from its plane, area weighted: a curved surface that chained
        # together face by face fails here.
        lean = np.degrees(np.arccos(np.clip((normal0 * plane_n[label]).sum(1), -1, 1)))
        spread = np.bincount(label, weights=lean * area) / np.maximum(region_area, 1e-30)
        flat = (region_area > min_share * area.sum()) & (size >= min_faces) & (spread < spread_degrees * 3)
        tight = np.degrees(np.arccos(np.clip((n * plane_n[label]).sum(1), -1, 1)))
        tight_spread = np.bincount(label, weights=tight * area) / np.maximum(region_area, 1e-30)
        flat &= tight_spread < spread_degrees
        return label, flat, plane_n, region_area

    def roughness(positions, label, flat, plane_n):
        """Degrees the faces of the flat areas lean from their area's plane, area weighted."""
        n, a, _ = face_frames(positions, tri)
        inside = flat[label]
        if not inside.any():
            return 0.0
        lean = np.degrees(np.arccos(np.clip((n[inside] * plane_n[label[inside]]).sum(1), -1, 1)))
        return float((lean * a[inside]).sum() / a[inside].sum())

    # How much of the model is flat area decides whether it is a hard-surface model at all.
    probe = filtered(normal0, 0.30, 25)
    label, flat, plane_n, region_area = regions(probe)
    planar_share = float(region_area[flat].sum() / area.sum())
    organic = treat_organic == 'on' or (treat_organic == 'auto' and planar_share < PLANAR_LIMIT)
    power = strength * (ORGANIC_SHARE if organic else 1.0)
    limit = 0.012 * power * diagonal
    report = {'vertices': int(len(co)), 'joined_vertices': int(count), 'triangles': int(len(tris)), 'diagonal': diagonal,
              'flat_area_share': round(planar_share, 4), 'organic': bool(organic), 'strength': strength, 'strength_used': round(power, 4), 'method': method}
    if power <= 0 or faces == 0:
        report.update({'moved_mean_percent': 0, 'moved_max_percent': 0})
        return co.copy(), report, joined, tri, good

    new = points.copy()
    if method == 'laplacian':
        # Plain Laplacian smoothing: every vertex moves half way to the mean of its neighbours, each pass. No creases.
        ev = edge_v[order[:-1]][same]
        a, b = ev[:, 0], ev[:, 1]
        links = np.maximum(np.bincount(a, minlength=count) + np.bincount(b, minlength=count), 1)[:, None]
        linked = (np.bincount(a, minlength=count) + np.bincount(b, minlength=count) > 0)[:, None]
        for i in range(int(passes or 10)):
            new = np.where(linked, new + 0.5 * ((scatter(a, new[b], count) + scatter(b, new[a], count)) / links - new), new)
        final_n = filtered(normal0, 0.30, 25)
    elif method == 'snap':
        # Planar snapping on its own: the flat areas are found on filtered normals, the vertices are not smoothed first.
        final_n = filtered(normal0, 0.20 + 0.30 * power, int(12 + 60 * power))
    elif method == 'taubin':
        # Taubin smoothing that stops at creases: a vertex on a crease only follows its crease neighbours.
        crease = (normal0[pa] * normal0[pb]).sum(1) < math.cos(math.radians(CREASE))
        ev = edge_v[order[:-1]][same]
        a, b = ev[:, 0], ev[:, 1]
        on_crease = np.zeros(count, bool); on_crease[a[crease]] = True; on_crease[b[crease]] = True
        use = ~crease | (on_crease[a] & on_crease[b] & crease)
        free = ~(on_crease[a] | on_crease[b]) | crease
        a, b = a[use & free], b[use & free]
        links = np.maximum(np.bincount(a, minlength=count) + np.bincount(b, minlength=count), 1)[:, None]
        for i in range(int(10 + 50 * power)):
            for factor in (0.5, -0.53):
                mean = (scatter(a, new[b], count) + scatter(b, new[a], count)) / links
                has = (links[:, 0] > 1) | (np.bincount(a, minlength=count) + np.bincount(b, minlength=count) > 0)
                new = np.where(has[:, None], new + factor * (mean - new), new)
        final_n = filtered(normal0, 0.30, 25)
    else:
        sigma = 0.20 + 0.30 * power
        final_n = filtered(normal0, sigma, int(12 + 60 * power))
        for _ in range(int(8 + 26 * power)):
            c = (new[tri[:, 0]] + new[tri[:, 1]] + new[tri[:, 2]]) / 3
            pull = final_n[corner_f] * ((c[corner_f] - new[corner_v]) * final_n[corner_f]).sum(1)[:, None]
            new += scatter(corner_v, pull, count) / degree[:, None]
    # snap = (how many degrees apart two neighbouring faces may point and still join one flat area, how far an area's
    # faces may lean from its plane on average): raising them makes larger areas count as flat.
    label, flat, plane_n, region_area = regions(final_n, snap[0], snap[1])
    report['flat_areas'] = int(flat.sum()); report['flat_area_share_snapped'] = round(float(region_area[flat].sum() / area.sum()), 4)
    report['roughness_before_degrees'] = round(roughness(points, label, flat, plane_n), 3)
    report['roughness_after_filter_degrees'] = round(roughness(new, label, flat, plane_n), 3)
    in_flat = flat[label]
    if method in ('full', 'snap') and in_flat.any():
        # 4. Snap flat areas onto their planes. The plane goes through the area's centre as it stood in the original, so
        # nothing drifts; a vertex on two or three areas is projected onto each in turn and settles on their meeting line.
        _, _, c0 = face_frames(points, tri)
        plane_c = scatter(label, c0 * area[:, None], len(flat)) / np.maximum(region_area, 1e-30)[:, None]
        if absorb:
            # A flat area takes in the faces beside it that lie almost in its plane and close to it (within 12 degrees and
            # 0.4% of the model's size), ring by ring. Pixal3D plates often carry a strip of rough faces on them that
            # never joins the plate; left out, the strip stays lumpy next to the snapped plate and reads as a jagged crack.
            n_now, _, c_now = face_frames(new, tri)
            member = np.where(in_flat, label, -1)
            near = math.cos(math.radians(12)); reach = 0.004 * diagonal
            grown = 0
            for _ in range(40):
                for x, y in ((pa, pb), (pb, pa)):
                    take = (member[x] >= 0) & (member[y] < 0)
                    if not take.any(): continue
                    r, f = member[x][take], y[take]
                    ok = ((n_now[f] * plane_n[r]).sum(1) > near) & (np.abs(((c_now[f] - plane_c[r]) * plane_n[r]).sum(1)) < reach)
                    member[f[ok]] = r[ok]; grown += int(ok.sum())
            # Pieces that are not joined to the plate at all (a loose strip of surface lying on it, or just under it) are
            # found by distance: each face still outside takes the plate of the nearest flat face within 0.5% of the
            # model's size, when it lies in that plate's plane as above.
            try:
                from mathutils.kdtree import KDTree
                inside = np.nonzero(member >= 0)[0]; outside = np.nonzero(member < 0)[0]
                if len(inside) and len(outside):
                    tree = KDTree(len(inside))
                    for i, f in enumerate(inside): tree.insert(c_now[f], i)
                    tree.balance()
                    near_r = 0.005 * diagonal
                    for f in outside:
                        for _, i, _ in tree.find_n(c_now[f], 6):
                            r = member[inside[i]]
                            if np.linalg.norm(c_now[inside[i]] - c_now[f]) > near_r: break
                            if (n_now[f] * plane_n[r]).sum() > near and abs(((c_now[f] - plane_c[r]) * plane_n[r]).sum()) < reach:
                                member[f] = r; grown += 1; break
            except ImportError:
                pass
            report['faces_absorbed_into_flat_areas'] = grown
            label = np.where(member >= 0, member, label); in_flat = member >= 0
        pair = np.unique(np.stack([corner_v[in_flat[corner_f]], label[corner_f][in_flat[corner_f]]], axis=1), axis=0)
        pv, pr = pair[:, 0], pair[:, 1]
        share = np.maximum(np.bincount(pv, minlength=count), 1)[:, None]
        blend = min(1.0, 0.5 + power)
        for _ in range(8):
            off = ((plane_c[pr] - new[pv]) * plane_n[pr]).sum(1)[:, None] * plane_n[pr]
            new += blend * scatter(pv, off, count) / share
    report['roughness_after_degrees'] = round(roughness(new, label, flat, plane_n), 3)
    # 5. Parts that are not flat area move a fifth as far; nothing moves further than the limit.
    flat_share = scatter(corner_v, (in_flat[corner_f] * area[corner_f]), count) / np.maximum(scatter(corner_v, area[corner_f], count), 1e-30)
    move = new - points
    if method not in ('laplacian', 'taubin'):
        move = move * (ORGANIC_SHARE + (1 - ORGANIC_SHARE) * flat_share)[:, None]
        far = np.linalg.norm(move, axis=1)
        move *= np.minimum(1.0, limit / np.maximum(far, 1e-30))[:, None]
    result = points + move
    # The bounds go back exactly: same size (one scale for all axes), same centre.
    lo2, hi2 = result.min(0), result.max(0)
    scale = diagonal / max(float(np.linalg.norm(hi2 - lo2)), 1e-30)
    report['shrink_percent'] = round(100 * (1 - 1 / scale), 4)
    if method not in ('laplacian', 'taubin'):
        result = (result - (lo2 + hi2) / 2) * scale + (lo + hi) / 2
    if straighten and method == 'full':
        # 7. Crease lines: a plate's edge that runs in little steps (a zigzag where a straight edge should be) is pulled
        # straight. A vertex on a plate's outline with exactly two outline neighbours moves toward their middle, but only within the plane of the flat area it belongs to, and never further than
        # 1% of the model's size (about a metre on a 100 m hull).
        n_r, _, _ = face_frames(result, tri)
        ev = edge_v[order[:-1]][same]
        # The lines to straighten are the outlines of the flat areas: an edge with a flat area on one side and something
        # else (another area, a wall, a crack) on the other. Following the outline, not every sharp edge, a corner where a
        # crack wall comes up still counts as a point on the line.
        sharp = (n_r[pa] * n_r[pb]).sum(1) < math.cos(math.radians(20))
        crease = sharp & (in_flat[pa] != in_flat[pb]) | (in_flat[pa] & in_flat[pb] & (label[pa] != label[pb]))
        ca, cb = ev[crease, 0], ev[crease, 1]
        cdeg = np.bincount(ca, minlength=count) + np.bincount(cb, minlength=count)
        # Only the zigzag moves: a point on the outline is a tooth when it bends the opposite way to both its neighbours
        # (each one's offset from the middle of its own neighbours points against the others). A real corner bends one
        # way only, and its neighbours lie straight, so it stays where it is.
        mean0 = (scatter(ca, result[cb], count) + scatter(cb, result[ca], count)) / np.maximum(cdeg, 1)[:, None]
        dev = np.where((cdeg == 2)[:, None], mean0 - result, 0.0)
        size = np.linalg.norm(dev, axis=1)
        against = ((dev[ca] * dev[cb]).sum(1) < -0.3 * size[ca] * size[cb]) & (size[ca] > 1e-4 * diagonal) & (size[cb] > 1e-4 * diagonal)
        teeth = (np.bincount(ca[against], minlength=count) + np.bincount(cb[against], minlength=count)) >= 1
        movable = (teeth & (cdeg == 2))[:, None]
        report['zigzag_vertices'] = int(movable.sum())
        s12 = (n_r[pa] * n_r[pb]).sum(1) < math.cos(math.radians(12)); DEBUG['sharp'] = (ev[s12, 0], ev[s12, 1])
        DEBUG['outline'] = (ca, cb); DEBUG['teeth'] = np.nonzero(movable[:, 0])[0]; DEBUG['points'] = result.copy(); DEBUG['flat_faces'] = np.nonzero(in_flat)[0]; DEBUG['tri'] = tri
        # The flat area each vertex belongs to: the one with the most area round it.
        cf = corner_f[in_flat[corner_f]]; cv = corner_v[in_flat[corner_f]]
        order2 = np.lexsort((area[cf], cv))
        plate = np.full(count, -1); plate[cv[order2]] = label[cf[order2]]
        pn = np.where((plate >= 0)[:, None], plane_n[np.maximum(plate, 0)], 0.0)
        step = float(np.median(np.linalg.norm(result[ca] - result[cb], axis=1))) if len(ca) else 0.0
        new = result.copy()
        for _ in range(120):
            mean = (scatter(ca, new[cb], count) + scatter(cb, new[ca], count)) / np.maximum(cdeg, 1)[:, None]
            d = (mean - new) * 0.5 * movable
            d -= pn * (d * pn).sum(1, keepdims=True)
            new += d
        shift = new - result
        far = np.linalg.norm(shift, axis=1)
        cap = max(3 * step, 0.01 * diagonal)
        shift *= np.minimum(1.0, cap / np.maximum(far, 1e-30))[:, None]
        result = result + shift
        report['crease_vertices_straightened'] = int((np.linalg.norm(shift, axis=1) > step * 0.05).sum())
        report['crease_edges'] = int(crease.sum())
    moved = np.linalg.norm(result - points, axis=1)
    report.update({'moved_mean_percent': round(100 * float(moved.mean()) / diagonal, 4), 'moved_p95_percent': round(100 * float(np.percentile(moved, 95)) / diagonal, 4),
                   'moved_max_percent': round(100 * float(moved.max()) / diagonal, 4), 'limit_percent': round(100 * limit / diagonal, 4),
                   'roughness_final_degrees': round(roughness(result, label, flat, plane_n), 3),
                   'bounds_before': [lo.round(6).tolist(), hi.round(6).tolist()], 'bounds_after': [result.min(0).round(6).tolist(), result.max(0).round(6).tolist()],
                   'rescale': round(scale, 6), 'seconds': round(time.time() - started, 1)})
    return result[joined].astype(np.float32), report, joined, tri, good


def corner_normals(points, tri, crease_degrees, chunk=150000):
    """A normal per triangle corner on the joined-up surface: the area-weighted mean of the faces round the vertex that
    lie within the crease angle of the corner's own face."""
    normal, area, _ = face_frames(points, tri)
    faces, count = len(tri), len(points)
    corner_v, corner_f = tri.reshape(-1), np.repeat(np.arange(faces), 3)
    order = np.argsort(corner_v, kind='stable')
    start = np.searchsorted(corner_v[order], np.arange(count))
    degree = np.bincount(corner_v, minlength=count)
    width = int(min(32, degree.max()))
    fan = np.full((count, width), -1, np.int64)
    slot = np.arange(len(order)) - start[corner_v[order]]
    keep = slot < width
    fan[corner_v[order][keep], slot[keep]] = corner_f[order][keep]
    cos = math.cos(math.radians(crease_degrees))
    out = np.empty((faces * 3, 3), np.float32)
    weighted = normal * area[:, None]
    for i in range(0, faces * 3, chunk):
        f, v = corner_f[i:i + chunk], corner_v[i:i + chunk]
        ring = fan[v]
        ok = ring >= 0
        ring_n = normal[np.maximum(ring, 0)]
        ok &= (ring_n * normal[f][:, None, :]).sum(2) > cos
        total = (weighted[np.maximum(ring, 0)] * ok[:, :, None]).sum(1)
        bad = np.linalg.norm(total, axis=1) < 1e-20
        total[bad] = normal[f][bad]
        out[i:i + chunk] = unit(total)
    return out


def collapse_needles(mesh, aspect=30.0, rounds=2):
    """Torn slivers: a triangle far longer than it is wide (its longest side squared over twice its area above aspect) has
    its shortest side collapsed, so the sliver closes up. Returns how many were collapsed."""
    import bmesh
    total = 0
    for _ in range(rounds):
        bm = bmesh.new(); bm.from_mesh(mesh)
        doomed = set()
        for f in bm.faces:
            a = f.calc_area()
            sides = sorted(f.edges, key=lambda e: e.calc_length())
            if a <= 0 or sides[-1].calc_length() ** 2 / (2 * a) > aspect:
                doomed.add(sides[0])
        if doomed:
            bmesh.ops.collapse(bm, edges=list(doomed), uvs=True)
            bmesh.ops.dissolve_degenerate(bm, dist=0.0, edges=bm.edges[:])
            bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
        bm.to_mesh(mesh); bm.free(); mesh.update()
        total += len(doomed)
        if not doomed: break
    return total


def process(obj, summary):
    mesh = obj.data
    if any(len(p.vertices) != 3 for p in mesh.polygons):
        import bmesh
        bm = bmesh.new(); bm.from_mesh(mesh); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.to_mesh(mesh); bm.free()
    count, faces = len(mesh.vertices), len(mesh.polygons)
    if faces < 4:
        return
    co = np.empty(count * 3, np.float32); mesh.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    tris = np.empty(faces * 3, np.int32); mesh.polygons.foreach_get('vertices', tris); tris = tris.reshape(-1, 3)
    new, report, joined, tri, good = clean(co.astype(np.float64), tris, STRENGTH, METHOD, ORGANIC, straighten=STRAIGHTEN)
    report['object'] = obj.name
    mesh.vertices.foreach_set('co', new.reshape(-1)); mesh.update()
    if STRAIGHTEN:
        report['needles_collapsed'] = collapse_needles(mesh)
        faces = len(mesh.polygons)
        tris = np.empty(faces * 3, np.int32); mesh.polygons.foreach_get('vertices', tris); tris = tris.reshape(-1, 3)
        co2 = np.empty(len(mesh.vertices) * 3, np.float32); mesh.vertices.foreach_get('co', co2); new = co2.reshape(-1, 3)
        _, first2, joined = np.unique(np.round(new.astype(np.float64) / (report['diagonal'] * 1e-6)).astype(np.int64), axis=0, return_index=True, return_inverse=True)
        joined = joined.reshape(-1); tri = joined[tris]
        good = (tri[:, 0] != tri[:, 1]) & (tri[:, 1] != tri[:, 2]) & (tri[:, 0] != tri[:, 2]); tri = tri[good]
    # 6. Normals: on the joined surface, so a UV seam doesn't shade as an edge.
    quantum = report['diagonal'] * 1e-6
    points = np.zeros((int(joined.max()) + 1, 3)); points[joined] = new
    normals = np.zeros((faces * 3, 3), np.float32)
    own, _, _ = face_frames(new.astype(np.float64), tris)
    normals[:] = np.repeat(own, 3, axis=0)
    if len(tri):
        cn = corner_normals(points, tri, CREASE)
        rows = np.nonzero(good)[0]
        normals.reshape(-1, 3, 3)[rows] = cn.reshape(-1, 3, 3)
    try:
        mesh.normals_split_custom_set([tuple(n) for n in normals.tolist()])
    except Exception as error:
        report['normals'] = 'kept automatic: ' + str(error)[:80]
    summary.append(report)
    print('CLEANUP', json.dumps(report))


def main():
    global SOURCE, OUT, REPORT, STRENGTH, ORGANIC, METHOD, CREASE, STRAIGHTEN
    if len(argv) < 2:
        print('usage: blender --background --python cleanup.py -- <in.glb> <out.glb> [--strength 0.5] [--organic auto|on|off] [--method full|bilateral|taubin] [--crease 35] [--report file.json]')
        sys.exit(2)
    SOURCE, OUT = argv[0], argv[1]
    STRENGTH = max(0.0, min(1.0, float(option('--strength', 0.5))))
    ORGANIC, METHOD, CREASE, REPORT = option('--organic', 'auto'), option('--method', 'full'), float(option('--crease', 35)), option('--report', None)
    STRAIGHTEN = '--straighten' in argv
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    summary = []
    for obj in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        process(obj, summary)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_normals=True, export_image_format='AUTO', export_yup=True, export_apply=False)
    if REPORT:
        json.dump({'source': SOURCE, 'out': OUT, 'meshes': summary}, open(REPORT, 'w'), indent=1)
    print('CLEANUP DONE', OUT)
    web_out = option('--web-out', None)
    if web_out:
        import subprocess, os
        here = os.path.dirname(os.path.abspath(__file__))
        name = os.path.splitext(os.path.basename(OUT))[0]
        subprocess.run([bpy.app.binary_path, '--background', '--python', os.path.join(here, 'rebuild.py'), '--', SOURCE, os.path.join(web_out, 'work'), '--name', name,
                        '--web', option('--web-triangles', '115000'), '--web-out', web_out, '--web-texture', option('--web-texture', '2048'),
                        '--strength', str(STRENGTH), '--organic', ORGANIC], check=True)
        subprocess.run(['node', os.path.join(here, 'pack-web.mjs'), web_out], check=False)
        print('CLEANUP WEB DONE', web_out)


if __name__ == '__main__':
    main()

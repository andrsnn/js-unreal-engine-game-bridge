# make_judge.py <ship key in mounts.json> <game hull type> <faction>: writes judge-<ship>.txt, a capture script that stages
# the ship with the judge's fit, draws the judge's axes from mounts.json as thin boxes (visible in both renderers), prints
# each gun's transform as the game has it and as the bridge sends it to Unreal, and shoots the ship judge's eight views
# (ship filling the tile) and one close-up per mount. The same script runs in the browser and in Unreal.
import json, sys
ship, hull, faction = sys.argv[1], sys.argv[2], sys.argv[3]
D = 'H:/captures/jsgb-fidelity/toggle/'
mounts = json.load(open('C:/UnlitWorldsCaptures/judge/hardburn-ship-judge/mounts.json', encoding='utf-8'))
views = json.load(open('C:/Users/Aidan Anderson/falling-frontier-clone/tools/ship-judge-views.json', encoding='utf-8'))['ship']['views']
entry = next(s for s in mounts['ships'] if s['ship'] == ship)
guns = [{k: g.get(k) for k in ('slot', 'model', 'seat', 'up', 'forward', 'right', 'hullNormal', 'ringRadius', 'ring')} for g in entry['guns']]
hide = open(D + 'factions.txt').read().split('\n')[1]
# The judge's fit: the parts mounts.json lists for this ship (weapon slots), as the ship builder's default design has them.
parts = [g['part'] for g in entry['guns'] if g['slot'] <= 8]
kits = [parts + ['reactor'], parts]
J = lambda v: json.dumps(v, separators=(',', ':'))

setup = ("2 eval (() => { const F = window.__FF, T = F.THREE; F.world.speed = 0; F.rts.minR = 0.5; F.rts.limit = null; F.deselect?.(); "
         "const proto = F.scene.children.find(o => o.userData.ship)?.userData.ship; if (!proto) return 'no ship to copy'; const Ship = proto.constructor; "
         "const s = new Ship('%s', {faction: '%s', pos: [-21000, 2500, -16000], yaw: 0, name: 'JUDGE'}); "
         "let fit = 'default'; for (const slots of %s) { try { s.fitDesign({type: '%s', slots, name: 'JUDGE FIT'}); fit = slots.join('+'); break; } catch (e) { fit = 'NOFIT ' + String(e.message).slice(0, 80); } } "
         "s.grp.scale.setScalar(28); s.autoAggro = false; s.hideShield = true; F.scene.add(s.grp); window.__j = s; "
         "clearInterval(window.__hold); window.__hold = setInterval(() => { F.world.speed = 0; }, 200); "
         # The camera: looks at a world point from a direction given in ship space, at a distance that keeps the game's
         # gun mounts drawn, with the lens narrowed so `need` (half the picture's height, world units) fills the tile.
         "window.__look = (target, from, need, dist) => { const d = new T.Vector3(...from).normalize().transformDirection(s.model.matrixWorld), phi = Math.min(Math.PI - 0.03, Math.max(0.03, Math.acos(d.y))), theta = Math.atan2(d.x, d.z); "
         "const fov = Math.min(50, Math.max(1.5, 2 * Math.atan(need / dist) * 180 / Math.PI)); clearInterval(window.__follow); "
         "window.__follow = setInterval(() => { const cam = F.rts.cam; F.rts.setPose({r: dist, theta, phi, x: target.x, y: target.y, z: target.z}); if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.near = dist / 200; cam.far = dist * 50; cam.updateProjectionMatrix(); } }, 0); return Math.round(dist) + ' fov ' + fov.toFixed(1); }; "
         "window.__hull = () => { s.grp.updateMatrixWorld(true); const k = new T.Vector3().setFromMatrixColumn(s.model.matrixWorld, 0).length(), h = new T.Vector3(HULLW, HULLH, HULLL).multiplyScalar(k / 2), c = new T.Vector3().setFromMatrixPosition(s.model.matrixWorld); return new T.Box3(c.clone().sub(h), c.clone().add(h)); }; "
         "return 'key ' + s.model?.userData.glbKey + ' mounts ' + [...(s.loadout ?? []), ...(s.defenceMounts ?? [])].map(m => m.id).join('+') + ' fit ' + fit; })()") % (hull, faction, J(kits), hull)
setup = setup.replace('HULLW', str(entry['hull']['width'])).replace('HULLH', str(entry['hull']['height'])).replace('HULLL', str(entry['hull']['length']))

first = ("92 eval (() => { const T = window.__FF.THREE, b = window.__hull(), c = b.getCenter(new T.Vector3()), rad = b.getSize(new T.Vector3()).length() / 2; return 'first ' + window.__look(c, %s, rad * 0.62, rad * 3.2); })()" % J(views[6]['from']))

report = ("96 eval (() => { const F = window.__FF, T = F.THREE, s = window.__j, G = %s; s.grp.updateMatrixWorld(true); const model = s.model; "
          # The judge's axes as thin boxes in ship space: right red, up green, forward blue, hull normal yellow, base ring magenta.
          "const axes = new T.Group(); axes.name = 'judge-axes'; const unit = new T.BoxGeometry(1, 1, 1), mats = {}, Y = new T.Vector3(0, 1, 0); "
          "const seg = (a, b, colour, th) => { const A = new T.Vector3(...a), B = new T.Vector3(...b), len = A.distanceTo(B); if (len < 1e-6) return; const m = new T.Mesh(unit, mats[colour] ??= new T.MeshBasicMaterial({color: colour, toneMapped: false})); "
          "m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, B.clone().sub(A).normalize()); m.scale.set(th, len, th); m.userData.effect = true; axes.add(m); }; "
          "for (const g of G) { if (!g.seat) continue; const R = g.ringRadius || 1, L = R * 2.4, th = R * 0.07, p = g.seat, end = (v, k = 1) => [p[0] + v[0] * L * k, p[1] + v[1] * L * k, p[2] + v[2] * L * k]; "
          "if (g.right) seg(p, end(g.right), 0xff2020, th); if (g.up) seg(p, end(g.up), 0x20ff20, th); if (g.forward) seg(p, end(g.forward), 0x3080ff, th); if (g.hullNormal) seg(p, end(g.hullNormal, 1.5), 0xffe020, th * 0.6); "
          "const r = g.ring || []; for (let i = 0; i < r.length; i++) seg(r[i].slice(0, 3), r[(i + 1) %% r.length].slice(0, 3), 0xff30ff, th * 0.6); } model.add(axes); "
          "const inv = new T.Matrix4().copy(model.matrixWorld).invert(), recs = globalThis.__jsgbMountRecords || [], out = [], r4 = v => v.toArray().map(x => +x.toFixed(4)); "
          "const lods = []; model.traverse(m => { if (m.isMesh && /^hull_concept_/.test(m.material?.name ?? '')) { let shown = true; for (let p = m; p && p !== model; p = p.parent) if (!p.visible) shown = false; if (shown) lods.push(m.name + ':' + m.geometry.attributes.position.count); } }); "
          "model.traverse(grp => { if (!/^fitted-/.test(grp.name)) return; const gm = new T.Matrix4().multiplyMatrices(inv, grp.matrixWorld), col = (m, i) => r4(new T.Vector3().setFromMatrixColumn(m, i).normalize()); "
          "const rec = recs.find(r => { for (let p = r.object; p; p = p.parent) if (p === grp) return true; return false; }); let ue = null; "
          "if (rec) { const m = new T.Matrix4().fromArray(rec.matrix).premultiply(inv); ue = {key: rec.key.replace('override:', ''), up: col(m, 1), fwd: col(m, 2)}; } "
          "const meshes = []; grp.traverse(o => { if (o.isMesh) { let shown = true; for (let p = o; p && p !== model; p = p.parent) if (!p.visible) shown = false; meshes.push(o.name + ':' + o.geometry.attributes.position.count + ':L' + o.layers.mask + (o.userData.batchedMountSource ? ':src' : '') + (shown ? '' : ':hidden') + ':' + (o.parent?.name ?? '')); } }); "
          "out.push({name: grp.name, gunModel: grp.userData.gunModel ?? null, seat: r4(new T.Vector3().setFromMatrixPosition(gm)), up: col(gm, 1), fwd: col(gm, 2), ue, meshes}); }); "
          "window.__jd = JSON.stringify({ship: '%s', length: model.userData.length, hull: lods, records: recs.length, guns: out}); return 'JUDGELEN ' + window.__jd.length; })()") % (J(guns), ship)

# Fit again once every hull detail level has loaded: the game measures the deck under each gun when it fits it.
refit = "80 eval (() => { const s = window.__j; try { s.fitDesign({type: '%s', slots: %s, name: 'JUDGE FIT'}); return 'refit'; } catch (e) { return 'refit failed ' + e.message; } })()" % (hull, J(kits[0]))
lines = ['0 gone #startup', hide, setup, refit, first, report]
t = 97
for v in views:
    # The picture's half height: the hull box's corners along the picture's up and right, with the judge's 12% margin.
    lines.append("%d eval (() => { const F = window.__FF, T = F.THREE, s = window.__j, b = window.__hull(), c = b.getCenter(new T.Vector3()), from = %s, d = new T.Vector3(...from).normalize().transformDirection(s.model.matrixWorld); "
                 "const right = new T.Vector3(0, 1, 0).cross(d); if (right.lengthSq() < 1e-4) right.set(1, 0, 0); right.normalize(); const up = d.clone().cross(right).normalize(), aspect = F.rts.cam.aspect || 1.6; let need = 0; "
                 "for (let i = 0; i < 8; i++) { const p = new T.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(c); need = Math.max(need, Math.abs(p.dot(up)), Math.abs(p.dot(right)) / aspect); } "
                 "return '%s ' + window.__look(c, from, need * 1.12, b.getSize(new T.Vector3()).length() * 1.6); })()" % (t, J(v['from']), v['name']))
    lines.append('%d shot %s' % (t + 3, v['name']))
    t += 4
for g in guns:
    if not g.get('seat'):
        continue
    # A close-up of the mount from above its bow quarter, in the gun's own axes.
    right, up, forward = g.get('right') or [1, 0, 0], g.get('up') or [0, 1, 0], g.get('forward') or [0, 0, 1]
    frm = [0.55 * right[i] + 0.6 * up[i] + 0.58 * forward[i] for i in range(3)]
    lines.append("%d eval (() => { const T = window.__FF.THREE, s = window.__j; s.grp.updateMatrixWorld(true); const p = new T.Vector3(%s).applyMatrix4(s.model.matrixWorld), k = new T.Vector3().setFromMatrixColumn(s.model.matrixWorld, 0).length(); "
                 "return 'mount-%d ' + window.__look(p, %s, %s * k * 4.2, %s * k * 30); })()" % (t, ','.join(str(x) for x in g['seat']), g['slot'], J(frm), g['ringRadius'] or 1, g['ringRadius'] or 1))
    lines.append('%d shot mount-%d' % (t + 3, g['slot']))
    t += 4
for i in range(24):
    lines.append("%s eval 'JUDGEPART' + String(%d).padStart(2, '0') + ' ' + (window.__jd ?? '').slice(%d, %d)" % (round(t + 0.1 * i, 1), i, i * 400, (i + 1) * 400))
t += 3
lines.append('%d quit' % t)
open(D + 'judge-%s.txt' % ship, 'w', newline='\n').write('\n'.join(lines))
print('wrote judge-%s.txt' % ship, len(guns), 'guns', len(views), 'views, ends at', t, 's')

# make_judge.py <ship key in mounts.json> <game hull type> <faction>: writes judge-<ship>.txt, a capture script that stages
# the ship with the game's default fit, draws the judge's axes from mounts.json, prints each gun's transform as the game
# has it and as the bridge sends it to Unreal, and shoots the ship judge's views.
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

setup = ("2 eval (() => { const F = window.__FF; F.world.speed = 0; F.rts.minR = 3; F.rts.limit = null; F.deselect?.(); "
         "const proto = F.scene.children.find(o => o.userData.ship)?.userData.ship; if (!proto) return 'no ship to copy'; const Ship = proto.constructor; "
         "const s = new Ship('%s', {faction: '%s', pos: [-21000, 2500, -16000], yaw: 0, name: 'JUDGE'}); "
         "let fit = 'default'; for (const slots of %s) { try { s.fitDesign({type: '%s', slots, name: 'JUDGE FIT'}); fit = slots.join('+'); break; } catch (e) { fit = 'NOFIT ' + String(e.message).slice(0, 80); } } "
         "s.grp.scale.setScalar(28); s.autoAggro = false; s.hideShield = true; F.scene.add(s.grp); window.__j = s; "
         "clearInterval(window.__hold); window.__hold = setInterval(() => { F.world.speed = 0; }, 200); "
         "return 'key ' + s.model?.userData.glbKey + ' mounts ' + [...(s.loadout ?? []), ...(s.defenceMounts ?? [])].map(m => m.id).join('+') + ' fit ' + fit; })()") % (hull, faction, json.dumps(kits), hull)

report = ("96 eval (() => { const F = window.__FF, T = F.THREE, s = window.__j, G = %s; s.grp.updateMatrixWorld(true); const model = s.model; "
          "const pts = [], cols = []; const add = (a, b, c) => { pts.push(...a, ...b); cols.push(...c, ...c); }; "
          "for (const g of G) { if (!g.seat) continue; const L = (g.ringRadius || 1) * 3, p = g.seat, end = v => [p[0] + v[0] * L, p[1] + v[1] * L, p[2] + v[2] * L]; "
          "if (g.right) add(p, end(g.right), [1, 0, 0]); if (g.up) add(p, end(g.up), [0, 1, 0]); if (g.forward) add(p, end(g.forward), [0, 0.4, 1]); if (g.hullNormal) add(p, end(g.hullNormal.map(x => x * 1.4)), [1, 1, 0]); "
          "const r = g.ring || []; for (let i = 0; i < r.length; i++) add(r[i].slice(0, 3), r[(i + 1) %% r.length].slice(0, 3), [1, 0, 1]); } "
          "const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3)); "
          "const lines = new T.LineSegments(geo, new T.LineBasicMaterial({vertexColors: true, depthTest: false, toneMapped: false})); lines.name = 'judge-axes'; lines.renderOrder = 999; lines.frustumCulled = false; model.add(lines); "
          "const inv = new T.Matrix4().copy(model.matrixWorld).invert(), recs = globalThis.__jsgbMountRecords || [], out = [], r4 = v => v.toArray().map(x => +x.toFixed(4)); "
          "model.traverse(grp => { if (!/^fitted-/.test(grp.name)) return; const gm = new T.Matrix4().multiplyMatrices(inv, grp.matrixWorld), col = (m, i) => r4(new T.Vector3().setFromMatrixColumn(m, i).normalize()); "
          "const rec = recs.find(r => { for (let p = r.object; p; p = p.parent) if (p === grp) return true; return false; }); let ue = null; "
          "if (rec) { const m = new T.Matrix4().fromArray(rec.matrix).premultiply(inv); ue = {key: rec.key, origin: r4(new T.Vector3().setFromMatrixPosition(m)), up: col(m, 1), fwd: col(m, 2), scale: +new T.Vector3().setFromMatrixColumn(m, 0).length().toFixed(5)}; } "
          "let hidden = false; for (let p = grp; p && p !== model; p = p.parent) if (!p.visible) hidden = true; "
          "out.push({name: grp.name, gunModel: grp.userData.gunModel ?? null, hidden, game: {seat: r4(new T.Vector3().setFromMatrixPosition(gm)), up: col(gm, 1), fwd: col(gm, 2)}, ue}); }); "
          "window.__jd = JSON.stringify({ship: '%s', length: model.userData.length, records: recs.length, guns: out}); return 'JUDGELEN ' + window.__jd.length; })()") % (json.dumps(guns, separators=(',', ':')), ship)

view = ("%d eval (() => { const F = window.__FF, T = F.THREE, s = window.__j, from = %s; const box = new T.Box3(); s.grp.updateMatrixWorld(true); s.model.traverse(m => { if (m.isMesh && /^hull_concept_/.test(m.material?.name ?? '')) box.expandByObject(m); }); if (box.isEmpty()) box.setFromObject(s.model); const c = box.getCenter(new T.Vector3()), rad = box.getSize(new T.Vector3()).length() / 2; "
        "const d = new T.Vector3(...from).normalize().transformDirection(s.model.matrixWorld), phi = Math.min(Math.PI - 0.03, Math.max(0.03, Math.acos(d.y))), theta = Math.atan2(d.x, d.z); "
        "const r = rad / Math.sin((F.rts.cam.fov ?? 40) * Math.PI / 360) * 0.62; clearInterval(window.__follow); window.__follow = setInterval(() => F.rts.setPose({r, theta, phi, x: c.x, y: c.y, z: c.z}), 0); return '%s r ' + Math.round(r); })()")

lines = ['0 gone #startup', hide, setup, view % (92, json.dumps(views[6]['from']), 'first ' + views[6]['name']), report]
t = 97
for v in views:
    lines.append(view % (t, json.dumps(v['from']), v['name']))
    lines.append('%d shot %s' % (t + 3, v['name']))
    t += 4
for i in range(8):
    lines.append("%s eval 'JUDGEPART%d ' + (window.__jd ?? '').slice(%d, %d)" % (t + 0.1 * i, i, i * 600, (i + 1) * 600))
t += 1
lines.append('%d quit' % t)
open(D + 'judge-%s.txt' % ship, 'w', newline='\n').write('\n'.join(lines))
print('wrote judge-%s.txt' % ship, len(guns), 'guns', len(views), 'views, ends at', t, 's')

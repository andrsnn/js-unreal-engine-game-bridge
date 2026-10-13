# make_judge_multi.py <out script> <faction-hull> [<faction-hull> ...]: one capture script that judges several ships one
# after another (make_judge.py's script for each, moved along in time). Shots are named <ship>--<view>, and each ship's
# data is printed in slices marked JP<index>_<slice>.
import subprocess, sys, re
D = 'H:/captures/jsgb-fidelity/toggle/'
out, ships = sys.argv[1], sys.argv[2:]
lines, offset = ['0 gone #startup'], 0.0
for index, ship in enumerate(ships):
    faction, hull = ship.split('-', 1)
    subprocess.run([sys.executable, D + 'make_judge.py', ship, hull, faction], check=True, stdout=subprocess.DEVNULL)
    end = 0.0
    if index:
        lines.append("%s eval (() => { const s = window.__j; if (s) { clearInterval(window.__follow); window.__FF.scene.remove(s.grp); } window.__jd = ''; return 'next ship'; })()" % round(offset + 1, 1))
    for line in open(D + 'judge-%s.txt' % ship, encoding='utf-8').read().split('\n'):
        m = re.match(r'([\d.]+) (\w+)(.*)', line)
        if not m or m.group(2) in ('gone', 'quit'):
            if m and m.group(2) == 'quit': end = float(m.group(1))
            continue
        t, cmd, rest = float(m.group(1)), m.group(2), m.group(3)
        if cmd == 'shot': rest = ' %s--%s' % (ship, rest.strip())
        rest = rest.replace("'JUDGEPART'", "'JP%d_'" % index)
        lines.append('%s %s%s' % (round(offset + t, 1), cmd, rest))
    offset += end
lines.append('%d quit' % (offset + 2))
open(out, 'w', newline='\n').write('\n'.join(lines) + '\n')
print('wrote', out, len(ships), 'ships, ends at', int(offset + 2), 's')

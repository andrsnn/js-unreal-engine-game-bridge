# judge_sheet.py <ship>: browser | Unreal pairs of every judge tile of a ship, one sheet, plus the single tiles.
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
ship = sys.argv[1]; D = 'H:/captures/jsgb-fidelity/toggle/'; O = 'G:/JsGameBridge-fidelity-order/shots/ship-judge/'
os.makedirs(O + ship, exist_ok=True)
order = ['top', 'bottom', 'port', 'starboard', 'bow', 'stern', 'quarter-bow', 'quarter-stern']
names = order + sorted((os.path.basename(f)[:-4] for f in glob.glob(D + 'judge-ue-%s/mount-*.png' % ship)), key=lambda n: int(n.split('-')[1]))
f = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 26); W, H = 960, 600
rows = (len(names) + 1) // 2
sheet = Image.new('RGB', (W * 4, H * rows), (14, 16, 20)); d = ImageDraw.Draw(sheet)
for i, n in enumerate(names):
    for j, (folder, label) in enumerate([('judge-web-' + ship, 'browser'), ('judge-ue-' + ship, 'Unreal, Lumen on')]):
        p = D + folder + '/' + n + '.png'
        if not os.path.exists(p): continue
        im = Image.open(p).convert('RGB'); im.save(O + ship + '/' + n + ('-unreal' if j else '-browser') + '.jpg', quality=90)
        x, y = ((i % 2) * 2 + j) * W, (i // 2) * H; sheet.paste(im.resize((W, H)), (x, y)); t = n + ', ' + label
        d.rectangle((x + 6, y + 6, x + 16 + len(t) * 15, y + 44), fill=(0, 0, 0)); d.text((x + 10, y + 8), t, font=f, fill=(255, 255, 255))
sheet.save(O + ship + '-angles.jpg', quality=88); print(len(names), 'tiles', sheet.size)

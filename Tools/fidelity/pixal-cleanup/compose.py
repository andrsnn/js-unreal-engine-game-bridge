# compose.py <work folder> <name> <out.jpg> [metres per diagonal]: the technique spread for one model spot as one sheet:
# the top band is each technique at full detail, the bottom band the web-size model made from it, with the numbers under
# each picture. Run with the system Python (it needs Pillow).
import sys, os, json
from PIL import Image, ImageDraw, ImageFont

work, name, out = sys.argv[1], sys.argv[2], sys.argv[3]
title = sys.argv[5] if len(sys.argv) > 5 else name
metres = float(sys.argv[4]) if len(sys.argv) > 4 else None
data = json.load(open(f'{work}/{name}.json'))
rebuilt = json.load(open(f'{work}/{name}-rebuilt.json')) if os.path.exists(f'{work}/{name}-rebuilt.json') else None
TW, TH, TEXT = 560, 350, 150
bold = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 19); plain = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 16); big = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 30)


def far(percent):
    if percent is None: return '?'
    if metres: return f'{percent / 100 * metres * 100:.1f} cm'
    return f'{percent:.3f}% of its size'


def tile(key):
    path = f'{work}/{name}-{key}.png'
    if not os.path.exists(path): return None
    im = Image.open(path).convert('RGB').resize((TW, TH)).point(lambda v: int(255 * (v / 255) ** 0.72))
    wire = f'{work}/{name}-{key}-wire.png'
    if os.path.exists(wire):
        w = Image.open(wire).convert('RGB').resize((170, 170)); im.paste(w, (TW - 172, TH - 172)); ImageDraw.Draw(im).rectangle((TW - 173, TH - 173, TW - 1, TH - 1), outline=(255, 255, 255))
    return im


def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ''
    for word in words:
        if draw.textlength((line + ' ' + word).strip(), font=font) > width: lines.append(line); line = word
        else: line = (line + ' ' + word).strip()
    return lines + [line]


columns = []
for t in data['techniques']:
    lines_full = [f"{t['triangles']:,} triangles", f"surface moved {far(t.get('moved_mean_percent'))} on average, {far(t.get('moved_max_percent'))} at most", f"took {t.get('seconds', 0):.0f} s"]
    if t.get('shrink_percent'): lines_full.append(f"model shrank {t['shrink_percent']:.2f}%")
    if t.get('paint'): lines_full.append('paint ' + t['paint'] + ' (blurrier than a real bake)')
    w = t.get('web')
    lines_web = [] if not w else [f"{w['triangles']:,} triangles", f"{w['cutting_triangles']:,} triangles cut through others", f"{w['loose_small_pieces']:,} loose pieces, {w['flipped_faces']:,} flipped, {w['folded_faces']:,} folded", f"surface {far(w.get('moved_mean_percent'))} from the original on average"]
    columns.append((t['label'], t['key'], lines_full, t['key'] + '-web', lines_web))
if rebuilt:
    f, w = rebuilt['full'], rebuilt.get('web')
    columns.append(('MY PICK FOR WEB: rebuilt as one closed skin, flattened, new texture layout, paint baked once', 'rebuilt',
                    [f"{f['triangles']:,} triangles", f"surface {far(f['moved_mean_percent'])} from the original on average, {far(f['moved_max_percent'])} at most", f"took {rebuilt['total_seconds']:.0f} s for both sizes", f"{f['pieces']} piece, {f['open_edges']} open edges"],
                    'rebuilt-web', [] if not w else [f"{w['triangles']:,} triangles", f"{w['cutting_triangles']:,} triangles cut through others", f"{w['loose_small_pieces']:,} loose pieces, {w['flipped_faces']:,} flipped, {w['folded_faces']:,} folded", f"surface {far(w['moved_mean_percent'])} from the original on average"]))
current = data.get('current_web')
has_web = any(c[4] for c in columns)
n = len(columns) + (1 if current and has_web else 0)
band = TH + TEXT
SHAPE = TH + 34
sheet = Image.new('RGB', (n * TW, 60 + band + SHAPE + ((band + SHAPE + 50) if has_web else 0)), (18, 18, 20))
draw = ImageDraw.Draw(sheet)
draw.text((14, 10), f"{title}: every technique from the same camera, with the paint on, then the shape alone. " + ('Lower half: the web-size model made from each.' if has_web else ''), font=big, fill=(255, 255, 255))


def put(x, y, label, key, lines, highlight=False):
    im = tile(key)
    if im: sheet.paste(im, (x, y))
    shape = tile(key + '-shape')
    if shape:
        sheet.paste(shape, (x, y + band)); draw.text((x + 8, y + band + TH + 4), 'the shape alone, no paint', font=plain, fill=(160, 165, 170))
    ty = y + TH + 4
    for line in wrap(draw, label, bold, TW - 16)[:2]:
        draw.text((x + 8, ty), line, font=bold, fill=(255, 220, 90) if highlight else (255, 255, 255)); ty += 23
    for line in lines:
        for part in wrap(draw, line, plain, TW - 16)[:2]:
            draw.text((x + 8, ty), part, font=plain, fill=(205, 210, 215)); ty += 19


offset = 0
if current and has_web:
    put(0, 60 + band + SHAPE + 50, "THE GAME'S WEB MODEL TODAY (no texture here)", 'current-web',
        [f"{current['triangles']:,} triangles", f"{current['cutting_triangles']:,} triangles cut through others", f"{current['loose_small_pieces']:,} loose pieces, {current['flipped_faces']:,} flipped, {current['folded_faces']:,} folded"], True)
    offset = 1
for i, (label, key, lines_full, web_key, lines_web) in enumerate(columns):
    x = (i + offset) * TW
    pick = 'PICK' in label
    put(x, 60, label, key, lines_full, pick)
    if has_web and lines_web: put(x, 60 + band + SHAPE + 50, 'Web size, made from the model above', web_key, lines_web, pick)
if has_web: draw.text((14, 60 + band + SHAPE + 8), 'WEB SIZE', font=big, fill=(255, 255, 255))
sheet.save(out, quality=88)
print(out, sheet.size, len(columns), 'columns')

# colour_compare.py <game image> <Unreal image> [x0 y0 x1 y1]: the same colour classes measured in both pictures of the
# same view: white plating (the brightest tenth), the red band (red clearly over green), brown weathering (warm mid
# tones) and black blotches (near black next to plating), as mean sRGB and as a share of the crop.
import sys
import numpy as np
from PIL import Image
g, u = sys.argv[1], sys.argv[2]
box = [int(v) for v in sys.argv[3:7]] if len(sys.argv) >= 7 else None
def classes(f):
    a = np.asarray(Image.open(f).convert('RGB')).astype(float)
    if box: a = a[box[1]:box[3], box[0]:box[2]]
    p = a.reshape(-1, 3); r, gr, b = p[:, 0], p[:, 1], p[:, 2]; lum = p @ np.array([.2126, .7152, .0722])
    out = {}
    def put(name, m): out[name] = (tuple(int(round(v)) for v in p[m].mean(0)) if m.sum() else None, 100 * m.mean())
    put('white plating', lum >= np.percentile(lum, 90))
    put('red band', (r > 1.35 * gr) & (r > 1.35 * b) & (r > 70))
    put('brown weathering', (r > 1.08 * b) & (r >= gr * 0.98) & (lum > 55) & (lum < 170) & ~((r > 1.35 * gr) & (r > 70)))
    put('black blotches', lum < 22)
    put('whole crop', lum > -1)
    return out
A, B = classes(g), classes(u)
for k in A:
    print('  %-17s game %-16s %5.1f%%   Unreal %-16s %5.1f%%' % (k, A[k][0], A[k][1], B[k][0], B[k][1]))

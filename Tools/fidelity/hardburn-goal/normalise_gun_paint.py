# normalise_gun_paint.py <folder> [<folder> ...]: brings each baked gun texture (gun_*.png) to the brightness the faction
# tints were measured against: a linear mean of 0.247, the mean of the first nine gun bakes. The game's gun textures got
# darker since, and a tint over a dark bake draws a near-black gun on a white hull. Hue and contrast ratios are kept.
import sys, glob, os
import numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
TARGET = 0.247
for folder in sys.argv[1:]:
    for f in sorted(glob.glob(folder + '/gun_*.png')):
        if f.endswith('.preview.png'): continue
        im = Image.open(f); mode = im.mode; a = np.asarray(im.convert('RGBA')).astype(np.float32) / 255
        rgb = a[..., :3]; lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        mean = float(lin.mean())
        if abs(mean - TARGET) < 0.02: print(os.path.basename(f), 'already %.3f' % mean); continue
        lin = np.clip(lin * (TARGET / max(mean, 1e-4)), 0, 1)
        out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
        a[..., :3] = out
        Image.fromarray((a * 255 + 0.5).astype(np.uint8), 'RGBA').convert(mode).save(f)
        print(os.path.basename(f), '%.3f -> %.3f' % (mean, float(lin.mean())))

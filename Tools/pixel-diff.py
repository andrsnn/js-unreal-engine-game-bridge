"""Share of pixels that clearly differ between two frames, for the conformance suite.

Both frames are scaled to 640x360 and slightly blurred, so anti-aliasing and one-pixel edge shifts don't count;
a pixel counts as different when any colour channel differs by more than 40 of 255.
Prints one number per pair: the percentage of differing pixels.
    python Tools/pixel-diff.py a1.png b1.png [a2.png b2.png ...]
"""
import sys
from PIL import Image, ImageChops, ImageFilter

def changed(a_path, b_path, size=(640, 360), threshold=40):
    a = Image.open(a_path).convert('RGB').resize(size, Image.BILINEAR).filter(ImageFilter.BoxBlur(1))
    b = Image.open(b_path).convert('RGB').resize(size, Image.BILINEAR).filter(ImageFilter.BoxBlur(1))
    diff = ImageChops.difference(a, b)
    r, g, bl = diff.split()
    mx = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    hist = mx.histogram()
    over = sum(hist[threshold + 1:])
    return 100.0 * over / (size[0] * size[1])

args = sys.argv[1:]
for i in range(0, len(args) - 1, 2):
    print(f'{changed(args[i], args[i + 1]):.3f}')

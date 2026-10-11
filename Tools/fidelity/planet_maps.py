# Makes a planet's maps for Unreal from an equirectangular colour map: the colour map itself (PNG) and, for rocky
# bodies, a tangent-space normal map from the map's brightness taken as height (the game lights its moon the same way).
#   python Tools/fidelity/planet_maps.py <colour.jpg> <out-dir> <name> [--relief 6] [--scale 2]
# --scale upsamples (bicubic) before the normal map, so slopes stay smooth on a large sphere.
import argparse
import json
import os
import numpy as np
from PIL import Image, ImageFilter

p = argparse.ArgumentParser()
p.add_argument('colour'); p.add_argument('out'); p.add_argument('name')
p.add_argument('--relief', type=float, default=0.0)
p.add_argument('--scale', type=int, default=1)
a = p.parse_args()
os.makedirs(a.out, exist_ok=True)
img = Image.open(a.colour).convert('RGB')
if a.scale > 1:
    img = img.resize((img.width * a.scale, img.height * a.scale), Image.BICUBIC)
textures = {}
base = os.path.join(a.out, f'T_{a.name}_baseColor.png')
img.save(base)
textures['baseColor'] = {'file': base, 'width': img.width, 'height': img.height}
# Bodies without relief get a flat normal map, so every planet material has the same inputs.
if a.relief <= 0:
    normal = os.path.join(a.out, f'T_{a.name}_normal.png')
    Image.new('RGB', (64, 32), (128, 128, 255)).save(normal)
    textures['normal'] = {'file': normal, 'width': 64, 'height': 32}
else:
    h = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255.0
    # Equirectangular: wrap in x, clamp in y.
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    dy = (np.vstack([h[1:], h[-1:]]) - np.vstack([h[:1], h[:-1]])) * 0.5
    n = np.dstack([-dx * a.relief, dy * a.relief, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    normal = os.path.join(a.out, f'T_{a.name}_normal.png')
    Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8)).save(normal)
    textures['normal'] = {'file': normal, 'width': img.width, 'height': img.height}
info = {'name': a.name, 'source': os.path.abspath(a.colour), 'textures': textures, 'kind': 'planet'}
json.dump(info, open(os.path.join(a.out, a.name + '.json'), 'w'), indent=1)
print(json.dumps(info))

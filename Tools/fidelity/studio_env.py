# Writes a studio environment (a grey room with a few soft light panels, like three.js's RoomEnvironment)
# as a Radiance .hdr long-lat image, for the fidelity material's reflections.
#   python Tools/fidelity/studio_env.py <out.hdr>
import sys
import numpy as np

W, H = 1024, 512
lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
LON, LAT = np.meshgrid(lon, lat)
d = np.stack([np.cos(LAT) * np.sin(LON), np.sin(LAT), np.cos(LAT) * np.cos(LON)], -1)  # y up
img = np.zeros((H, W, 3), np.float32)
# Walls: mid grey, a little brighter overhead and darker below, as a lit room reads.
img[:] = (0.32 + 0.12 * d[..., 1:2]) * np.array([1.0, 1.0, 1.0])

def panel(direction, size, value, colour=(1, 1, 1)):
    v = np.array(direction, np.float32); v /= np.linalg.norm(v)
    c = np.clip((d @ v - np.cos(size)) / (1 - np.cos(size)), 0, 1)
    img[:] += (c ** 0.5)[..., None] * value * np.array(colour, np.float32)

panel((0, 1, 0), 0.45, 5.0)                 # ceiling light
panel((0.8, 0.5, 0.3), 0.30, 3.5, (1, .97, .92))
panel((-0.7, 0.4, -0.5), 0.28, 2.5, (.92, .96, 1))
panel((0.2, 0.2, -0.9), 0.22, 2.0)
panel((-0.3, 0.1, 0.9), 0.25, 1.6)

def write_hdr(path, rgb):
    h, w, _ = rgb.shape
    m = rgb.max(-1)
    e = np.ceil(np.log2(np.maximum(m, 1e-32)))
    scale = np.where(m > 1e-32, 256.0 / np.exp2(e), 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(rgb * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode())
        f.write(rgbe.tobytes())

write_hdr(sys.argv[1], img)
print('wrote', sys.argv[1])

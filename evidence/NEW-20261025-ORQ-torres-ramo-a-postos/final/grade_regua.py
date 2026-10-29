# Etapa 2b: hero + the 7 crews' pose 0 (direction row, default S) as imported, trimmed, on a 10 px grid (labels every
# 50 px, y counted up from the feet) for reading head and body sizes by eye.
#   python grade_regua.py <out.png> [row] [src]
import sys, json
from PIL import Image, ImageDraw
import numpy as np
from regua_ver import IDS, NAMES
out = sys.argv[1]; row = int(sys.argv[2]) if len(sys.argv) > 2 else 0; src = sys.argv[3] if len(sys.argv) > 3 else 'saida/torres'
def trim(im):
    a = np.asarray(im)[..., 3] > 100; ys, xs = np.nonzero(a)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
figs = [('heroi', trim(Image.open('refs/hero.png').convert('RGBA')))]
for i, n in zip(IDS, NAMES):
    m = json.load(open(f'{src}/{i}/meta.json')); cw, ch = m['cell']
    figs.append((n, trim(Image.open(f'{src}/{i}/idle.png').convert('RGBA').crop((0, row * ch, cw, row * ch + ch)))))
H = max(f.height for _, f in figs) + 30; Z = 2
W = sum(f.width + 20 for _, f in figs)
img = Image.new('RGBA', (W, H), (150, 150, 150, 255)); x = 0; base = H - 5
for n, f in figs:
    img.alpha_composite(f, (x + 10, base - f.height)); x += f.width + 20
img = img.resize((W * Z, H * Z), Image.NEAREST); d = ImageDraw.Draw(img)
for k in range(0, H, 10):
    y = (base - k) * Z
    d.line((0, y, W * Z, y), fill=(200, 60, 60, 255) if k % 50 == 0 else (120, 120, 120, 140))
    if k % 50 == 0: d.text((2, y - 12), str(k), fill=(255, 255, 0, 255))
x = 0
for n, f in figs:
    d.text(((x + 10) * Z, 2), f'{n} {f.width}x{f.height}', fill=(255, 255, 0, 255)); x += f.width + 20
img.save(out)

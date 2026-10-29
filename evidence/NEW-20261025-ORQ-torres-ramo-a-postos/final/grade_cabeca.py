# Etapa 2b: the top of one crew's pose 0 (as imported, cell px) on a 5 px grid, labels every 20 px, x and y; for
# reading the helmet's width and height by eye.  python grade_cabeca.py <id|heroi> <row> <x0> <y0> <w> <h> <out> [src]
import sys, json
from PIL import Image, ImageDraw
i, row, x0, y0, w, h, out = sys.argv[1], int(sys.argv[2]), *map(int, sys.argv[3:7]), sys.argv[7]
src = sys.argv[8] if len(sys.argv) > 8 else 'saida/torres'
if i == 'heroi':
    im = Image.open('refs/hero.png').convert('RGBA')
else:
    m = json.load(open(f'{src}/{i}/meta.json')); cw, ch = m['cell']
    im = Image.open(f'{src}/{i}/idle.png').convert('RGBA').crop((0, row * ch, cw, row * ch + ch))
Z = int(__import__("os").environ.get("Z", 4))
c = Image.new('RGBA', (w, h), (150, 150, 150, 255)); c.alpha_composite(im.crop((x0, y0, x0 + w, y0 + h)))
c = c.resize((w * Z, h * Z), Image.NEAREST); d = ImageDraw.Draw(c)
for k in range(0, max(w, h) + 1, 5):
    col = (255, 0, 0, 255) if k % 20 == 0 else (90, 90, 90, 255)
    if k <= w: d.line((k * Z, 0, k * Z, h * Z), fill=col)
    if k <= h: d.line((0, k * Z, w * Z, k * Z), fill=col)
    if k % 20 == 0:
        if k <= w: d.text((k * Z + 2, 2), str(x0 + k), fill=(255, 255, 0, 255))
        if k <= h: d.text((2, k * Z + 2), str(y0 + k), fill=(255, 255, 0, 255))
c.save(out)

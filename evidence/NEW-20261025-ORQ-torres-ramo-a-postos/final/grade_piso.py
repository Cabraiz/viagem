# Gridded zoom of the pronta view 0 of a base around the mount, to read the deck floor and the parapet top by eye.
# uso: python grade_piso.py <id> <out> [half_w] [half_h]
import sys, json
from PIL import Image, ImageDraw
ID, OUT = sys.argv[1], sys.argv[2]
HW = int(sys.argv[3]) if len(sys.argv) > 3 else 140; HH = int(sys.argv[4]) if len(sys.argv) > 4 else 120
O = f'saida/torres/{ID}'; b = json.load(open(f'{O}/base.json')); cw, ch = b['cell']; mx, my = b['meta']['mount']
row = b['rows'].index('pronta'); base = Image.open(f'{O}/base.png').crop((0, row * ch, cw, (row + 1) * ch))
bg = Image.new('RGBA', base.size, (150, 150, 150, 255)); bg.alpha_composite(base)
x0, y0 = mx - HW, my - HH; c = bg.crop((x0, y0, mx + HW, my + HH)); Z = 3
c = c.resize((c.width * Z, c.height * Z), Image.NEAREST); d = ImageDraw.Draw(c)
for y in range((y0 // 10 + 1) * 10, my + HH, 10):
    d.line([(0, (y - y0) * Z), (c.width, (y - y0) * Z)], fill=(255, 0, 0, 255) if y % 50 == 0 else (255, 255, 0, 110))
    if y % 20 == 0: d.text((2, (y - y0) * Z + 1), str(y), fill=(255, 255, 255, 255))
for x in range((x0 // 10 + 1) * 10, mx + HW, 10):
    d.line([((x - x0) * Z, 0), ((x - x0) * Z, c.height)], fill=(255, 0, 0, 255) if x % 50 == 0 else (255, 255, 0, 60))
    if x % 50 == 0: d.text(((x - x0) * Z + 2, 2), str(x), fill=(255, 255, 255, 255))
d.ellipse([(mx - x0) * Z - 4, (my - y0) * Z - 4, (mx - x0) * Z + 4, (my - y0) * Z + 4], outline=(0, 0, 255, 255), width=2)
c.save(OUT); print(ID, cw, ch, (mx, my))

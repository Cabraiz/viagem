# Muzzle by eye: fire frame F (default 1, the shot) of the 8 directions, 2x, on a 10x10 grid of the cell (tenths).
import sys
from PIL import Image, ImageDraw
ID = sys.argv[1]; F = int(sys.argv[2]) if len(sys.argv) > 2 else 1
fire = Image.open(f'saida/torres/{ID}/fire.png'); cw = fire.width // 8; ch = fire.height // 8
Z = 2; out = Image.new('RGBA', (4 * cw * Z, 2 * ch * Z), (150, 150, 150, 255)); d = ImageDraw.Draw(out)
for i, n in enumerate(['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']):
    fr = fire.crop((F * cw, i * ch, (F + 1) * cw, (i + 1) * ch)).resize((cw * Z, ch * Z))
    x0, y0 = (i % 4) * cw * Z, (i // 4) * ch * Z
    out.alpha_composite(fr, (x0, y0))
    for k in range(11):
        c = (255, 255, 0, 200) if k % 5 == 0 else (255, 255, 255, 110)
        d.line([(x0 + k * cw * Z / 10, y0), (x0 + k * cw * Z / 10, y0 + ch * Z)], fill=c)
        d.line([(x0, y0 + k * ch * Z / 10), (x0 + cw * Z, y0 + k * ch * Z / 10)], fill=c)
    d.text((x0 + 4, y0 + 4), n, fill=(255, 0, 0, 255))
out.save(f'boca-{ID}.png')

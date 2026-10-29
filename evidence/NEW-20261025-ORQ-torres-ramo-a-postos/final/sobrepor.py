# Board check: crew frame (idle 0 of S, SW, N, E) standing on the mount of each pronta view, on grey.
import sys, json
from PIL import Image
ID = sys.argv[1]
O = f'saida/torres/{ID}'
b = json.load(open(f'{O}/base.json')); m = json.load(open(f'{O}/meta.json'))
base = Image.open(f'{O}/base.png'); idle = Image.open(f'{O}/idle.png')
cw, ch = b['cell']; ax = b['meta']['mount']; kw, kh = m['cell']; an = m['anchor']
row = b['rows'].index('pronta')
out = Image.new('RGBA', (4 * cw, ch), (150, 150, 150, 255))
for v, d in enumerate([0, 1, 4, 6]):
    cell = base.crop((v * cw, row * ch, (v + 1) * cw, (row + 1) * ch))
    out.alpha_composite(cell, (v * cw, 0))
    fr = idle.crop((0, d * kh, kw, (d + 1) * kh))
    out.alpha_composite(fr, (v * cw + round(ax[0] - an[0] * kw), round(ax[1] - an[1] * kh)))
out.save(f'sobre-{ID}.png')

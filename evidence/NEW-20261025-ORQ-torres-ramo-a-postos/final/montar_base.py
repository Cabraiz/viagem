# Etapa 2: assemble base1 (pronta, danificada) + base2 (obra-1, obra-2, obra-3, ruina) of one tower into the importer's
# torres/<id>/base.png (4 views x 6 rows) + base.json. Scale per image: pronta (base1) and obra-3 (base2) median opaque
# width = WIDTH[fp]. Each view keeps the place Codex drew it in its grid cell (rows stay aligned); base2 is shifted so
# its obra-3 lines up with base1's pronta (centre; every row's bottom on the ground). Anchor = the pronta's median bottom (ground under the
# front post), centre x. Mount comes from mount.json (set by eye on grade-<id>.png), else the deck centre guess.
#   python montar_base.py <id> <fp>
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from lib import key, grid, bounds, clean_cell, clear_border, sheet_on_grey

ID, FP = sys.argv[1], int(sys.argv[2])
WIDTH = {2: 370, 3: 520}[FP]
ROWS = ['obra-1', 'obra-2', 'obra-3', 'pronta', 'danificada', 'ruina']
OUT = f'saida/torres/{ID}'
os.makedirs(OUT, exist_ok=True)


def load(job, rows):
    img = Image.open(f'{job}/meio.png')
    g = grid(img, 4, rows)
    cells = [[clean_cell(key(c)) for c in r] for r in g]
    return cells


def median_box(row):
    bs = [bounds(c) for c in row]
    w = np.median([b[2] - b[0] for b in bs])
    cx = np.median([(b[0] + b[2]) / 2 for b in bs])
    bot = np.median([b[3] for b in bs])
    return w, cx, bot


b1 = load(f'base1-{ID}', 2)  # pronta, danificada
b2 = load(f'base2-{ID}', 4)  # obra-1, obra-2, obra-3, ruina
w1, cx1, bot1 = median_box(b1[0])
w2, cx2, bot2 = median_box(b2[2])
s1, s2 = WIDTH / w1, WIDTH / w2
# common frame: art px, origin at the pronta's (centre, bottom)
placed = {}
for name, row in zip(['pronta', 'danificada'], b1):
    placed[name] = [(c, s1, cx1, bot1) for c in row]
# each base2 row stands on its own ground: Codex may draw the low obra-1 in the middle of its grid cell
for name, row in zip(['obra-1', 'obra-2', 'obra-3', 'ruina'], b2):
    placed[name] = [(c, s2, cx2, median_box(row)[2]) for c in row]
# extents above/below the anchor across everything (alpha > 8, the shadow included)
top, bottom, half = 0, 0, 0
for name in ROWS:
    for c, s, cx, bot in placed[name]:
        a = np.asarray(c)[..., 3]
        ys, xs = np.nonzero(a > 8)
        top = min(top, (ys.min() - bot) * s)
        bottom = max(bottom, (ys.max() + 1 - bot) * s)
        half = max(half, abs((xs.min() - cx) * s), abs((xs.max() + 1 - cx) * s))
PAD = 4
CW = 2 * (int(np.ceil(half)) + PAD)
CW += (-CW) % 16
AY = int(np.ceil(-top)) + PAD
CH = AY + int(np.ceil(bottom)) + PAD
CH += (-CH) % 8
AX = CW // 2
sheet = Image.new('RGBA', (4 * CW, 6 * CH), (0, 0, 0, 0))
cells = {}
for r, name in enumerate(ROWS):
    for v, (c, s, cx, bot) in enumerate(placed[name]):
        big = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
        cell.alpha_composite(big, (round(AX - cx * s), round(AY - bot * s)))
        cell = clear_border(cell, 2)
        cells[(name, v)] = cell
        sheet.alpha_composite(cell, (v * CW, r * CH))
sheet.save(f'{OUT}/base.png')
mf = f'mount-{ID}.json'
if os.path.exists(mf):
    mount = json.load(open(mf))['mount']
else:  # deck centre guess: a third of the pronta's height above the bottom
    mount = [AX, round(AY - 0.33 * (bounds(cells[('pronta', 0)])[3] - bounds(cells[('pronta', 0)])[1]))]
json.dump({'kind': 'views', 'cell': [CW, CH], 'views': 4, 'rows': ROWS, 'anchor': [0.5, round(AY / CH, 4)],
           'meta': {'footprint': [FP, FP], 'mount': mount}}, open(f'{OUT}/base.json', 'w'))
print(f'{ID}: cell {CW}x{CH} anchor y {AY} ({AY/CH:.3f}) mount {mount} s1 {s1:.3f} s2 {s2:.3f}')
# check images: contact sheet on grey, and the pronta view 0 at 1x with a 10 px grid + anchor/mount marks
sheet_on_grey([cells[(n, v)] for n in ROWS for v in range(4)], 4, scale=0.5,
              labels=[f'{n} v{v*90}' for n in ROWS for v in range(4)]).save(f'contato-base-{ID}.png')
g = Image.new('RGBA', (CW, CH), (150, 150, 150, 255))
g.alpha_composite(cells[('pronta', 0)])
d = ImageDraw.Draw(g)
for y in range(0, CH, 20):
    d.line([(0, y), (CW, y)], fill=(255, 255, 255, 90) if y % 100 else (255, 255, 0, 160))
    if y % 100 == 0:
        d.text((2, y + 1), str(y), fill=(255, 255, 0, 255))
for x in range(0, CW, 20):
    d.line([(x, 0), (x, CH)], fill=(255, 255, 255, 90) if x % 100 else (255, 255, 0, 160))
d.ellipse([AX - 4, AY - 4, AX + 4, AY + 4], outline=(255, 0, 0, 255), width=2)
d.ellipse([mount[0] - 4, mount[1] - 4, mount[0] + 4, mount[1] + 4], outline=(0, 0, 255, 255), width=2)
g.save(f'grade-{ID}.png')

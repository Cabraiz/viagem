# Etapa 2: assemble the crew of one tower from anim-<id>-<DIR>/meio.png (4x4: idle poses 0-7, fire 8-15; drawn S, SW,
# W, NW, N; SE/E/NE mirrored) into the importer's torres/<id>/idle.png + fire.png (8 rows S,SW,W,NW,N,NE,E,SE x 8
# frames) + meta.json. Scale per sheet: pose 0 (neutral) opaque height = HERO_PX. Every pose stands on the anchor: feet
# = its lowest opaque row, x = the centre of its lowest 12 % (feet planted, no slide). The parapet in front hides what
# is below the V line y = feet + DY - 0.5*|x - ax| (DY from cut-<id>.json; none = nothing hidden).
#   python montar_crew.py <id> <fps fire> [height px]
import sys, json, os
import numpy as np
from PIL import Image
from lib import key, grid, bounds, clean_cell, clear_border, sheet_on_grey, HERO_PX

ID, FPS_FIRE = sys.argv[1], int(sys.argv[2])
HEIGHT = int(sys.argv[3]) if len(sys.argv) > 3 else HERO_PX
CW = CH = 256
AX, AY = CW // 2, 220
DRAWN = ['S', 'SW', 'W', 'NW', 'N']
MIRROR = {'NE': 'NW', 'E': 'W', 'SE': 'SW'}
ORDER = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
OUT = f'saida/torres/{ID}'
os.makedirs(OUT, exist_ok=True)
cutf = f'cut-{ID}.json'
DY = json.load(open(cutf))['dy'] if os.path.exists(cutf) else None


def feet(c):
    a = np.asarray(c)[..., 3] > 200
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max() + 1
    low = ys >= bot - 0.12 * (bot - top)
    return xs[low].mean(), bot, bot - top


# chosen attempt per direction: escolha-<id>.json {"N": "t2"} (default: the first); a pose that breaks the loop is
# replaced by a neighbour: {"pick": {"N": {"15": 13}}}
escf = f'escolha-{ID}.json'
ESC = json.load(open(escf)) if os.path.exists(escf) else {}


def build(d):
    g = grid(Image.open(f'anim-{ID}-{d}' + (f'-{ESC[d]}' if d in ESC and d != 'pick' else '') + '/meio.png'), 4, 4)
    cells = [clean_cell(key(c)) for r in g for c in r]
    for i, j in ESC.get('pick', {}).get(d, {}).items():
        cells[int(i)] = cells[j]
    s = HEIGHT / feet(cells[0])[2]
    out = []
    for c in cells:
        fx, fy, _ = feet(c)
        big = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
        cell.alpha_composite(big, (round(AX - fx * s), round(AY - fy * s)))
        if DY is not None:
            a = np.array(cell)
            yy, xx = np.mgrid[0:CH, 0:CW]
            cut = AY + DY - 0.5 * np.abs(xx - AX)
            a[..., 3] = (a[..., 3] * np.clip(cut - yy + 0.5, 0, 1)).astype(np.uint8)
            cell = Image.fromarray(a, 'RGBA')
        out.append(clear_border(cell, 2))
    return out, s


poses, scales = {}, {}
for d in DRAWN:
    poses[d], scales[d] = build(d)
for d, src in MIRROR.items():
    poses[d] = [p.transpose(Image.FLIP_LEFT_RIGHT) for p in poses[src]]
for name, rng in (('idle', range(0, 8)), ('fire', range(8, 16))):
    sheet = Image.new('RGBA', (8 * CW, 8 * CH), (0, 0, 0, 0))
    for r, d in enumerate(ORDER):
        for f, i in enumerate(rng):
            sheet.alpha_composite(poses[d][i], (f * CW, r * CH))
    sheet.save(f'{OUT}/{name}.png')
json.dump({'cell': [CW, CH], 'anchor': [0.5, round(AY / CH, 4)], 'fps': {'idle': 4, 'fire': FPS_FIRE}},
          open(f'{OUT}/meta.json', 'w'))
print(ID, 'escala', {d: round(s, 3) for d, s in scales.items()}, 'corte', DY)
# contact sheets: one row per direction, 16 poses numbered (idle 0-7 | fire 8-15)
for d in ORDER:
    sheet_on_grey(poses[d], 16, scale=0.5, labels=[str(i) for i in range(16)]).save(f'contato-crew-{ID}-{d}.png')
rows = [Image.open(f'contato-crew-{ID}-{d}.png') for d in ORDER]
st = Image.new('RGBA', (rows[0].width, sum(r.height for r in rows)))
for i, r in enumerate(rows):
    st.alpha_composite(r.convert('RGBA'), (0, i * rows[0].height))
st.save(f'contato-crew-{ID}.png')
for d in ORDER:
    os.remove(f'contato-crew-{ID}-{d}.png')

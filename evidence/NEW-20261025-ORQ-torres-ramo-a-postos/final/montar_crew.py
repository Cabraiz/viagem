# Etapa 2: assemble the crew of one tower from anim-<id>-<DIR>/meio.png (4x4: idle poses 0-7, fire 8-15; drawn S, SW,
# W, NW, N; SE/E/NE mirrored) into the importer's torres/<id>/idle.png + fire.png (8 rows S,SW,W,NW,N,NE,E,SE x 8
# frames) + meta.json. Scale per sheet: pose 0 (neutral) opaque height = HERO_PX x regua.json escala x fator[id] (the
# single ruler of 28/10: escala is the absolute size of every crew, fator evens out the helmets of one tower). Every pose
# stands on the anchor: feet = its lowest opaque row, x = the centre of its lowest 12 % (feet planted, no slide). The
# feet go on the deck floor at the base's mount (mount-<id>.json); the front parapet of the base, whose top is the V
# y = apex_y - slope*|x - apex_x| in base pixels (parapeito-<id>.json), hides what is below it (none = nothing hidden).
#   python montar_crew.py <id> <fps fire> [cell width px: 256, wider for a crew of three]
import sys, json, os
import numpy as np
from PIL import Image
from lib import key, grid, grid_gaps, bounds, clean_cell, clear_border, sheet_on_grey, HERO_PX

ID, FPS_FIRE = sys.argv[1], int(sys.argv[2])
REGUA = json.load(open('regua.json'))
HEIGHT = HERO_PX * REGUA['escala'] * REGUA['fator'].get(ID, 1)
# REGUA1=1: escala and fator 1 (the sheets the muzzles are read on); NOCUT=1: no parapet (the ruler board); SAIDA: output dir
if os.environ.get('REGUA1'): HEIGHT = HERO_PX
CH = 256
CW = int(sys.argv[3]) if len(sys.argv) > 3 else 256
AX, AY = CW // 2, 220
DRAWN = ['S', 'SW', 'W', 'NW', 'N']
MIRROR = {'NE': 'NW', 'E': 'W', 'SE': 'SW'}
ORDER = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
OUT = f"{os.environ.get('SAIDA', 'saida/torres')}/{ID}"
os.makedirs(OUT, exist_ok=True)
MOUNT = json.load(open(f'mount-{ID}.json'))['mount']
parf = f'parapeito-{ID}.json'
PAR = json.load(open(parf)) if os.path.exists(parf) and not os.environ.get('NOCUT') else None
# the parapet V in sheet pixels: apex row DY below the feet (>= 0, or the feet hide and the importer's foot check fails)
DY, DX = (PAR['apex'][1] - MOUNT[1], PAR['apex'][0] - MOUNT[0]) if PAR else (None, 0)
assert DY is None or DY >= 0, f'{ID}: the mount must be on the floor behind the parapet (apex y {PAR["apex"][1]} < feet y {MOUNT[1]})'


def feet(c):
    a = np.asarray(c)[..., 3] > 200
    ys, xs = np.nonzero(a)
    top, bot = ys.min(), ys.max() + 1
    low = ys >= bot - 0.12 * (bot - top)
    # a lying crew's lowest row is the rifle's bipod, not the feet: x = the middle of the whole drawing ({"pe": "caixa"})
    fx = (xs.min() + xs.max() + 1) / 2 if ESC.get('pe') == 'caixa' else xs[low].mean()
    return fx, bot, bot - top


# chosen attempt per direction: escolha-<id>.json {"N": "t2"} (default: the first); a pose that breaks the loop is
# replaced by a neighbour: {"pick": {"N": {"15": 13}}}; a lying crew (pose 0 height changes with the direction) takes
# the S sheet's scale in every direction: {"escala": "S"}; a sheet Codex drew facing the mirrored side (SW aiming
# bottom-right) is flipped: {"espelhar": ["SW"]}; a sheet drawn across the equal grid is split at the gaps: {"vao": ["NW"]}
escf = f'escolha-{ID}.json'
ESC = json.load(open(escf)) if os.path.exists(escf) else {}


def build(d, s=None):
    g = (grid_gaps if d in ESC.get('vao', []) else grid)(Image.open(f'anim-{ID}-{d}' + (f'-{ESC[d]}' if d in ESC and d not in ('pick', 'escala', 'pe') else '') + '/meio.png'), 4, 4)
    cells = [clean_cell(key(c)) for r in g for c in r]
    if d in ESC.get('espelhar', []):
        cells = [c.transpose(Image.FLIP_LEFT_RIGHT) for c in cells]
    for i, j in ESC.get('pick', {}).get(d, {}).items():
        cells[int(i)] = cells[j]
    s = s or HEIGHT / feet(cells[0])[2]
    out = []
    for c in cells:
        fx, fy, _ = feet(c)
        big = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
        cell = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
        cell.alpha_composite(big, (round(AX - fx * s), round(AY - fy * s)))
        if DY is not None:
            a = np.array(cell)
            yy, xx = np.mgrid[0:CH, 0:CW]
            cut = AY + DY - PAR.get('slope', 0.5) * np.abs(xx - AX - DX)
            a[..., 3] = (a[..., 3] * np.clip(cut - yy + 0.5, 0, 1)).astype(np.uint8)
            cell = Image.fromarray(a, 'RGBA')
        out.append(clear_border(cell, 2))
    return out, s


poses, scales = {}, {}
for d in DRAWN:
    poses[d], scales[d] = build(d, scales.get(ESC.get('escala')))
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
print(ID, 'altura', round(HEIGHT, 1), 'escala', {d: round(s, 3) for d, s in scales.items()}, 'parapeito', PAR, 'pe', MOUNT)
if not os.environ.get('SAIDA'):
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

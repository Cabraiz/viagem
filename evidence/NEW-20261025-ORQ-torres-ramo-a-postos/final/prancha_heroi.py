# Etapa 3, opção B (28/10): prancha-heroi-x-soldado.png. Each of the 7 posts (pronta, view 0, crew S pose 0 on the
# mount, as imported) next to the hero, in the real game's world px (Cidade Nevada), × ZOOM for reading:
#   row ANTES  : the post at the scenery scale (towerArtScale, 0.85 world px per art px), the hero 96 × 0.5445 × 0.8
#   row DEPOIS : the post at towerKindScale (96 × actor scale × HERO_DRAW_SCALE / RAMO_A_CREW_PX), the same hero
#   row SOLDADO: the whole crew S pose 0 (saida-regua, NOCUT) beside the hero, depois scale, with the hero's head line
import json
import numpy as np
from PIL import Image, ImageDraw
from regua_ver import IDS, NAMES

ACTOR, HDS, CREW_PX, SCENERY = 0.5445, 0.8, 155, 0.85
HERO_W = 96 * ACTOR * HDS                      # world px
POST = HERO_W / CREW_PX                        # world px per art px, depois
ZOOM, GREY = 2, (150, 150, 150, 255)
hero = Image.open('refs/hero.png').convert('RGBA')

def sc(im, k):
    return im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)

def trim(im):
    a = np.asarray(im)[..., 3] > 16; ys = np.nonzero(a.any(1))[0]; xs = np.nonzero(a.any(0))[0]
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def post(i):
    b = json.load(open(f'saida/torres/{i}/base.json')); m = json.load(open(f'saida/torres/{i}/meta.json'))
    cw, ch = b['cell']; mx, my = b['meta']['mount']; kw, kh = m['cell']; an = m['anchor']; row = b['rows'].index('pronta')
    v = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    v.alpha_composite(Image.open(f'saida/torres/{i}/base.png').convert('RGBA').crop((0, row * ch, cw, (row + 1) * ch)))
    v.alpha_composite(Image.open(f'saida/torres/{i}/idle.png').convert('RGBA').crop((0, 0, kw, kh)), (round(mx - an[0] * kw), round(my - an[1] * kh)))
    return trim(v)

def crew(i):
    m = json.load(open(f'saida-regua/{i}/meta.json')); cw, ch = m['cell']
    return trim(Image.open(f'saida-regua/{i}/idle.png').convert('RGBA').crop((0, 0, cw, ch)))

heroW = trim(sc(hero, HERO_W / hero.height * ZOOM))
rows = []
for label, k in (('ANTES (escala do cenario)', SCENERY), ('DEPOIS (opcao B: soldado = heroi)', POST)):
    cells = [(n, trim(sc(post(i), k * ZOOM))) for i, n in zip(IDS, NAMES)]
    rows.append((label, cells))
soldiers = [(n, trim(sc(crew(i), POST * ZOOM))) for i, n in zip(IDS, NAMES)]

GAP, TOP = 24, 20
labels = [l for l, _ in rows] + ['SOLDADO x HEROI (linha = topo do heroi)']
grid = [[c for _, c in cells] for _, cells in rows] + [[c for _, c in soldiers]]
colW = [heroW.width + 8 + max(g[j].width for g in grid) for j in range(len(IDS))]
rowH = [TOP + max(max(c.height for c in g), heroW.height) + 14 for g in grid]
LEFT = 150
out = Image.new('RGBA', (LEFT + sum(colW) + GAP * len(IDS), 26 + sum(rowH)), GREY); d = ImageDraw.Draw(out)
x = LEFT
for j, n in enumerate(NAMES):
    d.text((x, 6), n, fill=(255, 255, 0, 255)); x += colW[j] + GAP
y = 26
for r, (lab, g) in enumerate(zip(labels, grid)):
    y0 = y + rowH[r] - 8; d.text((6, y + rowH[r] // 2), lab.split(' (')[0], fill=(255, 255, 0, 255))
    d.text((6, y + rowH[r] // 2 + 14), '(' + lab.split(' (')[1] if ' (' in lab else '', fill=(230, 230, 230, 255))
    x = LEFT
    for j, c in enumerate(g):
        out.alpha_composite(heroW, (x, y0 - heroW.height)); out.alpha_composite(c, (x + heroW.width + 8, y0 - c.height))
        if r == 2: d.line((x - 4, y0 - heroW.height, x + colW[j] + 4, y0 - heroW.height), fill=(200, 40, 40, 255))
        d.text((x, y + 4), f'{c.height / heroW.height:.2f}x o heroi', fill=(255, 255, 255, 255))
        x += colW[j] + GAP
    d.line((0, y0, out.width, y0), fill=(90, 90, 90, 255)); y += rowH[r]
out.save('prancha-heroi-x-soldado.png')
print(out.size, 'soldado/heroi', {n: round(c.height / heroW.height, 2) for n, c in soldiers})

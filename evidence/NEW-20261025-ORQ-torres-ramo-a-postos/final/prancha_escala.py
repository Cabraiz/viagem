# Etapa 2b (28/10): prancha-escala-7-torres.png. Row 1: the 7 crews' S pose 0 whole (built with NOCUT=1 into
# saida-regua/) on one ground line next to the hero at the game's size, with a 10 px ruler and the median head top.
# Row 2: each crew on the pronta view 0 of its base, at the mount, cut by the parapet (the sheets in saida/torres).
#   NOCUT=1 SAIDA=saida-regua sh montar_todas.sh && python prancha_escala.py
import json
import numpy as np
from PIL import Image, ImageDraw
from regua_ver import IDS, NAMES
# the hero in the real game is 96 x CITY_VIEW_SCALE 0.5445 x HERO_DRAW_SCALE 0.8 = 41.8 world px; a tower art px is
# 0.85 world px there (towerArtScale with unitsPerCell 1.496), so the hero is ~49 art px tall next to the crews
HERO_GAME = 49
hero = Image.open('refs/hero.png').convert('RGBA')
hero = hero.resize((round(hero.width * HERO_GAME / hero.height), HERO_GAME), Image.LANCZOS)
GREY, Y0 = (150, 150, 150, 255), 30
figs, tops = [], []
for i in IDS:
    m = json.load(open(f'saida-regua/{i}/meta.json')); cw, ch = m['cell']
    c = Image.open(f'saida-regua/{i}/idle.png').convert('RGBA').crop((0, 0, cw, ch))
    a = np.asarray(c)[..., 3] > 128; ys = np.nonzero(a.any(1))[0]; xs = np.nonzero(a.any(0))[0]
    figs.append((c.crop((xs.min() - 6, 0, xs.max() + 7, ch)), ys.min())); tops.append(ys.min())
AY = 220
W = 90 + sum(f.width + 20 for f, _ in figs) + 20
img = Image.new('RGBA', (W, Y0 + 256 + 20), GREY); d = ImageDraw.Draw(img)
for k in range(0, 23):
    y = Y0 + AY - 10 * k
    d.line((0, y, W, y), fill=(70, 70, 200, 255) if k % 5 == 0 else (125, 125, 125, 255))
    if k % 5 == 0: d.text((2, y - 11), f'{10 * k}', fill=(20, 20, 90, 255))
top = Y0 + int(np.median(tops)); d.line((0, top, W, top), fill=(200, 40, 40, 255))
img.alpha_composite(hero, (45 - hero.width // 2, Y0 + AY - hero.height)); d.text((24, 4), 'heroi', fill=(255, 255, 0, 255))
d.text((4, 16), f'{HERO_GAME}px', fill=(255, 255, 0, 255))
x = 90
for (f, t), n in zip(figs, NAMES):
    img.alpha_composite(f, (x, Y0)); d.text((x + 2, 4), n, fill=(255, 255, 0, 255)); d.text((x + 2, 16), f'{AY - t}px', fill=(255, 255, 0, 255))
    x += f.width + 20
# row 2: on the base
views = []
for i in IDS:
    b = json.load(open(f'saida/torres/{i}/base.json')); m = json.load(open(f'saida/torres/{i}/meta.json'))
    cw, ch = b['cell']; mx, my = b['meta']['mount']; kw, kh = m['cell']; an = m['anchor']; row = b['rows'].index('pronta')
    v = Image.new('RGBA', (cw, ch), GREY); v.alpha_composite(Image.open(f'saida/torres/{i}/base.png').convert('RGBA').crop((0, row * ch, cw, (row + 1) * ch)))
    v.alpha_composite(Image.open(f'saida/torres/{i}/idle.png').convert('RGBA').crop((0, 0, kw, kh)), (round(mx - an[0] * kw), round(my - an[1] * kh)))
    a = np.asarray(v)[..., :3].astype(int); diff = np.abs(a - np.array(GREY[:3])).sum(2) > 6
    ys = np.nonzero(diff.any(1))[0]; xs = np.nonzero(diff.any(0))[0]
    views.append(v.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
S = 0.5; views = [v.resize((round(v.width * S), round(v.height * S)), Image.LANCZOS) for v in views]
H2 = max(v.height for v in views) + 20; W2 = sum(v.width + 12 for v in views) + 12
out = Image.new('RGBA', (max(W, W2), img.height + H2), GREY); out.alpha_composite(img)
x = 12
for v in views:
    out.alpha_composite(v, (x, img.height + H2 - 10 - v.height)); x += v.width + 12
out.save('prancha-escala-7-torres.png'); print(out.size, 'alturas', dict(zip(NAMES, [AY - t for t in tops])))

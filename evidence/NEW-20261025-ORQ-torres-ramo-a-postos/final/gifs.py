# Etapa 2: per tower, one GIF per animation (idle, fire): the crew standing on the pronta base, the 8 directions side by
# side (base views 0/90/180/270 under S/SW... as in sobrepor.py: the base view is the one that matches the direction's
# side), at the sheet's fps; plus the loop check per direction: the seam (last -> first frame) against the median of
# the neighbour steps (limit 1.2x, skill personagem-animado rule 2) and the height of each frame vs frame 0.
#   python gifs.py <id>
import sys, json
import numpy as np
from PIL import Image

ID = sys.argv[1]
O = f'saida/torres/{ID}'
ORDER = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
b = json.load(open(f'{O}/base.json')); m = json.load(open(f'{O}/meta.json'))
base = Image.open(f'{O}/base.png')
cw, ch = b['cell']; mx, my = b['meta']['mount']; kw, kh = m['cell']; an = m['anchor']
row = b['rows'].index('pronta')
pronta = base.crop((0, row * ch, cw, (row + 1) * ch))
SC = 0.5
report = {}
for anim in ('idle', 'fire'):
    sheet = Image.open(f'{O}/{anim}.png')
    n = sheet.width // kw
    cells = [[sheet.crop((f * kw, r * kh, (f + 1) * kw, (r + 1) * kh)) for f in range(n)] for r in range(8)]
    frames = []
    for f in range(n):
        out = Image.new('RGBA', (8 * cw, ch), (150, 150, 150, 255))
        for r in range(8):
            out.alpha_composite(pronta, (r * cw, 0))
            out.alpha_composite(cells[r][f], (r * cw + round(mx - an[0] * kw), round(my - an[1] * kh)))
        frames.append(out.resize((round(out.width * SC), round(out.height * SC)), Image.LANCZOS).convert('RGB'))
    fps = m['fps'][anim]
    frames[0].save(f'gif-{ID}-{anim}.gif', save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0)
    rep = {}
    for r, d in enumerate(ORDER):
        a = [np.asarray(c).astype(np.float32)[..., 3] / 255 for c in cells[r]]
        steps = [np.abs(a[(i + 1) % n] - a[i]).sum() for i in range(n)]
        med = float(np.median(steps[:-1]))
        hs = []
        for c in a:
            ys = np.nonzero((c > 0.8).any(1))[0]
            hs.append(ys.max() - ys.min() + 1)
        # a crew with a gag moves a lot inside the loop: the seam is also measured against the biggest step inside it
        rep[d] = {'emenda': round(float(steps[-1] / med), 2) if med else 0,
                  'emendaVsMaior': round(float(steps[-1] / max(steps[:-1])), 2), 'alturaMin': round(float(min(hs) / hs[0]), 2),
                  'alturaMax': round(float(max(hs) / hs[0]), 2)}
    report[anim] = rep
json.dump(report, open(f'laco-{ID}.json', 'w'), indent=1)
for anim, rep in report.items():
    print(ID, anim, ' '.join(f"{d}:{v['emenda']}/{v['emendaVsMaior']}" for d, v in rep.items()))

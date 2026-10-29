# Etapa 2: for one crew sheet, which pose could replace the last frame of each loop so the seam (last -> first)
# stays small: per drawn direction and animation, seam/median and seam/biggest-step for every candidate.
#   python busca_pick.py <id>
import sys, json
import numpy as np
from PIL import Image
ID = sys.argv[1]
O = f'saida/torres/{ID}'
kw, kh = json.load(open(f'{O}/meta.json'))['cell']
for anim, base in (('idle', 0), ('fire', 8)):
    s = Image.open(f'{O}/{anim}.png')
    for r, d in enumerate(['S', 'SW', 'W', 'NW', 'N']):
        a = [np.asarray(s.crop((f * kw, r * kh, (f + 1) * kw, (r + 1) * kh)))[..., 3] / 255. for f in range(8)]
        D = lambda i, j: float(np.abs(a[i] - a[j]).sum())
        out = []
        for j in range(7):
            b = list(range(7)) + [j]
            st = [D(b[i], b[(i + 1) % 8]) for i in range(8)]
            out.append(f'{base + j}:{st[-1] / np.median(st[:-1]):.2f}/{st[-1] / max(st[:-1]):.2f}')
        print(anim, d, ' '.join(out[1:]))

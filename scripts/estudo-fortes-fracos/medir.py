# Medidas do estudo "inimigos fortes x fracos" (card NEW-20261023-ORQ-inimigos-fortes-x-fracos).
# Por inimigo com arte: o 1º quadro do parado (idle; senão fly/walk) nas 8 direções, como o jogo desenha hoje:
# folha lite, ampliada com filtro linear até a altura do papel (horde-art.ts artTargetHeight: herói 96 × 0,9 / 1,3
# brutamontes / ...), sobre a neve. Escalas: PC 1280x720 (herói 87 px) e celular 390x844 (herói 47 px).
#   python -I medir.py <checkout> <roster.json> <saida.json>
# roster.json: [{id, role}] (src/rules/enemy-cast.ts ROSTER_IDS + roleOf).
import sys, json, math
import numpy as np
from PIL import Image

ROLE_HEIGHT = {'enxame': .5, 'voador': .6, 'brutamontes': 1.3, 'mini-chefe': 2, 'chefe': 3}
HERO = {'pc': 87, 'celular': 47}
NEVE = np.array([220., 221., 230.])
ASFALTO = np.array([118., 118., 124.])
STILL = ('idle', 'fly', 'walk')
L = lambda a: a[..., 0] * .299 + a[..., 1] * .587 + a[..., 2] * .114


def cells(sheet, cell, cols, rows):
    w, h = cell
    return [[sheet[r * h:(r + 1) * h, c * w:(c + 1) * w] for c in range(cols)] for r in range(rows)]


def drawn_height(cell, anchor_y):
    """Pés (âncora) até o topo de alfa >= 128, em px da célula (horde-art.ts drawnHeight)."""
    a = cell[..., 3]
    ys = np.where((a >= 128).any(1))[0]
    feet = cell.shape[0] * anchor_y
    return feet - ys.min() if len(ys) and ys.min() < feet else None


def to_screen(cell, k):
    """A célula ampliada k× com filtro linear (Phaser, texturas sem pixelArt), alfa pré-multiplicado."""
    h, w = cell.shape[:2]
    W, H = max(1, round(w * k)), max(1, round(h * k))
    pm = cell.astype(float).copy()
    pm[..., :3] *= pm[..., 3:4] / 255
    out = np.stack([np.array(Image.fromarray(pm[..., i].astype(np.float32), 'F').resize((W, H), Image.BILINEAR)) for i in range(4)], -1)
    return out


def over(pm, bg):
    a = pm[..., 3:4] / 255
    return pm[..., :3] + bg * (1 - a), pm[..., 3]


def lap_energy(lum, mask):
    """Energia do laplaciano (4 vizinhos) dentro da figura: nitidez como aparece."""
    p = np.pad(lum, 1, mode='edge')
    lap = 4 * p[1:-1, 1:-1] - p[:-2, 1:-1] - p[2:, 1:-1] - p[1:-1, :-2] - p[1:-1, 2:]
    m = mask.copy()
    m[0, :] = m[-1, :] = m[:, 0] = m[:, -1] = False
    return float(np.sqrt(np.mean(lap[m] ** 2))) if m.any() else 0.


def edge_width(alpha):
    """Largura média da borda (px de alfa entre 10 % e 90 %) por px de contorno: borda borrada = maior."""
    soft = ((alpha > 25) & (alpha < 230)).sum()
    hard = (alpha >= 128)
    p = np.pad(hard, 1)
    contour = (hard & ~(p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:])).sum()
    return float(soft / max(1, contour))


def halo(cell):
    """Halo do recorte: px semitransparentes da borda bem mais claros que o miolo (fundo branco que ficou)."""
    a = cell[..., 3].astype(float)
    lum = L(cell[..., :3].astype(float))
    core = a >= 250
    if not core.any():
        return 0.
    ref = np.percentile(lum[core], 75)
    rim = (a > 20) & (a < 250)
    return float(((lum > ref + 40) & rim).sum() / max(1, rim.sum()))


def specks(cell):
    """Ilhas de alfa (>= 128) soltas da figura principal, em % da área: ruído de recorte."""
    m = cell[..., 3] >= 128
    if not m.any():
        return 0.
    from collections import deque
    h, w = m.shape
    lab = np.zeros((h, w), int)
    sizes = []
    for y, x in zip(*np.nonzero(m)):
        if lab[y, x]:
            continue
        n = len(sizes) + 1
        q = deque([(y, x)])
        lab[y, x] = n
        s = 0
        while q:
            cy, cx = q.popleft()
            s += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    q.append((ny, nx))
        sizes.append(s)
    sizes.sort()
    return float(sum(sizes[:-1]) / sum(sizes))


def palette(rgb, mask):
    """Cores dominantes: matiz em 12 fatias para px com croma >= 40, mais 'neutros' escuro/médio/claro.
    Conta as fatias com >= 6 % da figura. Destaque = maior fatia saturada (croma >= 70) fora da pele."""
    px = rgb[mask]
    mx, mn = px.max(1), px.min(1)
    chroma = mx - mn
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    hue = np.degrees(np.arctan2(math.sqrt(3) * (g - b), 2 * r - g - b)) % 360
    n = len(px)
    bins = {}
    col = chroma >= 40
    for i in range(12):
        sel = col & (hue >= i * 30) & (hue < (i + 1) * 30)
        bins[f'h{i * 30}'] = sel
    lum = L(px)
    for name, sel in (('escuro', ~col & (lum < 70)), ('medio', ~col & (lum >= 70) & (lum < 170)), ('claro', ~col & (lum >= 170))):
        bins[name] = sel
    frac = {k: float(v.sum() / n) for k, v in bins.items()}
    dominant = [k for k, f in sorted(frac.items(), key=lambda kv: -kv[1]) if f >= .06]
    # pele: matiz 10-40° e croma moderado; destaque: croma >= 70 fora disso
    skin = (hue >= 5) & (hue < 45) & (chroma < 110) & (lum > 80)
    vivid = (chroma >= 70) & ~skin
    best, bf, brgb = None, 0., None
    for i in range(12):
        sel = vivid & (hue >= i * 30) & (hue < (i + 1) * 30)
        f = sel.sum() / n
        if f > bf:
            best, bf, brgb = i * 30, float(f), px[sel].mean(0)
    return {'dominantes': dominant, 'n_dominantes': len(dominant), 'fatias': {k: round(v, 3) for k, v in frac.items() if v >= .03},
            'destaque_matiz': best, 'destaque_area': round(bf, 3), 'destaque_rgb': [int(c) for c in brgb] if brgb is not None else None,
            'croma_media': round(float(chroma.mean()), 1), 'vivo_area': round(float((chroma >= 70).sum() / n), 3)}


def norm_mask(cell, anchor, size=48):
    """Silhueta normalizada: altura da figura = size, pés no centro embaixo (para IoU entre inimigos)."""
    a = cell[..., 3] >= 128
    ys, xs = np.nonzero(a)
    if not len(ys):
        return np.zeros((size, size * 2), bool)
    top, feet = ys.min(), int(round(cell.shape[0] * anchor[1]))
    cx = cell.shape[1] * anchor[0]
    hgt = max(1, feet - top)
    k = size / hgt
    im = Image.fromarray((a * 255).astype(np.uint8)).resize((max(1, round(cell.shape[1] * k)), max(1, round(cell.shape[0] * k))), Image.BILINEAR)
    m = np.array(im) >= 128
    out = np.zeros((size, size * 2), bool)
    oy, ox = int(round(top * k)), int(round(cx * k)) - size
    sub = m[oy:oy + size]
    for y in range(min(size, sub.shape[0])):
        row = sub[y]
        lo, hi = max(0, ox), min(row.shape[0], ox + size * 2)
        if hi > lo:
            out[y, lo - ox:hi - ox] = row[lo:hi]
    return out


def solidity(mask):
    """Área / área do casco convexo (por linhas: casco aproximado pela envoltória esquerda/direita)."""
    ys, xs = np.nonzero(mask)
    if not len(ys):
        return 0.
    pts = np.stack([xs, ys], 1).astype(float)
    pts = np.unique(pts, axis=0)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    P = sorted(map(tuple, pts))
    lower, upper = [], []
    for p in P:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(P):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    hull = lower[:-1] + upper[:-1]
    area = 0.
    for i in range(len(hull)):
        x1, y1 = hull[i]
        x2, y2 = hull[(i + 1) % len(hull)]
        area += x1 * y2 - x2 * y1
    return float(mask.sum() / max(1, abs(area) / 2 + len(hull) / 2))


def measure(root, pid, piece, role):
    anim = next((a for a in STILL if a in piece['files']), None)
    if not anim:
        return None
    f = piece['files'][anim]
    page = f['pages'][0]
    full = np.array(Image.open(f'{root}/public/art/enemies/{page["file"]}').convert('RGBA'))
    cell = f['cell']
    rows = f['directions']
    grid = cells(full, cell, page['columns'], rows)
    lite_cell = f.get('liteCell')
    lite_path = f'{root}/public/art/lite/enemies/{page["file"]}'
    try:
        lite = np.array(Image.open(lite_path).convert('RGBA'))
        lgrid = cells(lite, lite_cell, page['columns'], rows) if lite_cell else None
    except FileNotFoundError:
        lgrid = None
    anchor = f.get('anchor', [.5, .88])
    heights = [drawn_height(grid[r][0], anchor[1]) for r in range(rows)]
    drawn = max(h for h in heights if h) if any(heights) else None
    if not drawn:
        return None
    factor = ROLE_HEIGHT.get(role, .9)
    out = {'id': pid, 'papel': role, 'fator_altura': factor, 'anim': anim, 'celula': cell[0], 'celula_lite': lite_cell[0] if lite_cell else None,
           'figura_px_origem': round(float(drawn), 1)}
    # direções de frente (S, SW, SE) para cor/nitidez; as 8 para silhueta
    front = [0, 1, 7]
    for tela, hero in HERO.items():
        target = factor * hero  # altura na tela, px CSS (DPR 1)
        src = lgrid if lgrid is not None else grid
        src_drawn = drawn * (lite_cell[0] / cell[0] if lgrid is not None else 1)
        k = target / src_drawn
        acc = {'lap': [], 'lap_cheia': [], 'borda': [], 'area': [], 'larg': [], 'luma': [], 'luma_std': [], 'contraste_neve': [], 'contraste_asfalto': []}
        for r in front:
            pm = to_screen(src[r][0], k)
            rgb, a = over(pm, NEVE)
            m = a >= 128
            if not m.any():
                continue
            lum = L(rgb)
            acc['lap'].append(lap_energy(lum, m))
            acc['borda'].append(edge_width(a))
            acc['area'].append(int(m.sum()))
            xs = np.nonzero(m.any(0))[0]
            acc['larg'].append(int(xs.max() - xs.min() + 1))
            acc['luma'].append(float(lum[m].mean()))
            acc['luma_std'].append(float(lum[m].std()))
            acc['contraste_neve'].append(float(L(NEVE) - lum[m].mean()))
            rgb2, _ = over(pm, ASFALTO)
            acc['contraste_asfalto'].append(float(abs(L(rgb2)[m].mean() - L(ASFALTO))))
            # a folha cheia na mesma altura (V4/V5a no PC): quanto a lite perde
            pmf = to_screen(grid[r][0], target / drawn)
            rgbf, af = over(pmf, NEVE)
            mf = af >= 128
            acc['lap_cheia'].append(lap_energy(L(rgbf), mf))
        out[tela] = {k2: round(float(np.mean(v)), 2) for k2, v in acc.items() if v}
        out[tela]['altura_px'] = round(target, 1)
        out[tela]['ampliacao'] = round(k, 2)
    # cor e paleta na origem (folha cheia, direções de frente)
    rgbs, masks = [], []
    for r in front:
        c = grid[r][0].astype(float)
        m = c[..., 3] >= 200
        rgbs.append(c[..., :3][m])
    px = np.concatenate(rgbs)
    pal = palette(px[None], np.ones((1, len(px)), bool))
    out.update(pal)
    out['nitidez_origem'] = round(float(np.mean([lap_energy(L(grid[r][0][..., :3].astype(float)), grid[r][0][..., 3] >= 200) for r in front])), 2)
    out['halo'] = round(float(np.mean([halo(grid[r][0]) for r in front])), 4)
    out['ilhas'] = round(float(np.mean([specks(grid[r][0]) for r in front])), 4)
    sil = [norm_mask(grid[r][0], anchor) for r in range(rows)]
    out['solidez'] = round(float(np.mean([solidity(s) for s in sil])), 3)
    out['larg_alt'] = round(float(np.mean([s.any(0).sum() / 48 for s in sil])), 3)
    # pose: quanto o parado se mexe (diferença de alfa entre quadros do loop) e partes fora do corpo
    fr = [grid[0][c][..., 3] >= 128 for c in range(min(f['frames'], page['columns']))]
    out['parado_mexe'] = round(float(np.mean([(fr[i] ^ fr[(i + 1) % len(fr)]).sum() / max(1, fr[i].sum()) for i in range(len(fr))])), 3)
    return out, sil


def main():
    root, roster_path, dest = sys.argv[1:4]
    roster = {e['id']: e['role'] for e in json.load(open(roster_path, encoding='utf8'))}
    pieces = json.load(open(f'{root}/public/art/enemies/manifest.json', encoding='utf8'))['pieces']
    rows, sils = [], {}
    for pid, piece in pieces.items():
        if pid not in roster:
            continue
        r = measure(root, pid, piece, roster[pid])
        if r:
            rows.append(r[0])
            sils[pid] = r[1]
            print(pid, file=sys.stderr)
    # parecença: IoU médio (8 direções) com o mais parecido do elenco
    ids = list(sils)
    stack = {i: np.stack(sils[i]) for i in ids}
    for row in rows:
        a = stack[row['id']]
        best, who = 0., None
        for j in ids:
            if j == row['id'] or len(stack[j]) != len(a):
                continue
            b = stack[j]
            iou = float(np.mean([(a[d] & b[d]).sum() / max(1, (a[d] | b[d]).sum()) for d in range(len(a))]))
            if iou > best:
                best, who = iou, j
        row['parecido_iou'] = round(best, 3)
        row['parecido_com'] = who
    json.dump(rows, open(dest, 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()

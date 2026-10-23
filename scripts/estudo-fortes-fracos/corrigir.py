# Correção barata por software dos inimigos fracos (card NEW-20261023-ORQ-inimigos-fortes-x-fracos), sem arte nova.
# O que separa os fortes (grandão, moto) dos fracos é a leitura de valor: um bloco escuro grande (terno, capacete) com a
# pele pouco à mostra, contra roupa marrom/vermelha/laranja no mesmo tom da pele. Aqui a ROUPA de cada folha é achada
# por cor (k-means em Lab no parado de frente; grupo da pele = o que domina a faixa da cabeça) e recolorida:
#   escuro  roupa em tom escuro neutro (o "terno" do grandão), mantendo o sombreado
#   cor     roupa na cor de destaque do inimigo (matiz longe da pele), mantendo o sombreado
# A mesma separação vale para todas as animações da peça (centroides fixos). Alfa e contorno não mudam.
#   python -I corrigir.py <checkout> <id> <escuro|cor> <saida-dir> [--cor #rrggbb] [--fonte lite|cheia] [--mascara <png>] [--roupa j,j]
import sys, json, argparse
import numpy as np
from PIL import Image


def srgb_to_lab(rgb):
    c = rgb / 255.
    c = np.where(c > .04045, ((c + .055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[.4124, .3576, .1805], [.2126, .7152, .0722], [.0193, .1192, .9505]])
    xyz = c @ M.T / np.array([.95047, 1., 1.08883])
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def kmeans(x, k, it=30, seed=7):
    rng = np.random.default_rng(seed)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(it):
        lab = ((x[:, None] - c[None]) ** 2).sum(-1).argmin(1)
        c = np.stack([x[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
    return c


def bands(cell, anchor_y):
    """Faixas da figura no quadro: cabeça (topo 0-20 %), tronco (25-60 %), pernas (60-90 %)."""
    a = cell[..., 3] >= 128
    ys = np.nonzero(a.any(1))[0]
    top, feet = ys.min(), cell.shape[0] * anchor_y
    h = feet - top
    yy = np.arange(cell.shape[0])[:, None] * np.ones((1, cell.shape[1]))
    rel = (yy - top) / max(1, h)
    return rel


def segment(root, piece, fonte):
    f = piece['files']['idle'] if 'idle' in piece['files'] else piece['files'][next(iter(piece['files']))]
    page = f['pages'][0]
    cell = f['liteCell'] if fonte == 'lite' and f.get('liteCell') else f['cell']
    base = 'public/art/lite/enemies' if fonte == 'lite' and f.get('liteCell') else 'public/art/enemies'
    sheet = np.array(Image.open(f'{root}/{base}/{page["file"]}').convert('RGBA')).astype(float)
    w, h = cell
    px, rel = [], []
    for r in (0, 1, 7, 6, 2):
        c = sheet[r * h:(r + 1) * h, 0:w]
        m = c[..., 3] >= 200
        px.append(c[..., :3][m])
        rel.append(bands(c, f.get('anchor', [.5, .88])[1])[m])
    px, rel = np.concatenate(px), np.concatenate(rel)
    lab = srgb_to_lab(px)
    C = kmeans(lab, 7)
    lbl = ((lab[:, None] - C[None]) ** 2).sum(-1).argmin(1)
    share = lambda j, lo, hi: float(((lbl == j) & (rel >= lo) & (rel < hi)).sum() / max(1, ((rel >= lo) & (rel < hi)).sum()))
    info = []
    for j in range(len(C)):
        L, a, b = C[j]
        hue = float(np.degrees(np.arctan2(b, a)) % 360)
        info.append({'j': j, 'L': round(float(L), 1), 'croma': round(float(np.hypot(a, b)), 1), 'matiz': round(hue, 0),
                     'cabeca': round(share(j, 0, .2), 3), 'tronco': round(share(j, .25, .6), 3), 'pernas': round(share(j, .6, .92), 3),
                     'area': round(float((lbl == j).mean()), 3)})
    # pele: claro e quente (L > 45, matiz 20-80 em Lab), o que mais aparece na cabeça
    skin_c = [i for i in info if i['L'] > 45 and 15 <= i['matiz'] <= 85 and i['croma'] > 12]
    skin = {max(skin_c, key=lambda i: i['cabeca'])['j']} if skin_c else set()
    # pele também nos clusters vizinhos claros e quentes que aparecem na cabeça
    for i in skin_c:
        if i['cabeca'] >= .12:
            skin.add(i['j'])
    # roupa: o que domina tronco e pernas, não é pele, nem preto de contorno/cabelo (L < 18)
    # e aparece bem mais no corpo que na cabeça (a sombra da pele e o cabelo ficam); objeto de cor forte fora do tronco
    # (a catraca do cobrador) também fica
    cloth = {i['j'] for i in info if i['j'] not in skin and i['L'] >= 18 and (i['tronco'] + i['pernas']) >= .12
             and (i['tronco'] + i['pernas']) / (i['cabeca'] + .02) >= 2.2 and not (i['croma'] >= 45 and i['tronco'] < .05)}
    return C, skin, cloth, info


def soft_weights(lab, C, cloth, temp=60.):
    d = ((lab[..., None, :] - C) ** 2).sum(-1)
    w = np.exp(-(d - d.min(-1, keepdims=True)) / temp)
    w /= w.sum(-1, keepdims=True)
    return w[..., sorted(cloth)].sum(-1) if cloth else np.zeros(lab.shape[:-1])


def body_prior(alpha, cell, anchor_y):
    """Por quadro: 0 no contorno (2 px da borda do alfa: o aro da arte fica) e na cabeça (topo 0-28 % da figura: cabeça de boneco é grande),
    subindo até 1 no tronco (34 %)."""
    w, h = cell
    out = np.zeros(alpha.shape)
    solid = alpha >= 250
    er = solid.copy()
    for _ in range(2):
        p = np.pad(er, 1)
        er = er & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    for y0 in range(0, alpha.shape[0] - h + 1, h):
        for x0 in range(0, alpha.shape[1] - w + 1, w):
            a = alpha[y0:y0 + h, x0:x0 + w]
            ys = np.nonzero((a >= 128).any(1))[0]
            if not len(ys):
                continue
            top, feet = ys.min(), h * anchor_y
            rel = (np.arange(h) - top) / max(1, feet - top)
            ramp = np.clip((rel - .28) / .06, 0, 1)
            out[y0:y0 + h, x0:x0 + w] = ramp[:, None]
    return out * er


def recolor(img, C, cloth, mode, accent, cell, anchor_y):
    rgba = img.astype(float)
    rgb = rgba[..., :3]
    lab = srgb_to_lab(rgb)
    wgt = soft_weights(lab, C, cloth) * body_prior(rgba[..., 3], cell, anchor_y)
    lum = rgb[..., 0] * .299 + rgb[..., 1] * .587 + rgb[..., 2] * .114
    ref = np.median(lum[wgt > .5]) if (wgt > .5).any() else 100.
    if mode == 'escuro':
        # tom do terno do grandão (~RGB 40,40,48 no miolo), sombreado preservado em torno dele
        tgt = np.array([42., 42., 50.])
        new = tgt * np.clip(lum / ref, .35, 2.2)[..., None]
    else:
        tgt = np.array(accent, float)
        tl = tgt @ np.array([.299, .587, .114])
        new = tgt * np.clip(lum / ref, .35, 1.9)[..., None] * (min(1.6, 110 / max(1, tl)) if tl > 110 else 1)
    out = rgb * (1 - wgt[..., None]) + np.clip(new, 0, 255) * wgt[..., None]
    rgba[..., :3] = out
    return np.clip(rgba, 0, 255).astype(np.uint8), wgt


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root'); ap.add_argument('id'); ap.add_argument('mode', choices=['escuro', 'cor']); ap.add_argument('out')
    ap.add_argument('--cor', default='#2f6fd6'); ap.add_argument('--fonte', default='lite'); ap.add_argument('--mascara'); ap.add_argument('--roupa', help='grupos da roupa (j,j…), no lugar da escolha automática')
    a = ap.parse_args()
    piece = json.load(open(f'{a.root}/public/art/enemies/manifest.json', encoding='utf8'))['pieces'][a.id]
    C, skin, cloth, info = segment(a.root, piece, a.fonte)
    if a.roupa:
        cloth = {int(j) for j in a.roupa.split(',')}
    accent = [int(a.cor[i:i + 2], 16) for i in (1, 3, 5)]
    print(json.dumps({'id': a.id, 'pele': sorted(skin), 'roupa': sorted(cloth), 'grupos': info}, ensure_ascii=False))
    done = set()
    for name, f in piece['files'].items():
        for page in f['pages']:
            rel = page['file']
            if rel in done:
                continue
            done.add(rel)
            lite = a.fonte == 'lite' and f.get('liteCell')
            src = f'{a.root}/public/art/{"lite/" if lite else ""}enemies/{rel}'
            try:
                img = np.array(Image.open(src).convert('RGBA'))
            except FileNotFoundError:
                continue
            cell = f['liteCell'] if lite else f['cell']
            out, wgt = recolor(img, C, cloth, a.mode, accent, cell, f.get('anchor', [.5, .88])[1])
            import os
            os.makedirs(os.path.dirname(f'{a.out}/{rel}'), exist_ok=True)
            Image.fromarray(out).save(f'{a.out}/{rel}', lossless=True)
            if a.mascara and name == 'idle':
                Image.fromarray((wgt * 255).astype(np.uint8)).save(a.mascara)


if __name__ == '__main__':
    main()

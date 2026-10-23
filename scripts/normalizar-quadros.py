#!/usr/bin/env python3
"""Normaliza a escala de cada quadro de uma folha de animação (card BUG-20261022-ORQ-troca-de-perna).

O gerador de imagem desenha cada pose num tamanho um pouco diferente (e as duas metades de um ciclo em tamanhos
diferentes): o personagem "encolhe e cresce" ao andar. Este script mede, em cada quadro, partes que NÃO mudam com a pose:
  - a cabeça (boné/cabelo incluso): altura do topo até o pescoço e largura máxima acima dele;
  - o tronco: o trecho sob o pescoço (ombros e peito), só onde o tronco do parado encaixa bem (IoU ≥ 0,85): na
    corrida ele gira e inclina e o molde rígido não serve;
encaixando o molde do PARADO da mesma direção em cada quadro (escala 0,6–1,4, IoU de alfa suave, como o proporcao.mjs),
e compara com a mediana da própria folha.
Fator do quadro = mediana(1/cabeça, 1/cabeça, 1/tronco), ou 1/cabeça quando o tronco não encaixa.
Piso: ¾ de pixel da cabeça (a 96 px a cabeça tem ~15 px: 1 px = 7 %); variação de vizinho até 2 pisos.

  --checar   só o relatório; sai com código 1 se algum quadro passar de cabeça ±3 % da MEDIANA da folha (ou tronco ±4 %,
             onde encaixa), se a cabeça mediana da folha passar de ±4 % do parado, se o
             fator variar mais de 2 % de um quadro ao vizinho, ou se a altura mediana dos quadros de apoio passar de ±4 %
             (a altura de um quadro muda com a pose: o joelho dobra no pouso).
  --corrigir <saída.png>   reescala cada quadro para a escala MEDIANA da folha (a escala da folha contra o parado é a da
             montagem, KA/KB: um meio-termo entre cabeça e altura quando o modelo desenhou pernas compridas) pelo seu fator (Lanczos com alfa pré-multiplicado, na resolução da folha:
             rode na folha cheia antes do lite) e reancora: a sola mais baixa fica na mesma linha (o pé de apoio no chão, o
             voo continua no ar) e o centro do tronco no mesmo x; nada a menos de 2 px da borda da célula.
  --antes-depois <png>     folha com as duas versões lado a lado.

Exemplos:
  python scripts/normalizar-quadros.py --id viciado-em-bet --chave run16-SE --checar
  python scripts/normalizar-quadros.py --folha SE.png --celula 192 --parado-id viciado-em-bet --dir SE --corrigir SE-norm.png
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, 'public', 'art', 'sprites')
IDLE8 = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
MIRROR = {'E': 'W', 'NE': 'NW', 'SW': 'SE'}
TOL = {'cabeca_folha': .04, 'cabeca': .03, 'tronco': .04, 'altura': .04, 'vizinho': .02}
SOLID = 128
# the torso enters the factor only when the rest pose's torso fits the frame this well (soft IoU)
TORSO_IOU = .85
# the meter's floor, in px of the head template (a 96 px cell's head is ~15 px tall)
PISO_PX = .75
MARGIN = 2


def cells(img, cell, count):
    cols = img.width // cell
    return [img.crop(((i % cols) * cell, (i // cols) * cell, (i % cols) * cell + cell, (i // cols) * cell + cell)) for i in range(count)]


def longest_run(row, cx):
    """The solid stretch of a row that holds (or is nearest to) column cx: its width, 0 for an empty row."""
    xs = np.nonzero(row)[0]
    if len(xs) == 0:
        return 0
    cuts = np.nonzero(np.diff(xs) > 1)[0]
    starts = np.r_[xs[0], xs[cuts + 1]]
    ends = np.r_[xs[cuts], xs[-1]]
    best, dist = 0, None
    for s, e in zip(starts, ends):
        d = 0 if s <= cx <= e else min(abs(s - cx), abs(e - cx))
        if dist is None or d < dist or (d == dist and e - s + 1 > best):
            best, dist = e - s + 1, d
    return int(best)


def measure(cell_img):
    """Head height/width, torso width, figure height, bottom row and torso centre x of one cell (px of that cell)."""
    a = np.asarray(cell_img.convert('RGBA'))[..., 3] > SOLID
    rows = np.nonzero(a.any(1))[0]
    if len(rows) == 0:
        return None
    top, bot = int(rows[0]), int(rows[-1])
    H = bot - top + 1
    band = a[top + int(H * .45):top + int(H * .6)]
    ys, xs = np.nonzero(band)
    cx = float(xs.mean()) if len(xs) else a.shape[1] / 2
    widths = [longest_run(a[y], cx) for y in range(a.shape[0])]
    lo, hi = top + int(H * .25), top + int(H * .55)
    neck = lo + int(np.argmin(widths[lo:hi])) if hi > lo else top + H // 3
    head_h = neck - top
    head_w = max(widths[top:neck]) if neck > top else 0
    t0, t1 = neck + max(1, int(H * .05)), neck + max(2, int(H * .25))
    torso = float(np.median([w for w in widths[t0:t1] if w > 0])) if t1 > t0 else 0.
    return {'top': top, 'bot': bot, 'H': H, 'cx': cx, 'neck': neck, 'head_h': head_h, 'head_w': head_w, 'torso': torso}


def soft(cell_img):
    return np.asarray(cell_img.convert('RGBA'), dtype=np.float32)[..., 3] / 255


def sample(a, xs, ys):
    """Bilinear sample of a (h×w) at float coordinates (arrays); 0 outside."""
    h, w = a.shape
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    fx, fy = xs - x0, ys - y0
    out = np.zeros(xs.shape, np.float32)
    for dy, wy in ((0, 1 - fy), (1, fy)):
        for dx, wx in ((0, 1 - fx), (1, fx)):
            xx, yy = x0 + dx, y0 + dy
            ok = (xx >= 0) & (yy >= 0) & (xx < w) & (yy < h)
            out[ok] += a[yy[ok], xx[ok]] * (wx * wy)[ok]
    return out


def fit(ref, box, img, anchor, dxs, dys, scales):
    """Best soft-IoU placement of ref[box] (y0, y1, x0, x1) scaled by s on img, its top-centre at anchor + (dx, dy)."""
    y0, y1, x0, x1 = box
    PAD = 3
    best = (-1., 1., 0, 0)
    n = img.shape[0]
    for s in scales:
        tw, th = (x1 - x0 + 1) * s, (y1 - y0 + 1) * s
        W, Hh = int(np.ceil(tw)) + 2 * PAD, int(round(th)) + PAD
        jj, ii = np.mgrid[0:Hh, 0:W].astype(np.float32)
        rx, ry = x0 + (ii - PAD + .5) / s - .5, y0 + (jj - PAD + .5) / s - .5
        t = np.where((rx < x0 - .5) | (rx > x1 + .5) | (ry < y0 - .5) | (ry > y1 + .5), 0, sample(ref, rx, ry))
        pad = np.zeros((n + 2 * (W + Hh + 40), n + 2 * (W + Hh + 40)), np.float32)
        o = W + Hh + 40
        pad[o:o + n, o:o + n] = img
        for dy in dys:
            for dx in dxs:
                ox, oy = int(round(anchor[0] - tw / 2)) - PAD + dx + o, int(anchor[1]) - PAD + dy + o
                b = pad[oy:oy + Hh, ox:ox + W]
                mx = np.maximum(t, b).sum()
                iou = float(np.minimum(t, b).sum() / mx) if mx else 0.
                if iou > best[0]:
                    best = (iou, s, dx, dy)
    return best


def fit_scale(ref, box, img, anchor, coarse=(-8, 8, -4, 3)):
    """Scale (and IoU) of ref[box] on img: coarse 0.6–1.4 by 0.04, then ±0.04 by 0.005 around the best."""
    r = lambda a, b: range(a, b + 1)
    iou, s, dx, dy = fit(ref, box, img, anchor, r(coarse[0], coarse[1]), r(coarse[2], coarse[3]), np.arange(.6, 1.4001, .04))
    iou, s, dx, dy = fit(ref, box, img, anchor, r(dx - 2, dx + 2), r(dy - 2, dy + 2), np.arange(s - .04, s + .0401, .005))
    return s, iou, dx, dy


def rest_boxes(rest_cell):
    """The rest pose's head (cap and hair: top 75 % of the head) and torso (under the neck, the body's columns) boxes."""
    m = measure(rest_cell)
    a = soft(rest_cell) > SOLID / 255
    head_bot = m['top'] + round((m['neck'] - m['top']) * .75)
    cols = np.nonzero(a[m['top']:head_bot + 1].any(0))[0]
    head = (m['top'], head_bot, int(cols[0]), int(cols[-1]))
    t0, t1 = m['neck'] + 1, m['neck'] + max(3, int(m['H'] * .22))
    half = m['torso'] / 2
    torso = (t0, t1, int(round(m['cx'] - half)), int(round(m['cx'] + half)))
    return m, head, torso


def manifest():
    with open(os.path.join(SPRITES, 'manifest.json'), encoding='utf8') as f:
        return json.load(f)


def rest_pose(pid, direction):
    """The rest pose of a class in a direction (its M16 idle16-<dir> first frame, else its R06 idle8 column), 96 px cell."""
    files = manifest()['pieces'][pid]['files']
    d = direction
    for key in (f'idle16-{d}', f'idle16-{MIRROR.get(d, d)}'):
        if key in files:
            f = files[key]
            img = Image.open(os.path.join(SPRITES, f['pages'][0]['file']))
            flip = key.endswith(MIRROR.get(d, '?')) and d in MIRROR
            c = cells(img, f['cell'][0], 1)[0]
            return c.transpose(Image.FLIP_LEFT_RIGHT) if flip else c, f['cell'][0]
    f = files['idle8']
    img = Image.open(os.path.join(SPRITES, f['pages'][0]['file']))
    return cells(img, f['cell'][0], 8)[IDLE8.index(d)], f['cell'][0]


def factors(frames, cells_imgs, rest, rest_cell_px, cell):
    """Per frame: head and torso scale (the rest pose's head/torso fitted on the frame), height ratio and the factor."""
    m0, head, torso = rest_boxes(rest)
    k = cell / rest_cell_px
    ref = soft(rest.resize((cell, cell), Image.LANCZOS)) if k != 1 else soft(rest)
    sc = lambda b: tuple(int(round(v * k)) for v in b)
    head, torso = sc(head), sc(torso)
    out = []
    for m, c in zip(frames, cells_imgs):
        if m is None:
            out.append(None)
            continue
        img = soft(c)
        top = m['top']
        ys, xs = np.nonzero(img[top:top + max(4, int((head[1] - head[0]) * .6))] > .5)
        cx = float(xs.mean()) if len(xs) else cell / 2
        hs, hiou, dx, dy = fit_scale(ref, head, img, (cx, top))
        # the torso: under the fitted head, at the head's centre
        neck_y = top + dy + (torso[0] - head[0]) * hs
        ts, tiou, _, _ = fit_scale(ref, torso, img, (cx + dx, neck_y), coarse=(-10, 10, -6, 6))
        r = {'cabeca': hs, 'cabeca_iou': round(hiou, 3), 'tronco': ts, 'tronco_iou': round(tiou, 3), 'altura': m['H'] / (m0['H'] * k)}
        # the torso changes shape with the pose (twist, lean, arms over it): it counts only where the rest pose's torso
        # fits it well; the head (cap and hair) always does
        r['tronco_confiavel'] = tiou >= TORSO_IOU
        r['fator'] = float(np.median([1 / hs, 1 / hs, 1 / ts])) if r['tronco_confiavel'] else 1 / hs
        r['piso'] = PISO_PX / ((head[1] - head[0] + 1) * hs)
        out.append(r)
    return out


def check(frames, ratios, ground, stance=None):
    """The report lines and whether every frame passes."""
    lines, ok = [], True
    med = float(np.median([r['fator'] for r in ratios if r]))
    tor = [r['tronco'] for r in ratios if r and r['tronco_confiavel']]
    mt = float(np.median(tor)) if tor else 1.
    for i, (m, r) in enumerate(zip(frames, ratios)):
        if r is None:
            lines.append(f'{i:2d}  vazio');ok = False;continue
        flight = (not stance[i]) if stance else m['bot'] < ground - 2
        bad = []
        # each frame against the sheet's own median (the frames among themselves); PISO_PX of the head is the meter's
        # floor: at 96 px a 15 px head reads in steps of ~3 %
        rel = med / r['fator']
        if abs(rel - 1) > max(TOL['cabeca'], r['piso']): bad.append(f"cabeça {rel:.3f} da mediana da folha")
        if r['tronco_confiavel'] and abs(r['tronco'] / mt - 1) > TOL['tronco']: bad.append(f"tronco {r['tronco'] / mt:.3f} da mediana")
        j = (i + 1) % len(ratios)
        if ratios[j] and abs(r['fator'] / ratios[j]['fator'] - 1) > max(TOL['vizinho'], 2 * r['piso']): bad.append(f"fator {r['fator']:.3f}→{ratios[j]['fator']:.3f} no vizinho {j}")
        ok &= not bad
        lines.append(f"{i:2d}  cabeça {r['cabeca']:.3f}  tronco {r['tronco']:.3f}{'' if r['tronco_confiavel'] else ' (não conta)'}  altura {r['altura']:.3f}{' (voo)' if flight else ''}  fator {r['fator']:.3f} (mediana da folha {med:.3f})  {'OK' if not bad else 'FALHA: ' + ', '.join(bad)}")
    # the sheet against the rest pose: its median head ±4 % (scripts/proporcao.mjs's gate; a sheet may sit between its head
    # and its height when the model drew long legs)
    mh = 1 / med
    good = abs(mh - 1) <= TOL['cabeca_folha'] + 1e-6
    ok &= good
    lines.append(f"cabeça mediana da folha {mh:.3f} do parado {'OK' if good else 'FALHA (±4 %)'}")
    # the height changes with the pose (the knee bends on landing): it is gated on the planted poses' median, as in
    # scripts/proporcao.mjs; per frame it is only shown
    hs = [r['altura'] for m, r in zip(frames, ratios) if r and not ((not stance[frames.index(m)]) if stance else m['bot'] < ground - 2)]
    if hs:
        hm = float(np.median(hs))
        floor = 1 / float(np.median([m['H'] for m in frames if m]))
        good = abs(hm - 1) <= max(TOL['altura'], floor) + 1e-6
        ok &= good
        lines.append(f"altura mediana no apoio {hm:.3f} {'OK' if good else 'FALHA (±4 %)'}")
    return lines, ok


def rescale(cell_img, m, k, cell):
    """The cell scaled by k about its sole (bottom row) and torso centre, kept MARGIN px off the edges."""
    if abs(k - 1) < 1e-3:
        return cell_img
    rgba = cell_img.convert('RGBA').convert('RGBa')
    w = max(1, round(cell * k))
    big = rgba.resize((w, w), Image.LANCZOS).convert('RGBA')
    ox, oy = round(m['cx'] - m['cx'] * k), round(m['bot'] - m['bot'] * k)
    out = Image.new('RGBA', (cell, cell), (0, 0, 0, 0))
    out.alpha_composite(big, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
    a = np.asarray(out)[..., 3]
    ys, xs = np.nonzero(a > 20)
    if len(ys) and (xs.min() < MARGIN or ys.min() < MARGIN or xs.max() >= cell - MARGIN or ys.max() >= cell - MARGIN):
        print(f'  aviso: quadro encosta na borda depois de reescalar (k={k:.3f})', file=sys.stderr)
    return out


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--id', help='classe no manifest (com --chave: mede a folha do jogo)')
    p.add_argument('--chave', help='chave do manifest, ex.: run16-SE')
    p.add_argument('--folha', help='PNG/WebP da folha (em vez de --id/--chave)')
    p.add_argument('--celula', type=int, default=96)
    p.add_argument('--quadros', type=int, default=16)
    p.add_argument('--parado-id', help='classe do parado (padrão: --id)')
    p.add_argument('--dir', help='direção do parado (padrão: a da --chave)')
    p.add_argument('--checar', action='store_true')
    p.add_argument('--corrigir', metavar='SAIDA')
    p.add_argument('--antes-depois', metavar='PNG')
    p.add_argument('--json', metavar='SAIDA')
    p.add_argument('--fase', metavar='JSON', help='tabela de fase da folha (phase.json do montar): apoio = v ≠ 0')
    a = p.parse_args()
    stance = None
    if a.id and a.chave:
        f = manifest()['pieces'][a.id]['files'][a.chave]
        # a run's phase table says which poses stand on a planted foot (v ≠ 0): the height counts only there
        if f.get('phase'):
            stance = [any(v) for v in f['phase']['v']]
        a.folha, a.celula, a.quadros = os.path.join(SPRITES, f['pages'][0]['file']), f['cell'][0], f['frames']
        a.dir = a.dir or a.chave.split('-')[-1]
    if a.fase:
        with open(a.fase, encoding='utf8') as ff:
            stance = [any(v) for v in json.load(ff)['v']]
    pid = a.parado_id or a.id
    if not (a.folha and pid and a.dir):
        p.error('use --id e --chave, ou --folha com --parado-id e --dir')
    sheet = Image.open(a.folha).convert('RGBA')
    cs = cells(sheet, a.celula, a.quadros)
    rest, rest_cell = rest_pose(pid, a.dir)
    ref = measure(rest)
    frames = [measure(c) for c in cs]
    ratios = factors(frames, cs, rest, rest_cell, a.celula)
    ground = max(m['bot'] for m in frames if m)
    lines, ok = check(frames, ratios, ground, stance)
    print(f'{os.path.basename(a.folha)}  parado {pid} {a.dir}: cabeça {ref["head_h"]}×{ref["head_w"]} tronco {ref["torso"]:.1f} altura {ref["H"]} (célula {rest_cell})')
    print('\n'.join(lines))
    print('OK' if ok else 'FALHA')
    if a.json:
        with open(a.json, 'w', encoding='utf8', newline='\n') as f:
            json.dump({'folha': a.folha, 'ok': ok, 'quadros': ratios}, f, ensure_ascii=False, indent=1)
    if a.corrigir:
        # the head fit reads big changes short (0.854 reads 0.89): iterate, composing each frame's factor from the
        # original drawing, until every frame's head is within the tolerance (4 passes at most)
        # every frame to the sheet's median scale (the sheet's scale against the rest pose is the montage's KA/KB)
        med = float(np.median([r['fator'] for r in ratios if r]))
        # only the frames off the median (beyond half the tolerance): the others stay as drawn
        off = lambda r: r is not None and abs(r['fator'] / med - 1) > max(TOL['cabeca'], r['piso']) / 2
        k = [r['fator'] / med if off(r) else 1. for r in ratios]
        for _ in range(4):
            fixed = [rescale(c, m, kk, a.celula) if m else c for c, m, kk in zip(cs, frames, k)]
            frames2 = [measure(c) for c in fixed]
            r2 = factors(frames2, fixed, rest, rest_cell, a.celula)
            if all(r is None or abs(r['cabeca'] * med - 1) <= max(TOL['cabeca'], r['piso']) / 2 for r in r2):
                break
            k = [kk * (r['fator'] / med if off(r) else 1.) for kk, r in zip(k, r2)]
        out = Image.new('RGBA', sheet.size, (0, 0, 0, 0))
        cols = sheet.width // a.celula
        for i, c in enumerate(fixed):
            out.paste(c, ((i % cols) * a.celula, (i // cols) * a.celula))
        out.save(a.corrigir)
        lines2, ok2 = check(frames2, factors(frames2, fixed, rest, rest_cell, a.celula), max(m['bot'] for m in frames2 if m), stance)
        print('depois de corrigir:');print('\n'.join(lines2));print('OK' if ok2 else 'FALHA')
        if a.antes_depois:
            S = a.celula
            sheet2 = Image.new('RGBA', (S * a.quadros, S * 2), (239, 233, 216, 255))
            for i, (c0, c1) in enumerate(zip(cs, fixed)):
                sheet2.alpha_composite(c0, (i * S, 0))
                sheet2.alpha_composite(c1, (i * S, S))
            sheet2.save(a.antes_depois)
        ok = ok2
    if a.checar and not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()

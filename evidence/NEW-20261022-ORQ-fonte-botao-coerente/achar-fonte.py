"""Achador de fonte local: compara "ESSE SOU EU!" da arte gerada com as fontes candidatas.

Letra a letra (o espaçamento o CSS acerta depois): cada glifo da referência e da fonte é
normalizado para a mesma altura, mantendo a proporção, e pontuado por IoU da silhueta,
chamfer do contorno e diferença de largura relativa.

uso: python -I achar-fonte.py <tela-1080p.png> <pasta-fontes> <pasta-saida>
"""
import json, sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CAIXA = (260, 860, 770, 990)  # recorte do texto do botão na tela 1920x1080
LETRAS = "ESSESOUEU!"
H = 120  # altura normalizada de cada glifo
LADO = 200  # tela onde o glifo é centrado


def binariza_ref(png):
    rgb = np.asarray(Image.open(png).convert("RGB").crop(CAIXA)).astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    tinta = ((r + g) < 260) & (b > r - 10)  # roxo escuro sobre amarelo
    m = tinta.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return m


def endireita(m):
    """Ângulo que deixa a base reta: maximiza a nitidez da projeção horizontal."""
    melhor = (-1, 0.0)
    h, w = m.shape
    for a in np.arange(-8, 8.01, 0.25):
        M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1)
        rot = cv2.warpAffine(m, M, (w, h))
        p = rot.sum(1).astype(np.float64)
        s = (np.diff(p) ** 2).sum()
        if s > melhor[0]:
            melhor = (s, a)
    a = melhor[1]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), a, 1)
    return (cv2.warpAffine(m, M, (w, h)) > 127).astype(np.uint8) * 255, a


def glifos_ref(m):
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    comps = [st[i] for i in range(1, n) if st[i][cv2.CC_STAT_AREA] > 30]
    comps.sort(key=lambda s: s[0])
    grupos = []  # junta componentes que se sobrepõem em x (o "!")
    for s in comps:
        x0, x1 = s[0], s[0] + s[2]
        if grupos and x0 < grupos[-1][1] - 2:
            grupos[-1][1] = max(grupos[-1][1], x1)
        else:
            grupos.append([x0, x1])
    assert len(grupos) == len(LETRAS), f"esperava {len(LETRAS)} glifos, achei {len(grupos)}"
    out = []
    for x0, x1 in grupos:
        col = m[:, x0:x1]
        ys = np.where(col.any(1))[0]
        out.append(col[ys[0] : ys[-1] + 1])
    return out


def glifo_fonte(ttf, ch):
    f = ImageFont.truetype(str(ttf), 300)
    im = Image.new("L", (500, 500), 0)
    ImageDraw.Draw(im).text((80, 50), ch, font=f, fill=255)
    a = np.asarray(im)
    ys, xs = np.where(a > 127)
    return (a[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1] > 127).astype(np.uint8) * 255


def normaliza(g, altura_ref):
    """Escala pela altura da caixa-alta (o glifo mantém a proporção) e centra numa tela fixa."""
    k = H / altura_ref
    h, w = g.shape
    nw, nh = max(1, round(w * k)), max(1, round(h * k))
    r = cv2.resize(g, (nw, nh), interpolation=cv2.INTER_AREA) > 127
    tela = np.zeros((LADO, LADO * 2), np.uint8)
    oy, ox = (LADO - nh) // 2, (LADO * 2 - nw) // 2
    tela[max(0, oy) : max(0, oy) + nh, max(0, ox) : max(0, ox) + nw] = r[: LADO, : LADO * 2]
    return tela


def contorno(t):
    return cv2.Canny(t * 255, 50, 150) > 0


def chamfer(a, b):
    ea, eb = contorno(a), contorno(b)
    if not ea.any() or not eb.any():
        return 99.0
    da = cv2.distanceTransform((~ea).astype(np.uint8), cv2.DIST_L2, 3)
    db = cv2.distanceTransform((~eb).astype(np.uint8), cv2.DIST_L2, 3)
    return (db[ea].mean() + da[eb].mean()) / 2


def compara(ref_g, ttf):
    altura_ref = np.median([g.shape[0] for g, c in zip(ref_g, LETRAS) if c != "!"])
    ious, chs, larg = [], [], []
    fg = {c: glifo_fonte(ttf, c) for c in set(LETRAS)}
    altura_f = np.median([fg[c].shape[0] for c in "ESOU"])
    for g, c in zip(ref_g, LETRAS):
        a = normaliza(g, altura_ref)
        b = normaliza(fg[c], altura_f)
        inter, uni = (a & b).sum(), (a | b).sum()
        ious.append(inter / uni)
        chs.append(chamfer(a, b))
        larg.append(abs(np.log((fg[c].shape[1] / altura_f) / (g.shape[1] / altura_ref))))
    iou, ch, lw = float(np.mean(ious)), float(np.mean(chs)), float(np.mean(larg))
    nota = 100 * (0.6 * iou + 0.25 * max(0, 1 - ch / 10) + 0.15 * max(0, 1 - lw / 0.5))
    return {"nota": round(nota, 1), "iou": round(iou, 3), "chamfer": round(ch, 2), "largura": round(lw, 3)}


def main(png, pasta, saida):
    pasta, saida = Path(pasta), Path(saida)
    m = binariza_ref(png)
    m, ang = endireita(m)
    Image.fromarray(m).save(saida / "ref-binaria.png")
    ref_g = glifos_ref(m)
    lista = json.loads((pasta / "lista.json").read_text(encoding="utf-8"))
    res = []
    for f in lista:
        r = compara(ref_g, pasta / f["arquivo"])
        res.append({**f, **r})
    res.sort(key=lambda r: -r["nota"])
    (saida / "ranking.json").write_text(json.dumps({"inclinacao_ref_graus": ang, "ranking": res}, indent=1), encoding="utf-8")
    print(f"inclinação da referência: {ang:+.2f}°")
    for i, r in enumerate(res, 1):
        print(f"{i:2d}. {r['familia']:<16} {r['peso']}  nota {r['nota']:5.1f}  IoU {r['iou']:.3f}  chamfer {r['chamfer']:5.2f}  largura {r['largura']:.3f}")


if __name__ == "__main__":
    main(*sys.argv[1:4])

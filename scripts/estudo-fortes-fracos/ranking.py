# Ranking fortes x fracos (card NEW-20261023-ORQ-inimigos-fortes-x-fracos) a partir de medir.py, e a folha com o
# elenco inteiro na escala do PC (folha lite ampliada com filtro linear sobre a neve, como o jogo desenha hoje).
#   python -I ranking.py <checkout> <medidas.json> <saida-dir>
# Nota (0..100) = média ponderada dos percentis no elenco:
#   leitura (bloco escuro − área marrom/pele) ×2, contraste com a neve ×1, silhueta única (1 − IoU com o mais parecido) ×1,
#   altura na tela ×1. A nitidez é medida e mostrada, mas não entra: não separa os fortes dos fracos (ver ranking.md).
import sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
sys.path.insert(0, __file__.rsplit('/', 1)[0].rsplit('\\', 1)[0])
from medir import NEVE, cells, to_screen, over, STILL  # noqa: E402

FORTES = ('seguranca-de-shopping', 'motoboy')
FRACOS = ('bebado', 'agiota', 'tio-pave', 'cobrador-do-busao')
PESOS = {'leitura': 2, 'contraste': 1, 'unica': 1, 'altura': 1}


def feats(r):
    f = r['fatias']
    return {'leitura': f.get('escuro', 0) - f.get('h0', 0), 'contraste': r['pc']['contraste_neve'], 'unica': 1 - r['parecido_iou'],
            'altura': r['pc']['altura_px'], 'nitidez': r['pc']['lap'], 'escuro': f.get('escuro', 0), 'marrom': f.get('h0', 0)}


def score(rows):
    F = {r['id']: feats(r) for r in rows}
    ids = list(F)
    pct = {}
    for k in PESOS:
        v = np.array([F[i][k] for i in ids])
        order = v.argsort().argsort()
        ties = {x: np.mean(order[v == x]) for x in np.unique(v)}
        for i, x in zip(ids, v):
            pct.setdefault(i, {})[k] = ties[x] / max(1, len(ids) - 1)
    total = sum(PESOS.values())
    return {i: round(100 * sum(PESOS[k] * pct[i][k] for k in PESOS) / total, 1) for i in ids}, F


def sprite(root, pid, k_height):
    pieces = json.load(open(f'{root}/public/art/enemies/manifest.json', encoding='utf8'))['pieces']
    p = pieces[pid]
    anim = next(a for a in STILL if a in p['files'])
    f = p['files'][anim]
    page = f['pages'][0]
    lc = f.get('liteCell')
    path = f'{root}/public/art/lite/enemies/{page["file"]}' if lc else f'{root}/public/art/enemies/{page["file"]}'
    sheet = np.array(Image.open(path).convert('RGBA'))
    c = cells(sheet, lc or f['cell'], page['columns'], f['directions'])[1][0]  # SW: de frente, como na cena do estudo
    a = c[..., 3] >= 128
    ys = np.nonzero(a.any(1))[0]
    drawn = c.shape[0] * f.get('anchor', [.5, .88])[1] - ys.min()
    pm = to_screen(c, k_height / drawn)
    rgb, al = over(pm, NEVE)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)), al


def folha(root, rows, notas, F, dest, cols=14):
    order = sorted(rows, key=lambda r: -notas[r['id']])
    tw, th = 96, 150
    W, H = cols * tw, ((len(order) + cols - 1) // cols) * th + 30
    im = Image.new('RGB', (W, H), tuple(int(x) for x in NEVE))
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('arial.ttf', 10)
        big = ImageFont.truetype('arialbd.ttf', 14)
    except OSError:
        font = big = ImageFont.load_default()
    d.text((6, 6), 'Elenco na escala do PC 1280 (herói 87 px), folha de hoje, ordenado pela nota. Verde = forte de referência, vermelho = fraco citado.', fill=(30, 30, 40), font=big)
    for n, r in enumerate(order):
        x, y = (n % cols) * tw, 30 + (n // cols) * th
        alt = r['pc']['altura_px']
        fit = min(1., (th - 40) / (alt * 1.15))  # chefes e mini-chefes: reduzidos para caber, marcados com ÷
        spr, _ = sprite(root, r['id'], alt * fit)
        if fit < 1:
            d.text((x + tw - 30, y + 2), f'÷{1 / fit:.1f}', fill=(120, 60, 0), font=font)
        sx = x + (tw - spr.width) // 2
        sy = y + th - 34 - spr.height + int(spr.height * .12)
        crop = spr.crop((max(0, -sx + x), max(0, y - sy), spr.width, spr.height))
        im.paste(crop, (max(sx, x), max(sy, y)))
        cor = (20, 140, 60) if r['id'] in FORTES else (200, 40, 40) if r['id'] in FRACOS else (40, 40, 50)
        if r['id'] in FORTES or r['id'] in FRACOS:
            d.rectangle((x + 1, y + 1, x + tw - 2, y + th - 2), outline=cor, width=2)
        f = F[r['id']]
        d.text((x + 3, y + th - 33), f'{n + 1}. {r["id"][:15]}', fill=cor, font=font)
        d.text((x + 3, y + th - 21), f'nota {notas[r["id"]]:.0f} · lê {f["leitura"]:+.2f}', fill=cor, font=font)
        d.text((x + 3, y + th - 10), f'esc {f["escuro"]:.2f} mar {f["marrom"]:.2f}', fill=(90, 90, 100), font=font)
    im.save(dest)


def main():
    root, med, out = sys.argv[1:4]
    rows = json.load(open(med, encoding='utf8'))
    notas, F = score(rows)
    order = sorted(rows, key=lambda r: -notas[r['id']])
    json.dump([{'pos': n + 1, 'id': r['id'], 'nota': notas[r['id']], **{k: round(v, 3) for k, v in F[r['id']].items()}, 'papel': r['papel'],
                'parecido_com': r['parecido_com'], 'destaque_rgb': r['destaque_rgb'], 'halo': r['halo']} for n, r in enumerate(order)],
              open(f'{out}/ranking.json', 'w', encoding='utf8', newline='\n'), ensure_ascii=False, indent=1)
    folha(root, rows, notas, F, f'{out}/folha-ranking.png')
    for n, r in enumerate(order):
        if r['id'] in FORTES + FRACOS:
            print(n + 1, r['id'], notas[r['id']])


if __name__ == '__main__':
    main()

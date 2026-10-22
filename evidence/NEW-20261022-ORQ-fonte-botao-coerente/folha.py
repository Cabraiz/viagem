"""Monta folha.html: a referência e o top 5 do ranking, cada fonte no texto da arte e no botão SELECIONAR
(mesma arte 9-slice e as mesmas regras de .estadio-confirmar do PC 1080p: --bh 108px, 640px, rotate -2deg).

uso: python -I folha.py <pasta-evidencia> <pasta-fontes> <raiz-do-repo> [n=5]
"""
import json, sys
from pathlib import Path

from fontTools.ttLib import TTFont


def caps(ttf):
    """Altura medida do "E" por em (o sCapHeight de algumas fontes vem errado)."""
    f = TTFont(ttf)
    gs = f.getGlyphSet()
    from fontTools.pens.boundsPen import BoundsPen
    pen = BoundsPen(gs)
    gs[f.getBestCmap()[ord("E")]].draw(pen)
    return (pen.bounds[3] - pen.bounds[1]) / f["head"].unitsPerEm


def main(ev, fontes, raiz, n=5):
    ev, fontes, raiz = Path(ev), Path(fontes), Path(raiz)
    rank = json.loads((ev / "ranking.json").read_text(encoding="utf-8"))["ranking"]
    top = rank[: int(n)]
    if not any(r["familia"] == "Londrina Solid" for r in top):
        top.append(next(r for r in rank if r["familia"] == "Londrina Solid"))  # a atual, para comparar
    botao = (raiz / "public/art/menu/botao").as_uri()
    faces, linhas = [], []
    for i, r in enumerate(top):
        fam = f"cand{i}"
        ttf = fontes / r["arquivo"]
        faces.append(f"@font-face{{font-family:{fam};src:url('{ttf.as_uri()}');font-weight:100 900}}")
        tam = 60 / caps(ttf)  # caixa-alta de 60 px, como "ESSE SOU EU!" na tela 1080p
        pos = rank.index(r) + 1
        atual = " (a atual)" if r["familia"] == "Londrina Solid" else ""
        linhas.append(f"""
<section>
 <h2>{pos}º {r['familia']} {r['peso']}{atual} <small>nota {r['nota']} · IoU {r['iou']} · chamfer {r['chamfer']} · largura {r['largura']}</small></h2>
 <div class="par">
  <div class="arte"><img src="ref-crop.png"></div>
  <div class="arte amarelo"><span style="font-family:{fam};font-weight:{r['peso']};font-size:{tam:.1f}px">ESSE SOU EU!</span></div>
 </div>
 <div class="par">
  <button class="b" style="--f:{fam};--w:{r['peso']}"><span aria-hidden="true">★</span><span class="t">SELECIONAR</span></button>
  <div class="zoom"><button class="b" style="--f:{fam};--w:{r['peso']}"><span aria-hidden="true">★</span><span class="t">SELECIONAR</span></button></div>
 </div>
</section>""")
    html = f"""<!doctype html><meta charset="utf-8"><style>
{chr(10).join(faces)}
body{{margin:0;padding:24px;background:#2b2140;color:#fff;font:16px system-ui;width:2560px}}
h1{{margin:0 0 12px}} h2{{margin:18px 0 8px;font-size:26px}} small{{font-size:16px;opacity:.75;font-weight:400}}
.par{{display:flex;gap:24px;align-items:center;margin-bottom:10px}}
.arte{{width:510px;height:130px;overflow:hidden;border-radius:8px}}
.amarelo{{background:#fbd31a;display:flex;align-items:center;justify-content:center}}
.amarelo span{{white-space:nowrap;color:#2a0f55;rotate:-2.5deg;line-height:1}}
.b{{--bh:108px;display:flex;align-items:center;width:640px;height:var(--bh);padding:0 calc(var(--bh)*.345) calc(var(--bh)*.048) calc(var(--bh)*.5);
 border:0 solid transparent;background:none;border-image:url('{botao}/pilula.webp') 0 130 fill / 0 calc(var(--bh)*.872) stretch;container-type:inline-size;
 color:color-mix(in srgb,#5E2F86 35%,#1E1530);font:var(--w) calc(var(--bh)*.54)/1 var(--f);white-space:nowrap;cursor:pointer}}
.b>span{{padding:0}}
.b>span[aria-hidden]{{flex:none;width:calc(var(--bh)*.623);height:calc(var(--bh)*.587);overflow:hidden;color:transparent;background:url('{botao}/estrela.webp') 50% 50%/contain no-repeat}}
.b .t{{flex:1;min-width:0;text-align:center;translate:0 calc(var(--bh)*-.064);rotate:-2deg;font-size:min(calc(var(--bh)*.54),calc((100cqi - var(--bh)*.924)/5))}}
.b::after{{content:'';flex:none;width:calc(var(--bh)*.301);height:calc(var(--bh)*.445);translate:0 calc(var(--bh)*-.055);background:url('{botao}/icone-direita.webp') 50% 50%/contain no-repeat}}
.zoom{{zoom:2}}
</style>
<h1>Fonte do botão: referência (tela-1080p, "ESSE SOU EU!") × top {n} do achador · botão em 1080p e em zoom 200%</h1>
{''.join(linhas)}
"""
    (ev / "folha.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:])

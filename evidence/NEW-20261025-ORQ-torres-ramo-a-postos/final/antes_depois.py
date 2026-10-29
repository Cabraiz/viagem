# Antes (print do usuário) × depois (jogo, foco=torre), uma linha por torre, mesma altura.
import sys
from PIL import Image, ImageDraw
S, U, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
PARES = [('Guarita', 'usuario-guarita', 'vigia-do-predio', (400, 100, 900, 600)), ('Andaime', 'usuario-andaime', 'atiradores-do-telhado', (400, 120, 900, 520)), ('Trincheira', 'usuario-trincheira', 'guarnicao-do-predio', (420, 120, 860, 520))]
H = 420
rows = []
for nome, antes, id, box in PARES:
    a = Image.open(f'{U}/{antes}.png').convert('RGB'); a = a.resize((round(a.width * H / a.height), H), Image.NEAREST)
    d = Image.open(f'{S}/depois-{id}-idle.png').convert('RGB').crop(box); d = d.resize((round(d.width * H / d.height), H), Image.LANCZOS)
    r = Image.new('RGB', (a.width + d.width + 30, H + 30), (40, 40, 40)); dr = ImageDraw.Draw(r)
    r.paste(a, (0, 30)); r.paste(d, (a.width + 30, 30))
    dr.text((6, 8), f'{nome}: ANTES (print do usuario)', fill='white'); dr.text((a.width + 36, 8), f'{nome}: DEPOIS (jogo, foco=torre, parado; escala ~3x ainda)', fill='white')
    rows.append(r)
W = max(r.width for r in rows); out = Image.new('RGB', (W, sum(r.height for r in rows)), (40, 40, 40)); y = 0
for r in rows: out.paste(r, (0, y)); y += r.height
out.save(OUT)

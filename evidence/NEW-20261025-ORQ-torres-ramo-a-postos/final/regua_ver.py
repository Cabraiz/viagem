# Etapa 2b: the 7 crews' S pose 0 side by side at game scale (as imported) with the hero, on grey, a ruler every 10 % of HERO_PX.
import json, sys
from PIL import Image, ImageDraw
from lib import HERO_PX
IDS = ['vigia-do-predio', 'vigias-armados', 'atiradores-do-telhado', 'ninho-de-metralhadora', 'guarnicao-do-predio', 'ninho-do-sniper', 'equipe-antimaterial']
NAMES = ['Guarita', 'Mirante', 'Andaime', 'Ninho', 'Trincheira', 'Tocaia', 'Casamata']
src = sys.argv[1] if len(sys.argv) > 1 and __name__ == "__main__" else "saida/torres"
out = sys.argv[2] if len(sys.argv) > 2 and __name__ == "__main__" else "regua-ver.png"
row = int(sys.argv[3]) if len(sys.argv) > 3 and __name__ == "__main__" else 0
if __name__ == "__main__":
    cells = []
    hero = Image.open('refs/hero.png').convert('RGBA') if __import__('os').path.exists('refs/hero.png') else None
    for i in IDS:
        m = json.load(open(f'{src}/{i}/meta.json')); cw, ch = m['cell']
        sh = Image.open(f'{src}/{i}/idle.png').convert('RGBA')
        cells.append(sh.crop((0, row * ch, cw, row * ch + ch)))
    W = sum(c.width for c in cells) + 200
    H = 300
    img = Image.new('RGBA', (W, H), (150, 150, 150, 255))
    d = ImageDraw.Draw(img)
    AY = 220 + 20
    for k in range(0, 13):
        y = AY - k * HERO_PX / 10
        d.line((0, y, W, y), fill=(120, 120, 120, 255) if k % 5 else (60, 60, 200, 255))
    x = 0
    if hero:
        img.alpha_composite(hero, (x + 100 - hero.width // 2, AY - hero.height)); d.text((x + 4, 4), 'heroi', fill=(255, 255, 0, 255))
    x = 200
    for c, n in zip(cells, NAMES):
        img.alpha_composite(c, (x, 20)); d.text((x + 4, 4), n, fill=(255, 255, 0, 255)); x += c.width
    img.save(out)

# crew-<id>/meio.png (5 columns S, SW, W, NW, N) -> crew-<id>/dir-<DIR>.png, the refs of the anim jobs (<= 768 px).
import sys
from PIL import Image
sys.path.insert(0, __file__.rsplit('/', 1)[0] if '/' in __file__ else '.')
from lib import grid
d = sys.argv[1]
im = Image.open(f'{d}/meio.png').convert('RGB')
for name, c in zip(['S', 'SW', 'W', 'NW', 'N'], grid(im, 5, 1)[0]):
    c.thumbnail((768, 768)); c.save(f'{d}/dir-{name}.png'); print(name, c.size)

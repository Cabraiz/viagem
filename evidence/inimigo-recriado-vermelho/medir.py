"""Proportions of an enemy's rest pose (idle frame 0, S/SE/N rows), the hero gate's headBox ported (scripts/proporcao-herois.mjs).
python medir.py <id> [<id>...]   (public/art/enemies/<id>/idle.webp, rows S,SW,W,NW,N,NE,E,SE)"""
import sys,json,statistics as st
from PIL import Image
ROWS=['S','SW','W','NW','N','NE','E','SE'];SOLID=128
def headbox(im):
  n=im.width;a=im.getchannel('A').load();seg=[0]*im.height;top=bot=-1
  for y in range(im.height):
    run=best=0
    for x in range(n):
      if a[x,y]>SOLID:run+=1;best=max(best,run)
      else:run=0
    seg[y]=best
    if best:
      if top<0:top=y
      bot=y
  if top<0:return None
  H=bot-top+1;lo=top+round(H*.22);hi=top+round(H*.45);mn=min(seg[lo:hi+1]);chin=max(y for y in range(lo,hi+1) if seg[y]<=mn+2)
  head=max(seg[top:chin]);sh=max(seg[chin+1:min(bot,chin+round(H*.25))+1])
  return dict(H=H,cab=chin-top,cabAlt=round((chin-top)/H,3),cabW=head,ombro=sh,cabOmbro=round(head/sh,3),top=top,bot=bot)
def measure(path,cols=None):
  im=Image.open(path).convert('RGBA');m=json.load(open('public/art/manifest.json'))
  return im
if __name__=='__main__':
  man=json.load(open('public/art/manifest.json'))
  for id in sys.argv[1:]:
    f=man['groups']['inimigos']['pieces'][id]['files']['idle'];c=f['cell'][0];cols=f['pages'][0]['columns']
    im=Image.open('public/art/enemies/'+f['file']).convert('RGBA');out={}
    for d in ['S','SE','N','E']:
      r=ROWS.index(d);out[d]=headbox(im.crop((0,r*c,c,r*c+c)))
    print(id,'cell',c,{d:(v['H'],v['cabAlt'],v['cabOmbro']) for d,v in out.items()},'feet',out['S']['bot']/c)

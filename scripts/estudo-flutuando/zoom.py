# Grade de recortes ampliados (nearest) com rótulo: python -I zoom.py <saida> <x,y,w,h> <zoom> <colunas> rotulo=arquivo ...
import sys
from PIL import Image,ImageDraw,ImageFont
out,crop,z,cols,*items=sys.argv[1:];x,y,w,h=map(int,crop.split(','));z=int(z);cols=int(cols)
font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',20)
rows=(len(items)+cols-1)//cols;W,H=w*z,h*z+30
s=Image.new('RGB',(cols*(W+8)+8,rows*(H+8)+8),(24,22,34));d=ImageDraw.Draw(s)
for i,it in enumerate(items):
    lab,p=it.rsplit('=',1);ox=8+(i%cols)*(W+8);oy=8+(i//cols)*(H+8)
    d.text((ox+4,oy+4),lab,font=font,fill=(245,235,200))
    s.paste(Image.open(p).convert('RGB').crop((x,y,x+w,y+h)).resize((W,h*z),Image.NEAREST),(ox,oy+30))
s.save(out);print(out,s.size)

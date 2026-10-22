# Folha numerada do estudo: para cada variante, a tela inteira reduzida + o grupo a 200 % (nearest), com o rótulo.
#   python -I folha.py <saida.png> <crop x,y,w,h> <rotulo=arquivo.png> ...
import sys
from PIL import Image,ImageDraw,ImageFont
out,crop,*items=sys.argv[1:];x,y,w,h=map(int,crop.split(','))
font=ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf',22);small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
Z=2;tw=int(1280*h*Z/720);cell_w=w*Z+tw+12;cell_h=h*Z+40
cols=2 if len(items)>3 else 1;rows=(len(items)+cols-1)//cols
sheet=Image.new('RGB',(cols*cell_w+12,rows*cell_h+12),(24,22,34));d=ImageDraw.Draw(sheet)
for i,it in enumerate(items):
    label,path=it.split('=',1);im=Image.open(path).convert('RGB')
    ox=12+(i%cols)*cell_w;oy=12+(i//cols)*cell_h
    d.text((ox,oy),label,font=font,fill=(245,235,200))
    z=im.crop((x,y,x+w,y+h)).resize((w*Z,h*Z),Image.NEAREST);sheet.paste(z,(ox,oy+32))
    t=im.resize((tw,h*Z),Image.LANCZOS);sheet.paste(t,(ox+w*Z+6,oy+32))
    k=tw/1280;d.rectangle([ox+w*Z+6+x*k,oy+32+y*k,ox+w*Z+6+(x+w)*k,oy+32+(y+h)*k],outline=(255,200,0),width=2)
sheet.save(out);print(out,sheet.size)

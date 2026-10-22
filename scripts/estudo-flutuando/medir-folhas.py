# Mesmas medidas do medir.py, nas folhas (quadro 0 de cada direção do idle, alfa >= 128), para o elenco inteiro.
#   python -I medir-folhas.py <public/art> [dir-processada]
import sys,json,os
import numpy as np
from PIL import Image
L=lambda a:a[...,0]*.299+a[...,1]*.587+a[...,2]*.114
root=sys.argv[1];alt=sys.argv[2] if len(sys.argv)>2 else None
man=json.load(open(os.path.join(root,'manifest.json'),encoding='utf-8'))['groups']['inimigos']['pieces']
rows=[]
IDS=os.environ.get('IDS','').split(',') if os.environ.get('IDS') else None
for id,p in man.items():
    if IDS and id not in IDS:continue
    f=p['files'].get('idle') or p['files'].get('walk')
    if not f or 'liteCell' not in f:continue
    page=(f.get('pages') or [{'file':f['file'],'columns':1}])[0];cw,ch=f['liteCell']
    src=os.path.join(alt,page['file']) if alt else os.path.join(root,'lite/enemies',page['file'])
    if not os.path.exists(src):continue
    im=np.array(Image.open(src).convert('RGBA')).astype(float);cols=page['columns'];fr=f.get('frames',1)
    st=[]
    for d in range(f.get('directions',1)):
        i=d*fr;cx,cy=(i%cols)*cw,(i//cols)*ch;cell=im[cy:cy+ch,cx:cx+cw];m=cell[...,3]>=128
        if m.sum()<50:continue
        ys,xs=np.nonzero(m);top,bot,left,right=ys.min(),ys.max(),xs.min(),xs.max();H=bot-top+1;W=right-left+1
        lum=L(cell[...,:3])[m]
        sel=lambda c:lum[c].mean()
        st.append([lum.std()/max(1,lum.mean()),sel(ys>bot-.25*H)/sel(ys<top+.3*H),sel(xs>right-.4*W)/sel(xs<left+.4*W),lum.mean()])
    if st:rows.append((id,*np.mean(st,0)))
a=np.array([r[1:] for r in rows])
print(json.dumps({'inimigos':len(rows),'contraste_cv_mediana':round(float(np.median(a[:,0])),3),'pes/cabeca_mediana':round(float(np.median(a[:,1])),3),
  'pes/cabeca_p10_p90':[round(float(np.percentile(a[:,1],10)),3),round(float(np.percentile(a[:,1],90)),3)],
  'escuro/claro_mediana':round(float(np.median(a[:,2])),3),'luma_mediana':round(float(np.median(a[:,3])),1)},ensure_ascii=False))

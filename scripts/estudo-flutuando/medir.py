# Medidas do estudo inimigos-flutuando (card NEW-20261022-ORQ-estudo-inimigos-flutuando).
# Por figura: luma lado claro (esq.) x escuro (dir.), cabeça (30 % de cima) x pés (25 % de baixo), contraste interno,
# figura x chão, e a sombra (chão logo abaixo/à direita dos pés x chão longe).
#   python -I medir.py myth <ref.png>
#   python -I medir.py nosso <com.png> <sem-sombra.png> <vazio.png>   (mesma cena: completa, sem sombras, sem inimigos)
import sys,json
import numpy as np
from PIL import Image
L=lambda a:a[...,0]*.299+a[...,1]*.587+a[...,2]*.114
def comps(mask,minpx):
    from collections import deque
    h,w=mask.shape;lab=np.zeros((h,w),int);n=0;out=[]
    for y in range(h):
        for x in range(w):
            if mask[y,x] and not lab[y,x]:
                n+=1;q=deque([(y,x)]);lab[y,x]=n;px=[]
                while q:
                    cy,cx=q.popleft();px.append((cy,cx))
                    for dy,dx in((1,0),(-1,0),(0,1),(0,-1)):
                        ny,nx=cy+dy,cx+dx
                        if 0<=ny<h and 0<=nx<w and mask[ny,nx] and not lab[ny,nx]:lab[ny,nx]=n;q.append((ny,nx))
                if len(px)>=minpx:out.append(np.array(px))
    return out
def figura(img,px,ground_lum,shadow_mask=None):
    ys,xs=px[:,0],px[:,1];top,bot,left,right=ys.min(),ys.max(),xs.min(),xs.max();H=bot-top+1;W=right-left+1
    lum=L(img[ys,xs])
    def sel(c):return lum[c].mean() if c.any() else float('nan')
    lado_claro=sel(xs<left+.4*W);lado_escuro=sel(xs>right-.4*W)
    cabeca=sel(ys<top+.3*H);pes=sel(ys>bot-.25*H)
    r={'caixa':[int(left),int(top),int(W),int(H)],'luma':round(lum.mean(),1),'contraste_std':round(lum.std(),1),
       'lado_claro':round(lado_claro,1),'lado_escuro':round(lado_escuro,1),'escuro/claro':round(lado_escuro/lado_claro,3),
       'cabeca':round(cabeca,1),'pes':round(pes,1),'pes/cabeca':round(pes/cabeca,3),'figura/chao':round(lum.mean()/ground_lum,3),
       'sat':round(float(np.mean(img[ys,xs].max(-1)-img[ys,xs].min(-1))),1)}
    return r
if __name__=='__main__':
    mode=sys.argv[1]
    if mode=='myth':
        im=np.array(Image.open(sys.argv[2]).convert('RGB')).astype(float)
        r,g,b=im[...,0],im[...,1],im[...,2];ground=(g>r*1.08)&(g>b*1.2)
        gl=L(im[ground]).mean()
        figs=[c for c in comps(~ground,300) if 40<c[:,1].mean()<290 and c[:,0].mean()>40]
        out=[]
        for c in sorted(figs,key=lambda c:c[:,1].mean()):
            f=figura(im,c,gl)
            # sombra: chão (verde) numa faixa de 6 px abaixo dos pés e 0..+60 % da largura à direita x chão longe
            x,y,W,H=f['caixa'];band=np.zeros(ground.shape,bool);band[y+H-int(.12*H):y+H+6,x:x+W+int(.6*W)]=True
            near=ground&band;f['sombra_chao']=round(L(im[near]).mean(),1);f['sombra/chao']=round(L(im[near]).mean()/gl,3)
            out.append(f)
        print(json.dumps({'chao_luma':round(gl,1),'figuras':out},ensure_ascii=False,indent=1))
    else:
        full,nosh,empty=[np.array(Image.open(p).convert('RGB')).astype(float) for p in sys.argv[2:5]]
        fig=np.abs(nosh-empty).sum(-1)>40
        sh=(np.abs(full-nosh).sum(-1)>12)&~fig
        gl=L(empty[~fig&~sh]).mean()
        out=[]
        for c in sorted(comps(fig,400),key=lambda c:c[:,1].mean()):
            f=figura(full,c,gl)
            x,y,W,H=f['caixa'];box=np.zeros(fig.shape,bool);box[y:y+int(H*1.8),x-int(.3*W):x+int(1.6*W)]=True
            s=sh&box
            if s.any():
                darken=L(full[s])/np.maximum(1,L(empty[s]))
                f['sombra_px']=int(s.sum());f['sombra/chao']=round(float(darken.mean()),3);f['sombra_min']=round(float(darken.min()),3)
                # contato: a sombra mais escura logo sob os pés (faixa de 8 px) e o vão sola→sombra
                band=s.copy();band[:max(0,y+H-4),:]=False;band[y+H+8:,:]=False
                f['contato/chao']=round(float((L(full[band])/np.maximum(1,L(empty[band]))).mean()),3) if band.any() else None
                cols=c[:,1];feet_cols=cols[c[:,0]>y+H-4]
                f['sombra_tocando_sola']=bool(sh[y+H-2:y+H+3,feet_cols.min():feet_cols.max()+1].any()) if len(feet_cols) else None
            out.append(f)
        print(json.dumps({'chao_luma':round(gl,1),'figuras':out},ensure_ascii=False,indent=1))

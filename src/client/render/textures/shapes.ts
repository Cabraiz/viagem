/** Shared drawing kit of the procedural horde textures (enemies.ts, props.ts): shape lists, outlines, eyes, sparkles. */
import Phaser from 'phaser';

export type G=Phaser.GameObjects.Graphics;
export type Shape=['c',number,number,number]|['e',number,number,number,number]|['r',number,number,number,number,number]|['p',number[]];
export interface Head {x:number;y:number}

export const TAU=Math.PI*2;
export const jitter=(i:number)=>{const v=Math.sin(i*12.9898+78.233)*43758.5453;return v-Math.floor(v);};
export const pts=(flat:number[])=>{const out:Phaser.Types.Math.Vector2Like[]=[];for(let i=0;i<flat.length;i+=2)out.push({x:flat[i],y:flat[i+1]});return out;};
export const ell=(cx:number,cy:number,rx:number,ry:number,rot=0,n=24)=>{const out:number[]=[],c=Math.cos(rot),s=Math.sin(rot);
  for(let i=0;i<n;i++){const a=i/n*TAU,x=Math.cos(a)*rx,y=Math.sin(a)*ry;out.push(cx+x*c-y*s,cy+x*s+y*c);}return out;};
export const arcPts=(cx:number,cy:number,r:number,a0:number,a1:number,n=12)=>{const out:number[]=[];
  for(let i=0;i<=n;i++){const a=a0+(a1-a0)*i/n;out.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}return out;};
export const starPts=(cx:number,cy:number,outer:number,inner:number,n=5,rot=-Math.PI/2)=>{const out:number[]=[];
  for(let i=0;i<n*2;i++){const a=rot+i*Math.PI/n,r=i%2?inner:outer;out.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}return out;};

export function paint(g:G,shapes:Shape[],color:number,grow=0,alpha=1){
  g.fillStyle(color,alpha);
  for(const s of shapes){
    if(s[0]==='c')g.fillCircle(s[1],s[2],s[3]+grow);
    else if(s[0]==='e')g.fillEllipse(s[1],s[2],s[3]+grow*2,s[4]+grow*2,28);
    else if(s[0]==='r')g.fillRoundedRect(s[1]-grow,s[2]-grow,s[3]+grow*2,s[4]+grow*2,Math.max(.5,s[5]+grow));
    else{const p=pts(s[1]);g.fillPoints(p,true);if(grow>0)g.lineStyle(grow*2,color,alpha).strokePoints(p,true);}
  }
}
/** Fill a compound shape with a soft darker outline drawn as a grown silhouette behind it. */
export const sil=(g:G,shapes:Shape[],fill:number,line:number,lw=2)=>{paint(g,shapes,line,lw);paint(g,shapes,fill);};
export const poly=(g:G,flat:number[],fill:number,alpha=1)=>g.fillStyle(fill,alpha).fillPoints(pts(flat),true);
export const line=(g:G,flat:number[],color:number,w=2,alpha=1)=>g.lineStyle(w,color,alpha).strokePoints(pts(flat),false);

export function eye(g:G,x:number,y:number,w:number,h:number,col=0x3d2b46){
  g.fillStyle(col).fillEllipse(x,y,w,h,20);
  g.fillStyle(0xffffff).fillCircle(x-w*.16,y-h*.18,Math.max(1.1,w*.24)).fillCircle(x+w*.18,y+h*.2,Math.max(.6,w*.1));
}
export const blush=(g:G,x:number,y:number,w:number,h:number,alpha=.55)=>g.fillStyle(0xf58fae,alpha).fillEllipse(x,y,w,h,16);
export function sparkle(g:G,x:number,y:number,r:number,color=0xffffff,alpha=1){
  poly(g,[x,y-r,x+r*.25,y-r*.25,x+r,y,x+r*.25,y+r*.25,x,y+r,x-r*.25,y+r*.25,x-r,y,x-r*.25,y-r*.25],color,alpha);
}

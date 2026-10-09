import Phaser from 'phaser';
import {ENEMY_ART,ELITE_SCALE,ENEMY_KINDS,FX,PICKUP_KINDS,PICKUP_SIZE,enemyTexture,pickupTexture,type EnemyKind} from './keys.ts';

type G=Phaser.GameObjects.Graphics;
type Shape=['c',number,number,number]|['e',number,number,number,number]|['r',number,number,number,number,number]|['p',number[]];
interface Head {x:number;y:number}

const TAU=Math.PI*2;
const jitter=(i:number)=>{const v=Math.sin(i*12.9898+78.233)*43758.5453;return v-Math.floor(v);};
const pts=(flat:number[])=>{const out:Phaser.Types.Math.Vector2Like[]=[];for(let i=0;i<flat.length;i+=2)out.push({x:flat[i],y:flat[i+1]});return out;};
const ell=(cx:number,cy:number,rx:number,ry:number,rot=0,n=24)=>{const out:number[]=[],c=Math.cos(rot),s=Math.sin(rot);
  for(let i=0;i<n;i++){const a=i/n*TAU,x=Math.cos(a)*rx,y=Math.sin(a)*ry;out.push(cx+x*c-y*s,cy+x*s+y*c);}return out;};
const arcPts=(cx:number,cy:number,r:number,a0:number,a1:number,n=12)=>{const out:number[]=[];
  for(let i=0;i<=n;i++){const a=a0+(a1-a0)*i/n;out.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}return out;};
const starPts=(cx:number,cy:number,outer:number,inner:number,n=5,rot=-Math.PI/2)=>{const out:number[]=[];
  for(let i=0;i<n*2;i++){const a=rot+i*Math.PI/n,r=i%2?inner:outer;out.push(cx+Math.cos(a)*r,cy+Math.sin(a)*r);}return out;};

function paint(g:G,shapes:Shape[],color:number,grow=0,alpha=1){
  g.fillStyle(color,alpha);
  for(const s of shapes){
    if(s[0]==='c')g.fillCircle(s[1],s[2],s[3]+grow);
    else if(s[0]==='e')g.fillEllipse(s[1],s[2],s[3]+grow*2,s[4]+grow*2,28);
    else if(s[0]==='r')g.fillRoundedRect(s[1]-grow,s[2]-grow,s[3]+grow*2,s[4]+grow*2,Math.max(.5,s[5]+grow));
    else{const p=pts(s[1]);g.fillPoints(p,true);if(grow>0)g.lineStyle(grow*2,color,alpha).strokePoints(p,true);}
  }
}
/** Fill a compound shape with a soft darker outline drawn as a grown silhouette behind it. */
const sil=(g:G,shapes:Shape[],fill:number,line:number,lw=2)=>{paint(g,shapes,line,lw);paint(g,shapes,fill);};
const poly=(g:G,flat:number[],fill:number,alpha=1)=>g.fillStyle(fill,alpha).fillPoints(pts(flat),true);
const line=(g:G,flat:number[],color:number,w=2,alpha=1)=>g.lineStyle(w,color,alpha).strokePoints(pts(flat),false);

function eye(g:G,x:number,y:number,w:number,h:number,col=0x3d2b46){
  g.fillStyle(col).fillEllipse(x,y,w,h,20);
  g.fillStyle(0xffffff).fillCircle(x-w*.16,y-h*.18,Math.max(1.1,w*.24)).fillCircle(x+w*.18,y+h*.2,Math.max(.6,w*.1));
}
const blush=(g:G,x:number,y:number,w:number,h:number,alpha=.55)=>g.fillStyle(0xf58fae,alpha).fillEllipse(x,y,w,h,16);
function sparkle(g:G,x:number,y:number,r:number,color=0xffffff,alpha=1){
  poly(g,[x,y-r,x+r*.25,y-r*.25,x+r,y,x+r*.25,y+r*.25,x,y+r,x-r*.25,y+r*.25,x-r,y,x-r*.25,y-r*.25],color,alpha);
}

function drawGosma(g:G):Head{
  const body:Shape[]=[['e',0,-22,52,44],['e',0,-8,58,15],['e',-17,-6,18,11],['e',17,-6,18,11],['r',17,-14,7,12,3.5],['c',20.5,-2,3.6]];
  sil(g,body,0xcf94bc,0x976c97);
  g.fillStyle(0xe4b5d3,.9).fillEllipse(0,-9,42,14,20);
  g.fillStyle(0xb57ca6,.5).fillEllipse(-14,-3,18,5,12).fillEllipse(10,-2,14,4,12);
  g.fillStyle(0xffffff,.75).fillEllipse(-15,-32,9,13,14).fillCircle(-6,-40,2.6).fillCircle(19.6,-3,1.2);
  eye(g,-10,-21,10,13);eye(g,10,-21,10,13);
  poly(g,arcPts(0,-14,6.5,0,Math.PI),0x6b3c62);
  g.fillStyle(0xf47c9e).fillEllipse(1.5,-9.5,6,4,12);
  blush(g,-19,-14,9,4.5);blush(g,19,-14,9,4.5);
  return {x:0,y:-44};
}

function drawPernilongo(g:G):Head{
  const wing=(cx:number,cy:number,rot:number)=>{const p=ell(cx,cy,6.5,13,rot);poly(g,p,0xe8f8ff,.6);g.lineStyle(1.6,0x86aac2,.85).strokePoints(pts(p),true);
    line(g,[cx+Math.sin(rot)*10,cy-Math.cos(rot)*10,cx-Math.sin(rot)*8,cy+Math.cos(rot)*8],0xb4d4e6,1,.8);};
  wing(2,-33,-.5);wing(12,-34,.35);
  const legs=0x5f7d8c;
  line(g,[-4,-24,-9,-13,-12,-7],legs,1.6);line(g,[2,-23,2,-11,0,-5],legs,1.6);line(g,[8,-24,13,-13,17,-8],legs,1.6);
  sil(g,[['p',ell(17,-27,13,7.5,.35)]],0xa8dccb,0x5f8f8a);
  line(g,[13,-33,10,-22],0x7fb3a6,2.4);line(g,[20,-30,17,-20],0x7fb3a6,2.4);line(g,[26,-27,24,-20],0x7fb3a6,2);
  sil(g,[['c',2,-29,9]],0xb6cfd8,0x6f8fa0);
  g.fillStyle(0x4f6675).fillPoints(pts([-19,-32,-32,-17,-30.5,-16.5,-17,-27]),true);
  g.fillStyle(0xd6e4ea).fillPoints(pts([-19,-31,-30,-18.5,-18.5,-29]),true);
  sil(g,[['c',-12,-33,10.5]],0xc4dde4,0x6f8fa0);
  line(g,[-14,-42,-19,-48],0x6f8fa0,1.4);line(g,[-9,-43,-6,-49],0x6f8fa0,1.4);
  g.fillStyle(0xffffff).fillCircle(-16,-33,4.2).fillCircle(-8,-34,4.2);
  g.lineStyle(1,0x6f8fa0).strokeCircle(-16,-33,4.2).strokeCircle(-8,-34,4.2);
  g.fillStyle(0x2f2a3a).fillCircle(-13.8,-32.6,2).fillCircle(-10.2,-33.6,2);
  g.fillStyle(0xffffff).fillCircle(-14.4,-33.4,.7).fillCircle(-10.8,-34.4,.7);
  line(g,[-20.5,-39.5,-14,-37],0x2f2a3a,2);line(g,[-3.5,-40.5,-10,-38],0x2f2a3a,2);
  blush(g,-18,-27,5,2.6,.6);
  g.fillStyle(0xffffff,.7).fillCircle(-1,-33,2);
  return {x:-12,y:-43};
}

function drawTioPave(g:G):Head{
  sil(g,[['e',-10,-3,17,8],['e',10,-3,17,8]],0x6e5a4f,0x4b3c34);
  sil(g,[['r',-17,-17,34,14,4]],0x8d9cba,0x5f6d8c);
  sil(g,[['e',-27,-31,13,22]],0xe9d7ae,0xa88f62);
  sil(g,[['e',0,-31,56,42]],0xe9d7ae,0xa88f62);
  g.fillStyle(0xd6c193).fillRect(-27,-30,54,4);g.fillStyle(0xf4e7c9,.7).fillEllipse(-12,-38,14,10,14);
  poly(g,[-9,-51,0,-43,-1,-52],0xfaf3e1);poly(g,[9,-51,0,-43,1,-52],0xfaf3e1);
  g.fillStyle(0xa88f62).fillCircle(0,-38,1.6).fillCircle(0,-33,1.6);
  g.fillStyle(0xd6c193).fillRoundedRect(-17,-43,8,6,1.5);g.fillStyle(0x7fb36a).fillEllipse(-13,-40,4,2.4,8);
  sil(g,[['c',-27,-21,5]],0xf5c9a6,0xc99878);
  sil(g,[['e',21,-21,30,8]],0xf6f2ea,0xaaa196);
  sil(g,[['r',12,-33,18,11,3]],0xf7e6bf,0xb39c73);
  g.fillStyle(0x8e6450).fillRect(12,-29,18,3);g.fillStyle(0xd9a86b).fillRect(12,-25,18,2.4);
  g.fillStyle(0xfffaf0).fillEllipse(21,-34,17,5,14);
  sil(g,[['c',21,-38,3.2]],0xe2546c,0xa63650,1.4);g.fillStyle(0xffffff).fillCircle(20,-39,1);
  sil(g,[['c',9,-23,5.5]],0xf5c9a6,0xc99878);
  const skin=0xf5c9a6,skinL=0xc99878;
  sil(g,[['c',-19,-61,4.5],['c',19,-61,4.5],['c',0,-63,19.5]],skin,skinL);
  g.fillStyle(0x8a6c5c).fillEllipse(-17,-67,6,11,12).fillEllipse(17,-67,6,11,12);
  line(g,[-15,-70,-8,-79,4,-82,13,-77],0x6b4e3e,2);line(g,[-14,-73,-4,-80,8,-81,15,-74],0x6b4e3e,1.6);
  g.fillStyle(0xffffff,.75).fillEllipse(8,-76,7,4,12);
  eye(g,-7,-63,7,9);eye(g,7,-63,7,9);
  line(g,[-11,-70,-4,-69],0x6b4e3e,1.8);line(g,[4,-69,11,-70],0x6b4e3e,1.8);
  blush(g,-13,-55,7,3.5);blush(g,13,-55,7,3.5);
  poly(g,arcPts(0,-51,4,.15,Math.PI-.15,8),0x9b4a55);
  sil(g,[['e',-5.5,-55,13,6.5],['e',5.5,-55,13,6.5]],0x7a5442,0x553a2e,1);
  return {x:0,y:-82};
}

function drawFiscal(g:G):Head{
  sil(g,[['e',-7,-2,13,6],['e',7,-2,13,6]],0x5a4f55,0x3d353a);
  sil(g,[['r',-9,-24,8,22,2],['r',1,-24,8,22,2]],0x7d8a9c,0x58647a);
  sil(g,[['e',15,-34,8,20]],0xe6eef4,0x9fb0be);
  sil(g,[['r',-13,-50,26,30,7]],0xe6eef4,0x9fb0be);
  sil(g,[['p',[-13,-47,-3,-48,-1,-22,-13,-22]],['p',[13,-47,3,-48,1,-22,13,-22]]],0xcdb57c,0x96814e,1.5);
  g.fillStyle(0xb29a62).fillRect(-11,-34,6,5).fillRect(5,-34,6,5).fillRect(-11,-27,6,4).fillRect(5,-27,6,4);
  g.fillStyle(0x3f6aa0).fillRect(6,-37,1.5,4);
  sil(g,[['c',16,-24,4]],0xf1c7a3,0xc59775,1.5);line(g,[17,-21,19,-15],0x3f4a66,1.8);
  sil(g,[['e',-13,-37,8,16]],0xe6eef4,0x9fb0be,1.5);
  sil(g,[['r',-26,-44,16,21,2]],0xb58a5e,0x86613f);
  g.fillStyle(0xfbf8ef).fillRect(-24,-41,12,16);
  g.fillStyle(0xb3bcc4);for(let i=0;i<4;i++)g.fillRect(-22,-37+i*3.5,8-(i%2)*2,1.2);
  g.fillStyle(0xe2546c).fillRect(-17,-30,3,1.2);
  sil(g,[['r',-21,-46,6,4,1.5]],0xb7c1c9,0x7f8a94,1);
  sil(g,[['c',-11,-31,4]],0xf1c7a3,0xc59775,1.5);
  const skin=0xf1c7a3,skinL=0xc59775;
  sil(g,[['r',-3,-53,6,5,1],['c',0,-62,15],['c',-15,-61,3.5],['c',15,-61,3.5]],skin,skinL);
  sil(g,[['p',arcPts(0,-66,15.5,Math.PI,TAU,14)],['e',-12,-66,18,6]],0x7d9a6f,0x52704b);
  g.fillStyle(0x6a8660).fillRect(-15,-67.5,31,3);
  sil(g,[['c',2,-74,2.6]],0xf2d36b,0xb89a3a,1);
  g.fillStyle(0xffffff,.5).fillEllipse(-6,-76,8,3,10);
  eye(g,-6,-59,5.5,7);
  g.fillStyle(skin).fillRect(-9,-63.5,7,3);line(g,[-9.5,-60.5,-2.5,-60.5],0x3d2b46,1.6);
  line(g,[3,-59,9,-59.5],0x3d2b46,2.2);
  line(g,[-10,-66,-2.5,-64],0x5a4636,1.8);line(g,[2.5,-63,10,-64.5],0x5a4636,1.8);
  line(g,[-7,-52,-3,-53.5,0,-52.8,3,-53.5,7,-52],0x5a4636,1.6);
  line(g,[-2,-49.2,3,-49.8],0x9b4a55,1.4);
  blush(g,-10,-54,5,2.6,.45);blush(g,10,-54,5,2.6,.45);
  return {x:0,y:-81};
}

function drawChefe(g:G):Head{
  const suit=0x8a68b8,suitL=0x553a7c,skin=0xf2c5a0,skinL=0xc28f6c,gold=0xf4cb52,goldL=0xb08328;
  sil(g,[['e',-21,-5,32,13],['e',21,-5,32,13]],0x3d2e4a,0x271c31);
  sil(g,[['r',-29,-38,25,36,6],['r',4,-38,25,36,6]],0x6f50a0,suitL);
  sil(g,[['e',56,-78,24,44]],suit,suitL);
  sil(g,[['e',0,-74,112,92]],suit,suitL);
  g.fillStyle(0x9f80cc,.6).fillEllipse(-24,-96,30,26,16);
  poly(g,[-18,-114,18,-114,0,-78],0xf7f2ff);
  sil(g,[['p',[-4,-110,4,-110,7,-82,0,-74,-7,-82]]],0xe0506a,0xa1314a,1.2);
  poly(g,[-18,-114,-28,-104,-4,-82],0x6f50a0);poly(g,[18,-114,28,-104,4,-82],0x6f50a0);
  const band=[-46,-104,-36,-114,46,-52,38,-40];
  sil(g,[['p',band]],0xf2c45a,goldL);
  g.fillStyle(0xc9952f);for(let i=0;i<6;i++){const t=.2+i*.11;g.fillRect(-39+t*82,-106+t*60,4,4);}
  sil(g,[['p',starPts(-20,-84,9,4)]],0xfff1b8,goldL,1.4);
  g.fillStyle(0xffffff).fillCircle(46,-108,2).fillCircle(-48,-56,1.6);
  sil(g,[['c',48,-56,9]],skin,skinL);
  g.lineStyle(7,0x8f6a24).strokeCircle(46,-36,13);g.lineStyle(4,0xe9bb46).strokeCircle(46,-36,13);
  const key=(x:number,y:number,rot:number,col:number,colL:number)=>{const c=Math.cos(rot),s=Math.sin(rot),tf=(px:number,py:number)=>[x+px*c-py*s,y+px*s+py*c];
    const [hx,hy]=tf(0,-2);
    sil(g,[['p',[...tf(-2,0),...tf(2,0),...tf(2,14),...tf(5,14),...tf(5,17),...tf(2,17),...tf(2,20),...tf(-2,20)]],['c',hx,hy,5]],col,colL,1.4);
    g.fillStyle(colL).fillCircle(hx,hy,1.8);};
  key(37,-25,.45,0xdfe5ec,0x8a95a3);key(47,-23,-.05,0xf4cb52,goldL);key(55,-27,-.45,0xd7a4c2,0x9a6a87);
  const dx=-.8,dy=-.6,nx=.6,ny=-.8,at=(t:number,h:number,sgn:number)=>[-42+dx*t+sgn*h*nx,-104+dy*t+sgn*h*ny];
  sil(g,[['p',[...at(0,4,1),...at(24,12,1),...at(24,12,-1),...at(0,4,-1)]],['p',ell(-42+dx*24,-104+dy*24,12,4,-.927,20)]],0xf6ecd9,0xa48f78);
  g.fillStyle(0xe0506a).fillPoints(pts([...at(10,7.3,1),...at(15,9,1),...at(15,9,-1),...at(10,7.3,-1)]),true);
  g.fillStyle(0xe6d6bf).fillPoints(pts(ell(-42+dx*24.5,-104+dy*24.5,9.5,2.4,-.927,18)),true);
  line(g,[-68,-127,-71,-130],0xe0506a,2.2);line(g,[-70,-118,-73,-119],0xe0506a,2.2);line(g,[-62,-133,-64,-137],0xe0506a,2.2);
  sil(g,[['e',-56,-84,24,44]],suit,suitL);
  sil(g,[['c',-47,-101,9]],skin,skinL);
  g.save().translateCanvas(0,8);
  sil(g,[['r',-9,-108,18,10,3],['c',-31,-133,6],['c',31,-133,6],['c',0,-133,33]],skin,skinL);
  sil(g,[['e',-30,-139,12,22],['e',30,-139,12,22]],0xd6d0dc,0x9a92a6,1.5);
  g.fillStyle(0xffffff,.6).fillEllipse(-10,-158,16,6,12);
  sil(g,[['p',[-15,-162,-14,-172,-7,-166,0,-175,7,-166,14,-172,15,-162]]],gold,goldL,1.6);
  g.fillStyle(0xe0506a).fillCircle(0,-166,2.4);g.fillStyle(0x7fd0e0).fillCircle(-9,-165,1.6).fillCircle(9,-165,1.6);
  line(g,[20,-152,25,-147],0xe0506a,2.4);line(g,[25,-152,20,-147],0xe0506a,2.4);line(g,[22.5,-154,22.5,-145],0xe0506a,1.2,.7);
  eye(g,-13,-130,10,12);eye(g,13,-130,10,12);
  poly(g,[-25,-148,-4,-140,-5,-135,-25,-142],0x4e3a3e);poly(g,[25,-148,4,-140,5,-135,25,-142],0x4e3a3e);
  blush(g,-23,-120,10,5,.6);blush(g,23,-120,10,5,.6);
  sil(g,[['r',-10,-113,20,8,2.5]],0xffffff,0x7a3b48,1.4);
  g.lineStyle(1,0xb7a9b0).lineBetween(-3,-113,-3,-105).lineBetween(3,-113,3,-105).lineBetween(-10,-109,10,-109);
  sil(g,[['e',-9,-118,19,8],['e',9,-118,19,8]],0xc9c1cf,0x8a8296,1.2);
  g.restore();
  return {x:0,y:-158};
}

const DRAW:Record<EnemyKind,(g:G)=>Head>={gosma:drawGosma,pernilongo:drawPernilongo,'tio-pave':drawTioPave,fiscal:drawFiscal,chefe:drawChefe};

function crown(g:G,x:number,y:number){
  sil(g,[['p',[x-8,y,x-9,y-10,x-4.5,y-6,x,y-12,x+4.5,y-6,x+9,y-10,x+8,y]],['r',x-8,y-3,16,4,1]],0xf6d05a,0xb08328,1.5);
  g.fillStyle(0xe0506a).fillCircle(x,y-1.5,1.6);g.fillStyle(0xffffff).fillCircle(x-3,y-7,1).fillCircle(x-9,y-10,.9).fillCircle(x+9,y-10,.9);
}
function aura(g:G,x:number,y:number,w:number,h:number){
  g.fillStyle(0xf7a8c8,.22).fillEllipse(x,y,w,h,32);
  g.lineStyle(2.5,0xf6d36b,.9).strokeEllipse(x,y,w,h,32);
  g.lineStyle(1.4,0xf7a8c8,.8).strokeEllipse(x,y,w*.78,h*.7,28);
  sparkle(g,x-w*.48,y-h*.9,3.5,0xfff3c0);sparkle(g,x+w*.46,y-h*.6,3,0xfff3c0);
}

function drawEnemy(g:G,kind:EnemyKind,elite:boolean){
  const a=ENEMY_ART[kind];
  if(!elite){g.save().translateCanvas(a.width/2,a.originY*a.height);DRAW[kind](g);g.restore();return;}
  const W=Math.ceil(a.width*ELITE_SCALE),H=Math.ceil(a.height*ELITE_SCALE),feet=a.originY*H;
  const s=Math.min(1.22,ELITE_SCALE-9/(a.originY*a.height)),ah=Math.min(a.width*.32,((1-a.originY)*H+3)*2-2);
  aura(g,W/2,H-1-ah/2,a.width*.95,ah);
  g.save().translateCanvas(W/2,feet).scaleCanvas(s,s);const head=DRAW[kind](g);g.restore();
  crown(g,W/2+head.x*s,feet+head.y*s+5);
}

const PICKUP_DRAW:Record<string,(g:G)=>void>={
  xp:g=>{
    sil(g,[['p',[0,-13,9,-4,0,13,-9,-4]]],0x6fe0dc,0x2a95a6);
    poly(g,[0,-13,-9,-4,-2,-4],0xbaf6f2);poly(g,[0,-13,9,-4,2,-4],0x9aeee8);
    poly(g,[2,-4,9,-4,0,13],0x3fbcc4);poly(g,[-2,-4,2,-4,0,13],0x58cfd2);
    sparkle(g,-3.5,-6,4);g.fillStyle(0xffffff,.8).fillCircle(4,4,1);
  },
  heal:g=>{
    g.save().translateCanvas(0,-.5).scaleCanvas(.85,.85);
    const crust:Shape[]=[['c',-1,4,10.5],['p',[-10.2,0,-2.5,-12.5,.5,-12.5,8.2,0]],['c',-1,-12,2.3]];
    for(let i=0;i<10;i++){const a=Math.PI*(.05+i*.1),r=10.3;crust.push(['c',-1+Math.cos(a)*r,4+Math.sin(a)*r,1.6]);}
    sil(g,crust,0xe3a043,0x9c5f24);
    g.fillStyle(0xf6cf83,.9).fillEllipse(-5,-1,4.5,10,12);
    g.fillStyle(0xb46f28);for(let i=0;i<12;i++){const a=jitter(i)*TAU,r=2+jitter(i+20)*7;g.fillCircle(Math.cos(a)*r,5+Math.sin(a)*r*.8-1,.8+jitter(i+40)*.7);}
    g.fillStyle(0xfff0c8);for(let i=0;i<5;i++)g.fillCircle(-6+jitter(i+60)*10,jitter(i+70)*9-1,.7);
    g.fillStyle(0xf26d8f).fillCircle(10.5,-9,2.4).fillCircle(14.5,-9,2.4).fillTriangle(8.3,-8.2,16.7,-8.2,12.5,-3.6);
    g.fillStyle(0xffffff).fillCircle(10,-9.6,.8);
    g.restore();
  },
  magnet:g=>{
    const u=[-7,-9,-7,2,...arcPts(0,2,7,Math.PI,0,14).slice(2),7,-9];
    g.lineStyle(12,0x4a3c5a).strokePoints(pts([-7,-11,...u.slice(2,-2),7,-11]),false);
    g.lineStyle(8,0xe5576a).strokePoints(pts([-7,-8,-7,2,...arcPts(0,2,7,Math.PI,Math.PI/2,7).slice(2)]),false);
    g.lineStyle(8,0x5b8fe2).strokePoints(pts([...arcPts(0,2,7,Math.PI/2,0,7),7,-8]),false);
    g.fillStyle(0xe9eef4).fillRect(-11,-13,8,6).fillRect(3,-13,8,6);
    g.fillStyle(0xffffff,.6).fillRect(-10,-7,2,7);
    line(g,[-13,-14,-15,-16],0xfff2a8,1.6);line(g,[13,-14,15,-16],0xfff2a8,1.6);line(g,[0,-14,0,-16],0xfff2a8,1.6);
  },
  chest:g=>{
    sil(g,[['r',-18,-4,36,18,3],['r',-18,-15,36,13,6]],0xc28a55,0x7e5130);
    g.fillStyle(0xd9a46a).fillRoundedRect(-16,-13,32,8,4);
    g.fillStyle(0x9a6a3f).fillRect(-18,-3,36,2);
    g.fillStyle(0xf2c84b).fillRect(-14,-15,4,29).fillRect(10,-15,4,29);
    sil(g,[['r',-3.5,-7,7,8,1.5]],0xf2c84b,0xa57a1e,1.2);g.fillStyle(0x6a4a2a).fillRect(-.7,-4,1.4,3);
    g.fillStyle(0xffffff,.55).fillRect(-12,-12,4,2);
    sparkle(g,15,-15,4.5,0xfff6c8);sparkle(g,-17,-16,2.5,0xffffff);
  },
  resource:g=>{
    g.save().translateCanvas(0,2);
    sil(g,[['p',[-11,8,-12,-1,-5,-8,5,-7,11,0,10,8]]],0xa59a8a,0x6c6255);
    poly(g,[-12,-1,-5,-8,5,-7,1,-1],0xc7bfb0);poly(g,[1,-1,5,-7,11,0,10,8,3,8],0x8f8577);
    g.fillStyle(0x6c6255,.6).fillCircle(-5,3,1.2).fillCircle(5,4,1);
    line(g,[1,-7,2,-10],0x4f8a45,1.6);
    sil(g,[['p',ell(6.5,-10.5,3.2,6,1.15,16)]],0x83c96f,0x4f8a45,1.4);line(g,[2,-9.5,10.5,-11.5],0x4f8a45,1);
    g.restore();
  },
};

function drawFx(make:(key:string,w:number,h:number,draw:(g:G)=>void)=>void){
  make(FX.shadow,48,18,g=>{g.fillStyle(0x2a2233,.14).fillEllipse(24,9,46,16,32).fillEllipse(24,9,32,10,32);});
  make(FX.puff,64,64,g=>{
    const c:[number,number,number][]=[[32,38,15],[19,35,12],[45,35,12],[25,24,12],[39,23,12],[32,46,12],[13,42,8],[51,43,8]];
    g.fillStyle(0xe8dccb);for(const [x,y,r] of c)g.fillCircle(x,y+2,r);
    g.fillStyle(0xfff9ee);for(const [x,y,r] of c)g.fillCircle(x,y,r);
    g.fillStyle(0xffffff).fillCircle(24,22,6).fillCircle(37,20,5).fillCircle(17,32,4);
  });
  make(FX.star,20,20,g=>poly(g,starPts(10,10.5,9.5,4.2),0xffffff));
  make(FX.projFriendly,18,18,g=>{
    g.fillStyle(0xffd45a,.3).fillCircle(9,9,9);g.fillStyle(0xffc94a,.9).fillCircle(9,9,6.5);
    g.fillStyle(0xfff4c8).fillCircle(9,9,4);g.fillStyle(0xffffff).fillCircle(8,8,2.4);
  });
  make(FX.projHostile,20,20,g=>{
    sil(g,[['p',starPts(10,10,9,5.2,8,0)]],0xe0306a,0x4a0f2a,1.2);
    g.fillStyle(0xff6f9a).fillCircle(10,10,4);g.fillStyle(0xffd0de).fillCircle(9,9,1.8);
  });
  const bar=(border:number)=>(g:G)=>{g.fillStyle(border,.92).fillRoundedRect(0,0,46,13,6.5);g.fillStyle(0x5a4a66,1).fillRoundedRect(3,3,40,7,3.5);};
  make(FX.bar,46,13,bar(0x2b2233));
  make(FX.barElite,46,13,bar(0xe0a93a));
  make(FX.barFill,40,7,g=>{g.fillStyle(0xffffff).fillRoundedRect(0,0,40,7,3.5);});
  make(FX.warning,40,40,g=>{
    g.fillStyle(0xffffff,.28).fillCircle(20,20,17);g.lineStyle(3.5,0xffffff).strokeCircle(20,20,17);
    g.fillStyle(0xffffff).fillRoundedRect(17,8,6,16,3).fillCircle(20,30,3.4);
  });
}

export function ensureHordeTextures(scene:Phaser.Scene):void {
  const g=scene.make.graphics({},false);
  const make=(key:string,w:number,h:number,draw:(g:G)=>void)=>{
    if(scene.textures.exists(key))return;
    g.clear();draw(g);g.generateTexture(key,w,h);
  };
  for(const kind of ENEMY_KINDS){
    const a=ENEMY_ART[kind];
    make(enemyTexture(kind),a.width,a.height,g=>drawEnemy(g,kind,false));
    if(kind!=='chefe')make(enemyTexture(kind,true),Math.ceil(a.width*ELITE_SCALE),Math.ceil(a.height*ELITE_SCALE),g=>drawEnemy(g,kind,true));
  }
  for(const kind of PICKUP_KINDS){
    const {width,height}=PICKUP_SIZE[kind];
    make(pickupTexture(kind),width,height,g=>{g.save().translateCanvas(width/2,height/2);PICKUP_DRAW[kind](g);g.restore();});
  }
  drawFx(make);
  g.destroy();
}

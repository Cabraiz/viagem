import Phaser from 'phaser';
import {tokenColor} from '../ui/tokens.ts';
import {ENEMY_ART,ELITE_SCALE,ENEMY_KINDS,FX,PICKUP_KINDS,PICKUP_SIZE,enemyTexture,hasActingPose,pickupTexture,type EnemyKind} from './keys.ts';

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

/*
 * D-033 cast (design/arte-v2.md §4) drawn with the old procedural shapes, recolored and slightly reshaped, until the
 * prerendered Myth-style art arrives. Every silhouette must read apart at phone size: blob (bêbado), small stout figure
 * with a burning bottle (anão), flying wings (pombos), big tiozão (tio do pavê), thin dark figure (agiota), giant (chefe).
 */
function drawBebado(g:G):Head{
  // The old gosma blob as a beer belly: amber body, foam on top, droopy eyes, red nose and a tiny green bottle.
  const amber=0xe3a33c,amberL=0x8a561c;
  const body:Shape[]=[['e',0,-22,52,44],['e',0,-8,58,15],['e',-17,-6,18,11],['e',17,-6,18,11],['c',-22,-12,5]];
  sil(g,body,amber,amberL);
  g.fillStyle(0xf2c065,.8).fillEllipse(-12,-30,12,14,14);
  // Stained tank top (regata) over the belly.
  g.fillStyle(0xf4efe2).fillEllipse(0,-9,42,15,20);
  g.fillStyle(0xf4efe2).fillRect(-12,-20,5,9).fillRect(7,-20,5,9);
  g.fillStyle(0xc8964a,.7).fillEllipse(8,-8,9,5,12).fillEllipse(-6,-5,5,3,10);
  // Beer foam on the head.
  sil(g,[['c',-14,-41,7],['c',-5,-46,8],['c',6,-45,8],['c',15,-40,6.5],['e',0,-40,34,9]],0xfffbef,0xc9b98f,1.6);
  g.fillStyle(0xfffbef).fillEllipse(-17,-35,5,7,10).fillEllipse(13,-35,4,6,10);
  g.fillStyle(0xffffff).fillCircle(-7,-48,2.2);
  // Droopy eyes: the lid covers the top half.
  eye(g,-10,-25,10,12);eye(g,10,-25,10,12);
  g.fillStyle(amber).fillRect(-16,-32,12,7).fillRect(4,-32,12,7);
  line(g,[-16,-25,-4,-25],amberL,1.8);line(g,[4,-25,16,-25],amberL,1.8);
  blush(g,-19,-16,11,6,.8);blush(g,19,-16,11,6,.8);
  sil(g,[['c',0,-18,4.2]],0xe2546c,0xa63650,1.2);g.fillStyle(0xffffff,.8).fillCircle(-1.2,-19.4,1.1);
  line(g,[-7,-12,-3.5,-13.5,0,-12,3.5,-13.5,7,-12],0x6b3a1e,1.8);
  // The bottle in the nub hand.
  sil(g,[['r',19,-23,8,15,2.5],['r',21,-30,4,8,1]],0x3f8a46,0x1f4a26,1.4);
  g.fillStyle(0xf2d36b).fillRect(19.5,-18,7,4);g.fillStyle(0xffffff,.6).fillRect(20.5,-22,1.6,10);
  sil(g,[['c',22,-7,4]],amber,amberL,1.4);
  return {x:0,y:-52};
}

function drawAnaoMolotov(g:G):Head{
  // Small stout dwarf grenadier: hard hat, bandana, big beard, a belt of bottles and a burning one raised.
  const skin=0xf1c7a3,skinL=0xc59775;
  g.fillStyle(0xff8a3a,.22).fillCircle(26,-58,13);g.fillStyle(0xffb04a,.35).fillCircle(26,-58,8);
  sil(g,[['e',-9,-3,16,7],['e',9,-3,16,7]],0x5a3a24,0x3a2414);
  sil(g,[['r',-13,-15,10,13,2],['r',3,-15,10,13,2]],0x4a5f8a,0x2f3e5e);
  sil(g,[['e',0,-25,40,28]],0x4f6b3a,0x2e4020);
  sil(g,[['c',-19,-24,5.5]],skin,skinL,1.5);
  // Belt of cachaça bottles with burning rags.
  sil(g,[['r',-19,-20,38,6,2]],0x6b4226,0x3e2414,1.2);
  for(const x of [-14,-6,2,10]){
    sil(g,[['r',x,-26,5,8,1.5]],0xd9c27a,0x8a7432,1);
    g.fillStyle(0xff7a1f).fillTriangle(x+.5,-26,x+4.5,-26,x+2.5,-30);
  }
  // Beard over the chest, face, nose and angry eyes.
  sil(g,[['c',0,-44,11]],skin,skinL);
  sil(g,[['e',0,-33,26,20],['c',-9,-27,5],['c',9,-27,5],['c',0,-24,5]],0xb5652a,0x6e3815,1.5);
  line(g,[-5,-34,-6,-28],0x8a4a1c,1.2);line(g,[4,-34,5,-28],0x8a4a1c,1.2);
  sil(g,[['c',0,-41,3.8]],0xe89a86,0xb5675a,1);
  eye(g,-5,-46,4.5,5.5);eye(g,5,-46,4.5,5.5);
  line(g,[-9,-50.5,-2,-48.5],0x3d2b46,1.8);line(g,[9,-50.5,2,-48.5],0x3d2b46,1.8);
  // Red bandana and the yellow hard hat.
  sil(g,[['r',-11,-53,22,4,1.5]],0xd2392f,0x7a1a14,1);
  poly(g,[-11,-52,-17,-55,-16,-49],0xd2392f);
  sil(g,[['p',arcPts(0,-53,12,Math.PI,TAU,14)],['e',0,-53,30,5]],0xf2c230,0x9a7412,1.4);
  line(g,[0,-65,0,-54],0xc99a1c,2);g.fillStyle(0xffffff,.6).fillEllipse(-5,-60,6,3,10);
  // The raised arm with the molotov: bottle, rag and fire.
  line(g,[13,-30,20,-44],0x2e4020,7);line(g,[13,-30,20,-44],0x4f6b3a,4.6);
  sil(g,[['p',ell(23,-54,4,7,.35)],['r',24,-63,3.5,5,1]],0xd9a640,0x7a5212,1.2);
  g.fillStyle(0xffffff,.55).fillEllipse(21.5,-55,1.6,5,8);
  sil(g,[['c',20,-45,4]],skin,skinL,1.4);
  poly(g,[23,-63,31,-63,27,-71],0xe0402a);poly(g,[24.5,-63,29.5,-63,27.5,-68.5],0xff7a1f);poly(g,[25.8,-63,28.4,-63,27.2,-66.5],0xffd84a);
  return {x:0,y:-66};
}

function pigeon(g:G,x:number,y:number,s:number,shade=0){
  // A plump grey pigeon flying left: wings up, iridescent neck, orange eye with an angry brow.
  const k=(v:number)=>v*s,grey=shade?0x8a909d:0xa3a9b6,greyD=0x6b7180,line0=0x3c4152;
  const at=(flat:number[])=>flat.map((v,i)=>i%2?y+k(v):x+k(v));
  sil(g,[['p',at([2,-4,9,-20,14,-30,15,-23,20,-29,19,-20,24,-24,16,-8,9,-2])]],greyD,line0,1.4);
  sil(g,[['p',at([12,-3,26,0,25,6,11,5])],['p',ell(x+k(2),y,k(16),k(9.5),.08)]],grey,line0,1.4);
  line(g,at([16,1,24,3]),greyD,1.2);
  sil(g,[['p',ell(x+k(-8),y+k(-2),k(5.5),k(5),0)],['c',x+k(-12),y+k(-7),k(7)]],grey,line0,1.4);
  g.fillStyle(0x4fa08a,.9).fillEllipse(x+k(-8),y+k(-1),k(8),k(5),12);g.fillStyle(0x8a6aa8,.8).fillEllipse(x+k(-6),y+k(1),k(6),k(3),10);
  poly(g,at([-18,-8,-24,-5.5,-18,-4.5]),0x3a3340);g.fillStyle(0xf0e8e0).fillCircle(x+k(-17.5),y+k(-7.6),k(1.3));
  g.fillStyle(0xf08a24).fillCircle(x+k(-13),y+k(-8.5),k(2.6));g.fillStyle(0x1e1530).fillCircle(x+k(-13.4),y+k(-8.5),k(1.3));
  line(g,at([-17,-13,-10,-10.5]),line0,Math.max(1.2,k(2)));
  // Front wing raised mid-flap: feathered tips and the two black bars of a city pigeon.
  sil(g,[['p',at([-2,-4,-10,-20,-9,-33,-4,-26,0,-36,4,-27,9,-33,11,-18,8,-3])]],0xd2d6de,line0,1.4);
  line(g,at([-7,-14,8,-12]),0x2b2733,Math.max(1.2,k(2.2)));line(g,at([-6,-9,8,-7]),0x2b2733,Math.max(1.2,k(2.2)));
  line(g,at([0,8,-2,12]),0xe07a5a,Math.max(1.2,k(2)));line(g,at([5,8,4,12]),0xe07a5a,Math.max(1.2,k(2)));
}
function drawPombos(g:G):Head{
  pigeon(g,22,-34,.68,1);
  pigeon(g,-6,-15,1.2);
  return {x:-20,y:-33};
}
function drawTioPave(g:G):Head{
  sil(g,[['e',-10,-3,17,8],['e',10,-3,17,8]],0x6e5a4f,0x4b3c34);
  sil(g,[['r',-17,-17,34,14,4]],0x8d9cba,0x5f6d8c);
  // D-033: heavier tiozão in an open loud shirt with a gold chain (drawn 1.15× by DRAW), still carrying the pavê.
  const shirt=0xe8743c,shirtL=0x9a3f1c;
  sil(g,[['e',-27,-31,13,22]],shirt,shirtL);
  sil(g,[['e',0,-31,58,44]],shirt,shirtL);
  g.fillStyle(0xf5c9a6).fillPoints(pts([-8,-52,8,-52,0,-36]),true);
  g.fillStyle(0xfff1c0);for(const [x,y] of [[-20,-38],[-14,-24],[16,-42],[-22,-26],[-6,-20],[20,-30]])g.fillCircle(x,y,2.6);
  g.fillStyle(0x3fa38f);for(const [x,y] of [[-17,-31],[13,-36],[-10,-42],[-2,-26]])g.fillCircle(x,y,1.8);
  poly(g,[-9,-51,0,-43,-1,-52],0xfaf3e1);poly(g,[9,-51,0,-43,1,-52],0xfaf3e1);
  g.lineStyle(2.4,0xb08328).strokePoints(pts(arcPts(0,-50,8,.35,Math.PI-.35,10)),false);
  g.lineStyle(1.4,0xf6d05a).strokePoints(pts(arcPts(0,-50,8,.35,Math.PI-.35,10)),false);
  sil(g,[['c',0,-41,2.6]],0xf6d05a,0xb08328,1);
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

function drawAgiota(g:G):Head{
  // The old fiscal's thin standing figure as the neighborhood loan shark: dark clothes, wine shirt, gold chain,
  // gold fanny pack (pochete), slicked hair, dark shades and a fan of boletos com juros in the hand.
  const skin=0xf1c7a3,skinL=0xc59775,dark=0x2b2733,darkL=0x14111a,gold=0xf2c84b,goldL=0x9a6a1e;
  sil(g,[['e',-7,-2,13,6],['e',7,-2,13,6]],0x1e1a22,0x0c0a0e);
  g.fillStyle(0xffffff,.45).fillEllipse(-9,-3,4,1.6,8).fillEllipse(5,-3,4,1.6,8);
  sil(g,[['r',-9,-24,8,22,2],['r',1,-24,8,22,2]],0x3a3442,darkL);
  sil(g,[['e',15,-34,8,20]],dark,darkL);
  sil(g,[['r',-13,-50,26,30,7]],0x8e2a3c,0x4e1420);
  g.fillStyle(skin).fillPoints(pts([-5,-50,5,-50,0,-42]),true);
  poly(g,[-13,-49,-5,-50,-1,-36,-13,-24],dark);poly(g,[13,-49,5,-50,1,-36,13,-24],dark);
  g.lineStyle(2.2,goldL).strokePoints(pts(arcPts(0,-50,6,.4,Math.PI-.4,8)),false);
  g.lineStyle(1.2,gold).strokePoints(pts(arcPts(0,-50,6,.4,Math.PI-.4,8)),false);
  // Gold pochete across the waist, strap over the chest.
  line(g,[-12,-46,10,-28],0x1e1a22,2.2);
  sil(g,[['r',-12,-30,22,9,3.5]],gold,goldL,1.6);
  g.fillStyle(0xd9a836).fillRect(-10,-26.5,18,1.4);g.fillStyle(0xfff3c0).fillRect(-9,-29,6,1.4);
  sil(g,[['c',16,-24,4]],skin,skinL,1.5);
  sil(g,[['e',-13,-37,8,16]],dark,darkL,1.5);
  // Fan of boletos: paper slips with a red band and a bar code.
  const slip=(x:number,y:number,rot:number)=>{
    const c=Math.cos(rot),s2=Math.sin(rot),tf=(px:number,py:number)=>[x+px*c-py*s2,y+px*s2+py*c];
    sil(g,[['p',[...tf(-7,-5),...tf(7,-5),...tf(7,5),...tf(-7,5)]]],0xfbf8ef,0x2b2233,1.2);
    g.fillStyle(0xd2392f).fillPoints(pts([...tf(-7,-5),...tf(7,-5),...tf(7,-2),...tf(-7,-2)]),true);
    g.fillStyle(0x2b2233);for(const bx of [-5,-3,-2,0,2,3,5])g.fillPoints(pts([...tf(bx,0),...tf(bx+.8,0),...tf(bx+.8,3.5),...tf(bx,3.5)]),true);
  };
  slip(-22,-36,-.45);slip(-19,-39,-.1);slip(-15,-40,.3);
  sil(g,[['c',-13,-33,4]],skin,skinL,1.5);
  sil(g,[['r',-3,-53,6,5,1],['c',0,-62,15],['c',-15,-61,3.5],['c',15,-61,3.5]],skin,skinL);
  // Slicked black hair with a shine.
  sil(g,[['p',arcPts(0,-64,15.5,Math.PI,TAU,14)],['e',-8,-73,16,7]],0x1e1a22,0x0c0a0e,1.2);
  g.fillStyle(0xffffff,.45).fillEllipse(-4,-75,9,2.4,10);
  // Dark shades, smug smile and a gold tooth.
  sil(g,[['r',-13,-65,11,7,2.5],['r',2,-65,11,7,2.5]],0x14111a,0x000000,.8);
  line(g,[-2,-62.5,2,-62.5],0x14111a,1.6);line(g,[-13,-63,-15.5,-62],0x14111a,1.4);line(g,[13,-63,15.5,-62],0x14111a,1.4);
  g.fillStyle(0xffffff,.7).fillRect(-11,-63.5,3,1.2).fillRect(4,-63.5,3,1.2);
  line(g,[-6,-54,0,-52.5,7,-55],0x5a2a2a,1.8);
  g.fillStyle(gold).fillRect(1,-53.5,2.4,2);
  return {x:0,y:-80};
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

/*
 * Elenco P1 (NEW-20261012-ORQ-elenco-p1, design/arte-v2.md §4): procedural until their imported art exists. Each has an
 * idle pose and an acting pose (`act`, EnemyView.phase 1): the coach lifts his whiteboard, the motoboy lights his
 * headlight and leans into the charge, the influencer flexes for the selfie. Silhouettes apart from the rest of the
 * cast at phone size: tall thin blue suit with a white board (coach), wide bike with a big green cube bag (motoboy),
 * broad V torso in hot pink with a phone up on a stick (influencer).
 */
function drawCoach(g:G,act=false):Head{
  const suit=0x2f63d8,suitL=0x14306e,skin=0xf1c7a3,skinL=0xc59775,tie=0xe0407a,board=0xfbfbf6,frame=0x8a93a3;
  sil(g,[['e',-8,-2.5,14,6],['e',8,-2.5,14,6]],0x1a1620,0x07060a);
  g.fillStyle(0xffffff,.5).fillEllipse(-10,-3.5,4,1.5,8).fillEllipse(6,-3.5,4,1.5,8);
  sil(g,[['r',-10,-30,8,28,2.5],['r',2,-30,8,28,2.5]],suit,suitL);
  // Tight jacket: narrow waist, pointy shoulders, white shirt V and a loud tie.
  sil(g,[['p',[-17,-62,17,-62,13,-40,11,-27,-11,-27,-13,-40]]],suit,suitL);
  poly(g,[-6,-62,6,-62,0,-44],0xffffff);
  sil(g,[['p',[-2.5,-60,2.5,-60,3.5,-47,0,-42,-3.5,-47]]],tie,0x8a1f45,1);
  poly(g,[-6,-62,-11,-58,-2,-44],0x2553b8);poly(g,[6,-62,11,-58,2,-44],0x2553b8);
  g.fillStyle(0xf6d05a).fillCircle(-1,-34,1.6).fillCircle(-1,-29.5,1.6);
  // Whiteboard: under the arm at rest, raised over the head while lecturing (a chart going up).
  const whiteboard=(x:number,y:number,w:number,h:number)=>{
    sil(g,[['r',x,y,w,h,2]],board,frame,2.4);
    line(g,[x+4,y+h-6,x+w*.35,y+h*.55,x+w*.55,y+h*.68,x+w-6,y+6],0xd2392f,act?3:2.2);
    poly(g,[x+w-10,y+4,x+w-3,y+3,x+w-5,y+10],0xd2392f);
    g.fillStyle(0x2b2733).fillRect(x+3,y+h-4,w-6,1.3);
  };
  if(act){
    // Right arm straight up holding the board; left arm pointing at the crowd.
    line(g,[12,-58,20,-80],suitL,8.5);line(g,[12,-58,20,-80],suit,6);
    whiteboard(1,-104,36,25);
    sil(g,[['c',20,-82,4.2]],skin,skinL,1.4);
    line(g,[-13,-57,-29,-50],suitL,8.5);line(g,[-13,-57,-29,-50],suit,6);
    sil(g,[['c',-31,-49.5,4]],skin,skinL,1.4);line(g,[-33,-50,-39,-52],skin,2.6);
  }else{
    whiteboard(-34,-56,22,30);
    line(g,[-13,-58,-17,-38],suitL,8.5);line(g,[-13,-58,-17,-38],suit,6);
    sil(g,[['c',-17,-37,4]],skin,skinL,1.4);
    line(g,[13,-58,18,-42,11,-34],suitL,8.5);line(g,[13,-58,18,-42,11,-34],suit,6);
    sil(g,[['c',11,-34,3.8]],skin,skinL,1.4);
  }
  // Head with a tall glossy pompadour, a gleaming smile and the headset.
  sil(g,[['r',-3,-66,6,5,1],['c',0,-75,12.5],['c',-12.5,-74,3],['c',12.5,-74,3]],skin,skinL);
  sil(g,[['p',[-13,-78,-12,-88,-4,-95,8,-96,15,-90,13,-80,6,-86,-4,-84]]],0x3a2418,0x1a0e08,1.4);
  g.fillStyle(0xffffff,.5).fillEllipse(2,-92,10,3,10);
  eye(g,-5,-76,4.5,5.5);eye(g,5,-76,4.5,5.5);
  line(g,[-9,-81,-2,-80],0x3a2418,1.8);line(g,[2,-80,9,-81],0x3a2418,1.8);
  if(act){sil(g,[['e',0,-67.5,9,6]],0x7a2430,0x3a1018,1);g.fillStyle(0xffffff).fillRect(-3.5,-70,7,1.8);}
  else{sil(g,[['p',arcPts(0,-70,5.5,.1,Math.PI-.1,10)]],0xffffff,0x5a2a2a,1);}
  g.lineStyle(2,0x1e1a22).strokePoints(pts(arcPts(0,-76,13.5,Math.PI*1.05,Math.PI*1.95,12)),false);
  sil(g,[['r',-15,-79,4,8,1.5]],0x1e1a22,0x000000,.6);
  line(g,[-13,-72,-9,-67,-4,-66.5],0x1e1a22,1.6);g.fillStyle(0x1e1a22).fillCircle(-3.5,-66.5,1.8);
  return {x:0,y:-96};
}

function drawMotoboy(g:G,act=false):Head{
  const bike=0x3d7fc4,bikeL=0x1c3f68,bag=0x8cc63f,bagL=0x3f6a18,jacket=0x3a3f4a,jacketL=0x1a1d24;
  const lean=act?4:0;
  // Speed lines and exhaust while he charges.
  if(act){line(g,[-50,-30,-36,-30],0xffffff,2.2,.9);line(g,[-48,-21,-38,-21],0xffffff,2,.8);line(g,[-46,-40,-38,-40],0xffffff,1.8,.7);
    g.fillStyle(0xd8d4dc,.9).fillCircle(-40,-12,4.5).fillCircle(-46,-15,3.2);}
  // Wheels.
  for(const x of [-26,26]){sil(g,[['c',x,-10,9.5]],0x2b2733,0x0c0a0e,1.2);g.fillStyle(0xa9b0bc).fillCircle(x,-10,4);g.fillStyle(0x5a6070).fillCircle(x,-10,1.6);}
  // Scooter body: rear cowl, floor, front shield and handlebar.
  sil(g,[['p',[-34,-16,-30,-28,-8,-30,-2,-18,14,-18,18,-44,26,-46,30,-18,22,-12,-28,-12]]],bike,bikeL,1.6);
  g.fillStyle(0xffffff,.35).fillEllipse(-20,-26,14,3,10);
  line(g,[22,-44,18,-54],0x2b2733,2.6);line(g,[14,-55,24,-53],0x2b2733,2.8);
  // Headlight: a dull lens at rest, lit while aiming (layers.ts pulses a glow over it).
  if(act){g.fillStyle(0xfff2a8,.35).fillCircle(31,-38,9);g.fillStyle(0xfff2a8,.55).fillTriangle(33,-41,50,-48,50,-30);}
  sil(g,[['c',29,-38,4.2]],act?0xfff6c8:0xc9ccd4,bikeL,1.4);
  if(act)g.fillStyle(0xffffff).fillCircle(29.5,-38.5,2.2);
  g.save().translateCanvas(lean,0);
  // Rider: leg on the floor, jacket leaning to the bars.
  sil(g,[['p',[-12,-30,4,-28,8,-18,2,-16,-2,-24,-14,-24]]],0x3a4f7a,0x1e2a44,1.4);
  sil(g,[['e',6,-17,9,4.5]],0x1a1620,0x07060a,1);
  sil(g,[['p',[-16,-52,-4,-58,6,-50,4,-30,-14,-28]]],jacket,jacketL);
  line(g,[0,-52,16,-52],jacketL,7);line(g,[0,-52,16,-52],jacket,4.6);
  sil(g,[['c',17,-53,3.2]],0x2b2733,0x0c0a0e,1);
  // The big thermal bag on his back: the read of the motoboy at phone size.
  sil(g,[['r',-42,-70,26,26,3]],bag,bagL,1.8);
  poly(g,[-16,-70,-11,-66,-11,-41,-16,-44],0x6a9e2a);poly(g,[-42,-70,-37,-74,-11,-74,-16,-70],0xb5e070);
  line(g,[-38,-74,-14,-74],bagL,1.2);
  // Lunch box (marmita) icon on the bag: a tin with its lid.
  sil(g,[['r',-36,-60,14,9,2]],0xf4f1ea,bagL,1);
  g.fillStyle(0xb9c0ca).fillRect(-37,-62,16,3);g.fillStyle(0x2b2733).fillRect(-31,-64,4,2);
  line(g,[-18,-66,-8,-55],0x2b2733,2);
  // Full-face helmet: white with a red stripe and a dark visor.
  sil(g,[['c',0,-66,11.5]],0xf4f1ea,0x6b6470,1.6);
  g.fillStyle(0xd2392f).fillRect(-3,-77.5,5,23);
  sil(g,[['p',[1,-71,12,-70,11,-61,2,-62]]],0x1e1a2a,0x000000,.8);
  g.fillStyle(0x7fd0e0,.8).fillRect(4,-69,5,1.5);
  if(act)line(g,[3,-73,10,-71.5],0xd2392f,2); // angry brow painted on the visor rim
  g.restore();
  return {x:lean,y:-78};
}

function drawInfluencer(g:G,act=false):Head{
  const skin=0xd9a070,skinL=0x9a6a40,top=0xff4fa0,topL=0x9a1f5a;
  sil(g,[['e',-9,-3,15,6],['e',9,-3,15,6]],0xffffff,0x8a8296);
  g.fillStyle(0x3fc0c8).fillRect(-14,-4,10,1.6).fillRect(4,-4,10,1.6);
  sil(g,[['r',-12,-34,10,30,3],['r',2,-34,10,30,3]],0x8a8f9c,0x4a4f5c);
  // Broad V torso in a hot pink tank top, with big round shoulders.
  sil(g,[['p',[-24,-66,24,-66,14,-34,-14,-34]],['c',-21,-62,8],['c',21,-62,8]],skin,skinL);
  sil(g,[['p',[-14,-66,-7,-66,0,-58,7,-66,14,-66,13,-34,-13,-34]]],top,topL,1.4);
  g.fillStyle(0xffffff,.35).fillEllipse(-6,-50,6,12,10);
  sil(g,[['r',-14,-37,28,6,2]],0x2b2733,0x000000,1);
  // Phone on the selfie stick, recording (red dot).
  const phone=(x:number,y:number)=>{
    sil(g,[['r',x-5,y-8,10,16,2]],0x1e1a22,0x000000,1);
    g.fillStyle(0x7fd0e0,.9).fillRect(x-3.5,y-6,7,11);g.fillStyle(0xd2392f).fillCircle(x+2,y-4,1.7);
  };
  line(g,[18,-50,32,-80],0x6b6470,2.2);
  phone(33,-84);
  if(act){
    // Flex for the selfie: left arm up and bent, big biceps, sparkles.
    line(g,[-24,-62,-34,-70,-30,-84],skinL,11);line(g,[-24,-62,-34,-70,-30,-84],skin,8.5);
    sil(g,[['c',-33,-73,6.5]],skin,skinL,1.6);sil(g,[['c',-30,-86,4.5]],skin,skinL,1.4);
    line(g,[24,-62,26,-56,19,-50],skinL,11);line(g,[24,-62,26,-56,19,-50],skin,8.5);
    sil(g,[['c',27,-58,6]],skin,skinL,1.6);
    sparkle(g,-40,-80,4.5,0xfff3c0);sparkle(g,34,-66,3.5,0xfff3c0);
  }else{
    // Left hand holds a protein shaker; right hand holds the stick up.
    line(g,[-24,-62,-28,-44],skinL,11);line(g,[-24,-62,-28,-44],skin,8.5);
    sil(g,[['r',-33,-46,10,14,3],['r',-32,-49,8,4,1]],0xf4f1ea,0x8a8296,1.2);g.fillStyle(0x3fc0c8).fillRect(-33,-41,10,3);
    line(g,[24,-62,26,-54,19,-50],skinL,11);line(g,[24,-62,26,-54,19,-50],skin,8.5);
  }
  sil(g,[['c',19,-50,4]],skin,skinL,1.4);
  // Small head, bleached quiff, cyan headband, shiny smile.
  sil(g,[['r',-4,-71,8,6,1],['c',0,-79,11]],skin,skinL);
  sil(g,[['p',[-11,-82,-9,-90,-1,-95,10,-93,12,-84,4,-88]]],0xf4d35e,0xb08328,1.3);
  sil(g,[['r',-11.5,-85,23,3.6,1.5]],0x3fc0c8,0x1f7a80,1);
  eye(g,-4.5,-79,4,5);eye(g,4.5,-79,4,5);
  line(g,[-8,-83.5,-2,-83],0x9a6a40,1.4);line(g,[2,-83,8,-83.5],0x9a6a40,1.4);
  if(act)sil(g,[['e',0,-72.5,6,3.4]],0xe86a8a,0x9a2a4a,1);
  else{sil(g,[['p',arcPts(0,-74,4.5,.15,Math.PI-.15,8)]],0xffffff,0x6a3a2a,1);sparkle(g,4,-73,2.4,0xffffff);}
  return {x:0,y:-95};
}

/** The tio do pavê is heavier in D-033: the same drawing, 1.15× (ENEMY_ART grows with it). */
const TIO_SCALE=1.15;
const drawTioPaveHeavy=(g:G):Head=>{g.save().scaleCanvas(TIO_SCALE,TIO_SCALE);const h=drawTioPave(g);g.restore();return {x:h.x*TIO_SCALE,y:h.y*TIO_SCALE};};
const DRAW:Record<EnemyKind,(g:G,act?:boolean)=>Head>={bebado:drawBebado,'anao-molotov':drawAnaoMolotov,pombos:drawPombos,'tio-pave':drawTioPaveHeavy,agiota:drawAgiota,chefe:drawChefe,
  coach:drawCoach,motoboy:drawMotoboy,influencer:drawInfluencer};

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

function drawEnemy(g:G,kind:EnemyKind,elite:boolean,act=false){
  const a=ENEMY_ART[kind];
  if(!elite){g.save().translateCanvas(a.width/2,a.originY*a.height);DRAW[kind](g,act);g.restore();return;}
  const W=Math.ceil(a.width*ELITE_SCALE),H=Math.ceil(a.height*ELITE_SCALE),feet=a.originY*H;
  const s=Math.min(1.22,ELITE_SCALE-9/(a.originY*a.height)),ah=Math.min(a.width*.32,((1-a.originY)*H+3)*2-2);
  aura(g,W/2,H-1-ah/2,a.width*.95,ah);
  g.save().translateCanvas(W/2,feet).scaleCanvas(s,s);const head=DRAW[kind](g,act);g.restore();
  crown(g,W/2+head.x*s,feet+head.y*s+5);
  badge(g,W/2+head.x*s*.5+7,feet+head.y*s*.48);
}
/** Funcionário do Mês (D-033 elite): the gold name badge (crachá) on a lanyard, on top of the crown and the aura. */
function badge(g:G,x:number,y:number){
  line(g,[x-4,y-9,x,y-4,x+4,y-9],0xe0506a,1.4);
  sil(g,[['r',x-4.5,y-4,9,11,1.5]],0xf6d05a,0x8a6418,1.4);
  g.fillStyle(0xfffaf0).fillRect(x-3,y-.5,6,2.2);g.fillStyle(0x8a6418).fillRect(x-2.5,y+3,5,1);
}

const PICKUP_DRAW:Record<string,(g:G)=>void>={
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
  chest:g=>{
    sil(g,[['r',-18,-4,36,18,3],['r',-18,-15,36,13,6]],0xc28a55,0x7e5130);
    g.fillStyle(0xd9a46a).fillRoundedRect(-16,-13,32,8,4);
    g.fillStyle(0x9a6a3f).fillRect(-18,-3,36,2);
    g.fillStyle(0xf2c84b).fillRect(-14,-15,4,29).fillRect(10,-15,4,29);
    sil(g,[['r',-3.5,-7,7,8,1.5]],0xf2c84b,0xa57a1e,1.2);g.fillStyle(0x6a4a2a).fillRect(-.7,-4,1.4,3);
    g.fillStyle(0xffffff,.55).fillRect(-12,-12,4,2);
    sparkle(g,15,-15,4.5,0xfff6c8);sparkle(g,-17,-16,2.5,0xffffff);
  },
  // D-051 item on the ground without its sticker: a taped cardboard parcel with a Papel "?".
  item:g=>{
    sil(g,[['r',-13,-9,26,20,3]],0xc79a62,0x6e4a2a);
    g.fillStyle(0xe0b77c).fillRect(-11,-7,22,5);
    g.fillStyle(0xeeddb8,.9).fillRect(-2.5,-9,5,20);
    g.fillStyle(0x1e1530).fillRect(-1,2,2,2.4);
    g.lineStyle(2.2,0x1e1530).beginPath().arc(0,-2.5,3.2,Math.PI*1.05,Math.PI*.35,false).strokePath();
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
  // The agiota's boleto com juros (D-033): a Papel slip with a red band, Breu edge and bar code.
  make(FX.projBoleto,26,20,g=>{
    g.fillStyle(0x1e1530).fillRoundedRect(1,2,24,16,2.5);g.fillStyle(0xfbf8ef).fillRoundedRect(2.5,3.5,21,13,1.5);
    g.fillStyle(0xd2392f).fillRect(2.5,3.5,21,4.5);g.fillStyle(0xfbf8ef).fillCircle(6,5.8,1.2);
    g.fillStyle(0x1e1530);for(const [x,w] of [[5,1],[7,2],[10,1],[12,1],[14,2],[17,1],[19,2]])g.fillRect(x,10,w,4.5);
  });
  // 1 px Papel edge outside the dark frame: the frame alone vanished on dark canopies (DSG-contraste-mapa, D-022).
  const papel=tokenColor('--c-papel');
  const bar=(border:number)=>(g:G)=>{g.fillStyle(papel,1).fillRoundedRect(0,0,46,13,6.5);g.fillStyle(border,1).fillRoundedRect(1,1,44,11,5.5);g.fillStyle(0x5a4a66,1).fillRoundedRect(3,3,40,7,3.5);};
  make(FX.bar,46,13,bar(0x2b2233));
  make(FX.barElite,46,13,bar(0xe0a93a));
  make(FX.barFill,40,7,g=>{g.fillStyle(0xffffff).fillRoundedRect(0,0,40,7,3.5);});
  // Spawn warning in the palette (onda 4): Laranja Cone disc, Breu edge and "!" (the white icon tinted red was the
  // worst pair for deuteranopia on the green). Drawn in its own colors: the renderer no longer tints it.
  const breu=tokenColor('--c-breu'),cone=tokenColor('--c-cone');
  make(FX.warning,40,40,g=>{
    g.fillStyle(papel,1).fillCircle(20,20,19);g.fillStyle(breu,1).fillCircle(20,20,17);g.fillStyle(cone,1).fillCircle(20,20,14);
    g.fillStyle(breu).fillRoundedRect(17,9,6,14,3).fillCircle(20,29,3.4);
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
    // Elenco P1: the acting pose (EnemyView.phase 1), plain and elite, the same size as the idle one.
    if(hasActingPose(kind)){
      make(enemyTexture(kind,false,true),a.width,a.height,g=>drawEnemy(g,kind,false,true));
      make(enemyTexture(kind,true,true),Math.ceil(a.width*ELITE_SCALE),Math.ceil(a.height*ELITE_SCALE),g=>drawEnemy(g,kind,true,true));
    }
  }
  for(const kind of PICKUP_KINDS){
    const {width,height}=PICKUP_SIZE[kind];
    make(pickupTexture(kind),width,height,g=>{g.save().translateCanvas(width/2,height/2);PICKUP_DRAW[kind](g);g.restore();});
  }
  drawFx(make);
  g.destroy();
  drawBoleto(scene);
}

/**
 * Boleto of the rain (VGM-053B): a Papel slip with a Breu edge (double-edge rule on sand and grass), the Lilás bank band
 * with "R$" in Papel and the bar code. 1.4× the gem (~24 px CSS at the follow zoom, the smallest sticker size of §2.4),
 * so the rain reads as boletos and not as gems or cards. Drawn on a canvas for the "R$".
 */
export const BOLETO_SIZE={width:46,height:34} as const;
function drawBoleto(scene:Phaser.Scene){
  if(scene.textures.exists(FX.boleto))return;
  const tex=scene.textures.createCanvas(FX.boleto,BOLETO_SIZE.width,BOLETO_SIZE.height);if(!tex)return;
  const c=tex.getContext(),k=1.4,hex=(v:number)=>`#${v.toString(16).padStart(6,'0')}`;
  const breu=hex(tokenColor('--c-breu')),papel=hex(tokenColor('--c-papel')),lilas=hex(tokenColor('--c-lilas'));
  c.save();c.scale(k,k);
  const box=(x:number,y:number,w:number,h:number,r:number,fill:string)=>{c.fillStyle=fill;c.beginPath();c.roundRect(x,y,w,h,r);c.fill();};
  box(1,2,30,21,3,breu);box(3,4,26,17,2,papel);c.fillStyle=lilas;c.fillRect(3,4,26,6);
  c.fillStyle=papel;c.font='900 6.5px "Londrina Solid", sans-serif';c.textBaseline='middle';c.fillText('R$',5,7.4);
  const bars=[1,2,1,1,3,1,2,1,1,2,1,3,1,1,2];let x=5;c.fillStyle=breu;
  for(const [i,w] of bars.entries()){if(i%2===0)c.fillRect(x,12,w*.8,7);x+=w*.8+.6;if(x>27)break;}
  c.restore();tex.refresh();
}

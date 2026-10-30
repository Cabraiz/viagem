/** The procedural vehicles, pickups and fx (shadow, puff, projectiles, bars, spawn warning); index.ts generates the textures. */
import {tokenColor} from '../../ui/tokens.ts';
import {FX} from '../keys.ts';
import type {VehicleKind} from '../../../contract/index.ts';
import {type G,type Shape,TAU,jitter,ell,starPts,sil,poly,line,sparkle} from './shapes.ts';

/**
 * Veículos, provisional art (56 × 48, centred): the "Vrum" scooter (green deck, the dead battery's red light), the
 * shopping cart with the bent wheel and the 2019 lettuce, the crossfiteiro de folga (tank top, headband, biceps).
 */
export const VEHICLE_DRAW:Record<VehicleKind,(g:G)=>void>={
  patinete:g=>{
    sil(g,[['c',-16,15,5],['c',16,15,5]],0x2b2b33,0x111118);
    g.fillStyle(0x9aa0a8).fillCircle(-16,15,1.8).fillCircle(16,15,1.8);
    sil(g,[['r',-20,7,36,6,3]],0x3fbf6a,0x1d6b38);
    line(g,[13,9,9,-17],0x5a6068,4);line(g,[2,-18,16,-16],0x2b2b33,4);
    g.fillStyle(0xe5394a).fillRoundedRect(-12,8.5,6,3,1);
    g.fillStyle(0xffffff,.5).fillRect(-17,8,10,1.5);
  },
  carrinho:g=>{
    sil(g,[['p',[-21,-13,21,-13,15,8,-15,8]]],0xc8d0d8,0x5d6670);
    g.fillStyle(0x9fd25a).fillCircle(4,-14,6);g.fillStyle(0x6fae35).fillCircle(1,-15,3).fillCircle(7,-13,2.5);
    for(let x=-15;x<=15;x+=6)line(g,[x,-12,x*.72,7],0x5d6670,1.2);
    line(g,[-19,-5,19,-5],0x5d6670,1.2);line(g,[-17,2,17,2],0x5d6670,1.2);
    line(g,[-21,-13,-26,-20],0x5d6670,3);line(g,[-28,-20,-23,-20],0xe5394a,4);
    sil(g,[['c',-12,15,3.5],['c',12,15,3.5]],0x2b2b33,0x111118);
    // The wheel bent since 1998.
    g.fillStyle(0x111118).fillEllipse(0,16,9,4);g.fillStyle(0x2b2b33).fillEllipse(0,15.5,7,3);
    line(g,[-14,8,-12,12],0x5d6670,2);line(g,[14,8,12,12],0x5d6670,2);line(g,[0,8,0,13],0x5d6670,2);
  },
  crossfiteiro:g=>{
    sil(g,[['r',-9,8,7,14,2],['r',2,8,7,14,2]],0x2f3a8c,0x1a2050);
    sil(g,[['p',[-14,-10,14,-10,10,10,-10,10]]],0xd2483c,0x7a221b);
    sil(g,[['c',-17,-6,6],['c',17,-6,6],['c',-19,4,4.5],['c',19,4,4.5]],0xd9a07a,0x7e5130);
    sil(g,[['c',0,-17,7]],0xd9a07a,0x7e5130);
    g.fillStyle(0xf2c84b).fillRect(-7,-21,14,3);
    g.fillStyle(0x1e1530).fillCircle(-2.5,-16,1.1).fillCircle(2.5,-16,1.1);
    line(g,[-3,-12.5,3,-12.5],0x1e1530,1.4);
  },
};

export const PICKUP_DRAW:Record<string,(g:G)=>void>={
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
  // The kill's cédula without its art (render/cedula.ts): a mint note with a Breu edge, a darker oval and corner marks.
  grana:g=>{
    sil(g,[['r',-22,-11,44,22,3]],0x9fd8b0,0x1e4d3a,1.6);
    g.fillStyle(0xc9ecd2).fillRect(-19,-8,38,4);
    g.fillStyle(0x4f9a70).fillEllipse(0,1,15,14,16);g.fillStyle(0xe2a04a).fillEllipse(0,2,8,8,12);
    g.fillStyle(0x1e4d3a).fillRect(-18,-2,6,8).fillRect(12,-2,6,8);
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

export function drawFx(make:(key:string,w:number,h:number,draw:(g:G)=>void)=>void){
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

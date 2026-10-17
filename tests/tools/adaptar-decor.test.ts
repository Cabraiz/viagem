/**
 * Delivery adapter of the new scenery pack (scripts/art-v2/adaptar/decor.mjs, NEW-20261016-ORQ-importar-cenario-novo)
 * on a tiny SYNTHETIC delivery: the flat `cenario/` root (`<id>-0|90|180|270.png` + `<id>.meta.json`, overlays
 * `<id>-anim[-<nome>]-<view>.png`, break sheets `<id>-quebra-<view>.png`), `cenario/banco` (4 views stacked in rows) and
 * `cenario/decal` become `cenario/decor/<id>/` folders: props get their world height, places their footprint; every
 * layer and point (anims, wires, the bank screen) follows the sheet's transform; small or incomplete pieces are refused;
 * the real importer (group `cenario`, kind decor) approves what was adapted and a second run writes the same bytes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {adapt,DECOR_HEIGHT,seriesOf,ruleOf} from '../../scripts/art-v2/adaptar/decor.mjs';
import {measure,PROP_BOTTOM,BUILDING_BOTTOM} from '../../scripts/art-v2/adaptar/cenario.mjs';
import {DECOR_IDS} from '../../scripts/art-v2/decor-ids.mjs';
import {GROUPS} from '../../scripts/art-v2/spec.mjs';
import {importArtV2} from '../../scripts/import-art-v2.mjs';

sharp.cache(false);sharp.concurrency(1);

type Rec={group:string,id:string,action:string,factor?:number,notes?:string[],refused?:string};
type Img={data:Buffer,width:number,height:number};
const K=1.5,TX=84,TY=42,HU=84,DEG=['0','90','180','270'];
const MAGENTA:[number,number,number]=[250,0,250],CYAN:[number,number,number]=[0,250,250];

const canvas=(w:number,h:number):Img=>({data:Buffer.alloc(w*h*4),width:w,height:h});
function rect(img:Img,x0:number,y0:number,x1:number,y1:number,rgb:[number,number,number]){
  for(let y=Math.max(0,y0);y<Math.min(img.height,y1);y++)for(let x=Math.max(0,x0);x<Math.min(img.width,x1);x++)img.data.set([...rgb,255],(y*img.width+x)*4);
}
function fill(img:Img,pts:[number,number][],rgb:[number,number,number]){
  const ys=pts.map(p=>p[1]),xs=pts.map(p=>p[0]);
  for(let y=Math.floor(Math.min(...ys));y<=Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<=Math.ceil(Math.max(...xs));x++){
    if(x<0||y<0||x>=img.width||y>=img.height)continue;
    let inside=false;
    for(let i=0,j=pts.length-1;i<pts.length;j=i++){
      const [xi,yi]=pts[i],[xj,yj]=pts[j];
      if((yi>y+.5)!==(yj>y+.5)&&x+.5<(xj-xi)*(y+.5-yi)/(yj-yi)+xi)inside=!inside;
    }
    if(inside)img.data.set([...rgb,255],(y*img.width+x)*4);
  }
}
/** A 1×1 box h u tall at K× the engine scale, front corner at (fx, fy). */
function box(img:Img,h:number,fx:number,fy:number){
  const a=.88*K,z=h*HU*K;
  const F:[number,number]=[fx,fy],R:[number,number]=[fx+a*TX,fy-a*TY],L:[number,number]=[fx-a*TX,fy-a*TY],Bk:[number,number]=[fx,fy-2*a*TY];
  const up=(p:[number,number]):[number,number]=>[p[0],p[1]-z];
  fill(img,[L,F,up(F),up(L)],[200,80,60]);
  fill(img,[F,R,up(R),up(F)],[60,90,200]);
  fill(img,[up(F),up(R),up(Bk),up(L)],[240,240,240]);
}
const png=(img:Img)=>sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png().toBuffer();
const save=async(file:string,img:Img)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,await png(img));};
const json=(file:string,v:object)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(v));};
/** An upright bar w×h px, centred, 20 px above the bottom of a w×h cell; `mark` paints points of each view. */
function bar(cell:[number,number],h:number,w=30,mark?:[number,number][]):Img{
  const img=canvas(...cell),cx=cell[0]/2;
  rect(img,Math.round(cx-w/2),cell[1]-20-h,Math.round(cx+w/2),cell[1]-20,[90,120,60]);
  for(const [x,y] of mark??[])rect(img,x,y,x+6,y+6,CYAN);
  return img;
}
/** A root prop: 4 views of a bar + meta; `skip` leaves a view out; layers `<suffix>` = frames per view (full cell). */
async function prop(dir:string,id:string,cell:[number,number],h:number,{skip,layers={},meta={},marks}:{skip?:string,layers?:Record<string,number>,meta?:object,marks?:Record<string,[number,number][]>}={}){
  for(const d of DEG){
    if(d!==skip)await save(path.join(dir,`${id}-${d}.png`),bar(cell,h,30,marks?.[d]));
    for(const [suffix,frames] of Object.entries(layers)){
      const strip=canvas(cell[0]*frames,cell[1]);
      for(let f=0;f<frames;f++)rect(strip,f*cell[0]+cell[0]/2-15,cell[1]-20-h+f*10,f*cell[0]+cell[0]/2+15,cell[1]-20,[180,60+20*f,40]);
      await save(path.join(dir,`${id}-${suffix}-${d}.png`),strip);
    }
  }
  json(path.join(dir,`${id}.meta.json`),{cell,views:[0,90,180,270],anchor:[.5,.88],...meta});
}
/** farmacia-1: a 1×1 one-storey place with a named overlay `letreiro` (4 frames of 32²) at a magenta mark. */
const SIGN:Record<string,[number,number]>={'0':[180,150],'90':[190,152],'180':[176,148],'270':[184,150]};
async function place(dir:string){
  const cell:[number,number]=[400,400];
  for(const d of DEG){
    const img=canvas(...cell);box(img,1.6,cell[0]/2,cell[1]-30);
    const [x,y]=SIGN[d];rect(img,x,y,x+6,y+6,MAGENTA);
    await save(path.join(dir,`farmacia-1-${d}.png`),img);
    const strip=canvas(128,32);for(let f=0;f<4;f++)rect(strip,f*32+4,4,f*32+28,28,[250,200,0]);
    await save(path.join(dir,`farmacia-1-anim-letreiro-${d}.png`),strip);
  }
  json(path.join(dir,'farmacia-1.meta.json'),{cell,views:[0,90,180,270],footprint:[1,1],storeys:1,anchor:[.5,.88],anims:{letreiro:SIGN},animCell:[32,32],animFrames:4,fps:{letreiro:6}});
}
const TELA={'0':[40,100],'90':[44,102],'180':[42,98],'270':[40,100]};
async function bank(dir:string){
  const cell:[number,number]=[128,320],img=canvas(128,320*4);
  for(let v=0;v<4;v++){rect(img,34,v*320+30,94,v*320+272,[120,120,130]);const [x,y]=TELA[DEG[v] as '0'];rect(img,x,v*320+y,x+6,v*320+y+6,MAGENTA);}
  await save(path.join(dir,'juros.png'),img);
  json(path.join(dir,'juros.meta.json'),{cell,views:[0,90,180,270],footprint:[1,1],anchor:[.5,.85],tela:TELA});
  const tela=canvas(32,32*4);for(let v=0;v<4;v++)rect(tela,2,v*32+2,30,v*32+30,[0,0,250]);
  await save(path.join(dir,'juros-tela-azul.png'),tela);
  json(path.join(dir,'juros-tela-azul.meta.json'),{cell:[32,32],anchor:[.5,.85]});
  const sac=canvas(32*6,32*4);for(let v=0;v<4;v++)for(let f=0;f<6;f++)rect(sac,f*32+4,v*32+4,f*32+20+f,v*32+28,[0,200,0]);
  await save(path.join(dir,'juros-sacando.png'),sac);
  json(path.join(dir,'juros-sacando.meta.json'),{cell:[32,32],frames:6,fps:10,loop:true,anchor:[.5,.85]});
}
const WIRES={'0':[[70,60],[84,60],[96,60]],'90':[[72,62],[84,62],[94,62]],'180':[[70,60],[84,60],[96,60]],'270':[[72,62],[84,62],[94,62]]} as Record<string,[number,number][]>;
async function makeDelivery(root:string){
  const R=path.join(root,'cenario');
  await prop(R,'barril-quebravel-1',[160,240],150,{layers:{quebra:4}});
  await prop(R,'fogueira-tambor-1',[160,280],200,{layers:{anim:6},meta:{fps:8}});
  await prop(R,'poste-concreto-1',[160,460],400,{meta:{wires:WIRES},marks:Object.fromEntries(DEG.map(d=>[d,WIRES[d].map(([x,y])=>[x-3,y-3] as [number,number])]))});
  await prop(R,'luminaria-quebrada-pisca-1',[160,240],100);
  await prop(R,'vaso-planta-1',[160,240],100,{skip:'270'});
  await place(R);
  await bank(path.join(R,'banco'));
  const decal=canvas(64,32);fill(decal,[[32,2],[62,16],[32,30],[2,16]],[60,60,60]);await save(path.join(R,'decal/bueiro.png'),decal);
}
const tree=(dir:string)=>{
  const out:Record<string,string>={};
  const walk=(d:string)=>{for(const e of readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else out[path.relative(dir,f)]=createHash('sha256').update(readFileSync(f)).digest('hex');}};
  walk(dir);return out;
};
async function raw(file:string){const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,width:info.width,height:info.height};}
function cellOf(img:Img,c:number,r:number,w:number,h:number):Img{
  const data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)img.data.copy(data,y*w*4,((r*h+y)*img.width+c*w)*4,((r*h+y)*img.width+c*w+w)*4);
  return {data,width:w,height:h};
}
const px=(img:Img,x:number,y:number)=>[...img.data.subarray((y*img.width+x)*4,(y*img.width+x)*4+4)];
/** True when a pixel within 2 px of (x, y) has the colour (±70 per channel, opaque). */
function near(img:Img,x:number,y:number,rgb:[number,number,number]){
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const p=px(img,x+dx,y+dy);if(p[3]>200&&rgb.every((c,i)=>Math.abs(p[i]-c)<70))return true;}
  return false;
}

test('decor ids: 223 unique stems, no break sheet or overlay among them, every one expected by the cenario group',()=>{
  assert.equal(DECOR_IDS.length,223);
  assert.equal(new Set(DECOR_IDS).size,223);
  assert.ok(!DECOR_IDS.some(id=>/-quebra$|-anim(-|$)/.test(id)));
  assert.deepEqual(Object.keys(GROUPS.cenario.expected),[...DECOR_IDS]);
  assert.equal(GROUPS.cenario.kind,'decor');
  assert.equal(seriesOf('grade-portao-intacto'),'grade-portao');
  assert.equal(seriesOf('poste-concreto-3'),'poste-concreto');
  assert.equal(ruleOf('muro-pichado-reto-quebrado',{}),'wall');
  assert.equal(ruleOf('ninho-festa-ativo',{}),'building');
  assert.equal(ruleOf('farmacia-1',{storeys:1}),'building');
  assert.equal(ruleOf('bicicleta-1',{}),'prop');
});

test('decor adapter: world height, layers and points through the sheet transform, bank, decal, refusals, importer, idempotence',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'adaptar-decor-'));
  try{
    const src=path.join(dir,'entrega'),out=path.join(dir,'out'),D=path.join(out,'cenario/decor');
    await makeDelivery(src);
    const before=tree(src);
    const recs=await adapt({src,out}) as Rec[];
    const by=Object.fromEntries(recs.map(r=>[r.id,r]));
    assert.deepEqual(tree(src),before,'the delivery is never touched');
    const side=(id:string,name='sheet')=>JSON.parse(readFileSync(path.join(D,id,`${name}.json`),'utf8'));

    // Props: drawn height = world height, lowest row PROP_BOTTOM px above the cell bottom, anchor on it.
    for(const id of ['barril-quebravel-1','fogueira-tambor-1','poste-concreto-1']){
      assert.ok(!by[id].refused,`${id}: ${by[id].refused}`);
      const sc=side(id),[W,H]=sc.cell,sheet=await raw(path.join(D,id,'sheet.png'));
      assert.deepEqual([sheet.width,sheet.height,sc.views],[4*W,H,4]);
      assert.equal(sc.anchor[1],+(1-PROP_BOTTOM/H).toFixed(6));
      for(let v=0;v<4;v++){const m=measure([cellOf(sheet,v,0,W,H)]);
        assert.ok(Math.abs(m.h-DECOR_HEIGHT[seriesOf(id)]*HU)<=3,`${id} view ${v}: height ${m.h}`);assert.equal(m.y1,H-PROP_BOTTOM);}
    }
    // Full-cell layers: same cell as the sheet, 4 view rows × the delivered frames; fps carried.
    const q=side('barril-quebravel-1','quebra');
    assert.deepEqual([q.cell,q.frames,q.views],[side('barril-quebravel-1').cell,4,4]);
    const fa=side('fogueira-tambor-1','anim');
    assert.deepEqual([fa.cell,fa.frames,fa.views,fa.fps],[side('fogueira-tambor-1').cell,6,4,8]);
    const qi=await raw(path.join(D,'barril-quebravel-1','quebra.png'));
    assert.deepEqual([qi.width,qi.height],[4*q.cell[0],4*q.cell[1]]);
    // The break sheet's frame 0 sits exactly where the sheet's object is (same placement).
    const s0=measure([cellOf(await raw(path.join(D,'barril-quebravel-1','sheet.png')),0,0,...q.cell as [number,number])]),q0=measure([cellOf(qi,0,0,...q.cell as [number,number])]);
    assert.ok(Math.abs(s0.x0-q0.x0)<=1&&Math.abs(s0.y1-q0.y1)<=1,`quebra frame 0 ${JSON.stringify(q0)} vs sheet ${JSON.stringify(s0)}`);

    // Wires: every rewritten point lands on the cyan mark drawn at the delivered point.
    const ps=side('poste-concreto-1'),pimg=await raw(path.join(D,'poste-concreto-1','sheet.png'));
    for(const [v,d] of DEG.entries()){
      assert.equal(ps.meta.wires[d].length,3);
      for(const [x,y] of ps.meta.wires[d])assert.ok(near(cellOf(pimg,v,0,ps.cell[0],ps.cell[1]),x,y,CYAN),`wire ${d}° at ${x},${y}`);
    }

    // Place: footprint rule, named overlay scaled with the piece, its position on the magenta mark.
    assert.ok(!by['farmacia-1'].refused,by['farmacia-1'].refused);
    assert.match(by['farmacia-1'].notes?.join(' ')??'',/rule: building/);
    const fs_=side('farmacia-1'),f=by['farmacia-1'].factor as number;
    assert.ok(Math.abs(f-1/K)<.03,`factor ${f}`);
    assert.equal(fs_.anchor[1],+(1-BUILDING_BOTTOM/fs_.cell[1]).toFixed(6));
    assert.deepEqual(fs_.meta.fps,{letreiro:6});
    const ov=side('farmacia-1','anim-letreiro');
    assert.deepEqual([ov.cell,ov.frames,ov.views,ov.fps],[[Math.round(32*f),Math.round(32*f)],4,4,6]);
    const fimg=await raw(path.join(D,'farmacia-1','sheet.png'));
    for(const [v,d] of DEG.entries()){const [x,y]=fs_.meta.anims.letreiro[d];
      assert.ok(near(cellOf(fimg,v,0,fs_.cell[0],fs_.cell[1]),x+1,y+1,MAGENTA),`letreiro ${d}° at ${x},${y}`);}

    // Bank: rows → columns at the machine's factor (2.6 u), screens and cash animation as anim-<suffix>, screen point scaled.
    assert.ok(!by.juros.refused,by.juros.refused);
    const bj=side('juros'),bf=by.juros.factor as number;
    assert.ok(Math.abs(bf-DECOR_HEIGHT.banco*HU/242)<.01,`bank factor ${bf}`);
    assert.deepEqual([bj.views,bj.anchor],[4,[.5,.85]]);
    assert.ok(Math.abs(bj.cell[0]-128*bf)<=1&&Math.abs(bj.cell[1]-320*bf)<=1,`bank cell ${bj.cell}`);
    assert.deepEqual(Object.keys(bj.meta.anims).sort(),['sacando','tela-azul']);
    assert.deepEqual(bj.meta.anims.sacando,bj.meta.tela);
    assert.deepEqual([bj.meta.fps,bj.meta.loop],[{sacando:10},{sacando:true}]);
    const bimg=await raw(path.join(D,'juros','sheet.png'));
    for(const [v,d] of DEG.entries()){const [x,y]=bj.meta.tela[d];assert.ok(near(cellOf(bimg,v,0,bj.cell[0],bj.cell[1]),x+1,y+1,MAGENTA),`tela ${d}° at ${x},${y}`);}
    const sac=side('juros','anim-sacando');
    assert.deepEqual([sac.frames,sac.views,sac.fps],[6,4,10]);
    assert.ok(sac.cell.every((n:number)=>Math.abs(n-32*bf)<=1),`sacando cell ${sac.cell}`);
    assert.ok(!existsSync(path.join(D,'juros-sacando')),'bank layers are files of the machine, not ids');

    // Decal: copied as delivered, 1 view, anchored at its centre.
    assert.deepEqual([side('bueiro').cell,side('bueiro').views,side('bueiro').anchor],[[64,32],1,[.5,.5]]);

    // Refusals: drawn too small for its world height; a view missing.
    assert.match(by['luminaria-quebrada-pisca-1'].refused??'',/upscaled ×2\.1/);
    assert.match(by['vaso-planta-1'].refused??'',/incomplete delivery: vaso-planta-1-270\.png/);
    for(const id of ['luminaria-quebrada-pisca-1','vaso-planta-1'])assert.ok(!existsSync(path.join(D,id)),`${id} not written`);

    // The real importer approves everything that was adapted.
    const {pieces}=await importArtV2({input:out,groups:['cenario'],write:false});
    const got=pieces.filter((p:{status:string})=>p.status==='aprovado'||p.status==='reprovado');
    for(const p of got)assert.equal(p.status,'aprovado',`${p.id}: ${p.problems.join(' | ')}`);
    assert.deepEqual(got.map((p:{id:string})=>p.id).sort(),recs.filter(r=>!r.refused).map(r=>r.id).sort());

    // Idempotent: a second run writes the same bytes.
    const first=tree(out);
    await adapt({src,out});
    assert.deepEqual(tree(out),first);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

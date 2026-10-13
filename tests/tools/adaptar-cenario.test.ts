/**
 * Delivery adapter of the standing scenery (scripts/art-v2/adaptar/cenario.mjs, NEW-20261012-ORQ-adaptar-entrega-codex)
 * on a tiny SYNTHETIC delivery drawn with the city projection at 1.5× the engine scale: one PNG per view
 * (`<stem>-v0..v3.png`) + `<stem>.meta.json` become one sheet + an importer-only sidecar under the spec ids; buildings
 * are rescaled so the footprint lands at (a+b)·0.88·TILE_X·ART_SCALE px with the front corner on buildingAnchor's point;
 * props get their world height; base states merge into one piece (rows in the spec's order); broken views are refused;
 * the run is idempotent and the real importer approves what was adapted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {adapt,measure,WORLD_HEIGHT,BUILDING_BOTTOM,PROP_BOTTOM,cornerOffset} from '../../scripts/art-v2/adaptar/cenario.mjs';
import {SIDECAR_KEYS} from '../../scripts/art-v2/validate.mjs';
import {GROUPS} from '../../scripts/art-v2/spec.mjs';
import {importArtV2} from '../../scripts/import-art-v2.mjs';

sharp.cache(false);sharp.concurrency(1);

type Rec={group:string,id:string,action:string,factor?:number,notes?:string[],refused?:string};
type Img={data:Buffer,width:number,height:number};
const K=1.5,TX=84,TY=42,HU=84;

const canvas=(w:number,h:number):Img=>({data:Buffer.alloc(w*h*4),width:w,height:h});
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
/** A box A×B (cells) × h (u) seen in one view at K× the engine scale, front corner at (fx, fy). */
function box(img:Img,A:number,B:number,h:number,fx:number,fy:number){
  const a=A*.88*K,b=B*.88*K,z=h*HU*K;
  const F:[number,number]=[fx,fy],R:[number,number]=[fx+b*TX,fy-b*TY],L:[number,number]=[fx-a*TX,fy-a*TY],Bk:[number,number]=[fx+(b-a)*TX,fy-(a+b)*TY];
  const up=(p:[number,number]):[number,number]=>[p[0],p[1]-z];
  fill(img,[L,F,up(F),up(L)],[200,80,60]);
  fill(img,[F,R,up(R),up(F)],[60,90,200]);
  fill(img,[up(F),up(R),up(Bk),up(L)],[240,240,240]);
}
const save=async(file:string,img:Img)=>{mkdirSync(path.dirname(file),{recursive:true});await sharp(img.data,{raw:{width:img.width,height:img.height,channels:4}}).png().toFile(file);};
const json=(file:string,v:object)=>{mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,JSON.stringify(v));};
/** 4 views of an a×b building; `wrong` = views drawn with the footprint turned (b×a) where the list says so. */
async function building(dir:string,stem:string,[a,b]:[number,number],h:number,wrong:boolean[]=[false,false,false,false]){
  const cw=400,ch=400;
  for(let v=0;v<4;v++){
    const turned=(v%2===1)!==wrong[v],A=turned?b:a,B=turned?a:b,img=canvas(cw,ch);
    box(img,A,B,h,cw/2+(A-B)/2*.88*K*TX,ch-30);
    await save(path.join(dir,`${stem}-v${v}.png`),img);
  }
  json(path.join(dir,`${stem}.meta.json`),{cell:[cw,ch],views:[0,90,180,270],footprint:[a,b],storeys:1,worldCell:.88,anchor:[.5,.88],checks:[],provenance:'test'});
}
/** A prop: an upright bar w×h px, centred, 20 px above the bottom; `widths` per view (180°-apart pairs may differ). */
async function prop(dir:string,stem:string,cell:[number,number],h:number,widths=[40,40,40,40],frames=1){
  for(let v=0;v<4;v++){
    const img=canvas(cell[0]*frames,cell[1]);
    for(let k=0;k<frames;k++){const cx=k*cell[0]+cell[0]/2,w=widths[v];fill(img,[[cx-w/2,cell[1]-20],[cx+w/2,cell[1]-20],[cx+w/2,cell[1]-20-h],[cx-w/2,cell[1]-20-h]],[90+20*k,120,60]);}
    await save(path.join(dir,`${stem}-v${v}.png`),img);
  }
  json(path.join(dir,`${stem}.meta.json`),{cell,frames,views:[0,90,180,270],anchor:[.5,.88],fps:8,source:'test'});
}
async function makeDelivery(root:string){
  const P=path.join(root,'cenario/predios'),R=path.join(root,'cenario/props'),B=path.join(root,'cenario/base');
  await building(P,'casa-terrea-2x1-1',[2,1],2);
  await building(P,'sobrado-2x1-1',[2,1],2,[false,true,false,false]);
  await building(P,'entulho-2x1-1',[2,1],1,[true,true,true,true]);
  await building(P,'casa-terrea-1x1-1',[1,1],2);
  await prop(R,'poste-aceso-1',[160,400],300,[30,30,30,30]);
  await prop(R,'poste-apagado-1',[160,400],300,[30,30,30,30]);
  await prop(R,'cone-1',[160,400],300,[60,60,60,60]);
  for(const s of ['inteira','avariada','quase-caindo','ruina'])await prop(B,`muralha-${s}`,[200,300],200,[150,140,150,140]);
  for(const s of ['cheio','meio','vazio'])await prop(B,`no-pedra-${s}`,[200,300],160,[150,60,150,140]);
  await prop(B,'forja-parada',[160,200],140);
  await prop(B,'forja-acesa',[160,200],140,undefined,6);
  // 1-view loot box: closed (no meta of its own) + opening (6 frames), 64×64 cells.
  const closed=canvas(64,64);fill(closed,[[16,56],[48,56],[48,30],[16,30]],[150,100,40]);await save(path.join(B,'caixa-saque-fechada.png'),closed);
  const opening=canvas(384,64);for(let k=0;k<6;k++)fill(opening,[[k*64+16,56],[k*64+48,56],[k*64+48,30-k],[k*64+16,30-k]],[150,100,40]);
  await save(path.join(B,'caixa-saque-abrindo.png'),opening);
  json(path.join(B,'caixa-saque-abrindo.meta.json'),{cell:[64,64],frames:6,anchor:[.5,.88],files:['caixa-saque-abrindo.png','caixa-saque-fechada.png']});
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

test('cenario adapter: sheets, engine scale and anchor, merged base states, refusals, importer approval, idempotence',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'adaptar-cenario-'));
  try{
    const src=path.join(dir,'entrega'),out=path.join(dir,'out');
    await makeDelivery(src);
    const before=tree(src);
    const recs=await adapt({src,out}) as Rec[];
    const by=Object.fromEntries(recs.map(r=>[`${r.group}/${r.id}`,r]));
    assert.deepEqual(tree(src),before,'the delivery is never touched');

    // Building: one sheet of 4 views; footprint width at engine scale (factor 1/K); front corner per buildingAnchor.
    const casa=by['predios/casa-terrea-2x1-1'];
    assert.ok(!casa.refused,casa.refused);
    assert.ok(Math.abs((casa.factor as number)-1/K)<.02,`factor ${casa.factor}`);
    const sc=JSON.parse(readFileSync(path.join(out,'cenario/predios/casa-terrea-2x1-1.json'),'utf8'));
    for(const k of Object.keys(sc))assert.ok(SIDECAR_KEYS.includes(k),`unknown sidecar key ${k}`);
    assert.deepEqual(sc.meta,{footprint:[2,1],storeys:1});
    const [W,H]=sc.cell;
    assert.equal(sc.anchor[1],+(1-BUILDING_BOTTOM/H).toFixed(6));
    const sheet=await raw(path.join(out,'cenario/predios/casa-terrea-2x1-1.png'));
    assert.deepEqual([sheet.width,sheet.height],[4*W,H]);
    for(let v=0;v<4;v++){
      const m=measure([cellOf(sheet,v,0,W,H)]);
      assert.equal(m.y1,H-BUILDING_BOTTOM,`view ${v}: front corner row`);
      assert.ok(Math.abs(m.footX-(W/2+cornerOffset([2,1],v)))<=3,`view ${v}: front corner x ${m.footX} vs ${W/2+cornerOffset([2,1],v)}`);
      assert.ok(Math.abs(m.w-2.64*TX)<=4,`view ${v}: footprint width ${m.w}`);
    }
    assert.ok(by['predios/casa-terrea-1x1-1'].notes?.some(n=>/storey ≈/.test(n)));

    // Wrong orientation in one view → refused; in every view → the b×a turn, views shifted by one.
    assert.match(by['predios/sobrado-2x1-1'].refused??'',/long side runs the wrong way in view 90°/);
    assert.ok(!existsSync(path.join(out,'cenario/predios/sobrado-2x1-1.png')));
    assert.ok(!by['predios/entulho-2x1-1'].refused);
    assert.ok(by['predios/entulho-2x1-1'].notes?.some(n=>/views shifted by one/.test(n)));

    // Props: renamed, poste rows merged in the spec's order, world height applied.
    const poste=JSON.parse(readFileSync(path.join(out,'cenario/props/poste.json'),'utf8'));
    assert.deepEqual(poste.rows,['aceso','apagado']);
    const ps=await raw(path.join(out,'cenario/props/poste.png'));
    for(let r=0;r<2;r++){const m=measure([cellOf(ps,0,r,poste.cell[0],poste.cell[1])]);
      assert.ok(Math.abs(m.h-WORLD_HEIGHT.poste*HU)<=3,`poste height ${m.h}`);assert.equal(m.y1,poste.cell[1]-PROP_BOTTOM);}
    assert.ok(existsSync(path.join(out,'cenario/props/cone-transito.png')),'cone-1 → cone-transito');

    // Base: states merged into the spec id, rows = spec rows; 1-view loot box kept as delivered; 180° mismatch refused.
    const mur=JSON.parse(readFileSync(path.join(out,'cenario/base/muralha-acampamento.json'),'utf8'));
    assert.deepEqual(mur.rows,GROUPS.base.expected['muralha-acampamento'].rows);
    assert.ok(!by['base/forja'].refused,JSON.stringify(by['base/forja']));
    const forja=JSON.parse(readFileSync(path.join(out,'cenario/base/forja.json'),'utf8'));
    assert.deepEqual(forja.rows,GROUPS.base.expected.forja.rows);
    const caixa=JSON.parse(readFileSync(path.join(out,'cenario/base/caixa-saque.json'),'utf8'));
    assert.deepEqual([caixa.cell,caixa.views,caixa.rows,caixa.anchor],[[64,64],1,GROUPS.base.expected['caixa-saque'].rows,[.5,.88]]);
    assert.match(by['base/no-pedra'].refused??'',/views 180° apart must be the same size/);

    // The real importer approves everything that was adapted.
    const {pieces}=await importArtV2({input:out,groups:['predios','props','base'],write:false});
    const got=pieces.filter((p:{status:string})=>p.status==='aprovado'||p.status==='reprovado');
    for(const p of got)assert.equal(p.status,'aprovado',`${p.group}/${p.id}: ${p.problems.join(' | ')}`);
    assert.equal(got.length,recs.filter(r=>!r.refused).length);

    // Idempotent: a second run writes the same bytes.
    const first=tree(out);
    await adapt({src,out});
    assert.deepEqual(tree(out),first);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

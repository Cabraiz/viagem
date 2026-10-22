import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {ALPHA,RECORD,RIM,RULES,analyzeCell,clearMask,readRecord,sheets} from '../../scripts/sheet-cells.mjs';

// BUG-20261022-ORQ-quadro-sangra-vizinho: no piece cut off by a cell's edge, nothing on a cell's outer ring (LINEAR
// filtering bleeds it into the next frame) and no background left around a figure, in every character and enemy sheet.

const W=32;
const blank=()=>new Uint8ClampedArray(W*W*4);
const paint=(d:Uint8ClampedArray,x0:number,y0:number,x1:number,y1:number,rgb:number[],a=255)=>{
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const o=(y*W+x)*4;d[o]=rgb[0];d[o+1]=rgb[1];d[o+2]=rgb[2];d[o+3]=a;}
};
const alpha=(d:Uint8ClampedArray,x:number,y:number)=>d[(y*W+x)*4+3];

test('a piece cut off by the edge fails and goes; a loose prop inside stays; the outer ring is cleared', ()=>{
  const d=blank();
  paint(d,10,8,20,28,[90,60,40]);   // the figure
  paint(d,0,12,3,15,[230,180,140]); // a hand whose arm is outside the cell
  paint(d,25,4,27,6,[200,40,40]);   // a thrown prop, apart from the figure, inside
  const mask=new Uint8Array(W*W),c=analyzeCell(d,W,0,0,W,W,mask);
  assert.equal(c.cut.length,1);assert.deepEqual(c.cut[0].box,[0,12,3,15]);
  assert.equal(c.ilhas.length,1);assert.equal(c.borda,4,'the hand sits on the ring');
  clearMask(d,W,0,0,W,W,mask);
  assert.equal(alpha(d,1,13),0);assert.equal(alpha(d,26,5),255);assert.equal(alpha(d,15,15),255);
  const again=analyzeCell(d,W,0,0,W,W);
  assert.equal(again.cut.length+again.borda+again.fundo,0);
});

test('a background inside the baked rim is found and removed, the figure gets the rim back; a glow is drawn', ()=>{
  const d=blank();
  paint(d,4,2,27,29,RIM,217);                // the importer's rim around the whole alpha
  paint(d,5,3,26,28,[249,225,192]);          // the cream background
  paint(d,11,8,20,24,[90,60,40]);            // the figure on it
  const mask=new Uint8Array(W*W),c=analyzeCell(d,W,0,0,W,W,mask);
  assert.ok(c.fundo>=RULES.haloArea,`fundo ${c.fundo}`);
  clearMask(d,W,0,0,W,W,mask);
  assert.equal(alpha(d,6,5),0,'background gone');assert.equal(alpha(d,4,10),0,'its rim gone');
  assert.equal(alpha(d,15,15),255,'figure kept');
  // The figure's new rim: the px just left of it.
  const left=(15*W+10)*4;assert.deepEqual([...d.slice(left,left+4)],[...RIM,217]);
  // A glow (a flashlight beam) touches the outside directly: drawn, not a background.
  const g=blank();
  paint(g,4,10,12,20,[90,60,40]);paint(g,13,8,28,22,[255,240,200]);
  assert.equal(analyzeCell(g,W,0,0,W,W).fundo,0);
});

test('every character and enemy sheet (full and lite) is in the record, fresh, and clean', ()=>{
  const record=readRecord();
  assert.deepEqual(record.rules,RULES,'regras novas: node scripts/sheet-cells.mjs');
  const stale:string[]=[],dirty:string[]=[];
  for(const s of sheets()){
    if(!existsSync(s.path))continue;
    const e=record.files[s.key],sha=createHash('sha256').update(readFileSync(s.path)).digest('hex');
    if(e?.sha!==sha){stale.push(s.key);continue;}
    if(e.fails.length&&!KNOWN[s.key])dirty.push(`${s.key}: ${e.fails.map((f:{frame:number})=>f.frame).join(',')}`);
    if(KNOWN[s.key])assert.ok(e.fails.length,`${s.key} já passa: tire de KNOWN`);
  }
  assert.deepEqual(stale,[],`folhas mudaram: node scripts/sheet-cells.mjs (${RECORD})`);
  assert.deepEqual(dirty,[],'quadro com corte, borda ou fundo: node scripts/sheet-cells.mjs --fix --report');
  assert.ok(ALPHA>0);
});

/**
 * Sheets that still fail, each with why it is not fixed here. Heroes' sheets carry their content's sha in the name
 * (import-movimento128/16), so they go back to the importer instead of being patched in place.
 */
const KNOWN:Record<string,string>={};

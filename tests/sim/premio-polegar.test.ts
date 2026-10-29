// Prizes never under a thumb nor out of reach (VGM-053B review M3, pacote-bugs-ux): the server's rule against the thumb
// zones measured on the real scene (crates and arsenal prizes use it), and real matches with no coxinha on the ground (the
// boleto rain and the flash sale are retired: NEW-20261024-ORQ-tirar-drops-cedula-girando, NEW-20261025-ORQ-sem-coxinha-no-chao).
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,Simulation} from '../../multiplayer/simulation.ts';
import {projectView} from '../../src/client/projection.ts';
import {followZoom} from '../../src/client/framing.ts';
import {THUMB_MARGIN_PX,THUMB_ZONES,THUMB_ZOOM,parseZueiraLab,prizeSpotSafe,underThumb} from '../../src/sim/zueira.ts';

/**
 * Thumb zones relative to the hero's feet (CSS px), measured on the real scene with the camera settled
 * (evidence NEW-20261012-pacote-bugs-ux/logs/zonas-polegar.json, 2 phones, 100% and 125%).
 */
const THUMBS=[
  {viewport:{width:390,height:844},zones:[{x:-228,y:193,width:160,height:160},{x:-56,y:211,width:218,height:142}]},
  {viewport:{width:390,height:844},zones:[{x:-195,y:235,width:160,height:160},{x:33,y:233,width:162,height:162}]},
  {viewport:{width:844,height:390},zones:[{x:-429,y:-7,width:144,height:144},{x:191,y:-5,width:236,height:142}]},
  {viewport:{width:844,height:390},zones:[{x:-419,y:-8,width:144,height:144},{x:199,y:-26,width:238,height:162}]},
];
/** The follow camera's look-ahead may move the hero this far on screen (15% of the useful half-width), and a sale's
 * coxinha is 1.6x a pickup (about 46 px wide): half of it counts as margin. */
const LOOK_PX=36,PRIZE_HALF_PX=23;
/** The widest ring a prize ever fell on (the retired boleto rain's, 1.4–5.5 u): the rule is checked over all of it. */
const RAIN_RADIUS:readonly [number,number]=[1.4,5.5];

test('a prize spot the rule accepts lands under no thumb, in any of the 4 views, both orientations, 100% and 125%',()=>{
  let checked=0;
  for(const {viewport,zones} of THUMBS){
    const zoom=followZoom(viewport),m=LOOK_PX+PRIZE_HALF_PX;
    for(let dx=-6;dx<=6;dx+=.25)for(let dy=-6;dy<=6;dy+=.25){
      const d=Math.hypot(dx,dy);if(d<RAIN_RADIUS[0]||d>RAIN_RADIUS[1]||!prizeSpotSafe(dx,dy))continue;
      for(let view=0;view<4;view++){
        const o=projectView({x:dx,y:dy},view),sx=o.x*zoom,sy=o.y*zoom;
        for(const z of zones)assert.ok(!(sx>z.x-m&&sx<z.x+z.width+m&&sy>z.y-m&&sy<z.y+z.height+m),
          `(${dx},${dy}) view ${view} → (${sx.toFixed(0)},${sy.toFixed(0)}) px under a thumb of ${viewport.width}x${viewport.height}`);
        checked++;
      }
    }
  }
  assert.ok(checked>1000);
  // Before the rule the ring reached under the landscape right thumb (5.5 u along the screen's x is 190 px).
  const far=projectView({x:RAIN_RADIUS[1]/Math.SQRT2,y:-RAIN_RADIUS[1]/Math.SQRT2},0).x*followZoom({width:844,height:390});
  assert.ok(far+PRIZE_HALF_PX>191-LOOK_PX,`the old ring reached ${far.toFixed(0)} px`);
  assert.equal(prizeSpotSafe(RAIN_RADIUS[1]/Math.SQRT2,-RAIN_RADIUS[1]/Math.SQRT2),false);
});

test('the server\'s thumb zones cover the measured ones; its own hero\'s ring never needs them; the projection matches',()=>{
  for(const {zones} of THUMBS)for(const z of zones)
    assert.ok(THUMB_ZONES.some(t=>t.x<=z.x&&t.y<=z.y&&t.x+t.width>=z.x+z.width&&t.y+t.height>=z.y+z.height),`zone ${JSON.stringify(z)} is not covered`);
  assert.equal(THUMB_MARGIN_PX,LOOK_PX+PRIZE_HALF_PX);
  assert.ok(Math.abs(THUMB_ZOOM-followZoom({width:390,height:844}))<.001);
  // Same screen offset as projection.ts (no relief) in every view: the server's quarter turns are the client's.
  for(const [dx,dy] of [[3,-1],[-2,4],[5,0],[.5,-4.5]]){
    // (x only: projectView without a terrain lifts the old island's relief into y; the relief is inside THUMB_MARGIN_PX.)
    const mine=[0,1,2,3].map(v=>{const qx=v===0?dx:v===1?-dy:v===2?-dx:dy,qy=v===0?dy:v===1?dx:v===2?-dy:-dx;return {x:42*(qx-qy),y:21*(qx+qy)};});
    const theirs=[0,1,2,3].map(v=>{const o=projectView({x:12+dx,y:12+dy},v),c=projectView({x:12,y:12},v);return {x:o.x-c.x,y:o.y-c.y};});
    for(const m of mine)assert.ok(theirs.some(t=>Math.abs(t.x-m.x)<1),`(${dx},${dy}) → ${JSON.stringify(m)} not in ${JSON.stringify(theirs)}`);
  }
  for(let dx=-5;dx<=5;dx+=.25)for(let dy=-5;dy<=5;dy+=.25)if(prizeSpotSafe(dx,dy))assert.equal(underThumb(dx,dy),false,`(${dx},${dy})`);
  // A teammate's thumb: 8 u to the side along the screen's x of a landscape phone (196 px) is under it.
  assert.equal(underThumb(4,-4),true);
});

test('no coxinha on the ground in real matches (sem-coxinha-no-chao): no heal pickup is born, no sale banner, kills and chests included', ()=>{
  let kills=0;
  for(const seed of [3,11,29]){
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    // An old lab plan asking for the sale: the retired kind is ignored.
    sim.zueiraLab=parseZueiraLab('promo,apagao,promo');
    const ids=['b0','b1','b2','b3','b4','b5'];ids.forEach((id,i)=>sim.add(id,`B${i}`,'cidadao-comum'));sim.resetRun();
    for(let t=0;t<20*60*5&&sim.world.round.index<=3;t++){
      for(const p of sim.players.values()){p.invulnerableUntil=sim.tick+40;p.hp=Math.max(1,p.hp-1);}
      ids.forEach((id,i)=>{const a=2*Math.PI*(sim.tick/200+i/6);sim.input(id,{seq:sim.tick+1,x:Math.cos(a),y:Math.sin(a),attack:false});});
      for(const e of sim.step()){
        assert.ok(!(e.type==='happening'&&e.kind==='promo'),`seed ${seed}: a sale fired`);
        if(e.type==='kill')kills++;
      }
      for(const p of sim.world.pickups.values())assert.notEqual(p.kind,'heal',`seed ${seed}: ${p.id} is a coxinha on the ground`);
      for(const id of ids){const o=sim.offers(id)[0];if(o)sim.choose(id,o.id,o.defaultIndex);}
      // Every critter dies a second after it shows up (by a hero, so the kill rolls its loot).
      for(const e of [...sim.world.enemies.values()])if(!e.boss&&sim.tick-e.spawnTick>20)sim.world.damageEnemy(e.id,1e6,ids[sim.tick%ids.length]);
    }
  }
  assert.ok(kills>=150,`only ${kills} kills`);
});

// Prizes never under a thumb nor out of reach (VGM-053B review M3, pacote-bugs-ux): the server's rule against the thumb
// zones measured on the real scene, and every boleto and coxinha of real rains and sales on the endless map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,Simulation} from '../src/game/net/shared.ts';
import {projectView} from '../src/game/projection.ts';
import {followZoom} from '../src/game/framing.ts';
import {BOLETO,PRIZE_SCREEN_SPAN,PROMO,PROMO_RADIUS,RAIN_RADIUS,parseZueiraLab,prizeSpotSafe} from '../src/game/sim/zueira.ts';
import {clearSegment,walkable} from '../src/game/world.ts';

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
  assert.ok(PROMO_RADIUS[1]<=PRIZE_SCREEN_SPAN/Math.SQRT2+.5,'the sale ring is (almost) all inside the rule');
});

test('real rains and sales on the endless map: every boleto and coxinha is in the rule and a straight walk from its hero',()=>{
  let prizes=0;
  for(const seed of [3,11,29]){
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    sim.zueiraLab=parseZueiraLab('boletos,promo');
    const ids=['b0','b1','b2'];ids.forEach((id,i)=>sim.add(id,`B${i}`,'cidadao-comum'));sim.resetRun();
    const seen=new Set<string>();
    for(let t=0;t<20*60*5&&sim.world.round.index<=3;t++){
      for(const p of sim.players.values())p.invulnerableUntil=sim.tick+40;
      // Heroes walk apart in circles, so the drops land on varied ground (trees, rocks, water).
      ids.forEach((id,i)=>{const a=2*Math.PI*(sim.tick/200+i/3);sim.input(id,{seq:sim.tick+1,x:Math.cos(a),y:Math.sin(a),attack:false});});
      sim.step();
      const standing=[...sim.players.values()].filter(p=>!p.downed);
      for(const p of sim.world.pickups.values()){
        if((p.resource!==BOLETO&&p.resource!==PROMO)||seen.has(p.id))continue;
        seen.add(p.id);prizes++;
        assert.ok(walkable(p,sim.terrain),`${p.id} on unwalkable ground`);
        // Dropped this tick around one of the standing heroes (positions before this tick's move are within a step).
        assert.ok(standing.some(h=>prizeSpotSafe(p.x-h.x,p.y-h.y)&&clearSegment(h,p,sim.terrain))||standing.some(h=>Math.abs(p.x-h.x)+Math.abs(p.y-h.y)<=PRIZE_SCREEN_SPAN+.4),
          `${p.id} (${p.resource}) at (${p.x.toFixed(2)},${p.y.toFixed(2)}) is out of the rule for every hero`);
      }
      for(const id of ids){const o=sim.offers(id)[0];if(o)sim.choose(id,o.id,o.defaultIndex);}
      for(const e of [...sim.world.enemies.values()])if(sim.tick-e.spawnTick>60)sim.world.enemies.delete(e.id);
    }
  }
  assert.ok(prizes>=60,`only ${prizes} prizes dropped`);
});

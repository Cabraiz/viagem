import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PROJECTILE_LEAD_TICKS,projectileLeadSeconds} from '../../src/client/render/motion.ts';
import {SIM_HZ} from '../../src/contract/index.ts';

const TICK_MS=1000/SIM_HZ;

test('a shot of known speed is drawn where the sim has it (within 1 cell), not 20× ahead', ()=>{
  // The sim moves a linear shot by vx·(1/SIM_HZ) per tick (src/sim/projectiles.ts): vx is in units per second.
  const vx=12,cell=1;
  for(const elapsedMs of [0,10,25,49,50,75,100]){
    const simX=vx*Math.min(elapsedMs,PROJECTILE_LEAD_TICKS*TICK_MS)/1000;
    const drawnX=vx*projectileLeadSeconds(1000+elapsedMs,1000,TICK_MS);
    assert.ok(Math.abs(drawnX-simX)<1e-9,`${elapsedMs} ms: drawn ${drawnX} vs sim ${simX}`);
    assert.ok(Math.abs(drawnX-simX)<cell);
  }
  // The old formula (lead in ticks) put a 12 u/s shot 24 u ahead after two ticks; now 1.2 u.
  assert.ok(Math.abs(vx*projectileLeadSeconds(1100,1000,TICK_MS)-1.2)<1e-9);
});

test('lead never goes back in time and is capped at two ticks (a late frame does not throw the shot far ahead)', ()=>{
  assert.equal(projectileLeadSeconds(900,1000,TICK_MS),0);
  assert.equal(projectileLeadSeconds(5000,1000,TICK_MS),PROJECTILE_LEAD_TICKS*TICK_MS/1000);
});

test('the horde renderer uses the seconds lead for projectiles', ()=>{
  const src=readFileSync(new URL('../../src/client/render/layers.ts',import.meta.url),'utf8');
  const draw=src.slice(src.indexOf('private drawProjectile'),src.indexOf('private drawTelegraph'));
  assert.match(draw,/projectileLeadSeconds\(this\.now,this\.pushAt,this\.tickMs\)/);
  assert.doesNotMatch(draw,/\/this\.tickMs\)\)/,'no lead in ticks');
});

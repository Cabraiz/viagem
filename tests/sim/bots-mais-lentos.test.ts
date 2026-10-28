/**
 * Card NEW-20261025-ORQ-bots-20-mais-lentos (user, 25/10: "bots têm que ter 20 % menos velocidade que a gente"):
 *  1. in the room, a bot of the same class walks BOT_WALK_MULT (0.8) of a person's walk per tick; a person the room plays
 *     while away (the autopilot) and a bot on Simulation.personPace (the bench's person seat) walk at 1;
 *  2. the brain times its trips with that walk (botSpeed): a rescue that fits at a person's pace but not at the bot's
 *     is left alone.
 * On the REAL Cidade Nevada (the plaza), D-031: no wall-clock asserts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Simulation} from '../../multiplayer/simulation.ts';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {clearSegment,heroSpeed,walkable} from '../../src/maps/world.ts';
import {BOT_WALK_MULT} from '../../src/contract/index.ts';
import {HZ,RESCUE_SPARE,botSpeed,rescueFits} from '../../src/sim/bot-brain.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const TEXT=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
const HASH=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
const loaded=await cityTerrainFrom(TEXT,HASH);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const TICKS=10;

test('the user\'s 20 %: a room bot walks 0.8 of a person of the same class; the autopilot and the bench\'s person seat walk at 1',()=>{
  assert.equal(BOT_WALK_MULT,.8);
  const sim=new Simulation(7,{world:'cidade',terrain:city});
  sim.add('ana','Ana','cidadao-comum');
  sim.addBot('bot-1','Bot Um','cidadao-comum');
  sim.addBot('bot-2','Bot Dois','cidadao-comum');sim.personPace.add('bot-2');
  sim.resetRun();
  // Ana away: the room's light bot plays her hero (autopilot), still a person's walk.
  sim.setOnline('ana',false);
  // An open line out of the plaza, long enough for the person's TICKS steps.
  const plaza=city.asset.points.praca,reach=heroSpeed(city)*TICKS/HZ+1;
  const dirs=Array.from({length:16},(_,k)=>({x:Math.cos(k*Math.PI/8),y:Math.sin(k*Math.PI/8)}));
  const dir=dirs.find(d=>walkable(plaza,city)&&clearSegment(plaza,{x:plaza.x+d.x*reach,y:plaza.y+d.y*reach},city));
  assert.ok(dir,'an open line out of the plaza');
  const ids=['ana','bot-1','bot-2'];
  for(const id of ids){const p=sim.players.get(id)!;p.x=plaza.x;p.y=plaza.y;sim.setBotInput(id,dir!);}
  for(let i=0;i<TICKS;i++)sim.step();
  const walked=Object.fromEntries(ids.map(id=>{const p=sim.players.get(id)!;return [id,Math.hypot(p.x-plaza.x,p.y-plaza.y)];}));
  // Every seat walks the same ticks (the first step of the run may not be one): a person's walk is what Ana walked.
  const person=walked.ana,step=heroSpeed(city)/HZ;
  assert.ok(person>=step*(TICKS-1)-1e-9,`the autopiloted person walks a person's walk: ${person}`);
  assert.ok(Math.abs(person/step-Math.round(person/step))<1e-9,`whole steps of a person's walk: ${person/step}`);
  assert.ok(Math.abs(walked['bot-2']-person)<1e-9,`the person seat walks a person's walk: ${walked['bot-2']} vs ${person}`);
  assert.ok(Math.abs(walked['bot-1']-person*BOT_WALK_MULT)<1e-9,`the bot walks 0.8: ${walked['bot-1']} vs ${person*BOT_WALK_MULT}`);
});

test('the brain times its own trips at the bot\'s walk (botSpeed): a rescue that only fits at a person\'s pace is left',()=>{
  assert.ok(Math.abs(botSpeed(city)-heroSpeed(city)*BOT_WALK_MULT)<1e-12);
  // Off the streets (the island's default terrain): the straight line.
  const at={x:0,y:0},to={x:20,y:0},walk=20;
  const personTicks=Math.ceil((walk/heroSpeed()+RESCUE_SPARE)*HZ),botTicks=Math.ceil((walk/botSpeed()+RESCUE_SPARE)*HZ);
  assert.ok(personTicks<botTicks);
  assert.equal(rescueFits(at,to,personTicks,undefined),false,'enough for a person, not for the bot');
  assert.equal(rescueFits(at,to,botTicks,undefined),true,'enough for the bot');
});

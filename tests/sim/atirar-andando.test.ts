// NEW-20261028-ORQ-atirar-andando (the user: "toda arma, ao atirar, eu posso andar"): with any weapon in the hand the
// hero walks exactly as far holding the attack as without it, and the phone's replay of those steps lands on the room's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {reconcile} from '../../src/maps/index.ts';
import {segmentWire} from '../../src/protocol/input-track.ts';
import {WEAPON_COOLDOWN_TICKS} from '../../src/client/hud/weapon-reach.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {setRosterOnlyWithArt} from '../../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

/**
 * Walks `steps` ticks on a stick that turns a quarter every 20 ticks (three sides of a square), holding the attack or
 * not, around a frozen target that never dies at the square's middle; the path, the shots and the replay's inputs.
 */
function walk(weapon:string,attack:boolean,steps=60){
  const room=new Simulation(7,{combat:'manual'}),p=room.add('w','W','cidadao-comum'),seq=1000;room.resetRun();
  // Past the round's prepare (no weapon fires there).
  while(room.world.round.phase==='prepare')room.step();
  p.build.weapons=[{id:weapon,level:1}];p.build.hand=0;p.invulnerableUntil=1e9;
  const target=createEnemy(room.world,'bebado',{x:p.x+1,y:p.y+1});target.hp=target.maxHp=1e9;target.frozenUntil=1e9;
  const path:{x:number;y:number}[]=[],inputs:{seq:number;x:number;y:number;attack:boolean}[]=[];let shots=0;
  const start={x:p.x,y:p.y},tick=room.tick;
  for(let i=0;i<steps;i++){
    const a=Math.floor(i/20)*Math.PI/2,input={seq:seq+i+1,x:Math.cos(a),y:Math.sin(a),attack};
    inputs.push(input);
    // The phone's wire (a segment carries the attack bit; the legacy single input has none).
    room.input(p.id,{seq:input.seq,steps:[segmentWire({from:input.seq,x:input.x,y:input.y,skill:false,...(attack?{attack:true as const}:{})})]});
    room.step();shots+=room.events.filter(e=>e.type==='fire'&&e.player==='w').length;
    path.push({x:p.x,y:p.y});
  }
  return {path,shots,start,tick,inputs,end:{x:p.x,y:p.y},terrain:room.terrain};
}

test('every manual weapon fires while the hero walks, and the walk is the same step for step as without it',()=>{
  const weapons=Object.keys(WEAPON_COOLDOWN_TICKS);
  assert.ok(weapons.length>=30,'the whole arsenal');
  let fired=0;
  for(const weapon of weapons){
    const free=walk(weapon,false),firing=walk(weapon,true);
    if(firing.shots>0)fired++;
    for(let i=0;i<free.path.length;i++){
      assert.ok(Math.abs(free.path[i].x-firing.path[i].x)<1e-9&&Math.abs(free.path[i].y-firing.path[i].y)<1e-9,
        `${weapon}: step ${i} walked ${JSON.stringify(firing.path[i])} firing, ${JSON.stringify(free.path[i])} not`);
    }
    assert.ok(Math.hypot(firing.end.x-firing.start.x,firing.end.y-firing.start.y)>1,`${weapon}: the hero went somewhere`);
  }
  assert.ok(fired>=weapons.length*.8,`most weapons fire at the target while walking (${fired}/${weapons.length})`);
});

test('the phone replays the steps taken while firing onto the room\'s position (no correction)',()=>{
  for(const weapon of ['faca','pistola','escopeta','rojao','submetralhadora','macarico']){
    const firing=walk(weapon,true);
    const replay=reconcile(firing.start,firing.inputs,firing.terrain,{tick:firing.tick});
    assert.ok(Math.hypot(replay.x-firing.end.x,replay.y-firing.end.y)<1e-6,`${weapon}: replay ${JSON.stringify(replay)} room ${JSON.stringify(firing.end)}`);
  }
});

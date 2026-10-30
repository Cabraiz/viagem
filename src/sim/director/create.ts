/** createDirector (director.ts): its settings and helpers, the parts wired through a DirectorCtx, and the system. */
import {MAX_ENEMIES,ROUND_COUNT,drawRotation,isRotation,roundRoster} from '../../rules/index.ts';
import {Rng,SIM_HZ,type SimPlayer,ticks} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {SUMMON,hashUnit} from '../enemies/catalog.ts';
import type {Director,DirectorCtx,DirectorOptions,DirectorState} from './types.ts';
import {activePlayers,spawnPart} from './spawn-points.ts';
import {cityPart} from './city.ts';
import {tutorialPart} from './tutorial.ts';
import {wavesPart} from './waves.ts';
import {ROTATION_SALT} from './tuning.ts';

export function createDirector(options:DirectorOptions,restore?:DirectorState):Director{
  const maxEnemies=options.maxEnemies??MAX_ENEMIES;
  const intermission=ticks(options.intermissionSeconds??20),opening=ticks(options.openingSeconds??3);
  const warning=ticks(options.warningSeconds??1.5),minDistance=options.minPlayerDistance??4;
  const retreatTicks=ticks(options.retreatSeconds??3),total=Math.min(options.rounds??ROUND_COUNT,ROUND_COUNT);
  const state:DirectorState=restore?structuredClone(restore):{
    stage:'idle',rng:0,roundStart:0,nextGroup:0,pending:[],tracked:[],retreating:[],
    spawned:0,retreated:0,timedOut:false,samples:[],usedNames:[],round:{index:0,total:0,phase:'prepare',phaseEndsTick:0,remaining:0},
  };
  // A stored rotation that names entries the roster no longer has (an old checkpoint) is drawn again on the next step.
  if(state.rotation&&!isRotation(state.rotation))delete state.rotation;
  const siegeShare=Math.max(0,Math.min(1,options.siegeShare??0));
  // Without waves (D-051) the stage stays 'idle' for good, but the stream was forked on the first step: keep it.
  let rng:Rng|undefined=restore&&(restore.stage!=='idle'||options.waves===false)?new Rng(restore.rng):undefined;
  let restored=!!restore;
  const random=()=>rng!;
  const save=()=>{state.rng=rng!.state;};

  const scalePlayers=(ctx:SimContext)=>Math.max(1,Math.min(6,Math.max(activePlayers(ctx),...state.samples)));

  function sample(ctx:SimContext){
    if(ctx.tick%SIM_HZ!==0)return;
    state.samples.push(activePlayers(ctx));
    if(state.samples.length>60)state.samples.shift();
  }

  const endless=(ctx:SimContext)=>!!ctx.terrain.chunks;
  // ---------- City (cidade-05): the avenue planner ----------
  const planner=options.avenues;
  const city=(ctx:SimContext)=>!!planner&&ctx.terrain.world==='cidade';
  const viewers=(ctx:SimContext)=>[...ctx.players.values()];
  // ---------- City round 1: the tutorial walk (cidade-08, city/tutorial.ts) ----------
  /** Round `index` (default: the current one) is the city tutorial: round 1 of a city run that started it. */
  function tutorialRound(ctx:SimContext,index=ctx.round.index){return index===1&&!!state.tutorial&&city(ctx);}
  const standing=(p:SimPlayer)=>p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0;

  const dir={options,state,maxEnemies,intermission,opening,warning,minDistance,retreatTicks,total,siegeShare,planner,random,save,scalePlayers,sample,
    endless,city,viewers,tutorialRound,standing} as DirectorCtx;
  Object.assign(dir,spawnPart(dir),cityPart(dir),tutorialPart(dir),wavesPart(dir));
  const {citySpeedOf,cityTeamField,tutorialIntro,startPrepare,startWave,stepWave}=dir;

  return {
    id:'director',state,scalePlayers,
    cityTeamField:ctx=>planner&&city(ctx)?cityTeamField(ctx):undefined,
    summon(ctx,kind,at){
      const plan=state.plan;
      if(state.stage!=='wave'||!plan||ctx.enemies.size>=maxEnemies)return undefined;
      const enemy=options.createEnemy(ctx,kind,at,plan.hp*SUMMON.hp);
      if(!enemy)return undefined;
      if(!ctx.enemies.has(enemy.id))ctx.enemies.set(enemy.id,enemy);
      enemy.speed*=plan.speed;enemy.radius*=plan.size;
      if(city(ctx))enemy.speed=citySpeedOf(enemy.speed);
      enemy.readyTick=Math.max(enemy.readyTick,ctx.tick+SUMMON.readyIn);
      enemy.memory={...enemy.memory,round:plan.index};
      state.tracked.push(enemy.id);state.spawned++;
      return enemy;
    },
    roster:index=>state.rotation?roundRoster(state.rotation,index):undefined,
    bossMinionKinds(){
      const r=state.rotation;if(!r||!roundRoster(r,ROUND_COUNT).short)return undefined;
      const kinds=[...r.roles.atirador??[],...r.roles.enxame??[],...r.roles.brutamontes??[]];
      // None of them (liberated only, rules/inimigos-liberados.ts): the run's corredores (the mendigo), not the legacy list.
      return kinds.length?kinds:r.roles.corredor?.length?r.roles.corredor:undefined;
    },
    minionKinds(){
      if(!state.rotation)return undefined;
      const roles=roundRoster(state.rotation,state.plan?.index??1).roles;
      return [...roles.corredor??[],...roles.enxame??[]];
    },
    extendPrepare(ctx,endsTick){
      if(state.stage!=='prepare'||ctx.round.phase!=='prepare'||!Number.isSafeInteger(endsTick)||endsTick<=ctx.round.phaseEndsTick)return;
      ctx.round.phaseEndsTick=endsTick;state.round={...ctx.round};
    },
    step(ctx){
      if(restored){restored=false;Object.assign(ctx.round,state.round);}
      if(state.stage==='done')return;
      if(!rng){rng=ctx.rng.fork('director');save();}
      // D-040: the run's rotation, from its own stream (salted per world kind) so the director's stream is untouched.
      if(options.rotation&&!state.rotation){
        const world=city(ctx)?'cidade':endless(ctx)?'infinito':'ilha';
        state.rotation=drawRotation(new Rng((state.rng^ROTATION_SALT^Math.floor(hashUnit(world)*2**32))>>>0));
      }
      sample(ctx);
      if(options.waves===false){
        Object.assign(ctx.round,{index:1,total:1,phase:'wave',phaseEndsTick:ctx.tick,remaining:ctx.enemies.size});
        state.round={...ctx.round};return;
      }
      if(state.stage==='idle')startPrepare(ctx,1,opening);
      else if(state.stage==='wave'||ctx.tick>=ctx.round.phaseEndsTick){
        if(state.stage==='prepare')startWave(ctx);
        stepWave(ctx);
      }
      if(state.tutorial&&state.tutorial.intro===undefined&&tutorialRound(ctx))tutorialIntro(ctx);
      state.round={...ctx.round};
    },
  };
}

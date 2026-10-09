/**
 * Joke awards for the end-of-run result screen (VGM-040). Pure and deterministic: same result + tally
 * always yields the same awards, so every client shows the same jokes. No DOM.
 *
 * Rules:
 * - Each award has a per-player metric; only players with metric > 0 can win it. Ranking is metric
 *   descending, ties broken by the smaller player id.
 * - Assignment (max 2 awards per player, every award given at most once):
 *   A1. In priority order, an award goes to its top-ranked player if that player has no award yet.
 *   B.  Players still without awards (in id order) take the leftover award where they rank best
 *       (then by priority); this spreads the jokes so everybody gets roasted.
 *   A2. Remaining awards go to their top-ranked player if that player still has room.
 *   C.  With 2+ players, anyone still empty-handed gets "Figurante de luxo".
 * - Solo runs only consider awards marked `solo` (team jokes like "Turista" make no sense alone).
 */
import type {PlayerRunView} from '../sim/view.ts';
import {itemDisplay} from './items.ts';
import type {PlayerTally,RunResult,RunTally} from './model.ts';

export interface Award {id:string;title:string;emoji:string;playerId:string;line:string}

/** Max awards shown per player card. */
export const MAX_AWARDS_PER_PLAYER=2;

interface PlayerFacts {player:PlayerRunView;tally:PlayerTally;damage:number;kills:number;revives:number;pickups:number}

interface AwardDef {
  id:string;title:string;emoji:string;
  /** Allowed in a 1-player run. */
  solo:boolean;
  /** Metric for one player; <= 0 means not eligible. `all` lets an award compare against the team. */
  metric(facts:PlayerFacts,all:readonly PlayerFacts[]):number;
  line(value:number,facts:PlayerFacts,solo:boolean):string;
}

const plural=(count:number,one:string,many:string)=>`${count} ${count===1?one:many}`;

/**
 * "Build mais sem sentido" score, documented so it can be tuned:
 *   distinct items (weapons + passives)
 * + 2 × weapons beyond the number of passives (guns with nothing to back them up)
 * + 1 × items still at level 1 (picked and forgotten)
 * + 3 × items unknown to the client catalog (who even picked that?)
 * − 2 × evolutions (an evolved weapon means some focus happened)
 */
export function buildChaos(player:Pick<PlayerRunView,'weapons'|'passives'>){
  const items=[...player.weapons,...player.passives];
  let score=new Set(items.map(item=>item.id)).size;
  score+=2*Math.max(0,player.weapons.length-player.passives.length);
  for(const item of items){
    if(item.level<=1)score++;
    const kind=itemDisplay(item.id);
    if(kind.icon==='❔')score+=3;
    if(kind.kind==='evolution')score-=2;
  }
  return Math.max(0,score);
}

const buildLevels=(player:PlayerRunView)=>[...player.weapons,...player.passives].reduce((sum,item)=>sum+Math.max(0,item.level),0);
const evolutions=(facts:PlayerFacts)=>Math.max(facts.tally.evolves,facts.player.weapons.filter(item=>itemDisplay(item.id).kind==='evolution').length);
const isActive=(player:PlayerRunView)=>!player.spectator;

/** Awards in priority order (earlier ones are handed out first). */
const DEFS:readonly AwardDef[]=[
  {id:'mais-caiu',title:'Mais caiu',emoji:'🫠',solo:true,
    metric:f=>f.tally.downs,
    line:(v,_f,solo)=>solo?`Caiu ${plural(v,'vez','vezes')}. Sozinho, ainda.`:`Beijou o chão ${plural(v,'vez','vezes')}.`},
  {id:'rei-do-resgate',title:'Rei do resgate',emoji:'🚑',solo:false,
    metric:f=>f.revives,
    line:v=>`${plural(v,'resgate','resgates')}. O SAMU ligou.`},
  {id:'carregou',title:'Carregou o time',emoji:'🏋️',solo:true,
    metric:f=>f.damage,
    line:(_v,_f,solo)=>solo?'O time era você. Parabéns?':'Costas doendo de tanto carregar.'},
  {id:'exterminador',title:'Exterminador de gosma',emoji:'🧹',solo:true,
    metric:f=>f.kills,
    line:v=>`${v} bichos de volta pro mar.`},
  {id:'build-sem-sentido',title:'Build mais sem sentido',emoji:'🤡',solo:true,
    metric:f=>f.player.weapons.length+f.player.passives.length>=3?buildChaos(f.player):0,
    line:()=>'Montou no escuro. Funcionou?'},
  {id:'ima-humano',title:'Ímã humano',emoji:'🧲',solo:true,
    metric:f=>f.pickups,
    line:v=>`Catou ${v} coisas. Até chiclete.`},
  {id:'turista',title:'Turista',emoji:'📸',solo:false,
    metric:(f,all)=>{
      const active=all.filter(other=>isActive(other.player));
      if(active.length<2||!isActive(f.player))return 0;
      return Math.max(...active.map(other=>other.damage))-f.damage;
    },
    line:()=>'Veio pela vista. Tirou foto.'},
  {id:'coxinha',title:'Colecionador de coxinha',emoji:'🥟',solo:true,
    metric:f=>f.tally.heals,
    line:v=>`${plural(v,'coxinha','coxinhas')} no meio da briga.`},
  {id:'sortudo-do-bau',title:'Sortudo do baú',emoji:'🎁',solo:true,
    metric:f=>f.tally.chests,
    line:v=>`${plural(v,'baú','baús')}. Joga na Mega já.`},
  {id:'bate-nao-mata',title:'Bate mas não mata',emoji:'🥊',solo:false,
    metric:f=>f.kills>0&&f.damage>0?Math.round(f.damage/f.kills):0,
    line:()=>'Amacia pros outros matarem.'},
  {id:'evolucao',title:'Evolução de novela',emoji:'✨',solo:true,
    metric:f=>evolutions(f),
    line:()=>'Evoluiu. Último capítulo!'},
  {id:'marombeiro',title:'Marombeiro de upgrade',emoji:'💪',solo:true,
    metric:f=>buildLevels(f.player),
    line:v=>`${v} níveis de build. Só treina.`},
];

const ZERO:Readonly<PlayerTally>={downs:0,revives:0,upgrades:0,evolves:0,heals:0,magnets:0,chests:0,pickups:0,kills:0};
const FALLBACK={id:'figurante',title:'Figurante de luxo',emoji:'🎬',line:'Apareceu na foto. Valeu!'};

const byId=(a:PlayerRunView,b:PlayerRunView)=>a.id<b.id?-1:a.id>b.id?1:0;

export function computeAwards(result:RunResult,tally:RunTally):Award[]{
  const players=[...result.players].sort(byId);
  if(!players.length)return [];
  const solo=players.length===1;
  // Read-only: missing tally entries count as zero without mutating the caller's map.
  const facts:PlayerFacts[]=players.map(player=>{
    const entry=tally.players.get(player.id)??ZERO;
    const stats=player.stats;
    return {player,tally:entry,damage:Math.max(0,stats?.damage??0),kills:Math.max(stats?.kills??0,entry.kills),revives:Math.max(stats?.revives??0,entry.revives),pickups:Math.max(stats?.pickups??0,entry.pickups)};
  });
  const defs=DEFS.filter(def=>!solo||def.solo);
  // Ranking per award: eligible players by metric desc, ties → smaller id (facts are already id-sorted, sort is stable).
  const rankings=defs.map(def=>{
    const scored=facts.map(f=>({f,value:def.metric(f,facts)})).filter(entry=>Number.isFinite(entry.value)&&entry.value>0);
    return scored.sort((a,b)=>b.value-a.value);
  });
  const owned=new Map<string,Award[]>(players.map(player=>[player.id,[]]));
  const given=new Set<number>();
  const give=(index:number,rank:number)=>{
    const def=defs[index],entry=rankings[index][rank];
    given.add(index);
    owned.get(entry.f.player.id)!.push({id:def.id,title:def.title,emoji:def.emoji,playerId:entry.f.player.id,line:def.line(entry.value,entry.f,solo)});
  };
  const count=(id:string)=>owned.get(id)!.length;

  // A1: true winners, one award each.
  defs.forEach((_def,index)=>{
    const top=rankings[index][0];
    if(top&&count(top.f.player.id)===0)give(index,0);
  });
  // B: everyone still empty-handed takes a leftover award they are tied for first on (titles never lie).
  for(const player of players){
    if(count(player.id)>0)continue;
    let best:{index:number;rank:number}|undefined;
    rankings.forEach((ranking,index)=>{
      if(given.has(index))return;
      const rank=ranking.findIndex(entry=>entry.f.player.id===player.id);
      if(rank>=0&&ranking[rank].value===ranking[0].value&&(!best||rank<best.rank))best={index,rank};
    });
    if(best)give(best.index,best.rank);
  }
  // A2: second award for true winners that still have room.
  defs.forEach((_def,index)=>{
    if(given.has(index))return;
    const top=rankings[index][0];
    if(top&&count(top.f.player.id)<MAX_AWARDS_PER_PLAYER)give(index,0);
  });
  // C: nobody leaves empty-handed in a group run.
  if(!solo)for(const player of players)if(count(player.id)===0)owned.get(player.id)!.push({...FALLBACK,playerId:player.id});

  return players.flatMap(player=>owned.get(player.id)!.slice(0,MAX_AWARDS_PER_PLAYER));
}

/** Awards of one player, in display order. */
export const awardsOf=(awards:readonly Award[],playerId:string)=>awards.filter(award=>award.playerId===playerId);

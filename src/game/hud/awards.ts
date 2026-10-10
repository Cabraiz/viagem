/**
 * Joke awards for the end-of-run result screen (VGM-040). Pure and deterministic: same result + tally
 * always yields the same awards, so every client shows the same jokes. No DOM.
 *
 * Rules:
 * - Each award has a per-player metric; only players with metric > 0 can win it. Ranking is metric
 *   descending, ties broken by the smaller player id.
 * - Assignment (max 2 awards per player, every award given at most once):
 *   A1. In priority order, an award goes to its top-ranked player if that player has no award yet.
 *   B.  Players still without awards (in id order) take a leftover award they are tied for first on
 *       (then by priority); this spreads the jokes without ever lying about who won.
 *   A2. Remaining awards go to their top-ranked player if that player still has room.
 *   C.  With 2+ players, anyone still empty-handed gets a "vice" title for the award where they rank
 *       best (2nd place, 3rd…, metric > 0, then by priority), which says the real rank ("2º lugar").
 *   D.  Only a player with no eligible metric at all gets "Figurante de luxo".
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
  /** Consolation title for a runner-up (rule C); never claims first place. */
  vice:string;
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
  {id:'mais-caiu',title:'Mais caiu',emoji:'🫠',vice:'Vice-campeão de tombo',solo:true,
    metric:f=>f.tally.downs,
    line:(v,_f,solo)=>solo?`Caiu ${plural(v,'vez','vezes')}. Sozinho, ainda.`:`Beijou o chão ${plural(v,'vez','vezes')}.`},
  {id:'rei-do-resgate',title:'Rei do resgate',emoji:'🚑',vice:'Príncipe do resgate',solo:false,
    metric:f=>f.revives,
    line:v=>`${plural(v,'resgate','resgates')}. O SAMU ligou.`},
  {id:'carregou',title:'Carregou o time',emoji:'🏋️',vice:'Carregou a mochila',solo:true,
    metric:f=>f.damage,
    line:(_v,_f,solo)=>solo?'O time era você. Parabéns?':'Costas doendo de tanto carregar.'},
  {id:'exterminador',title:'Exterminador de gosma',emoji:'🧹',vice:'Estagiário da dedetização',solo:true,
    metric:f=>f.kills,
    line:v=>`${v} bichos de volta pro mar.`},
  {id:'build-sem-sentido',title:'Build mais sem sentido',emoji:'🤡',vice:'Build quase sem sentido',solo:true,
    metric:f=>f.player.weapons.length+f.player.passives.length>=3?buildChaos(f.player):0,
    line:()=>'Montou no escuro. Funcionou?'},
  {id:'ima-humano',title:'Ímã humano',emoji:'🧲',vice:'Ímã de geladeira',solo:true,
    metric:f=>f.pickups,
    line:v=>`Catou ${v} coisas. Até chiclete.`},
  {id:'turista',title:'Turista',emoji:'📸',vice:'Turista de fim de semana',solo:false,
    metric:(f,all)=>{
      const active=all.filter(other=>isActive(other.player));
      if(active.length<2||!isActive(f.player))return 0;
      return Math.max(...active.map(other=>other.damage))-f.damage;
    },
    line:()=>'Veio pela vista. Tirou foto.'},
  {id:'coxinha',title:'Colecionador de coxinha',emoji:'🥟',vice:'Beliscador de coxinha',solo:true,
    metric:f=>f.tally.heals,
    line:v=>`${plural(v,'coxinha','coxinhas')} no meio da briga.`},
  {id:'sortudo-do-bau',title:'Sortudo do baú',emoji:'🎁',vice:'Quase sortudo',solo:true,
    metric:f=>f.tally.chests,
    line:v=>`${plural(v,'baú','baús')}. Joga na Mega já.`},
  {id:'bate-nao-mata',title:'Bate mas não mata',emoji:'🥊',vice:'Bate e às vezes mata',solo:false,
    metric:f=>f.kills>0&&f.damage>0?Math.round(f.damage/f.kills):0,
    line:()=>'Amacia pros outros matarem.'},
  {id:'evolucao',title:'Evolução de novela',emoji:'✨',vice:'Evolução de reprise',solo:true,
    metric:f=>evolutions(f),
    line:()=>'Evoluiu. Último capítulo!'},
  {id:'marombeiro',title:'Marombeiro de upgrade',emoji:'💪',vice:'Frequenta a academia',solo:true,
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
    // Server counters (award-stats-server: `downs` present) are the same on every client: use only them.
    if(stats&&stats.downs!==undefined){
      const n=(v:number|undefined)=>Math.max(0,Number.isFinite(v)?v!:0);
      const server:PlayerTally={...entry,downs:n(stats.downs),revives:n(stats.revives),heals:n(stats.heals),magnets:n(stats.magnets),
        chests:n(stats.chests),pickups:n(stats.pickups),kills:n(stats.kills),evolves:n(stats.evolves)};
      return {player,tally:server,damage:n(stats.damage),kills:server.kills,revives:server.revives,pickups:server.pickups};
    }
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
  // C: runners-up get a vice title that states their real rank; D: figurante only without any metric.
  if(!solo)for(const player of players){
    if(count(player.id)>0)continue;
    let best:{index:number;place:number}|undefined;
    rankings.forEach((ranking,index)=>{
      const rank=ranking.findIndex(entry=>entry.f.player.id===player.id);
      if(rank<0)return;
      // Place counts distinct better values, so ties share a place and nobody is called 3rd when tied for 2nd.
      const place=1+new Set(ranking.slice(0,rank).map(entry=>entry.value).filter(value=>value>ranking[rank].value)).size;
      if(!best||place<best.place)best={index,place};
    });
    if(best){
      const def=defs[best.index];
      const line=best.place===1?`Empatou em "${def.title}" e perdeu no desempate.`:`${best.place}º em "${def.title}". Na trave!`;
      owned.get(player.id)!.push({id:`vice-${def.id}`,title:def.vice,emoji:best.place===1?'🤝':best.place===2?'🥈':best.place===3?'🥉':'🏅',playerId:player.id,line});
    }else owned.get(player.id)!.push({...FALLBACK,playerId:player.id});
  }

  return players.flatMap(player=>owned.get(player.id)!.slice(0,MAX_AWARDS_PER_PLAYER));
}

/** Awards of one player, in display order. */
export const awardsOf=(awards:readonly Award[],playerId:string)=>awards.filter(award=>award.playerId===playerId);

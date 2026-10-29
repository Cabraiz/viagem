/**
 * Enemies and bosses bench (auditoria inimigos 29/10, item K; card NEW-20261029-ORQ-bench-inimigos): plays the live
 * city run (chaveiro + manual + ninhos) with bots, through scripts/bench-city-run.ts playRun, and per enemy body
 * records kind/role/elite/boss/wave, the damage it dealt to heroes, the Uno hits, downs, lifetime, and the closest it
 * came to a hero and to the car. Telegraphs: owner kind, hazard kind, delay (warn → hit) and whether it hit a hero.
 * A checkout is given with --root (default: this one), so the same script measures origin/main before and a branch
 * after. Writes the JSON and its markdown summary (summarize) next to it; --resumo only summarizes a JSON already made.
 *   node --experimental-strip-types scripts/bench-inimigos.ts [--root <checkout>] [--seeds 1-16] [--players 1,3,6]
 *     [--minutes 20] [--out evidence/<card>/inimigos.json]
 *   node --experimental-strip-types scripts/bench-inimigos.ts --resumo evidence/<card>/inimigos.json
 * Heavy (many minutes per seed): run it in the heavy slot.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const HZ=20;
/** A body "dies far" when it never came closer than this (units) to a hero or to the Uno. */
export const NEAR=2;
const CAR_ID='quadradao';

export interface BodyOut {kind:string;role:string;elite:boolean;boss:boolean;wave:number;spawn:number;maxHp:number;speed:number;damage:number;
  minHero:number|null;minCar:number|null;heroDmg:number;carUnits:number;downs:number;life:number|null;engaged:number|null;killed:boolean}
export interface TelegraphOut {owner:string;kind:string;hazard:string;shape:string;radius:number;delay:number;damage:number;fire:number;hit:number}
export interface RunOut {seed:number;players:number;outcome:string;min:number;bodies:BodyOut[];other:Record<string,number>;
  downsBy:Record<string,number>;carUnattributed:number;telegraphs:TelegraphOut[]}
export interface BenchOut {root:string;seeds:number[];players:number[];minutes:number;runs:RunOut[]}

/** "1-4,7" → [1,2,3,4,7]. */
export const range=(s:string)=>s.split(',').flatMap(p=>{const [a,b]=p.split('-').map(Number);return b===undefined?[a]:Array.from({length:b-a+1},(_,i)=>a+i);});
const med=(xs:(number|null)[])=>{const s=xs.filter((x):x is number=>x!=null).sort((a,b)=>a-b);return s.length?s[Math.floor(s.length/2)]:null;};
const r1=(x:number|null)=>x==null?'—':String(Math.round(x*10)/10);
const pct=(a:number,b:number)=>b?Math.round(100*a/b)+'%':'—';

/** The bench JSON as markdown tables: runs, per player count the roles and the waves, the kinds, the telegraphs. */
export function summarize(data:BenchOut):string{
  const lines:string[]=[];const say=(s:string)=>lines.push(s);
  say(`# Bench inimigos: ${data.seeds.length} seeds × ${data.players.join('/')}p (chaveiro + manual + ninhos, bots da sala)\n`);
  say('| run | outcome | min | bodies | car sem dono |');say('|---|---|---|---|---|');
  for(const r of data.runs)say(`| s${r.seed} ${r.players}p | ${r.outcome} | ${r.min} | ${r.bodies.length} | ${r.carUnattributed} |`);
  for(const n of data.players){
    const rs=data.runs.filter(r=>r.players===n);
    if(!rs.length)continue;
    type Role={n:number;kinds:Set<string>;dmg:number;car:number;downs:number;killed:number;far:number;life:(number|null)[];eng:(number|null)[];hp:number[]};
    const by:Record<string,Role>={};
    for(const r of rs)for(const b of r.bodies){
      const tag=b.boss?'CHEFÃO':b.elite?'elite':'';
      const o=by[`${b.role}${tag?' '+tag:''}`]??={n:0,kinds:new Set(),dmg:0,car:0,downs:0,killed:0,far:0,life:[],eng:[],hp:[]};
      o.n++;o.kinds.add(b.kind);o.dmg+=b.heroDmg;o.car+=b.carUnits;o.downs+=b.downs;
      if(b.killed){o.killed++;if((b.minHero??99)>NEAR&&(b.minCar??99)>NEAR)o.far++;o.life.push(b.life);o.eng.push(b.engaged);}
      o.hp.push(b.maxHp);
    }
    say(`\n## ${n}p (${rs.length} runs)\n`);
    say(`| papel | corpos/run | tipos | hp med | % mortos | morre longe (>${NEAR} u de herói e Uno) | dano herói/corpo | Uno/corpo | quedas | dano herói por 100 hp | vida med s | engajado med s |`);
    say('|---|---|---|---|---|---|---|---|---|---|---|---|');
    for(const [k,o] of Object.entries(by).sort((a,b)=>b[1].n-a[1].n)){
      const hp=med(o.hp);
      say(`| ${k} | ${r1(o.n/rs.length)} | ${o.kinds.size} | ${hp} | ${pct(o.killed,o.n)} | ${pct(o.far,o.killed)} | ${r1(o.dmg/o.n)} | ${r1(o.car/o.n)} | ${o.downs} | ${hp?r1(100*o.dmg/o.n/hp):'—'} | ${r1(med(o.life))} | ${r1(med(o.eng))} |`);
    }
    const other:Record<string,number>={},downs:Record<string,number>={};
    for(const r of rs){for(const [k,v] of Object.entries(r.other))other[k]=(other[k]??0)+v;for(const [k,v] of Object.entries(r.downsBy))downs[k]=(downs[k]??0)+v;}
    if(Object.keys(other).length)say(`\nDano sem corpo (perigos de quem já morreu): ${Object.entries(other).map(([k,v])=>`${k} ${Math.round(v)}`).join(', ')}`);
    if(Object.keys(downs).length)say(`\nQuedas sem corpo: ${Object.entries(downs).map(([k,v])=>`${k} ${v}`).join(', ')}`);
    const waves:Record<string,{runs:Set<number>;roles:Record<string,number>;n:number}>={};
    for(const r of rs)for(const b of r.bodies){if(b.wave<0||b.boss)continue;const w=waves[b.wave]??={runs:new Set(),roles:{},n:0};w.runs.add(r.seed);w.roles[b.role]=(w.roles[b.role]??0)+1;w.n++;}
    say(`\n### Ondas ${n}p (corpos com memória de onda, média por run que chegou nela)\n`);
    say('| onda | runs | corpos/run | papéis (corpos/run) | papel dominante |');say('|---|---|---|---|---|');
    for(const [w,o] of Object.entries(waves).sort((a,b)=>Number(a[0])-Number(b[0]))){
      const k=o.runs.size,roles=Object.entries(o.roles).sort((a,b)=>b[1]-a[1]);
      say(`| ${Number(w)+1} | ${k} | ${r1(o.n/k)} | ${roles.map(([r,c])=>`${r} ${r1(c/k)}`).join(', ')} | ${pct(roles[0][1],o.n)} ${roles[0][0]} |`);
    }
    const map:Record<string,number>={};let mapN=0;
    for(const r of rs)for(const b of r.bodies)if(b.wave<0&&!b.boss){map[b.role]=(map[b.role]??0)+1;mapN++;}
    say(`\nMapa (dormentes/fora de onda): ${Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([r,c])=>`${r} ${r1(c/rs.length)}`).join(', ')} (total ${r1(mapN/rs.length)}/run)`);
  }
  const kinds:Record<string,{role:string;n:number;runs:Set<string>}>={};
  for(const r of data.runs)for(const b of r.bodies){const o=kinds[b.kind]??={role:b.role,n:0,runs:new Set()};o.n++;o.runs.add(`${r.seed}/${r.players}`);}
  say(`\n## Tipos (todas as ${data.runs.length} runs)\n`);say('| tipo | papel | corpos | runs em que aparece |');say('|---|---|---|---|');
  for(const [k,o] of Object.entries(kinds).sort((a,b)=>b[1].n-a[1].n))say(`| ${k} | ${o.role} | ${o.n} | ${o.runs.size} |`);
  const tg:Record<string,{n:number;delay:number[];radius:number[];dmg:number[];hit:number;shape:string}>={};
  for(const r of data.runs)for(const t of r.telegraphs){const o=tg[`${t.owner} | ${t.hazard}`]??={n:0,delay:[],radius:[],dmg:[],hit:0,shape:t.shape};o.n++;o.delay.push(t.delay);o.radius.push(t.radius);o.dmg.push(t.damage);o.hit+=t.hit;}
  say('\n## Telegrafos medidos (todas as runs)\n');say('| dono | perigo | forma | n | aviso→golpe s | raio/alcance | dano | % que acertou herói |');say('|---|---|---|---|---|---|---|---|');
  for(const [k,o] of Object.entries(tg).sort((a,b)=>b[1].n-a[1].n))say(`| ${k} | ${o.shape} | ${o.n} | ${r1(med(o.delay))} | ${r1(med(o.radius))} | ${r1(med(o.dmg))} | ${pct(o.hit,o.n)} |`);
  return lines.join('\n');
}

type Ev={type:string;[k:string]:unknown};
type E={id:string;kind:string;x:number;y:number;hp:number;maxHp:number;speed:number;damage:number;radius:number;elite?:boolean;boss?:boolean;memory?:Record<string,number>};
type P={id:string;x:number;y:number;hp:number;downed?:unknown;spectator?:boolean;eliminated?:boolean};
type T={id:string;owner:string;kind?:string;shape:string;radius:number;damage:number;fireTick:number};
type Sim={events:readonly Ev[];tick:number;world:{enemies:Map<string,E>;players:Map<string,P>;telegraphs:Map<string,T>};run:{chaveiro?:{state:{car:{x:number;y:number}}}}};
interface Body {kind:string;role:string;elite:boolean;boss:boolean;wave:number;spawn:number;maxHp:number;speed:number;damage:number;
  minHero:number;minCar:number;heroDmg:number;carUnits:number;downs:number;death?:number;firstNear?:number}

async function main(argv:string[]){
  const get=(name:string)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
  const resumo=get('--resumo');
  if(resumo){const file=path.resolve(resumo);fs.writeFileSync(file.replace(/\.json$/,'')+'.md',summarize(JSON.parse(fs.readFileSync(file,'utf8')) as BenchOut)+'\n');console.log('→',file.replace(/\.json$/,'')+'.md');return;}
  const HERE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const ROOT=path.resolve(get('--root')??HERE);
  const seeds=range(get('--seeds')??'1-4'),players=range(get('--players')??'1,3,6'),minutes=Number(get('--minutes')??20);
  const out=path.resolve(get('--out')??path.join(HERE,'evidence','bench-inimigos',`inimigos-${path.basename(ROOT)}.json`));
  try{os.setPriority(0,os.constants.priority.PRIORITY_LOW);}catch{/* best effort */}

  const imp=(p:string)=>import(pathToFileURL(path.join(ROOT,p)).href);
  const bench=await imp('scripts/bench-city-run.ts');
  const {Simulation}=await imp('multiplayer/simulation.ts');
  const {cityTerrainFrom}=await imp('src/maps/city/terrain.ts');
  const {ROSTER}=await imp('src/rules/enemy-roster.ts');
  const {hazardKind}=await imp('src/sim/enemies/catalog.ts');
  const roleOf=new Map<string,string>((ROSTER as {id:string;role:string}[]).map(e=>[e.id,e.role]));

  const hooks:{before?:(sim:Sim)=>void;each?:(sim:Sim)=>void}={};
  const step=Simulation.prototype.step;
  Simulation.prototype.step=function(this:Sim,...a:unknown[]){hooks.before?.(this);const r=step.apply(this,a);hooks.each?.(this);return r;};

  const text=fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(fs.readFileSync(path.join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const loaded=await cityTerrainFrom(text,hash);
  if(!loaded.ok)throw new Error(loaded.error);
  const city=loaded.terrain,nav=new bench.CityNavigator(city);
  const data:BenchOut={root:ROOT,seeds,players,minutes,runs:[]};
  for(const seed of seeds)for(const n of players){
    const bodies=new Map<string,Body>(),tgs=new Map<string,TelegraphOut>(),tgDone:TelegraphOut[]=[];
    const other:Record<string,number>={},downsBy:Record<string,number>={};
    let carHp:number|undefined,carUnattributed=0;
    let prevReady=new Map<string,number>();
    const kindOfOwner=(o:string)=>{const b=bodies.get(o);if(b)return b.boss?`BOSS:${b.kind}`:b.kind;const h=hazardKind(o) as string|undefined;return h??`?${o.split(':').slice(0,2).join(':')}`;};
    hooks.before=sim=>{prevReady=new Map();for(const e of sim.world.enemies.values())prevReady.set(e.id,e.memory?.hitReady??-1);};
    hooks.each=sim=>{
      const car=sim.run.chaveiro?.state.car;
      const heroes=[...sim.world.players.values()].filter(p=>!p.spectator&&!p.eliminated&&!p.downed&&p.hp>0);
      for(const e of sim.world.enemies.values()){
        let b=bodies.get(e.id);
        if(!b){b={kind:e.kind,role:e.boss?'chefe':roleOf.get(e.kind)??'?',elite:!!e.elite,boss:!!e.boss,wave:e.memory?.wave??-1,spawn:sim.tick,maxHp:e.maxHp,
          speed:e.speed,damage:e.damage,minHero:Infinity,minCar:Infinity,heroDmg:0,carUnits:0,downs:0};bodies.set(e.id,b);}
        if(b.wave<0&&e.memory?.wave!==undefined)b.wave=e.memory.wave;
        if(!(e.hp>0))continue;
        for(const p of heroes){const d=Math.hypot(p.x-e.x,p.y-e.y)-e.radius;if(d<b.minHero)b.minHero=d;if(d<6&&b.firstNear===undefined)b.firstNear=sim.tick;}
        if(car){const d=Math.hypot(car.x-e.x,car.y-e.y)-e.radius;if(d<b.minCar)b.minCar=d;}
      }
      // Car hits: the enemies whose contact cooldown was reset this tick near the car, in id order.
      const fresh=[...sim.world.enemies.values()].filter(e=>(e.memory?.hitReady??-1)!==(prevReady.get(e.id)??-1)&&(e.memory?.hitReady??-1)>sim.tick&&car&&Math.hypot(car.x-e.x,car.y-e.y)<e.radius+3.5)
        .map(e=>e.id).sort();
      const heroHitters=new Set<string>();
      for(const ev of sim.events)if(ev.type==='damage'&&String(ev.target).startsWith('bot')&&ev.source!==undefined)heroHitters.add(String(ev.source));
      const carCands=fresh.filter(id=>!heroHitters.has(id));
      for(const ev of sim.events){
        if(ev.type==='damage'&&String(ev.target).startsWith('bot')){
          const src=String(ev.source??'?'),b=bodies.get(src),amt=Number(ev.amount);
          if(b)b.heroDmg+=amt;else{const k=kindOfOwner(src);other[k]=(other[k]??0)+amt;}
        }else if(ev.type==='structure'&&ev.id===CAR_ID){
          const hp=Number(ev.hp),units=carHp===undefined?0:carHp-hp;carHp=hp;
          if(units>0){
            const id=carCands.shift();
            const b=id?bodies.get(id):[...bodies.values()].find(x=>x.boss&&x.death===undefined);
            if(b)b.carUnits+=units;else carUnattributed+=units;
          }
        }else if(ev.type==='downed'){
          const by=ev.by!==undefined?String(ev.by):undefined,b=by?bodies.get(by):undefined;
          if(b)b.downs++;else{const k=String(ev.source??(by?kindOfOwner(by):'?'));downsBy[k]=(downsBy[k]??0)+1;}
        }else if(ev.type==='kill'){
          const b=bodies.get(String(ev.enemy));if(b&&b.death===undefined)b.death=sim.tick;
        }else if(ev.type==='telegraph'){
          const t=sim.world.telegraphs.get(String(ev.telegraph));
          if(t)tgs.set(t.id,{owner:kindOfOwner(t.owner),kind:'',hazard:t.kind??t.shape,shape:t.shape,radius:t.radius,delay:(t.fireTick-sim.tick)/HZ,damage:t.damage,fire:t.fireTick,hit:0});
        }
      }
      for(const ev of sim.events)if(ev.type==='damage'&&String(ev.target).startsWith('bot')&&ev.source!==undefined)for(const t of tgs.values())
        if(t.fire===sim.tick&&Math.abs(t.damage-Number(ev.amount))<t.damage)t.hit=1;
      for(const [id,t] of tgs)if(t.fire<=sim.tick){tgDone.push(t);tgs.delete(id);}
      // Bodies that left the world without a kill event (despawn): a negative death tick.
      for(const [id,b] of bodies)if(b.death===undefined&&!sim.world.enemies.has(id))b.death=-sim.tick;
    };
    const t0=Date.now();
    const run=bench.playRun({seed,players:n,capTicks:minutes*60*HZ,city,nav,route:'none',towers:true,objective:'chaveiro',combat:'manual',mode:'ninhos'});
    const list:BodyOut[]=[...bodies.values()].map(({death,firstNear,...b})=>({...b,
      minHero:Number.isFinite(b.minHero)?Math.round(b.minHero*10)/10:null,minCar:Number.isFinite(b.minCar)?Math.round(b.minCar*10)/10:null,
      life:death!==undefined?(Math.abs(death)-b.spawn)/HZ:null,engaged:death!==undefined&&firstNear!==undefined?(Math.abs(death)-firstNear)/HZ:null,
      killed:death!==undefined&&death>0}));
    data.runs.push({seed,players:n,outcome:`${run.outcome}/${run.cause}`,min:Math.round(run.ticks/HZ/6)/10,bodies:list,other,downsBy,carUnattributed,telegraphs:tgDone});
    console.log(`seed ${seed} ${n}p ${run.outcome}/${run.cause} @${(run.ticks/HZ/60).toFixed(1)}min ${bodies.size} bodies (${((Date.now()-t0)/1000).toFixed(0)} s)`);
    // Written after every run: a long bench stopped midway keeps what it measured.
    fs.mkdirSync(path.dirname(out),{recursive:true});
    fs.writeFileSync(out,JSON.stringify(data));
  }
  hooks.each=undefined;hooks.before=undefined;
  fs.writeFileSync(out.replace(/\.json$/,'')+'.md',summarize(data)+'\n');
  console.log('→',out);
}

const entry=process.argv[1]?pathToFileURL(path.resolve(process.argv[1])).href:'';
if(entry===import.meta.url)await main(process.argv.slice(2));

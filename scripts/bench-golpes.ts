/**
 * Hits to kill (card NEW-20261024-ORQ-vida-inimigos-estilo-clash): a pure table, no run. For every enemy role (its
 * roster entries' max hp: catalog enemyDef) and every phase of the live game's ninhos run (the warm start's row 1, the
 * sleepers' SLEEPER_ROUND, the nests' rows 2..9) and of the rounds mode (hpScale), the max hp a body spawns with
 * (def.hp × row hp × playerScale(n).hp × NEST_PACE.hp, rounded like createEnemy) and the hits each arsenal weapon's
 * verde/azul/roxa/dourada row needs at might 1 (ceil(hp / damage)). `--root` measures another checkout.
 *   node --experimental-strip-types scripts/bench-golpes.ts [--root <checkout>] [--players 1,3,6] [--out evidence/vida-inimigos-clash/golpes-<name>.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const argv=process.argv.slice(2);
const get=(name:string)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:undefined;};
const HERE=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ROOT=path.resolve(get('--root')??HERE);
const players=(get('--players')??'1,3,6').split(',').map(Number);
const out=path.resolve(get('--out')??path.join(HERE,'evidence','vida-inimigos-clash',`golpes-${path.basename(ROOT)}.json`));
const imp=(p:string)=>import(pathToFileURL(path.join(ROOT,p)).href);

const {ROUNDS,playerScale,ROSTER,ENEMY_ROLES}=await imp('src/rules/index.ts');
const {enemyDef}=await imp('src/sim/enemies/catalog.ts');
const {NEST_PACE,NEST_RUN_SECONDS}=await imp('src/sim/ninhos/ninhos.ts');
const {SLEEPER_ROUND}=await imp('src/sim/assemble.ts');
const {NEW_WEAPONS}=await imp('src/sim/weapons/arsenal.ts');

type Row={index:number;hpScale:number;hpNinhos?:number};
const rows=ROUNDS as Row[];
const nestHp=(row:number)=>rows[row-1].hpNinhos??rows[row-1].hpScale;
// Ninhos phases: warm start (row NEST_PACE.warmRow for NEST_PACE.warm s), sleepers, then nestRound over the run.
const phases:{id:string;label:string;scale:number}[]=[
  {id:'inicio',label:`ninhos 0-${NEST_PACE.warm/60} min (linha ${NEST_PACE.warmRow})`,scale:nestHp(NEST_PACE.warmRow)},
  {id:'dorminhoco',label:`dorminhocos (linha ${SLEEPER_ROUND})`,scale:nestHp(SLEEPER_ROUND)},
  ...[2,3,4,5,6,7,8,9].map(r=>({id:`ninhos-${r}`,label:`ninhos linha ${r} (~${Math.round((r-1)/9*NEST_RUN_SECONDS/60*10)/10} min)`,scale:nestHp(r)})),
  ...rows.map(r=>({id:`onda-${r.index}`,label:`ondas rodada ${r.index}`,scale:r.hpScale})),
];
const nestTune=NEST_PACE.hp??1;
const weapons=(NEW_WEAPONS as {id:string;name:string;minRarity:number;levels:{damage:number}[]}[])
  .map(w=>({id:w.id,name:w.name,rarities:w.levels.map((l,i)=>({rarity:i+1,damage:l.damage})).filter(r=>r.rarity>=w.minRarity)}));

const byRole:Record<string,{id:string;hp:number;radius:number}[]>={};
for(const e of ROSTER as {id:string;role:string}[]){const d=enemyDef(e.id);(byRole[e.role]??=[]).push({id:e.id,hp:d.hp,radius:d.radius});}
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};

const table:Record<string,unknown>[]=[];
for(const n of players)for(const role of ENEMY_ROLES as string[]){
  const ents=byRole[role];if(!ents?.length||role==='chefe')continue;
  const hp=ents.map(e=>e.hp);
  for(const ph of phases){
    const s=ph.scale*playerScale(n).hp*(ph.id.startsWith('onda')?1:nestTune);
    const max=Math.max(...hp.map(h=>Math.max(1,Math.round(h*s)))),min=Math.min(...hp.map(h=>Math.max(1,Math.round(h*s))));
    const med=Math.max(1,Math.round(median(hp)*s));
    const hits:Record<string,string>={};
    for(const w of weapons)for(const r of w.rarities){
      const k=Math.ceil(med/r.damage),lo=Math.ceil(min/r.damage),hi=Math.ceil(max/r.damage);
      hits[`${w.id}${r.rarity}`]=lo===hi?String(k):`${lo}-${hi}`;
    }
    table.push({players:n,role,entries:ents.length,phase:ph.id,label:ph.label,hpMin:min,hpMedian:med,hpMax:max,
      radiusMedian:Math.round(median(ents.map(e=>e.radius))*100)/100,hits});
  }
}
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({root:ROOT,players,weapons,table},null,1));
// Console: the faca verde (the starting weapon) and the pistola verde, 1 player, every phase.
const show=['faca1','pistola1','escopeta2','rifle3'];
for(const n of players){
  console.log(`\n${n} jogador(es) — golpes para matar (mediana da vida do papel) · ${show.join(' / ')}`);
  for(const role of ENEMY_ROLES as string[]){
    const rs=table.filter(t=>t.players===n&&t.role===role&&!(t.phase as string).startsWith('onda'));
    if(!rs.length)continue;
    console.log(role.padEnd(13),rs.map(r=>`${r.phase}:${r.hpMedian}hp ${show.map(k=>(r.hits as Record<string,string>)[k]).join('/')}`).join(' | '));
  }
}
console.log('→',out);

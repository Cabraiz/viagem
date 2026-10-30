/**
 * Fake banks for the city sandbox (card NEW-20261014-ORQ-bancos-e-veiculos): `bancos=1` puts the three ATMs around the
 * hero, one per state, their saldo running on the clock:
 *  - Pão-Duro: a hero holds it (sacando), a R$ 2 note every BANCO.saqueS from 30 (then it starts over);
 *  - Juros & Juros: a critter robs it (bicho), a note every BANCO.bichoSaqueS from 18; the robber is a Cliente Prime;
 *  - Caixa do Posto: empty ("SEM CÉDULAS"), full again in 2:10.
 * `banco=aberto|sacando|bicho|vazio` puts all three in that state instead. Deterministic from the clock only.
 * `bicos=1` (card bancos-viram-bicos): the three in a row across the screen, a shop's width apart (the pixel-art
 * shops are ~6 cells wide), the hero in the middle one's ring at work (sacando), the others open and robbed.
 * With it `turno=0` (etapa 4): the middle one open, the hero in its ring (the button says Trabalhar); `turno=1`: the hero
 * ('voce') inside its shift (gone through the door, the button "No turno", the tag "Você no turno"), paid a note every
 * BICO.nota/BICO.porSegundo s (the PIX around the hero, render/bancos/pix.ts).
 */
import {SIM_HZ,type BankName,type BankState,type BankView,type BicoId,type EnemyView} from '../../contract/index.ts';
import {BANCO,BICO} from '../../rules/index.ts';
/** Each bank's gig here: one shop front each (24/7, call center, Compro Ouro). */
const SANDBOX_BICO:Record<BankName,BicoId>={posto:'entregador','pao-duro':'telemarketing',juros:'compro-ouro'};

type Pt={x:number;y:number};
const STATES:Readonly<Record<string,BankState>>={aberto:'aberto',sacando:'sacando',bicho:'bicho',vazio:'sem-cedulas'};
/**
 * Where the three stand around the hero (units): up left, down left and down, all on a phone held upright (390×844 at
 * the default zoom; the city sandbox's open snow at hero=53,56.5).
 */
const AROUND:readonly Pt[]=[{x:-3.6,y:-1.2},{x:1.5,y:4.5},{x:3.4,y:4.2}];
const DEFAULT:readonly BankState[]=['sacando','bicho','sem-cedulas'];
/** bicos=1: same screen row (x+y), 7 units apart along the screen's x (x−y); the middle one at the hero. */
const ROW:readonly Pt[]=[{x:-3.5,y:3.5},{x:0,y:0},{x:3.5,y:-3.5}];
const ROW_STATES:readonly BankState[]=['aberto','sacando','bicho'];

export interface FakeBanks {
  /** The banks at `now` (ms) and the sim tick it stands for. */
  view(now:number):{banks:BankView[];tick:number};
  /** The critters at the robbed banks (a Cliente Prime at each), for the horde renderer. */
  enemies:EnemyView[];
}

export function fakeBanks(params:URLSearchParams,hero:Pt):FakeBanks{
  const all=STATES[params.get('banco')??''],row=params.get('bicos')==='1';
  const turno=row?params.get('turno'):null;
  const states=AROUND.map((_,i)=>all??(i===1&&turno!==null?turno==='1'?'sacando':'aberto':(row?ROW_STATES:DEFAULT)[i]));
  const at=(row?ROW:AROUND).map(o=>({x:+(hero.x+o.x).toFixed(3),y:+(hero.y+o.y).toFixed(3)}));
  const names=['pao-duro','juros','posto'] as const;
  const enemies:EnemyView[]=[];
  states.forEach((s,i)=>{if(s==='bicho')enemies.push({id:`prime-${i}`,kind:'agiota',x:at[i].x+1.1,y:at[i].y+.5,hp:8,maxHp:8,prime:true});});
  return {
    enemies,
    view(now){
      const tick=Math.round(now/1000*SIM_HZ);
      const banks=states.map((state,i):BankView=>{
        const base={id:`banco-${i}`,...at[i],name:names[i],state,bico:SANDBOX_BICO[names[i]]};
        // On the shift a note (BICO.nota) every BICO.nota/BICO.porSegundo s: the saldo steps down and starts over, so the
        // renderer (no events here) sees a hero note and pops its "+R$ 5" in the PIX around the hero.
        if(state==='sacando'&&turno==='1'&&i===1)return {...base,workers:['voce'],saldo:32-BANCO.nota*(Math.floor(now/(BICO.nota/BICO.porSegundo*1000))%14)};
        if(state==='sacando')return {...base,saldo:30-BANCO.nota*(Math.floor(now/(BANCO.saqueS*1000))%14)};
        if(state==='bicho')return {...base,saldo:18-BANCO.nota*(Math.floor(now/(BANCO.bichoSaqueS*1000))%8)};
        if(state==='sem-cedulas')return {...base,saldo:0,until:tick+130*SIM_HZ};
        return {...base,saldo:BANCO.saldo};
      });
      return {banks,tick};
    },
  };
}

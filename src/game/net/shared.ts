import { moveDirection, clearSegment, SPAWN, type Point } from '../world.ts';

export const STEP = 1 / 20;
export const MAX_PLAYERS = 6;
export const GRACE_MS = 30_000;
export type Input = { seq:number; x:number; y:number; attack:boolean };
export type Player = Point & { id:string; name:string; classId:string; hp:number; ack:number; online:boolean; score:number };
export type Enemy = Point & { id:string; hp:number };
// Fixed tuple fields avoid repeated property names in frequent patches.
export type PlayerWire = [string,number,number,number,number,boolean,number,string,string];
export type EnemyWire = [string,number,number,number];
export type Snapshot = { t:'state'; tick:number; full:boolean; players:PlayerWire[]; enemies:EnemyWire[]; removed:string[]; victory:boolean };
export const packPlayer = (p:Player):PlayerWire => [p.id,round(p.x),round(p.y),p.hp,p.ack,p.online,p.score,p.name,p.classId];
export const packEnemy = (e:Enemy):EnemyWire => [e.id,round(e.x),round(e.y),e.hp];
export const unpackPlayer = (p:PlayerWire):Player => ({id:p[0],x:p[1],y:p[2],hp:p[3],ack:p[4],online:p[5],score:p[6],name:p[7],classId:p[8]});
export const unpackEnemy = (e:EnemyWire):Enemy => ({id:e[0],x:e[1],y:e[2],hp:e[3]});
const round=(n:number)=>Math.round(n*1000)/1000;
export function validInput(value:unknown):value is Input {
  if(!value||typeof value!=='object')return false;
  const v=value as Input;
  return Number.isSafeInteger(v.seq)&&v.seq>0&&v.seq<2**31&&Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=1&&Math.abs(v.y)<=1&&typeof v.attack==='boolean';
}
export function simulate(p:Point,input:Input):Point { return moveDirection(p,{x:input.x,y:input.y},STEP); }
export function reconcile(authoritative:Point,pending:Input[]):Point { return pending.reduce((p,i)=>simulate(p,i),{...authoritative}); }
export function interpolate(a:Point,b:Point,t:number):Point { const n=Math.max(0,Math.min(1,t));return {x:a.x+(b.x-a.x)*n,y:a.y+(b.y-a.y)*n}; }

export class Simulation {
  tick=0;
  players=new Map<string,Player>();
  enemies:Enemy[]=[{id:'gosma-1',x:10,y:16,hp:60},{id:'gosma-2',x:14,y:16,hp:60},{id:'gosma-3',x:12,y:13,hp:80}];
  private queues=new Map<string,Input[]>();
  private lastReceived=new Map<string,number>();
  private cooldown=new Map<string,number>();
  private fallen=new Map<string,number>();
  get victory(){return this.enemies.every(e=>e.hp===0);}
  add(id:string,name:string,classId:string){
    if(this.players.size>=MAX_PLAYERS)throw new Error('Sala cheia. Máximo de seis jogadores.');
    const slots=Array.from({length:6},(_,i)=>({x:SPAWN.x+(i%3-1)*.7,y:SPAWN.y+Math.floor(i/3)*.7}));
    const spawn=slots.find(s=>[...this.players.values()].every(p=>Math.hypot(p.x-s.x,p.y-s.y)>.3))??SPAWN;
    const p:Player={...spawn,id,name,classId,hp:100,ack:0,online:true,score:0};
    this.players.set(id,p);this.queues.set(id,[]);this.lastReceived.set(id,0);return p;
  }
  remove(id:string){this.players.delete(id);this.queues.delete(id);this.lastReceived.delete(id);this.cooldown.delete(id);this.fallen.delete(id);}
  setOnline(id:string,online:boolean){const p=this.players.get(id);if(p){p.online=online;this.queues.set(id,[]);this.lastReceived.set(id,p.ack);}}
  input(id:string,value:unknown){
    const p=this.players.get(id),q=this.queues.get(id);
    if(!p?.online||!q||!validInput(value)||value.seq<=(this.lastReceived.get(id)??0)||value.seq>p.ack+40||q.length>=8)return false;
    this.lastReceived.set(id,value.seq);q.push({seq:value.seq,x:value.x,y:value.y,attack:value.attack});return true;
  }
  step(){
    this.tick++;
    for(const p of this.players.values()){
      if(!p.online)continue;
      const input=this.queues.get(p.id)?.shift();
      if(p.hp===0){
        if(this.tick>=(this.fallen.get(p.id)??Infinity)){p.hp=100;Object.assign(p,SPAWN);this.fallen.delete(p.id);}
        if(input)p.ack=input.seq;
        continue;
      }
      if(!input)continue;
      Object.assign(p,simulate(p,input));p.ack=input.seq;
      if(input.attack&&this.tick>=(this.cooldown.get(p.id)??0)){
        this.cooldown.set(p.id,this.tick+12);
        const enemy=this.enemies.filter(e=>e.hp>0&&Math.hypot(e.x-p.x,e.y-p.y)<=1.8&&clearSegment(p,e)).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
        if(enemy){enemy.hp=Math.max(0,enemy.hp-20);if(!enemy.hp)for(const ally of this.players.values())ally.score+=10;}
      }
    }
    for(const enemy of this.enemies){
      if(enemy.hp===0)continue;
      const target=[...this.players.values()].filter(p=>p.online&&p.hp>0).sort((a,b)=>Math.hypot(a.x-enemy.x,a.y-enemy.y)-Math.hypot(b.x-enemy.x,b.y-enemy.y))[0];
      if(!target)continue;
      const distance=Math.hypot(target.x-enemy.x,target.y-enemy.y);
      if(distance<6&&distance>.85)Object.assign(enemy,moveDirection(enemy,{x:target.x-enemy.x,y:target.y-enemy.y},STEP*.35));
      if(distance<=1&&clearSegment(enemy,target)&&this.tick>=(this.cooldown.get(enemy.id)??0)){
        this.cooldown.set(enemy.id,this.tick+20);target.hp=Math.max(0,target.hp-8);
        if(!target.hp)this.fallen.set(target.id,this.tick+160);
      }
    }
  }
  snapshot():Snapshot{return {t:'state',tick:this.tick,full:true,players:[...this.players.values()].map(packPlayer),enemies:this.enemies.map(packEnemy),removed:[],victory:this.victory};}
}

export function delta(previous:Snapshot,next:Snapshot):Snapshot {
  const changed=<T extends [string,...unknown[]]>(before:T[],after:T[])=>after.filter(a=>JSON.stringify(a)!==JSON.stringify(before.find(b=>b[0]===a[0])));
  return {...next,full:false,players:changed(previous.players,next.players),enemies:changed(previous.enemies,next.enemies),removed:previous.players.filter(p=>!next.players.some(n=>n[0]===p[0])).map(p=>p[0])};
}

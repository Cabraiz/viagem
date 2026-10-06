import { Simulation, GRACE_MS, delta, type Snapshot } from '../src/game/net/shared.ts';
import { classes } from '../src/classes.ts';

export type Peer={ send:(data:string)=>void; close:(code:number,reason:string)=>void };
type Connection={peer:Peer;playerId?:string;opened:number;window:number;count:number;seen:number};
type Session={id:string;token:string;until:number};
const classIds=new Set(classes.map(c=>c.id));
export class Room {
  sim=new Simulation();
  connections=new Map<Peer,Connection>();
  private sessions=new Map<string,Session>();
  private previous:Snapshot=this.sim.snapshot();
  readonly createdAt:number;
  constructor(createdAt=Date.now()){this.createdAt=createdAt;}
  connect(peer:Peer,now=Date.now()){
    if(now-this.createdAt>30*60_000){peer.close(4004,'Sala encerrada. Crie uma nova.');return;}
    if(this.connections.size>=12){peer.close(4008,'Muitas conexões.');return;}
    this.connections.set(peer,{peer,opened:now,window:now,count:0,seen:now});
  }
  receive(peer:Peer,raw:string,now=Date.now()){
    const c=this.connections.get(peer);if(!c)return;
    if(raw.length>1024){peer.close(1009,'Mensagem muito grande.');this.disconnect(peer,now);return;}
    if(now-c.window>=1000){c.window=now;c.count=0;}
    if(++c.count>45){peer.close(4008,'Limite de mensagens.');this.disconnect(peer,now);return;}
    let m:any;try{m=JSON.parse(raw);}catch{return;}
    if(!m||typeof m!=='object')return;
    c.seen=now;
    if(m.t==='join'&&!c.playerId){
      this.expire(now);
      let session:Session|undefined;
      if(m.token!==undefined){
        session=[...this.sessions.values()].find(s=>s.token===m.token);
        if(!session||session.until<now){this.reject(peer,'Sua sessão expirou. Entre novamente.');return;}
        if([...this.connections.values()].some(other=>other!==c&&other.playerId===session!.id)){this.reject(peer,'Personagem já conectado em outra aba.');return;}
        this.sim.setOnline(session.id,true);
      }else{
        if(typeof m.name!=='string'||m.name.trim().length<1||m.name.trim().length>20||/[\u0000-\u001f\u007f]/.test(m.name)||!classIds.has(m.classId)){this.reject(peer,'Nome ou classe inválidos.');return;}
        if(this.sim.players.size>=6){this.reject(peer,'Sala cheia. Máximo de seis jogadores.');return;}
        const id=crypto.randomUUID();session={id,token:crypto.randomUUID()+crypto.randomUUID(),until:Infinity};
        this.sim.add(id,m.name.trim(),m.classId);this.sessions.set(id,session);
      }
      session.until=Infinity;c.playerId=session.id;
      peer.send(JSON.stringify({t:'welcome',id:session.id,token:session.token,state:this.sim.snapshot()}));
      this.broadcast(true);return;
    }
    if(!c.playerId)return;
    if(m.t==='input')this.sim.input(c.playerId,m);
    else if(m.t==='ping')peer.send(JSON.stringify({t:'pong',at:m.at}));
    else if(m.t==='leave'){this.sim.remove(c.playerId);this.sessions.delete(c.playerId);this.connections.delete(peer);peer.close(1000,'Saiu da sala.');this.broadcast(true);}
  }
  private reject(peer:Peer,message:string){peer.send(JSON.stringify({t:'error',message}));this.connections.delete(peer);peer.close(4003,message);}
  disconnect(peer:Peer,now=Date.now()){
    const c=this.connections.get(peer);this.connections.delete(peer);
    if(c?.playerId){this.sim.setOnline(c.playerId,false);const session=this.sessions.get(c.playerId);if(session)session.until=now+GRACE_MS;}
  }
  expire(now:number){for(const s of this.sessions.values())if(s.until<now){this.sim.remove(s.id);this.sessions.delete(s.id);}}
  advance(now=Date.now()){
    for(const c of [...this.connections.values()]){
      if(now-this.createdAt>30*60_000||(!c.playerId&&now-c.opened>5000)||now-c.seen>12000){this.disconnect(c.peer,now);c.peer.close(4004,'Conexão expirada.');}
    }
    this.expire(now);
    if([...this.sim.players.values()].some(p=>p.online))this.sim.step();
    if(this.sim.tick%2===0)this.broadcast(false);
  }
  private broadcast(full:boolean){
    const next=this.sim.snapshot(),message=JSON.stringify(full?next:delta(this.previous,next));this.previous=next;
    for(const c of [...this.connections.values()])if(c.playerId){try{c.peer.send(message);}catch{this.disconnect(c.peer);}}
  }
}

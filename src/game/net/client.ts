import {TerrainField,defaultTerrain,TERRAIN_VERSION} from '../terrain/field.ts';
import { STEP, ROOM_PROTOCOL, reconcile, simulate, interpolate, unpackPlayer, unpackEnemy, type Input, type Player, type Enemy, type Snapshot } from './shared.ts';
import type {RunState} from './run.ts';
import type { Point } from '../world.ts';
type Sample={at:number;players:Map<string,Player>;enemies:Map<string,Enemy>};
export class CoopClient {
  terrain=defaultTerrain;
  run?:RunState;
  id='';token='';seq=0;tick=0;rtt=0;connected=false;victory=false;
  players=new Map<string,Player>();enemies=new Map<string,Enemy>();
  predicted:Point={x:12,y:17};
  pending:Input[]=[];
  private socket?:WebSocket;
  private samples:Sample[]=[];
  private stopped=false;
  private attempts=0;
  private lostAt=0;
  private retry?:ReturnType<typeof setTimeout>;
  private heartbeat?:ReturnType<typeof setInterval>;
  private lastMessage=0;
  private initialized=false;
  private resolveReady?:()=>void;
  private rejectReady?:(error:Error)=>void;
  onStatus:(message:string)=>void=()=>{};
  constructor(readonly endpoint:string,readonly code:string,readonly name:string,readonly classId:string){}
  async join(){
    try{const saved=JSON.parse(sessionStorage.getItem(`viagem:room:${this.code}`)??'null');if(saved?.token&&saved.until>Date.now())this.token=saved.token;}catch{}
    return new Promise<void>((resolve,reject)=>{this.resolveReady=resolve;this.rejectReady=reject;this.connect();});
  }
  private connect(){
    if(this.stopped)return;
    this.onStatus(this.token?'Reconectando à turma…':'Entrando na sala…');
    const url=new URL(`/room/${this.code}`,this.endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const ws=this.socket=new WebSocket(url);
    const timeout=setTimeout(()=>ws.close(),8000);
    ws.onopen=()=>{ws.send(JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:this.name,classId:this.classId,...(this.token?{token:this.token}:{})}));};
    ws.onmessage=event=>{
      let m:any;try{m=JSON.parse(event.data);}catch{return;}
      this.lastMessage=performance.now();
      if(m.t==='welcome'){
        const terrain=m.state?.terrain;
        if(!m.state?.run||!terrain||terrain.version!==TERRAIN_VERSION||!Number.isInteger(terrain.seed)){this.stopped=true;this.onStatus('Servidor da partida desatualizado.');this.rejectReady?.(new Error('Servidor da partida desatualizado.'));ws.close();return;}
        this.terrain=new TerrainField(terrain.seed);
        if(this.terrain.signature!==terrain.signature){this.stopped=true;this.rejectReady?.(new Error('Versões de terreno diferentes. Atualize a página.'));ws.close();return;}
        clearTimeout(timeout);this.id=m.id;this.token=m.token;this.pending=[];this.samples=[];this.connected=true;this.attempts=0;this.lostAt=0;
        this.apply(m.state);this.seq=this.players.get(this.id)?.ack??0;this.initialized=true;
        this.onStatus('Conectado · até 6 amigos');this.resolveReady?.();this.resolveReady=undefined;this.rejectReady=undefined;
        this.saveToken();
        clearInterval(this.heartbeat);this.heartbeat=setInterval(()=>{if(performance.now()-this.lastMessage>8000){ws.close();return;}if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({t:'ping',at:performance.now()}));this.saveToken();},2000);
      }else if(m.t==='state')this.apply(m);
      else if(m.t==='pong')this.rtt=Math.round(performance.now()-m.at);
      else if(m.t==='notice'&&typeof m.message==='string')this.onStatus(m.message);
      else if(m.t==='error'){this.onStatus(m.message);this.stopped=true;this.connected=false;this.forgetToken();this.rejectReady?.(new Error(m.message));ws.close();}
    };
    ws.onclose=()=>{
      clearTimeout(timeout);clearInterval(this.heartbeat);this.connected=false;this.pending=[];
      if(this.stopped)return;
      this.lostAt ||= Date.now();
      if(Date.now()-this.lostAt>25_000||(!this.initialized&&this.attempts>=2)){
        this.stopped=true;this.forgetToken();this.onStatus('Conexão indisponível. Volte às classes e entre novamente.');this.rejectReady?.(new Error('Não foi possível conectar à sala.'));return;
      }
      this.onStatus('Conexão caiu. Tentando voltar à mesma sala…');
      this.retry=setTimeout(()=>this.connect(),Math.min(3000,500*2**this.attempts++));
    };
    ws.onerror=()=>{};
  }
  private saveToken(){try{sessionStorage.setItem(`viagem:room:${this.code}`,JSON.stringify({token:this.token,until:Date.now()+30_000}));}catch{}}
  private forgetToken(){try{sessionStorage.removeItem(`viagem:room:${this.code}`);}catch{}}
  private apply(s:Snapshot){
    if(s.run&&this.run&&s.run.round!==this.run.round){this.pending=[];this.samples=[];this.seq=0;}
    this.run=s.run;
    if(s.full){this.players.clear();this.enemies.clear();}
    for(const p of s.players)this.players.set(p[0],unpackPlayer(p));
    for(const e of s.enemies)this.enemies.set(e[0],unpackEnemy(e));
    for(const id of s.removed)this.players.delete(id);
    this.tick=s.tick;this.victory=s.victory;
    const self=this.players.get(this.id);
    if(self){this.pending=this.pending.filter(i=>i.seq>self.ack);this.predicted=self.hp?reconcile(self,this.pending,this.terrain):{x:self.x,y:self.y};}
    this.samples.push({at:performance.now(),players:new Map(this.players),enemies:new Map(this.enemies)});
    if(this.samples.length>12)this.samples.shift();
  }
  input(direction:Point,skill:boolean,target?:string){
    if(!this.connected||this.run?.phase!=='combat'||this.players.get(this.id)?.spectator||this.socket?.readyState!==WebSocket.OPEN||this.pending.length>=20)return;
    const length=Math.max(1,Math.hypot(direction.x,direction.y));
    const input:Input={seq:++this.seq,x:direction.x/length,y:direction.y/length,attack:false,skill,target};
    this.pending.push(input);if(this.players.get(this.id)?.hp)this.predicted=simulate(this.predicted,input,this.terrain);
    this.socket.send(JSON.stringify({t:'input',round:this.run.round,...input}));
  }
  ready(ready:boolean){this.runCommand({t:'ready',ready});}
  rematch(){this.runCommand({t:'rematch'});}
  private runCommand(command:object){if(this.connected&&this.run&&this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({...command,round:this.run.round}));}
  /** A short render buffer smooths remote entities without delaying local controls. */
  view(now=performance.now()):{players:Player[];enemies:Enemy[]}{
    const target=now-120;
    let a=this.samples[0],b=a;
    for(const sample of this.samples){b=sample;if(sample.at>=target)break;a=sample;}
    const t=a&&b&&a!==b?(target-a.at)/(b.at-a.at):1;
    return {players:[...this.players.values()].map(p=>p.id===this.id?{...p,...this.predicted}:{...p,...interpolate(a?.players.get(p.id)??p,b?.players.get(p.id)??p,t)}),enemies:[...this.enemies.values()].map(e=>({...e,...interpolate(a?.enemies.get(e.id)??e,b?.enemies.get(e.id)??e,t)}))};
  }
  /** Exposed as a visible diagnostic control; closes the actual socket, then normal retry takes over. */
  reconnect(){this.socket?.close(4000,'Teste de reconexão');}
  leave(){this.stopped=true;this.connected=false;clearTimeout(this.retry);clearInterval(this.heartbeat);this.forgetToken();if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify({t:'leave'}));this.socket?.close(1000,'Saída');}
}
export { STEP };

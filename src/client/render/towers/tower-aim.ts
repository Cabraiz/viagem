/** Aiming and firing (moved from towers.ts, corte C2): turning toward the target or the server's aim, a volley, the muzzle. */
import type {Pt} from '../city/projection.ts';
import {getAudio} from '../../audio/engine.ts';
import {AIM_FALLBACK,PHASE_HEIGHT,TURN_MS,aimIndex,aimedIndex,canFire,dir8,dirVector,flightMs,towerArt,turnToward,type Dir8} from './tower-rules.ts';
import {BURST_GAP_MS,BURST_MAX,FX_DEPTH,PULSE_TINT,RECOIL_MS,RESCAN_MS,SMOKE_MS,SMOKE_R} from './tower-tuning.ts';
import type {Tower} from './tower-types.ts';
import {TowerDraw} from './tower-draw.ts';

export abstract class TowerAim extends TowerDraw {

  protected aim(t:Tower,dtMs:number){
    if(t.look.calibre==='radar'){ // the dish sweeps on its own
      if(canFire(t.phase)){t.turnMs+=dtMs;while(t.turnMs>=TURN_MS*6){t.turnMs-=TURN_MS*6;t.dir=((t.dir+1)%8) as Dir8;}}
      return;
    }
    const e=this.enemies;
    if(t.view.aim!==undefined){ // the server's aim (where it last fired): turned once per snapshot (aimAt), no scan
      if(!canFire(t.phase))return;
    }else if(!canFire(t.phase))t.target=-1;
    else if(this.now>=t.scanAt||!this.reaches(t,t.target)){
      t.target=aimIndex(t.look,t.view.x,t.view.y,e.n,e.xs,e.ys,e.air);
      t.scanAt=this.now+RESCAN_MS;
    }
    if(t.view.aim===undefined&&t.target>=0){
      const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),b=w.project(e.xs[t.target],e.ys[t.target],0,this.q);
      t.want=dir8(b.x-a.x,b.y-a.y,t.want);
    }
    if(t.dir===t.want){t.turnMs=0;return;}
    t.turnMs+=dtMs;
    while(t.turnMs>=TURN_MS&&t.dir!==t.want){t.turnMs-=TURN_MS;t.dir=turnToward(t.dir,t.want);}
  }

  /** The weapon's wanted row for a server aim (turns from +x), on the screen of the current view. */
  protected aimAt(t:Tower,aim:number){
    t.aimFor=aim;
    const w=this.o.world,a=w.project(t.view.x,t.view.y,0,this.p),turn=aim*Math.PI*2;
    const b=w.project(t.view.x+Math.cos(turn),t.view.y+Math.sin(turn),0,this.q);
    t.want=dir8(b.x-a.x,b.y-a.y,t.want);
  }
  /** Enemy `i` is still there and in reach of the defense (the cheap check between re-scans). */
  protected reaches(t:Tower,i:number):boolean{
    const e=this.enemies;
    if(i<0||i>=e.n)return false;
    const flying=!!e.air?.[i],hits=t.look.hits;
    if(hits==='air'?!flying:hits==='ground'&&flying)return false;
    const d=Math.hypot(e.xs[i]-t.view.x,e.ys[i]-t.view.y);
    return d<=t.look.range&&d>=t.look.minRange;
  }
  /**
   * A volley: muzzle flash, recoil, and the shots toward its aim: with the server's `aim`, the reachable enemy along it
   * (or a point along it at AIM_FALLBACK of the range); without, the nearest reachable enemy.
   */
  /** Sandbox `contorno=0` (torres-animacao-idle-tiro): no gold outline, the art itself in the recordings. */
  outline=true;
  /** Where a defense's weapon stands on screen (world px; its mount), once drawn: the sandbox's `foco=torre` camera. */
  mountOf(id:string):Pt|undefined{const t=this.towers.get(id);return t&&t.drawnPhase?{x:t.mount.x,y:t.mount.y}:undefined;}
  /** Volleys drawn so far (sandbox checks: torre-contador-de-tiros). */
  volleysDrawn=0;
  protected fire(t:Tower,nowMs:number){
    this.volleysDrawn++;
    // Each calibre's shot (audio/sfx.ts torre-*), throttled per calibre so a battery does not stack up.
    const audio=getAudio();if(audio.unlocked)audio.play(`torre-${t.look.calibre}`);
    const cal=t.cal,e=this.enemies,v=t.view;
    t.recoilUntil=nowMs+RECOIL_MS;t.fireAt=nowMs;
    let tx=NaN,ty=NaN;
    if(v.aim!==undefined){
      const i=aimedIndex(t.look,v.x,v.y,v.aim,e.n,e.xs,e.ys,e.air),turn=v.aim*Math.PI*2,reach=t.look.range*AIM_FALLBACK;
      if(i>=0){tx=e.xs[i];ty=e.ys[i];}else{tx=v.x+Math.cos(turn)*reach;ty=v.y+Math.sin(turn)*reach;}
    }else{
      const i=aimIndex(t.look,v.x,v.y,e.n,e.xs,e.ys,e.air);
      t.target=i;t.scanAt=nowMs+RESCAN_MS;
      if(i>=0){tx=e.xs[i];ty=e.ys[i];}
    }
    const has=Number.isFinite(tx);
    if(has&&cal.shot!=='aura'){ // snap the weapon to what it fired at
      const w=this.o.world,a=w.project(v.x,v.y,0,this.p),b=w.project(tx,ty,0,this.q);
      t.dir=t.want=dir8(b.x-a.x,b.y-a.y,t.dir);
    }
    this.muzzle(t);
    const mx=this.v.x,my=this.v.y;
    if(cal.flash>0){
      const f=this.addFlash(t,mx,my,cal.flash*this.f,cal.flashMs,nowMs,FX_DEPTH.flash);
      // A rifle's flash is a long star along its barrel (the round one stays for the heavy mouths and the radar).
      if(cal.shot==='tracer'){const d=dirVector(t.dir,this.q);f.long=true;f.rot=Math.atan2(d.y*.5,d.x);}
    }
    // The heavy calibres (an explosive shot, the rockets) leave a puff of smoke at the muzzle that rises and thins out,
    // under the flash.
    if(cal.flash>0&&(cal.blast>0||cal.shot==='rocket'))this.addFlash(t,mx,my,cal.flash*this.f*SMOKE_R,cal.flashMs*SMOKE_MS,nowMs,FX_DEPTH.flash/2,true);
    if(cal.shot==='aura'){this.addBlast(v.x,v.y,t.look.range,cal.blastMs,nowMs,true);return;}
    if(!has||cal.shot==='none')return;
    if(cal.shot==='beam'){this.addBeam(t,tx,ty,nowMs,mx,my);return;}
    if(cal.shot==='pulse'){this.addBlast(tx,ty,t.look.area,cal.blastMs,nowMs,true,PULSE_TINT);return;}
    const n=Math.min(BURST_MAX,t.look.shots),h=t.height*PHASE_HEIGHT[t.phase];
    // The path starts over the defense's centre at its roof; the drawn shot leaves the barrel tip (the offset fades out).
    const start=this.o.world.project(v.x,v.y,h,this.p),ox=mx-start.x,oy=my-start.y;
    for(let i=0;i<n;i++){
      // Deterministic spread of a burst around the aim point (golden angle), staggered in time.
      const a=i*2.39996,r=i?.35+.15*i:0;
      const x1=tx+Math.cos(a)*r,y1=ty+Math.sin(a)*r,dist=Math.hypot(x1-v.x,y1-v.y);
      this.addShot(t,v.x,v.y,h,x1,y1,nowMs+i*BURST_GAP_MS,flightMs(cal,dist),ox,oy);
    }
  }
  /** World px of the muzzle tip into this.v (mount + barrel along the weapon's direction). */
  protected muzzle(t:Tower){
    // The delivered weapon's own muzzle (meta.muzzle, per direction row) while its sheet is drawn.
    const art=t.drawnPose>=0?towerArt(t.view.kind):undefined,m=art?.muzzle?.[t.dir],idle=art?.idle;
    if(m&&idle){
      const k=this.kindScale(t.view.kind),[cw,ch]=idle.cell,a=idle.anchor??[.5,.5];
      this.v.x=t.mount.x+(m[0]-a[0])*cw*k;this.v.y=t.mount.y+(m[1]-a[1])*ch*k;return;
    }
    const d=dirVector(t.dir,this.v),len=t.cal.barrel*this.unitPx;
    this.v.x=t.mount.x+d.x*len;this.v.y=t.mount.y+d.y*len*.5;
  }
}

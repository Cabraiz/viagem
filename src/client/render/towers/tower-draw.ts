/**
 * A defense itself (moved from towers.ts, corte C2): its depth, the delivered or baked base, the Gustavão's rail, the
 * cast shadow, and the weapon (delivered pose or baked procedural).
 */
import Phaser from 'phaser';
import {MATERIALS} from '../city/palette.ts';
import {depth as groundDepthKey,type Pt} from '../city/projection.ts';
import {SHADOW_SOFT_PX,castHeight,softShadow,towerShadowLook} from './tower-shadow.ts';
import {PHASE_HEIGHT,baseFrame,canFire,clipOf,dirVector,towerArt,textureRatio,weaponFrame,weaponPose,type Dir8} from './tower-rules.ts';
import {BRANCH_MATERIAL,POST_PX} from './tower-tuning.ts';
import type {Tower} from './tower-types.ts';
import {towerBaseKey,towerFireKey,towerGunKey} from './tower-art-queue.ts';
import {TowerFx} from './tower-fx.ts';

export abstract class TowerDraw extends TowerFx {

  /** Sandbox `anim=0` (the FPS check of torres-animacao-idle-tiro): the weapons stand on the idle's frame 0, as before. */
  animate=true;
  // ---- the defense itself ----
  /**
   * Base and weapon are Images of baked textures (one per kind × phase × view, and per kind × direction × recoil),
   * drawn once into a scratch Graphics and kept: a Graphics would re-tessellate every frame.
   */
  protected drawTower(t:Tower,view:number){
    const w=this.o.world,v=t.view;
    // The sheet arrived after the defense was made (cena-nasce-rapido: tower art streams in after the opening); until
    // then nothing is drawn (no procedural box swapped under the player's eyes), for at most TOWER_ART_WAIT_MS.
    if(t.artWait){
      if(this.scene.textures.exists(towerBaseKey(v.kind))){t.artWait=false;t.art=true;t.drawnPhase='';}
      else if(this.now<t.hideUntil){if(t.base.visible){t.base.setVisible(false);t.weapon.setVisible(false);}return;}
      if(!t.base.visible){t.base.setVisible(true);t.weapon.setVisible(true);t.drawnPhase='';}
    }
    if(t.drawnPhase!==t.phase||t.drawnView!==view){ // a defense stands still: its drawing changes only with its phase or the camera
      t.drawnPhase=t.phase;t.drawnView=view;t.drawnDir=-1;t.height=t.look.height;this.coverDirty=true;
      this.sortTower(t);
      const top=w.project(v.x,v.y,t.look.height*PHASE_HEIGHT[t.phase],this.p);t.mount.x=top.x;t.mount.y=top.y-POST_PX*this.f;
      if(t.art)this.placeArt(t,view);
      else this.placeBase(t,view);
      this.placeRail(t,view);
      this.placeShadow(t,view);
    }
    const recoil=this.now<t.recoilUntil,pose=this.artPose(t),key=pose?(pose.fire?1000:0)+pose.frame:-1;
    if(t.drawnDir!==t.dir||t.drawnRecoil!==recoil||t.drawnPose!==key){t.drawnDir=t.dir;t.drawnRecoil=recoil;t.drawnPose=key;this.placeWeapon(t,recoil,pose);}
  }
  /**
   * Draw depth at the footprint's front corner (the one nearest the viewer), like a city block: a figure behind any
   * part of the defense sorts behind it, and the fade test compares the figure against that same corner.
   */
  protected sortTower(t:Tower){
    const w=this.o.world,v=t.view,{hx,hy}=this.extents(t),view=w.view();
    let best=-Infinity,fx=v.x,fy=v.y;
    for(const sx of [-1,1])for(const sy of [-1,1]){
      const x=v.x+sx*hx,y=v.y+sy*hy,k=groundDepthKey(x,y,view);
      if(k>best){best=k;fx=x;fy=y;}
    }
    t.prop.x=fx;t.prop.y=fy;t.depth=w.depth(fx,fy);
    t.base.setDepth(t.depth);t.weapon.setDepth(t.depth+.001);
  }
  protected placeArt(t:Tower,view:number){
    const art=towerArt(t.view.kind)!,file=art.base!,img=t.base,w=this.o.world,p=w.project(t.view.x,t.view.y,0,this.p);
    const scale=this.kindScale(t.view.kind),anchor=file.anchor??[.5,.85];
    img.setTexture(towerBaseKey(t.view.kind)).setOrigin(anchor[0],anchor[1]).setPosition(p.x,p.y).setScale(scale/textureRatio(file))
      .setFrame(baseFrame(t.phase,view,Math.max(1,Math.min(4,file.views??4)),Array.isArray(file.rows)?file.rows:undefined));
    const b=img.getBounds();t.rect.x=b.x;t.rect.y=b.y;t.rect.w=b.width;t.rect.h=b.height;
    if(art.mount){t.mount.x=p.x+(art.mount[0]-anchor[0]*file.cell[0])*scale;t.mount.y=p.y+(art.mount[1]-anchor[1]*file.cell[1])*scale;}
  }
  /**
   * Half extents (u) of the base box and of what is drawn around it (wire coils), along world x and y. A site defense
   * fills its square site at the art footprint's proportions; the Gustavão's carriage stands on its rail (`half`, the
   * sim's 12 × 4 cells), whose track (placeRail) runs the rail's whole length (`rail`: half length, along x when
   * `railX`; `gauge`: half the rail's width).
   */
  protected extents(t:Tower):{hx:number;hy:number;ex:number;ey:number;rail:number;railX:boolean;gauge:number}{
    const v=t.view,look=t.look;
    if(v.half){
      const [ax,ay]=v.half,railX=ax>=ay;
      const hx=railX?ax*.42:ax*.72,hy=railX?ay*.72:ay*.42;
      return {hx,hy,ex:hx*1.05,ey:hy*1.05,rail:railX?ax:ay,railX,gauge:railX?ay:ax};
    }
    const big=Math.max(look.footprint[0],look.footprint[1]);
    const hx=v.r*.85*look.footprint[0]/big,hy=v.r*.85*look.footprint[1]/big,wire=look.calibre==='arame'?v.r*1.45:0;
    return {hx,hy,ex:Math.max(hx*1.3,wire),ey:Math.max(hy*1.05,wire),rail:0,railX:true,gauge:0};
  }
  /** The Gustavão's track as a ground decal (baked once per view and size), under the carriage. */
  protected placeRail(t:Tower,view:number){
    const {rail,railX,gauge}=this.extents(t);
    if(!(rail>0)){t.rail?.setVisible(false);return;}
    const v=t.view,w=this.o.world,pad=Math.ceil(4*this.s)+2,at=(along:number,across:number,out:Pt)=>railX?w.project(v.x+along,v.y+across,0,out):w.project(v.x+across,v.y+along,0,out);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const a of [-rail,rail])for(const b of [-gauge,gauge]){const p=at(a,b,this.p);minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const ox=Math.floor(minX)-pad,oy=Math.floor(minY)-pad,wpx=Math.ceil(maxX-ox)+pad,hpx=Math.ceil(maxY-oy)+pad,s=this.s;
    const name=`trilho:${view}:${rail.toFixed(3)}:${gauge.toFixed(3)}:${railX?1:0}:${Math.round(this.unitPx)}:${s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      for(let i=-12;i<=12;i++){ // sleepers across the gauge, then the two rails (Breu edge, a steel highlight)
        const a=at(rail*i/12.5,-gauge*.8,this.p),b=at(rail*i/12.5,gauge*.8,this.q);
        g.lineStyle(Math.max(2,5*s),this.breu,.9).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,3*s),MATERIALS.madeira.escura,1).lineBetween(a.x,a.y,b.x,b.y);
      }
      for(const off of [-.5,.5]){
        const a=at(-rail,off*gauge,this.p),b=at(rail,off*gauge,this.q);
        g.lineStyle(Math.max(2,5*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,2*s),MATERIALS['metal-pintado'].luz,1).lineBetween(a.x,a.y,b.x,b.y);
      }
    });
    if(!t.rail){t.rail=this.scene.make.image({x:0,y:0,key:f.key,frame:f.frame},false);this.ground.add(t.rail);t.rail.setDepth(-1);}
    this.setFrame(t.rail,f).setOrigin(0,0).setPosition(ox,oy).setVisible(true);
  }
  /**
   * The cast shadow (tower-shadow.ts): the footprint stretched away from the sun by the drawn height (obra and ruin by
   * phase), baked once per kind × phase × view × size like the base and placed at its screen bounds. None with the
   * light off or in economy mode.
   */
  protected placeShadow(t:Tower,view:number){
    const look=towerShadowLook(this.light,this.economyOn);
    if(!look){t.shadow?.setVisible(false);return;}
    // A post drawn at the hero's size (towerKindScale) casts the shadow of what is drawn, not of its whole site.
    const v=t.view,w=this.o.world,k=t.art?this.kindScale(v.kind)/this.artScale:1,e=this.extents(t),hx=e.hx*k,hy=e.hy*k;
    const H=castHeight(t.look.calibre,t.look.height*PHASE_HEIGHT[t.phase])*k;
    const foot=[[-hx,-hy],[hx,-hy],[hx,hy],[-hx,hy]].map(([dx,dy])=>{const p=w.project(v.x+dx,v.y+dy,0,this.p);return {x:p.x,y:p.y};});
    const soft=softShadow(foot,H,this.unitPx,look,SHADOW_SOFT_PX*this.s);
    if(!soft.polys.length){t.shadow?.setVisible(false);return;}
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of soft.polys[0]){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const ox=Math.floor(minX)-2,oy=Math.floor(minY)-2,wpx=Math.ceil(maxX-ox)+2,hpx=Math.ceil(maxY-oy)+2;
    const name=`sombra:${v.kind}:${t.phase}:${view}:${v.r.toFixed(3)}:${v.half?`${v.half[0].toFixed(3)}x${v.half[1].toFixed(3)}`:''}:${Math.round(this.unitPx)}:${this.s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      for(const poly of soft.polys)g.fillStyle(look.color,soft.alpha).fillPoints(poly,true);
    });
    if(!t.shadow){t.shadow=this.scene.make.image({x:0,y:0,key:f.key,frame:f.frame},false);this.shade.add(t.shadow);}
    // Like the base: the bake is at this defense's world position, another of the same kind and size reuses it shifted.
    this.setFrame(t.shadow,f).setOrigin(0,0).setPosition(ox,oy).setVisible(true);
  }
  /** The procedural base, baked once per kind × phase × view × size, placed over its screen bounds. */
  protected placeBase(t:Tower,view:number){
    const v=t.view,w=this.o.world,{ex,ey}=this.extents(t),pad=Math.ceil(3*this.s)+2;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const sx of [-1,1])for(const sy of [-1,1])for(const z of [0,t.look.height]){
      const p=w.project(v.x+sx*ex,v.y+sy*ey,z,this.p);
      minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
    }
    // Occlusion rect: the box itself up to its drum (not the rails, wire or barrel reach), like a building's silhouette.
    {
      const {hx,hy}=this.extents(t),H=t.look.height*PHASE_HEIGHT[t.phase];
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for(const sx of [-1,1])for(const sy of [-1,1])for(const z of [0,H]){
        const p=w.project(v.x+sx*hx,v.y+sy*hy,z,this.p);
        x0=Math.min(x0,p.x);x1=Math.max(x1,p.x);y0=Math.min(y0,p.y);y1=Math.max(y1,p.y);
      }
      if(canFire(t.phase))y0-=POST_PX*this.f*1.5;
      t.rect.x=x0;t.rect.y=y0;t.rect.w=x1-x0;t.rect.h=y1-y0;
    }
    const ox=Math.floor(minX)-pad,oy=Math.floor(minY)-pad,wpx=Math.ceil(maxX-ox)+pad,hpx=Math.ceil(maxY-oy)+pad;
    const name=`base:${v.kind}:${t.phase}:${view}:${v.r.toFixed(3)}:${v.half?`${v.half[0].toFixed(3)}x${v.half[1].toFixed(3)}`:''}:${Math.round(this.unitPx)}:${this.s.toFixed(3)}`;
    const f=this.atlas.frame(name,wpx,hpx,this.bake,g=>{
      g.translateCanvas(-ox,-oy);
      this.drawBase(g,t,t.look.height*PHASE_HEIGHT[t.phase]);
      if(t.look.calibre==='arame'&&canFire(t.phase))this.drawWire(g,t);
    });
    // The bake is at the defense's own world position: another one of the same kind and size reuses it shifted.
    this.setFrame(t.base,f).setOrigin(0,0).setPosition(ox,oy).setScale(1);
  }
  /** Procedural base: an iso box of the footprint in the branch's material, by phase (absolute world px into g). */
  protected drawBase(g:Phaser.GameObjects.Graphics,t:Tower,H:number){
    const v=t.view,look=t.look,phase=t.phase,s=this.s,w=this.o.world,c=this.corners,{hx,hy}=this.extents(t);
    const ruin=phase==='ruina',hurt=phase==='danificada'||ruin,obra=phase.startsWith('obra');
    const m=ruin?MATERIALS.pedra:obra?MATERIALS.madeira:BRANCH_MATERIAL[look.branch];
    const xs=[-hx,hx,hx,-hx],ys=[-hy,-hy,hy,hy];
    for(let i=0;i<4;i++){w.project(v.x+xs[i],v.y+ys[i],0,c[i]);w.project(v.x+xs[i],v.y+ys[i],H,c[i+4]);}
    const centre=w.project(v.x,v.y,H*.5,this.q);
    const line=Math.max(1,2*s);
    // Side faces facing the camera (their bottom middle below the centre on screen), then the top.
    for(let i=0;i<4;i++){
      const j=(i+1)%4,a=c[i],b=c[j],midY=(a.y+b.y)/2,midX=(a.x+b.x)/2;
      if(midY<centre.y)continue;
      const fill=hurt||midX>centre.x?m.escura:m.clara;
      g.fillStyle(fill,1).lineStyle(line,this.breu,1);
      g.beginPath().moveTo(a.x,a.y).lineTo(b.x,b.y).lineTo(c[j+4].x,c[j+4].y).lineTo(c[i+4].x,c[i+4].y).closePath().fillPath().strokePath();
      if(phase==='danificada'){ // cracks
        const x0=a.x*.6+b.x*.4,y0=a.y*.6+b.y*.4-(a.y-c[i+4].y)*.2;
        g.lineStyle(Math.max(1,1.5*s),this.breu,1).beginPath().moveTo(x0,y0).lineTo(x0+4*s,y0-6*s).lineTo(x0-1*s,y0-11*s).lineTo(x0+5*s,y0-16*s).strokePath();
      }
    }
    g.fillStyle(ruin?MATERIALS.pedra.luz:hurt?m.clara:m.luz,1).lineStyle(line,this.breu,1);
    g.beginPath().moveTo(c[4].x,c[4].y).lineTo(c[5].x,c[5].y).lineTo(c[6].x,c[6].y).lineTo(c[7].x,c[7].y).closePath().fillPath().strokePath();
    if(ruin){ // rubble chunks
      for(let i=0;i<3;i++){const p=w.project(v.x+xs[i]*.7,v.y+ys[(i+1)%4]*.5,H,this.p);g.fillStyle(MATERIALS.pedra.clara,1).lineStyle(line,this.breu,1).fillCircle(p.x,p.y,4*s).strokeCircle(p.x,p.y,4*s);}
    }else if(!obra&&look.calibre!=='gustavao'){ // sandbag rim on the roof
      const p=w.project(v.x,v.y,H,this.p),rw=Math.min(hx,hy)*this.unitPx*.9;
      g.lineStyle(Math.max(1,5*s),this.breu,1).strokeEllipse(p.x,p.y,rw*2,rw).lineStyle(Math.max(1,3*s),this.papel,1).strokeEllipse(p.x,p.y,rw*2,rw);
    }
    if(obra){ // scaffold poles up to the finished height
      const top=look.height;
      for(let i=0;i<4;i++){
        const a=c[i],b=w.project(v.x+xs[i],v.y+ys[i],top,this.p);
        g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
      }
      const a=w.project(v.x+xs[0],v.y+ys[0],top,this.p),b=w.project(v.x+xs[2],v.y+ys[2],top,this.v);
      g.lineStyle(Math.max(1,3*s),this.breu,1).lineBetween(a.x,a.y,b.x,b.y).lineStyle(Math.max(1,1.5*s),MATERIALS.madeira.luz,1).lineBetween(a.x,a.y,b.x,b.y);
    }
  }
  /**
   * The delivered weapon's pose now (weaponPose: the fire sheet after a volley, else the idle loop); undefined when the
   * weapon is procedural (no idle sheet loaded). The fire sheet counts once it is loaded (it streams after the idle).
   */
  protected artPose(t:Tower){
    if(!t.art)return undefined;
    const art=towerArt(t.view.kind),idle=clipOf(art?.idle,4);
    if(!idle||!this.scene.textures.exists(towerGunKey(t.view.kind)))return undefined;
    if(!this.animate)return {fire:false,frame:0};
    const fire=art?.fire&&this.scene.textures.exists(towerFireKey(t.view.kind))?clipOf(art.fire,12):undefined;
    return weaponPose(this.now,t.fireAt,t.seedMs,idle,fire,this.o.reduced);
  }
  /** The weapon: the delivered idle or fire sheet's frame (artPose), or a baked procedural texture per kind × direction × recoil. */
  protected placeWeapon(t:Tower,recoil:boolean,pose=this.artPose(t)){
    // The wire's procedural weapon is the wire itself (drawWire); its delivered sheet is the siren's crew.
    const show=(canFire(t.phase)||t.phase==='obra-3')&&(t.look.calibre!=='arame'||!!pose);
    t.weapon.setVisible(show);
    if(!show)return;
    const art=pose?towerArt(t.view.kind):undefined,file=pose?.fire?art?.fire:art?.idle;
    if(pose&&file){
      const frames=Math.max(1,file.frames??1),anchor=file.anchor??[.5,.5];
      t.weapon.setTexture(pose.fire?towerFireKey(t.view.kind):towerGunKey(t.view.kind)).setOrigin(anchor[0],anchor[1]).setPosition(t.mount.x,t.mount.y)
        .setScale(this.kindScale(t.view.kind)/textureRatio(file)).setFrame(weaponFrame(t.dir,pose.frame,frames));
      return;
    }
    const name=(d:number,r:boolean)=>`arma:${t.view.kind}:${d}:${r?1:0}:${Math.round(this.unitPx)}`;
    if(!this.atlas.get(name(t.dir,recoil))){ // all 16 poses at once: one upload, no bake while it turns
      for(let d=0;d<8;d++)for(const r of [false,true]){
        const b=this.weaponBounds(t,r,d as Dir8);
        this.atlas.frame(name(d,r),b.x1-b.x0,b.y1-b.y0,this.bake,g=>this.drawWeapon(g,t,r,d as Dir8,-b.x0,-b.y0));
      }
    }
    // Each pose is cropped to what it draws (fill rate: a padded square per weapon tripled the defenses' pixels).
    const b=this.weaponBounds(t,recoil,t.dir),f=this.atlas.get(name(t.dir,recoil))!;
    this.setFrame(t.weapon,f).setOrigin(-b.x0/f.w,-b.y0/f.h).setPosition(t.mount.x,t.mount.y).setScale(1);
  }
  /** The weapon's drawing, relative to its pivot (the mount), for a pose. */
  protected weaponGeom(t:Tower,recoil:boolean,dir:Dir8){
    const s=this.f,cal=t.cal,d=dirVector(dir,this.v),k=recoil?-.12:0,len=cal.barrel*this.unitPx;
    const gus=t.look.calibre==='gustavao';
    return {d,x0:d.x*len*k,y0:d.y*len*k*.5,x1:d.x*len*(1+k),y1:d.y*len*.5*(1+k),
      disc:(gus?16:9)*s,thick:(gus?12:cal.blast>1?9:6)*s,post:POST_PX*s,line:Math.max(1,2*s),s};
  }
  /** Bounds (px, relative to the mount, rounded out) of a pose's drawing. */
  protected weaponBounds(t:Tower,recoil:boolean,dir:Dir8){
    const g=this.weaponGeom(t,recoil,dir),shot=t.cal.shot;
    let x0=-g.disc-g.line,x1=g.disc+g.line,y0=-g.disc/2-g.line,y1=g.post+g.disc/2+g.line;
    const add=(x:number,y:number,rx:number,ry:number)=>{x0=Math.min(x0,x-rx);x1=Math.max(x1,x+rx);y0=Math.min(y0,y-ry);y1=Math.max(y1,y+ry);};
    if(shot==='beam')add(g.x1,g.y1-g.disc*.6,g.disc*1.1,g.disc*1.1);
    else if(shot==='none'||shot==='pulse')add(g.x1,g.y1-g.disc*1.4,g.disc*1.4+g.line,g.disc*.9+g.line);
    else{const r=(g.thick+3*g.s)/2;add(g.x0,g.y0,r,r);add(g.x1,g.y1,Math.max(r,g.thick*.75),Math.max(r,g.thick*.75));}
    return {x0:Math.floor(x0)-2,y0:Math.floor(y0)-2,x1:Math.ceil(x1)+2,y1:Math.ceil(y1)+2};
  }
  /** Procedural weapon with its pivot at (mx, my): a drum, then a barrel toward the direction row (a lamp, a dish). */
  protected drawWeapon(g:Phaser.GameObjects.Graphics,t:Tower,recoil:boolean,dir:Dir8,mx:number,my:number){
    const cal=t.cal,w=this.weaponGeom(t,recoil,dir),{d,disc,thick,post,line,s}=w;
    const x0=mx+w.x0,y0=my+w.y0,x1=mx+w.x1,y1=my+w.y1;
    const metal=MATERIALS['metal-pintado'];
    // The mount: a short drum from the roof up to the weapon's pivot (Breu contour, light top).
    g.fillStyle(metal.escura,1).lineStyle(line,this.breu,1).fillRect(mx-disc,my,disc*2,post).strokeRect(mx-disc,my,disc*2,post)
      .fillEllipse(mx,my+post,disc*2,disc).strokeEllipse(mx,my+post,disc*2,disc)
      .fillStyle(metal.luz,1).fillEllipse(mx,my,disc*2,disc).strokeEllipse(mx,my,disc*2,disc);
    if(cal.shot==='beam'){ // the lamp: a light disc facing the target
      g.fillStyle(this.breu,1).fillCircle(x1,y1-disc*.6,disc*1.1).fillStyle(this.papel,1).fillCircle(x1,y1-disc*.6,disc*.8)
        .fillStyle(this.amarelo,1).fillCircle(x1+d.x*disc*.2,y1-disc*.6+d.y*disc*.1,disc*.45);
      return;
    }
    if(cal.shot==='none'||cal.shot==='pulse'){ // radar dish
      g.lineStyle(thick*.6+2*s,this.breu,1).lineBetween(mx,my,x1,y1-disc*1.4).fillStyle(this.breu,1).fillEllipse(x1,y1-disc*1.4,disc*2.8,disc*1.8)
        .fillStyle(this.papel,1).fillEllipse(x1,y1-disc*1.4,disc*2.3,disc*1.4);
      return;
    }
    // Barrel: Breu contour, dark metal, a light highlight, and the muzzle ring.
    g.lineStyle(thick+3*s,this.breu,1).lineBetween(x0,y0,x1,y1).lineStyle(thick,metal.escura,1).lineBetween(x0,y0,x1,y1)
      .lineStyle(Math.max(1,thick*.3),metal.luz,1).lineBetween(x0,y0-thick*.2,x1,y1-thick*.2)
      .fillStyle(this.breu,1).fillCircle(x1,y1,thick*.75);
  }
  /** C3: coils of wire around the post (no turning weapon), baked with the base. */
  protected drawWire(g:Phaser.GameObjects.Graphics,t:Tower){
    const s=this.s,w=this.o.world,r=t.view.r*1.3;
    for(let i=0;i<8;i++){
      const a=i/8*Math.PI*2,p=w.project(t.view.x+Math.cos(a)*r,t.view.y+Math.sin(a)*r,.12,this.p);
      g.lineStyle(Math.max(1,2.5*s),this.breu,1).strokeCircle(p.x,p.y,4*s).lineStyle(Math.max(1,1.2*s),MATERIALS['metal-pintado'].luz,1).strokeCircle(p.x,p.y,4*s);
    }
  }
}

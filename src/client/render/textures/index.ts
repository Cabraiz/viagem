/** Procedural horde textures (enemies, pickups, vehicles, fx), generated once per scene unless the art already loaded the key. */
import Phaser from 'phaser';
import {ENEMY_ART,ELITE_SCALE,ENEMY_KINDS,PICKUP_KINDS,PICKUP_SIZE,enemyTexture,hasActingPose,pickupTexture,vehicleTexture} from '../keys.ts';
import {VEHICLE_KINDS} from '../../../contract/index.ts';
import type {G} from './shapes.ts';
import {drawEnemy} from './enemies.ts';
import {PICKUP_DRAW,VEHICLE_DRAW,drawFx} from './props.ts';

export function ensureHordeTextures(scene:Phaser.Scene):void {
  const g=scene.make.graphics({},false);
  const make=(key:string,w:number,h:number,draw:(g:G)=>void)=>{
    if(scene.textures.exists(key))return;
    g.clear();draw(g);g.generateTexture(key,w,h);
  };
  for(const kind of ENEMY_KINDS){
    const a=ENEMY_ART[kind];
    make(enemyTexture(kind),a.width,a.height,g=>drawEnemy(g,kind,false));
    if(kind!=='chefe')make(enemyTexture(kind,true),Math.ceil(a.width*ELITE_SCALE),Math.ceil(a.height*ELITE_SCALE),g=>drawEnemy(g,kind,true));
    // Elenco P1: the acting pose (EnemyView.phase 1), plain and elite, the same size as the idle one.
    if(hasActingPose(kind)){
      make(enemyTexture(kind,false,true),a.width,a.height,g=>drawEnemy(g,kind,false,true));
      make(enemyTexture(kind,true,true),Math.ceil(a.width*ELITE_SCALE),Math.ceil(a.height*ELITE_SCALE),g=>drawEnemy(g,kind,true,true));
    }
  }
  for(const kind of PICKUP_KINDS){
    const {width,height}=PICKUP_SIZE[kind];
    make(pickupTexture(kind),width,height,g=>{g.save().translateCanvas(width/2,height/2);PICKUP_DRAW[kind](g);g.restore();});
  }
  // Veículos: the parked vehicles, one provisional texture per kind (the final art: design/proximos).
  for(const kind of VEHICLE_KINDS){
    const {width,height}=PICKUP_SIZE.vehicle;
    make(vehicleTexture(kind),width,height,g=>{g.save().translateCanvas(width/2,height/2);VEHICLE_DRAW[kind](g);g.restore();});
  }
  drawFx(make);
  g.destroy();
}
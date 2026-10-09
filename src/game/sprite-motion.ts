export type Motion='idle'|'walk'|'attack';
// Idle drawings vary in pose in the candidate atlases. Hold a single pose so
// standing characters cannot appear to walk even when world coordinates stop.
export const SPRITE_CLIPS={
  idle:{frames:[0],frameRate:3,repeat:-1},
  walk:{frames:[6,7,8,9,10,11],frameRate:5,repeat:-1},
  attack:{frames:[12,13,14,15,16,17],frameRate:6,repeat:0},
} as const;
export const ATTACK_VISUAL_MS=SPRITE_CLIPS.attack.frames.length/SPRITE_CLIPS.attack.frameRate*1000;
export class SpriteMotion {
  private lastAttack=0;
  private attackUntil=0;
  update(now:number,moving:boolean,attackTick=0,alive=true):Motion{
    // A rematch resets authoritative ticks; old swings must not suppress new ones.
    if(attackTick<this.lastAttack){this.lastAttack=attackTick;this.attackUntil=0;}
    if(!alive){this.lastAttack=attackTick;this.attackUntil=0;return 'idle';}
    if(attackTick>this.lastAttack){
      this.lastAttack=attackTick;
      // Server hits may arrive faster than the slower visual cycle. Consume
      // overlapping events without restarting or extending the current swing.
      if(now>=this.attackUntil)this.attackUntil=now+ATTACK_VISUAL_MS;
    }
    return now<this.attackUntil?'attack':moving?'walk':'idle';
  }
}

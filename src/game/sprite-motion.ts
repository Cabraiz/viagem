export type Motion='idle'|'walk'|'attack';
export class SpriteMotion {
  private lastAttack=0;
  private attackUntil=0;
  update(now:number,moving:boolean,attackTick=0,alive=true):Motion{
    if(!alive){this.lastAttack=attackTick;this.attackUntil=0;return 'idle';}
    if(attackTick>this.lastAttack){this.lastAttack=attackTick;this.attackUntil=now+500;}
    return now<this.attackUntil?'attack':moving?'walk':'idle';
  }
}

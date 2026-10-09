import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Pool,KeyedPool,Ring} from '../src/game/render/pool.ts';
import {squash,gemBounce,hitFlash,poof,popText,damageFloat,telegraphPulse,telegraphBlink,hashPhase,smoothToward,POOF_MS,POP_TEXT_MS} from '../src/game/render/motion.ts';
import {deathLine,deathLines,kindStyle,damageLabel,GENERIC_LINES} from '../src/game/render/jokes.ts';
import {ENEMY_KINDS,enemyTexture} from '../src/game/render/keys.ts';

interface Fake {n:number;visible:boolean;resets:number}
const fakes=()=>{let n=0;return {create:():Fake=>({n:n++,visible:false,resets:0}),reset:(item:Fake,active:boolean)=>{item.visible=active;item.resets++;}};};

test('pool reuses released items and counts them',()=>{
  const {create,reset}=fakes(),pool=new Pool(create,reset);
  const a=pool.acquire(),b=pool.acquire();
  assert.equal(pool.created,2);assert.equal(pool.active,2);assert.ok(a.visible&&b.visible);
  pool.release(a);assert.equal(a.visible,false);assert.equal(pool.free,1);assert.equal(pool.active,1);
  assert.equal(pool.acquire(),a);assert.equal(pool.created,2);assert.equal(pool.free,0);
});

test('keyed pool reconciles frames and retires missing ids',()=>{
  const {create,reset}=fakes(),pool=new KeyedPool(create,reset);
  pool.begin();
  assert.equal(pool.use('a').fresh,true);assert.equal(pool.use('b').fresh,true);
  pool.end();
  pool.begin();
  const used=pool.use('a');assert.equal(used.fresh,false);assert.equal(used.item,pool.get('a'));
  const retired:string[]=[];pool.end(id=>retired.push(id));
  assert.deepEqual(retired,['b']);assert.equal(pool.size,1);assert.equal(pool.get('b'),undefined);
  pool.begin();const c=pool.use('c');assert.equal(c.fresh,true);pool.use('a');pool.end();
  assert.equal(pool.created,2,'b item reused for c');
  pool.release('a');assert.equal(pool.size,1);assert.equal(pool.active,1);
});

test('300 entities in steady state stop creating after the first frame',()=>{
  const {create,reset}=fakes(),pool=new KeyedPool(create,reset);
  const ids=Array.from({length:300},(_,i)=>`e${i}`);
  let afterFirst=0;
  for(let frame=0;frame<120;frame++){
    pool.begin();for(const id of ids)pool.use(id);pool.end();
    if(frame===0)afterFirst=pool.created;
    assert.equal(pool.created,afterFirst);assert.equal(pool.active,300);assert.equal(pool.size,300);
  }
  assert.equal(afterFirst,300);
});

test('id churn keeps created bounded',()=>{
  const {create,reset}=fakes(),pool=new KeyedPool(create,reset);
  let next=0;const live:string[]=[];
  for(let i=0;i<300;i++)live.push(`e${next++}`);
  for(let frame=0;frame<120;frame++){
    live.splice(0,10);for(let i=0;i<10;i++)live.push(`e${next++}`);
    pool.begin();for(const id of live)pool.use(id);pool.end();
    assert.equal(pool.active,300);
  }
  assert.ok(pool.created<=310,`created ${pool.created}`);
});

test('ring respects its cap and recycles the oldest',()=>{
  const {create,reset}=fakes(),ring=new Ring(create,reset,3);
  const a=ring.spawn(),b=ring.spawn(),c=ring.spawn();
  assert.equal(ring.active,3);
  const d=ring.spawn();
  assert.equal(d,a,'oldest recycled');assert.equal(ring.created,3);assert.equal(ring.active,3);assert.equal(ring.recycled,1);
  assert.equal(ring.at(0),b);assert.equal(ring.at(2),a);
  for(let i=0;i<50;i++)ring.spawn();
  assert.equal(ring.created,3);assert.equal(ring.active,3);
  ring.retain(item=>item!==c);assert.equal(ring.active,2);assert.equal(c.visible,false);
  assert.equal(ring.spawn(),c,'released item reused before recycling');
  ring.release(b);assert.equal(ring.active,2);
  ring.clear();assert.equal(ring.active,0);assert.equal(ring.created,3);
});

test('motion helpers: reduced motion is identity and effects end',()=>{
  assert.deepEqual(squash(1234,.3,true,true),{sx:1,sy:1});
  for(let t=0;t<3000;t+=37){
    const idle=squash(t,.5,false,false),move=squash(t,.5,true,false);
    assert.ok(Math.abs(idle.sy-1)<=.0601&&Math.abs(move.sy-1)<=.1401);
  }
  assert.equal(gemBounce(200,true),0);assert.ok(gemBounce(190,false)<-10);
  assert.ok(Math.abs(gemBounce(899.9,false))<.5&&Math.abs(gemBounce(900.1,false))<.5,'continuous hop→bob');
  assert.ok(hitFlash(0)&&hitFlash(89)&&!hitFlash(90)&&!hitFlash(-1));
  assert.ok(Math.max(...Array.from({length:60},(_,i)=>poof(i*10).scale))>=1.75);
  assert.equal(poof(POOF_MS).done,true);assert.equal(poof(POOF_MS).alpha,0);assert.equal(poof(100).done,false);
  assert.equal(popText(POP_TEXT_MS,false).done,true);assert.equal(popText(150,true).scale,1);assert.ok(popText(150,false).scale>1);
  assert.equal(damageFloat(2000).done,true);assert.ok(damageFloat(100).alpha===1);
  assert.equal(telegraphBlink(500,.5,true),1);
  for(const reduced of [false,true]){
    let last=-1;
    for(let tick=60;tick<=110;tick+=.5){const u=telegraphPulse(tick,100,reduced,70);assert.ok(u>=last&&u>=0&&u<=1);last=u;}
    assert.equal(telegraphPulse(100,100,reduced),1);assert.equal(telegraphPulse(0,100,reduced),0);
  }
  const p=hashPhase('enemy-42');assert.equal(p,hashPhase('enemy-42'));assert.ok(p>=0&&p<1);assert.notEqual(p,hashPhase('enemy-43'));
  assert.equal(smoothToward(0,10,0,8),0);assert.ok(Math.abs(smoothToward(0,10,10000,8)-10)<1e-6);
});

test('jokes are deterministic, non-empty and fall back for unknown kinds',()=>{
  for(const kind of ENEMY_KINDS){
    assert.ok(deathLines(kind).length>=4);
    for(let i=0;i<40;i++){const line=deathLine(kind,`id${i}`);assert.ok(line.length>0);assert.equal(line,deathLine(kind,`id${i}`));assert.equal(line,line.toUpperCase());}
    assert.ok(kindStyle(kind).stroke.startsWith('#'));
  }
  assert.ok(GENERIC_LINES.includes(deathLine('dragao-novo','x1')));
  assert.ok(kindStyle('dragao-novo').fill);
  assert.equal(damageLabel(12.4,true),'12!');assert.equal(damageLabel(7),'7');
});

test('texture keys fall back for unknown kinds and the boss never goes elite',()=>{
  assert.equal(enemyTexture('dragao-novo'),'horde:enemy:gosma');
  assert.equal(enemyTexture('gosma',true),'horde:enemy:gosma:elite');
  assert.equal(enemyTexture('chefe',true),'horde:enemy:chefe');
  assert.ok(!enemyTexture('chefe',true).endsWith(':elite'));
});

test('Projector matches projectView/viewDepth in all four views without allocating per call',async()=>{
  const {Projector}=await import('../src/game/render/projector.ts');
  const {projectView,viewDepth}=await import('../src/game/projection.ts');
  const {TerrainField}=await import('../src/game/terrain/field.ts');
  const terrain=new TerrainField(1234);
  const out={x:0,y:0};
  for(let view=-1;view<5;view++){
    const projector=new Projector(view,terrain);
    for(let i=0;i<50;i++){
      const p={x:2+((i*7919)%2000)/100,y:2+((i*104729)%2000)/100};
      const expected=projectView(p,view,terrain);
      assert.equal(projector.project(p.x,p.y,out),out,'writes into the caller point');
      assert.ok(Math.abs(out.x-expected.x)<1e-9&&Math.abs(out.y-expected.y)<1e-9,`view ${view} point ${i}`);
      assert.ok(Math.abs(projector.depth(p.x,p.y)-viewDepth(p,view))<1e-9);
    }
  }
});

test('telegraph outline covers exactly the zone the server damages (D-015: cone width = aperture in radians)',async()=>{
  const {telegraphOutline,coneApertureOf,lineWidthOf}=await import('../src/game/render/telegraph-shape.ts');
  const {telegraphHits,DEFAULT_LINE_WIDTH,DEFAULT_CONE_ANGLE}=await import('../src/game/sim/telegraphs.ts');
  assert.equal(lineWidthOf({shape:'line',x:0,y:0,radius:1,dx:1,dy:0}),DEFAULT_LINE_WIDTH,'line default thickness is the server one');
  assert.equal(coneApertureOf({shape:'cone',x:0,y:0,radius:1,dx:1,dy:0}),DEFAULT_CONE_ANGLE,'cone default aperture is the server one');
  const inside=(poly:{x:number;y:number}[],x:number,y:number)=>{
    let hit=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];
      if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;
    }
    return hit;
  };
  const boss={shape:'cone' as const,x:10,y:10,radius:5.5,dx:1,dy:0,width:1.1};
  assert.equal(coneApertureOf(boss)/2,.55,'half aperture drawn = 0.55 rad');
  const shapes=[
    boss,
    {shape:'cone' as const,x:12,y:12,radius:4,dx:0,dy:-1},             // server default aperture
    {shape:'cone' as const,x:12,y:12,radius:3,dx:.6,dy:.8,width:2.4},
    {shape:'line' as const,x:6,y:8,radius:7,dx:.8,dy:.6,width:1.2},
    {shape:'line' as const,x:6,y:8,radius:7,dx:0,dy:1},                // server default thickness
    {shape:'circle' as const,x:12,y:12,radius:1.6,dx:1,dy:0},
  ];
  // 1 px at the phone's whole-island zoom (~0.26 × 42 px per unit) is ~0.09 world units; the chord error is far below that.
  const margin=.09;
  for(const t of shapes){
    const poly:{x:number;y:number}[]=[];
    const n=telegraphOutline(t,1,(i,x,y)=>{poly[i]={x,y};});
    poly.length=n;
    let checked=0;
    for(let gx=-8;gx<=8;gx+=.13)for(let gy=-8;gy<=8;gy+=.13){
      const p={x:t.x+gx,y:t.y+gy};
      const hit=telegraphHits(t,p,0),near=telegraphHits(t,p,margin)&&!telegraphHits({...t,radius:Math.max(0,t.radius-margin),width:t.shape==='line'?(t.width??1)-2*margin:t.width},p,0);
      if(near)continue; // boundary band: polygon chords may differ by < 1 px
      assert.equal(inside(poly,p.x,p.y),hit,`${t.shape} w=${t.width} at (${gx.toFixed(2)},${gy.toFixed(2)})`);
      checked++;
    }
    assert.ok(checked>1000);
  }
});

// ---------- Legibility (NEW-20261006-ORQ-horde-visual-noise) ----------
import {BAR_RECENT_MS,DAMAGE_MERGE_MS,FX_BUDGET,RecentHits,admitNumber,admitPop,barVisible,canMerge,evictionIndex,numberPriority} from '../src/game/render/legibility.ts';
import {insetPolygon,telegraphOutline as outlineOf} from '../src/game/render/telegraph-shape.ts';
import {Ring as NumberRing} from '../src/game/render/pool.ts';

test('health bars only for recently hit, elite, boss or the tapped target',()=>{
  const base={hp:5,maxHp:10,elite:false,boss:false,hitAt:1000};
  assert.equal(barVisible(base,1000+BAR_RECENT_MS-1,false),true);
  assert.equal(barVisible(base,1000+BAR_RECENT_MS,false),false,'old hit fades');
  assert.equal(barVisible({...base,hp:10},1001,false),false,'full hp never shows');
  assert.equal(barVisible({...base,hitAt:-1e9},5000,false),false,'damaged long ago');
  assert.equal(barVisible({...base,hitAt:-1e9,elite:true},5000,false),true);
  assert.equal(barVisible({...base,hitAt:-1e9,boss:true},5000,false),true);
  assert.equal(barVisible({...base,hitAt:-1e9,hp:10},5000,true),true,'tapped target');
});

test('damage numbers: merge window, priority and per-frame quota',()=>{
  const live={live:true,target:'e1',born:100};
  assert.equal(canMerge(live,'e1',100+DAMAGE_MERGE_MS-1),true);
  assert.equal(canMerge(live,'e1',100+DAMAGE_MERGE_MS),false);
  assert.equal(canMerge(live,'e2',101),false);
  assert.equal(canMerge({...live,live:false},'e1',101),false);
  assert.equal(canMerge(undefined,'e1',101),false);
  assert.equal(numberPriority(true,false,false,false),true,'crit');
  assert.equal(numberPriority(false,true,false,false),true,'local player hit');
  assert.equal(numberPriority(false,false,true,false),true,'elite');
  assert.equal(numberPriority(false,false,false,true),true,'boss');
  assert.equal(numberPriority(false,false,false,false),false,'plain hit (or an ally hit)');
  const {numbers:cap,numbersPerPush:quota}=FX_BUDGET.full;
  assert.equal(admitNumber(0,cap,0,quota,false),'spawn');
  assert.equal(admitNumber(cap,cap,0,quota,false),'drop','full screen drops plain hits');
  assert.equal(admitNumber(cap,cap,quota,quota,true),'recycle','priority always gets in');
  assert.equal(admitNumber(3,cap,quota,quota,false),'drop','per-frame quota');
  assert.equal(admitNumber(3,cap,quota,quota,true),'spawn');
});

test('effects budgets: about 25 numbers and at most 3 bubbles; reduced trims everything',()=>{
  const {full,reduced}=FX_BUDGET;
  assert.ok(full.numbers<=25&&full.bubbles<=3);
  for(const key of Object.keys(full) as (keyof typeof full)[])assert.ok(reduced[key]<=full[key],key);
  assert.ok(reduced.numbers<full.numbers&&reduced.starsPerKill<full.starsPerKill);
  assert.throws(()=>{(FX_BUDGET.full as {numbers:number}).numbers=99;});
});

test('a merge window of hits on one target shows one summed number',()=>{
  // Simulates the renderer's bookkeeping: hits arrive every 50 ms (one push per sim tick).
  type N={live:boolean;target:string;born:number;total:number};
  const shown:N[]=[],byTarget=new Map<string,N>();
  const hit=(target:string,amount:number,now:number)=>{
    const m=byTarget.get(target);
    if(canMerge(m,target,now)){(m as N).total+=amount;return;}
    const n={live:true,target,born:now,total:amount};shown.push(n);byTarget.set(target,n);
  };
  for(let t=0;t<300;t+=50)hit('e1',5,t);
  assert.deepEqual(shown.map(n=>n.total),[15,15],'three hits per 150 ms window');
});

test('death pops: budget for plain kills, boss and elite jokes always land',()=>{
  const {pops}=FX_BUDGET.reduced;
  assert.equal(admitPop(0,pops,false),true);
  assert.equal(admitPop(pops,pops,false),false,'plain kill over budget');
  assert.equal(admitPop(pops,pops,true),true,'boss/elite kill');
});

test('health bars: only the last N distinct enemies hit keep one (hits spread over 300 bichos)',()=>{
  const recent=new RecentHits(FX_BUDGET.full.bars);
  for(let i=0;i<300;i++)recent.hit(`e${i}`);
  assert.equal(recent.size,FX_BUDGET.full.bars);
  assert.equal(recent.has('e299'),true);assert.equal(recent.has('e0'),false);
  recent.hit('e270');recent.hit('new');
  assert.equal(recent.has('e270'),true,'a re-hit moves to the end and survives');
  assert.equal(recent.has('e271'),false,'oldest is evicted');
  recent.delete('e299');assert.equal(recent.has('e299'),false,'killed enemies free their slot');
  recent.setCap(FX_BUDGET.reduced.bars);assert.equal(recent.size,FX_BUDGET.reduced.bars);
  assert.equal(recent.has('new'),true);
  const base={hp:5,maxHp:10,elite:false,boss:false,hitAt:1000};
  assert.equal(barVisible(base,1001,false,false),false,'recent hit but outside the cap');
  assert.equal(barVisible({...base,elite:true},1001,false,false),true,'elite ignores the cap');
  assert.equal(barVisible(base,1001,true,false),true,'tapped target ignores the cap');
});

test('full screen: damage on the local player survives a flood of priority numbers (Ring + admitNumber)',()=>{
  type N={priority:boolean;self:boolean;id:string};
  for(const profile of ['full','reduced'] as const){
    const {numbers:cap,numbersPerPush:quota}=FX_BUDGET[profile];
    const ring=new NumberRing<N>(()=>({priority:false,self:false,id:''}),()=>{},FX_BUDGET.full.numbers);
    // Same bookkeeping as HordeRenderer.spawnNumber (merging aside: every hit is a new target).
    const add=(id:string,priority:boolean,self:boolean,used:number)=>{
      const admission=admitNumber(ring.active,cap,used,quota,priority);
      if(admission==='drop')return false;
      if(admission==='recycle'){const victim=ring.at(evictionIndex(ring.active,i=>ring.at(i)));if(victim)ring.release(victim);}
      const n=ring.spawn();n.priority=priority;n.self=self;n.id=id;return true;
    };
    add('me',true,true,0);
    for(let i=0;i<3;i++)add(`plain${i}`,false,false,i);
    for(let i=0;i<cap*3;i++)add(`crit${i}`,true,false,0); // several frames of crits/elite hits, all priority
    const ids:string[]=[];ring.forEach(n=>ids.push(n.id));
    assert.equal(ring.active,cap,profile);
    assert.ok(ids.includes('me'),`${profile}: local player damage kept`);
    assert.ok(!ids.some(id=>id.startsWith('plain')),`${profile}: plain numbers go first`);
    // Only local-player numbers left: the oldest of them goes.
    assert.equal(evictionIndex(2,i=>[{priority:true,self:true},{priority:true,self:true}][i]),0);
    assert.equal(evictionIndex(3,i=>[{priority:true,self:true},{priority:true,self:false},{priority:false,self:false}][i]),2);
    assert.equal(evictionIndex(2,i=>[{priority:true,self:true},{priority:true,self:false}][i]),1);
  }
});

test('telegraph stroke is inset: its outer edge never leaves the damage zone (D-015)',()=>{
  const zones=[
    {shape:'circle' as const,x:3,y:4,radius:1.6,dx:1,dy:0},
    {shape:'line' as const,x:0,y:0,radius:7,dx:.6,dy:.8,width:1.2},
    {shape:'cone' as const,x:1,y:1,radius:4,dx:0,dy:1,width:1.1},
    {shape:'cone' as const,x:1,y:1,radius:4,dx:1,dy:0,width:.5},
  ];
  const PX=32; // world px per unit, close to the projector at whole-island zoom
  const inside=(poly:{x:number;y:number}[],p:{x:number;y:number})=>{
    let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)c=!c;}return c;
  };
  const segDist=(p:{x:number;y:number},a:{x:number;y:number},b:{x:number;y:number})=>{
    const ex=b.x-a.x,ey=b.y-a.y,l=ex*ex+ey*ey||1,t=Math.max(0,Math.min(1,((p.x-a.x)*ex+(p.y-a.y)*ey)/l));return Math.hypot(a.x+ex*t-p.x,a.y+ey*t-p.y);
  };
  for(const zone of zones)for(const ui of [1,2.5]){
    const src:{x:number;y:number}[]=[];const n=outlineOf(zone,1,(i,x,y)=>{src[i]={x:x*PX,y:y*PX};});
    const out=Array.from({length:n},()=>({x:0,y:0}));
    const half=insetPolygon(src,n,8/2*ui,out);
    assert.ok(half>0);
    let worstLeak=0,before=0;
    for(let i=0;i<n;i++){
      const a=out[i],b=out[(i+1)%n];
      for(let k=0;k<=8;k++){
        const t=k/8,px=a.x+(b.x-a.x)*t,py=a.y+(b.y-a.y)*t,ex=b.x-a.x,ey=b.y-a.y,l=Math.hypot(ex,ey)||1;
        for(const s of [1,-1]){
          const q={x:px+s*-ey/l*half,y:py+s*ex/l*half}; // both edges of the stroke quad
          if(!inside(src,q)){let d=Infinity;for(let j=0;j<n;j++)d=Math.min(d,segDist(q,src[j],src[(j+1)%n]));worstLeak=Math.max(worstLeak,d);}
        }
      }
      // Old drawing: stroke centred on the zone edge leaks half its width.
      before=Math.max(before,8/2*ui);
    }
    assert.ok(worstLeak<=.08*half+1e-6,`${zone.shape} w=${zone.width} ui=${ui}: leak ${worstLeak.toFixed(2)}px (was ${before}px = ${(before/PX).toFixed(2)} un)`);
  }
});

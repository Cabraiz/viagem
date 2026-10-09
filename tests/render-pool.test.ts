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

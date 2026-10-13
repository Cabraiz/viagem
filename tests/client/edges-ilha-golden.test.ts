/**
 * Golden test of the island's edge arrows (card cidade-04 review): the city's rim rules in src/client/hud/edges.ts are
 * opt-in (EdgeOptions.city), so layoutEdges without it must lay out what main did. The reference is main's edges.ts
 * frozen in tests/client/fixtures/edges-main.ts. Over seeded random scenes (portrait and landscape, 100% and 125% text,
 * hero off centre, open windows, HUD boxes, caídos with clocks, pings and names, more targets than MAX_ARROWS) every
 * layout is identical to main's, except the one documented improvement: main's box for a caído whose tag hangs from the
 * ficha's right end left the ficha's left 4 px out of the hero check, so a caído could sit 2–3 px inside the hero's
 * keep-out (± HERO_MARGIN, or the HEAD_ROOM band of the top and bottom rims). A scene may differ only when main's layout
 * did that, and no layout of the island or of the city ever puts a ficha into the keep-out.
 * Run: node --experimental-strip-types --test tests/client/edges-ilha-golden.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as NOW from '../../src/client/hud/edges.ts';
import * as MAIN from './fixtures/edges-main.ts';
import {crosses,HERO_MARGIN,type Rect} from '../../src/client/hud/zones.ts';
import {layoutCityEdges} from '../../src/client/hud/city/index.ts';

const mulberry=(seed:number)=>()=>{seed=(seed+0x6d2b79f5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t=(t+Math.imul(t^(t>>>7),61|t))^t;return ((t^(t>>>14))>>>0)/2**32;};
const KINDS=['caido','chefe','spawn','base','aliado','bau'] as const;
const NAMES=['Zé','Concursei','Tia','Maria Aparecida'];

interface Scene {viewport:Rect;area:Rect;hero:Rect;targets:NOW.EdgeTarget[];options:NOW.EdgeOptions}
/** One random scene of the island: the reference phones' useful areas, the hero ± 24 px off its centre, 1–9 targets. */
function scene(rnd:()=>number):Scene{
  const portrait=rnd()<.5,vw=portrait?390:844,vh=portrait?844:390,scale=rnd()<.3?1.25:1;
  const notch=rnd()<.3?47:0;
  const area:Rect=portrait?{x:70,y:240+notch*(rnd()<.5?1:0),width:320-(rnd()<.3?20:0),height:402-(scale>1?32:0)-notch}
    :{x:138+notch*.6,y:100+rnd()*48,width:584-(scale>1?32:0)-notch*.6,height:155+rnd()*60};
  const hero={x:area.x+area.width/2-28+(rnd()-.5)*48,y:area.y+area.height/2-28+(rnd()-.5)*48,width:56,height:56};
  const n=1+Math.floor(rnd()*9),targets:NOW.EdgeTarget[]=[];
  for(let i=0;i<n;i++){
    const kind=KINDS[Math.floor(rnd()*KINDS.length)],a=rnd()*Math.PI*2,r=(rnd()<.15?150:500)+rnd()*500;
    const t:NOW.EdgeTarget={key:`${kind}${i}`,kind,screen:{x:vw/2+Math.cos(a)*r,y:vh/2+Math.sin(a)*r},distance:3+rnd()*80};
    if(kind==='caido'){
      t.seconds=Math.floor(rnd()*31);
      if(rnd()<.3)t.ping=true;
      if(rnd()<.7)t.label=NAMES[Math.floor(rnd()*NAMES.length)];
      if(rnd()<.2)t.danger=true;
    }
    if(kind==='chefe'&&rnd()<.4)t.danger=true;
    targets.push(t);
  }
  const covered:Rect[]=rnd()<.5?[{x:8,y:portrait?120:318,width:portrait?54:328,height:portrait?380:64}]:[];
  const windows:Rect[]=rnd()<.25?[portrait?{x:70,y:300,width:300,height:260}:{x:200,y:60,width:420,height:260}]:[];
  const options:NOW.EdgeOptions={seen:{viewport:{x:0,y:0,width:vw,height:vh},covered:[...covered,...windows]},windows,half:NOW.arrowHalf(scale)};
  return {viewport:{x:0,y:0,width:vw,height:vh},area,hero,targets,options};
}
const fichaOf=(a:{x:number;y:number},half:{w:number;h:number}):Rect=>({x:a.x-half.w,y:a.y-half.h,width:2*half.w,height:2*half.h});
/** The hero's keep-out an arrow's ficha must stay out of: ± HERO_MARGIN. */
const intoHero=(arrows:readonly NOW.EdgeArrow[],hero:Rect,half:{w:number;h:number})=>arrows.filter(a=>crosses(fichaOf(a,half),hero,HERO_MARGIN));
/** Main's slip: a ficha inside ± HERO_MARGIN, or inside the HEAD_ROOM band beside the hero on the top or bottom rim. */
function mainSlipped(arrows:readonly NOW.EdgeArrow[],hero:Rect,half:{w:number;h:number}){
  const side=Math.max(NOW.HEAD_ROOM,HERO_MARGIN),head={x:hero.x-side,y:hero.y-HERO_MARGIN,width:hero.width+2*side,height:hero.height+2*HERO_MARGIN};
  return arrows.some(a=>crosses(fichaOf(a,half),hero,HERO_MARGIN)||(a.side==='top'||a.side==='bottom')&&crosses(fichaOf(a,half),head));
}

const SCENES=4000;
test(`island golden: ${SCENES} seeded scenes lay out as main's edges.ts, but where main slipped a ficha into the hero's keep-out`,()=>{
  const rnd=mulberry(20261012);
  let same=0,improved=0;const slips:string[]=[];
  for(let i=0;i<SCENES;i++){
    const s=scene(rnd),half=s.options.half!;
    const now=NOW.layoutEdges(s.targets,s.area,s.hero,s.options),main=MAIN.layoutEdges(s.targets as MAIN.EdgeTarget[],s.area,s.hero,s.options as MAIN.EdgeOptions);
    for(const a of now)assert.equal(a.slideBeak,undefined,`scene ${i}: the island's beak stays centred`);
    const into=intoHero(now,s.hero,half);
    if(into.length)slips.push(`scene ${i}: ${into.map(a=>`${a.key}@${a.x.toFixed(1)},${a.y.toFixed(1)}`)} into the hero ${JSON.stringify(s.hero)}`);
    if(JSON.stringify(now)===JSON.stringify(main)){same++;continue;}
    assert.ok(mainSlipped(main,s.hero,half),`scene ${i} differs from main although main kept the hero clear:\n${JSON.stringify(s)}\nmain ${JSON.stringify(main.map(a=>[a.key,a.x,a.y,a.count]))}\nnow  ${JSON.stringify(now.map(a=>[a.key,a.x,a.y,a.count]))}`);
    improved++;
  }
  assert.deepEqual(slips,[],'no island arrow inside the hero keep-out');
  // The improvement is rare: a caído on the right half, its tag hung from the right end, level with the hero.
  assert.ok(improved<=SCENES*.03,`${improved} scenes differ from main (expected only the rare keep-out slips)`);
  assert.ok(same>=SCENES*.97,`${same} identical`);
});

test('island golden: main itself slipped into the keep-out in some of these scenes (what the one change fixes)',()=>{
  const rnd=mulberry(20261012);let mainInto=0;
  for(let i=0;i<SCENES;i++){
    const s=scene(rnd),half=s.options.half!;
    mainInto+=+!!intoHero(MAIN.layoutEdges(s.targets as MAIN.EdgeTarget[],s.area,s.hero,s.options as MAIN.EdgeOptions),s.hero,half).length;
  }
  assert.ok(mainInto>0,'the generator reaches the slip, so the golden test above checks the fix');
});

test('island golden: the island beak keeps main\'s transform (centred on its direction); the city\'s slides along the edge',()=>{
  const half=NOW.arrowHalf(1);
  for(const angle of [-3,-2.2,-1.57,-.9,-.3,0,.4,1.2,1.57,2.5,3.1]){
    const main=`rotate(${angle.toFixed(2)}rad) translateX(${Math.round(MAIN.beakRadius(angle,half))}px)`;
    assert.equal(NOW.beakTransform({angle,kind:'caido',tagEnd:'left'},half,'9 s'),main,`angle ${angle}`);
    assert.match(NOW.beakTransform({angle,kind:'grupo',tagEnd:'right',slideBeak:true},half,'34 m'),/^translate\(-?\d+px,-?\d+px\) rotate/);
  }
});

test('city rim: over seeded scenes no ficha enters the hero keep-out and every beak tip stays BEAK_GAP inside the viewport',()=>{
  const rnd=mulberry(4);
  const kinds=['caido','chefe','grupo','spawn','base'] as const;
  for(let i=0;i<1500;i++){
    const s=scene(rnd),half=s.options.half!;
    const targets=s.targets.map((t,k)=>{const kind=kinds[k%kinds.length];
      return {...t,kind,key:kind==='grupo'?`grupo:${k}`:kind==='spawn'?`boca:${'NSLO'[k%4]}`:t.key,...(kind==='grupo'?{label:'12',groupCount:12}:{}),
        ...(kind==='base'&&rnd()<.5?{seconds:Math.floor(rnd()*10),danger:true}:{})};});
    const arrows=layoutCityEdges(targets,s.area,s.hero,{seen:s.options.seen,textScale:half.w>38?1.25:1});
    assert.deepEqual(intoHero(arrows,s.hero,half).map(a=>a.key),[],`scene ${i}: into the hero ${JSON.stringify(s.hero)}`);
    for(const a of arrows){
      assert.equal(a.slideBeak,true);
      const more=a.count>1?`+${a.count-1}`:'',tag=NOW.edgeTag(a),text=tag&&more?`${tag} ${more}`:tag;
      const b=NOW.beakSpot(a.angle,half,text?{end:a.tagEnd,width:NOW.tagWidth(text,Math.max(1,(2*half.w-44)/32)),flush:a.kind!=='caido'}:undefined);
      const reach=b.r+NOW.BEAK_REACH,tx=a.x+b.ox+Math.cos(a.angle)*reach,ty=a.y+b.oy+Math.sin(a.angle)*reach,v=s.viewport,g=NOW.BEAK_GAP-1e-6;
      assert.ok(tx>=v.x+g&&tx<=v.x+v.width-g&&ty>=v.y+g&&ty<=v.y+v.height-g,`scene ${i} ${a.key}: beak tip ${tx.toFixed(1)},${ty.toFixed(1)} off ${JSON.stringify(v)}`);
    }
  }
});

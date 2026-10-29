// The enemies' matches (card nome-inimigo-rede-social, hud/perfis.ts, the user's option D): only a kill of the LOCAL
// hero counts, MATCH_CHANCE of them, never the same kind twice, at most MATCH_CAP; the distance at the kill as "a 12 m" /
// "a 1,2 km"; the compact card never over the hero, the Uno, the allies or the mission band; the texts' limits and one
// photo per profile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GUARD_MARGIN_PX,MATCH_CAP,MATCH_CHANCE,METROS_POR_UNIDADE,MatchBook,SMALL_SCALE,TILT_DEG,distanciaTexto,perfilOf,placeProfiles} from '../../src/client/hud/perfis.ts';
import {PERFIS_TEXTO} from '../../src/client/hud/perfis-texto.ts';
import {ROSTER} from '../../src/rules/index.ts';
import {ENEMY_ART_IDS} from '../../src/rules/enemy-art-ids.ts';

test('lotes 1–4: every kind with art has a profile with its photo; the texts fit the card',()=>{
  const ids=Object.keys(PERFIS_TEXTO);
  assert.equal(ids.length,159);
  // The saci (card saci-elite-no-jogo) is in the game before his ChatGPT portrait: no card until then
  // (card NEW-20261029-E4-perfil-saci).
  const pending=['aberracao-saci'];
  const due=ROSTER.filter(e=>ENEMY_ART_IDS.includes(e.id)&&!pending.includes(e.id)).map(e=>e.id);
  assert.deepEqual(due.filter(id=>!ids.includes(id)),[],'a kind with art and no profile');
  for(const id of ids){
    const p=perfilOf(id);
    assert.ok(p,`${id} is in the roster`);
    assert.equal(p.name,ROSTER.find(e=>e.id===id)?.name);
    assert.ok(existsSync(fileURLToPath(new URL(`../../public${p.foto}`,import.meta.url))),`${id}: photo`);
    assert.ok(p.bio.length<=66,`${id}: bio ${p.bio.length}`);
    assert.ok(p.recado.length<=28,`${id}: recado ${p.recado.length}`);
    assert.ok(p.idade.length>0&&p.idade.length<=24,`${id}: idade`);
  }
  for(const b of ['curtir','passar'])assert.ok(existsSync(fileURLToPath(new URL(`../../public/art/perfis/botao-${b}.webp`,import.meta.url))));
  assert.equal(perfilOf('pernilongo-vampiro'),undefined,'a kind still without art has no card yet');
});

test('the numbers the user asked for: 1 in 6 kills, 12 per match, ±4°, 1 world unit = 1 m',()=>{
  assert.equal(MATCH_CHANCE,1/6);
  assert.equal(MATCH_CAP,12);
  assert.equal(TILT_DEG,4);
  assert.equal(METROS_POR_UNIDADE,1);
});

test('distance: whole metres under a kilometre, kilometres with one decimal and a comma from there',()=>{
  assert.equal(distanciaTexto(0),'a 0 m');
  assert.equal(distanciaTexto(12.4),'a 12 m');
  assert.equal(distanciaTexto(12.5),'a 13 m');
  assert.equal(distanciaTexto(999.4),'a 999 m');
  assert.equal(distanciaTexto(999.6),'a 1,0 km','rounds to 1000 m: kilometres');
  assert.equal(distanciaTexto(1240),'a 1,2 km');
  assert.equal(distanciaTexto(12_345),'a 12,3 km');
  assert.equal(distanciaTexto(-3),'a 0 m');
});

const kill=(kind:string,by:string|undefined,x=3,y=4)=>({kind,by,x,y});
/** Dice that give these values in turn. */
const dice=(...values:number[])=>{let i=0;return ()=>values[i++%values.length];};

test('a match is a kill of the LOCAL hero, of a kind with a profile, when the dice say so',()=>{
  const yes=new MatchBook(undefined,dice(0,.5));
  assert.equal(yes.kill(kill('tio-pave','p2'),'p1',{x:0,y:0}),undefined,'an ally\'s kill');
  assert.equal(yes.kill(kill('tio-pave',undefined),'p1',{x:0,y:0}),undefined,'nobody\'s (a tower, the car)');
  assert.equal(yes.kill(kill('pernilongo-vampiro','p1'),'p1',{x:0,y:0}),undefined,'no profile');
  assert.equal(yes.kill(kill('tio-pave','p1'),'',{x:0,y:0}),undefined,'no local hero');
  const m=yes.kill(kill('tio-pave','p1'),'p1',{x:0,y:0});
  assert.deepEqual(m,{kind:'tio-pave',distance:5,tilt:0},'5 m away (3-4-5), the lean from the second die (.5 → 0°)');
  assert.equal(yes.matches.length,1);
  // The dice: MATCH_CHANCE is the edge.
  const no=new MatchBook(undefined,()=>MATCH_CHANCE);
  assert.equal(no.kill(kill('tio-pave','p1'),'p1'),undefined,'a die at MATCH_CHANCE is a no');
  const edge=new MatchBook(undefined,dice(MATCH_CHANCE-1e-9,.9999));
  assert.equal(edge.kill(kill('tio-pave','p1'),'p1')?.tilt,TILT_DEG,'just under is a yes; the lean at its edge');
});

test('rarely: about 1 in 6 of the hero\'s kills over many, never the same kind twice, at most MATCH_CAP',()=>{
  // A seeded dice (LCG) over 600 eligible kills of new kinds: the share is near 1/6.
  let s=7;const rng=()=>((s=(s*1103515245+12345)%2147483648)/2147483648);
  const kinds=Object.keys(PERFIS_TEXTO);
  let made=0;
  for(let run=0;run<60;run++){
    const book=new MatchBook(undefined,rng);
    for(let i=0;i<10;i++)if(book.kill(kill(kinds[(run*10+i)%kinds.length],'p1'),'p1'))made++;
  }
  assert.ok(made>=70&&made<=130,`${made} of 600 (1/6 = 100)`);
  // Always yes: the same kind once, then the cap.
  const book=new MatchBook(undefined,()=>0);
  assert.ok(book.kill(kill('bebado','p1'),'p1'));
  assert.equal(book.kill(kill('bebado','p1'),'p1'),undefined,'the same profile never again');
  for(const kind of kinds.slice(0,40))book.kill(kill(kind,'p1'),'p1');
  assert.equal(book.matches.length,MATCH_CAP);
  assert.equal(new Set(book.matches.map(m=>m.kind)).size,MATCH_CAP,'all different');
  for(const m of book.matches)assert.ok(Math.abs(m.tilt)<=TILT_DEG);
  book.reset();
  assert.equal(book.matches.length,0,'a new match starts with none');
  assert.ok(book.kill(kill('bebado','p1'),'p1'),'and the kind may match again in it');
});

// perfil-nao-cobre: the user's phone print had the card over the Uno, the hero and the mission band.
test('the card never covers the hero, the Uno, the allies or the mission band: another corner, then smaller, then none',()=>{
  const cross=(a:{x:number;y:number;width:number;height:number},b:typeof a,m:number)=>a.x<b.x+b.width+m&&b.x-m<a.x+a.width&&a.y<b.y+b.height+m&&b.y-m<a.y+a.height;
  const boxOf=(home:{x:number;y:number;width:number;height:number},p:{dx:number;dy:number;scale:number})=>({x:home.x+p.dx,y:home.y+p.dy,width:home.width*p.scale,height:home.height*p.scale});
  // 390×844 as in the print: the card under the flame on the right; the useful area between the band and the thumbs.
  const home={x:210,y:140,width:172,height:226},useful={x:0,y:120,width:390,height:560};
  const band={x:40,y:240,width:310,height:50},uno={x:180,y:340,width:110,height:130},hero={x:170,y:410,width:44,height:60};
  assert.deepEqual(placeProfiles(home,useful,[]),{spot:'canto',dx:0,dy:0,scale:1},'nothing in the way: its usual place');
  const p=placeProfiles(home,useful,[hero,uno,band]);
  assert.ok(p,'a place');
  for(const g of [hero,uno,band])assert.ok(!cross(boxOf(home,p),g,GUARD_MARGIN_PX),`${p.spot} crosses ${JSON.stringify(g)}`);
  assert.equal(p.spot,'baixo','the band blocks both top corners: the bottom right, above the thumbs');
  assert.equal(placeProfiles(home,useful,[hero,uno,band],'baixo')?.spot,'baixo','it stays where it fits');
  // Every full-size corner is taken: the same corners at SMALL_SCALE.
  const wall=[{x:0,y:200,width:390,height:270}];
  const small=placeProfiles(home,useful,wall);
  assert.equal(small?.scale,SMALL_SCALE);
  for(const g of wall)assert.ok(!cross(boxOf(home,small!),g,GUARD_MARGIN_PX));
  assert.equal(placeProfiles(home,useful,[{x:0,y:0,width:390,height:844}]),undefined,'no room anywhere: no card');
});

// rostos-kkkk (client side): the room's {t:'emote'} relay is read strictly, a pure clock-injected board keeps who is
// laughing for 2.2 s, and the team strip shows the `rindo` face plus a laugh sticker on the ring (caído still wins).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BALLOON_MS,EMOTE_PLAYER_MAX,parseEmote} from '../../src/client/fun/emotes.ts';
import {MoodBoard} from '../../src/client/hud/moods.ts';
import {faceExpression} from '../../src/client/ui/face-crop.ts';

const src=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');

test('parseEmote: a well-formed relay passes; forged, oversized and unknown ones are ignored',()=>{
  assert.deepEqual(parseEmote({t:'emote',player:'a',id:'kkkk'}),{player:'a',id:'kkkk'});
  assert.deepEqual(parseEmote({t:'emote',player:'b',id:'foimal',round:3,extra:'<b>'}),{player:'b',id:'foimal'});
  assert.deepEqual(parseEmote({t:'emote',player:'x'.repeat(EMOTE_PLAYER_MAX),id:'vem',round:0}),{player:'x'.repeat(EMOTE_PLAYER_MAX),id:'vem'});
  for(const bad of [null,undefined,'kkkk',42,[],{},{t:'emote'},{t:'sos',player:'a',id:'kkkk'},
    {t:'emote',player:'',id:'kkkk'},{t:'emote',player:'x'.repeat(EMOTE_PLAYER_MAX+1),id:'kkkk'},{t:'emote',player:7,id:'kkkk'},
    {t:'emote',player:{toString:()=>'a'},id:'kkkk'},{t:'emote',player:'a',id:'KKKK'},{t:'emote',player:'a',id:'dance'},
    {t:'emote',player:'a',id:['kkkk']},{t:'emote',player:'a'},{t:'emote',player:'a',id:'kkkk',round:-1},
    {t:'emote',player:'a',id:'kkkk',round:1.5},{t:'emote',player:'a',id:'kkkk',round:'1'},{t:'emote',player:'a',id:'kkkk',round:NaN}])
    assert.equal(parseEmote(bad),null,JSON.stringify(bad));
});

test('the client handles {t:emote} like {t:sos}: parsed strictly, then onEmote; it sends {t:emote,round,id} (emote-relay-sala)',()=>{
  const client=src('src/client/net/client.ts');
  assert.match(client,/onEmote:\(e:EmoteNote\)=>void=\(\)=>\{\};/);
  assert.match(client,/else if\(m\.t==='emote'\)\{const note=parseEmote\(m\);if\(note\)this\.onEmote\(note\);\}/);
  assert.ok(client.includes("this.out(this.socket,{t:'emote',round:this.run.round,id});"),'the room relays it (emote-relay-sala)');
});

test('MoodBoard: shows from the send up to 2200 ms, latest wins, time injected',()=>{
  assert.equal(BALLOON_MS,2200);
  const board=new MoodBoard();
  assert.equal(board.active('a',0),undefined);
  board.record('a','kkkk',1000);
  assert.equal(board.active('a',999),undefined,'not before it was sent');
  assert.equal(board.active('a',1000),'kkkk');
  assert.equal(board.active('a',3199),'kkkk');
  assert.equal(board.active('a',3200),undefined,'gone at exactly 2200 ms');
  assert.equal(board.active('b',1500),undefined,'per player');
  board.record('a','kkkk',5000);board.record('a','foimal',6000);
  assert.equal(board.active('a',6100),'foimal','latest wins');
  board.record('a','kkkk',7000);
  assert.equal(board.active('a',9100),'kkkk','a new KKKK restarts the 2.2 s');
  assert.equal(board.active('a',9200),undefined);
  // Junk is ignored and never throws.
  board.record('','kkkk',1);board.record('c','nope' as never,1);board.record('c','kkkk',NaN);
  assert.equal(board.active('',1),undefined);assert.equal(board.active('c',1),undefined);assert.equal(board.active('a',NaN),undefined);
  board.clear();assert.equal(board.active('a',7000),undefined);
});

test('faceExpression with the board: KKKK is rindo, caído still wins, and it expires back to ferido/normal',()=>{
  const board=new MoodBoard();board.record('a','kkkk',0);
  const at=(now:number,extra:object={})=>faceExpression({hp:100,maxHp:100,emote:board.active('a',now),...extra});
  assert.equal(at(100),'rindo');
  assert.equal(at(100,{downed:true}),'caido');
  assert.equal(at(100,{eliminated:true}),'caido');
  assert.equal(at(100,{hp:10}),'rindo','the laugh beats ferido');
  assert.equal(at(BALLOON_MS,{hp:10}),'ferido');
  assert.equal(at(BALLOON_MS),'normal');
  board.record('a','vem',50);assert.equal(at(100),'normal','only KKKK laughs');
});

test('wiring: the HUD feeds the strip, the strip marks the ring and the CSS shows the laugh sticker',()=>{
  const team=src('src/client/hud/team.ts'),hud=src('src/client/hud/hud.ts'),explore=src('src/client/explore.ts'),css=src('src/client/hud/hud.css');
  assert.match(team,/emote:ctx\.mood\?\.\(player\.id\)/);
  assert.match(team,/put\(n,'mood',expression==='rindo'\?'rindo':'',v=>\{if\(v\)n\.ring\.dataset\.mood=v;else delete n\.ring\.dataset\.mood;\}\)/);
  assert.match(team,/el\('span','rh-member-mood',item\);mood\.innerHTML=icon\('risada'\)/);
  assert.match(hud,/mood:id=>this\.moods\.active\(id,performance\.now\(\)\)/);
  assert.match(hud,/emote\(playerId:string,id:EmoteId,now=performance\.now\(\)\)\{this\.moods\.record\(playerId,id,now\);\}/);
  assert.match(explore,/net\.onEmote=note=>hud\?\.emote\(note\.player,note\.id\);/);
  // Sticker out of the flow (ring keeps its size), one pop (no loop), still under reduced motion.
  assert.match(css,/\.rh-member-mood\{position:absolute;[^}]*display:none/);
  const show=css.match(/\.rh-member-ring\[data-mood=rindo\]~\.rh-member-mood\{([^}]*)\}/)?.[1]??'';
  assert.match(show,/display:flex/);assert.doesNotMatch(show,/infinite/);
  assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{\.rh-member-ring\[data-mood=rindo\]~\.rh-member-mood\{animation:none\}\}/);
  assert.doesNotMatch(css,/\.rh-member-ring\[data-mood[^{]*\{[^}]*(width|height|padding)/,'the ring size does not change');
});

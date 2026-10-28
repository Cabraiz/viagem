import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BACK_ONLINE_MIN_MS,BackOnlineWatch,MENU_TEXTS,SOLO_LINE,WAKE_WINDOW_MS,backOnline,menuBack,menuTitle,quietStatus,roomLine} from '../../src/client/hud/menu.ts';
import {LINK_LOST,reconnectBanner} from '../../src/client/net/client.ts';
import {needsUpdate} from '../../src/protocol/index.ts';

// NEW-20261009-UX-menu-e-conexao: the gear's menu in a room and the connection's words.

test('menu views: titles, Esc goes back to the menu and from the menu out',()=>{
  assert.equal(menuTitle('menu'),'Menu');
  assert.equal(menuTitle('settings'),'Configurações');
  assert.equal(menuTitle('confirm'),'Sair da partida?');
  assert.equal(menuBack('settings'),'menu');
  assert.equal(menuBack('confirm'),'menu');
  assert.equal(menuBack('menu'),undefined);
  assert.equal(MENU_TEXTS.confirm,'Seus amigos vão ficar com um a menos, certeza?');
});

test('"Voltou! O round tá no N": only in combat, only for a drop the player could notice',()=>{
  assert.equal(backOnline({downMs:5000,cameBack:false,phase:'combat',round:4}),'Voltou! O round tá no 4');
  assert.equal(backOnline({downMs:20000,cameBack:false,phase:'combat',round:2}),'Voltou! O round tá no 2');
  assert.equal(backOnline({downMs:BACK_ONLINE_MIN_MS-1,cameBack:false,phase:'combat',round:4}),undefined,'a blink says nothing');
  assert.equal(backOnline({downMs:200,cameBack:true,phase:'combat',round:3}),'Voltou! O round tá no 3','back from the app: any drop');
  assert.equal(backOnline({downMs:5000,cameBack:false,phase:'intermission',round:3}),undefined);
  assert.equal(backOnline({downMs:5000,cameBack:false,phase:'combat'}),'Voltou! O round tá no 1');
});

test('BackOnlineWatch: drops of 5 s and 20 s give one row each when the link is back',()=>{
  const w=new BackOnlineWatch(),run={phase:'combat',round:4};
  for(const drop of [5000,20000]){
    assert.equal(w.frame(true,0,run),undefined);
    assert.equal(w.frame(false,1000,run),undefined);
    assert.equal(w.frame(false,1000+drop/2,run),undefined);
    assert.equal(w.frame(true,1000+drop,run),'Voltou! O round tá no 4');
    assert.equal(w.frame(true,1100+drop,run),undefined,'once');
  }
  // Back from the background: the stale socket drops right after the first visible frames and comes back fast.
  w.wake(50_000);
  assert.equal(w.frame(true,50_016,run),undefined);
  assert.equal(w.frame(false,50_400,run),undefined);
  assert.equal(w.frame(true,50_900,run),'Voltou! O round tá no 4');
  // A wake long before the drop does not count.
  w.wake(60_000);
  assert.equal(w.frame(false,60_000+WAKE_WINDOW_MS+1,run),undefined);
  assert.equal(w.frame(true,60_000+WAKE_WINDOW_MS+500,run),undefined);
});

test('the banner covers the drop and the terminal drop is not a "new version" message',()=>{
  const net=(connected:boolean,offline:number,fatal?:string)=>({connected,fatal,offlineMs:()=>offline});
  assert.equal(reconnectBanner(net(false,5000)),true);
  assert.equal(reconnectBanner(net(false,20000)),true);
  assert.equal(reconnectBanner(net(false,20000,LINK_LOST)),false);
  assert.equal(needsUpdate(LINK_LOST),false,'"Voltar pra sala", not the version panel');
  assert.match(LINK_LOST,/Voltar pra sala/);
});

test('explore.ts: in a room the gear opens the menu and leaving asks first',()=>{
  const src=readFileSync('src/client/explore.ts','utf8');
  assert.match(src,/createGameMenu\(settings,/);
  assert.match(src,/onLeave:\(\)=>close\(\)/,'the confirmed exit leaves the room (close → net.leave once)');
  assert.match(src,/\$\('\.explore-exit'\)\.hidden=true/,'no exit without the question in a room');
  assert.match(src,/menu\?\.show\('menu'\);settings\.showModal\(\)/,'the gear always opens on the menu');
  assert.match(src,/net\.fatal===LINK_LOST\?\{action:\{label:BACK_TO_ROOM/);
});

test('the menu head says "Partida solo" or how many people are in, never the raw room id (auditoria-ui-menus 15)',()=>{
  const me={id:'a',online:true};
  assert.equal(roomLine([me],'a'),SOLO_LINE);
  assert.equal(roomLine([me,{id:'b1',online:true,bot:true},{id:'b2',online:true,bot:true}],'a'),SOLO_LINE,'bots do not count');
  assert.equal(roomLine([me,{id:'b',online:false}],'a'),SOLO_LINE,'a friend who left does not count');
  assert.equal(roomLine([me,{id:'b',online:true},{id:'c',online:true},{id:'x',online:true,bot:true}],'a'),'3 jogadores na sala');
  assert.equal(roomLine(undefined,'a'),SOLO_LINE);
  assert.ok(quietStatus('Conectado. Cabe até seis na sala.',true));
  assert.ok(!quietStatus('Conectado. Cabe até seis na sala.',false));
  assert.ok(!quietStatus('Conexão caiu. Tentando voltar à mesma sala…',true));
});

// auditoria-ui-menus 4: in landscape the settings are two columns, the sound panel (Vibrar) beside the quality.
test('landscape settings: two columns, the sound panel in the first screen',()=>{
  const css=readFileSync(new URL('../../src/client/explore.css',import.meta.url),'utf8');
  const block=css.slice(css.indexOf('@media (max-height:500px) and (min-width:600px){\n  .explore-settings:is('));
  assert.ok(block.length>0);
  assert.match(block,/\.explore-settings-content\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(block,/\.explore-settings-content>\.explore-sound\{grid-column:2;grid-row:1\/span 3\}/);
  assert.match(block,/:is\(:not\(\.game-menu-host\),\[data-view=settings\]\)\{width:min\(800px,calc\(100vw - 28px\)\)/,'the menu view keeps its width');
});

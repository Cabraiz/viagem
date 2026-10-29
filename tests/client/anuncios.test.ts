// anuncios-h5-games: the Ad Placement API wiring. Off = zero calls; blocked/failed/slow = the flow goes on; sound hushed
// only while an ad plays; one interstitial per minGapMs; only the solo rematch waits for an ad.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ADS_CONFIG,activeAds,type AdsConfig} from '../../src/client/ads/config.ts';
import {startAds} from '../../src/client/ui/ads-boot.ts';
import {Ads,FALLBACK_MS,MAX_AD_MS,SCRIPT_URL,adBreakThen,soloRoom,type AdBreakPlacement,type AdsDeps,type BreakOutcome} from '../../src/client/ads/ads.ts';

const ON:AdsConfig={enabled:true,client:'ca-pub-1234567890123456',test:true,minGapMs:180_000,hosts:['viagem.cyou']};
const SITE={dev:false,search:'',host:'viagem.cyou'};

function rig(config:AdsConfig=ON){
  let t=0,nextId=0;
  const timers=new Map<number,{at:number;fn:()=>void}>();
  const pushes:unknown[]=[],scripts:{src:string;attrs:Record<string,string>;onError:()=>void}[]=[],hush:boolean[]=[];
  const deps:AdsDeps={config,
    push:call=>{pushes.push(call);},
    loadScript:(src,attrs,onError)=>{scripts.push({src,attrs,onError});},
    hush:on=>{hush.push(on);},
    now:()=>t,
    setTimer:(fn,ms)=>{const id=++nextId;timers.set(id,{at:t+ms,fn});return id;},
    clearTimer:id=>{timers.delete(id as number);},
  };
  const advance=(ms:number)=>{
    t+=ms;
    for(const [id,timer] of [...timers].sort((a,b)=>a[1].at-b[1].at))if(timer.at<=t){timers.delete(id);timer.fn();}
  };
  const breaks=()=>pushes.filter((p):p is AdBreakPlacement=>(p as AdBreakPlacement).type==='next');
  return {ads:new Ads(deps),pushes,scripts,hush,advance,breaks,timers};
}

test('the shipped config: the ca-pub the user gave in test mode, on viagem.cyou only; dev, tests and other hosts stay off', () => {
  assert.equal(ADS_CONFIG.enabled,true);
  assert.equal(ADS_CONFIG.client,'ca-pub-3277268601080257');
  assert.equal(ADS_CONFIG.test,true,'test ads until the site is approved');
  assert.deepEqual(activeAds(SITE),ADS_CONFIG);
  assert.equal(activeAds({...SITE,host:'www.viagem.cyou'})?.client,'ca-pub-3277268601080257');
  for(const host of ['127.0.0.1','localhost','cabraiz.github.io','viagem.cyou.evil.com'])
    assert.equal(activeAds({...SITE,host}),undefined,`${host}: off (vite preview, the lote's smoke, mirrors)`);
  assert.equal(activeAds({...SITE,dev:true}),undefined,'dev server on the site host: off');
  assert.equal(activeAds({dev:true,search:'',host:'viagem.cyou'},ON),undefined,'dev server: off even with a real config');
  assert.equal(activeAds(SITE,{...ON,client:'pub-123'}),undefined,'malformed ID: off');
  assert.equal(activeAds(SITE,{...ON,client:''}),undefined,'no ID: off');
  assert.equal(activeAds(SITE,{...ON,enabled:false}),undefined);
  assert.deepEqual(activeAds(SITE,ON),ON);
  assert.equal(activeAds({dev:true,search:'?anuncios=teste',host:'127.0.0.1'})?.test,true,'?anuncios=teste forces test mode anywhere');
  assert.equal(activeAds({...SITE,search:'?anuncios=teste'},{...ON,test:false})?.test,true);
});

test('ads.txt: the publisher line at the root of the site (public/ → dist/), matching the config', () => {
  const txt=fs.readFileSync(new URL('../../public/ads.txt',import.meta.url),'utf8');
  assert.equal(txt,'google.com, pub-3277268601080257, DIRECT, f08c47fec0942fa0\n');
  assert.equal(`ca-${txt.split(', ')[1]}`,ADS_CONFIG.client);
});

test('privacy policy: /privacidade/ in PT-BR with an English section covers Google ads cookies, LGPD, GDPR and a contact; the menu links it', () => {
  const html=fs.readFileSync(new URL('../../public/privacidade/index.html',import.meta.url),'utf8');
  // politica-privacidade: the URL given to AdSense's consent message is /privacidade.html; GitHub Pages has no redirects.
  assert.equal(fs.readFileSync(new URL('../../public/privacidade.html',import.meta.url),'utf8'),html,'/privacidade.html is the same page');
  for(const must of ['GDPR','id="english" lang="en"','sessionStorage'])assert.ok(html.includes(must),must);
  assert.match(html,/<html lang="pt-BR">/);
  assert.match(html,/<title>viagem · Política de Privacidade<\/title>/);
  assert.doesNotMatch(html,/noindex/,'AdSense and search engines must read it');
  for(const must of ['https://policies.google.com/technologies/partner-sites','https://adssettings.google.com/','LGPD','localStorage','ANPD','https://github.com/Cabraiz/viagem/issues'])
    assert.ok(html.includes(must),must);
  assert.doesNotMatch(html,/<script/,'a static page: no code, no tracker');
  assert.doesNotMatch(html,/@[a-z0-9-]+\.[a-z]/i,'no e-mail address without a yes from the user');
  const menu=fs.readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
  assert.match(menu,/<a class="menu-privacidade" href="\/privacidade\/">Privacidade<\/a>/);
  assert.match(fs.readFileSync(new URL('../../public/sitemap.xml',import.meta.url),'utf8'),/<loc>https:\/\/viagem\.cyou\/privacidade\/<\/loc>/);
});

test('on the site: startAds waits for the load event before scheduling anything', () => {
  const events:string[]=[];
  const win={location:{search:'',hostname:'viagem.cyou'},document:{readyState:'loading'},addEventListener:(type:string)=>{events.push(type);},setTimeout:()=>{throw new Error('no timer before load');}};
  assert.equal(startAds(win as unknown as Window,false),true);
  assert.deepEqual(events,['load']);
});

test('off: startAds schedules nothing and adBreakThen runs the action at once', () => {
  let listened=0;
  const win={location:{search:'',hostname:'127.0.0.1'},document:{readyState:'complete'},addEventListener:()=>{listened++;},setTimeout:()=>{throw new Error('no timer');}};
  assert.equal(startAds(win as unknown as Window,false),false);
  assert.equal(listened,0);
  let ran=0;adBreakThen('sair',()=>{ran++;});
  assert.equal(ran,1);
});

test('boot: async script with test mode and frequency hint, then adConfig with preload and sound', () => {
  const r=rig();r.ads.boot();
  assert.equal(r.scripts.length,1);
  assert.equal(r.scripts[0].src,`${SCRIPT_URL}?client=ca-pub-1234567890123456`);
  assert.equal(r.scripts[0].attrs['data-adbreak-test'],'on');
  assert.equal(r.scripts[0].attrs['data-ad-frequency-hint'],'180s');
  assert.deepEqual(r.pushes,[{preloadAdBreaks:'on',sound:'on'}]);
  const live=rig({...ON,test:false});live.ads.boot();
  assert.equal(live.scripts[0].attrs['data-adbreak-test'],undefined,'live mode drops the test flag');
});

test('an ad shown: hush between beforeAd and afterAd, next runs once after adBreakDone', () => {
  const r=rig();r.ads.boot();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  const [placement]=r.breaks();
  assert.equal(placement.name,'sair');
  placement.beforeAd!();
  assert.deepEqual(r.hush,[true]);
  r.advance(FALLBACK_MS*3);
  assert.deepEqual(out,[],'a playing ad is not cut by the short fallback');
  placement.afterAd!();
  assert.deepEqual(r.hush,[true,false]);
  placement.adBreakDone!({breakStatus:'viewed'});
  placement.adBreakDone!({breakStatus:'viewed'});
  assert.deepEqual(out,['shown']);
  assert.deepEqual(r.hush,[true,false],'sound restored once');
});

test('no ad to show (frequency, not ready): adBreakDone without beforeAd goes on, no hush', () => {
  const r=rig();r.ads.boot();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  r.breaks()[0].adBreakDone!({breakStatus:'frequencyCapped'});
  assert.deepEqual(out,['none']);
  assert.deepEqual(r.hush,[]);
});

test('adblock: the script error makes later breaks run at once with no push', () => {
  const r=rig();r.ads.boot();
  r.scripts[0].onError();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  assert.deepEqual(out,['blocked']);
  assert.equal(r.breaks().length,0);
});

test('silent API (blocked without an error event, slow network): the flow goes on after FALLBACK_MS', () => {
  const r=rig();r.ads.boot();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  r.advance(FALLBACK_MS-1);assert.deepEqual(out,[]);
  r.advance(1);assert.deepEqual(out,['timeout']);
  r.breaks()[0].adBreakDone!({});
  assert.deepEqual(out,['timeout'],'a late callback does not run the action twice');
});

test('an ad that never ends frees the game after MAX_AD_MS and restores the sound', () => {
  const r=rig();r.ads.boot();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  r.breaks()[0].beforeAd!();
  r.advance(MAX_AD_MS);
  assert.deepEqual(out,['timeout']);
  assert.deepEqual(r.hush,[true,false]);
});

test('a push that throws goes on at once', () => {
  const r=rig();
  const ads=new Ads({...(r.ads as unknown as {deps:AdsDeps}).deps,push:()=>{throw new Error('broken');}});
  const out:BreakOutcome[]=[];
  ads.interstitial('sair',o=>out.push(o));
  assert.deepEqual(out,['blocked']);
});

test('one interstitial per minGapMs: the next exit within 3 min goes straight on', () => {
  const r=rig();r.ads.boot();
  const out:BreakOutcome[]=[];
  r.ads.interstitial('sair',o=>out.push(o));
  const first=r.breaks()[0];first.beforeAd!();first.afterAd!();first.adBreakDone!({breakStatus:'viewed'});
  r.advance(ON.minGapMs-1);
  r.ads.interstitial('revanche',o=>out.push(o));
  assert.deepEqual(out,['shown','throttled']);
  assert.equal(r.breaks().length,1);
  r.advance(1);
  r.ads.interstitial('revanche',o=>out.push(o));
  assert.equal(r.breaks().length,2);
});

test('soloRoom: bots and offline players do not hold the rematch; another human does', () => {
  assert.equal(soloRoom(undefined,'me'),true);
  assert.equal(soloRoom([{id:'me'},{id:'b1',bot:true},{id:'x',online:false}],'me'),true);
  assert.equal(soloRoom([{id:'me'},{id:'friend',online:true}],'me'),false);
});

test('wiring: only the result exit and the solo rematch call an ad break; nothing in the match loop', () => {
  const explore=fs.readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  const calls=explore.match(/adBreakThen\(/g)??[];
  assert.equal(calls.length,2);
  assert.match(explore,/onExit:\(\)=>adBreakThen\('sair'/);
  assert.match(explore,/soloRoom\(net\.run\?\.members,net\.id\)\)adBreakThen\('revanche'/);
  const src=fs.readdirSync(new URL('../../src/',import.meta.url),{recursive:true}) as string[];
  const users=src.filter(f=>/\.ts$/.test(f)&&!/ads[\\/]/.test(f)).filter(f=>/adsbygoogle|adBreak/.test(fs.readFileSync(new URL(`../../src/${f.replace(/\\/g,'/')}`,import.meta.url),'utf8')));
  assert.deepEqual(users.map(f=>f.replace(/\\/g,'/')).sort(),['client/explore.ts']);
});

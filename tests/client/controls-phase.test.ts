// BUG-20261006-ORQ-lobby-dead-controls: the thumb controls by run phase (src/client/controls-phase.ts) and their wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controlsFor,applyControls,controlsHintLines,CONTROLS_HINTS,CONTROLS_HINTS_MOUSE,STICK_HTML,SKILL_HTML,CONTROLS_HINT_HTML,type Controls} from '../../src/client/controls-phase.ts';
import type {RunPhase} from '../../src/contract/index.ts';
import {INPUT_TEXTS} from '../../src/client/desktop-input.ts';

const read=(path:string)=>readFileSync(new URL(`../../${path}`,import.meta.url),'utf8');
const FLAGS=[{},{spectator:true},{eliminated:true},{downed:true},{offline:true},{spectator:true,eliminated:true,downed:true,offline:true}];

test('controlsFor: waiting room and countdown show no thumb control, only the phase etiqueta',()=>{
  for(const phase of ['lobby','countdown'] as const)for(const flags of FLAGS)
    assert.deepEqual(controlsFor({phase,...flags}),{stick:'off',skill:'off',hint:phase},`${phase} ${JSON.stringify(flags)}`);
});
test('controlsFor: the result screen has no thumb control and no etiqueta',()=>{
  for(const flags of FLAGS)assert.deepEqual(controlsFor({phase:'result',...flags}),{stick:'off',skill:'off'});
});
test('controlsFor: the round keeps the old rules (out or watching dims the stick; out, downed or offline greys the skill)',()=>{
  // The pre-fix expressions of explore.ts, kept here as the oracle: combat must not change.
  const oldOut=(f:{spectator?:boolean;eliminated?:boolean})=>!!f.eliminated||!!f.spectator;
  const oldDisabled=(f:{spectator?:boolean;eliminated?:boolean;downed?:boolean;offline?:boolean})=>!!f.spectator||!!f.eliminated||!!f.downed||!!f.offline;
  for(const spectator of [false,true])for(const eliminated of [false,true])for(const downed of [false,true])for(const offline of [false,true]){
    const flags={spectator,eliminated,downed,offline},c=controlsFor({phase:'combat',...flags});
    assert.equal(c.stick,oldOut(flags)?'dimmed':'live',JSON.stringify(flags));
    assert.equal(c.skill,oldDisabled(flags)?'disabled':'live',JSON.stringify(flags));
    assert.equal(c.hint,undefined);
  }
});
test('controlsFor: the skill button answers only in the round (the old disabled rule outside it)',()=>{
  for(const phase of ['lobby','countdown','combat','result'] as RunPhase[])
    assert.equal(controlsFor({phase}).skill==='live',phase==='combat',phase);
});

/** The desktop variant may name its keys (controles-desktop): the only uppercase words any etiqueta may hold. */
const KEY_NAMES=new Set(['WASD']);
test('etiqueta lines: pt-BR zueira, at most 2 short lines, the D-020 voice rules',()=>{
  assert.deepEqual(Object.keys(CONTROLS_HINTS).sort(),['countdown','lobby']);
  const all:[string,readonly string[],boolean][]=[...Object.entries(CONTROLS_HINTS).map(([p,l]):[string,readonly string[],boolean]=>[p,l,false]),
    ...Object.entries(CONTROLS_HINTS_MOUSE).map(([p,l]):[string,readonly string[],boolean]=>[`${p} (mouse)`,l,true])];
  for(const [phase,lines,keysAllowed] of all){
    assert.ok(lines.length>=1&&lines.length<=2,`${phase}: ${lines.length} lines`);
    for(const line of lines){
      // ~36 characters of 13 px text fit one row of the 280 px etiqueta at 390 px wide.
      assert.ok(line.length>0&&line.length<=36,`${phase}: "${line}" is ${line.length} characters`);
      assert.doesNotMatch(line,/\p{Extended_Pictographic}/u,`${phase}: emoji in "${line}"`);
      assert.doesNotMatch(line,/[·→]|->/,`${phase}: "A · B" or arrow in "${line}"`);
      for(const word of line.match(/\b\p{Lu}{2,}\b/gu)??[])assert.ok(keysAllowed&&KEY_NAMES.has(word),`${phase}: uppercase word "${word}" in "${line}"`);
      assert.match(line,/^\p{Lu}/u,`${phase}: "${line}" starts as a sentence`);
      assert.match(line,/[.!?]$/,`${phase}: "${line}" ends as a sentence`);
    }
  }
  // The waiting room explains the round's two thumbs (walk; the weapons fire by themselves); the countdown is a nudge.
  assert.match(CONTROLS_HINTS.lobby.join(' '),/arrasta/i);assert.ok(CONTROLS_HINTS.lobby.includes('A arma atira sozinha.'),'the glossary line');
  // Same words as the room notice (explore.ts); the coach writes no walk row in combat (one written walk hint: this
  // label, BUG-dica-tutorial-duplicada), it only lights the joystick.
  // The room notice's words per input kind live in desktop-input.ts (controles-desktop); explore.ts writes them.
  for(const kind of ['touch','mouse'] as const)assert.match(INPUT_TEXTS[kind].coopNotice,/A arma atira sozinha/);
  assert.match(read('src/client/explore.ts'),/INPUT_TEXTS\.touch\.coopNotice/);
  assert.doesNotMatch(read('src/client/hud/coach.ts').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm,''),/atira sozinha|pra andar/,'no coach copy repeats the label');
  assert.equal(CONTROLS_HINTS.countdown.length,1);
});
test('etiqueta lines on the desktop: keys and a click walk, the same glossary line, the countdown nudges the mouse',()=>{
  assert.deepEqual(controlsHintLines('lobby','mouse'),['WASD, setas ou clique pra andar.','A arma atira sozinha.']);
  assert.deepEqual(controlsHintLines('lobby','touch'),CONTROLS_HINTS.lobby);assert.deepEqual(controlsHintLines('lobby'),CONTROLS_HINTS.lobby);
  assert.deepEqual(Object.keys(CONTROLS_HINTS_MOUSE).sort(),Object.keys(CONTROLS_HINTS).sort(),'every phase has its desktop words');
  assert.deepEqual(controlsHintLines('countdown','mouse'),['Aquece o mouse!']);
  assert.deepEqual(controlsHintLines('countdown','touch'),['Prepara o dedão!']);assert.deepEqual(controlsHintLines('countdown'),['Prepara o dedão!']);
  for(const lines of Object.values(CONTROLS_HINTS_MOUSE))assert.doesNotMatch(lines.join(' '),/arrasta|dedão|joystick/i);
  // The phone's own lines never name a key.
  for(const lines of Object.values(CONTROLS_HINTS))for(const line of lines)assert.doesNotMatch(line,/WASD|setas|clique/);
});

/** A tiny DOM stand-in: a root with a dataset and the etiqueta. */
function fakeShell(){
  const hint={dataset:{} as Record<string,string>,hidden:true,rows:[] as string[],
    ownerDocument:{createElement:()=>({textContent:''})},
    replaceChildren(...rows:{textContent:string}[]){this.rows=rows.map(r=>r.textContent);}};
  const root={dataset:{} as Record<string,string>,querySelector:(s:string)=>s==='.explore-stick-hint'?hint:null};
  return {root:root as unknown as HTMLElement,hint};
}
test('applyControls: data-controls off with the etiqueta lines; back to live hides it; true only when it just went off',()=>{
  const {root,hint}=fakeShell();
  const apply=(c:Controls)=>applyControls(root,c);
  assert.equal(apply(controlsFor({phase:'lobby'})),true);
  assert.equal(root.dataset.controls,'off');assert.equal(hint.hidden,false);assert.deepEqual(hint.rows,[...CONTROLS_HINTS.lobby]);
  assert.equal(apply(controlsFor({phase:'lobby'})),false,'already off');
  assert.equal(apply(controlsFor({phase:'countdown'})),false);assert.deepEqual(hint.rows,[...CONTROLS_HINTS.countdown]);
  assert.equal(apply(controlsFor({phase:'combat'})),false);
  assert.equal(root.dataset.controls,'live');assert.equal(hint.hidden,true);
  assert.equal(apply(controlsFor({phase:'combat',eliminated:true})),false);assert.equal(root.dataset.controls,'live','out is dimmed (data-out), not hidden');
  assert.equal(apply(controlsFor({phase:'result'})),true);assert.equal(root.dataset.controls,'off');assert.equal(hint.hidden,true);
});
test('applyControls: the root\'s data-input picks the etiqueta\'s words, and a switch rewrites them',()=>{
  const {root,hint}=fakeShell();
  root.dataset.input='mouse';applyControls(root,controlsFor({phase:'lobby'}));
  assert.deepEqual(hint.rows,[...CONTROLS_HINTS_MOUSE.lobby]);assert.equal(hint.hidden,false);
  root.dataset.input='touch';applyControls(root,controlsFor({phase:'lobby'}));
  assert.deepEqual(hint.rows,[...CONTROLS_HINTS.lobby]);
});

test('explore.ts: the stick and the skill come from the shared markup; the phase drives data-controls and the stick gate',()=>{
  const explore=read('src/client/explore.ts');
  assert.match(explore,/\$\{STICK_HTML\}\$\{CONTROLS_HINT_HTML\}/);
  assert.match(explore,/\$\{SKILL_HTML\}<button class="explore-pause"/);
  assert.match(explore,/shell\.dataset\.out==='true'\|\|shell\.dataset\.controls==='off'\|\|!direction\.start/);
  assert.match(explore,/if\(applyControls\(shell,controls\)\)reset\(\);/);
  // Written only when it changes (F3: no write of the same value every frame).
  assert.match(explore,/#coop-attack'\),off=controls\.skill!=='live';if\(attack\.disabled!==off\)attack\.disabled=off;/);
  assert.match(STICK_HTML,/class="explore-stick"/);assert.match(SKILL_HTML,/id="coop-attack"/);
  assert.match(CONTROLS_HINT_HTML,/role="note"/);assert.match(CONTROLS_HINT_HTML,/ hidden>/);
  assert.doesNotMatch(CONTROLS_HINT_HTML,/<button|tabindex/);
});
test('coop.css: off hides (visibility, keeps the boxes); the etiqueta is a static Papel etiqueta clear of the waiting window',()=>{
  const css=read('src/client/coop.css');
  assert.match(css,/\.coop-shell\[data-controls=off\] :is\(\.explore-stick,#coop-attack\)\{visibility:hidden;pointer-events:none\}/);
  const rule=css.match(/\.explore-stick-hint\{([^}]*)\}/)?.[1]??'';
  for(const part of ['border-radius:var(--r-etiqueta)','background:var(--c-papel)','color:var(--c-breu)','var(--t-13)','pointer-events:none','left:0','bottom:0'])
    assert.ok(rule.includes(part),`etiqueta rule lacks ${part}`);
  assert.doesNotMatch(rule,/animation|transition|uppercase/);
  // Landscape: left of the widest (owner's) waiting window, min(560px, 100% − 300px) centred, with 8 px to spare.
  assert.match(css,/@media\(max-height:500px\)\{\.explore-stick-hint\{max-width:calc\(\(100vw - min\(560px,100vw - 300px\)\) \/ 2 - max\(18px,env\(safe-area-inset-left\)\) - 8px\)\}\}/);
  for(const width of [667,740,844,932]){
    const windowLeft=(width-Math.min(560,width-300))/2,max=windowLeft-18-8;
    assert.ok(max>=100,`${width}: only ${max} px for the etiqueta`);assert.ok(18+max+8<=windowLeft);
  }
  // The etiqueta grows with the text scale, so its two rows still fit one line each at 125% (342 px at 390 wide).
  assert.ok(rule.includes('max-width:min(calc(280px * var(--t-escala)),calc(100vw - 48px))'),'etiqueta width scales with the text');
});
test('coop.css: with the thumbs off the portrait window may reach 8 px over the etiqueta; "Tô pronto!" sticks to its bottom',()=>{
  const css=read('src/client/coop.css');
  // BUG-20261013-ORQ-oferta-e-dicas-menores: the etiqueta is one row (2 px padding + 2 px edge) in both phases.
  assert.ok(css.includes('.coop-shell[data-controls=off]{--controls-hint-room:calc(1.3 * var(--t-13) + 8px)}'));
  assert.ok(!css.includes('[data-run-phase=countdown]{--controls-hint-room'),'one row: no second room for the countdown');
  assert.ok(css.includes('.explore-stick-hint span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}'),'one line, cut with an ellipsis');
  assert.ok(css.includes('.explore-stick-hint span+span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}'),'the second row only for a screen reader');
  assert.ok(css.includes('@media(min-height:501px){.coop-shell[data-controls=off] .coop-wait{max-height:calc(100% - max(122px,calc(env(safe-area-inset-top) + 114px)) - max(24px,env(safe-area-inset-bottom)) - var(--controls-hint-room) - 8px)}}'),
    'portrait cap of the waiting window with the thumbs off');
  // The usual cap stays for the round and for landscape (bottom-anchored, beside the etiqueta, not over it).
  assert.match(css,/\.coop-wait\{position:absolute;[^}]*max-height:calc\(100% - 300px\)/);
  assert.match(css,/@media\(max-height:500px\)\{\.coop-wait\{top:auto;bottom:max\(8px,calc\(env\(safe-area-inset-bottom\) \+ 8px\)\);[^}]*max-height:calc\(100% - 64px\)/);
  // Fallback: the primary row never goes under the scrolling window's edge.
  assert.ok(css.includes('.coop-wait-actions{position:sticky;bottom:0;z-index:1;background:var(--c-lilas);box-shadow:0 -8px 0 var(--c-lilas)}'));
  // The numbers at 390×844 (no safe areas), against what the 6-player panels measured (scrollHeight + 4 px of border):
  // owner 6p lobby at 125%: 585; 6p countdown at 100%: 602 (both scrolled under the old 544 px cap).
  const cap=(height:number,scale:number,rows:number,safe={top:0,bottom:0})=>{
    const row=13*scale*1.3,room=rows*row+8,top=Math.max(122,safe.top+114),bottom=Math.max(24,safe.bottom);
    const max=height-top-bottom-room-8,windowBottom=top+max,hintTop=height-bottom-room;
    return {max,gap:hintTop-windowBottom};
  };
  for(const scale of [1,1.25]){
    const c=cap(844,scale,1);assert.ok(c.gap>=8,`gap ${c.gap}`);assert.ok(c.max>844-300,`${scale}: ${c.max} not above the old cap`);
  }
  assert.ok(cap(844,1.25,1).max>=585+4,`lobby 125%: ${cap(844,1.25,1).max}`);
  assert.ok(cap(844,1,1).max>=602+4,`countdown 100%: ${cap(844,1,1).max}`);
  // A notched phone (top 47, bottom 34) keeps the 8 px gap.
  assert.ok(cap(844,1.25,1,{top:47,bottom:34}).gap>=8);
});
test('coop.css landscape: the etiqueta keeps its first line (≤ 3 rows); the countdown number stands left of the buttons',()=>{
  const css=read('src/client/coop.css');
  const block=css.match(/\/\* Landscape: the etiqueta's column[\s\S]*?\n@media\(max-height:500px\)\{\n([\s\S]*?)\n\}\n/)?.[1]??'';
  for(const rule of ['.explore-stick-hint{padding:2px 6px}','.explore-stick-hint span+span{display:none}','.explore-stick-hint span{white-space:normal}',
    '.coop-wait[data-phase=countdown]{display:flex;flex-wrap:wrap;align-items:center;column-gap:12px}',
    '.coop-wait[data-phase=countdown]>*{flex:0 0 100%;min-width:0}','.coop-wait[data-phase=countdown]>.coop-wait-count{order:1;flex:none}',
    '.coop-wait[data-phase=countdown]>.coop-wait-actions{order:2;flex:1 1 0}'])
    assert.ok(block.includes(rule),`landscape block lacks ${rule}`);
  // Flex, never grid, on the window: a grid item's sticky offset is bounded by its cell, so the sticky row could not move.
  assert.doesNotMatch(block,/\.coop-wait\[data-phase=countdown\]\{display:grid/);
  // The number comes after the button row in the markup: order puts it first on the shared last line.
  const lobby=read('src/client/lobby.ts');
  assert.ok(lobby.indexOf('class="coop-wait-actions"')<lobby.indexOf('class="coop-wait-count"'));
  // First line alone, greedy wrap at ~0.5 em a character in the column left at 844 wide (124 px − 6·2 padding − 2·2 border).
  const column=(844-Math.min(560,844-300))/2-18-8-12-4;
  const rows=(text:string,px:number)=>{const per=Math.floor(column/(px*0.5));let n=1,used=0;
    for(const word of text.split(' ')){const w=word.length;if(!used)used=w;else if(used+1+w<=per)used+=1+w;else{n++;used=w;}}return n;};
  for(const scale of [1,1.25])assert.ok(rows(CONTROLS_HINTS.lobby[0],13*scale)<=3,`${scale}: ${rows(CONTROLS_HINTS.lobby[0],13*scale)} rows`);
  assert.match(CONTROLS_HINTS.lobby[0],/arrasta/);assert.match(CONTROLS_HINTS.lobby[0],/andar/);
});
test('coop.css countdown: guest names go two by two in portrait and landscape, cut with "…", chips kept at 32 px',()=>{
  const css=read('src/client/coop.css');
  // Top level (outside every @media): portrait at 125% scrolled 703/649 with one name a row and cut "Pombo Sem Wi-Fi".
  const top=css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g,'');
  for(const rule of ['.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-members{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}',
    '.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-members li{min-width:0}',
    '.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-members li>span:not(.sr-only){min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'])
    assert.ok(top.includes(rule),`top level lacks ${rule}`);
  // Only the countdown and only the guest: the guest's lobby keeps its wrapping row, the owner its own grid of buttons.
  const guestGrids=css.match(/[^{}]*:not\(\.is-owner\) \.coop-wait-members\{display:grid/g)??[];
  assert.deepEqual(guestGrids.map(r=>r.trim().replace(/^.*\*\/\s*/s,'')),['.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-members{display:grid']);
  // Portrait: the guest's own chip takes both columns, so "(você)" never leaves only "P…" of the name.
  assert.ok(css.includes('@media(min-height:501px){.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-members li.is-self{grid-column:1/-1;justify-self:center}}'));
  // Landscape: the guest's countdown window is as wide as the owner's (the etiqueta already clears that one), so six
  // whole names fit two by two in three rows; no headline margin (125% was 327/322, now 317 with the window uncapped).
  const block=css.match(/\/\* Landscape: the etiqueta's column[\s\S]*?\n@media\(max-height:500px\)\{\n([\s\S]*?)\n\}\n/)?.[1]??'';
  assert.ok(block.includes('.coop-wait[data-phase=countdown]:not(.is-owner){width:min(560px,calc(100% - 300px))}'));
  assert.ok(css.includes('.coop-wait.is-owner{width:min(560px,calc(100% - 300px))}'),'same width as the owner window');
  assert.ok(block.includes('.coop-wait[data-phase=countdown]:not(.is-owner) .coop-wait-headline{margin:0}'));
  assert.doesNotMatch(block,/is-self/,'landscape: the own chip stays in its column (257 px fits it whole)');
  // A guest's chip is a plain li (no button, not a tap target): 32 px tall, 13 px text at the least.
  assert.match(css,/\.coop-wait-members li\{display:flex;align-items:center;gap:4px;min-height:32px;[^}]*font-size:var\(--t-13\)/);
  const lobby=read('src/client/lobby.ts');
  assert.ok(lobby.includes('<button type="button" data-id='),'the owner chips are the buttons');
  // Two columns, three rows for six: the window's height at 125% drops by three chip rows (32 + 6 gap) at least.
  assert.ok(703-3*(32+6)<=649,'portrait 125% countdown fits');
});
test('coop.css countdown: the number and the button row stick to the window bottom together, in view at 100% and 125%',()=>{
  const css=read('src/client/coop.css');
  assert.ok(css.includes('.coop-wait-actions{position:sticky;bottom:0;z-index:1;background:var(--c-lilas);box-shadow:0 -8px 0 var(--c-lilas)}'));
  assert.ok(css.includes('.coop-wait[data-phase=countdown]>.coop-wait-count{position:sticky;bottom:0;z-index:1;background:var(--c-lilas)}'));
  assert.ok(css.includes('@media(min-height:501px){.coop-wait[data-phase=countdown]>.coop-wait-actions{bottom:64px}}'),'portrait: the row sits on the number');
  // Numbers read from the rules.
  const num=(re:RegExp)=>{const m=css.match(re);assert.ok(m,String(re));return Number(m![1]);};
  const portraitCount=num(/\.coop-wait-count\{margin:0;font:900 (\d+)px\/1 /);
  assert.equal(portraitCount,num(/\.coop-wait-actions\{bottom:(\d+)px\}/),'the sticky row offset is the portrait number height');
  const landscapeCount=num(/@media\(max-height:500px\)\{\.coop-wait\{[^}]*\}[^@]*?\.coop-wait-count\{font-size:var\(--t-(\d+)\)\}/);
  const rowGap=num(/\.coop-wait-actions\{display:flex;gap:8px;margin-top:(\d+)px\}/),button=num(/\.coop-wait \.coop-wait-ready\{min-height:(\d+)px\}/);
  const landscapeCut=num(/@media\(max-height:500px\)\{\.coop-wait\{[^}]*max-height:calc\(100% - (\d+)px\)/),border=2;
  const landscapeClient=390-landscapeCut-2*border;
  for(const scale of [1,1.25]){
    const count=landscapeCount*scale,row=rowGap+button;
    // Landscape: one shared line, the taller of the two; portrait: stacked.
    assert.ok(Math.max(count,row)<=landscapeClient,`landscape ${scale}`);
    const portraitClient=844-122-24-(13*scale*1.3+16)-8-2*border;
    assert.ok(portraitCount+row<=portraitClient,`portrait ${scale}`);
  }
  // The landscape countdown panels measured before the shared line (scrollHeight vs 322): each loses the number's own
  // line, the smaller of the number and the button row (48 at 100%, 56 at 125%); the guest's two columns only add room.
  const saved=(scale:number)=>Math.min(landscapeCount*scale,rowGap+button);
  for(const [name,measured,scale] of [['dono-6p 100%',357,1],['convidado-6p 100%',363,1],['dono-6p 125%',336,1.25],['convidado-6p 125%',374,1.25]] as const)
    assert.ok(measured-saved(scale)<=landscapeClient,`${name}: ${measured-saved(scale)} > ${landscapeClient}`);
});
test('sandbox-sala: the real control markup and CSS, with the phase applied like explore.ts',()=>{
  const sandbox=read('src/client/sandboxes/sandbox-sala.ts');
  assert.match(sandbox,/import '\.\.\/explore\.css';/);assert.match(sandbox,/import '\.\.\/coop\.css';/);
  assert.match(sandbox,/\$\{STICK_HTML\}\$\{CONTROLS_HINT_HTML\}<\/div><div class="explore-actions">\$\{SKILL_HTML\}/);
  assert.match(sandbox,/explore-shell coop-shell/);assert.match(sandbox,/applyControls\(layout,controls\)/);
  assert.doesNotMatch(sandbox,/ss-stick|ss-attack|ss-mock/);
});

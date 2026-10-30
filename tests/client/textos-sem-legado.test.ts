import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PLAYABLE_CLASS_IDS} from '../../src/rules/classes.ts';
import {CLASS_LINES} from '../../src/client/fun/lines.data.ts';
import {FALLBACK_LINES} from '../../src/client/fun/lines.ts';
import {resultHeadline,defeatLine,manageLabel} from '../../src/client/hud/result.ts';
import {offerJoke} from '../../src/client/hud/offer.ts';
import {CHINELO_LINES,LEAVE_TEXT} from '../../src/client/hud/spectator.ts';
import {WAITING_LINES,OWNER_HINT,SOLO_TEXT,confirmText} from '../../src/client/lobby.ts';
import {emptyCauses} from '../../src/client/hud/cause.ts';

/** The legacy cast (auditoria-textos-30-10 §3): none of it may reach these screens; the 6 heroes, saci and sanfoneiro may. */
const LEGACY=/s[íi]ndico|b[êe]bado|pav[êe]|condom[íi]nio|agiota/i;

test('textos-sem-legado: result, lobby, offer, spectator and the balloons never name the legacy cast', ()=>{
  const seen:string[]=[];
  for(let i=0;i<64;i++)for(const victory of [true,false]){
    seen.push(resultHeadline({victory,seed:`s${i}`}).subtitle);
    seen.push(offerJoke(`o${i}`,'level'),offerJoke(`o${i}`,'round'));
  }
  seen.push(defeatLine({victory:false,round:7,totalRounds:10},emptyCauses())!);
  seen.push(...WAITING_LINES,OWNER_HINT,SOLO_TEXT.noCity,...CHINELO_LINES,LEAVE_TEXT,...Object.values(FALLBACK_LINES).flat());
  for(const id of PLAYABLE_CLASS_IDS)seen.push(...Object.values(CLASS_LINES[id]??{}).flat());
  for(const line of seen)assert.doesNotMatch(line,LEGACY,line);
  const awards=readFileSync(new URL('../../src/client/hud/awards.ts',import.meta.url),'utf8');
  for(const title of awards.matchAll(/title:'([^']*)'/g))assert.doesNotMatch(title[1],LEGACY,title[1]);
});

test('textos-sem-legado: one verb for a person and a bot ("Expulsar"), "seu" not "teu", "sala" not "lobby", "Tenta de novo"', ()=>{
  assert.equal(confirmText({name:'Pamonha 3000',bot:true}),'Expulsar Pamonha? Toca de novo.');
  assert.equal(manageLabel({name:'Pamonha 3000',bot:true},false),'Expulsar bot');
  assert.match(OWNER_HINT,/pra expulsar\.$/);
  for(const line of CHINELO_LINES)assert.doesNotMatch(line,/\bteu\b/i,line);
  assert.equal(LEAVE_TEXT,'Voltar pra sala');
  assert.doesNotMatch(SOLO_TEXT.noCity,/Tente novamente/);
});

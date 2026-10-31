// menu-diz-o-jogo-e-convite (NEW-20261029-ORQ-menu-diz-o-jogo-e-convite): the menu says what the game is (#2), an
// invite says who called and goes in with ENTRAR (#11), the role badge says what it does (#9), the drawn bell and tabs
// are not buttons (#8).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {INVITER_MAX,inviteCode,inviterName,setInviter,shareLink} from '../../src/client/ui/invite.ts';
import {CONFIRM_TEXT,INVITE_TEXT,confirmText,showEtapa,type EtapaParts} from '../../src/client/ui/menu-etapa.ts';
import {ROLE_LINE} from '../../src/client/ui/suit.ts';
import {abasHtml,barraHtml} from '../../src/client/ui/insta.ts';
import {roles} from '../../src/rules/index.ts';

const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const insta=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const estadio=readFileSync(new URL('../../src/client/estadio.css',import.meta.url),'utf8');

test('#2 undone (menu-sem-subtexto-oque, the user 31/10: "isso é ruído"): no line under the 6 heroes says what the game is',()=>{
  for(const src of [main,estadio,insta])assert.doesNotMatch(src,/menu-oque|MENU_OQUE|Sozinho ou com até|rodada a rodada/);
});

test('#11: the invite link says who called; the name is cleaned and cut, never trusted as HTML',()=>{
  assert.equal(inviterName('?sala=3103A23B68&de=Ana'),'Ana');
  assert.equal(inviterName('?sala=3103A23B68&de=%20Ana%20%20Paula%0A'),'Ana Paula');
  assert.equal(inviterName('?sala=3103A23B68'),undefined);
  assert.equal(inviterName('?de=%E2%80%AE%E2%80%8B'),undefined,'only invisible characters');
  assert.equal(inviterName('?de='+encodeURIComponent('x'.repeat(50)))!.length,INVITER_MAX);
  assert.equal(Array.from(inviterName('?de='+encodeURIComponent('😀'.repeat(30)))!).length,INVITER_MAX,'never half an emoji');
  assert.match(main,/conviteFaixa\.textContent=`\$\{inviterName\(location\.search\)\?\?'Um amigo'\} te chamou para a sala \$\{formatRoomCode\(invite\)\}`/);
  assert.doesNotMatch(main,/conviteFaixa\.innerHTML/);
});

test('#11: the lobby\'s link carries who shares it, and still opens the same room',()=>{
  try{
    setInviter('  Ana  Paula ');
    const url=new URL(shareLink('https://viagem.cyou/','3103A23B68','&dev=1'));
    assert.equal(url.searchParams.get('de'),'Ana Paula');
    assert.equal(inviteCode(url.search),'3103A23B68');
    assert.equal(inviterName(url.search),'Ana Paula');
    assert.equal(url.searchParams.get('dev'),'1');
    setInviter('');
    assert.equal(shareLink('https://viagem.cyou','ABCDEF0123'),'https://viagem.cyou/?sala=ABCDEF0123');
  }finally{setInviter('');}
  assert.match(main,/coopButton\.disabled=true;setInviter\(nickname\.trim\(\)\);/,'set before the lobby opens');
});

test('#11: with an invite the button says ENTRAR on both steps and the second one goes into the room',()=>{
  assert.equal(confirmText('escolher'),CONFIRM_TEXT.escolher);
  assert.equal(confirmText('nome'),CONFIRM_TEXT.nome);
  assert.equal(confirmText('escolher',true),INVITE_TEXT);
  assert.equal(confirmText('nome',true),INVITE_TEXT);
  const parts:EtapaParts={section:{dataset:{}},row:{hidden:false},nameRow:{hidden:true},input:{value:'',focus(){}},label:{textContent:''},convite:true};
  showEtapa(parts,'nome',{focusName:false});
  assert.equal(parts.label.textContent,'ENTRAR');
  assert.equal(parts.nameRow.hidden,false,'the name is asked on the same screen');
  assert.match(main,/if\(invite\) \{toMatch\(\);void openInvite\(\);return;\}/,'no popup in between');
  assert.match(main,/if\(!await openCoop\(\{room,autoJoin:true\}\)\)\{invite=room;showInvite\(\);\}/,'a failed room keeps the invite');
  assert.match(main,/if\(!dialog\.open\)\{showChosen\(\);dialog\.showModal\(\);\}/,'and the popup says why');
  assert.match(insta,/\[data-convite\] \.insta-barra \{ margin-top: calc\(var\(--u\) \* -109\)/,'on the upright phone, in the logo\'s place');
});

test('#9: every role says what it does, as the badge\'s title and a line',()=>{
  for(const role of roles){assert.ok(ROLE_LINE[role]?.length>8,role);assert.ok(ROLE_LINE[role].length<=40,role);}
  assert.match(main,/<span class="chosen-role" title="\$\{line\}">[^`]*<small class="chosen-role-linha">\$\{line\}<\/small>/);
});

test('#8: the bell and the video/liked tabs are drawings, not buttons',()=>{
  assert.match(barraHtml(),/<span class="insta-sino" aria-hidden="true">/);
  assert.equal(abasHtml().match(/class="insta-aba muda"/g)?.length,2);
  assert.match(insta,/\.insta-sino \{ color: var\(--insta-cinza\); pointer-events: none; \}/);
  assert.match(insta,/\.insta-aba\.muda \{/);
});

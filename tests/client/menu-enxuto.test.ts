import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// menu-personagem-enxuto (the user, 18/10): the Personagem card holds only the dancing hero on the podium, the class
// name, the ‹ › arrows, the player's name and "Esse sou eu!". Prints and overflow checks: evidence/NEW-20261018-ORQ-menu-personagem-enxuto.
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const css=readFileSync(new URL('../../src/client/sections.css',import.meta.url),'utf8');
const card=main.slice(main.indexOf('<section id="personagem"'),main.indexOf('<section id="classes"'));

test('the Personagem card keeps only the podium, the class name, the arrows, the name field and the confirm button',()=>{
  for(const piece of ['id="class-name"','id="portrait"','id="previous"','id="next"','id="nickname"','id="confirm"','Esse sou eu!'])assert.ok(card.includes(piece),piece);
  for(const gone of ['portrait-role','id="quote"','palette','swatch','Cor do emblema','radar','stat-','skill-name','skill-description','stats-and-story'])
    assert.ok(!card.includes(gone),`${gone} left the card`);
  assert.ok(!/radar-shape|'quote'|portrait-role|skill-name|\.swatch/.test(main),'no code fills what is gone');
  assert.match(main,/let color = colors\[0\];/,'the emblem keeps its default (or saved) color without asking');
});
test('the card CSS drops the removed parts and keeps the podium inside a narrow PC card',()=>{
  assert.ok(!/portrait-caption|\.palette|\.swatch|stats-and-story|radar-wrap|stat-label|skill-box/.test(css));
  assert.match(css,/@media \(min-width: 621px\) and \(min-height: 521px\) \{ \.criacao #personagem \{ width: min\(var\(--janela-w\), 100%, 560px\); \} \}/);
  assert.match(css,/\.criacao \.portrait-navigation \{\s*position: absolute;/,'the arrows ride on the podium');
  assert.match(css,/\* \.7\); \}/,'the PC dancer stays 30% smaller');
});

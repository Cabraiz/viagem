import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classes, filterClasses, getClass } from '../../src/rules/classes.ts';
// 35 classes since Tia da Festa left (NEW-20261013-ORQ-classes-cartas-e-nomes), 36 with the gato (gato-no-menu), who
// takes her free cell 16 of the 36-cell atlas: `art` is the cell, so nobody is renumbered. 29 since 7 left for legado/
// (NEW-20261023-ORQ-remover-7-personagens); their cells stay empty.
const LEFT=['rainha-bateria','goleira','salva-vidas','sensei','roqueira','caca-promocao','gamer-mobile'];
test('29 classes have unique identity and one atlas cell each; the 7 removed ones are gone',()=>{
  assert.equal(classes.length,29);
  for(const key of ['id','name','skill','art'] as const) assert.equal(new Set(classes.map(hero=>hero[key])).size,29);
  for(const id of LEFT)assert.equal(getClass(id),undefined,id);
  assert.ok(classes.every(hero=>Number.isInteger(hero.art)&&hero.art>=0&&hero.art<36));
});
test('every class has a complete and balanced selectable sheet',()=>{
  for(const hero of classes){assert.equal(hero.stats.reduce((sum,value)=>sum+value,0),12,hero.name);assert.ok(hero.stats.every(value=>value>=1&&value<=5));}
});
test('literal requested classes exist and search ignores accents',()=>{
  assert.equal(getClass('cidadao-comum')?.name,'Cidadão');
  assert.deepEqual(['clt-cansado','vizinha-fofoqueira','aposentado','universitario'].map(id=>getClass(id)?.name),['CLT','Fofoqueira','Aposentado','Universitário']);
  assert.equal(getClass('tia-festa'),undefined);
  assert.equal(getClass('mendigo')?.name,'Mendigo');
  assert.equal(getClass('viciado-em-bet')?.name,'Viciado em Bet');
  // D-053: the menu's search sees the playable classes only; herois-legados-escondidos (29/10): the 6 active heroes,
  // so the Universitário and the Cidadão are hidden legacy heroes.
  assert.equal(filterClasses('APOSENTÁDO','Todas')[0].id,'aposentado');
  assert.equal(filterClasses('UNIVERSITARIO','Todas').length,0);
  assert.equal(filterClasses('CIDADAO','Todas').length,0);
  assert.equal(filterClasses('TI','Suporte').every(hero=>hero.role==='Suporte'),true);
  assert.equal(filterClasses('inexistente-xyz','Todas').length,0);
});

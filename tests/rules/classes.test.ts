import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classes, filterClasses, getClass } from '../../src/rules/classes.ts';
// 35 classes since Tia da Festa left (NEW-20261013-ORQ-classes-cartas-e-nomes); `art` is the cell in the 36-cell atlas, so
// it keeps its gap instead of renumbering the art.
test('35 classes have unique identity and one atlas cell each',()=>{
  assert.equal(classes.length,35);
  for(const key of ['id','name','skill','art'] as const) assert.equal(new Set(classes.map(hero=>hero[key])).size,35);
  assert.ok(classes.every(hero=>Number.isInteger(hero.art)&&hero.art>=0&&hero.art<36));
});
test('every class has a complete and balanced selectable sheet',()=>{
  for(const hero of classes){assert.equal(hero.stats.reduce((sum,value)=>sum+value,0),12,hero.name);assert.ok(hero.stats.every(value=>value>=1&&value<=5));assert.ok(hero.description&&hero.skillDescription&&hero.quote);}
});
test('literal requested classes exist and search ignores accents',()=>{
  assert.equal(getClass('cidadao-comum')?.name,'Cidadão');
  assert.deepEqual(['clt-cansado','vizinha-fofoqueira','goleira','universitario'].map(id=>getClass(id)?.name),['CLT','Fofoqueira','Goleira','Universitário']);
  assert.equal(getClass('tia-festa'),undefined);
  assert.equal(getClass('mendigo')?.name,'Mendigo');
  assert.equal(getClass('viciado-em-bet')?.name,'Viciado em Bet');
  // D-053: the menu's search sees the 15 playable classes only (the Cidadão is hidden for now).
  assert.equal(filterClasses('UNIVERSITARIO','Todas')[0].id,'universitario');
  assert.equal(filterClasses('CIDADAO','Todas').length,0);
  assert.equal(filterClasses('TI','Suporte').every(hero=>hero.role==='Suporte'),true);
  assert.equal(filterClasses('inexistente-xyz','Todas').length,0);
});

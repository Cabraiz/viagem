import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { classes, filterClasses, getClass } from '../src/classes.ts';
test('36 classes have unique identity and exactly one atlas cell each',()=>{
  assert.equal(classes.length,36);
  for(const key of ['id','name','skill','art'] as const) assert.equal(new Set(classes.map(hero=>hero[key])).size,36);
  assert.deepEqual(classes.map(hero=>hero.art),Array.from({length:36},(_,i)=>i));
});
test('every class has a complete and balanced selectable sheet',()=>{
  for(const hero of classes){assert.equal(hero.stats.reduce((sum,value)=>sum+value,0),12,hero.name);assert.ok(hero.stats.every(value=>value>=1&&value<=5));assert.ok(hero.description&&hero.skillDescription&&hero.quote);}
});
test('literal requested classes exist and search ignores accents',()=>{
  assert.equal(getClass('cidadao-comum')?.name,'Cidadão Comum');
  assert.equal(getClass('mendigo')?.name,'Mendigo');
  assert.equal(getClass('viciado-em-bet')?.name,'Viciado em Bet');
  assert.equal(filterClasses('CIDADAO','Todas')[0].id,'cidadao-comum');
  assert.equal(filterClasses('TI','Suporte').every(hero=>hero.role==='Suporte'),true);
  assert.equal(filterClasses('inexistente-xyz','Todas').length,0);
});

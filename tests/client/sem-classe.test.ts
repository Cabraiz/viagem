/**
 * NEW-20261029-ORQ-sem-classe-no-jogo: the player never reads "classe" (the user, 29/10: "Não quero mais classe no
 * jogo"); a hero is a "herói". Every string literal of the client, the rules and the room is scanned; comments and the
 * code's own names (HeroClass, getClass, classes.ts) may keep the word.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

const ROOTS=['src','multiplayer','index.html'];
const QUOTES=['\'','"','`'];

const files=(path:string):string[]=>/\.(ts|html)$/.test(path)?[path]:
  readdirSync(path,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(path,e.name)):/\.(ts|html)$/.test(e.name)?[join(path,e.name)]:[]);
/** The text of every string literal (single, double or backtick quotes) or, for html, of the text between tags; comments skipped. */
function visibleTexts(src:string,html=false):string[]{
  if(html)return [...src.replace(/<!--[\s\S]*?-->/g,'').replace(/<script[\s\S]*?<\/script>/g,'').matchAll(/>([^<]+)</g)].map(m=>m[1]);
  const out:string[]=[];
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(c==='/'&&src[i+1]==='/'){i=src.indexOf('\n',i);if(i<0)break;continue;}
    if(c==='/'&&src[i+1]==='*'){i=src.indexOf('*/',i+2)+1;if(i<=0)break;continue;}
    if(!QUOTES.includes(c))continue;
    let j=i+1;
    while(j<src.length&&src[j]!==c&&!(c!==QUOTES[2]&&src[j]==='\n'))j+=src[j]==='\\'?2:1;
    out.push(src.slice(i+1,j));i=j;
  }
  return out;
}
/** The word, not a path ('./classes.ts') or a css name (estadio-classe). */
const CLASSE=/(?<![\w./-])classes?(?![\w./-])/i;

test('the scan finds the word in strings, html text and templates, not in comments or names',()=>{
  const tick=QUOTES[2];
  const code='// classe\n/* classes */import \'./classes.ts\';const h=\'<h2 class="estadio-classe">\',a=\'Volte às classes\',b='+tick+'da classe {x}'+tick+';getClass(x);';
  assert.deepEqual(visibleTexts(code).filter(t=>CLASSE.test(t)),['Volte às classes','da classe {x}']);
  assert.deepEqual(visibleTexts('<!-- classe --><p>Escolha a classe</p>',true),['Escolha a classe']);
});

test('no "classe" the player can read',()=>{
  const found=ROOTS.flatMap(files).map(f=>f.replaceAll('\\','/'))
    .filter(f=>visibleTexts(readFileSync(f,'utf8'),f.endsWith('.html')).some(t=>CLASSE.test(t)));
  assert.deepEqual(found,[],'say "herói"/"heróis"');
});

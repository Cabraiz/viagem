#!/usr/bin/env node
/**
 * Lint de design (NEW-20261009-DSG-tokens, D-020). Falha se aparecer em src/**\/*.css (fora de src/ui/tokens.css):
 * hex, font-family que não seja var(--f-*), border-radius fora de var(--r-*)/50%/0, sombra com blur > 0,
 * text-transform:uppercase, letter-spacing > .02em e texto menor que o mínimo (13 px na partida, 10 px fora).
 * Em src/game/**\/*.ts (menos sandbox-*), emoji e ✦ em código (comentários não contam) não podem passar do
 * baseline de scripts/design-lint-baseline.json: o débito atual é dos cards DSG-icones-sistema e DSG-adesivos-itens.
 * Uso: node scripts/lint-design.mjs [raiz]   (sai com 1 se houver violação)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TOKENS='src/ui/tokens.css';
/** CSS lido em partida (HUD e emotes): mínimo 13 px CSS. O resto (lobby, ilha, telas de fora): 10 px. */
const MATCH_CSS=new Set(['src/game/hud/hud.css','src/game/fun/fun.css']);
const MIN_MATCH=13,MIN_OTHER=10;
const EMOJI=/\p{Extended_Pictographic}|✦/gu;

function walk(dir,ext,out=[]){
  if(!fs.existsSync(dir))return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())walk(p,ext,out);else if(entry.name.endsWith(ext))out.push(p);
  }
  return out;
}
const rel=(root,p)=>path.relative(root,p).split(path.sep).join('/');

/** Declarations with selector and line, from innermost blocks (works through @media and @container). */
export function declarations(css){
  const out=[];
  const clean=css.replace(/\/\*[\s\S]*?\*\//g,m=>m.replace(/[^\n]/g,' '));
  const re=/([^{}]*)\{([^{}]*)\}/g;let m;
  while((m=re.exec(clean))){
    const selector=m[1].trim(),body=m[2];
    let offset=m.index+m[1].length+1;
    for(const part of body.split(';')){
      const i=part.indexOf(':');
      if(i>0){
        const prop=part.slice(0,i).trim().toLowerCase(),value=part.slice(i+1).trim();
        const line=clean.slice(0,offset+part.search(/\S|$/)).split('\n').length;
        if(prop&&!prop.startsWith('@'))out.push({selector,prop,value,line});
      }
      offset+=part.length+1;
    }
  }
  return out;
}

/** Splits on top-level commas (not inside parentheses). */
function splitTop(value){
  const parts=[];let depth=0,start=0;
  for(let i=0;i<value.length;i++){const c=value[i];if(c==='(')depth++;else if(c===')')depth--;else if(c===','&&!depth){parts.push(value.slice(start,i));start=i+1;}}
  parts.push(value.slice(start));return parts.map(s=>s.trim()).filter(Boolean);
}
/** Removes function calls (var, color-mix, rgb, calc…) so only bare tokens remain. */
function stripCalls(value){let v=value,prev;do{prev=v;v=v.replace(/[a-z-]+\([^()]*\)/gi,' ');}while(v!==prev);return v;}

function shadowBlurs(value){
  if(/^(none|inherit|initial|unset)$/i.test(value))return [];
  const blurs=[];
  for(const shadow of splitTop(value)){
    const lengths=stripCalls(shadow).split(/\s+/).filter(t=>/^-?[\d.]+(px|em|rem)?$/.test(t));
    if(lengths.length>=3)blurs.push(parseFloat(lengths[2]));
  }
  return blurs;
}
function dropShadowBlurs(value){
  const out=[];const re=/drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;let m;
  while((m=re.exec(value))){const lengths=stripCalls(m[1]).split(/\s+/).filter(t=>/^-?[\d.]+(px|em|rem)?$/.test(t));if(lengths.length>=3)out.push(parseFloat(lengths[2]));}
  return out;
}
const GENERIC=/\b(serif|sans-serif|monospace|ui-monospace|system-ui|cursive|fantasy|georgia|trebuchet|arial|helvetica|verdana|times|courier|roboto|inter)\b/i;
function fontFamilyOk(value){
  if(/^(inherit|initial|unset)$/i.test(value))return true;
  if(!/var\(--f-[a-z-]+\)/.test(value))return false;
  const rest=stripCalls(value);
  return !/["']/.test(rest)&&!GENERIC.test(rest);
}
/** Smallest font size in px a declaration can produce (clamp/max use the first argument); undefined when unknown. */
function minFontPx(value){
  if(/var\(--t-\d+\)/.test(value))return undefined;
  const c=value.match(/clamp\(\s*([\d.]+)px/i);if(c)return parseFloat(c[1]);
  const v=value.replace(/\/[\d.]+(px)?/g,' ');
  const px=v.match(/(?:^|\s)([\d.]+)px\b/);
  return px?parseFloat(px[1]):undefined;
}
const RADIUS_PART=/^(var\(--r-[a-z]+\)|50%|0|0px|inherit|initial)$/;

export function lintCss(file,css){
  const v=[];
  const add=(d,rule,msg)=>v.push({file,line:d.line,rule,msg:`${msg} (${d.selector.slice(-60)} { ${d.prop}:${d.value.slice(0,80)} })`});
  for(const d of declarations(css)){
    const {prop,value}=d;
    if(/#[0-9a-f]{3,8}\b/i.test(value))add(d,'hex','cor em hex fora do tokens.css');
    if(prop==='font-family'&&!fontFamilyOk(value))add(d,'font-family','font-family fora de var(--f-*)');
    if(prop==='font'&&!fontFamilyOk(value))add(d,'font-family','font sem var(--f-*) (ou com nome de fonte)');
    if(/^border(-(top|bottom)-(left|right))?-radius$/.test(prop)){
      const parts=value.replace(/\s*\/\s*/g,' ').split(/\s+(?![^(]*\))/);
      if(!parts.every(p=>RADIUS_PART.test(p)))add(d,'radius','border-radius fora de var(--r-*), 50% ou 0');
    }
    if(prop==='box-shadow'||prop==='text-shadow'||(prop.startsWith('--')&&/shadow|sombra/.test(prop))){
      if(shadowBlurs(value).some(b=>b>0))add(d,'shadow','sombra com blur (só sombra dura)');
    }
    if(prop==='filter'&&dropShadowBlurs(value).some(b=>b>0))add(d,'shadow','drop-shadow com blur (só sombra dura)');
    if(prop==='text-transform'&&/uppercase/i.test(value))add(d,'uppercase','text-transform:uppercase (caixa alta só dentro de carimbo, escrita no texto)');
    if(prop==='letter-spacing'){
      const m=value.match(/^(-?[\d.]+)(em|px|rem)?$/);
      if(m){const n=parseFloat(m[1]),unit=m[2]??'px';if((unit==='px'&&n>.3)||(unit!=='px'&&n>.02))add(d,'letter-spacing','letter-spacing > .02em');}
    }
    if(prop==='font-size'||prop==='font'){
      const min=MATCH_CSS.has(file)?MIN_MATCH:MIN_OTHER,px=minFontPx(value);
      if(px!==undefined&&px<min)add(d,'font-size',`texto de ${px}px (< ${min}px)`);
    }
  }
  return v;
}

/** Emoji/✦ count in code (strings and templates), comments stripped. */
export function emojiCount(source){
  const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"`\\])\/\/.*$/gm,'$1');
  return (code.match(EMOJI)??[]).length;
}

export function lintDesign(root=process.cwd()){
  const violations=[];
  for(const p of walk(path.join(root,'src'),'.css')){
    const file=rel(root,p);if(file===TOKENS)continue;
    violations.push(...lintCss(file,fs.readFileSync(p,'utf8')));
  }
  const baselinePath=path.join(root,'scripts/design-lint-baseline.json');
  const baseline=fs.existsSync(baselinePath)?JSON.parse(fs.readFileSync(baselinePath,'utf8')).emoji??{}:{};
  const emoji={},improved=[];
  for(const p of walk(path.join(root,'src/game'),'.ts')){
    const file=rel(root,p);if(/\/sandbox-[^/]*\.ts$/.test(file))continue;
    const n=emojiCount(fs.readFileSync(p,'utf8'));if(!n&&!baseline[file])continue;
    emoji[file]=n;
    const allowed=baseline[file]??0;
    if(n>allowed)violations.push({file,line:0,rule:'emoji',msg:`${n} emoji/✦ em código (baseline ${allowed}); use adesivo de icons.svg ou do atlas`});
    else if(n<allowed)improved.push(`${file}: ${allowed} -> ${n}`);
  }
  return {violations,emoji,improved};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const root=path.resolve(process.argv[2]??'.');
  const {violations,emoji,improved}=lintDesign(root);
  const byRule={};for(const x of violations)byRule[x.rule]=(byRule[x.rule]??0)+1;
  for(const x of violations)console.log(`${x.file}:${x.line} [${x.rule}] ${x.msg}`);
  console.log(`\n${violations.length} violação(ões) ${JSON.stringify(byRule)}; emoji em código: ${Object.values(emoji).reduce((a,b)=>a+b,0)} em ${Object.keys(emoji).length} arquivo(s)`);
  if(improved.length)console.log(`Baseline de emoji pode descer: ${improved.join(', ')}`);
  process.exit(violations.length?1:0);
}

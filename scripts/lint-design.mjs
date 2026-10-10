#!/usr/bin/env node
/**
 * Lint de design (NEW-20261009-DSG-tokens, D-020). Falha se aparecer em src/**\/*.css (fora de src/ui/tokens.css):
 * cor fora dos tokens (hex, rgb()/hsl()/…, nome de cor), font-family que não seja var(--f-*), border-radius fora de
 * var(--r-*)/50%/0, sombra com blur > 0 (em box-shadow, text-shadow, drop-shadow ou qualquer variável que guarde
 * sombra), text-transform:uppercase, qualquer letter-spacing positivo e texto menor que o mínimo (13 px na partida,
 * 10 px fora), contando px, rem e calc(). Entende CSS aninhado.
 * Em src/game/**\/*.ts (menos sandbox-*), emoji e ✦ em código (comentários não contam) têm de bater com o baseline de
 * scripts/design-lint-baseline.json: subir falha, e descer sem baixar o número também (o débito é dos cards
 * DSG-icones-sistema e DSG-adesivos-itens).
 * Uso: node scripts/lint-design.mjs [raiz]   (sai com 1 se houver violação)
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const TOKENS='src/ui/tokens.css';
/** CSS lido em partida (HUD e emotes): mínimo 13 px CSS. O resto (lobby, ilha, telas de fora): 10 px. */
const MATCH_CSS=new Set(['src/game/hud/hud.css','src/game/fun/fun.css','src/game/hud/you.css','src/game/hud/zones.css','src/game/hud/zones-debug.css']);
const MIN_MATCH=13,MIN_OTHER=10,ROOT_PX=16;
const EMOJI=/\p{Extended_Pictographic}|✦/gu;
const NAMED_COLORS=new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood '+
  'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey '+
  'darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey '+
  'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite '+
  'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon '+
  'lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue '+
  'lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid '+
  'mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin '+
  'navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff '+
  'peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver '+
  'skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '+
  'yellowgreen').split(' '));
const COLOR_FN=/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
/** Properties whose values are names or text, never colors. */
const NOT_COLOR=/^(content|font-family|grid-template-areas|grid-area|animation(-name)?|transition(-property)?|will-change|counter-.*|list-style-type|font-feature-settings|quotes)$/;

function walk(dir,ext,out=[]){
  if(!fs.existsSync(dir))return out;
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())walk(p,ext,out);else if(entry.name.endsWith(ext))out.push(p);
  }
  return out;
}
const rel=(root,p)=>path.relative(root,p).split(path.sep).join('/');

/**
 * Every declaration with its selector chain and line, at any nesting depth (plain, @media/@container and CSS nesting).
 * Strings and comments are respected; a ';' or '}' inside quotes or url() does not split.
 */
export function declarations(css){
  const out=[],stack=[];
  let buf='',bufLine=1,line=1,i=0;
  const flush=()=>{
    const text=buf.trim();buf='';
    if(!text||!stack.length)return;
    const k=text.indexOf(':');if(k<=0)return;
    const prop=text.slice(0,k).trim().toLowerCase(),value=text.slice(k+1).trim();
    if(/^[a-z-]+$/.test(prop))out.push({selector:stack.join(' '),prop,value,line:bufLine});
  };
  while(i<css.length){
    const c=css[i];
    if(c==='/'&&css[i+1]==='*'){const end=css.indexOf('*/',i+2);const stop=end<0?css.length:end+2;line+=(css.slice(i,stop).match(/\n/g)??[]).length;i=stop;continue;}
    if(c==='"'||c==="'"){let j=i+1;while(j<css.length&&css[j]!==c){if(css[j]==='\\')j++;j++;}if(!buf.trim())bufLine=line;buf+=css.slice(i,j+1);i=j+1;continue;}
    if(c==='('){let depth=0,j=i;for(;j<css.length;j++){if(css[j]==='(')depth++;else if(css[j]===')'&&!--depth)break;}if(!buf.trim())bufLine=line;const chunk=css.slice(i,j+1);line+=(chunk.match(/\n/g)??[]).length;buf+=chunk;i=j+1;continue;}
    if(c==='{'){stack.push(buf.trim());buf='';i++;continue;}
    if(c==='}'){flush();stack.pop();i++;continue;}
    if(c===';'){flush();i++;continue;}
    if(c==='\n')line++;
    if(!buf.trim()&&!/\s/.test(c))bufLine=line;
    buf+=c;i++;
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
const stripStringsAndUrls=v=>v.replace(/url\((?:[^()"']|"[^"]*"|'[^']*')*\)/gi,' ').replace(/"[^"]*"|'[^']*'/g,' ');

const LENGTH=/^-?[\d.]+(px|em|rem)?$/;
function shadowBlurs(value){
  if(/^(none|inherit|initial|unset)$/i.test(value))return [];
  const blurs=[];
  for(const shadow of splitTop(value)){
    const lengths=stripCalls(shadow).split(/\s+/).filter(t=>LENGTH.test(t));
    if(lengths.length>=3)blurs.push(parseFloat(lengths[2]));
  }
  return blurs;
}
/** A custom property that holds a shadow: some layer has 3+ lengths and a color (token, function or hex). */
function looksLikeShadow(value){
  return splitTop(value).some(layer=>stripCalls(layer).split(/\s+/).filter(t=>LENGTH.test(t)).length>=3&&/var\(--c-|color-mix|#[0-9a-f]{3,8}|rgba?\(|hsla?\(/i.test(layer));
}
function dropShadowBlurs(value){
  const out=[];const re=/drop-shadow\(([^()]*(?:\([^()]*\)[^()]*)*)\)/gi;let m;
  while((m=re.exec(value))){const lengths=stripCalls(m[1]).split(/\s+/).filter(t=>LENGTH.test(t));if(lengths.length>=3)out.push(parseFloat(lengths[2]));}
  return out;
}
const GENERIC=/\b(serif|sans-serif|monospace|ui-monospace|system-ui|cursive|fantasy|georgia|trebuchet|arial|helvetica|verdana|times|courier|roboto|inter)\b/i;
function fontFamilyOk(value){
  if(/^(inherit|initial|unset)$/i.test(value))return true;
  if(!/var\(--f-[a-z-]+\)/.test(value))return false;
  const rest=stripCalls(value);
  return !/["']/.test(rest)&&!GENERIC.test(rest);
}

/**
 * Smallest px a size expression can produce, or undefined when it depends on something unknown.
 * Understands px, rem (16 px), var(--t-N) (N px at scale 1), calc() with + - * /, min(), max() and clamp() (its minimum).
 * Other var() calls and %, em, vw… are unknown: the lint does not guess.
 */
export function sizePx(expr){
  const s=expr.trim();
  let m;
  if((m=s.match(/^var\(\s*--t-(\d+)\s*\)$/)))return Number(m[1]);
  if(/^var\(/.test(s))return undefined;
  if((m=s.match(/^(-?[\d.]+)px$/)))return parseFloat(m[1]);
  if((m=s.match(/^(-?[\d.]+)rem$/)))return parseFloat(m[1])*ROOT_PX;
  if((m=s.match(/^(-?[\d.]+)$/)))return parseFloat(m[1]);
  if((m=s.match(/^(clamp|min|max|calc)\((.*)\)$/s))){
    if(m[1]==='calc')return evalCalc(m[2]);
    const vals=splitTop(m[2]).map(sizePx);
    if(m[1]==='clamp')return vals[0];
    if(vals.some(v=>v===undefined))return m[1]==='max'?vals.find(v=>v!==undefined):undefined;
    return m[1]==='min'?Math.min(...vals):Math.max(...vals);
  }
  return undefined;
}
function evalCalc(body){
  // Tokenize numbers with units, var(--t-N), parentheses and operators; anything else makes it unknown.
  const tokens=[];const re=/\s*(var\(\s*--t-(\d+)\s*\)|var\([^()]*\)|(-?[\d.]+)(px|rem)?|[()+\-*/])/gy;let m,last=0;
  while((m=re.exec(body))){last=re.lastIndex;
    if(m[2])tokens.push(Number(m[2]));else if(m[1].startsWith('var('))return undefined;
    else if(m[3]!==undefined)tokens.push(parseFloat(m[3])*(m[4]==='rem'?ROOT_PX:1));else tokens.push(m[1]);}
  if(body.slice(last).trim())return undefined;
  let k=0;
  const expr=()=>{let v=term();while(tokens[k]==='+'||tokens[k]==='-'){const op=tokens[k++],r=term();v=op==='+'?v+r:v-r;}return v;};
  const term=()=>{let v=factor();while(tokens[k]==='*'||tokens[k]==='/'){const op=tokens[k++],r=factor();v=op==='*'?v*r:v/r;}return v;};
  const factor=()=>{const t=tokens[k++];if(t==='('){const v=expr();k++;return v;}if(t==='-')return -factor();return typeof t==='number'?t:NaN;};
  const v=expr();return Number.isFinite(v)?v:undefined;
}
/** Font size of a `font` shorthand: the token right before the optional /line-height and the family. */
function shorthandSize(value){
  const v=stripStringsAndUrls(value);
  const parts=[];let depth=0,cur='';
  for(const c of v){if(c==='(')depth++;if(c===')')depth--;if(/\s/.test(c)&&!depth){if(cur)parts.push(cur);cur='';}else cur+=c;}
  if(cur)parts.push(cur);
  for(const p of parts){
    const size=p.split('/')[0];
    if(/^(-?[\d.]+(px|rem)|var\(\s*--t-\d+\s*\)|calc\(.*\)|clamp\(.*\)|min\(.*\)|max\(.*\))$/s.test(size))return sizePx(size);
  }
  return undefined;
}
const RADIUS_PART=/^(var\(--r-[a-z]+\)|50%|0|0px|inherit|initial)$/;

export function lintCss(file,css){
  const v=[];
  const add=(d,rule,msg)=>v.push({file,line:d.line,rule,msg:`${msg} (${d.selector.slice(-60)} { ${d.prop}:${d.value.slice(0,80)} })`});
  for(const d of declarations(css)){
    const {prop,value}=d;
    const bare=stripStringsAndUrls(value);
    if(/#[0-9a-f]{3,8}\b/i.test(bare))add(d,'hex','cor em hex fora do tokens.css');
    if(COLOR_FN.test(bare.replace(/color-mix\(/gi,'')))add(d,'color','cor em rgb()/hsl()/… fora do tokens.css');
    if(!NOT_COLOR.test(prop)){
      const named=(stripCalls(bare).toLowerCase().match(/[a-z-]+/g)??[]).find(w=>NAMED_COLORS.has(w));
      if(named)add(d,'color',`cor por nome (${named}) fora do tokens.css`);
    }
    if(prop==='font-family'&&!fontFamilyOk(value))add(d,'font-family','font-family fora de var(--f-*)');
    if(prop==='font'&&!fontFamilyOk(value))add(d,'font-family','font sem var(--f-*) (ou com nome de fonte)');
    if(/^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/.test(prop)){
      const parts=value.replace(/\s*\/\s*/g,' ').split(/\s+(?![^(]*\))/);
      if(!parts.every(p=>RADIUS_PART.test(p)))add(d,'radius','border-radius fora de var(--r-*), 50% ou 0');
    }
    const shadowProp=prop==='box-shadow'||prop==='text-shadow'||(prop.startsWith('--')&&(/shadow|sombra/.test(prop)||looksLikeShadow(value)));
    if(shadowProp&&shadowBlurs(value).some(b=>b>0))add(d,'shadow','sombra com blur (só sombra dura)');
    if(/drop-shadow\(/i.test(value)&&dropShadowBlurs(value).some(b=>b>0))add(d,'shadow','drop-shadow com blur (só sombra dura)');
    if(prop==='text-transform'&&/uppercase/i.test(value))add(d,'uppercase','text-transform:uppercase (caixa alta só dentro de carimbo, escrita no texto)');
    if(prop==='letter-spacing'){
      const m=value.match(/^(-?[\d.]+)(em|px|rem)?$/);
      if(m&&parseFloat(m[1])>0)add(d,'letter-spacing','letter-spacing positivo (tracking em rótulo é tique de template)');
    }
    if(prop==='font-size'||prop==='font'){
      const min=MATCH_CSS.has(file)?MIN_MATCH:MIN_OTHER;
      const px=prop==='font'?shorthandSize(value):sizePx(value);
      if(px!==undefined&&px<min)add(d,'font-size',`texto de ${+px.toFixed(2)}px (< ${min}px)`);
    }
  }
  return v;
}

/** Code without comments: strings and template literals are kept (a "//" inside a string is not a comment). */
export function stripJsComments(source){
  let out='',i=0;const n=source.length;
  while(i<n){
    const c=source[i],d=source[i+1];
    if(c==='/'&&d==='/'){while(i<n&&source[i]!=='\n')i++;continue;}
    if(c==='/'&&d==='*'){const end=source.indexOf('*/',i+2);i=end<0?n:end+2;out+=' ';continue;}
    if(c==='"'||c==="'"||c==='`'){
      let j=i+1;
      while(j<n&&source[j]!==c){if(source[j]==='\\')j++;else if(c!=='`'&&source[j]==='\n')break;j++;}
      out+=source.slice(i,j+1);i=j+1;continue;
    }
    out+=c;i++;
  }
  return out;
}
/** Emoji/✦ count in code (strings and templates), comments stripped. */
export function emojiCount(source){
  return (stripJsComments(source).match(EMOJI)??[]).length;
}

export function lintDesign(root=process.cwd()){
  const violations=[];
  for(const p of walk(path.join(root,'src'),'.css')){
    const file=rel(root,p);if(file===TOKENS)continue;
    violations.push(...lintCss(file,fs.readFileSync(p,'utf8')));
  }
  const baselinePath=path.join(root,'scripts/design-lint-baseline.json');
  const baseline=fs.existsSync(baselinePath)?JSON.parse(fs.readFileSync(baselinePath,'utf8')).emoji??{}:{};
  const emoji={};
  const files=new Set([...walk(path.join(root,'src/game'),'.ts').map(p=>rel(root,p)),...Object.keys(baseline)]);
  for(const file of [...files].sort()){
    if(/\/sandbox-[^/]*\.ts$/.test(file))continue;
    const full=path.join(root,file);
    const n=fs.existsSync(full)?emojiCount(fs.readFileSync(full,'utf8')):0;
    const allowed=baseline[file]??0;
    if(n)emoji[file]=n;
    if(n>allowed)violations.push({file,line:0,rule:'emoji',msg:`${n} emoji/✦ em código (baseline ${allowed}); use adesivo de icons.svg ou do atlas`});
    else if(n<allowed)violations.push({file,line:0,rule:'emoji-baseline',msg:`${n} emoji/✦ em código, mas o baseline ainda diz ${allowed}: baixe o número em scripts/design-lint-baseline.json`});
  }
  return {violations,emoji};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  const root=path.resolve(process.argv[2]??'.');
  const {violations,emoji}=lintDesign(root);
  const byRule={};for(const x of violations)byRule[x.rule]=(byRule[x.rule]??0)+1;
  for(const x of violations)console.log(`${x.file}:${x.line} [${x.rule}] ${x.msg}`);
  console.log(`\n${violations.length} violação(ões) ${JSON.stringify(byRule)}; emoji em código: ${Object.values(emoji).reduce((a,b)=>a+b,0)} em ${Object.keys(emoji).length} arquivo(s)`);
  process.exit(violations.length?1:0);
}

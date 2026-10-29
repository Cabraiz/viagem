// Privacy policy pages, one per language, built from scripts/privacy/texts/<code>.md (the Portuguese one is the
// original; every other is a faithful translation of it). Run `node scripts/privacy/build.mjs` after editing a text;
// `--check` fails when a page in public/ is stale. Static pages: no script, system fonts only.
//
// URLs: /privacidade/ (pt-BR, the one in AdSense), /privacy/ (en, x-default), /privacidad/, /confidentialite/,
// /datenschutz/; every other language (Italian included) lives in /privacy/<code in lower case>/.
//
// Text format: `key: value` header lines, a `---` line, then blocks: `## heading`, `- list item` or a paragraph
// (one line each). Inline: **bold**, `code`, [text](link key), {email}, {issues}, {site}.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SITE='https://viagem.cyou';
export const EMAIL='contact@cabraiz.com';
export const UPDATED='2026-10-28';
export const ORDER=['pt-BR','en','es','fr','de','it','ja','ru','hi','bn','ta','te','mr','ur','gu','kn','ml','pa',
  'zh-Hans','zh-Hant','ko','ar','id','tr','vi','th','pl','nl','uk','fil','fa','ms','sw','sv','el','cs','ro','hu','he'];
export const RTL=new Set(['ar','ur','fa','he']);
const FIXED={'pt-BR':'/privacidade/',en:'/privacy/',es:'/privacidad/',fr:'/confidentialite/',de:'/datenschutz/'};
export const pathOf=code=>FIXED[code]??`/privacy/${code.toLowerCase()}/`;

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const TEXTS=fileURLToPath(new URL('./texts/',import.meta.url));
const GOOGLE_HL={'zh-Hans':'zh-CN','zh-Hant':'zh-TW'};
const GITHUB_DOCS=new Set(['pt','es','ja','ru','fr','ko','de','zh']);

export function readText(code){
  const raw=fs.readFileSync(path.join(TEXTS,`${code}.md`),'utf8').replace(/\r\n/g,'\n');
  const cut=raw.indexOf('\n---\n');
  if(cut<0)throw new Error(`${code}: missing --- line`);
  const meta={};
  for(const line of raw.slice(0,cut).split('\n')){
    const m=/^(\w+):\s*(.*)$/.exec(line);
    if(m)meta[m[1]]=m[2].trim();
  }
  for(const key of ['name','title','description','updated','back'])if(!meta[key])throw new Error(`${code}: missing ${key}`);
  const blocks=raw.slice(cut+5).split('\n').map(l=>l.trim()).filter(Boolean);
  return {code,...meta,blocks};
}

function links(code){
  const base=code.split('-')[0];
  const gh=GITHUB_DOCS.has(base)?base:'en';
  return {
    github:`https://docs.github.com/${gh}/site-policy/privacy-policies/github-general-privacy-statement`,
    cloudflare:code==='pt-BR'?'https://www.cloudflare.com/pt-br/privacypolicy/':'https://www.cloudflare.com/privacypolicy/',
    partners:`https://policies.google.com/technologies/partner-sites?hl=${GOOGLE_HL[code]??code}`,
    adsettings:'https://adssettings.google.com/',
    aboutads:'https://www.aboutads.info/choices/',
    anpd:'https://www.gov.br/anpd/',
  };
}

const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function inline(text,code){
  const urls=links(code);
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\[([^\]]+)\]\((\w+)\)/g,(all,label,key)=>{
      if(!urls[key])throw new Error(`${code}: unknown link ${key}`);
      return `<a href="${urls[key]}" rel="noopener">${label}</a>`;
    })
    .replace(/\{email\}/g,`<a href="mailto:${EMAIL}">${EMAIL}</a>`)
    .replace(/\{issues\}/g,'<a href="https://github.com/Cabraiz/viagem/issues" rel="noopener">github.com/Cabraiz/viagem/issues</a>')
    .replace(/\{site\}/g,`<a href="${SITE}/">viagem.cyou</a>`);
}

function body(t){
  const out=[];
  let list=false;
  for(const block of t.blocks){
    const item=block.startsWith('- ');
    if(list&&!item){out.push('    </ul>');list=false;}
    if(block.startsWith('## ')){
      if(out.length)out.push('');
      out.push(`    <h2>${inline(block.slice(3),t.code)}</h2>`);
    }else if(item){
      if(!list){out.push('    <ul>');list=true;}
      out.push(`      <li>${inline(block.slice(2),t.code)}</li>`);
    }else out.push(`    <p>${inline(block,t.code)}</p>`);
  }
  if(list)out.push('    </ul>');
  return out.join('\n');
}

const CSS=`*{box-sizing:border-box}body{margin:0;background:#f6f0df;color:#554963;font:16px/1.6 system-ui,sans-serif}main{max-width:780px;padding:36px 20px 48px;margin:auto}a{color:#786494}a:focus-visible,summary:focus-visible{outline:3px solid #7c559c;outline-offset:3px}header{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:30px}.logo{font-size:28px;font-weight:900;text-decoration:none;letter-spacing:-1px}.langs{position:relative}.langs summary{list-style:none;cursor:pointer;font-size:13px;background:#ece3f2;border:1px solid #d4c5df;padding:6px 12px;border-radius:20px;white-space:nowrap}.langs summary::-webkit-details-marker{display:none}.langs summary::after{content:" ▾"}.langs[open] summary::after{content:" ▴"}.langs ul{position:absolute;z-index:2;top:calc(100% + 8px);inset-inline-end:0;width:min(360px,calc(100vw - 28px));max-height:min(70vh,560px);overflow:auto;margin:0;padding:8px;list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:0 4px;align-content:start;background:#fffcf4;border:2px solid #b3a1c6;border-radius:14px;box-shadow:0 5px 0 #d8cbdc}.langs li{margin:0}.langs ul a{display:block;padding:7px 10px;border-radius:8px;text-decoration:none;color:#554963}.langs ul a:hover{background:#f1eadb}.langs ul a[aria-current]{background:#ece3f2;font-weight:700}h1{font:700 clamp(27px,6vw,38px)/1.15 Georgia,serif;margin:0 0 8px}.updated{margin:0 0 24px;font-size:13px;color:#93859a}.panel{padding:24px 28px;border:2px solid #b3a1c6;border-radius:18px;background:#fffcf4;box-shadow:0 5px 0 #d8cbdc}h2{font-size:18px;margin:28px 0 6px;color:#6d5a82}h2:first-child{margin-top:0}p,li{color:#6f6278}ul{margin:6px 0 14px;padding:0;padding-inline-start:22px}li{margin:4px 0}code{font-size:13px;background:#f1eadb;padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}.note{margin:18px 0 0;font-size:13px;color:#93859a}.back{display:inline-block;padding:14px 0 0;font-size:14px}@media(max-width:420px){main{padding:22px 14px 36px}.panel{padding:18px}header{margin-bottom:22px}}`;

export function page(t,all){
  const dir=RTL.has(t.code)?' dir="rtl"':'';
  const alt=all.map(o=>`  <link rel="alternate" hreflang="${o.code}" href="${SITE}${pathOf(o.code)}">`);
  alt.push(`  <link rel="alternate" hreflang="x-default" href="${SITE}${pathOf('en')}">`);
  const menu=all.map(o=>`      <li><a href="${pathOf(o.code)}" lang="${o.code}" hreflang="${o.code}"${o.code===t.code?' aria-current="page"':''}>${esc(o.name)}</a></li>`);
  const note=t.note?`\n  <p class="note">${inline(t.note,t.code)}</p>`:'';
  return `<!doctype html>
<html lang="${t.code}"${dir}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#81709f">
  <meta name="description" content="${esc(t.description).replace(/"/g,'&quot;')}">
  <title>viagem · ${esc(t.title)}</title>
  <link rel="canonical" href="${SITE}${pathOf(t.code)}">
${alt.join('\n')}
  <link rel="icon" href="/favicon.svg">
  <style>
    ${CSS}
  </style>
</head>
<body>
<main data-build="viagem-privacidade-v2">
  <header><a class="logo" href="/">viagem</a><details class="langs"><summary>🌐 ${esc(t.name)}</summary>
    <ul>
${menu.join('\n')}
    </ul>
  </details></header>
  <h1>${esc(t.title)}</h1>
  <p class="updated"><time datetime="${UPDATED}">${esc(t.updated)}</time></p>
  <article class="panel">
${body(t)}
  </article>${note}
  <a class="back" href="/">${esc(t.back)}</a>
</main>
</body>
</html>
`;
}

export function sitemap(all){
  const urls=['/',...all.map(t=>pathOf(t.code))];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u=>`  <url><loc>${SITE}${u}</loc></url>`).join('\n')}
</urlset>
`;
}

/** Every generated file, keyed by its path under public/. Languages without a text yet are skipped. */
export function buildAll(){
  const all=ORDER.filter(code=>fs.existsSync(path.join(TEXTS,`${code}.md`))).map(readText);
  const files=new Map();
  for(const t of all)files.set(`${pathOf(t.code).slice(1)}index.html`,page(t,all));
  files.set('sitemap.xml',sitemap(all));
  return files;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const check=process.argv.includes('--check');
  let stale=0;
  for(const [rel,html] of buildAll()){
    const file=path.join(ROOT,'public',rel);
    const old=fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
    if(old===html)continue;
    stale++;
    if(check){console.error(`stale: public/${rel}`);continue;}
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,html);
    console.log(`wrote public/${rel}`);
  }
  if(check&&stale)process.exit(1);
}

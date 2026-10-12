/**
 * Human report of an art v2 import (NEW-20261012-ORQ-importador-arte-a): one self-contained HTML file in pt-BR that a
 * non-technical artist opens by double-click, on desktop or phone. No external requests: CSS is inline and thumbnails
 * are data URIs. Every piece of text coming from results (ids, file names, messages) is escaped.
 */
import {GROUPS} from './spec.mjs';

/** @typedef {import('./spec.mjs').PieceResult} PieceResult */

const STATUS_ORDER={reprovado:0,aprovado:1,pendente:2};
const BADGES={
  aprovado:{cls:'ok',text:'✔ aprovada'},
  reprovado:{cls:'bad',text:'✖ reprovada'},
  pendente:{cls:'wait',text:'… pendente'},
};
const FIX_HINT='Corrija as peças reprovadas e rode o importador de novo; o que já foi aprovado não precisa ser reenviado.';
const PENDING_TEXT='Ainda não entregues — o jogo continua com a arte atual:';
const DRY_RUN_TEXT='Simulação — nada foi gravado. Os arquivos abaixo mostram o que seria gravado no jogo.';

const ESCAPES={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
/** Escapes text for HTML content and double-quoted attributes. */
export function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>ESCAPES[ch]);
}

/** @param {PieceResult[]} pieces @returns {{aprovadas:number,reprovadas:number,pendentes:number}} */
export function summarize(pieces){
  const totals={aprovadas:0,reprovadas:0,pendentes:0};
  for(const piece of pieces??[]){
    if(piece.status==='aprovado')totals.aprovadas++;
    else if(piece.status==='reprovado')totals.reprovadas++;
    else if(piece.status==='pendente')totals.pendentes++;
  }
  return totals;
}

const pad=n=>String(n).padStart(2,'0');
/** Local date/time as "12/10/2026 às 14:05" (no dependency on the runtime's ICU data). */
function formatDateTime(date){
  const d=date instanceof Date?date:new Date(date);
  if(Number.isNaN(d.getTime()))return escapeHtml(String(date));
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const plural=(n,one,many)=>`${n} ${n===1?one:many}`;

/** Only inline raster images are embedded, so the report never makes a request. */
const safeThumb=thumb=>typeof thumb==='string'&&/^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=\s]+$/.test(thumb)?thumb:null;

const codes=list=>list.map(f=>`<code>${escapeHtml(f)}</code>`).join(', ');
const notesOf=piece=>(Array.isArray(piece.notes)?piece.notes:[]).filter(n=>typeof n==='string'&&n);
const renderNotes=notes=>notes.length?`<ul class="notes">${notes.map(n=>`<li>${escapeHtml(n)}</li>`).join('')}</ul>`:'';

function renderPiece(piece,{dryRun}){
  const badge=BADGES[piece.status]??BADGES.pendente;
  const parts=[`<li class="piece ${badge.cls}">`,
    `<div class="piece-head"><span class="badge ${badge.cls}">${badge.text}</span><span class="piece-id">${escapeHtml(piece.id)}</span></div>`];
  const notes=renderNotes(notesOf(piece));
  if(piece.status==='reprovado'){
    const thumb=safeThumb(piece.thumb);
    parts.push('<div class="piece-body">');
    if(thumb)parts.push(`<img class="thumb" src="${escapeHtml(thumb)}" alt="Miniatura de ${escapeHtml(piece.id)}">`);
    parts.push('<div class="details">');
    if(piece.source)parts.push(`<p class="source">Arquivo: <code>${escapeHtml(piece.source)}</code></p>`);
    const problems=piece.problems?.length?piece.problems:['Peça reprovada sem detalhes do problema.'];
    parts.push('<ul class="problems">',...problems.map(p=>`<li>${escapeHtml(p)}</li>`),'</ul>',notes);
    parts.push('</div></div>');
  }else if(piece.status==='aprovado'){
    const outputs=Array.isArray(piece.outputs)?piece.outputs:[];
    if(!outputs.length)parts.push('<p class="files">Aprovada.</p>');
    else if(dryRun)parts.push(`<p class="files">${outputs.length===1?'Seria gravado':'Seriam gravados'}: ${codes(outputs)}</p>`);
    else parts.push(`<p class="files">${plural(outputs.length,'arquivo gravado','arquivos gravados')}: ${codes(outputs)}</p>`);
    parts.push(notes);
  }else parts.push(notes);
  parts.push('</li>');
  return parts.join('');
}

function renderGroup(title,pieces,options){
  const sorted=[...pieces].sort((a,b)=>(STATUS_ORDER[a.status]??3)-(STATUS_ORDER[b.status]??3)||String(a.id).localeCompare(String(b.id),'pt-BR'));
  const t=summarize(pieces);
  const counts=[t.reprovadas&&`${t.reprovadas} reprovada${t.reprovadas===1?'':'s'}`,t.aprovadas&&`${t.aprovadas} aprovada${t.aprovadas===1?'':'s'}`,
    t.pendentes&&`${t.pendentes} pendente${t.pendentes===1?'':'s'}`].filter(Boolean).join(' · ');
  // Pending pieces (groups with a known list) go in one line; those carrying notes also get their own entry.
  const pending=sorted.filter(p=>p.status==='pendente');
  const listed=sorted.filter(p=>p.status!=='pendente'||notesOf(p).length);
  const pendingLine=pending.length?`<p class="pending">${PENDING_TEXT} ${codes(pending.map(p=>String(p.id)))}</p>`:'';
  const items=listed.length?`<ul class="pieces">${listed.map(p=>renderPiece(p,options)).join('')}</ul>`:'';
  return `<section class="category"><h2>${escapeHtml(title)}</h2><p class="cat-counts">${counts}</p>${items}${pendingLine}</section>`;
}

const CSS=`
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--text:#1d1d1f;--muted:#5c5c66;--border:#dddad3;
--ok:#1a7f37;--ok-bg:#e3f4e8;--bad:#c62828;--bad-bg:#fde8e8;--wait:#5f6368;--wait-bg:#ececec;--code-bg:#f0eee9;}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1f1f23;--text:#ececf0;--muted:#a8a8b3;--border:#34343b;
--ok:#4cc26a;--ok-bg:#16301e;--bad:#ff6b6b;--bad-bg:#3a1a1a;--wait:#b0b0b8;--wait-bg:#2c2c31;--code-bg:#2a2a30;}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
main{max-width:860px;margin:0 auto;padding:16px}
h1{font-size:1.6rem;line-height:1.25;margin:8px 0 4px}
h2{font-size:1.25rem;margin:0 0 2px}
.when{color:var(--muted);margin:0 0 12px}
.totals{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px;padding:0;list-style:none}
.totals li{flex:1 1 96px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card)}
.totals strong{display:block;font-size:1.6rem;line-height:1.1}
.totals .ok strong{color:var(--ok)}.totals .bad strong{color:var(--bad)}.totals .wait strong{color:var(--wait)}
.hint{margin:0 0 20px;padding:12px 14px;border-radius:10px;background:var(--card);border-left:4px solid var(--bad)}
.category{margin:0 0 20px;padding:14px;border-radius:12px;background:var(--card);border:1px solid var(--border)}
.cat-counts{color:var(--muted);margin:0 0 10px}
.pieces{list-style:none;margin:0;padding:0}
.piece{padding:10px 0;border-top:1px solid var(--border)}
.piece-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.piece-id{font-weight:600}
.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;white-space:nowrap}
.badge.ok{color:var(--ok);background:var(--ok-bg)}.badge.bad{color:var(--bad);background:var(--bad-bg)}.badge.wait{color:var(--wait);background:var(--wait-bg)}
.piece-body{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.thumb{max-width:min(256px,100%);min-width:min(96px,100%);height:auto;align-self:flex-start;border-radius:8px;border:1px solid var(--border);
background:repeating-conic-gradient(#8883 0 25%,transparent 0 50%) 0 0/16px 16px;image-rendering:pixelated}
.details{flex:1 1 220px;min-width:0}
.source,.files,.pending{margin:6px 0 0}
.notes{margin:6px 0 0;padding-left:20px;color:var(--muted)}
.banner{margin:0 0 12px;padding:12px 14px;border-radius:10px;background:var(--wait-bg);border-left:4px solid var(--wait);font-weight:600}
.thumb-note{color:var(--muted);margin:0 0 20px}
.pending{color:var(--muted)}
.problems{margin:6px 0 0;padding-left:20px}
.problems li{margin:4px 0}
code{font:inherit;font-family:ui-monospace,Consolas,monospace;background:var(--code-bg);padding:0 4px;border-radius:4px}
`;

/**
 * @param {PieceResult[]} pieces
 * @param {{generatedAt?:Date,title?:string,dryRun?:boolean,thumbsOmitted?:number}} [options] `dryRun`: nothing was
 *   written (banner, "seria gravado"); `thumbsOmitted`: refused pieces left without a thumbnail to keep the file small.
 * @returns {string} a complete HTML document
 */
export function renderReport(pieces,{generatedAt=new Date(),title='Importação da arte v2',dryRun=false,thumbsOmitted=0}={}){
  const list=pieces??[];
  thumbsOmitted=Math.max(0,Math.floor(Number(thumbsOmitted))||0);
  const totals=summarize(list);
  const byGroup=new Map();
  for(const piece of list){
    if(!byGroup.has(piece.group))byGroup.set(piece.group,[]);
    byGroup.get(piece.group).push(piece);
  }
  const order=[...Object.keys(GROUPS).filter(c=>byGroup.has(c)),...[...byGroup.keys()].filter(c=>!(c in GROUPS))];
  const sections=order.map(c=>renderGroup(GROUPS[c]?.title??c,byGroup.get(c),{dryRun})).join('\n');
  const when=formatDateTime(generatedAt);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(title)}</h1>
<p class="when">Gerado em ${when}</p>
${dryRun?`<p class="banner">${DRY_RUN_TEXT}</p>`:''}
<ul class="totals">
<li class="ok"><strong>${totals.aprovadas}</strong>${totals.aprovadas===1?'aprovada':'aprovadas'}</li>
<li class="bad"><strong>${totals.reprovadas}</strong>${totals.reprovadas===1?'reprovada':'reprovadas'}</li>
<li class="wait"><strong>${totals.pendentes}</strong>${totals.pendentes===1?'pendente':'pendentes'}</li>
</ul>
<p class="hint"><strong>Como corrigir:</strong> ${FIX_HINT}</p>
${thumbsOmitted>0?`<p class="thumb-note">Miniaturas só nas primeiras peças reprovadas; ${plural(thumbsOmitted,'peça reprovada aparece','peças reprovadas aparecem')} sem miniatura para o relatório não ficar pesado.</p>`:''}
</header>
${sections||'<p>Nenhuma peça encontrada.</p>'}
</main>
</body>
</html>
`;
}

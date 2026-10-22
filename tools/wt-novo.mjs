// BUG-20261022-ORQ-disco-cheio-guarda: the executor's worktree (PROTOCOLO.md §1.4) in one command, refused when the drive
// has less than 25 GB free (the Orquestrador gets a note in his inbox; above 85% of use, a warning):
//   node tools/wt-novo.mjs <nome> [--branch vgm/<nome>] [--de origin/main] [--repo <main checkout>] [--board <board>] [--wt <root>]
// It makes D:/Gits/viagem-wt/<nome> on a new branch and links node_modules and backend/node_modules to the main checkout
// (junctions; tools/wt-rm.mjs drops them before any removal).
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {exigeEspaco} from './wt-guarda.mjs';
import {JUNCTIONS,mainCheckoutOf} from './wt-rm.mjs';

/** Creates the worktree (after the space check); returns its folder. Throws when the drive is short or git fails. */
export function novaWorktree(nome,{repo,board,wt,branch=`vgm/${nome}`,de='origin/main',modules=true,fake}={}){
  const dir=join(wt??join(repo,'..','viagem-wt'),nome);
  if(existsSync(dir))throw new Error(`${dir} já existe`);
  exigeEspaco(board??join(repo,'..','viagem-board'),dir,`a worktree ${nome}`,{fake});
  spawnSync('git',['fetch','-q','origin'],{cwd:repo});
  const r=spawnSync('git',['worktree','add','-b',branch,dir,de],{cwd:repo,encoding:'utf8'});
  if(r.status!==0)throw new Error(`git worktree add falhou: ${(r.stderr||r.stdout).trim()}`);
  if(modules&&process.platform==='win32')for(const j of JUNCTIONS){
    const src=join(repo,j);if(!existsSync(src)||!existsSync(dirname(join(dir,j))))continue;
    spawnSync('cmd',['/c','mklink','/J',join(dir,j),src],{stdio:'ignore'});
  }
  return dir;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const a=process.argv.slice(2),val=(k)=>{const i=a.indexOf(k);return i>=0?a[i+1]:undefined;};
  const nome=a.find((x,i)=>!x.startsWith('--')&&!a[i-1]?.startsWith('--'));
  if(!nome){console.error('uso: node tools/wt-novo.mjs <nome> [--branch vgm/<nome>] [--de origin/main]');process.exit(2);}
  try{
    const repo=resolve(val('--repo')??mainCheckoutOf(resolve(dirname(fileURLToPath(import.meta.url)),'..')));
    const dir=novaWorktree(nome,{repo,board:val('--board'),wt:val('--wt'),branch:val('--branch'),de:val('--de')});
    console.log(`worktree: ${dir.replace(/\\/g,'/')}`);
  }catch(e){console.error(`[wt-novo] ${e.message}`);process.exit(1);}
}

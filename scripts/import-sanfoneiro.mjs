// Sanfoneiro import (NEW-20261030-ORQ-sanfoneiro-brinquedo-no-jogo): the wooden toy accordion player's sheets (body +
// real cast shadow, one row per direction S, SW, W, NW, N, NE, E, SE, `dirFrames` per row) into the enemies group, the
// same way as the saci (scripts/import-saci.mjs importAnim: every row on one ground line, body and shadow together).
//   node scripts/import-sanfoneiro.mjs [--from <folder with sanfoneiro-<anim>-8dir.png/-sombra.png/.json>]
// idle is required; walk, attack (the fole: the client plays 'attack' when his hit lands, art/horde-actions.ts
// CONTACT_REACH) and death are imported when present. Not elite-only (no meta.eliteArt). Writes
// public/art/enemies/sanfoneiro/, the piece `sanfoneiro` in public/art/enemies/manifest.json, the client index and the
// enemy art ids. Run `node scripts/art-lite.mjs --kinds enemies,enemies-pc` after it.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {GROUPS} from './art-v2/spec.mjs';
import {writeIndex} from './art-v2/convert.mjs';
import {writeEnemyArtIds} from './art-v2/enemy-art-ids.mjs';
import {importAnim} from './import-saci.mjs';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export const SANFONEIRO_ID='sanfoneiro';
export const SANFONEIRO_ANIMS=['idle','walk','attack','death'];
const FROM_DEFAULT='D:/Gits/viagem-board/evidence/NEW-20261029-ORQ-sanfoneiro-arrasta-pe/folhas/final';
const MANIFEST=join(ROOT,'public/art/enemies/manifest.json');
const sha256=s=>createHash('sha256').update(s).digest('hex');
const WHO={prefix:SANFONEIRO_ID,dir:SANFONEIRO_ID};

export async function importSanfoneiro(from=FROM_DEFAULT){
  let ground;const files={};
  for(const anim of SANFONEIRO_ANIMS){
    if(!existsSync(join(from,`${SANFONEIRO_ID}-${anim}-8dir.png`)))continue;
    const r=await importAnim(from,anim,ground,WHO);ground=r.ground;Object.assign(files,r.files);
  }
  if(!files.idle)throw new Error(`sem ${SANFONEIRO_ID}-idle-8dir.png em ${from}`);
  const manifest=JSON.parse(readFileSync(MANIFEST,'utf8'));
  const piece={kind:'animations',files,sha256:sha256(Object.entries(files).map(([k,f])=>`${k} ${f.sha256}`).sort().join('\n'))};
  manifest.pieces=Object.fromEntries(Object.entries({...manifest.pieces,[SANFONEIRO_ID]:piece}).sort(([a],[b])=>a.localeCompare(b)));
  writeFileSync(MANIFEST,JSON.stringify(manifest,null,2)+'\n');
  await writeIndex({inimigos:GROUPS.inimigos},{outRoot:ROOT});
  await writeEnemyArtIds({outRoot:ROOT});
  return piece;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const i=process.argv.indexOf('--from');
  await importSanfoneiro(i<0?undefined:process.argv[i+1]);
}

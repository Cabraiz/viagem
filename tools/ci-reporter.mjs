/**
 * node:test reporter for the CI shards (.github/workflows/ci.yml): writes one JSON
 * {failed:[test files with a failing test], durations:{file: ms of its top-level tests}}
 * to its --test-reporter-destination. tools/ci.mjs report turns it into annotations (ci-failed / ci-ok / ci-timings).
 */
import path from 'node:path';

const rel=file=>{
  const f=file.startsWith('file:')?new URL(file).pathname.replace(/^\/([A-Za-z]:)/,'$1'):file;
  return path.relative(process.cwd(),f).replace(/\\/g,'/');
};

export default async function* ciReporter(source){
  const failed=new Set(),durations={};
  for await(const ev of source){
    const d=ev.data;
    if(!d?.file||(ev.type!=='test:pass'&&ev.type!=='test:fail'))continue;
    const file=rel(d.file);
    if(ev.type==='test:fail'&&!d.todo)failed.add(file);
    if(d.nesting===0)durations[file]=Math.round((durations[file]??0)+(d.details?.duration_ms??0));
  }
  yield JSON.stringify({failed:[...failed].sort(),durations});
}

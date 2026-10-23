#!/usr/bin/env node
/**
 * Sound effects made by TangoFlux (card NEW-20261022-ORQ-sons-ia-ace-step) into public/audio/sfx/: one .webm (Opus) and
 * one .m4a (AAC, Safari's) per `<name>.final.wav` of the generator's folder, each at the same loudness.
 *
 *   node scripts/import-sfx.mjs [source dir] [--only id,id]
 *
 * Source: D:/Gits/ferramentas/sons-ia/sfx (lista_sons.py, montar_pagina.py already trimmed, faded and peaked them).
 * Loudness: a clip of 0.2 s has no integrated loudness (400 ms blocks), so the loudest momentary (400 ms) window of the
 * clip padded with silence is brought to TARGET_LUFS, never past PEAK_DB of true peak (a quiet click stays quiet rather
 * than clip). Writes public/audio/sfx/index.json: file → seconds, bytes and the gain applied.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,statSync,writeFileSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const OUT=join(ROOT,'public/audio/sfx');
export const TARGET_LUFS=-16;
export const PEAK_DB=-1;
const OPUS_KBPS=48,AAC_KBPS=64;

/** The loudest momentary loudness (LUFS) and the true peak (dBFS) in ffmpeg's ebur128 log. */
export function parseLoudness(log){
  let momentary=-Infinity;
  for(const m of log.matchAll(/M:\s*(-?[\d.]+)/g))momentary=Math.max(momentary,Number(m[1]));
  const peak=[...log.matchAll(/Peak:\s*(-?[\d.]+|-inf) dBFS/g)].pop();
  return {momentary,peak:peak&&peak[1]!=='-inf'?Number(peak[1]):-Infinity};
}
/** dB of gain: up or down to the target loudness, capped so the true peak stays under PEAK_DB. */
export function gainFor({momentary,peak}){
  if(!Number.isFinite(momentary)||!Number.isFinite(peak))return 0;
  return Math.round(Math.min(TARGET_LUFS-momentary,PEAK_DB-peak)*10)/10;
}

function ffmpegLog(args){
  try{execFileSync('ffmpeg',args,{stdio:['ignore','ignore','pipe']});return '';}
  catch(error){throw new Error(String(error.stderr??error));}
}
function main(){
  const args=process.argv.slice(2);
  const onlyAt=args.indexOf('--only');
  const only=onlyAt>=0?new Set(args.splice(onlyAt,2)[1].split(',')):undefined;
  const src=resolve(args[0]??'D:/Gits/ferramentas/sons-ia/sfx');
  if(!existsSync(src))throw new Error(`no source folder ${src}`);
  mkdirSync(OUT,{recursive:true});
  const indexFile=join(OUT,'index.json');
  const index=existsSync(indexFile)?JSON.parse(readFileSync(indexFile,'utf8')):{};
  const names=readdirSync(src).filter(f=>f.endsWith('.final.wav')).map(f=>f.slice(0,-'.final.wav'.length)).sort();
  for(const name of names){
    if(only&&!only.has(name))continue;
    const file=join(src,`${name}.final.wav`);
    const level=parseLoudness(stderrOf(['-hide_banner','-nostats','-i',file,'-af','apad=pad_dur=0.5,ebur128=peak=true:framelog=info','-f','null','-']));
    const gain=gainFor(level);
    const af=`volume=${gain}dB`;
    ffmpegLog(['-y','-hide_banner','-i',file,'-af',af,'-ac','1','-ar','48000','-c:a','libopus','-b:a',`${OPUS_KBPS}k`,'-vbr','on','-application','audio','-map_metadata','-1',join(OUT,`${name}.webm`)]);
    ffmpegLog(['-y','-hide_banner','-i',file,'-af',af,'-ac','1','-ar','44100','-c:a','aac','-b:a',`${AAC_KBPS}k`,'-map_metadata','-1','-movflags','+faststart',join(OUT,`${name}.m4a`)]);
    const seconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8'}).trim());
    index[name]={seconds:Math.round(seconds*1000)/1000,gainDb:gain,lufs:Math.round(level.momentary*10)/10,
      webm:statSync(join(OUT,`${name}.webm`)).size,m4a:statSync(join(OUT,`${name}.m4a`)).size};
    console.log(`${name.padEnd(22)} ${String(gain).padStart(6)} dB  ${index[name].webm} B webm  ${index[name].m4a} B m4a`);
  }
  const sorted=Object.fromEntries(Object.entries(index).sort(([a],[b])=>a.localeCompare(b)));
  writeFileSync(indexFile,JSON.stringify(sorted,null,1)+'\n');
  const total=k=>Object.values(sorted).reduce((s,e)=>s+e[k],0);
  console.log(`${Object.keys(sorted).length} sounds: ${(total('webm')/1024).toFixed(0)} KB webm, ${(total('m4a')/1024).toFixed(0)} KB m4a`);
}

/** ffmpeg's stderr (where ebur128 logs) whether or not it exits 0. */
function stderrOf(args){
  const r=spawnSync('ffmpeg',args,{encoding:'utf8'});
  if(r.error)throw r.error;
  return r.stderr;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

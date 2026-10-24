#!/usr/bin/env node
/**
 * The Uno's car alarm loop (card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 4) from two TangoFlux takes: the siren,
 * a short gap, the horn, a longer gap, into public/audio/sfx/uno-alarme.webm (Opus) and .m4a (AAC, Safari's).
 *
 *   node scripts/import-uno-alarme.mjs [siren take] [horn take] [source dir]
 *
 * Source: D:/Gits/ferramentas/sons-ia/sfx/uno-sirene-<n>.final.wav and uno-buzina-<n>.final.wav (montar_pagina.py lista
 * already trimmed them and faded both ends), so the loop's ends meet at silence: no click at the seam. Same loudness as
 * the other effects (import-sfx.mjs). Not in index.json: it is not a SoundId, src/client/audio/alarm.ts loads it.
 */
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,rmSync,statSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {gainFor,parseLoudness} from './import-sfx.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const OUT=join(ROOT,'public/audio/sfx');
/** Silence after the siren and after the horn (s). */
export const GAP_S=.12,TAIL_S=.35;

function main(){
  const [siren='1',horn='1',dir='D:/Gits/ferramentas/sons-ia/sfx']=process.argv.slice(2);
  const parts=[join(dir,`uno-sirene-${siren}.final.wav`),join(dir,`uno-buzina-${horn}.final.wav`)];
  for(const p of parts)if(!existsSync(p))throw new Error(`no ${p}`);
  const mix=`[0:a]aformat=sample_rates=48000:channel_layouts=mono,apad=pad_dur=${GAP_S}[s];`+
    `[1:a]aformat=sample_rates=48000:channel_layouts=mono,apad=pad_dur=${TAIL_S}[h];[s][h]concat=n=2:v=0:a=1`;
  const loop=join(OUT,'uno-alarme.tmp.wav');
  run(['-y','-hide_banner','-i',parts[0],'-i',parts[1],'-filter_complex',mix,'-c:a','pcm_f32le',loop]);
  const r=spawnSync('ffmpeg',['-hide_banner','-nostats','-i',loop,'-af','ebur128=peak=true:framelog=info','-f','null','-'],{encoding:'utf8'});
  const gain=gainFor(parseLoudness(r.stderr)),af=`volume=${gain}dB`;
  run(['-y','-hide_banner','-i',loop,'-af',af,'-ac','1','-ar','48000','-c:a','libopus','-b:a','48k','-vbr','on','-application','audio','-map_metadata','-1',join(OUT,'uno-alarme.webm')]);
  run(['-y','-hide_banner','-i',loop,'-af',af,'-ac','1','-ar','44100','-c:a','aac','-b:a','64k','-map_metadata','-1','-movflags','+faststart',join(OUT,'uno-alarme.m4a')]);
  const seconds=Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',loop],{encoding:'utf8'}).trim());
  console.log(`uno-alarme ${seconds.toFixed(2)} s, ${gain} dB: ${statSync(join(OUT,'uno-alarme.webm')).size} B webm, ${statSync(join(OUT,'uno-alarme.m4a')).size} B m4a (sirene ${siren}, buzina ${horn})`);
  rmSync(loop);
}
function run(args){
  try{execFileSync('ffmpeg',args,{stdio:['ignore','ignore','pipe']});}
  catch(error){throw new Error(String(error.stderr??error));}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();

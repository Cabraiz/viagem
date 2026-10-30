/**
 * hud.css is a facade of @imports since corte-C4-hud-css (the rules live in hud/css/, one file per section). The tests
 * that read its rules as text get the facade with each @import replaced by its file, in the same cascade order.
 */
import {readFileSync} from 'node:fs';

const HUD_DIR=new URL('../../src/client/hud/',import.meta.url);
export const HUD_CSS=readFileSync(new URL('hud.css',HUD_DIR),'utf8')
  .replace(/@import '\.\/(css\/[\w-]+\.css)';/g,(_,file:string)=>readFileSync(new URL(file,HUD_DIR),'utf8'));

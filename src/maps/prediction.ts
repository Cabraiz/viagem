/**
 * Movement prediction of protocol 3 (one STEP per input): the room moves players with these exact numbers and the
 * phone replays its unacknowledged inputs on top of the room's position (client-side prediction and reconcile).
 */
import {defaultTerrain,type TerrainField} from './terrain/field.ts';
import {moveDirection} from './world.ts';
import type {PlayerInput,Point} from '../contract/index.ts';
type Input=PlayerInput;
export const STEP = 1 / 20;
export function simulate(p:Point,input:Input,terrain:TerrainField=defaultTerrain):Point { return moveDirection(p,{x:input.x,y:input.y},STEP,terrain); }
export function reconcile(authoritative:Point,pending:Input[],terrain:TerrainField=defaultTerrain):Point { return pending.reduce((p,i)=>simulate(p,i,terrain),{...authoritative}); }
export function interpolate(a:Point,b:Point,t:number):Point { const n=Math.max(0,Math.min(1,t));return {x:a.x+(b.x-a.x)*n,y:a.y+(b.y-a.y)*n}; }

/**
 * Q4 · pré-aquecer atrás da contagem (NEW-20261021-ORQ-q4-preaquecer-contagem; design/estudo-desempenho.md §7):
 * - the own hero's 8 walk clips (preloaded by the scene, card preload-heroi-primeiro) are pinned in the shared
 *   Movement128Textures: never evicted by the other heroes' clips, so no lap of the walk fetches and uploads them again;
 * - out of combat (no run, the waiting room, the 3-2-1) the upload queue's per-frame budget is WARMUP_BUDGET_PX, so the
 *   city's art around the spawn and the teammates' sheets go to the GPU before the first step; in combat it is back to
 *   UPLOAD_BUDGET_PX (one big sheet a frame).
 * Returns the stop (scene shutdown): pins dropped, budget back to the combat one.
 */
import type Phaser from 'phaser';
import {HERO_DIRECTIONS} from '../sprites/sprite-motion.ts';
import {movement128Plan} from '../sprites/movement128.ts';
import {movement128Textures} from '../sprites/movement128-textures.ts';
import {UPLOAD_BUDGET_PX,WARMUP_BUDGET_PX,setUploadBudget} from './upload-queue.ts';

/** The upload budget for the run's phase: the combat one only while fighting. */
export const warmBudget=(phase:string|undefined)=>phase==='combat'?UPLOAD_BUDGET_PX:WARMUP_BUDGET_PX;
/** The own hero's walk plans (the 8 directions the scene preloads). */
export const ownWalkPlans=(classId:string)=>HERO_DIRECTIONS.flatMap(d=>{const p=movement128Plan(classId,'walk',d);return p?[p]:[];});

export function startWarmUp(scene:Phaser.Scene,classId:string,phase:()=>string|undefined):()=>void{
  const cache=movement128Textures(scene),plans=ownWalkPlans(classId);
  for(const plan of plans)cache.pin(plan);
  const step=()=>setUploadBudget(warmBudget(phase()));
  step();
  scene.events.on('update',step);
  return ()=>{
    scene.events.off('update',step);
    for(const plan of plans)cache.unpin(plan.key);
    setUploadBudget(UPLOAD_BUDGET_PX);
  };
}

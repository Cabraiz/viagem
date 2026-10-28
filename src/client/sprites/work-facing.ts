/**
 * Card animacao-trabalhar-6: a hero on a bico's shift (RunView.banks workers) stays in the shop's ring and plays its
 * work16 loop instead of going in through the door. The shop stands behind the ring with its door to the camera (in any
 * of the 4 turns, bico-art.ts frontNormal), so the hero turns its back to the door and faces the camera: the street is
 * its customer, and its gag reads from the front. The sim does not change (inside the shift it neither fires nor is hit).
 */
import {frontNormal} from '../render/bancos/bico-art.ts';

/** The world direction a working hero faces in camera turn `view`: away from the shop, down the screen. */
export const workFacing=(view:number):{x:number;y:number;work:true}=>({...frontNormal(view,1),work:true});

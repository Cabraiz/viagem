/**
 * The scene's one terrain (cidade-04 review #4). The camera, the projection, the ground, the props and the local walk
 * all read the same field; when the net's terrain becomes another WORLD (a lobby map switch, {t:'map'}, or a reconnect
 * welcome into a room that switched maps meanwhile) the scene adopts it whole and re-fits.
 *
 * "Another world" is the kind and the signature, never the object: terrainFor builds a new TerrainField on every
 * island/endless welcome, and a plain reconnect to the same map must not snap the camera or rebuild the ground.
 */
import type {TerrainField} from '../maps/index.ts';
import {followWorld,worldZoom,type FollowWorld,type Viewport} from './framing.ts';

/** What tells two terrains apart for the scene. */
export type WorldIdentity=Pick<TerrainField,'world'|'signature'>;
export const sameWorld=(a:WorldIdentity,b:WorldIdentity)=>a.world===b.world&&a.signature===b.signature;

/** What fit() gives a world: the follow zoom and the follow camera's world (scale, hero speed). */
export interface WorldCamera {zoom:number;follow:FollowWorld}
export function worldCamera(viewport:Viewport,terrain:TerrainField):WorldCamera{
  return {zoom:worldZoom(viewport,terrain),follow:followWorld(terrain)};
}

/**
 * Holds the scene's field and watches the net's. `sync` is cheap every frame (an identity check first); it returns the
 * new field only when the net's terrain is another world, after adopting it, so the caller swaps and re-fits once.
 */
export class SceneTerrain<T extends WorldIdentity> {
  field:T;
  private seen?:T;
  constructor(field:T){this.field=field;this.seen=field;}
  sync(net:T|undefined):T|undefined{
    if(!net||net===this.seen)return undefined;
    this.seen=net;
    if(sameWorld(this.field,net))return undefined;
    this.field=net;return net;
  }
}

/**
 * Where the game downloads its sheets (N27): the lossy copies under /art/lite (scripts/art-lite.mjs, quality kept in
 * scripts/art-lite.json), ~40% of the approved lossless files, which stay where they are and are never changed.
 */
export const treeUrl=(id:string)=>`/art/lite/trees/${id}.webp`;
/** A class's approved sheet, or its 4-direction atlas (`<id>.dir4.webp`, docs/sprite-directions.md). */
export const spriteUrl=(id:string,dir4=false)=>`/art/lite/sprites/${id}${dir4?'.dir4':''}.webp`;
/** Small portrait (256 px): the stand-in a hero shows until its sheet is in, and the room's class icons. */
export const thumbUrl=(classId:string)=>`/art/portraits/${classId}-thumb.webp`;

declare module '*.css';
/** Vite's static flag (true on the dev server, false in builds). */
interface ImportMeta {readonly env:{readonly DEV:boolean}}
/** Vite raw import (the icon sprite, src/ui/icon-sprite.ts). */
declare module '*.svg?raw' {const content:string;export default content;}

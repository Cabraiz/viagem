declare module '*.css';
/** Vite's static flag (true on the dev server, false in builds). */
interface ImportMeta {readonly env:{readonly DEV:boolean}}
/** Vite raw import (the icon sprite, src/client/ui/icon-sprite.ts). */
declare module '*.svg?raw' {const content:string;export default content;}
/** This build's id (vite.config.ts): the deploy's short commit, or 'dev-…' outside CI. */
declare const __BUILD_ID__:string;

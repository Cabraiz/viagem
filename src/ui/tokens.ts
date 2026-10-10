/**
 * Design tokens for canvas text (Phaser cannot read CSS variables): values come from src/ui/tokens.css at runtime,
 * so the map labels use the same families and colors as the DOM. Fallbacks only cover a missing stylesheet (tests).
 */
const FALLBACK:Readonly<Record<string,string>>={
  '--f-cartaz':"'Londrina Solid',sans-serif",'--f-sistema':"'M PLUS Rounded 1c',sans-serif",
  '--c-breu':'#1E1530','--c-papel':'#EEDDB8','--c-lilas':'#5B3F8C',
};
export function token(name:keyof typeof FALLBACK|string):string{
  const value=typeof document!=='undefined'?getComputedStyle(document.documentElement).getPropertyValue(name).trim():'';
  return value||FALLBACK[name]||'';
}
/** Re-renders canvas texts once the served fonts are in, so a label drawn before the swap does not keep the fallback. */
export function whenFontsReady(redraw:()=>void){
  const fonts=typeof document!=='undefined'?document.fonts:undefined;
  if(fonts&&fonts.status!=='loaded')void fonts.ready.then(redraw);
}

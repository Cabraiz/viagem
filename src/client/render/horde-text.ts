/**
 * The horde layer's text looks (render/layers.ts): damage, crit, hurt, balloon and tag styles, the comic palette read
 * from the design tokens, the kill pops' per-kind styles and the one-upload text painter. Moved out of layers.ts as is.
 */
import type Phaser from 'phaser';
import {kindStyle,styleKey} from './jokes.ts';
import {token,tokenColor} from '../ui/tokens.ts';

type Text=Phaser.GameObjects.Text;
type TextStyle=Phaser.Types.GameObjects.Text.TextStyle;

export const FONT='system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
export const DAMAGE_STYLE:TextStyle={fontFamily:FONT,fontSize:'24px',fontStyle:'900',color:'#ffffff',stroke:'#2b2233',strokeThickness:5};
export const CRIT_STYLE:TextStyle={fontFamily:FONT,fontSize:'32px',fontStyle:'900',color:'#ffd84a',stroke:'#3a2440',strokeThickness:6};
export const HURT_STYLE:TextStyle={fontFamily:FONT,fontSize:'26px',fontStyle:'900',color:'#ff6b6b',stroke:'#2b1620',strokeThickness:5};
export const BUBBLE_STYLE:TextStyle={fontFamily:FONT,fontSize:'20px',fontStyle:'700',color:'#51425e',backgroundColor:'#fff8ec',padding:{x:10,y:6},align:'center',wordWrap:{width:280}};
/**
 * Palette of the comic layer on the light tropical scene (D-022, DSG-contraste-mapa): every number and balloon is a
 * light body with a Breu edge (double-edge rule). Read from src/client/ui/tokens.css once the first renderer exists, since
 * Phaser cannot read CSS variables; the hex in PALETTE are the same token values, kept for a page without the stylesheet.
 */
/** The red tag over a player marked by the agiota's boleto (say key 'devendo', D-033): Papel letters on a red body. */
export const TAG_STYLE:TextStyle={fontFamily:FONT,fontSize:'20px',fontStyle:'900',color:'#fff8ec',padding:{x:10,y:5},align:'center'};
export const TAG_RED=0xd2392f;
export const PALETTE={breu:0x1e1530,papel:0xeeddb8,cone:0xff7a1f};
let paletteReady=false;
export function applyPalette(){
  if(paletteReady||typeof document==='undefined')return;
  paletteReady=true;
  const breu=token('--c-breu');
  DAMAGE_STYLE.color=token('--c-papel');DAMAGE_STYLE.stroke=breu;
  CRIT_STYLE.color=token('--c-amarelo');CRIT_STYLE.stroke=breu;
  HURT_STYLE.color=token('--c-cone');HURT_STYLE.stroke=breu;
  BUBBLE_STYLE.color=breu;BUBBLE_STYLE.backgroundColor='rgba(0,0,0,0)'; // body drawn on the overlay, with its edge
  TAG_STYLE.color=token('--c-papel');
  PALETTE.breu=tokenColor('--c-breu');PALETTE.papel=tokenColor('--c-papel');PALETTE.cone=tokenColor('--c-cone');
}
const popStyles=new Map<string,TextStyle>();
export const popStyle=(kind:string)=>{
  const key=styleKey(kind);
  let style=popStyles.get(key);
  if(!style){const k=kindStyle(kind);style={fontFamily:FONT,fontSize:'34px',fontStyle:'900',color:k.fill,stroke:k.stroke,strokeThickness:9};popStyles.set(key,style);}
  return style;
};
/** One texture upload per change, even when the label repeats. */
const painted=new WeakMap<Text,TextStyle>();
export const paint=(text:Text,style:TextStyle,label:string)=>{
  if(painted.get(text)!==style){
    painted.set(text,style);
    // Measure each style once (pixel read-back), then reuse its metrics: a 24px number reused as a 32px crit is not clipped.
    if(style.metrics)text.style.setStyle(style,false);
    else{text.setStyle(style);const m=text.style.getTextMetrics();style.metrics={ascent:m.ascent,descent:m.descent,fontSize:m.fontSize};}
    if(text.text===label){text.updateText();return;}
  }
  if(text.text!==label)text.setText(label);
};

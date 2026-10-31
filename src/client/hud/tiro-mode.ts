/**
 * NEW-20261031-ORQ-tiro-rapido-e-local: how the attack button aims, from the page's `?tiro=`.
 * - 'a' (default): no drag. The hero turns by walking (standing, it keeps the last way); the shot goes to the enemy
 *   in the ±35° front cone (rules/front-assist.ts), marked by 4 red arrows, or else straight ahead. Tap = one shot,
 *   hold = a burst.
 * - 'b': like 'a', and it fires on its own while someone is in the cone (a comparison for the user).
 * - 'velho': the brown drag aim on the button (hud/attack-button.ts ring, knob and arrow), as before the card.
 */
export type TiroMode='a'|'b'|'velho';

export function tiroMode(search=typeof location==='undefined'?'':location.search):TiroMode{
  const v=new URLSearchParams(search).get('tiro');
  return v==='b'||v==='velho'?v:'a';
}

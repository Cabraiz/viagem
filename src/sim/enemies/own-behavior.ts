import type {RoleBehavior} from '../../rules/index.ts';
/**
 * A roster entry that keeps its own moves under another role's numbers (catalog.ts rosterDef): the sanfoneiro plays and
 * hits with the fole (sanfoneiro.ts, through enemy-ai's brute branch) as a corredor (card saci-chefe-2x, the user 30/10:
 * "ele é um inimigo comum").
 */
export const OWN_BEHAVIOR:Readonly<Record<string,RoleBehavior>>=Object.freeze({sanfoneiro:'brute'});

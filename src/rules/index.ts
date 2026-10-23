/** Port of the rules sector: pure rules shared by client and server (no DOM, Phaser or network). */
export * from './budget.ts';
export * from './classes.ts';
export * from './personagens-liberados.ts';
export * from './kits.ts';
export * from './names.ts';
export * from './offers.ts';
export * from './passives.ts';
export * from './revive.ts';
export * from './scale.ts';
export * from './crate-size.ts';
export * from './sos.ts';
export * from './emotes.ts';
export * from './stats.ts';
export * from './stonewards.ts';
export * from './telegraph-geometry.ts';
export * from './waves.ts';
export * from './zueira-cidade.ts';
export * from './enemy-roles.ts';
export * from './enemy-roster.ts';
export * from './enemy-cast.ts';
export * from './enemy-rotation.ts';
export * from './enemy-art-ids.ts';
export * from './zueira-infinito.ts';
export * from './towers.ts';
// Kits de torre (torre-pela-caixa): what a crate's kit builds, by rarity.
export * from './tower-kits.ts';
export * from './marks.ts';
export * from './bancos.ts';
export * from './veiculos.ts';
export * from './calma.ts';
// D-051: the manual attack's target choice, shared by the server's weapons and the client's reticle.
export * from './attack-target.ts';
// BUG-20261023-ORQ-armas-sem-projetil: thrown zones fly before they burst.
export * from './thrown.ts';

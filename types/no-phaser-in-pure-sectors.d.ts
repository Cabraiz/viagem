/**
 * What `phaser` resolves to under tsconfig.pure.json: a module with no exports, so any use of Phaser in a pure
 * sector (contract, rules, maps, sim, protocol) fails `npm run check` (a member, a named or type import).
 * A bare `import 'phaser'` that uses nothing still type-checks; tests/arquitetura.test.ts rejects that import.
 * (Pointing `paths` at a missing file does not work: tsc then falls back to node_modules and finds Phaser's types.)
 */
export {};

/**
 * City map asset (D-027, contract in design/cidade-protocolo.md §5): the single source of the `viagem-city` JSON
 * format written by the importer (E1) and read by the simulation, the renderer and the rooms Worker.
 * Pure and self-contained (no imports but the pure viaduct geometry, no Node-only APIs): runs in browsers, Node and
 * Cloudflare Workers.
 * Conventions: units of the game (1 cell = unitsPerCell u), origin at the NW corner of the whole cell grid,
 * x grows east and y grows south; grids are row-major, row 0 = north. Walkable/water samples are 4 per cell
 * (sample (sx,sy) covers [sx*step,(sx+1)*step) on x), stored as LSB-first bitsets (bit i = byte[i>>3]>>(i&7)&1);
 * heights sit on the (cells+1)^2 cell corners as Int16 little-endian centi-units. Binary sections travel in base64.
 * The code lives in ./city-asset/ (types, codec, encode, decode, grid, manifest); this file keeps the import path.
 */
export * from './city-asset/index.ts';

// BUG-20261010-ORQ-menu-travando: guards for what made the creation menu stutter on phones.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classes } from '../src/classes.ts';
import { declarations } from '../scripts/lint-design.mjs';

const menuCss = ['src/style.css', 'src/sections.css', 'src/world.css'];

test('menu CSS never repaints the whole screen on scroll', () => {
  for (const file of menuCss) for (const d of declarations(fs.readFileSync(file, 'utf8'))) {
    // background-attachment:fixed on a page background = full repaint every scroll frame (5.7 s of raster per pass).
    if (d.prop === 'background-attachment' || d.prop === 'background') assert.doesNotMatch(d.value, /\bfixed\b/, `${file}:${d.line} ${d.selector}`);
    // A blur behind an opaque or scrolling bar is redone every frame by the GPU; only the modal veil keeps one.
    if (d.prop === 'backdrop-filter' || d.prop === '-webkit-backdrop-filter') assert.match(d.selector, /::backdrop$/, `${file}:${d.line} ${d.selector}`);
  }
});

test('every class ships the 768 px portrait used by srcset, lighter than the 1024 px one', () => {
  for (const hero of classes) {
    const full = `public/art/portraits/${hero.id}.webp`, mid = `public/art/portraits/${hero.id}-768.webp`;
    assert.ok(fs.existsSync(mid), mid);
    assert.ok(fs.statSync(mid).size < fs.statSync(full).size, mid);
  }
});

test('the menu only loads the game engine when the player goes to play', () => {
  const main = fs.readFileSync('src/main.ts', 'utf8');
  assert.doesNotMatch(main, /^import .*(phaser|\.\/game\/)/m);
  assert.doesNotMatch(fs.readFileSync('index.html', 'utf8'), /modulepreload|phaser|classes-atlas/);
});

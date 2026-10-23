import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { MAX_PLAYERS } from '../../src/protocol/room.ts';

// seo-natural (NEW-20261023-ORQ-seo-natural, docs/seo.md): the head says what the game is, in plain words, and only what
// is true in the game.
const html = fs.readFileSync('index.html', 'utf8');
const meta = (attr: string, key: string) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];
const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
const description = meta('name', 'description') ?? '';
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);

test('seo head: title, description, canonical and the share card agree', () => {
  assert.ok(title.length > 0 && title.length <= 60, title);
  assert.ok(description.length > 0 && description.length <= 155, `${description.length} chars`);
  assert.match(html, /<link rel="canonical" href="https:\/\/viagem\.cyou\/" \/>/);
  assert.equal(meta('property', 'og:title'), title);
  assert.equal(meta('name', 'twitter:title'), title);
  for (const d of [meta('property', 'og:description'), meta('name', 'twitter:description'), ld.description]) assert.equal(d, description);
  assert.equal(meta('property', 'og:url'), 'https://viagem.cyou/');
  assert.equal(meta('name', 'twitter:card'), 'summary_large_image');
});

test('seo head: tone (no superlatives, no shouting, no sales talk, no keyword lists)', () => {
  for (const text of [title, description, meta('property', 'og:image:alt') ?? '']) {
    assert.doesNotMatch(text, /\b(best|amazing|epic|addictive|ultimate|awesome|don't miss|come and)\b/i, text);
    assert.doesNotMatch(text, /!|\p{Extended_Pictographic}/u, text);
    assert.doesNotMatch(text, /\b[A-Z]{4,}\b/, text);
    assert.ok((text.match(/,/g) ?? []).length <= 3, `reads like a keyword list: ${text}`);
  }
});

test('seo head: the claims are the game (players, free, no made-up rating)', () => {
  assert.equal(ld['@type'], 'VideoGame');
  assert.equal(ld.numberOfPlayers.maxValue, MAX_PLAYERS);
  assert.match(description, new RegExp(`up to ${['', 'one', 'two', 'three', 'four', 'five', 'six'][MAX_PLAYERS]} players`));
  assert.equal(ld.offers.price, '0');
  assert.equal(ld.inLanguage, 'pt-BR', "the game's text is Portuguese");
  assert.match(html, /<html lang="pt-BR">/);
  assert.equal(ld.aggregateRating, undefined);
  assert.equal(ld.review, undefined);
  assert.doesNotMatch(html, /hreflang="/, 'no /pt or /es pages exist');
});

test('seo head: the share image is a real 1200x630 file', async () => {
  assert.equal(meta('property', 'og:image'), 'https://viagem.cyou/og.jpg');
  assert.equal(meta('name', 'twitter:image'), 'https://viagem.cyou/og.jpg');
  const { width, height, format } = await sharp('public/og.jpg').metadata();
  assert.deepEqual([width, height, format], [1200, 630, 'jpeg']);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
});

test('seo: robots.txt allows everything and points at the sitemap; the sitemap lists the site', () => {
  const robots = fs.readFileSync('public/robots.txt', 'utf8');
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.doesNotMatch(robots, /Disallow: \/\S/);
  assert.match(robots, /^Sitemap: https:\/\/viagem\.cyou\/sitemap\.xml$/m);
  assert.match(fs.readFileSync('public/sitemap.xml', 'utf8'), /<loc>https:\/\/viagem\.cyou\/<\/loc>/);
});

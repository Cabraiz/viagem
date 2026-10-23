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
  // ?v=2b: crawlers (WhatsApp above all) keep the preview by URL; the 2B logo replaced the stadium picture.
  assert.equal(meta('property', 'og:image'), 'https://viagem.cyou/og.jpg?v=2b');
  assert.equal(meta('name', 'twitter:image'), 'https://viagem.cyou/og.jpg?v=2b');
  assert.equal(ld.image, 'https://viagem.cyou/og.jpg?v=2b');
  const { width, height, format } = await sharp('public/og.jpg').metadata();
  assert.deepEqual([width, height, format], [1200, 630, 'jpeg']);
  assert.equal(meta('property', 'og:image:width'), '1200');
  assert.equal(meta('property', 'og:image:height'), '630');
});

test('seo: robots.txt allows everything and points at the sitemap; the sitemap lists the site', () => {
  const robots = fs.readFileSync('public/robots.txt', 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout (autocrlf) has CRLF
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.doesNotMatch(robots, /Disallow: \/\S/);
  assert.match(robots, /^Sitemap: https:\/\/viagem\.cyou\/sitemap\.xml$/m);
  assert.match(fs.readFileSync('public/sitemap.xml', 'utf8'), /<loc>https:\/\/viagem\.cyou\/<\/loc>/);
});

// icone-uno-2b (NEW-20261023-ORQ-icone-uno-2b): the 2B logo is the tab, search, home screen and share icon.
const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon|manifest)"([^>]*)>/g)].map(([, rel, rest]) => ({
  rel,
  href: rest.match(/href="([^"]*)"/)![1],
  sizes: rest.match(/sizes="([^"]*)"/)?.[1],
}));

test('icons: every icon in the head is a real file of the size it claims', async () => {
  const pngs = links.filter((l) => l.rel !== 'manifest' && l.href.endsWith('.png'));
  assert.deepEqual(pngs.map((l) => l.sizes), ['48x48', '96x96', '192x192', '180x180']);
  for (const { href, sizes } of pngs) {
    const { width, height, format } = await sharp(`public${href}`).metadata();
    assert.equal(`${width}x${height}`, sizes, href);
    assert.equal(format, 'png', href);
  }
  // Google's search icon: a multiple of 48 px, at least 48.
  assert.ok(pngs.some((l) => l.rel === 'icon' && l.sizes === '48x48'));
});

test('icons: favicon.ico carries 16, 32 and 48; favicon.svg stays an svg (public/conexao.html probes it)', () => {
  const ico = fs.readFileSync('public/favicon.ico');
  assert.equal(ico.readUInt16LE(2), 1, 'icon type');
  const n = ico.readUInt16LE(4);
  const sizes = Array.from({ length: n }, (_, i) => ico[6 + i * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 32, 48]);
  assert.ok(links.some((l) => l.href === '/favicon.ico' && l.sizes === '16x16 32x32 48x48'));
  assert.match(fs.readFileSync('public/favicon.svg', 'utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

test('icons: the home screen icons have no transparency and the manifest lists real files', async () => {
  for (const f of ['apple-touch-icon.png', 'icon-maskable-192.png', 'icon-maskable-512.png']) {
    const { hasAlpha } = await sharp(`public/${f}`).metadata();
    assert.equal(hasAlpha, false, f);
  }
  assert.ok(links.some((l) => l.rel === 'manifest' && l.href === '/manifest.webmanifest'));
  const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.theme_color, meta('name', 'theme-color'));
  // browser, not standalone: no install prompt appears; the home screen shortcut opens the site as it is today.
  assert.equal(manifest.display, 'browser');
  for (const icon of manifest.icons) {
    const { width, height } = await sharp(`public${icon.src}`).metadata();
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
  }
  assert.deepEqual(manifest.icons.map((i: { purpose: string }) => i.purpose).sort(), ['any', 'any', 'maskable', 'maskable']);
});

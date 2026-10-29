// site-textos-404-sobre (NEW-20261029-ORQ-site-textos-404-sobre): the iOS startup screens of the home screen shortcut.
// iOS shows an apple-touch-startup-image only when its media query matches the device exactly, so there is one file per
// iPhone size and orientation: the logo (icon-512, nearest neighbor, it is pixel art) on the menu's purple.
//   node scripts/ios-splash.mjs          writes public/splash/ and the <link> block in index.html
//   node scripts/ios-splash.mjs --check  exits 1 when index.html or a file is out of date
import fs from 'node:fs';
import sharp from 'sharp';

export const BACKGROUND = '#2E1A52'; // manifest background_color
// [css width, css height, device pixel ratio], newest first.
export const DEVICES = [
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2],
];
const BEGIN = '    <!-- ios-splash:begin (scripts/ios-splash.mjs) -->';
const END = '    <!-- ios-splash:end -->';

export function splashes() {
  return DEVICES.flatMap(([w, h, d]) => ['portrait', 'landscape'].map((orientation) => {
    const [pw, ph] = orientation === 'portrait' ? [w * d, h * d] : [h * d, w * d];
    return {
      href: `/splash/${pw}x${ph}.png`, width: pw, height: ph,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${d}) and (orientation: ${orientation})`,
    };
  }));
}

export function linkBlock() {
  return [BEGIN, ...splashes().map((s) => `    <link rel="apple-touch-startup-image" href="${s.href}" media="${s.media}" />`), END].join('\n');
}

async function image({ width, height }) {
  const side = Math.round(Math.min(width, height) * 0.42);
  const logo = await sharp('public/icon-512.png').resize(side, side, { kernel: 'nearest' }).toBuffer();
  return sharp({ create: { width, height, channels: 3, background: BACKGROUND } })
    .composite([{ input: logo, left: Math.round((width - side) / 2), top: Math.round((height - side) / 2) }])
    .flatten({ background: BACKGROUND })
    .png({ palette: true, colours: 64, compressionLevel: 9 })
    .toBuffer();
}

function withBlock(html) {
  const at = html.indexOf(BEGIN);
  if (at >= 0) return html.slice(0, at) + linkBlock() + html.slice(html.indexOf(END) + END.length);
  return html.replace('@@SPLASH@@', linkBlock());
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/ios-splash.mjs')) {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync('index.html', 'utf8');
  const next = withBlock(html);
  const stale = [];
  if (next !== html) stale.push('index.html');
  fs.mkdirSync('public/splash', { recursive: true });
  for (const s of splashes()) {
    const file = `public${s.href}`;
    if (check) { if (!fs.existsSync(file)) stale.push(file); continue; }
    fs.writeFileSync(file, await image(s));
  }
  if (check) {
    if (stale.length) { console.error(`ios-splash: out of date: ${stale.join(', ')} (run node scripts/ios-splash.mjs)`); process.exit(1); }
  } else {
    fs.writeFileSync('index.html', next);
    console.log(`ios-splash: ${splashes().length} screens`);
  }
}

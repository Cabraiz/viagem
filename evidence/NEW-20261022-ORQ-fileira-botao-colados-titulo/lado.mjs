// antes × depois lado a lado, metade do tamanho. uso: node lado.mjs
import sharp from 'sharp';
for (const h of ['viciado-em-bet', 'clt-cansado', 'mendigo']) {
  const [a, d] = await Promise.all(['antes', 'depois'].map(p => sharp(`${p}-${h}-1920x1000.png`).resize(960, 500).toBuffer()));
  await sharp({create: {width: 1930, height: 500, channels: 3, background: '#ffffff'}})
    .composite([{input: a, left: 0, top: 0}, {input: d, left: 970, top: 0}]).png().toFile(`antes-x-depois-${h}-1920x1000.png`);
}

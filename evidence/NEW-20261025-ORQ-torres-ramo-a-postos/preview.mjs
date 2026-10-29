// Flattens a sprite page onto a light background for viewing: node preview.mjs <in> <out.png> [scale]
import sharp from 'sharp';
const [,,inp,out,scale='0.5']=process.argv;
const m=await sharp(inp).metadata();console.log(inp,m.width,m.height);
await sharp(inp).resize(Math.round(m.width*+scale)).flatten({background:'#cfd8dc'}).png().toFile(out);

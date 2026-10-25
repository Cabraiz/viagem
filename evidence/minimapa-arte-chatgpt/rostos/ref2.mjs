import sharp from 'sharp';
const ids=['coach','concurseira','faxineira','feirante','mendigo','passageira','pedreiro','streamer','universitario','vizinha-fofoqueira'];
const C=200,tiles=[];
for(const [i,id] of ids.entries())tiles.push({input:await sharp(`public/art/rostos/${id}-normal.webp`).resize(C,C,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png().toBuffer(),left:(i%5)*C,top:Math.floor(i/5)*C});
await sharp({create:{width:5*C,height:2*C,channels:3,background:'#ffffff'}}).composite(tiles).png().toFile(process.argv[2]);

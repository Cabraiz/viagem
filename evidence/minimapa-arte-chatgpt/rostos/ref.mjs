import sharp from 'sharp';
const ids=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','aposentado','vendedor-praia'];
const src=id=>id==='gato-nada-pra-comer'?'public/art/portraits/gato-nada-pra-comer-thumb.webp':`public/art/rostos/${id}-normal.webp`;
const C=256,tiles=[];
for(const [i,id] of ids.entries()){
  let img=sharp(src(id));
  if(id==='gato-nada-pra-comer'){const m=await img.metadata();const s=Math.round(m.width*.5);img=sharp(src(id)).extract({left:Math.round(m.width*.25),top:0,width:s,height:s});}
  tiles.push({input:await img.resize(C,C,{fit:'contain',background:'#ffffff'}).flatten({background:'#ffffff'}).png().toBuffer(),left:(i%3)*C,top:Math.floor(i/3)*C});
}
await sharp({create:{width:3*C,height:2*C,channels:3,background:'#ffffff'}}).composite(tiles).png().toFile(process.argv[2]);

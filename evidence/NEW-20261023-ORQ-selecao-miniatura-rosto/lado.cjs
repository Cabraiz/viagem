// node lado.cjs: antes | depois side by side, JPG, for each view (and the gato picked on the PC and the phone on its side).
const sharp=require('sharp'),path=require('path'),P=f=>path.join(__dirname,'prints',f);
(async()=>{
  for(const [out,a,b] of [['pc-1280x720','antes-pc-1280x720','depois-pc-1280x720'],['deitado-844x390','antes-deitado-844x390','depois-deitado-844x390'],
    ['em-pe-390x844','antes-em-pe-390x844','depois-em-pe-390x844'],['gato-pc-e-deitado','depois-gato-pc-1280x720','depois-gato-deitado-844x390']]){
    const A=await sharp(P(a+'.png')).metadata(),B=await sharp(P(b+'.png')).metadata(),h=Math.max(A.height,B.height),gap=24;
    await sharp({create:{width:A.width+B.width+gap,height:h,channels:3,background:'#111'}})
      .composite([{input:P(a+'.png'),left:0,top:0},{input:P(b+'.png'),left:A.width+gap,top:0}]).jpeg({quality:82}).toFile(P(`lado-a-lado-${out}.jpg`));
  }
})();

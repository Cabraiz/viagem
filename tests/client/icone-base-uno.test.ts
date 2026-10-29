/**
 * Card icone-base-vira-uno: the base's icon (IconName 'base', on the edge arrow, the city objective and the camp row) is
 * the Uno, extracted from the minimap's Uno art, not the tent. The art is ui/base.webp: a blue-grey car, while the
 * tent was orange.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

test('ui/base.webp is the Uno: 128×128, blue-grey, not the orange tent', async ()=>{
  const {data,info}=await sharp('public/art/ui/base.webp').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(info.width,128);assert.equal(info.height,128);
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<data.length;i+=4){
    const [pr,pg,pb,pa]=[data[i]!,data[i+1]!,data[i+2]!,data[i+3]!];
    // The body only: opaque, not the dark outline nor the cream rim.
    if(pa<250||pr+pg+pb<150||pr>200&&pg>200)continue;
    r+=pr;g+=pg;b+=pb;n++;
  }
  assert.ok(n>2000,`the car fills the icon (${n} px)`);
  assert.ok(b/n>r/n+15,`blue over red (r ${Math.round(r/n)}, b ${Math.round(b/n)})`);
});

test('uno-icone-halo: the base icon has a 1 px branco-papel halo all round, in CSS, the box unchanged', async ()=>{
  const {readFileSync}=await import('node:fs');
  const css=readFileSync('src/client/ui/icons.css','utf8');
  const rule=/img\.ic\[data-icon=base\]\{([^}]*)\}/.exec(css)?.[1];
  assert.ok(rule,'a rule for img.ic[data-icon=base]');
  const shadows=[...rule!.matchAll(/drop-shadow\(([^)]*\))\)/g)].map(m=>m[1]!.replace(/\s+/g,' ').trim());
  assert.deepEqual(shadows.map(s=>s.split(' ').slice(0,3).join(' ')).sort(),['-1px 0 0','0 -1px 0','0 1px 0','1px 0 0']);
  assert.ok(shadows.every(s=>s.includes('var(--c-papel-claro)')),'the halo is branco-papel');
  assert.ok(!/width|height|margin|padding/.test(rule!),'no size change');
});

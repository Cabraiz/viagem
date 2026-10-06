import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const api='https://viagem-api.vercel.app/api';
const checks=[];
async function check(name,url,expected,options={}){
  const start=performance.now();
  try{
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});
    const body=await response.text();
    const result={name,url,status:response.status,milliseconds:Math.round(performance.now()-start),cors:response.headers.get('access-control-allow-origin'),cache:response.headers.get('cache-control'),passed:response.status===expected,sha256:createHash('sha256').update(body).digest('hex')};
    if(response.headers.get('content-type')?.includes('application/json')){result.body=JSON.parse(body);if(expected===200)result.passed&&=result.body.status==='ok';}
    checks.push(result);return result;
  }catch(error){const result={name,url,passed:false,error:error.message};checks.push(result);return result;}
}
await Promise.all([
  check('site-apex','https://viagem.cyou/',200),
  check('site-www','https://www.viagem.cyou/',200),
  check('api-health',`${api}/health`,200),
  check('api-database',`${api}/ready`,200),
  check('cors-apex',`${api}/ready`,200,{headers:{Origin:'https://viagem.cyou'}}),
  check('cors-www',`${api}/ready`,200,{headers:{Origin:'https://www.viagem.cyou'}}),
  check('cors-outside',`${api}/ready`,403,{headers:{Origin:'https://example.org'}}),
  check('method-rejected',`${api}/ready`,405,{method:'POST',headers:{Origin:'https://viagem.cyou'}}),
  check('preflight',`${api}/ready`,204,{method:'OPTIONS',headers:{Origin:'https://viagem.cyou','Access-Control-Request-Method':'GET'}}),
]);
for(const result of checks){if(result.name==='cors-apex')result.passed&&=result.cors==='https://viagem.cyou';if(result.name==='cors-www')result.passed&&=result.cors==='https://www.viagem.cyou';if(result.name==='cors-outside')result.passed&&=result.cors===null;}
await Promise.all(Array.from({length:6},(_,i)=>check(`concurrent-read-${i+1}`,`${api}/ready`,200,{headers:{Origin:'https://viagem.cyou'}})));
const report={checkedAt:new Date().toISOString(),scope:'Read-only HTTP connectivity, not multiplayer or load capacity',passed:checks.filter(c=>c.passed).length,total:checks.length,checks};
await writeFile('docs/production-connectivity-http.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,total:report.total,failures:checks.filter(c=>!c.passed),readLatencies:checks.filter(c=>c.name.startsWith('concurrent')).map(c=>c.milliseconds)}));
process.exitCode=report.passed===report.total?0:1;

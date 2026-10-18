import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateTargets,inspectRuntime,runPreflight} from './preflight.mjs';
const plan=JSON.parse(await readFile(new URL('./targets.json',import.meta.url),'utf8'));
test('the preparation plan preserves the website and separates test from production',()=>{assert.deepEqual(validateTargets(plan),[]);});
test('plans that share databases, enable purchases or change the main website are rejected',()=>{
 for(const mutate of [p=>p.production.databaseName=p.staging.databaseName,p=>p.production.databaseResource=p.staging.databaseResource,p=>p.policy.allowPurchases=true,p=>p.policy.allowMainDomainDnsChanges=true,p=>p.website.operation='write',p=>p.staging.publishAllowed=true,p=>p.dns.authorizedStagingHostname='yuandesignbuild.com']){
  const candidate=structuredClone(plan);mutate(candidate);assert.ok(validateTargets(candidate).length);
 }
});
test('the current SQLite/development runtime cannot pass Render/PostgreSQL readiness',()=>{
 const blockers=inspectRuntime({dev:"import 'node:sqlite';server.listen(4174,'127.0.0.1')",server:'env.DB.prepare env.BUCKET oai-authenticated-user-id',manifest:{scripts:{dev:'node scripts/dev.mjs'}}});
 assert.equal(blockers.length,4);
});
test('read-only preflight does not expose credential values or claim a deployment',async()=>{
 const secret='fixture-only-do-not-emit';const result=await runPreflight({env:{RENDER_API_KEY:secret,DINAHOSTING_API_USER:secret,DINAHOSTING_API_PASSWORD:secret}});
 assert.equal(result.readOnly,true);assert.equal(result.externalWritesPerformed,false);assert.equal(result.deploymentReady,false);
 assert.ok(!JSON.stringify(result).includes(secret));assert.equal(result.credentialPresence.renderApiKey,true);
});

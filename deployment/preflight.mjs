import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';

const execute=promisify(execFile);
const root=fileURLToPath(new URL('../',import.meta.url));
export function validateTargets(plan){
 const problems=[],add=message=>problems.push(message),policy=plan.policy||{};
 if(plan.website?.hostname!=='yuandesignbuild.com'||plan.website?.operation!=='read-only')add('The existing WordPress website must remain read-only.');
 if(plan.staging?.hostname!=='test.yuandesignbuild.com'||plan.production?.hostname!=='app.yuandesignbuild.com')add('Only the designated staging and production hostnames may be used.');
 if(policy.allowedDeploymentEnvironment!=='staging')add('Production deployment is not authorized by this preparation task.');
 if(policy.allowPurchases!==false||policy.maxNewMonthlyCostEurWithoutApproval!==0||policy.requireVerifiedZeroCostBeforeCreatingFreeResources!==true)add('Any new charge needs explicit approval; unverified free-tier prices are insufficient.');
 if(policy.allowMainDomainDnsChanges!==false||policy.allowExistingWebsiteChanges!==false||policy.allowDestructiveMigrations!==false)add('Website, apex DNS and destructive changes must remain disabled.');
 for(const field of ['hostname','serviceName','databaseName','databaseResource','assetStorage'])if(!plan.staging?.[field]||!plan.production?.[field]||plan.staging[field]===plan.production[field])add('Staging and production must not share '+field+'.');
 if(plan.staging?.publishAllowed!==false||plan.production?.publishAllowed!==false)add('Publishing must stay disabled until implementation and provider checks pass.');
 if(plan.dns?.authorizedStagingHostname!=='test.yuandesignbuild.com')add('DNS authorization is limited to the test subdomain.');
 return problems;
}
export function inspectRuntime({dev,server,manifest}){
 const blockers=[];
 if(dev.includes('node:sqlite')||server.includes('env.DB.prepare'))blockers.push('PostgreSQL runtime adapter is missing; local SQLite and D1 are not PostgreSQL.');
 if(server.includes('env.BUCKET'))blockers.push('Durable private asset storage must be adapted and tested; ephemeral Render files are insufficient.');
 if(server.includes('oai-authenticated-user-id'))blockers.push('A trusted authentication boundary is required before accepting identity headers.');
 if(dev.includes("'127.0.0.1'")||!manifest.scripts?.start)blockers.push('Render requires a production entry that listens on 0.0.0.0 and its PORT variable.');
 return blockers;
}
function isPresent(env,name){return typeof env[name]==='string'&&env[name].trim().length>0;}
async function request(url,key){
 try{
  const response=await fetch(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'User-Agent':'YUAN-deployment-preflight/1.0',...(key?{Authorization:'Bearer '+key}:{})}});
  await response.body?.cancel();
  return {url,status:response.status,ok:response.ok,tlsVerification:'enabled',...(response.status>=300&&response.status<400?{redirectObserved:true}:{})};
 }catch(error){
  const causes=[];for(let next=error,i=0;next&&i<5;i++,next=next.cause)causes.push(String(next.message||''));
  const message=causes.join(' ');
  return {url,ok:false,category:/403|407|proxy response/i.test(message)?'proxy_or_network_denied':/timeout|aborted/i.test(message)?'timeout':'transport_failure',tlsVerification:'enabled'};
 }
}
export async function runPreflight({repoRoot=root,env=process.env,network=false}={}){
 const [targets,dev,server,manifest]=await Promise.all([
  readFile(resolve(repoRoot,'deployment/targets.json'),'utf8').then(JSON.parse),
  readFile(resolve(repoRoot,'scripts/dev.mjs'),'utf8'),readFile(resolve(repoRoot,'app/server.js'),'utf8'),readFile(resolve(repoRoot,'package.json'),'utf8').then(JSON.parse)
 ]);
 const blocks=inspectRuntime({dev,server,manifest}),policyProblems=validateTargets(targets);
 let trackedChanges=null,head=null,remoteRead=false;
 try{const result=await execute('git',['status','--porcelain=v1'],{cwd:repoRoot});trackedChanges=result.stdout.trim().split('\n').filter(Boolean).length;}catch{}
 try{head=(await execute('git',['rev-parse','HEAD'],{cwd:repoRoot})).stdout.trim();}catch{}
 if(network){try{await execute('git',['ls-remote','origin','HEAD'],{cwd:repoRoot,timeout:15000});remoteRead=true;}catch{}}
 const credentials={renderApiKey:isPresent(env,'RENDER_API_KEY'),dinahostingApiUser:isPresent(env,'DINAHOSTING_API_USER'),dinahostingApiPassword:isPresent(env,'DINAHOSTING_API_PASSWORD'),sshAgent:isPresent(env,'SSH_AUTH_SOCK'),githubCliToken:isPresent(env,'GH_TOKEN')||isPresent(env,'GITHUB_TOKEN')};
 if(!credentials.renderApiKey)blocks.push('Render API authorization is not configured.');
 if(!credentials.dinahostingApiUser||!credentials.dinahostingApiPassword)blocks.push('Dinahosting API authorization is not configured; no DNS or hosting write is possible.');
 for(const [gate,ready] of Object.entries(targets.gates||{}))if(ready!==true)blocks.push('Unverified gate: '+gate);
 const requests=network?await Promise.all([
  request('https://yuandesignbuild.com/'),request('https://test.yuandesignbuild.com/api/health'),request('https://app.yuandesignbuild.com/api/health'),
  request('https://api.render.com/v1/services?limit=1',env.RENDER_API_KEY),request('https://dinahosting.com/api')
 ]):[];
 if(network&&requests.some(result=>!result.ok))blocks.push('External network or service checks have not all succeeded; HTTP/DNS/TLS readiness is unproven.');
 return {observedAt:new Date().toISOString(),readOnly:true,externalWritesPerformed:false,head,workingTreeChanges:trackedChanges,githubGitRead:network?remoteRead:'not_rechecked',credentialPresence:credentials,networkChecks:requests,policyProblems,blockers:[...policyProblems,...blocks],deploymentReady:policyProblems.length+blocks.length===0,targets:{website:targets.website.hostname,staging:targets.staging.hostname,production:targets.production.hostname}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const result=await runPreflight({network:process.argv.includes('--network')});console.log(JSON.stringify(result,null,2));process.exitCode=result.deploymentReady?0:2;}
 catch(error){console.error(JSON.stringify({readOnly:true,deploymentReady:false,error:'Preflight could not inspect the selected source files.'}));process.exitCode=1;}
}

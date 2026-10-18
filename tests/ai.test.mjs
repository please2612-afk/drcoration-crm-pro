import test from 'node:test';
import assert from 'node:assert/strict';
import '../app/core.js';
import '../app/advisor.js';
import {createAIService} from '../app/ai.js';
const C=globalThis.YuanCore,A=globalThis.YuanAdvisor;
const config={AI_BASE_URL:'https://api.example.com/v1',AI_MODEL:'fixture-model',AI_API_KEY:'test-only-placeholder'};
function fixture(){
 const p=C.project({name:'Example',area:100,floor:90,wall:200,budget:1000,start:'2026-10-19',workers:[{id:'w',name:'PRIVATE WORKER',email:'private@example.com'}]});
 p.id='fixture-project';
 p.tasks=[{id:'public',title:'Public work',date:'2026-10-19',endDate:'2026-10-19',time:'08:00',endTime:'17:00',status:'review',progress:100,public:true,workerId:'w',details:'PRIVATE INSTRUCTIONS',clientDetails:'PUBLIC EXPLANATION',checks:[],dependencies:[],materials:[]},{id:'private',title:'PRIVATE DRAFT',date:'2026-10-19',status:'draft',public:false}];
 p.clientUpdates=[{published:true,date:'2026-10-18',text:'Public update'},{published:false,text:'PRIVATE UPDATE'}];
 p.requests=[{id:'request',code:'MR-1',needDate:'2026-10-19',status:'pending',lines:[{materialId:'floor',qty:500,price:100,received:0}]}];
 return p;
}
const input=(overrides={})=>({project:fixture(),role:'owner',actorId:'owner',revision:3,language:'zh',focus:'approval',focusId:'request',...overrides});
const answer=()=>new Response(JSON.stringify({choices:[{message:{content:'核对数量与预算，再由负责人确认。'}}]}),{headers:{'Content-Type':'application/json'}});
test('customer AI context contains only published information, also in owner preview',()=>{
 const context=A.context(fixture(),C,{role:'customer',language:'en'}),value=JSON.stringify(context);
 for(const privateText of ['PRIVATE','private@example.com','1000','price','requests','workers'])assert.ok(!value.includes(privateText),privateText);
 assert.match(value,/PUBLIC EXPLANATION/);assert.equal(context.checks[0].text,A.text('en','progress'));
});
test('decision checks flag major purchases, missing prices and unusually large quantities',()=>{
 const p=fixture(),items=A.hints(p,C,{focus:'approval',focusId:'request'});
 assert.ok(items.some(h=>h.code==='major_purchase'));assert.ok(items.some(h=>h.code==='quantity_outlier'));
 p.requests[0].lines[0].price=null;assert.ok(A.hints(p,C,{focus:'approval',focusId:'request'}).some(h=>h.code==='unpriced'));
 assert.ok(A.hints(p,C,{focus:'publish'}).some(h=>h.code==='drawing_unverified'));
});
test('obvious input mistakes are checked without an AI dependency',()=>{
 assert.ok(A.inputHints({area:100,floor:1000,wall:2000,budget:100},{budget:1000}).length>=3);
 assert.equal(A.inputHints({eta:'2026-10-20',needDate:'2026-10-19'},{},'order')[0].code,'late_order');
 assert.equal(A.inputHints({progress:10},{progress:80},'progress')[0].code,'progress_drop');
 for(const value of [' ',true,[],{},Infinity,-1])assert.throws(()=>C.number(value));
 for(const value of ['2026-13-01','2026-02-30','9999-99-99','not-a-date'])assert.equal(C.date(value),false);
});
test('missing or insecure API configuration returns rules without a network call',async()=>{
 let calls=0;const service=createAIService(C,{fetchImpl:async()=>{calls++;return answer();}});
 for(const env of [{},{...config,AI_BASE_URL:'http://api.example.com/v1'},{...config,AI_BASE_URL:'https://user:pass@api.example.com/v1'},{...config,AI_MODEL:''}]){
  assert.equal(service.status(env).configured,false);assert.equal((await service.advise(env,input())).reason,'not_configured');
 }assert.equal(calls,0);
});
test('OpenAI-compatible requests have bounded context and repeated analysis reuses results',async()=>{
 let calls=0,request;const service=createAIService(C,{fetchImpl:async(url,options)=>{calls++;request={url,...options};return answer();}});
 const [one,two]=await Promise.all([service.advise(config,input()),service.advise(config,input())]);
 assert.equal(calls,1);assert.equal(one.source,'ai');assert.equal(two.source,'ai');
 assert.equal((await service.advise(config,input())).cached,true);assert.equal(calls,1);
 assert.equal(request.url,'https://api.example.com/v1/chat/completions');assert.equal(request.redirect,'error');
 const payload=JSON.parse(request.body);assert.equal(payload.model,'fixture-model');assert.equal(payload.stream,false);assert.ok(payload.max_tokens<=1000);assert.ok(!request.body.includes('private@example.com'));
 await service.advise(config,input({revision:4}));assert.equal(calls,2);
});
test('provider errors, invalid content and oversized output fall back to rules',async()=>{
 for(const response of [()=>new Response('rate limited',{status:429}),()=>new Response('bad gateway',{status:502}),()=>new Response('<html>error</html>'),()=>new Response(JSON.stringify({choices:[]})),()=>new Response('x'.repeat(70000))]){
  const service=createAIService(C,{fetchImpl:async()=>response()});const result=await service.advise(config,input());assert.equal(result.source,'rules');assert.ok(result.checks.length>0);assert.equal(result.explanation,'');
 }
 const service=createAIService(C,{fetchImpl:async()=>{throw Error('private upstream error');}});assert.ok(!JSON.stringify(await service.advise(config,input())).includes('private upstream error'));
});
test('slow AI calls are aborted and do not prevent local decision advice',async()=>{
 const service=createAIService(C,{timeoutMs:15,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
 const result=await service.advise(config,input());assert.equal(result.reason,'timeout');assert.equal(result.source,'rules');
});
test('per-user rate limits bound paid API usage while retaining rule checks',async()=>{
 let calls=0;const service=createAIService(C,{fetchImpl:async()=>{calls++;return answer();}});
 for(let i=0;i<8;i++)assert.equal((await service.advise(config,input({question:'Question '+i}))).source,'ai');
 const limited=await service.advise(config,input({question:'One more'}));assert.equal(limited.reason,'rate_limited');assert.equal(calls,8);assert.ok(limited.checks.length);
});

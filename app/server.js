export function createHandler(html,C,initialProject=null){
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
 const error=(message,status=400)=>Object.assign(Error(message),{status});
 const MAX=12*1024*1024;
 function identity(request){const id=request.headers.get('oai-authenticated-user-id'),email=(request.headers.get('oai-authenticated-user-email')||'').toLowerCase();if(!id)throw error('请先登录 ChatGPT 账户',401);return {id,email};}
 async function body(request){if(Number(request.headers.get('content-length'))>MAX)throw error('本次提交过大，请减少照片后重试',413);const reader=request.body?.getReader();if(!reader)throw error('缺少数据');let chunks=[],size=0;while(true){let {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();throw error('本次提交过大',413);}chunks.push(value);}let bytes=new Uint8Array(size),offset=0;for(let c of chunks){bytes.set(c,offset);offset+=c.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw error('JSON 格式无效');}}
 async function row(env){if(!env.DB||!env.BUCKET)throw error('云端存储尚未就绪',503);return env.DB.prepare('SELECT * FROM workspaces WHERE id = ?').bind('primary').first();}
 function members(w,actor){return (w.members||[]).filter(m=>m.email.toLowerCase()===actor.email);}
 function role(r,actor){if(r.owner_id===actor.id)return 'owner';const ms=members(JSON.parse(r.body),actor);if(!ms.length)throw error('当前账户没有项目权限',403);return ms.some(m=>m.role==='foreman')?'foreman':ms.some(m=>m.role==='worker')?'worker':'customer';}
 function projectBase(p){return {id:p.id,version:'3.4',project:{name:p.project.name,area:0,floor:0,wall:0,route:0,budget:0,start:p.project.start,workers:[],points:[],stock:{},prices:{},packs:{},leads:{},suppliers:{},workdays:p.project.workdays||[1,2,3,4,5],holidays:[]},tasks:[],materials:[],requests:[],movements:[],reports:[],activity:[],stockKnown:{},clientUpdates:[],schedule:[],legacyDraftPlan:[]};}
 function projectView(w,actor,as){
  const grants=members(w,actor).filter(m=>m.role===as),projects=[];
  for(let p of w.projects){let g=grants.filter(m=>m.projectId===p.id);if(!g.length)continue;let v=projectBase(p);
   if(as==='foreman'){v=C.clone(p);v.project.budget=0;v.project.prices={};v.materials=v.materials.map(m=>({...m,price:null}));v.requests=v.requests.map(r=>({id:r.id,code:r.code,taskId:r.taskId,needDate:r.needDate,supplier:r.supplier,eta:r.eta,reason:r.reason,urgent:r.urgent,status:r.status,requestedBy:r.requestedBy,at:r.at,lines:r.lines.map(l=>({...l,price:null}))}));v.activity=[];projects.push(v);continue;}
   if(as==='customer'){v.clientData=C.customerProject(p);projects.push(v);continue;}
   const ids=new Set(g.map(m=>m.workerId));v.project.workers=p.project.workers.filter(w=>ids.has(w.id)).map(w=>({id:w.id,name:w.name,skill:w.skill,language:w.language,active:w.active}));
   v.tasks=C.clone(p.tasks.filter(t=>ids.has(t.workerId)&&t.status!=='draft'&&t.status!=='cancelled'));
   let own=new Set(v.tasks.map(t=>t.id)),deps=new Set(v.tasks.flatMap(t=>t.dependencies||[]));
   for(let id of deps)if(!own.has(id)){let t=p.tasks.find(t=>t.id===id);if(t)v.tasks.push({id:t.id,title:'前置工序 / Previous work',date:t.date,endDate:t.endDate,time:t.time,endTime:t.endTime,workerId:'',status:t.status,progress:t.progress,dependencies:[],materials:[],public:false});}
   let needed=new Set(v.tasks.flatMap(t=>(t.materials||[]).map(m=>m.materialId)));
   v.materials=C.catalog(p).map(m=>({id:m.id,name:m.name,names:m.names,unit:m.unit,pack:m.pack,lead:m.lead,estimated:m.estimated,price:null}));
   v.movements=p.movements.filter(m=>own.has(m.taskId)).map(m=>({id:m.id,materialId:m.materialId,type:m.type,qty:m.qty,delta:m.delta,taskId:m.taskId,at:m.at}));
   for(let id of needed){let s=C.stock(p,id);v.stockKnown[id]=s.known;v.project.stock[id]=C.round(s.qty-v.movements.filter(m=>m.materialId===id).reduce((n,m)=>n+m.delta,0));}
   v.reports=p.reports.filter(r=>ids.has(r.workerId));v.project.image=p.project.image;projects.push(v);
  }
  return {schema:'yuan-build-os',version:'3.4',projects,activeProjectId:projects[0]?.id,members:[],revision:0};
 }
 async function assetize(value,env,owner){let out=C.clone(value);async function walk(v){if(!v||typeof v!=='object')return;for(let k of Object.keys(v)){let x=v[k];if(typeof x==='string'&&x.startsWith('data:image/')){let m=x.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);if(!m)throw error('图片格式无效');let binary;try{binary=atob(m[2].replace(/\s/g,''));}catch{throw error('图片编码无效');}if(binary.length>8e6)throw error('单张图片过大');let bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),ownerBytes=new TextEncoder().encode(owner),hashInput=new Uint8Array(ownerBytes.length+bytes.length);hashInput.set(ownerBytes);hashInput.set(bytes,ownerBytes.length);let hash=await crypto.subtle.digest('SHA-256',hashInput),id=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');await env.BUCKET.put('assets/'+id,bytes,{httpMetadata:{contentType:m[1]},customMetadata:{owner}});v[k]='/api/assets/'+id;}else if(typeof x==='string'&&/^\/api\/assets\//.test(x)&&!/^\/api\/assets\/[a-f0-9]{64}$/.test(x))throw error('图片引用无效');else if(typeof x==='object')await walk(x);}}await walk(out);return out;}
 function validateMembers(w){for(let m of w.members||[]){if(!['customer','worker','foreman'].includes(m.role)||!/^\S+@\S+\.\S+$/.test(m.email||''))throw error('协作账户无效');let p=w.projects.find(p=>p.id===m.projectId);if(!p||m.role==='worker'&&!p.project.workers.some(w=>w.id===m.workerId))throw error('协作账户关联无效');}}
 async function persist(env,r,w,mutationId,expected){
  C.validate(w);validateMembers(w);let normalized=await assetize(w,env,r.owner_id),text=JSON.stringify(normalized);if(new TextEncoder().encode(text).length>1.8e6)throw error('工作区记录已超过单次容量，请导出备份后归档完成项目',413);
  const result=await env.DB.prepare('UPDATE workspaces SET body = ?, revision = revision + 1, mutation_id = ?, updated_at = ? WHERE id = ? AND revision = ?').bind(text,mutationId,new Date().toISOString(),'primary',expected).run();
  if(!result.meta?.changes)throw error('另一设备已更新数据，请先载入最新版本',409);return expected+1;
 }
 async function fetch(request,env){
  try{
   const url=new URL(request.url),path=url.pathname;
   if(path==='/api/health'){if(!env.DB||!env.BUCKET)return json({ready:false},503);await env.DB.prepare('SELECT id FROM workspaces LIMIT 1').all();return json({ready:true,version:'3.4'});}
   if(path.startsWith('/api/')){
    const actor=identity(request);let r=await row(env);
    if(!r){await env.DB.prepare('INSERT OR IGNORE INTO workspaces (id, owner_id, owner_email, revision, body, mutation_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('primary',actor.id,actor.email,0,'null','',new Date().toISOString()).run();r=await row(env);}
    let as=r.owner_id===actor.id?'owner':r.body==='null'?(()=>{throw error('项目尚未初始化',403)})():role(r,actor);
    if(path==='/api/workspace'&&request.method==='GET'){let w=JSON.parse(r.body),projected=w?(as==='owner'?w:projectView(w,actor,as)):null;if(projected&&!projected.projects.length)throw error('没有可访问的项目',403);return json({role:as,revision:r.revision,workspace:projected,...(!w&&as==='owner'?{initialProject}:{}),identity:{email:actor.email},workerId:as==='worker'?projected.projects[0].project.workers[0]?.id:null});}
    if(path==='/api/workspace'&&request.method==='PUT'){
     if(as!=='owner')throw error('只有负责人可以修改工作区',403);let data=await body(request);if(typeof data.mutationId!=='string'||data.mutationId.length>150)throw error('提交编号无效');
     if(data.mutationId===r.mutation_id)return json({revision:r.revision,duplicate:true});if(data.expectedRevision!==r.revision)throw error('另一设备已更新数据',409);
     let w=C.workspace(data.workspace);delete w._sync;delete w.revision;let revision=await persist(env,r,w,data.mutationId,data.expectedRevision);return json({revision});
    }
    if(path==='/api/foreman'&&request.method==='POST'){
     if(as!=='foreman')throw error('工长权限不足',403);const data=await body(request);if(typeof data.operationId!=='string'||data.operationId.length>150)throw error('操作编号无效');if(data.operationId===r.mutation_id)return json({revision:r.revision,duplicate:true});if(data.expectedRevision!==r.revision)throw error('数据已更新，请刷新后核对',409);
     const w=JSON.parse(r.body),grants=members(w,actor).filter(m=>m.role==='foreman'),allowed=new Set(grants.map(m=>m.projectId));
     if(!Array.isArray(data.projects)||!data.projects.length)throw error('缺少项目');
     for(let input of data.projects){if(!allowed.has(input.id))throw error('无权管理该项目',403);let p=w.projects.find(p=>p.id===input.id);if(!p)throw error('项目不存在',404);if(!Array.isArray(input.tasks)||p.tasks.some(t=>!input.tasks.some(x=>x.id===t.id)))throw error('不能删除已有任务，请使用取消');
      const next=[];for(let t of input.tasks){const old=p.tasks.find(x=>x.id===t.id),base=old?C.clone(old):{id:C.uid('task'),status:'draft',progress:0,checks:[]};if(!old)base.id=t.id;
       const editable=['title','titles','dayIndex','phaseDays','phaseId','date','endDate','time','endTime','workerId','details','clientDetails','dependencies','materials','estimated','public'];
       if(old&&['done','review'].includes(old.status)){if(editable.some(k=>JSON.stringify(t[k])!==JSON.stringify(old[k])))throw error('待验收或已验收任务须由负责人处理',403);next.push(base);continue;}
       for(let k of editable)if(k in t)base[k]=C.clone(t[k]);base.checks=(t.checks||[]).map(c=>({text:String(c.text),done:old?.checks?.find(x=>x.text===c.text)?.done===true}));
       if(old&&t.status!==old.status){if(old.status==='draft'&&t.status==='assigned'){if(!p.project.workers.some(w=>w.id===t.workerId&&w.active!==false))throw error('负责人未指定');base.status='assigned';base.publishedAt=new Date().toISOString();}else if(t.status==='cancelled'){base.status='cancelled';base.cancelReason=String(t.cancelReason||'工长取消');}else throw error('工长不能替工人接单或代替负责人验收',403);}
       if(!old&&t.status!=='draft')throw error('新任务应先保存为草稿');base.updatedAt=new Date().toISOString();next.push(base);
      }p.tasks=next;if(Array.isArray(input.schedule))p.schedule=input.schedule.map(s=>({id:s.id,title:s.title,titles:s.titles,start:s.start,end:s.end,days:s.days,worker:s.worker,skill:s.skill}));
      for(let m of input.movements||[])if(!p.movements.some(old=>old.id===m.id)){if(!['count','issue','return','waste'].includes(m.type))throw error('工长不能通过库存流水确认采购到货',403);C.move(p,{id:m.id,materialId:m.materialId,type:m.type,qty:m.qty,taskId:m.taskId||'',note:String(m.note||'')});}
      for(let rq of input.requests||[])if(!p.requests.some(old=>old.id===rq.id)){if(!Array.isArray(rq.lines)||!rq.lines.length||!C.date(rq.needDate)||!String(rq.reason||'').trim())throw error('材料申请信息不完整');let known=new Set(C.catalog(p).map(m=>m.id));p.requests.push({id:rq.id,code:'MR-'+C.today().replaceAll('-','')+'-'+C.uid().slice(-5).toUpperCase(),taskId:rq.taskId||'',needDate:rq.needDate,reason:String(rq.reason),supplier:String(rq.supplier||''),urgent:!!rq.urgent,status:'pending',requestedBy:actor.email,at:new Date().toISOString(),lines:rq.lines.map(l=>{if(!known.has(l.materialId))throw error('材料不存在');return {id:C.uid('line'),materialId:l.materialId,qty:C.number(l.qty,'数量',.001),received:0,price:null};})});}
      p.publishedAt=new Date().toISOString();C.log(p,'foreman','工长更新施工计划、材料申请或库存记录',actor.email);
     }
     const revision=await persist(env,r,w,data.operationId,r.revision);return json({revision});
    }
    if(path==='/api/actions'&&request.method==='POST'){
     if(as!=='worker')throw error('此接口仅供工人提交自己的任务',403);const data=await body(request);if(typeof data.operationId!=='string'||data.operationId.length>150)throw error('操作编号无效');let w=JSON.parse(r.body),p=w.projects.find(p=>p.id===data.projectId);if(!p)throw error('项目不存在',404);
     const grants=members(w,actor).filter(m=>m.projectId===p.id&&m.role==='worker'),t=p.tasks.find(t=>t.id===data.taskId);if(!t||!grants.some(g=>g.workerId===t.workerId)||['draft','cancelled'].includes(t.status))throw error('不能操作这个任务',403);
     if(p.activity.some(a=>a.operationId===data.operationId))return json({revision:r.revision,duplicate:true});let payload=data.payload||{};
     if(data.action==='ack'){if(t.status!=='assigned')throw error('任务状态已变化');t.status='accepted';t.ackAt=new Date().toISOString();}
     else if(data.action==='start'){if(!['accepted','blocked'].includes(t.status))throw error('请先确认接单');if(C.blockers(p,t).length)throw error('前置工序尚未验收');t.status='in_progress';t.startedAt??=new Date().toISOString();t.blockReason='';}
     else if(data.action==='block'){if(!['accepted','in_progress'].includes(t.status))throw error('任务状态无效');if(typeof payload.reason!=='string'||!payload.reason.trim()||payload.reason.length>5000)throw error('请填写现场原因');t.status='blocked';t.blockReason=payload.reason;t.blockedAt=new Date().toISOString();}
     else if(data.action==='report'){if(!['in_progress','blocked'].includes(t.status))throw error('请先开始任务');let progress=C.number(payload.progress,'进度',0,100);if(typeof payload.text!=='string'||!payload.text.trim()||payload.text.length>10000)throw error('请填写完成内容');if(!Array.isArray(payload.checks)||payload.checks.length!==(t.checks||[]).length)throw error('检查项已变化，请刷新任务');let checks=(t.checks||[]).map((c,i)=>({text:c.text,done:payload.checks[i]?.text===c.text&&payload.checks[i]?.done===true}));if(progress===100&&checks.some(c=>!c.done))throw error('请完成检查项');if(!Array.isArray(payload.photos)||payload.photos.length>4)throw error('照片最多4张');t.progress=progress;t.status=progress===100?'review':'in_progress';t.checks=checks;t.blockReason='';p.reports.push({id:C.uid('report'),taskId:t.id,workerId:t.workerId,progress,text:payload.text,checks,photos:payload.photos.map(ph=>({id:C.uid('photo'),data:ph.data})),at:new Date().toISOString()});}
     else if(data.action==='request'){let incoming=payload.request;if(!incoming||!Array.isArray(incoming.lines)||!incoming.lines.length||incoming.lines.length>100||typeof incoming.reason!=='string'||!incoming.reason.trim()||!C.date(incoming.needDate))throw error('材料申请信息不完整');let allowed=new Set(C.catalog(p).map(m=>m.id));let lines=incoming.lines.map(l=>{if(!allowed.has(l.materialId))throw error('材料不存在');return {id:C.uid('line'),materialId:l.materialId,qty:C.number(l.qty,'数量',.001),received:0,price:null};});p.requests.push({id:C.uid('request'),code:'MR-'+C.today().replaceAll('-','')+'-'+C.uid().slice(-5).toUpperCase(),taskId:t.id,needDate:incoming.needDate,reason:incoming.reason,supplier:String(incoming.supplier||'').slice(0,200),urgent:!!incoming.urgent,lines,status:'pending',requestedBy:p.project.workers.find(w=>w.id===t.workerId)?.name||actor.email,at:new Date().toISOString()});}
     else throw error('操作无效');
     t.updatedAt=new Date().toISOString();p.publishedAt=new Date().toISOString();C.log(p,'worker',data.action+'：'+t.title,actor.email);p.activity.at(-1).operationId=data.operationId;const revision=await persist(env,r,w,data.operationId,r.revision);return json({revision});
    }
    if(path.startsWith('/api/assets/')&&request.method==='GET'){
     let id=path.split('/').pop();if(!/^[a-f0-9]{64}$/.test(id))throw error('图片不存在',404);let w=JSON.parse(r.body);if(as!=='owner'&&!JSON.stringify(projectView(w,actor,as)).includes('"'+path+'"'))throw error('无权访问照片',403);let object=await env.BUCKET.get('assets/'+id);if(!object||object.customMetadata?.owner!==r.owner_id)throw error('图片不存在',404);return new Response(object.body,{headers:{'Content-Type':object.httpMetadata?.contentType||'image/jpeg','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}});
    }
    return json({error:'接口不存在'},404);
   }
   if((path==='/'||path==='/index.html')&&request.method==='GET')return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' data:; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; worker-src 'self' blob: https://cdnjs.cloudflare.com; connect-src 'self' https://cdnjs.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'"}});
   return new Response('Not found',{status:404});
  }catch(e){return json({error:e.status&&e.status<500?e.message:'服务暂时不可用，请稍后重试；此设备的未同步修改会保留。'},e.status||500);}
 }
 return {fetch};
}

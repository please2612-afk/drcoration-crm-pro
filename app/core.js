(function(root){
'use strict';
const VERSION='3.4', languages=['zh','es','en','hi'];
const clone=v=>JSON.parse(JSON.stringify(v));
const uid=(p='id')=>p+'_'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
const round=n=>Math.round((Number(n)+Number.EPSILON)*1000)/1000;
function number(v,label='数量',min=0,max=1e9){let n=Number(v);if((typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''||!Number.isFinite(n)||n<min||n>max)throw Object.assign(Error(label+' 无效'),{status:400});return n;}
function date(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return false;let value=new Date(v+'T12:00:00Z');return Number.isFinite(value.getTime())&&value.toISOString().slice(0,10)===v;}
function day(d,n=0){let x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);}
function today(now=new Date(),tz='Europe/Madrid'){return new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
const stampCache=new Map(),dateFormatters=new Map();
function stamp(d,time='08:00',tz='Europe/Madrid'){
 let cacheKey=d+'|'+time+'|'+tz;if(stampCache.has(cacheKey))return stampCache.get(cacheKey);
 let formatter=dateFormatters.get(tz);if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});dateFormatters.set(tz,formatter);}
 let [y,m,a]=d.split('-').map(Number),[h,mi]=time.split(':').map(Number),want=Date.UTC(y,m-1,a,h,mi),x=want;
 for(let i=0;i<3;i++){let p=Object.fromEntries(formatter.formatToParts(x).map(v=>[v.type,v.value]));let actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute),diff=want-actual;x+=diff;if(!diff)break;}
 if(stampCache.size>30000)stampCache.clear();stampCache.set(cacheKey,x);return x;
}
function workday(d,p){return (p.project.workdays||[1,2,3,4,5]).includes(new Date(d+'T12:00:00Z').getUTCDay())&&!(p.project.holidays||[]).includes(d);}
function nextWork(d,p){let x=d;for(let i=0;i<370;i++){if(workday(x,p))return x;x=day(x,1);}throw Error('工作日设置没有可用日期');}
function shiftWork(d,n,p){let x=d;for(let i=0;i<Math.abs(n);){x=day(x,n>=0?1:-1);if(workday(x,p))i++;if(Math.abs((new Date(x)-new Date(d))/864e5)>3660)throw Error('工期过长');}return x;}
const phaseDefs=[
 {id:'demolition',titles:['拆除清运','Demolición y retirada','Demolition and clearance','तोड़फोड़ और सफाई'],days:5,skill:'general',checks:['作业范围已确认','清运完成并清洁现场']},
 {id:'marking',titles:['点位定位','Replanteo','Setting out','मार्किंग'],days:2,skill:'general',checks:['对照审核图纸定位','高度及参照尺寸已核对']},
 {id:'electrical',titles:['电气预埋','Instalación eléctrica','Electrical rough-in','बिजली की वायरिंग'],days:7,skill:'electrical',checks:['回路及线径按核定图纸','封闭前拍照并待验收']},
 {id:'plumbing',titles:['给排水预埋','Fontanería','Plumbing rough-in','पानी और निकासी'],days:6,skill:'plumbing',checks:['按核定点位施工','测试结果记录并待验收']},
 {id:'inspection',titles:['隐蔽验收','Inspección previa al cierre','Concealed work inspection','छिपे काम की जाँच'],days:2,skill:'electrical',checks:['现场测试与照片齐全','批准后才封闭']},
 {id:'surfaces',titles:['墙地面施工','Paredes y suelos','Walls and floors','दीवार और फ़र्श'],days:12,skill:'general',checks:['基层与材料已核对','完成面质量检查']},
 {id:'finishing',titles:['安装与收尾','Instalaciones y remates','Installation and finishing','फ़िनिशिंग'],days:9,skill:'general',checks:['按点位安装并测试','保护成品并清洁']},
 {id:'handover',titles:['测试与交付','Pruebas y entrega','Testing and handover','परीक्षण और हैंडओवर'],days:2,skill:'general',checks:['缺陷清单复查','交付资料齐全']}
];
const pointKinds=['outlets','switches','lights','network','water','drain','ac'];
function point(v,i){if(!v||!pointKinds.includes(v.kind))throw Error('点位类型无效 #'+(i+1));let x=number(v.x,'x',0,1),y=number(v.y,'y',0,1);return {id:String(v.id||'P'+String(i+1).padStart(3,'0')).slice(0,80),kind:v.kind,x,y,room:String(v.room||''),height:v.height??v.height_cm??null,left:v.left??v.left_cm??null,right:v.right??v.right_cm??null,leftRef:String(v.leftRef||v.left_ref||''),rightRef:String(v.rightRef||v.right_ref||''),note:String(v.note||'')};}
function project(raw={}){
 let v=raw.project?clone(raw):{project:clone(raw)},p=v.project;
 const validDate=date(p.start)?p.start:today();
 p={name:'新建项目',area:0,floor:0,wall:0,route:0,budget:0,...p,start:validDate,workdays:p.workdays||[1,2,3,4,5],holidays:p.holidays||[],points:(p.points||[]).map(point),stock:p.stock||{},prices:p.prices||{},packs:p.packs||{},leads:p.leads||{},suppliers:p.suppliers||{},image:typeof p.image==='string'?p.image:null};
 if(p.image&&!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(p.image)&&!/^\/api\/assets\/[a-zA-Z0-9_-]+$/.test(p.image))throw Error('图纸图片格式无效');
 p.workers=(p.workers||[]).map((w,i)=>({...w,id:w.id||'worker_'+i,name:String(w.name||'Worker '+(i+1)),skill:w.skill||'general',active:w.active!==false}));
 const legacy=v.version!==VERSION;
 const out={id:v.id||uid('project'),version:VERSION,project:p,approved:!!v.approved,approvedAt:v.approvedAt||null,source:v.source||'manual',schedule:v.schedule||[],tasks:v.tasks||[],materials:v.materials||[],requests:v.requests||[],movements:v.movements||[],reports:v.reports||[],activity:v.activity||[],stockKnown:v.stockKnown||Object.fromEntries(Object.keys(p.stock).map(k=>[k,true])),clientUpdates:v.clientUpdates||[],publishedAt:v.publishedAt||null,procurementClosed:!!v.procurementClosed,legacyDraftPlan:v.legacyDraftPlan||p.plan||[],estimatesChanged:!!v.estimatesChanged};
 if(legacy&&out.schedule.length&&!out.tasks.length){out.tasks=out.schedule.map((s,i)=>({id:uid('task'),title:String(s.title||'工序 '+(i+1)),date:s.start||s.date||validDate,endDate:s.end||s.start||s.date||validDate,time:'08:00',endTime:'17:00',workerId:p.workers.find(w=>w.name===s.worker)?.id||'',phaseId:phaseDefs[i]?.id||'custom',status:s.status==='done'?'done':'draft',progress:s.status==='done'?100:0,dependencies:[],materials:[],details:'从旧版施工计划保留，请拆分并核对每日任务。',checks:[],public:true,legacy:true}));}
 delete out.project.plan;delete out.project.manual;delete out.project.verified;
 return out;
}
function workspace(raw){
 let w;
 if(raw?.schema==='yuan-build-os'&&Array.isArray(raw.projects))w={...clone(raw),version:VERSION,projects:raw.projects.map(project)};
 else w={schema:'yuan-build-os',version:VERSION,projects:[project(raw||{})],members:[],revision:0};
 if(!w.projects.length)throw Error('备份中没有项目');
 w.activeProjectId=w.projects.some(p=>p.id===w.activeProjectId)?w.activeProjectId:w.projects[0].id;w.members=w.members||[];w.revision=Number(w.revision)||0;
 validate(w);return w;
}
function validate(w){
 if(w.projects.length>100)throw Error('项目数量超过限制');
 let ids=new Set();
 for(let p of w.projects){if(ids.has(p.id))throw Error('项目 ID 重复');ids.add(p.id);if(p.tasks.length>10000||p.project.points.length>10000)throw Error('记录过多');
  for(let k of ['area','floor','wall','route','budget'])number(p.project[k]??0,k);
  if(new Set(p.project.points.map(x=>x.id)).size!==p.project.points.length)throw Error('点位编号重复');
  for(let x of p.project.points)for(let k of ['height','left','right'])if(x[k]!=null&&x[k]!=='')number(x[k],k);
  for(let [k,v]of Object.entries(p.project.stock))number(v,k+'库存');
  if(!p.project.workdays.length||p.project.workdays.some(x=>!Number.isInteger(x)||x<0||x>6))throw Error('工作日设置无效');
  let wid=new Set(p.project.workers.map(x=>x.id));if(wid.size!==p.project.workers.length)throw Error('员工 ID 重复');
  let tids=new Set(p.tasks.map(x=>x.id));if(tids.size!==p.tasks.length)throw Error('任务 ID 重复');
  for(let t of p.tasks){if(!date(t.date)||!date(t.endDate||t.date)||(t.endDate||t.date)<t.date)throw Error('任务日期无效');if(!/^\d{2}:\d{2}$/.test(t.time)||!/^\d{2}:\d{2}$/.test(t.endTime)||t.time>='24:00'||t.endTime>='24:00'||t.time.slice(3)>='60'||t.endTime.slice(3)>='60'||(t.date===(t.endDate||t.date)&&t.endTime<=t.time))throw Error('任务时间无效');
   if(t.workerId&&!wid.has(t.workerId))throw Error('任务负责人不存在');
   if(!['draft','assigned','accepted','in_progress','blocked','review','done','cancelled'].includes(t.status))throw Error('任务状态无效');number(t.progress??0,'进度',0,100);
   for(let m of t.materials||[])number(m.qty,'任务材料',0.001);
   for(let d of t.dependencies||[])if(!tids.has(d)||d===t.id)throw Error('任务依赖无效');
  }
  let visited=new Set(),visiting=new Set();const walk=id=>{if(visiting.has(id))throw Error('任务依赖存在循环');if(visited.has(id))return;visiting.add(id);let t=p.tasks.find(x=>x.id===id);for(let d of t?.dependencies||[])walk(d);visiting.delete(id);visited.add(id)};p.tasks.forEach(t=>walk(t.id));
  for(let m of p.materials){number(m.pack??1,'包装',0.001);number(m.lead??0,'交期');if(m.price!=null)number(m.price,'单价');}
  let rids=new Set();for(let r of p.requests){if(rids.has(r.id))throw Error('申请 ID 重复');rids.add(r.id);if(!date(r.needDate))throw Error('申请日期无效');if(!['pending','approved','ordered','partial','received','rejected','cancelled'].includes(r.status))throw Error('采购状态无效');let lids=new Set();for(let l of r.lines||[]){if(lids.has(l.id))throw Error('采购明细重复');lids.add(l.id);number(l.qty,'申请量',0.001);number(l.received??0,'已收量');if((l.received||0)>l.qty+0.0001)throw Error('到货大于采购量');if(l.price!=null)number(l.price,'采购单价');}}
  for(let m of p.movements){number(m.qty,'库存流水数量');if(!Number.isFinite(m.delta))throw Error('库存流水无效');}
 }
 return true;
}
function catalog(p){
 let q=p.project,c=Object.fromEntries(pointKinds.map(k=>[k,q.points.filter(x=>x.kind===k).length]));
 const base=[
 ['floor',['地板','Suelo','Flooring','फ़र्श'],round(q.floor*1.08),'m²',2.2,7,'surfaces'],
 ['paint',['墙漆','Pintura','Paint','पेंट'],Math.ceil(q.wall*2/10),'L',15,3,'surfaces'],
 ['conduit',['电管','Tubo eléctrico','Conduit','बिजली पाइप'],Math.ceil(q.route*1.12),'m',25,4,'electrical'],
 ['cable',['电线（按设计核实）','Cable (verificar diseño)','Cable (verify design)','तार (डिज़ाइन जाँचें)'],Math.ceil(q.route*3*1.15),'m',100,4,'electrical'],
 ['boxes',['底盒','Cajas','Back boxes','बैक बॉक्स'],c.outlets+c.switches+c.network,'pcs',10,3,'electrical'],
 ['outlets',['插座面板','Enchufes','Sockets','सॉकेट'],c.outlets,'pcs',1,5,'finishing'],
 ['switches',['开关面板','Interruptores','Switches','स्विच'],c.switches,'pcs',1,5,'finishing'],
 ['lights',['灯具','Luminarias','Lights','लाइट'],c.lights,'pcs',1,7,'finishing'],
 ['network',['网口模块','Módulos de red','Network modules','नेटवर्क मॉड्यूल'],c.network,'pcs',1,5,'finishing']
 ].map(([id,names,estimate,unit,pack,lead,phase])=>({id,names,name:names[0],estimate,unit,pack:q.packs[id]??pack,lead:q.leads[id]??lead,phase,price:q.prices[id]??null,supplier:q.suppliers[id]||'',estimated:true}));
 const by=new Map(base.map(m=>[m.id,m]));for(let m of p.materials)by.set(m.id,{...(by.get(m.id)||{}),...m});return [...by.values()];
}
function stock(p,id){let known=!!p.stockKnown[id],balance=Number(p.project.stock[id]||0);for(let m of p.movements)if(m.materialId===id){balance+=m.delta;if(m.type==='count')known=true;}return {known,qty:round(balance)};}
function netIssued(p,task,id){return round(-p.movements.filter(m=>m.taskId===task&&m.materialId===id&&['issue','return'].includes(m.type)).reduce((n,m)=>n+m.delta,0));}
function taskMaterials(p,t){let merged=new Map();for(let m of t.materials||[])merged.set(m.materialId,round((merged.get(m.materialId)||0)+m.qty));return [...merged].map(([materialId,qty])=>({materialId,qty,remaining:Math.max(0,round(qty-netIssued(p,t.id,materialId)))}));}
function forecast(p,hours=168,now=Date.now()){
 const horizon=now+hours*36e5,cat=catalog(p),out=[];
 for(let m of cat){let needs=p.tasks.filter(t=>!['done','cancelled'].includes(t.status)&&stamp(t.date,t.time)<=horizon).map(t=>({task:t,qty:taskMaterials(p,t).find(x=>x.materialId===m.id)?.remaining||0,at:stamp(t.date,t.time)})).filter(x=>x.qty>0).sort((a,b)=>a.at-b.at||a.task.id.localeCompare(b.task.id));
  let total=round(needs.reduce((n,x)=>n+x.qty,0));if(!total)continue;let s=stock(p,m.id),supply=[];
  for(let r of p.requests)if(['ordered','partial'].includes(r.status)&&r.eta&&date(r.eta))for(let l of r.lines)if(l.materialId===m.id&&l.qty>(l.received||0))supply.push({at:stamp(r.eta,'08:00'),qty:round(l.qty-(l.received||0)),id:r.id});
  supply.sort((a,b)=>a.at-b.at);let available=s.qty,used=new Set(),shortage=0,firstShort=null;
  for(let n of needs){for(let [i,a]of supply.entries())if(!used.has(i)&&a.at<=n.at){available+=a.qty;used.add(i);}if(available<n.qty){let gap=n.qty-available;shortage+=gap;firstShort??=n.at;available=0;}else available-=n.qty;}
  let pending=p.requests.filter(r=>r.status==='pending'||r.status==='approved').reduce((n,r)=>n+r.lines.filter(l=>l.materialId===m.id).reduce((a,l)=>a+l.qty,0),0);
  out.push({...m,demand:total,known:s.known,onHand:s.qty,ordered:round(supply.reduce((n,x)=>n+x.qty,0)),pending:round(pending),shortage:s.known?round(shortage):null,suggested:s.known?round(Math.ceil(Math.max(0,shortage-pending)/m.pack-1e-9)*m.pack):null,firstDue:needs[0].at,firstShort,latestOrder:firstShort==null?null:day(today(new Date(firstShort)),-m.lead),tasks:needs.map(x=>x.task.id)});
 }
 return out.sort((a,b)=>a.firstDue-b.firstDue);
}
function log(p,kind,text,actor='Qi Yuan'){p.activity.push({id:uid('event'),at:new Date().toISOString(),kind,text,actor});}
function move(p,{materialId,type,qty,taskId='',note='',requestId='',lineId='',id=uid('move')}){
 if(p.movements.some(m=>m.id===id))return false;qty=number(qty,'数量',type==='count'?0:.001);const s=stock(p,materialId);let delta;
 if(type==='count'){delta=round(qty-s.qty);p.stockKnown[materialId]=true;}
 else if(type==='receipt')delta=qty;
 else if(type==='issue'){if(!taskId||!p.tasks.some(t=>t.id===taskId))throw Error('请选择领料任务');if(!s.known)throw Error('请先盘点该材料');if(qty>s.qty+.0001)throw Error('库存不足');delta=-qty;}
 else if(type==='return'){if(qty>netIssued(p,taskId,materialId)+.0001)throw Error('退回量超过该任务净领用量');delta=qty;}
 else if(type==='waste'){if(!s.known||qty>s.qty+.0001)throw Error('库存不足或尚未盘点');if(!note.trim())throw Error('请写明损耗原因');delta=-qty;}
 else throw Error('库存操作无效');
 p.movements.push({id,at:new Date().toISOString(),materialId,type,qty,delta:round(delta),taskId,note,requestId,lineId});return true;
}
function receive(p,requestId,entries,operationId=uid('receipt')){
 if(p.movements.some(m=>m.operationId===operationId))return false;
 let r=p.requests.find(x=>x.id===requestId);if(!r||!['ordered','partial'].includes(r.status))throw Error('请先登记下单');
 let seen=new Set();for(let e of entries){number(e.qty,'实际到货');if(seen.has(e.lineId))throw Error('到货明细重复');seen.add(e.lineId);}
 let batch=entries.filter(x=>Number(x.qty)>0);if(!batch.length)throw Error('请填写实际到货数量');
 for(let e of batch){let l=r.lines.find(x=>x.id===e.lineId);if(!l)throw Error('采购明细不存在');let qty=number(e.qty,'实际到货',.001);if(qty>round(l.qty-(l.received||0))+.0001)throw Error('到货量超过未到货数量');}
 for(let e of batch){let l=r.lines.find(x=>x.id===e.lineId);move(p,{materialId:l.materialId,type:'receipt',qty:+e.qty,requestId,lineId:l.id,id:operationId+'_'+l.id});p.movements.at(-1).operationId=operationId;l.received=round((l.received||0)+Number(e.qty));}
 r.status=r.lines.every(l=>l.received>=l.qty-.0001)?'received':'partial';r.updatedAt=new Date().toISOString();log(p,'receipt','登记到货 '+r.code);return true;
}
function generatePlan(p){
 if(p.tasks.length)throw Error('已有任务。请保留现有计划，或在空白项目生成模板。');
 let d=nextWork(p.project.start,p),previous=[],cat=catalog(p);p.schedule=[];
 for(let phase of phaseDefs){let first=d,last;const worker=p.project.workers.find(w=>w.active!==false&&w.skill===phase.skill);let phaseTasks=[];
  for(let i=0;i<phase.days;i++){let id=uid('task'),materials=cat.filter(m=>m.phase===phase.id&&m.estimate>0).map(m=>({materialId:m.id,qty:round(i===phase.days-1?m.estimate-round(m.estimate/phase.days)*(phase.days-1):m.estimate/phase.days)})).filter(m=>m.qty>0);
   p.tasks.push({id,phaseId:phase.id,title:phase.titles[0]+' · '+(i+1)+'/'+phase.days,titles:phase.titles,dayIndex:i+1,phaseDays:phase.days,date:d,endDate:d,time:'08:00',endTime:'17:00',workerId:worker?.id||'',status:'draft',progress:0,details:'',checks:phase.checks.map(text=>({text,done:false})),dependencies:i===0?previous:[phaseTasks.at(-1)],materials,estimated:true,public:true});phaseTasks.push(id);last=d;d=shiftWork(d,1,p);
  }
  p.schedule.push({id:phase.id,title:phase.titles[0],titles:phase.titles,start:first,end:last,days:phase.days,worker:worker?.name||'',skill:phase.skill});previous=[phaseTasks.at(-1)];
 }
 log(p,'plan','生成工作日计划草稿；数量与工期需现场核定');return p.tasks;
}
function title(t,lang='zh'){return t.titles?.[languages.indexOf(lang)]?(t.titles[languages.indexOf(lang)]+(t.dayIndex?' · '+t.dayIndex+'/'+t.phaseDays:'')):t.title;}
function taskEnd(t){return stamp(t.endDate||t.date,t.endTime);}
function blockers(p,t){return (t.dependencies||[]).map(id=>p.tasks.find(x=>x.id===id)).filter(d=>d&&d.status!=='done');}
function progress(p){let tasks=p.tasks.filter(t=>t.status!=='cancelled');return tasks.length?Math.round(tasks.reduce((n,t)=>n+(t.status==='done'?100:Math.min(99,t.progress||0)),0)/tasks.length):0;}
function alerts(w,now=Date.now()){
 let a=[];for(let p of w.projects){const add=(level,code,text,taskId=null)=>a.push({id:p.id+code+(taskId||text),projectId:p.id,level,code,text,taskId});
  for(let t of p.tasks){if(['done','cancelled'].includes(t.status))continue;
   if(t.status!=='draft'&&taskEnd(t)<now)add('danger','overdue','任务已过计划完成时间：'+t.title,t.id);
   if(t.status==='assigned'&&stamp(t.date,t.time)<now)add('warning','unread','已到开工时间但尚未接单：'+t.title,t.id);
   if(!t.workerId&&stamp(t.date,t.time)<=now+168*36e5)add('warning','unassigned','任务未指定负责人：'+t.title,t.id);
   if(t.status==='blocked')add('danger','blocked','现场受阻：'+t.title+'；'+(t.blockReason||''),t.id);
   for(let d of blockers(p,t))if(stamp(t.date,t.time)<taskEnd(d))add('danger','dependency','工序时间冲突：'+t.title+' 早于前置任务结束',t.id);
   if(t.status==='review')add('info','review','任务等待验收：'+t.title,t.id);
  }
  for(let f of forecast(p,168,now)){if(!f.known)add('warning','unknown_stock','库存待盘点：'+f.name);else if(f.shortage>0)add(f.firstShort<=now+48*36e5?'danger':'warning','shortage','材料缺口：'+f.name+' '+f.shortage+' '+f.unit+(f.latestOrder&&f.latestOrder<today(new Date(now))?'（已超过建议下单日）':''));}
  for(let r of p.requests){if(r.status==='pending')add(r.urgent?'danger':'info','approval','材料待审批：'+r.code+(r.urgent?'（临时追加）':''));if(['ordered','partial'].includes(r.status)&&r.eta&&r.eta<today(new Date(now)))add('warning','late_delivery','到货延误：'+r.code);}
  if(p.estimatesChanged)add('warning','estimate_changed','图纸或面积已修改，请复核任务材料量；现有排班已保留。');
 }
 let jobs=w.projects.flatMap(p=>p.tasks.filter(t=>t.workerId&&!['done','cancelled','draft'].includes(t.status)&&stamp(t.date,t.time)<=now+168*36e5&&taskEnd(t)>=now).map(t=>({p,t,worker:p.project.workers.find(x=>x.id===t.workerId),start:stamp(t.date,t.time),end:taskEnd(t)}))).sort((a,b)=>a.start-b.start);
 let conflictCount=0;outer:for(let i=0;i<jobs.length;i++)for(let j=i+1;j<jobs.length&&jobs[j].start<jobs[i].end;j++){let x=jobs[i],y=jobs[j],same=x.worker?.email&&y.worker?.email?x.worker.email.toLowerCase()===y.worker.email.toLowerCase():x.worker?.name?.trim().toLowerCase()===y.worker?.name?.trim().toLowerCase();if(same&&x.start<y.end){a.push({id:'conflict'+x.t.id+y.t.id,projectId:x.p.id,level:'danger',code:'worker_conflict',taskId:x.t.id,text:'人员排班冲突：'+x.worker?.name+' · '+x.p.project.name+' / '+y.p.project.name+' · '+x.t.date});if(++conflictCount>=250)break outer;}}
 return a.sort((a,b)=>({danger:0,warning:1,info:2}[a.level]-{danger:0,warning:1,info:2}[b.level]));
}
function customerProject(p){let publicTasks=p.tasks.filter(t=>t.public&&t.status!=='draft'&&t.status!=='cancelled');return {id:p.id,name:p.project.name,updatedAt:p.publishedAt,progress:progress({tasks:publicTasks}),tasks:publicTasks.map(t=>({id:t.id,title:t.title,titles:t.titles,dayIndex:t.dayIndex,phaseDays:t.phaseDays,date:t.date,endDate:t.endDate,time:t.time,endTime:t.endTime,status:t.status,progress:t.progress,details:t.clientDetails||''})),updates:p.clientUpdates.filter(u=>u.published).map(u=>({id:u.id,date:u.date,text:u.text,photos:u.photos||[]}))};}
root.YuanCore={VERSION,languages,clone,uid,round,number,date,day,today,stamp,workday,nextWork,shiftWork,phaseDefs,pointKinds,point,project,workspace,validate,catalog,stock,netIssued,taskMaterials,forecast,log,move,receive,generatePlan,title,taskEnd,blockers,progress,alerts,customerProject};
})(globalThis);

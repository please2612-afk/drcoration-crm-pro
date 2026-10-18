(function(root){
'use strict';
const copy={
 zh:{title:'施工助手',customer:'进度解释与建议',rules:'本地规则检查',ai:'AI 分析',ask:'获取 AI 建议',refresh:'重新分析',loading:'正在分析…',question:'想了解什么？（选填）',placeholder:'例如：这项工序为什么要先验收？',disclaimer:'建议供核对，最终由负责人确认。',unavailable:'AI 暂不可用，规则提示仍然有效。',unconfigured:'尚未配置 AI 接口，当前使用本地规则。',stale:'项目已更新，请重新分析。',unsynced:'当前修改尚未同步，AI 分析的是云端已保存版本。',clear:'当前没有发现明显异常；仍需按现场情况核对。',progress:'进度按已公开任务的完成比例计算；100% 上报后仍需负责人验收。',next:'建议查看下一项施工安排，提前确认现场通行、选材和需要配合的时间。',blocked:'有已公开任务受阻，建议向负责人确认原因、处理方案及后续时间。',review:'有任务等待验收，验收通过后才算最终完成，请确认检查记录。',empty:'尚无公开施工安排，可联系负责人确认何时发布计划。',updated:'公开进度超过 7 天未更新，建议联系负责人核实最新安排。'},
 es:{title:'Asistente de obra',customer:'Explicaciones y consejos',rules:'Comprobación local',ai:'Análisis IA',ask:'Consultar a la IA',refresh:'Volver a analizar',loading:'Analizando…',question:'¿Qué desea saber? (opcional)',placeholder:'Por ejemplo: ¿por qué se revisa esta fase primero?',disclaimer:'El responsable debe comprobar y confirmar las decisiones.',unavailable:'IA no disponible. Se mantienen los avisos locales.',unconfigured:'Sin API de IA configurada. Se usan reglas locales.',stale:'El proyecto ha cambiado. Vuelva a analizar.',unsynced:'Hay cambios sin sincronizar. La IA analiza la versión guardada en la nube.',clear:'No se detectan anomalías evidentes. Compruebe la situación en obra.',progress:'El progreso se calcula con las tareas publicadas. Un informe al 100% aún necesita validación.',next:'Revise el próximo trabajo y confirme acceso, materiales y horarios de colaboración.',blocked:'Hay trabajos bloqueados. Consulte el motivo, la solución y las nuevas fechas.',review:'Hay trabajos pendientes de validación. Consulte las comprobaciones antes de dar por terminado.',empty:'No hay planificación pública. Consulte al responsable cuándo se publicará.',updated:'Sin novedades públicas desde hace más de 7 días. Confirme la planificación actual.'},
 en:{title:'Site assistant',customer:'Progress explained',rules:'Local rule checks',ai:'AI analysis',ask:'Get AI advice',refresh:'Analyze again',loading:'Analyzing…',question:'What would you like to know? (optional)',placeholder:'For example: why must this stage be inspected first?',disclaimer:'The project manager must check and confirm decisions.',unavailable:'AI is unavailable. Local checks remain active.',unconfigured:'No AI API configured. Using local rules.',stale:'The project has changed. Analyze again.',unsynced:'There are unsynced changes. AI uses the saved cloud version.',clear:'No obvious issues detected. Check actual site conditions.',progress:'Progress uses published tasks. A 100% report still needs manager approval.',next:'Check the next task and confirm access, material choices and any time you need to be available.',blocked:'Published work is blocked. Ask the manager about the cause, solution and revised dates.',review:'Work is awaiting inspection. Confirm the checks before treating it as complete.',empty:'No schedule has been published. Ask your manager when it will be available.',updated:'Public progress has not been updated for over 7 days. Confirm the latest schedule.'},
 hi:{title:'साइट सहायक',customer:'प्रगति और सुझाव',rules:'स्थानीय जाँच',ai:'AI विश्लेषण',ask:'AI से सलाह लें',refresh:'फिर विश्लेषण करें',loading:'विश्लेषण जारी…',question:'आप क्या जानना चाहते हैं? (वैकल्पिक)',placeholder:'जैसे: इस चरण की पहले जाँच क्यों ज़रूरी है?',disclaimer:'प्रभारी निर्णय की जाँच और पुष्टि करें।',unavailable:'AI उपलब्ध नहीं है। स्थानीय जाँच चालू है।',unconfigured:'AI API कॉन्फ़िगर नहीं है। स्थानीय नियम लागू हैं।',stale:'परियोजना बदल गई है। फिर विश्लेषण करें।',unsynced:'बदलाव सिंक नहीं हुए हैं। AI क्लाउड में सहेजे डेटा का उपयोग करता है।',clear:'कोई स्पष्ट समस्या नहीं मिली। साइट की स्थिति जाँचें।',progress:'प्रगति प्रकाशित काम पर आधारित है। 100% रिपोर्ट को भी प्रभारी की जाँच चाहिए।',next:'अगला काम देखें और पहुँच, सामग्री तथा समय की पुष्टि करें।',blocked:'प्रकाशित काम रुका है। प्रभारी से कारण, समाधान और नई तारीख पूछें।',review:'काम की जाँच बाकी है। पूरा मानने से पहले जाँच की पुष्टि करें।',empty:'कोई योजना प्रकाशित नहीं है। प्रभारी से पूछें।',updated:'7 दिनों से सार्वजनिक अपडेट नहीं है। नई योजना की पुष्टि करें।'}
};
const text=(lang,key)=> (copy[lang]||copy.zh)[key]||copy.zh[key];
function publicData(p,C){return p.clientData||C.customerProject(p);}
function customerHints(p,C,lang='zh',now=Date.now()){
 const data=publicData(p,C),tasks=data.tasks||[],out=[{code:'progress_explained',level:'info',text:text(lang,'progress')}];
 if(!tasks.length)out.push({code:'no_public_plan',level:'info',text:text(lang,'empty')});
 else out.push({code:'next_step',level:'info',text:text(lang,'next')});
 if(tasks.some(t=>t.status==='blocked'))out.push({code:'public_blocked',level:'warning',text:text(lang,'blocked')});
 if(tasks.some(t=>t.status==='review'))out.push({code:'public_review',level:'info',text:text(lang,'review')});
 if(data.updatedAt&&now-Date.parse(data.updatedAt)>7*864e5)out.push({code:'stale_update',level:'warning',text:text(lang,'updated')});
 return out;
}
function inputHints(values,baseline={},kind='project'){
 const out=[],add=(code,field,text)=>out.push({code,field,level:'warning',text});
 if(kind==='project'){
  const area=Number(values.area),floor=Number(values.floor),wall=Number(values.wall);
  if(area>0&&floor>area*1.5)add('floor_ratio','floor','地板面积超过建筑面积的 1.5 倍，请检查单位、小数点或是否包含多层施工。');
  if(area>0&&wall>area*10)add('wall_ratio','wall','墙面面积超过建筑面积的 10 倍，请核实测量范围和单位。');
  for(const key of ['area','floor','wall','route','budget']){const old=Number(baseline[key]),value=Number(values[key]);if(old>0&&Number.isFinite(value)&&(value>old*3||value<old*.2))add('large_change_'+key,key,'此项数值与原记录相差较大，请核对是否误添或漏输数字。');}
 }
 if(kind==='order'&&values.eta&&values.needDate&&values.eta>values.needDate)add('late_order','eta','预计到货晚于使用日期，建议先与供应商确认加急或调整施工顺序。');
 if(kind==='progress'&&Number(values.progress)<Number(baseline.progress))add('progress_drop','progress','进度低于上次报告，请确认是否为整改、范围变化或输入错误。');
 return out;
}
function hints(p,C,{role='owner',language='zh',focus='overview',focusId='',now=Date.now()}={}){
 if(role==='customer')return customerHints(p,C,language,now);
 const out=C.alerts({projects:[p]},now).filter(a=>!focusId||a.taskId===focusId||!a.taskId).slice(0,12);let committed=0;
 if(role==='owner'){
  out.push(...inputHints(p.project));
  committed=p.requests.filter(r=>['approved','ordered','partial','received'].includes(r.status)).reduce((sum,r)=>sum+r.lines.reduce((n,l)=>n+l.qty*(l.price||0),0),0);
  if(p.project.budget>0&&committed>p.project.budget)out.unshift({code:'budget_exceeded',level:'danger',text:'已批准采购金额超过项目预算，建议核对增项、数量及单价后再批准采购。'});
 }
 if(focus==='approval'){
  const r=p.requests.find(r=>r.id===focusId);
  if(r){const cat=C.catalog(p);let total=0,priced=true;
   for(const l of r.lines){const m=cat.find(m=>m.id===l.materialId);if(l.price==null)priced=false;total+=l.qty*(l.price||0);
    if(m?.estimate>0&&l.qty>m.estimate*2)out.unshift({code:'quantity_outlier',level:'warning',text:(m.name||'材料')+'申请量超过项目粗估量的 2 倍，建议核实单位、损耗和重复申请。'});
    if(m?.price>0&&l.price>m.price*3)out.unshift({code:'price_outlier',level:'warning',text:(m.name||'材料')+'单价超过参考价的 3 倍，请确认规格、包装和小数点。'});
   }
   if(!priced)out.unshift({code:'unpriced',level:'warning',text:'存在未填写单价的采购明细，金额尚未确定，建议取得报价后再批准。'});
   if(role==='owner'&&p.project.budget>0&&total>p.project.budget*.2)out.unshift({code:'major_purchase',level:'warning',text:'本次采购超过项目预算的 20%，建议核对预算余量和报价。'});
   if(role==='owner'&&r.status==='pending'&&p.project.budget>0&&total+committed>p.project.budget)out.unshift({code:'budget_after_approval',level:'danger',text:'批准本次采购后，累计已批准金额将超过项目预算，请先核对增项和预算调整。'});
  }
 }
 if(focus==='review')out.unshift({code:'review_decision',level:'info',text:'验收前请核对现场照片、检查项及测试记录；隐蔽工程封闭前应由负责人确认。'});
 if(focus==='publish'&&!p.approved)out.unshift({code:'drawing_unverified',level:'warning',text:'图纸尚未复核，请在发布施工任务前核实点位、尺寸和材料估算。'});
 return out.slice(0,12);
}
// Only explicitly selected fields leave the server. No images, emails, members or audit logs.
function context(p,C,options={}){
 const {role='owner',language='zh',focus='overview',focusId=''}=options;
 if(role==='customer'){
  const data=publicData(p,C);
  return {role,language,focus,project:{name:String(data.name||'').slice(0,150),progress:data.progress,updatedAt:data.updatedAt},tasks:(data.tasks||[]).slice(0,24).map(t=>({title:String(t.title||'').slice(0,160),date:t.date,endDate:t.endDate,status:t.status,progress:t.progress,details:String(t.details||'').slice(0,300)})),updates:(data.updates||[]).slice(-5).map(u=>({date:u.date,text:String(u.text||'').slice(0,300)})),checks:customerHints(p,C,language)};
 }
 const tasks=[...p.tasks].sort((a,b)=>(b.id===focusId)-(a.id===focusId)||a.date.localeCompare(b.date));
 const request=focus==='approval'?p.requests.find(r=>r.id===focusId):null;
 return {role,language,focus,project:{name:String(p.project.name||'').slice(0,150),start:p.project.start,approved:p.approved,progress:C.progress(p),...(role==='owner'?{budget:p.project.budget}:{})},tasks:tasks.slice(0,24).map(t=>({id:t.id,title:String(t.title).slice(0,160),date:t.date,endDate:t.endDate,status:t.status,progress:t.progress,details:String(t.details||'').slice(0,300),checks:(t.checks||[]).slice(0,8).map(c=>({text:String(c.text||'').slice(0,240),done:c.done===true})),dependencies:(t.dependencies||[]).slice(0,24)})),...(request?{purchase:{code:request.code,needDate:request.needDate,status:request.status,lines:request.lines.slice(0,30).map(l=>({materialId:l.materialId,qty:l.qty,...(role==='owner'?{price:l.price}:{})}))}}:{}),checks:hints(p,C,options).map(h=>({code:h.code,level:h.level,text:String(h.text).slice(0,300)}))};
}
root.YuanAdvisor={text,inputHints,hints,context};
})(globalThis);

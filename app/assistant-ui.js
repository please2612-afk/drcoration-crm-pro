'use strict';
const Advisor=globalThis.YuanAdvisor,adviceCache=new Map();
let aiStatusPromise=null,aiStatusCheckedAt=0;
const adviceText=key=>Advisor.text(lang,key);
function getAIStatus(){
 if(!aiStatusPromise||Date.now()-aiStatusCheckedAt>30000){aiStatusCheckedAt=Date.now();aiStatusPromise=api('/api/ai/status').catch(()=>{aiStatusPromise=null;return {configured:false};});}
 return aiStatusPromise;
}
const activeAdvicePanel=panel=>panel?.isConnected&&(!panel.closest('dialog')||panel.closest('dialog').open);
function adviceProposal(panel){
 if(!ownerRole||panel.dataset.focus==='customer')return null;
 const form=panel.closest('form')||document.getElementById('projectForm');if(!form)return null;
 if(form.id==='projectForm'){
  const project={};for(const name of ['area','floor','wall','route','budget']){const value=form.elements[name]?.value;if(value==null||value.trim()===''||!Number.isFinite(Number(value)))return null;if(Number(value)!==Number(state.project[name]))project[name]=Number(value);}
  return Object.keys(project).length?{project}:null;
 }
 if(panel.dataset.focus==='approval'){
  const lines=[...form.querySelectorAll('.material-line')].map(row=>({materialId:row.querySelector('[name=materialId]').value,qty:Number(row.querySelector('[name=materialQty]').value),price:row.querySelector('[name=materialPrice]').value===''?null:Number(row.querySelector('[name=materialPrice]').value)}));
  if(!lines.length||lines.some(l=>!Number.isFinite(l.qty)||l.price!==null&&!Number.isFinite(l.price)))return null;
  return {purchase:{id:panel.dataset.focusId,lines}};
 }
 return null;
}
function scheduleAdvice(panel){
 if(!panel||serverRole==='local')return;clearTimeout(panel.adviceTimer);
 panel.adviceTimer=setTimeout(async()=>{if(!activeAdvicePanel(panel))return;const status=await getAIStatus();if(status.configured&&activeAdvicePanel(panel))askAI(panel.querySelector('[data-action="askAI"]'));},1200);
}
function hintListHTML(items){return items.length?items.map(h=>`<li class="advice-item ${h.level==='danger'?'risk':'info'}"><span class="advice-dot" aria-hidden="true"></span><span>${esc(h.text)}</span></li>`).join(''):`<li>${esc(adviceText('clear'))}</li>`;}
function assistantPanelHTML(focus='overview',focusId=''){
 const role=focus==='customer'?'customer':serverRole==='local'?'owner':serverRole;
 const items=Advisor.hints(state,C,{role,language:lang,focus,focusId});
 return `<section class="assistant-panel" data-advice-panel data-focus="${esc(focus)}" data-focus-id="${esc(focusId)}" data-project="${esc(state.id)}" aria-label="${esc(adviceText('title'))}"><div class="row between"><div><span class="eyebrow">YUAN ASSIST</span><h2>${esc(adviceText(focus==='customer'?'customer':'title'))}</h2></div><span class="badge info">${esc(adviceText('rules'))}</span></div><ul class="advice-list" data-rule-hints>${hintListHTML(items)}</ul><div data-input-hints aria-live="polite"></div><details class="advice-question"><summary>${esc(adviceText('question'))}</summary><textarea data-ai-question maxlength="600" rows="2" aria-label="${esc(adviceText('question'))}" placeholder="${esc(adviceText('placeholder'))}"></textarea></details><div class="row between"><small class="muted">${esc(adviceText('disclaimer'))}</small>${button(adviceText('ask'),'askAI','','quiet')}</div><div class="ai-result" data-ai-result role="status" aria-live="polite"></div></section>`;
}
function adviceKey(panel){return JSON.stringify([panel.dataset.project,serverRole,lang,cloudRevision,localRevision,panel.dataset.focus,panel.dataset.focusId]);}
async function askAI(buttonElement){
 const panel=buttonElement.closest('[data-advice-panel]');if(!activeAdvicePanel(panel))return;
 const proposal=adviceProposal(panel),draft=JSON.stringify(proposal),result=panel.querySelector('[data-ai-result]'),question=panel.querySelector('[data-ai-question]').value.trim(),key=adviceKey(panel)+draft,projectId=state.id,language=lang,revision=cloudRevision,localBefore=localRevision;
 if(serverRole==='local'){result.textContent=adviceText('unconfigured');return;}
 const cached=adviceCache.get(key+question);
 if(cached&&cached.until>Date.now()){renderAIResult(panel,cached.data);return;}
 if(panel.dataset.busy==='true')return;panel.dataset.busy='true';buttonElement.disabled=true;panel.setAttribute('aria-busy','true');result.textContent=adviceText('loading');
 try{
  const data=await api('/api/ai/advice',{method:'POST',body:JSON.stringify({projectId,language,focus:panel.dataset.focus,focusId:panel.dataset.focusId,question,...(proposal?{proposal}:{})}),timeout:14000});
  if(!activeAdvicePanel(panel)||state.id!==projectId||lang!==language)return;
  if(cloudRevision!==revision||localRevision!==localBefore||data.revision!==cloudRevision||data.projectId!==projectId||JSON.stringify(adviceProposal(panel))!==draft||panel.querySelector('[data-ai-question]').value.trim()!==question){result.textContent=adviceText('stale');return;}
  renderAIResult(panel,data);adviceCache.set(key+question,{data,until:Date.now()+(data.source==='ai'?120000:15000)});while(adviceCache.size>50)adviceCache.delete(adviceCache.keys().next().value);
 }catch{if(panel.isConnected)result.textContent=adviceText('unavailable');}
 finally{delete panel.dataset.busy;panel.removeAttribute('aria-busy');if(buttonElement.isConnected){buttonElement.disabled=false;buttonElement.textContent=adviceText('refresh');if(JSON.stringify(adviceProposal(panel))!==draft)scheduleAdvice(panel);}}
}
function renderAIResult(panel,data){
 const target=panel.querySelector('[data-ai-result]');
 // Plain text output prevents provider content from becoming executable markup.
 target.textContent=data.source==='ai'?adviceText('ai')+'\n'+data.explanation:adviceText(data.reason==='not_configured'?'unconfigured':'unavailable');
 if(data.draft)target.textContent+='\n'+({zh:'包含尚未保存的输入预案，仅供核对，不会修改项目数据。',es:'Incluye cambios sin guardar. Solo para revisión; no modifica el proyecto.',en:'Includes an unsaved proposal for review; project data is unchanged.',hi:'बिना सहेजे प्रस्ताव शामिल है। इससे परियोजना का डेटा नहीं बदलता।'}[lang]);
 else if(workspace._sync?.pending||panel.closest('dialog'))target.textContent+='\n'+adviceText('unsynced');
}
function wireAssistant(){
 for(const panel of document.querySelectorAll('[data-advice-panel]')){
  if(!activeAdvicePanel(panel))continue;
  const buttonElement=panel.querySelector('[data-action="askAI"]');
  if(serverRole!=='local'&&['customer','publish','approval','review'].includes(panel.dataset.focus)){
   getAIStatus().then(status=>{if(status.configured&&activeAdvicePanel(panel)&&!panel.querySelector('[data-ai-question]').value.trim())askAI(buttonElement);});
  }
 }
 const dialog=document.getElementById('modal');
 const form=dialog.open?dialog.querySelector('form'):document.getElementById('projectForm');
 if(!form?.elements)return;
 if(form.adviceUpdate){form.adviceUpdate();return;}
 const update=()=>{
  const data=new FormData(form),kind=form.id==='projectForm'?'project':form.querySelector('[name=eta]')?'order':form.querySelector('[name=progress]')?'progress':'';
  const values=Object.fromEntries(data),baseline=kind==='progress'?state.tasks.find(t=>t.id===form.dataset.taskId)||{}:state.project;
  if(kind==='order')values.needDate=form.dataset.needDate;
  let items=kind?Advisor.inputHints(values,baseline,kind):[];
  if(kind==='project'){
   let target=form.querySelector('[data-project-hints]');if(!target){target=document.createElement('div');target.dataset.projectHints='';target.setAttribute('aria-live','polite');form.querySelector('[type=submit],button.primary').before(target);}
   target.innerHTML=items.length?`<ul class="advice-list input-hints">${hintListHTML(items)}</ul>`:'';
  }else{
   const panel=form.querySelector('[data-advice-panel]');
   if(panel?.dataset.focus==='approval'){
    const preview=C.clone(state),request=preview.requests.find(r=>r.id===panel.dataset.focusId);
    if(request){request.lines=[...form.querySelectorAll('.material-line')].map(row=>({materialId:row.querySelector('[name=materialId]').value,qty:Number(row.querySelector('[name=materialQty]').value),price:row.querySelector('[name=materialPrice]').value===''?null:Number(row.querySelector('[name=materialPrice]').value)}));panel.querySelector('[data-rule-hints]').innerHTML=hintListHTML(Advisor.hints(preview,C,{role:'owner',language:lang,focus:'approval',focusId:request.id}));}
   }
   let target=panel?.querySelector('[data-input-hints]')||form.querySelector('[data-live-hints]');
   if(!target&&kind){target=document.createElement('div');target.dataset.liveHints='';target.setAttribute('aria-live','polite');form.querySelector('.form-actions').before(target);}
   if(target)target.innerHTML=items.length?`<ul class="advice-list input-hints">${hintListHTML(items)}</ul>`:'';
  }
 };
 form.adviceUpdate=update;
 form.addEventListener('input',event=>{form.dataset.dirty='true';clearTimeout(form.adviceTimer);form.adviceTimer=setTimeout(()=>{update();if(!event.target.matches('[data-ai-question]')){const panel=form.querySelector('[data-advice-panel]')||document.querySelector('[data-advice-panel]');if(panel&&(form.querySelector('.input-hints')||panel.dataset.focus==='approval'))scheduleAdvice(panel);}},180);});
 update();
}

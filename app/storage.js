(function(root){
'use strict';
let db=null,writeQueue=Promise.resolve();
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function open(){if(db)return db;db=await new Promise((resolve,reject)=>{const r=indexedDB.open('yuan-build-os',1);r.onupgradeneeded=()=>{r.result.createObjectStore('workspace');r.result.createObjectStore('recovery',{keyPath:'revision'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('请关闭旧版窗口后重试'));});db.onversionchange=()=>{db.close();db=null;};return db;}
async function read(){let d=await open();return req(d.transaction('workspace','readonly').objectStore('workspace').get('current'));}
function save(value,expected){let job=writeQueue.catch(()=>{}).then(async()=>{let d=await open();return new Promise((resolve,reject)=>{let tx=d.transaction(['workspace','recovery'],'readwrite'),s=tx.objectStore('workspace'),r=s.get('current'),revision;let specific=null;r.onsuccess=()=>{let old=r.result;if((old?.revision||0)!==expected){specific=Error('另一窗口已更新数据。请先导出当前备份，再载入最新数据。');specific.code='CONFLICT';tx.abort();return;}revision=expected+1;const next=structuredClone(value);next.revision=revision;next.savedAt=new Date().toISOString();s.put(next,'current');if(old)tx.objectStore('recovery').put(old);let keys=tx.objectStore('recovery').getAllKeys();keys.onsuccess=()=>keys.result.sort((a,b)=>a-b).slice(0,-3).forEach(k=>tx.objectStore('recovery').delete(k));};tx.oncomplete=()=>resolve(revision);tx.onerror=()=>reject(specific||tx.error||Error('保存失败'));tx.onabort=()=>reject(specific||tx.error||Error('保存被中断'));});});writeQueue=job;return job;}
async function recoveries(){let d=await open();return req(d.transaction('recovery','readonly').objectStore('recovery').getAll());}
root.YuanStore={open,read,save,recoveries};
})(globalThis);

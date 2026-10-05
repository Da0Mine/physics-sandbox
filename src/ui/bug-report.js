/* Bug 提交框 */
import { bugbox, bugclose, bugdesc, bugdl, buginfo, bugmask, bugstatus, bugsubmit } from '../core/dom.js';
import { REC, recDump, recPayload } from './recorder.js';

/* Bug 提交（弹框写说明 → POST 到后端）。
 * 端点契约：POST <BUG_ENDPOINT>，body = {"desc":"...","rec":{…录制 JSON…}}，
 * 返回 {"ok":true,"id":"..."} 或 {"ok":false,"err":"..."}。BUG_ENDPOINT 留空 = 只支持下载。 */
export const BUG_ENDPOINT='https://sandbox-bug-api.pages.dev/submit';
export function openBugDlg(){
  var s='';
  try{s=JSON.stringify(recPayload());}catch(e){s='';}
  if(buginfo)buginfo.textContent='本次记录：'+REC.frames.length+' 帧 / '+REC.events.length
    +' 个操作 / '+Math.round(s.length/1024)+' KB';
  if(bugstatus)bugstatus.textContent='';
  if(bugmask)bugmask.classList.add('on');
  if(bugbox)bugbox.classList.add('on');
  if(bugdesc)bugdesc.focus();
}
export function closeBugDlg(){
  if(bugmask)bugmask.classList.remove('on');
  if(bugbox)bugbox.classList.remove('on');
}
export function bugSubmit(){
  var desc=(bugdesc&&bugdesc.value?bugdesc.value:'').trim();
  if(!desc){if(bugstatus)bugstatus.textContent='请先写一句说明（做了什么 / 期望 / 实际）。';return;}
  if(!BUG_ENDPOINT){if(bugstatus)bugstatus.textContent=
    '服务器地址还没配置 —— 可先点「仅下载文件」把文件发给我，等 Worker 部署好后我再把地址填上。';return;}
  var s='';
  try{s=JSON.stringify(recPayload());}catch(e){s='';}
  if(!s){if(bugstatus)bugstatus.textContent='录制内容为空，没什么可提交的。';return;}
  /* 直接拼串，不 JSON.parse 再 stringify：录制 JSON 可能有几 MB，二次编码浪费内存、放大体积。 */
  var body='{"desc":'+JSON.stringify(desc)+',"rec":'+s+'}';
  if(bugstatus)bugstatus.textContent='提交中……（'+Math.round(body.length/1024)+' KB）';
  if(bugsubmit)bugsubmit.disabled=true;
  fetch(BUG_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:body})
    .then(function(r){return r.json().catch(function(){return {ok:r.ok,err:'HTTP '+r.status};});})
    .then(function(j){
      if(bugsubmit)bugsubmit.disabled=false;
      if(j&&j.ok){if(bugstatus)bugstatus.textContent='已提交（编号 '+(j.id||'?')+'）。可以关掉这个框了，谢谢！';}
      else{if(bugstatus)bugstatus.textContent='提交失败：'+((j&&j.err)||'服务器返回异常')+'（可点「仅下载文件」）。';}
    })
    .catch(function(e){
      if(bugsubmit)bugsubmit.disabled=false;
      if(bugstatus)bugstatus.textContent='提交失败：'+((e&&e.message)||e)+'（可点「仅下载文件」）。';
    });
}

export function setupUiBugReport(){
  if(bugmask)bugmask.addEventListener('click',closeBugDlg);
  if(bugclose)bugclose.addEventListener('click',closeBugDlg);
  if(bugdl)bugdl.addEventListener('click',function(){recDump();});
  if(bugsubmit)bugsubmit.addEventListener('click',bugSubmit);
}

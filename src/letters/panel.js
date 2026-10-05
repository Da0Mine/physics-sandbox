/* 右上角符号面板：停靠、排序、槽位布局 */
import { app } from '../state.js';
import { killLetter } from '../bodies/body.js';
import { DD, freeL, panel } from '../core/dom.js';
import { placeLetter } from './layout.js';

/* 面板第 1 行第 4 格留给把手（否则展开后挡住字符 a），第 4 个字符换到第 2 行开头，后续顺延。
 * CSS 规则在 auto-placement 下不生效 ⇒ 用内联样式直接定位（见 fixPanelSlot）。 */
/* 把手精确对齐到面板第 1 行第 4 格（同尺寸 44×44、同圆角 10、同一格位置）。 */
export function alignPanelToggle(){
  var pan=DD.getElementById('panel'),tg=DD.getElementById('panelToggle');
  if(!pan||!tg)return;
  if(!DD.body.classList.contains('touch-ui'))return;
  /* 触屏折叠态下面板的 getBoundingClientRect 是折叠后的位置，拿不到格子坐标 ⇒ 用固定布局计算：
   * 面板固定在 top:24/right:24，padding 10，格 44 + gap 6 ⇒ 第 1 行第 4 格 = 右起 (24+10+44)、上起 (24+10)。 */
  tg.style.left=(window.innerWidth-24-10-44)+'px';
  tg.style.top=(24+10)+'px';
  tg.style.right='auto';
}
export function fixPanelSlot(){
  var pan=DD.getElementById('panel');if(!pan)return;
  /* 与 sortPanel / dockSlotEl 共用同一个「序号 → 格」规则：按 DOCK_ORDER 逐个钉格。
   * 不要按 DOM 现有孩子顺序顺排：那是第二套槽位规则，清屏时 sortPanel 与 setTimeout(fixPanelSlot,0)
   * 先后各摆一遍，第 4 个字符会闪一帧错位；顺排还会让黑洞吃掉一个字符后，后面的整体前移。
   * 钉格则只留一个空格、其余不动。 */
  var arr=[].slice.call(pan.children);
  for(var i=0;i<arr.length;i++){var c=arr[i];if(c&&c.style)dockSlotEl(c);}
}
export function dockedTwins(ch,me){
  var els=panel.querySelectorAll('.char');
  for(var i=0;i<els.length;i++){
    var e=els[i];
    if(e===me)continue;
    if(e.textContent===ch){
      var r=e._letterRef;
      if(r&&r.state==='dock')return true;
    }
  }
  return false;
}
/* 字符参数的默认值表，与面板（dock）单例分开：
 *  · 面板上改参数 ⇒ 记进 CHAR_DEF[字符]，不碰 dock 单例（dock 单例的数值不许被写回，否则后续拖出的同名字符全被改）；
 *  · 世界里的字符改参数 ⇒ 只写它自己；
 *  · 从面板拖出克隆时 ⇒ 先用 CHAR_DEF 补齐缺省字段（否则面板上调好的 q 电荷，新拖出的 q 仍是默认 1）。
 * 于是「改面板 = 定后续克隆的默认」与「改实例 = 只影响它」同时成立。 */
export const CHAR_DEF={};
export function charDefWrite(letter,key,val){
  if(!letter||!letter.ch)return;
  if(!CHAR_DEF[letter.ch])CHAR_DEF[letter.ch]={};
  CHAR_DEF[letter.ch][key]=val;
}
/* 给新造的克隆补齐 CHAR_DEF 里的默认值。只补缺省字段（不覆盖克隆自己已带的值，
 也不覆盖世界里那个字符的实例值），字段名与 gdDown 克隆分支的拷贝清单一致。 */
export function charDefFill(d){
  if(!d||!d.ch)return;
  var cd=CHAR_DEF[d.ch];if(!cd)return;
  for(var k in cd){
    if(cd[k]==null)continue;
    if(typeof d[k]==='undefined')d[k]=cd[k];
  }
}
export function dockLetter(d){
  // the palette always keeps one docked copy of each letter (dragging a docked letter grabs
  // a clone of it). So docking a CLONE here would stack a duplicate — let it dissolve back
  // into the palette instead. Only a letter whose docked copy has LEFT (e.g. eaten by a
  // black hole) may dock again and refill its empty slot.
  if(dockedTwins(d.ch,d.el)){
    d.body=null;d.inBody=false;
    killLetter(d);
    return;
  }
  d.state='dock';d.body=null;d.inBody=false;
  var e=d.el;
  if(e.parentNode!==panel)panel.appendChild(e);
  e.style.display='';
  e.style.fontSize='34px';
  e.style.left='';e.style.top='';e.style.transform='';
  e.style.opacity='';
  e.classList.remove('dockin');
  e.classList.add('dockin');
  setTimeout(function(){if(d.state==='dock')e.classList.remove('dockin');},240);
  sortPanel();
}
export const DOCK_ORDER={'m':0,'M':1,'g':2,'a':3,'v':4,'r':5,'½':6,'μ':7,'c':8,'G':9,'t':10,'B':11,'E':12,'q':13,'I':14,'k':15,'x':16};
export function dockSlotEl(e){
  var i=DOCK_ORDER[e.textContent];
  if(i==null)return;
  /* 序号 → 格的唯一真源，fixPanelSlot 与 sortPanel 共用：第 1 行只放 3 个（第 4 格留给 #panelToggle 下拉把手），
   * 之后每行 4 个。两处规则不一致时，清屏会先把字符放到把手下面、再被 fixPanelSlot 拉回，闪一帧。 */
  var row,col;
  if(i<3){row=1;col=i+1;}                       // 第 1 行 3 个，第 4 格留给把手
  else{var k=i-3;row=2+Math.floor(k/4);col=k%4+1;}
  /* 先清掉 gridColumn/gridRow 简写：简写会连带写 end（残留成如 3 / auto），与下面单独设的 start 打架。
   * 统一只用长写。 */
  e.style.gridColumn='';e.style.gridRow='';
  e.style.gridRowStart=String(row);
  e.style.gridColumnStart=String(col);
}
export function sortPanel(){
  var kids=[app.mO,app.M2O,app.gO,app.aO,app.vO,app.rO,app.halfO,app.muO,app.cO,app.GO,app.tO,app.BO,app.EO,app.qO,app.IO];
  for(var i=0;i<kids.length;i++){
    var d=kids[i];
    if(d.state==='dock'&&d.el.parentNode!==panel)panel.appendChild(d.el);
  }
  var arr=[].slice.call(panel.querySelectorAll('.char'));
  arr.sort(function(x,y){return DOCK_ORDER[x.textContent]-DOCK_ORDER[y.textContent];});
  arr.forEach(function(e){panel.appendChild(e);});
  // pin every docked letter to its OWN fixed grid cell, so when a black hole takes a letter
  // the rest do NOT reflow — the eaten letter simply leaves a blank slot in the frame.
  for(var k2=0;k2<arr.length;k2++)dockSlotEl(arr[k2]);
}
export function freeLetter(d,x,y,vx,vy,cat){
  d.body=null;d.inBody=false;d.state='free';
  d.wx=x;d.wy=y;d.vx=vx||0;d.vy=vy||0;d.cat=cat;
  if(freeL.indexOf(d)<0)freeL.push(d);
  d.el.classList.remove('dockin');
  placeLetter(d);
}

export function setupLettersPanel1(){
  /* 触屏面板把手（点按展开/收起符号面板） */
  if(DD.getElementById('panelToggle')){
    DD.getElementById('panelToggle').addEventListener('click',function(ev){
      ev.stopPropagation();
      DD.body.classList.toggle('touch-panel-folded');
      /* 图标用 .ttoggle 同款 SVG，展开/收起用旋转表达 */
      var sv=DD.getElementById('panelToggle');
      if(sv)sv.classList.toggle('open',!DD.body.classList.contains('touch-panel-folded'));
    });
  }
}

export function setupLettersPanel2(){
  window.addEventListener('resize',function(){alignPanelToggle();});
}

export function setupLettersPanel3(){
  setTimeout(fixPanelSlot,600);
  setTimeout(fixPanelSlot,1500);
}

/* 左上角工具栏、提示条、全屏 */
import { DD, cv, dSub, freeL, tRow, tSub, tToggle } from '../core/dom.js';
import { burstParticles, shake } from '../effects/particles.js';
import { openFormulaMenu } from '../formula/presets.js';
import { pointer } from '../input/pointer.js';
import { placeLetter } from '../letters/layout.js';
import { ringGo } from './menu.js';
import { openSettings } from './settings.js';

/* ---- 工具栏（TOOL PALETTE）----
 * 左上角下拉展开三个图标工具：
 *   ① 公式示例 — 屏幕中央的菜单列出所有现成整体，点一个就在画布正中生成；
 *   ② 画笔     — 手绘一条黑色「有重量的边界」；
 *   ③ 预设物体 — 同样的边界，拖出矩形 / 圆 / 三角。
 * 「有重量」：边界在自身重力力矩下绕最低接触点倾倒（质量分布偏心就会翻），无支撑时下落并停在
 *   地面 / 杆 / 其它边界上。重量沿线条分布（B.bndM = 线总长，B.bndI = 线的二阶矩，见 mkBoundary），
 *   不按围出的面积算：只有线条是边界，内部不填充。
 * 「没有惯性，只能被拖动」：除拖动和重力外没有东西能移动边界：场（stepField）、引力井（stepGravity
 *   只处理 kind==null）都忽略它；碰撞只消掉它的向内速度并把它推出（collideBodies），不会把它甩飞。
 *   无水平惯性（vx 钉 0）、不反弹（bounc=0）、松手后不保留速度。
 * 连续绘制：画笔 / 预设物体模式常驻时，每一笔 / 每个形状各成一个边界，工具保持就绪
 *   （finishStroke / finishShapeDrag 不清模式）；再点同一按钮（或形状切换）取消，画布回到抓取。
 */
export const TOOL={open:false,mode:null,shape:'rect',stroke:null,drag:null,
          device:'spring',  // 当前选中的器件（与 shape 同构；器件模式下点画布就放它）
          devDrag:null,     // 从器件面板拖出时跟随指针的落点（{id,x,y,over}）
          cont:false,     // true = 连续绘制（双击进入），false = 只画一次（单击）
          armedKey:null,  // 当前武装的是哪个按钮（'brush' / 'shape:rect'…），双击判定要它
          lastTap:0};     // 上一次点同一个按钮的时间戳
// 单击 = 只画一次；双击 = 连续绘制；再点一次取消。
// 第一次点立即武装（不等双击判定窗口，否则单击要等 330ms 才能用）；窗口内第二次点把同一工具升级为连续，超出窗口再点则取消。
export const TOOL_DBL_MS=330;
/* ---- ② ③ drawing modes ---------------------------------------------------------------- */
export function setToolMode(m){
  TOOL.mode=m;
  if(!m){TOOL.cont=false;TOOL.armedKey=null;}   // 解除武装时顺手清掉连续/双击状态
  // 程序化武装（测试、内部调用）也要写对 armedKey，否则下一次真实点击会被误判成
  // 「同一个按钮又点了一下」。toolTap 随后会用实际按钮的 key 覆盖它（形状行/器件行按钮有自己的 key）。
  else TOOL.armedKey=(m==='brush')?'brush':((m==='device')?('device:'+TOOL.device):('shape:'+TOOL.shape));
  cv.classList.toggle('cur-draw',!!m);
  syncToolUI();
}
// 双击进入连续绘制模式时弹提示：否则用户不知道处于连续模式，每次单击画布都落一个默认图形、叠成一串。
// 提示条 2s 自动消失。
export let _fhT=null;
export function flashHint(msg){
  var el=document.getElementById('fhashint');
  if(!el)return;
  el.textContent=msg;
  el.classList.add('on');
  if(_fhT)clearTimeout(_fhT);
  _fhT=setTimeout(function(){el.classList.remove('on');},2000);
}
/* 在 (x,y) 处冒一行红字代码，上浮 + 横扫 + 淡出，1.9s 后自毁。
 *  · 不用 flashHint：那是屏幕底部居中的固定条（同一时刻只有一条），语义是提示当前模式；这里要表达落点上的错误。
 *  · 元素挂在 <body> 下：canvas 画不出 DOM 文字；面板有 transform，会成为 fixed 后代的包含块（见 #qpop）。
 *  · CSS 里 pointer-events:none，不吃掉随后的手势。
 *  · 返回计数给守卫读（window.__errTipN），实现里没有测试专用分支。 */
export function errTip(x,y,msg){
  var el=DD.createElement('div');
  el.className='errtip';
  el.textContent=msg||'Error';
  el.style.left=Math.round(x)+'px';
  el.style.top=Math.round(y)+'px';
  DD.body.appendChild(el);
  el.classList.add('go');           // 新元素首帧即带动画 ⇒ 不需要强制 reflow
  setTimeout(function(){if(el.parentNode)el.parentNode.removeChild(el);},1900);
  return el;
}
/* 光速 v 落到普通物体/公式上 ⇒ 拒绝赋予：有静止质量的物体不可能被加速到光速。
 * v 不并入、被弹开（同 bossRepel 手感），落点冒一行 error。只拦 vLight，普通 v 照旧走 giveFromLetter。
 * 调用点必须排在 bossTryPlace 之后：½mv² 的召唤通道要先有机会接住它。 */
export function vLightReject(B,d){
  var x=(d&&d.wx!=null)?d.wx:((pointer&&pointer.x!=null)?pointer.x:(B?B.x:0));
  var y=(d&&d.wy!=null)?d.wy:((pointer&&pointer.y!=null)?pointer.y:(B?B.y:0));
  var ux=x-(B?B.x:0),uy=y-(B?B.y:0),L=Math.hypot(ux,uy);
  if(!(L>1)){ux=0;uy=-1;L=1;}
  ux/=L;uy/=L;
  /* 弹开：给 v 一个远离物体的初速度 + 略上抛（同 bossRepel） */
  d.state='free';d.cat=1;d.pop=1;d.massless=false;
  d.wx=x;d.wy=y;
  d.vx=ux*1500;d.vy=uy*1500-360;
  if(freeL.indexOf(d)<0)freeL.push(d);
  placeLetter(d);
  burstParticles(x,y,14,0.7);
  if(B)ringGo(B.x,B.y);
  shake(4,0.22);
  /* 文案只有 'Error'，不加前缀、原因或其他说明（用户明确要求，不要自行添加）。 */
  errTip(x,y,'Error');
  return true;
}
// 单击 = 画一次；双击 = 连续；再单击 = 取消。供 brush / shape 两类按钮共用。
// key 标识哪一个按钮，mode 是要进入的工具模式，extra 交给调用方做下拉框等副作用。
export function toolTap(key,mode,extra){
  var now=performance.now();
  if(TOOL.mode&&TOOL.armedKey===key){
    if(now-TOOL.lastTap<=TOOL_DBL_MS){
      TOOL.cont=true;   // 双击 -> 升级为连续绘制
      // 进连续模式立刻弹提示。器件是点一下放一个，没有拖出尺寸这一步，提示文案不同。
      flashHint((mode==='brush')?'连续模式·一直画，再点按钮取消'
                :((mode==='device')?'连续模式·每点一次放一个器件，再点按钮取消'
                                   :'连续模式·每次拖出形状，单击不落体'));
    }   // 双击 -> 升级为连续绘制
    else{setToolMode(null);}                            // 再点一下（隔开） -> 取消
  }else{
    TOOL.cont=false;                                    // 单击 -> 只画一次
    if(extra)extra();
    setToolMode(mode);
    TOOL.armedKey=key;
  }
  TOOL.lastTap=now;
  syncToolUI();   // 双击升级为连续时只改了 cont，没有走 setToolMode，得自己刷按钮上的 ∞ 角标
}
export function syncToolUI(){
  var brush=tRow.querySelector('[data-tool="brush"]'),shp=tRow.querySelector('[data-tool="shape"]');
  if(brush)brush.classList.toggle('act',TOOL.mode==='brush');
  if(shp)shp.classList.toggle('act',TOOL.mode==='shape');
  if(brush)brush.classList.toggle('cont',TOOL.mode==='brush'&&TOOL.cont);
  if(shp)shp.classList.toggle('cont',TOOL.mode==='shape'&&TOOL.cont);
  var subs=tSub.querySelectorAll('.tbtn');
  for(var i=0;i<subs.length;i++){
    var on=(TOOL.mode==='shape'&&subs[i].getAttribute('data-shape')===TOOL.shape);
    subs[i].classList.toggle('act',on);
    subs[i].classList.toggle('cont',on&&TOOL.cont);
  }
  // 器件按钮与器件 chip：与上面形状那两段对应（行按钮高亮 + 选中的 chip 高亮）。
  var dev=tRow.querySelector('[data-tool="device"]');
  if(dev)dev.classList.toggle('act',TOOL.mode==='device');
  if(dev)dev.classList.toggle('cont',TOOL.mode==='device'&&TOOL.cont);
  var dsubs=dSub.querySelectorAll('.tbtn');
  for(var j=0;j<dsubs.length;j++){
    var onD=(TOOL.mode==='device'&&dsubs[j].getAttribute('data-device')===TOOL.device);
    dsubs[j].classList.toggle('act',onD);
    dsubs[j].classList.toggle('cont',onD&&TOOL.cont);
  }
}
export function setToolsOpen(v){
  TOOL.open=v;
  tRow.classList.toggle('on',v);
  tToggle.classList.toggle('open',v);
  if(!v){tSub.classList.remove('on');dSub.classList.remove('on');setToolMode(null);}
  syncToolUI();
}
/* 浏览器全屏（Fullscreen API）。三处必须处理，否则在不同浏览器上会点了没反应：
 *  ① 前缀：Safari 老版本只有 webkitRequestFullscreen；取实际存在的那个再调（调不存在的属性会抛 TypeError）。
 *  ② 返回值是 Promise：被拒绝时（非用户手势、iframe 没给 allow="fullscreen"）会抛未捕获异常 ⇒ 必须 .catch()。
 *  ③ 状态同步：Esc / F11 / 浏览器 UI 也能退出全屏，监听 fullscreenchange（含 webkit 前缀）反过来刷新按钮外观。 */
export function fsElement(){
  return DD.fullscreenElement||DD.webkitFullscreenElement||null;
}
export function toggleFullscreen(){
  var el=DD.documentElement||DD.body;
  if(!el)return false;
  try{
    if(fsElement()){
      var ex=DD.exitFullscreen||DD.webkitExitFullscreen;
      if(ex){var r1=ex.call(DD);if(r1&&r1.catch)r1.catch(function(){});}
    }else{
      var rq=el.requestFullscreen||el.webkitRequestFullscreen;
      if(rq){var r2=rq.call(el);if(r2&&r2.catch)r2.catch(function(){});}
    }
  }catch(e){return false;}
  syncFullscreenUI();
  return true;
}
/* 按钮外观 = 当前真实全屏态（四角外扩=进全屏 / 四角内收=退全屏） */
export function syncFullscreenUI(){
  var b=DD.getElementById('fsbtn'),ic=DD.getElementById('fsicon');
  if(!b)return;
  var on=!!fsElement();
  b.title=on?'退出全屏':'全屏';
  b.classList.toggle('act',on);
  if(ic){
    ic.innerHTML=on
      ? '<path d="M9 4v5H4"/><path d="M20 9h-5V4"/><path d="M15 20v-5h5"/><path d="M4 15h5v5"/>'
      : '<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>';
  }
}
// opening the formula menu leaves the row up (so you can pick another tool right after), but
// the active DRAWING mode is dropped — the menu takes over the canvas.
export function closeToolsSoft(){setToolMode(null);tSub.classList.remove('on');dSub.classList.remove('on');}

export function setupUiToolbar1(){
  /* 全屏按钮 + 两个问号按钮的初始化。
   * fullscreenchange 是唯一的真相来源（Esc / F11 / 浏览器 UI 退出都会走它），点击只是请求，外观由这条事件统一刷新。 */
  syncFullscreenUI();
  ['fullscreenchange','webkitfullscreenchange'].forEach(function(ev){
    DD.addEventListener(ev,function(){syncFullscreenUI();});
  });
}

export function setupUiToolbar2(){
  tToggle.addEventListener('click',function(e){e.stopPropagation();setToolsOpen(!TOOL.open);});
  tRow.addEventListener('click',function(e){
    e.stopPropagation();
    var b=e.target.closest('.tbtn');if(!b)return;
    var t=b.getAttribute('data-tool');
    if(t==='formula'){closeToolsSoft();openFormulaMenu();}
    else if(t==='settings'){closeToolsSoft();openSettings();}
    else if(t==='brush'){tSub.classList.remove('on');dSub.classList.remove('on');toolTap('brush','brush');}
    else if(t==='shape'){
      // 行按钮有自己的 key：它和下面的形状 chip 是不同的按钮，不能算成「同一按钮点两下」
      toolTap('shaperow:'+TOOL.shape,'shape');
      tSub.classList.toggle('on',TOOL.mode==='shape');   // 取消时自动收起，武装时展开
      dSub.classList.remove('on');                       // 两行子面板互斥，不叠着开
    }
    else if(t==='device'){
      // 与形状行同构：行按钮用自己的 key，展开自己那一行器件。
      toolTap('devrow:'+TOOL.device,'device');
      dSub.classList.toggle('on',TOOL.mode==='device');
      tSub.classList.remove('on');
    }
    else if(t==='fullscreen'){toggleFullscreen();}
  });
}

export function setupUiToolbar3(){
  tSub.addEventListener('click',function(e){
    e.stopPropagation();
    var b=e.target.closest('.tbtn');if(!b)return;
    var sh=b.getAttribute('data-shape');
    // 单击画一次 / 双击连续 / 再单击取消。换成另一个形状则直接切过去。
    toolTap('shape:'+sh,'shape',function(){TOOL.shape=sh;});
  });
}

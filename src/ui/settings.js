/* 设置面板与问号气泡 */
import Matter from 'matter-js';
import { DD, sclose, smask, smenu } from '../core/dom.js';
import { bodies } from '../core/world.js';
import { refreshSpringGeom, springAnchorOffset } from '../devices/spring.js';
import { applyWBounc, applyWFrict } from '../physics/material.js';
import { UI_MODE, setUIMode, touchClearSel, uiTouch } from './touch.js';

// 物理教学模式：'uni' = 大学（全物理，默认）；'high' = 高中：
//   ① 弹簧不算力矩（力只沿弹簧方向作用在质心）
//   ② 不算弹簧阻尼（Rayleigh 阻尼项置 0）
//   ③ 不算空气阻力（frictionAir 恒 0，忽略显式 wair 设置）
// 作用点分别是 springForceOn / springDamp / applyWAir·wAirDef。
export let PHYS_MODE='uni';
export function syncModeUI(){
  if(!smenu)return;
  var bs=smenu.querySelectorAll('.sbtn');
  for(var i=0;i<bs.length;i++){
    bs[i].classList.toggle('act',bs[i].getAttribute('data-mode')===PHYS_MODE);
  }
  /* 交互模式（自动/电脑版/触屏版）按钮高亮 */
  var us=smenu.querySelectorAll('.ubtn');
  for(i=0;i<us.length;i++){
    us[i].classList.toggle('act',us[i].getAttribute('data-ui')===UI_MODE);
  }
  var tip=smenu.querySelector('#uitip');
  if(tip)tip.textContent=uiTouch()?'当前：触屏版（长按=右键 · 点选后可再点放置）':'当前：电脑版';
}
export function openSettings(){smenu.classList.add('on');smask.classList.add('on');syncModeUI();}
/* 关设置时把问号气泡一并收掉：气泡挂在 body 上（不在 .smenu 内），面板关了它会变成孤儿
 * （触屏路径没有 mouseleave，尤其容易漏）。 */
export function closeSettings(){
  smenu.classList.remove('on');smask.classList.remove('on');
  var pop=DD.getElementById('qpop');if(pop)pop.classList.remove('on');
  var qs=smenu.querySelectorAll('.qbtn');
  for(var qi=0;qi<qs.length;qi++)qs[qi].classList.remove('on');
}
/* 问号按钮的两条显示路径：桌面 hover / 触屏 click。
 * 气泡定位用按钮自身的 rect（面板随屏幕高度居中，写死坐标在手机上会错位）。 */
export const QPOP_TEXT={
  qphys:'<b>高中模式</b><br>① 弹簧不算力矩（拉任何部位效果相同）<br>'
      + '② 不算弹簧阻尼<br>③ 不算空气阻力<br>④ 默认弹性系数全为 0<br>'
      + '⑤ 默认摩擦系数为 0<br>⑥ 弹簧只有水平与竖直两个方向（画出来即吸附到最近的轴）',
  quitipbtn:'<b>交互模式</b><br>· <b>自动</b>：按设备自动判断（有触摸屏就用触屏版）<br>'
      + '· <b>电脑版</b>：鼠标操作（右键弹参数菜单）<br>'
      + '· <b>触屏版</b>：手指操作（长按 = 右键菜单 · 点选符号后再点画布放置 · 点画布拖动）'
};
export function qpopShow(btn){
  var pop=DD.getElementById('qpop');
  if(!pop||!btn)return;
  var txt=QPOP_TEXT[btn.id];
  if(!txt)return;
  btn.classList.add('on');
  pop.innerHTML=txt;
  pop.classList.add('on');
  /* 先显形再量尺寸（display:none 时量不到宽高 ⇒ 右侧夹取会失效） */
  var r=btn.getBoundingClientRect(),pr=pop.getBoundingClientRect();
  var left=r.right+10;
  if(left+pr.width>window.innerWidth-8)left=Math.max(8,r.left-pr.width-10);   // 右边放不下 ⇒ 翻到左侧
  var top=r.top;
  if(top+pr.height>window.innerHeight-8)top=Math.max(8,window.innerHeight-8-pr.height);
  pop.style.left=left.toFixed(1)+'px';
  pop.style.top=top.toFixed(1)+'px';
}
export function qpopHide(btn){
  var pop=DD.getElementById('qpop');
  if(pop)pop.classList.remove('on');
  if(btn)btn.classList.remove('on');
}
export function bindQBtn(id){
  var b=DD.getElementById(id);
  if(!b)return;
  /* 桌面：悬浮显示 / 移出隐藏。触屏：click 切换（`uiTouch()` 那条路上 click 照样会来，
   *  hover 事件则根本不产生 ⇒ 两条路径天然互不干扰）。 */
  b.addEventListener('mouseenter',function(){if(!uiTouch())qpopShow(b);});
  b.addEventListener('mouseleave',function(){if(!uiTouch())qpopHide(b);});
  b.addEventListener('click',function(e){
    e.stopPropagation();
    if(!uiTouch())return;                       // 桌面走 hover，click 不再重复切换
    var pop=DD.getElementById('qpop');
    if(pop&&pop.classList.contains('on'))qpopHide(b);else qpopShow(b);
  });
}

export function setupUiSettings1(){
  smask.addEventListener('click',closeSettings);
  sclose.addEventListener('click',closeSettings);
}

export function setupUiSettings2(){
  bindQBtn('qphys');
  bindQBtn('quitipbtn');
}

export function setupUiSettings3(){
  /* 设置面板每次打开都把当前生效值回填进输入框（localStorage 可能覆盖过默认值） */
  smenu.addEventListener('click',function(e){
    e.stopPropagation();
    /* 交互模式按钮（自动/电脑版/触屏版） */
    var ub=e.target.closest('.ubtn');
    if(ub){setUIMode(ub.getAttribute('data-ui')||'auto');touchClearSel();syncModeUI();return;}
    var b=e.target.closest('.sbtn');if(!b)return;
    PHYS_MODE=b.getAttribute('data-mode');
    syncModeUI();
    // 切换模式后逐体调 applyWFrict 与 applyWBounc，让 μ 与 e 两条链同源刷新：
    //   · applyWFrict 管 μ 通道（高中模式默认 μ=0 只是读 PHYS_MODE 的显示值，不扫的话旧体 mb.friction 仍是 0.08），
    //     并连带刷 effRest/air；
    //   · 圆的 mb.restitution=BALL_REST 这类 e 默认必须由 applyWBounc 亲自写（它内部带 parts/pair 刷新）。
    for(var ji=0;ji<bodies.length;ji++){
      if(bodies[ji].kind!=='W')continue;
      applyWFrict(bodies[ji]);
      applyWBounc(bodies[ji]);
    }
    // 切换模式时把场上所有可动 W 体的角速度清零（两个方向都清；静态体跳过）。
    // 旧模式攒下的自旋在新模式里没有合法语义：例如大学模式攒的 ω 切到高中后没有任何衰减通道
    // （力矩通道关闭 + 锚点冻结 + 无空气阻力），物体会永远匀速转下去。
    for(var jw=0;jw<bodies.length;jw++){
      var BW2=bodies[jw];
      if(BW2.kind!=='W'||!BW2.mb||BW2.dead||BW2.mb.isStatic)continue;
      Matter.Body.setAngularVelocity(BW2.mb,0);
    }
    // 切换模式后按当前几何重算所有弹簧锚点的本地偏移：高中模式记「相对质心的世界分量」（不随自转），
    // 大学模式记「R(θ)·local」。此刻重算让端点停在原位，切换瞬间零跳变；漏掉则端点会按新约定突然跳位。
    for(var js=0;js<bodies.length;js++){
      var S78=bodies[js];
      if(S78.kind!=='S'||S78.dead)continue;
      for(var je=0;je<2;je++){if(S78.anc[je]&&S78.anc[je].B)springAnchorOffset(S78,je);}
      // 切进高中模式时给已有弹簧补上自动轴锁（高中模式没有斜弹簧）。用当前方向而不是吸到最近的轴：
      // 吸附会把端点搬动最多 |垂向分量|（近 45° 时约 len/√2），弹簧会突然跳位；用当前方向同样满足
      // 「方向不再变化」且零跳变。新画的弹簧仍走 makeSpring 的吸附路径。
      // 切回大学模式时摘掉 auto 锁（手动「固定方向」的锁是用户显式设的，不摘）。
      if(PHYS_MODE==='high'){
        if(!S78.dirLock){
          var sdx=S78.e1.x-S78.e0.x,sdy=S78.e1.y-S78.e0.y,sd=Math.hypot(sdx,sdy)||1e-6;
          S78.dirLock={mx:S78.x,my:S78.y,ux:sdx/sd,uy:sdy/sd,auto:true};
          refreshSpringGeom(S78);
        }
      }else if(S78.dirLock&&S78.dirLock.auto){
        S78.dirLock=null;
        refreshSpringGeom(S78);
      }
    }
  });
}

/* 指针 / 触摸事件：抓取、拖拽、松手 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { beltEndWorld, setBeltAngle, setBeltEnds } from '../bodies/belt.js';
import { BODY, killBody, killLetter, spawnField } from '../bodies/body.js';
import { arcEndWorldAng, arcParamFromWorldAng, arcSetAngle, arcWorldCenter, nearInk } from '../bodies/boundary.js';
import { rodDragEnds, rodDragPinHosts, rodEndLenDragAllowed, rodEndWorld, rodTryAnchor, tAnchor } from '../bodies/rod.js';
import { bossFindEkNear, bossPlace } from '../boss/boss.js';
import { DD, ark, cv, handle, rodh, rszHandle, trash } from '../core/dom.js';
import { clamp, segPointDist, shortAng, snapAngle90, snapAngleDeg } from '../core/math.js';
import { bodies, freeL } from '../core/world.js';
import { distToHost } from '../devices/anchor.js';
import { releaseConstrainVel } from '../devices/constraint.js';
import { dragArcLock, dragAxisLock, dragPtrAxis } from '../devices/drag-lock.js';
import { groundDragEnds, setGroundAngle } from '../devices/ground.js';
import { endDeviceOut, moveDeviceOut, placeDevice } from '../devices/placement.js';
import { dissolveSpring, springAssemblyRotate, springCanRotate, springDisconnectAtPoint, springLockedAsmOf, springMoveRig, springRotTargetHigh, springRotate, springTryAnchor, springTryAnchorByHost } from '../devices/spring.js';
import { explodeBlackHole, killFieldBody } from '../effects/blackhole.js';
import { F, GD, isMass, killG } from '../letters/glyph.js';
import { place, placeLetter, refresh } from '../letters/layout.js';
import { applyKXCombo, applyTCombo, attach, canMerge, detachFieldGlyph, findFreeLetterTarget, findFreeMassTarget, findKXCombo, findMergeTarget, findSolidBodyAt, findTComboTarget, qGiveable, splitOne } from '../letters/merge.js';
import { charDefFill, dockLetter } from '../letters/panel.js';
import { BND_INK, MW } from '../physics/matter.js';
import { B_FIELD_RANGE, E_FIELD_RANGE, W, arcHov, groundY, hoverB, rodHov } from '../render/render.js';
import { finishShapeDrag, finishStroke, startShapeDrag, startStroke } from '../tools/draw.js';
import { closeMenu, openMenu, ringGo } from '../ui/menu.js';
import { PHYS_MODE } from '../ui/settings.js';
import { TOOL, setToolMode } from '../ui/toolbar.js';
import { touchClearSel, touchLongPressStart, touchMoveSelTo, uiTouch } from '../ui/touch.js';
import { eraseUnderTrash, inPanel, inTrash } from '../ui/trash.js';

export const pointer={x:-9999,y:-9999};
/* 传送带角度吸附：离 45° 整数倍 ±BELT_SNAP_DEG 以内才吸，带外保留自由斜角（与 snapAngle90 同款语义）。
 * 不要改成 Math.round(a/q)*q 的量化写法：那会抹掉所有自由斜角，需求是「特定角度附近吸附」而非「只能取这几档」。
 * 测试注意：目标角必须用非 45 倍数（如 60/135/270/−45 天然是倍数，不吸附的实现也能全过），
 * 并分「带内」「带外」两组断言。
 * 其余物体（杆 / 弹簧 / E 场）仍是 90°±8° 吸附。 */
export const BELT_ANG_SNAP=45;
/* 弹簧、杆约束、铰链力矩、吸附点、Matter 碰撞补丁、UI 模式切换 */
/* ================= 弹簧（kind 'S'）：k × x =================
 * 由字母 k、x 拼接生成。端点未接物体时弹簧固定不动、只能被鼠标拖；拖动后端点碰到其他物体即固定，
 * 之后像轻质弹簧一样随物体运动并产生弹力；双击解散回 k / x。
 *
 * 数据模型：两端 e0 / e1 是唯一权威几何；B.x / B.y / B.th / B.hw 每帧从它们派生。
 *   · 端点没拴住 -> 停在原地（轻质，无重力）。
 *   · 端点拴住   -> 每帧从宿主位姿反算 e = host.pos + R(host.th)·本地偏移，随宿主运动。
 *   · 弹力       -> f = ks·(|e1-e0| − L₀) − damp·v_rel，成对施加在两端宿主上（牛顿第三定律）。
 *     W 边界（画出来的线）与右键固定体按无限大质量处理，只当锚点、不产生位移。
 *   · 拖动       -> 平移整条弹簧及其拴住的宿主（BFS 收集整个装配体）；拴在边界上的一端拖不动。
 *   · 双击       -> 解散：killBody(弹簧) + 在原地生成 k / x 两个自由字母。
 * 视觉：锯齿线圈，圈数随长度自适应；拉长偏红 / 压短偏蓝 / 原长墨黑；拴住的一端画实心锚点。
 */
export const SPR_GRAB=16;         // 线圈的可抓/可悬浮带宽（与「只有有线才响应」一致）
/* 「指针真的按着」标志（只读）：残留的 grab（上次手势没正常收尾）会让拖拽中的磁吸每帧执行，
 * 把铰链连同锚定物体持续匀速平移。磁吸以此门控即可。
 * 不要在 pointerdown 里清 grab 来解决：会破坏触摸拖动。 */
export let ptrDown=false;       // 指针（鼠标键/手指）当前是否按下
export let touchPending=null;   // 触屏：面板符号按下后待定的拖出手势 {d,x,y}
export let grab={kind:null,obj:null,gx:0,gy:0,lx:0,ly:0,t:0,svx:0,svy:0,start:0};
export const dblState={t:0,x:0,y:0,body:null};
export let TOUCH_LETTER=null;   // 触屏下面板中被点选的符号（等第二次点画布放置）
export function gdDown(e,d){
  /* 不要在每次按下时清 grab：会打断正在进行的拖动（连续操作/多指/合成事件下尤甚），
   * 表现为时能拖时不能拖、抓两次才动。残留清理由 frame 里那条负责（只在指针没按着时才清）。 */
  /* 按下时先按本次事件坐标刷新 pointer，再算抓点偏移：触摸没有 hover，pointerdown 时 pointer
   * 还是上一次的坐标，gx=pointer.x−cx 会变成旧指针到字符中心的距离，拖动时字符与手指始终偏开这段距离。 */
  if(e&&typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
  if(e.button!==0)return;
  /* 字符这条入口也要起长按计时（画布入口收不到压在小字形上的按下，见 touchLongPressStart）。
   * 面板(dock)字符除外：那边走 touchPending 的点选/拖出分流，长按计时会和它打架。
   * 移动/松手统一取消（两条入口共用 TOUCH_LP）。 */
  if(uiTouch()&&e.pointerType==='touch'&&d.state!=='dock')touchLongPressStart(d);
  if(d.state==='dock'){
    /* 触屏点面板符号：记录 TOUCH_LETTER 并在面板上高亮（.touch-pick），不立即拖出；下一次点画布 ⇒ 放置到该处。 */
    if(uiTouch()&&e.pointerType==='touch'){
      /* 触屏点面板符号不当场决定，记为待定（touchPending），由后续手势分流：
       * · 按住移动超 12px ⇒ 按原逻辑直接拖出（拖动放置，在 pointermove 里触发）；
       * · 松手时没怎么动（tap）⇒ 面板内选中态（.touch-pick 高亮），下一次点画布放置。 */
      if(TOUCH_LETTER===d){TOUCH_LETTER=null;if(d.el)d.el.classList.remove('touch-pick');return;}
      touchPending={d:d,x:e.clientX,y:e.clientY};
      return;
    }
    var rp=d.el.getBoundingClientRect();
    var cx=rp.left+rp.width/2,cy=rp.top+rp.height/2;
    if(isMass(d)){
      var t2=GD(d.ch);
      t2.cat=1;t2.pop=0;
      t2.state='grab';
      t2.body=null;
      t2.wx=cx;t2.wy=cy;
      t2.w=F*0.7;t2.h=F;
      grab={kind:'letter',obj:t2,gx:pointer.x-cx,gy:pointer.y-cy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
      DD.body.appendChild(t2.el);
      place(t2,cx,cy,0,1,true);
      return;
    }
    var t2=GD(d.ch);
    t2.cat=1;t2.pop=0;
    t2.state='grab';
    t2.body=null;
    t2.wx=cx;t2.wy=cy;
    t2.w=F*0.7;t2.h=F;
    /* 面板 v 的光速态必须传给拖出的克隆：dock 拖出走 GD(d.ch) 造新字符，属性不会自动带过来，
     * 丢了光速态落到 ½mv² 上只会当普通「赋予速度 v」融进公式（公式就毁了）。
     * 拷贝清单与菜单「复制」分支（copyBody 那段）保持一致，否则同一个 v 走不同入口行为不同。 */
    if(typeof d.vGive!=='undefined')t2.vGive=d.vGive;
    if(typeof d.vAng!=='undefined')t2.vAng=d.vAng;
    if(typeof d.aGive!=='undefined')t2.aGive=d.aGive;
    if(typeof d.aAng!=='undefined')t2.aAng=d.aAng;
    if(typeof d.qCharge!=='undefined')t2.qCharge=d.qCharge;
    if(d.vLight){t2.vLight=true;t2.vGive=d.vGive;}
    /* dock 模板自身不带数值，面板上改过的值记在 CHAR_DEF 里 ⇒ 拖出的克隆用 CHAR_DEF 补齐缺省字段（已有值不覆盖）。 */
    charDefFill(t2);
    grab={kind:'letter',obj:t2,gx:pointer.x-cx,gy:pointer.y-cy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    DD.body.appendChild(t2.el);
    place(t2,cx,cy,0,1,true);
    return;
  }
  if(d.body&&!d.body.bh&&d.body.glyphs&&d.body.glyphs.indexOf(d)>=0){
    var B=d.body;
    if(dblState.body!==B){dblState.t=0;dblState.body=B;dblState.g=d;dblState.x=pointer.x;dblState.y=pointer.y;}
    grab={kind:'body',obj:B,gx:pointer.x-B.x,gy:pointer.y-B.y,lx:pointer.x,ly:pointer.y,t:performance.now(),svx:B.vx,svy:B.vy,start:pointer.x,x0:pointer.x,y0:pointer.y};
    grab.ax0=B.x;grab.ay0=B.y;grab.axis=dragAxisLock(B);   // 轴向约束在按下那一刻定死
    DD.body.appendChild(d.el);
    return;
  }
  /* 赋予型字符（v/a/q/t）无条件走自由字符抓取（不管 state、有没有临时宿主）：
   * 它们 promote 后有宿主但不在任何 glyphs 列表里，上面分支都不命中，
   * 而自由字符分支又要求 state 为 free/grab ⇒ 第一次抓会落空（要抓两次才动）。 */
  if((d.ch==='v'||d.ch==='a'||d.ch==='q'||d.ch==='t')&&d.state!=='dock'){
    detachFieldGlyph(d);          /* 场源体的字形先摘成自由字符（否则拖了没反应） */
    /* 不强行改状态/摘 mem（会破坏正在进行的状态机），只保证抓取成立。
     * 抓起即清速度：松手时会用 grab.svx 赋 L.vx 抛出，不清的话下次抓起它还带着上次速度，从指针下滑走。 */
    d.vx=0;d.vy=0;
    grab={kind:'letter',obj:d,gx:pointer.x-d.wx,gy:pointer.y-d.wy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    return;
  }
  /* 自由字符的抓取放宽到所有非面板状态（不只 free/grab）：双击判定/上一轮操作留下的中间态（如 idle）
   * 会让快速连续操作后的抓取落空。 */
  if(d.state!=='dock'){
    detachFieldGlyph(d);          /* 任何「像字符但属于场源体」的字形都先摘成自由字符 */
    d.state='free';
    d.vx=0;d.vy=0;      // 抓起即清速度（否则带着上次抛出的速度滑走）
    grab={kind:'letter',obj:d,gx:pointer.x-d.wx,gy:pointer.y-d.wy,lx:pointer.x,ly:pointer.y,t:performance.now(),start:pointer.x};
    return;
  }
}
export const trashDrag={active:false};

export function setupInputPointer(){
  DD.addEventListener('pointerdown',function(e){ptrDown=true;},true);
  DD.addEventListener('pointerup',function(e){ptrDown=false;},true);
  /* pointercancel 也要收尾半截手势，不能只清 ptrDown：浏览器掐断指针流时（touch-action 判成滚动、
   * 系统抢走触摸）pointerup 永远不会来，TOOL.drag / TOOL.stroke / trashDrag.active / grab 全停在
   * 「进行中」，下一个手势落在残骸上（画形状时表现为拉了框不落体、之后工具全坏）。
   * touch-action:none 已防止画布/垃圾桶被掐断，这里是兜底。 */
  DD.addEventListener('pointercancel',function(e){
    ptrDown=false;
    if(TOOL){
      if(TOOL.drag){TOOL.drag=null;}          // 取消的形状框：丢弃（松手才落体，取消不落）
      if(TOOL.stroke){TOOL.stroke=null;}      // 取消的笔画：同上
      if(TOOL.devDrag){try{endDeviceOut();}catch(_e){}}
    }
    if(trashDrag&&trashDrag.active){
      trashDrag.active=false;
      var _tr=DD.getElementById('trash');
      if(_tr){_tr.style.left='';_tr.style.top='';
              _tr.style.right='24px';_tr.style.bottom='24px';_tr.classList.remove('on');}
    }
    if(grab){grab.kind=null;grab.obj=null;}
  },true);
  DD.addEventListener('pointerdown',function(e){if(!e.target.closest('#menu'))closeMenu();});
  handle.addEventListener('pointerdown',function(e){
    // 固定的 W 边界也用这个旋转手柄（悬浮固定的线/图形时出现）
    /* 含 a 的表达式体（ma 组合）不响应旋转手柄 */
    var _hasA2=!!(hoverB&&((hoverB.glyphs&&hoverB.glyphs.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
                ||(hoverB.mem&&hoverB.mem.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
                ||(hoverB.massG&&(hoverB.massG.ch==='a'||hoverB.massG.type==='a'))
                ||hoverB.accGive!=null||hoverB.accX!=null||hoverB.accY!=null));
    if(_hasA2)return;
    if(!hoverB||(!hoverB.hasA&&hoverB.kind!=='T'&&hoverB.kind!=='E'&&!springCanRotate(hoverB)
       &&!(hoverB.kind==='W'&&hoverB.fixed)))return;
    e.preventDefault();e.stopPropagation();
    // Remember the angle at the moment of the press + the body's angle then. All later frames
    // derive the angle from the DRAG START (absolute), never from the previous frame — that is
    // what lets us snap LIVE without the snap pinning the rotation in place.
    var s0=tAnchor(hoverB);
    grab={kind:'rot',obj:hoverB,lx:pointer.x,ly:pointer.y,t:performance.now(),
          th0:hoverB.th||0,a0:Math.atan2(pointer.y-s0.y,pointer.x-s0.x)};
  });
  // 圆弧端点手柄：按住哪个端点，拖到哪角度就到哪（类似 PPT 黄色控制点）。
  // 按住期间整条弧进入「编辑固定」态（editLock + Matter static），不会边改角度边下落；
  // pointerup 时解除，恢复原本的固定/自由状态。
  ark.forEach(function(kn,i){
    kn.addEventListener('pointerdown',function(e){
      if(!arcHov||arcHov.dead)return;
      e.preventDefault();e.stopPropagation();
      grab={kind:'arcedit',obj:arcHov,end:i,t:performance.now()};
      app.hoverW=arcHov;
      arcHov.editLock=true;
      if(arcHov.mb)Matter.Body.setStatic(arcHov.mb,true);
    });
  });
  // 轻质杆的两端长度手柄：按住端点 i 拖，改杆长（+ 朝向），另一端钉死不动。
  // 与 setRodLen（参数面板：质心不动、两端对称伸缩）语义不同，手柄走 setRodEnds。
  // 远端坐标在按下时存进 grab.fx/fy 一次，之后每帧用它当固定端。不要每帧从 rodEndWorld 现取：
  // setRodEnds 同时改写中心与角度，现取的远端会随上一帧结果漂移（拖 200px 远端漂 30+px）。
  rodh.forEach(function(kn,i){
    kn.addEventListener('pointerdown',function(e){
      if(!rodHov||rodHov.dead)return;
      /* 端点已锚定 ⇒ 该端的长度手柄不响应（长度由约束决定），也避免干扰双击解除。 */
      if(!rodEndLenDragAllowed(rodHov,i))return;
      /* 若这是双击的第二下（500ms 内、同一根杆）⇒ 不启动长度拖拽：rodlen 的 grab 会 stopPropagation 吃掉第二下，双击解除失败。 */
      if(dblState&&dblState.body===rodHov&&dblState.t&&(performance.now()-dblState.t)<520){
        /* 手柄会吃掉第二下点击（主画布收不到）⇒ 在这里直接执行解除（该端锚定则断开），不依赖冒泡。 */
        if(springDisconnectAtPoint(pointer.x,pointer.y)){
          dblState.t=0;dblState.body=null;
        }
        return;
      }
      e.preventDefault();e.stopPropagation();
      var far=(rodHov.belt?beltEndWorld:rodEndWorld)(rodHov,1-i);   // 被拖的是 i，钉死的是 1-i
      grab={kind:'rodlen',obj:rodHov,end:i,fx:far.x,fy:far.y,t:performance.now()};
      rodHov.vx=0;rodHov.vy=0;rodHov.om=0;      // 冻结：按下即清速度（重力/残余转动不再起作用）
    });
  });
  // field-area RESIZE handle: drag it to grow/shrink the E square / B circle range.
  // (This handler owns the handle element itself — stopPropagation keeps it off the canvas grab.)
  rszHandle.addEventListener('pointerdown',function(e){
    e.preventDefault();e.stopPropagation();
    var B=hoverB;
    if(!B||(B.kind!=='E'&&B.kind!=='B'))return;
    var edge='rad',side=null;
    if(B.kind==='E'){
      var erD=B.er||{l:(B.fieldR||E_FIELD_RANGE)/2,r:(B.fieldR||E_FIELD_RANGE)/2,t:(B.fieldR||E_FIELD_RANGE)/2,b:(B.fieldR||E_FIELD_RANGE)/2};
      var pxD=pointer.x-B.x,pyD=pointer.y-B.y;
      var dL=Math.abs(pxD+erD.l),dR=Math.abs(pxD-erD.r),dT=Math.abs(pyD+erD.t),dB=Math.abs(pyD-erD.b);
      var m=Math.min(dL,dR,dT,dB);
      if(m===dL){edge='x';side='l';}
      else if(m===dR){edge='x';side='r';}
      else if(m===dT){edge='y';side='t';}
      else{edge='y';side='b';}
    }
    grab={kind:(B.kind==='E')?'resizeE':'resizeB',obj:B,lx:pointer.x,ly:pointer.y,rszEdge:edge,rszSide:side,startR:B.fieldR||((B.kind==='E')?E_FIELD_RANGE:B_FIELD_RANGE),t:performance.now()};
    rszHandle.classList.add('on');
  });
  cv.addEventListener('pointerdown',function(e){
    // 只认左键，右键语义全部归 contextmenu。否则 500ms 内同位置连按两次右键会被 pointerup 的 S 分支
    // 当成双击解散（dissolveSpring 把弹簧拆回 k/x，而菜单还开着、menuBody 已死）。
    // 字母的 gdDown 也有 e.button!==0 守卫。
    if(e.button!==0)return;
    // drawing tools own the canvas while they are armed — never fall through to a grab
    if(TOOL.mode==='brush'){e.preventDefault();startStroke(e);return;}
    if(TOOL.mode==='shape'){e.preventDefault();startShapeDrag(e);return;}
    // 器件模式：每点一次就在指针处放一个（弹簧没有「拖出尺寸」这一步，按下即落，与形状的拖框不同）。
    // 是否继续武装由 TOOL.cont 决定。
    if(TOOL.mode==='device'){
      e.preventDefault();
      var dspB=placeDevice(TOOL.device,pointer.x,pointer.y);
      if(dspB&&!TOOL.cont)setToolMode(null);
      return;
    }
    /* 按下必须先用本次事件坐标刷新 pointer，再做命中扫描：触屏按下前没有 pointermove，
     * pointer 是旧坐标（甚至上次抬指的位置）⇒ hit 恒空、物体/杆抓不起来。鼠标因 hover 持续更新而看不出。
     * 与 gdDown 和触摸分支的做法一致：先进坐标，再判定。 */
    if(e&&typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
    var hit=null;
    for(var i=0;i<bodies.length;i++){
      var B=bodies[i];
      // W 体（画出的线/空心图形）只认「线」，不认外接框的空白区（点空心矩形中间不能拖走它）。
      // 判定与 refreshHover() 共用 nearInk()，保证「高亮得起来 = 抓得住」。
      if(B.kind==='W'){if(nearInk(B,pointer.x,pointer.y))hit=B;continue;}
      // 弹簧：整条线圈都是可抓区（线段 + SPR_GRAB 容差），和画笔线一样只有线上才响应
      if(B.kind==='S'){if(segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,pointer.x,pointer.y)<SPR_GRAB)hit=B;continue;}
      var dx=pointer.x-B.x,dy=pointer.y-B.y;
      var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
      var lx=c*dx+s*dy,ly=-s*dx+c*dy;
      if(Math.abs(lx)<(B.hw||30)+10&&Math.abs(ly)<(B.hh||24)+10)hit=B;
    }
    /* 画布抓取前先按本次事件坐标刷新 pointer（触摸端跟手），见上面的统一入口。 */
    if(typeof e.clientX==='number'){pointer.x=e.clientX;pointer.y=e.clientY;}
    /* 触摸：按下即启动长按计时（450ms 未移动 ⇒ 当右键弹菜单）。
     * 垃圾桶/面板上的按下不走画布触摸逻辑（垃圾桶有自己的 tap×2 清屏与拖动）。 */
    if(e.target&&(e.target.id==='trash'||(e.target.closest&&(e.target.closest('#trash')||e.target.closest('#panel')||e.target.closest('#panelToggle')))))return;
    if(uiTouch()&&e.pointerType==='touch'&&TOUCH_LETTER){
      /* 面板符号已点选时，这里只拦下本次按下，不做放置；放置统一在 pointerup（见 TOUCH_LETTER 分支：
       * 调完 gdDown 把 grab.obj 显式 place 到 pointer）。
       * 不要在这里调 gdDown(..., _dl)：dock 分支落点取面板格子中心、不看 pointer，且这里会把 TOUCH_LETTER
       * 清成 null，pointerup 的落点修正永不生效 ⇒ 点哪儿都放回符号表。
       * 保留 return：放置这一次手指不该再落进画布的 grab/长按逻辑。 */
      return;
    }
    if(uiTouch()&&e.pointerType==='touch'){
      touchLongPressStart(hit);
    }
    if(hit&&!hit.bh){
      if(dblState.body!==hit){dblState.t=0;dblState.body=hit;dblState.g=hit.massG;}
      /* x/y 每次按下都刷新（不只在换物体时）：否则同体连点两次时 dsS.x/y 是很久以前的按下位置，
       * mvdS 虚大，双击解散永不触发。 */
      dblState.x=pointer.x;dblState.y=pointer.y;
      // 拖拽悬摆：抓点相对质心的偏移存本地系（glx/gly）——物体转动后世界偏移 (gx/gy) 会失效，
      // 本地偏移不随旋转变，抓的始终是同一块材料。
      var gth66=hit.th||0,gc66=Math.cos(gth66),gs66=Math.sin(gth66),gdx66=pointer.x-hit.x,gdy66=pointer.y-hit.y;
      grab={kind:'body',obj:hit,gx:gdx66,gy:gdy66,glx:gc66*gdx66+gs66*gdy66,gly:-gs66*gdx66+gc66*gdy66,lx:pointer.x,ly:pointer.y,t:performance.now(),svx:hit.vx,svy:hit.vy,start:pointer.x,x0:pointer.x,y0:pointer.y};
      // 拖拽轴向约束（被固定/被支撑端拴住时只能沿弹簧方向拖）：按下时定死，
      // 免得拖拽中「支撑」状态抖动导致约束忽有忽无。null = 不约束。
      grab.ax0=hit.x;grab.ay0=hit.y;grab.axis=dragAxisLock(hit);
      grab.arc=dragArcLock(hit);   // 杆宿主被抓 ⇒ 弧线拖拽参数
    }
  });
  // right-click a T-rod on the canvas: the rod has no letter glyphs, so the menu opens for
  // the BODY itself (参数 = rod length via v/rodlen). Only T is routed here — field sources
  // B/E/q/I and formula bodies are handled by their own letter contextmenu.
  // 命中优先级按类型分三趟扫描（W → S → T），不按 bodies 数组顺序先到先得：
  // 物体永远优先于弹簧（贴着物体的那段线圈归物体，弹簧中段仍可右键）。否则先建的弹簧会抢走
  // 后建物体的右键（墨线贴着弹簧端点时弹出弹簧菜单，物体自己的质量/摩擦/弹性参数被挡住）。
  // 左键拖拽不改（后建的弹簧优先）：贴着物体时抓弹簧正是「拖整体」的手感。
  cv.addEventListener('contextmenu',function(e){
    e.preventDefault();
    var ci,CB;
    // ① 画出来的物体（W）—— 只在墨线上响应，空心内部不弹菜单（与悬浮/抓取一致）
    for(ci=0;ci<bodies.length;ci++){
      CB=bodies[ci];
      if(CB.kind!=='W')continue;
      if(nearInk(CB,pointer.x,pointer.y)){openMenu(e.clientX,e.clientY,CB,null);return;}
    }
    // ② 弹簧（S）—— 整条线圈 ±SPR_GRAB 都是可点区，但只在没有物体命中时才轮到它
    for(ci=0;ci<bodies.length;ci++){
      CB=bodies[ci];
      if(CB.kind!=='S')continue;
      if(segPointDist(CB.e0.x,CB.e0.y,CB.e1.x,CB.e1.y,pointer.x,pointer.y)<SPR_GRAB){
        openMenu(e.clientX,e.clientY,CB,null);return;
      }
    }
    // ③ 细杆（T）—— 没有字母，右键弹本体菜单（参数 = 杆长）
    for(ci=0;ci<bodies.length;ci++){
      CB=bodies[ci];
      if(CB.kind!=='T')continue;
      var dx2=pointer.x-CB.x,dy2=pointer.y-CB.y;
      var thT=CB.th||0,ctT=Math.cos(thT),stT=Math.sin(thT);
      var lxT=ctT*dx2+stT*dy2,lyT=-stT*dx2+ctT*dy2;
      if(Math.abs(lxT)<=CB.len/2+8&&Math.abs(lyT)<=8){
        openMenu(e.clientX,e.clientY,CB,null);return;
      }
    }
  });
  DD.addEventListener('pointermove',function(e){
    pointer.x=e.clientX;pointer.y=e.clientY;
    /* 触摸：一旦移动就不是长按（长按=右键要求手指不动） */
    if(app.TOUCH_LP){clearTimeout(app.TOUCH_LP);app.TOUCH_LP=null;}
    /* 面板符号「按住拖」：待定手势移动超 12px ⇒ 执行原 dock 拖出 */
    if(touchPending){
      var _tp=touchPending;
      if(Math.hypot(e.clientX-_tp.x,e.clientY-_tp.y)>12){
        touchPending=null;
        gdDown({clientX:_tp.x,clientY:_tp.y,button:0,pointerType:'mouse'},_tp.d);
        /* 拖出后把 grab 的锚点校正到当前指针（拖出瞬间指针已移动） */
        if(grab&&grab.kind==='letter'){pointer.x=e.clientX;pointer.y=e.clientY;}
      }
      return;
    }
    // 器件从面板拖出，优先级最高：这是唯一「按下在面板、移动在画布」的手势，
    // 落进后面的分支会被当成 grab。
    if(TOOL.devDrag){moveDeviceOut(e);return;}
    // W 体的悬浮命中不在这里算，统一由每帧都跑的 refreshHover() 负责：pointermove 在落笔期间被
    // TOOL.stroke 挡掉、松手后又没有新的 pointermove，刚画完的东西指针停在上面也不会亮。
    if(TOOL.stroke){TOOL.stroke.pts.push([pointer.x,pointer.y]);return;}
    if(TOOL.drag){TOOL.drag.x1=pointer.x;TOOL.drag.y1=pointer.y;return;}
    if(trashDrag.active){
      trash.style.left=(pointer.x-17)+'px';
      trash.style.top=(pointer.y-17)+'px';
      eraseUnderTrash();
      return;
    }
    var onT=(grab.kind==='letter'||grab.kind==='body')&&inTrash(pointer.x,pointer.y);
    trash.classList.toggle('on',onT);
    if(grab.kind==='body'){
      var B=grab.obj;
      // 弹簧：拖动 = 平移整条弹簧 + 它拴住的宿主。必须在这里早退：下面 B.x=pointer.x-grab.gx
      // 只认「中心 = 指针」的模型，弹簧两端由 e0/e1 决定，直接改中心会丢掉端点信息。
      if(B.kind==='S'){
        var sdx=pointer.x-grab.lx,sdy=pointer.y-grab.ly;
        if(sdx||sdy)springMoveRig(B,sdx,sdy);
        grab.lx=pointer.x;grab.ly=pointer.y;grab.t=performance.now();
        grab.svx=0;grab.svy=0;
        cv.style.cursor='grabbing';
        return;
      }
      // 轴向约束（见 dragAxisLock / dragPtrAxis）：指针先投影成等效指针 (epx,epy)，位置与抓取速度
      // 都用它，否则松手时会把被约束掉的法向分量当速度抛出去。
      // stepMatter 里每帧还有一处摆放（grab.obj.kind==='W'）必须用同一个 dragPtrAxis()，
      // 否则那处会用未投影的指针覆盖这里。
      var ep=dragPtrAxis(),epx=ep.x,epy=ep.y;
      B.x=epx-grab.gx;B.y=epy-grab.gy;
      if(B.kind==='T'){
        // 杆是刚体：拖杆 = 平移整个装配体（已锚定宿主跟走），与弹簧 springMoveRig 同一手感。
        // 用精确投影（rodDragPinHosts）把宿主摆到「锚点正好落在杆端」的唯一解，幂等，pointermove 与
        // stepMatter 的 240Hz 子步共用。不要按本帧指针位移增量搬宿主：指针停住时没有 pointermove，
        // 宿主在子步里被重力带走（停顿 1.5s 残差 231px），松手才被 rodSyncAnchors 拉回。
        rodDragPinHosts(B);
        if(B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th||0);}
        grab.svx=0;grab.svy=0;
        cv.style.cursor='grabbing';
        return;
      }
      if(B.kind==='W'){
        // a boundary is dragged, never thrown: keep it reachable, kill every trace of momentum
        B.x=clamp(B.x,-B.hw*0.6,W+B.hw*0.6);
        B.y=clamp(B.y,-B.hh*0.6,groundY+B.hh*0.9);
        B.vx=0;B.vy=0;B.om=0;grab.svx=0;grab.svy=0;
        // 所有边界体都累计指针速度（grab.svx），供 pointerup 松手带初速度用。
        // 「拖拽中不攒动量」（B.vx=0）与「记录指针速度」是两件事：前者保证跟手，后者只给松手那一刻留记录。
        var dtc=(performance.now()-grab.t)/1000||0.016;
        if(dtc>0){grab.svx=(epx-grab.lx)/dtc;grab.svy=(epy-grab.ly)/dtc;}
        grab.lx=epx;grab.ly=epy;grab.t=performance.now();
        cv.style.cursor='grabbing';
        return;
      }
      var dt=(performance.now()-grab.t)/1000||0.016;
      if(dt>0){
        var spx=(epx-grab.lx)/dt,spy=(epy-grab.ly)/dt;
        grab.svx=spx;grab.svy=spy;
        B.vx=spx;B.vy=spy;
      }
      grab.lx=epx;grab.ly=epy;grab.t=performance.now();
      var ft=findFreeLetterTarget(B);
      cv.style.cursor=ft?'copy':'grabbing';
    }else if(grab.kind==='letter'){
      var L=grab.obj;
      L.wx=pointer.x-grab.gx;L.wy=pointer.y-grab.gy;
      placeLetter(L);
      var dtt=(performance.now()-grab.t)/1000||0.016;
      if(dtt>0){grab.svx=(pointer.x-grab.lx)/dtt;grab.svy=(pointer.y-grab.ly)/dtt;}
      grab.lx=pointer.x;grab.ly=pointer.y;grab.t=performance.now();
      var h=findMergeTarget(L);
      cv.style.cursor=h?'copy':'default';
    }else if(grab.kind==='rot'){
      var Rb=grab.obj,s=tAnchor(Rb);
      // ABSOLUTE angle from the press point (not incremental) -> live snapping is possible:
      // within ±SNAP_DEG of a multiple of 90° the angle locks to it, and as soon as the user
      // drags out of the band it follows freely again. (Incremental snapping pinned the angle.)
      var a0=(grab.a0!=null)?grab.a0:Math.atan2(grab.ly-s.y,grab.lx-s.x);
      var th0=(grab.th0!=null)?grab.th0:(Rb.th||0);
      var a1=Math.atan2(pointer.y-s.y,pointer.x-s.x);
      var raw=th0+shortAng(a1-a0);
      var tgt=shortAng(snapAngle90(raw));   // LIVE snap while the button is still held
      // 高中模式：弹簧与物体连接后只能以按下时角度 th0 为基准跨一格（90°）。不能取「raw 最近的 90° 倍数」：
      // raw 与 th0 夹角 <45° 时算回原角度，dth=0 拖不动。推导见 springRotTargetHigh。
      /* 只有真弹簧（kind==='S' 且不是绳）在高中模式下用 springRotTargetHigh 量化目标角，
       * 与 springRotate 里的 !B.rope 同口径。对所有 kind 都量化的话，高中模式下杆、绳、弧、圆、方块等
       * 一切被旋转手柄操作的物体都只剩 4 个朝向。 */
      if(PHYS_MODE==='high'&&Rb.kind==='S'&&!Rb.rope)tgt=springRotTargetHigh(th0,raw);
      // 弹簧不认 B.th（派生量），要把角度写进端点。
      // seed 属于含方向锁弹簧的装配体 -> 旋转落到整个整体（含导轨朝向），返回 false 才走单体力学的旧路径。
      // 带子（传送带）走量化角度（BELT_ANG_SNAP=45° 的整数倍）+ setBeltAngle；必须放在
      // springAssemblyRotate 之前：带子不是弹簧装配体，但也是 W 体，须先被认出来。
      // 拖拽期间 stepMatter 每帧还会 setAngle 兜一次姿态。
      /* 地面/墙面吸 45° 整数倍（同带子 BELT_ANG_SNAP）。面板里改角度不吸附（数值输入以用户为准）。 */
      if(Rb.kind==='W'&&Rb.gnd){
        setGroundAngle(Rb,shortAng(snapAngleDeg(raw,45)));
      }else if(Rb.kind==='W'&&Rb.belt){
        setBeltAngle(Rb,shortAng(snapAngleDeg(raw,BELT_ANG_SNAP)),null);
      }else if(!springAssemblyRotate(Rb,tgt,s)){
        if(Rb.kind==='S')springRotate(Rb,tgt);else Rb.th=tgt;
      }
      grab.lx=pointer.x;grab.ly=pointer.y;
    }else if(grab.kind==='arcedit'){
      // 拖圆弧端点手柄：指针相对椭圆中心的角度（椭圆参数角）直接成为该端点的角度
      var Ab=grab.obj;
      if(Ab&&!Ab.dead&&Ab.ell){
        var wcA=arcWorldCenter(Ab);
        var dxA=pointer.x-wcA.x,dyA=pointer.y-wcA.y;
        // 吸附必须在世界系里做：先把指针的世界方向角吸附到 90° 整数倍，再换算回椭圆参数角
        // t = atan2(sinβ/ry, cosβ/rx)（pa=atan2(ly/ry,lx/rx) 的逆，rx==ry 时 t=β）。
        // 不要直接吸本地参数角：弧自身转过 th 后吸的是跟着斜过去的 0/90/180/270，与屏幕不符。
        // 旋转手柄吸的也是世界系的 th（见 grab.kind==='rot'），两边一致；弧恒为正圆 rx==ry。
        var waA=Math.atan2(dyA,dxA);                       // 指针相对椭圆圆心的世界方向角
        arcSetAngle(Ab,grab.end,arcParamFromWorldAng(Ab,snapAngle90(waA)));
      }
      grab.lx=pointer.x;grab.ly=pointer.y;
    }else if(grab.kind==='rodlen'){
      // 拖杆端长度手柄：固定端用按下时锁存的 (fx,fy)，拖拽端 = 指针。
      var Rb2=grab.obj;
      if(Rb2&&!Rb2.dead){
        // 宿主分派：带子走 setBeltEnds（pts 实时改 + 容差重建 W 体），杆走 rodPlaceEnds。
        // 杆必须走 rodPlaceEnds（索引序）而不是 setRodEnds：后者按角色摆（slot0=钉死端），拖 1 号端时编号会左右互换。
        // 带子没有 per-end 状态，且 setBeltEnds 的长度 clamp 认「slot1 = 被拖端」，所以保持原样。
        if(Rb2.belt)setBeltEnds(Rb2,grab.fx,grab.fy,pointer.x,pointer.y,false);
        else if(Rb2.gnd)groundDragEnds(Rb2,grab,pointer.x,pointer.y,false);   // 地面器件
        
        else rodDragEnds(Rb2,grab,pointer.x,pointer.y);
        Rb2.vx=0;Rb2.vy=0;Rb2.om=0;         // 位姿归指针，速度必须跟着清（否则一松手就飞）
      }
      grab.lx=pointer.x;grab.ly=pointer.y;
    }else if(grab.kind==='resizeE'||grab.kind==='resizeB'){
      var RB=grab.obj;
      if(RB.kind==='E'){
        // E: SYMMETRIC resize — the field stays centred on E. Dragging ANY edge moves the
        // OPPOSITE edge by the same amount, so both sides grow/shrink together (never a
        // lopsided box). Min 30px, max 900px per half-extent.
        var er=RB.er||{l:160,r:160,t:160,b:160};
        var ev;
        if(grab.rszSide==='l')ev=clamp(RB.x-pointer.x,30,900);
        else if(grab.rszSide==='r')ev=clamp(pointer.x-RB.x,30,900);
        else if(grab.rszSide==='t')ev=clamp(RB.y-pointer.y,30,900);
        else ev=clamp(pointer.y-RB.y,30,900);
        if(grab.rszSide==='l'||grab.rszSide==='r'){er.l=ev;er.r=ev;}
        else{er.t=ev;er.b=ev;}
        RB.er=er;
        RB.fieldR=er.l+er.r;   // keep the alias in sync (used by copy/refresh fallbacks)
      }else{
        // B: fieldR IS the circle radius — pointer distance from centre is the new radius.
        RB.fieldR=clamp(Math.hypot(pointer.x-RB.x,pointer.y-RB.y),60,700);
      }
      grab.lx=pointer.x;grab.ly=pointer.y;
    }
  });
  DD.addEventListener('pointerup',function(e){
    pointer.x=e.clientX;pointer.y=e.clientY;
    /* 松手时对未锚定的杆端统一跑一次吸附检测：不管这次拖的是杆还是物体，只要杆端此刻靠近某宿主就吸上
     * （与红点预览一致）。 */
    setTimeout(function(){
      if(grab&&grab.kind)return;
      for(var _ri=0;_ri<bodies.length;_ri++){
        var _R=bodies[_ri];
        if(_R.kind==='T'&&!_R.dead&&_R.anc&&(!_R.anc[0]||!_R.anc[1])){
          if(_R._snapCool&&performance.now()<_R._snapCool)continue;   // 解除后的冷却期内不吸附
          try{rodTryAnchor(_R);}catch(_e){}
        }
      }
    },0);
    /* 触摸：① 松手即取消长按计时；② 点选放置——这次按下没怎么动（tap）时，若已有选中体 ⇒ 搬到本次 tap
     * 的位置；否则把 tap 命中的体标记为已选中（手指粗难精细拖拽 ⇒ 「选中→点目的地」两步放置）。 */
    if(uiTouch()&&e.pointerType==='touch'){
      if(app.TOUCH_LP){clearTimeout(app.TOUCH_LP);app.TOUCH_LP=null;}
      /* _moved 必须量二维距离：只取 |Δx| 时纯竖直拖动恒被当成 tap（走点选放置、抹掉 grab），物体不动。
       * grab.x0/y0 是按下时的指针（body 抓取必写）；老字段 start 兜底。 */
      var _moved=0;
      if(grab&&grab.x0!=null)_moved=Math.hypot(pointer.x-grab.x0,pointer.y-grab.y0);
      else if(grab&&grab.start!=null)_moved=Math.abs(pointer.x-grab.start);
      if(touchPending){
        /* 轻点面板符号 ⇒ 面板内选中态（框+背景变色） */
        var _tpd=touchPending.d;touchPending=null;
        if(TOUCH_LETTER===_tpd){TOUCH_LETTER=null;if(_tpd.el)_tpd.el.classList.remove('touch-pick');}
        else{
          if(TOUCH_LETTER&&TOUCH_LETTER.el)TOUCH_LETTER.el.classList.remove('touch-pick');
          TOUCH_LETTER=_tpd;
          if(_tpd.el)_tpd.el.classList.add('touch-pick');
        }
        if(grab){grab.kind=null;grab.obj=null;}
        return;
      }
      /* 面板符号已选中 ⇒ 点画布 = 放置到点击位置：直接 place 到 pointer，
       * 不复用 gdDown 的 dock 分支（那会把符号放在面板字符原位置旁）。 */
      if(TOUCH_LETTER&&!TOUCH_LETTER.dead!==false&&TOUCH_LETTER.el){
        var _dl2=TOUCH_LETTER;TOUCH_LETTER=null;
        _dl2.el.classList.remove('touch-pick');
        if(_dl2.state==='dock'){
          gdDown({clientX:pointer.x,clientY:pointer.y,button:0,pointerType:'mouse'},_dl2);
          /* gdDown 会把符号放在面板位置并进入 grab——立刻把它搬到点击位置 */
          if(grab&&grab.kind==='letter'&&grab.obj){
            place(grab.obj,pointer.x,pointer.y,0,1,true);
            grab.obj.wx=pointer.x;grab.obj.wy=pointer.y;
          }
        }
        return;
      }
      if(!(grab&&grab.kind)||_moved<8){
        if(app.TOUCH_SEL&&!app.TOUCH_SEL.dead){touchMoveSelTo(pointer.x,pointer.y);}
        else{
          var _tgt=hoverB||null;
          if(!_tgt){
            for(var _ti=0;_ti<bodies.length;_ti++){
              var _B3=bodies[_ti];
              if(_B3&&!_B3.dead&&_B3.kind==='W'&&distToHost(_B3,pointer.x,pointer.y)<15){_tgt=_B3;break;}
            }
          }
          if(_tgt&&!_tgt.dead){
            app.TOUCH_SEL=_tgt;
            if(_tgt.el&&_tgt.el.classList)_tgt.el.classList.add('touch-sel');
            if(_tgt.mb)Matter.Sleeping.set(_tgt.mb,false);
          }
        }
        if(grab){grab.kind=null;grab.obj=null;}
      }
      /* 真正拖过（≥8px）⇒ 这次是直接拖动，丢掉上次 tap 留下的选中态，否则下一次随手一点会把旧物体搬过去。 */
      else if(app.TOUCH_SEL){touchClearSel();}
    }
    // 器件拖出的收尾（落点生效 / 丢回面板取消）。必须排在 trash/stroke 之前：
    // devDrag 与它们互斥，这里是唯一知道这次松手属于器件拖出的地方。
    if(TOOL.devDrag){endDeviceOut();return;}
    if(TOOL.stroke){finishStroke();return;}
    if(TOOL.drag){finishShapeDrag();return;}
    if(trashDrag.active){
      trash.style.left='';trash.style.top='';
      trash.style.right='24px';trash.style.bottom='24px';
      trash.classList.remove('on');
      trashDrag.active=false;
      grab.kind=null;grab.obj=null;
      return;
    }
    trash.classList.remove('on');
    if(grab.kind==='body'){
      var B=grab.obj;
      if(inTrash(pointer.x,pointer.y)){
        if(B.bh){explodeBlackHole(B);}   // a live black hole dropped in the trash DETONATES
        else{killBody(B);}
        grab.kind=null;grab.obj=null;
        return;
      }
      /* 画布上的 q 是场源体（spawnField('q') 造的 kind:'q' 体，在 bodies[] 里、有 hw/hh），
       * 画布按下走 grab={kind:'body'}，松手只会重新摆位，不会走字符的赋予分支。
       * 场源体丢到可赋予的物体上时执行赋予并清掉场源体；丢在空处仍就地摆位。
       * 注意：场源体没有 Matter 体，录制器 if(!mb)continue 会整类跳过它。 */
      /* 只有 q 走赋予（attach 给电荷）。E/B 是场：attach 对它们走并入 mem（它们在公式里是合法的
       * 质量字母），会把场融进物体、场源体消失。E/B/I 一律落回就地摆位成场源体。 */
      if(B.kind==='q'&&B.glyphs&&B.glyphs.length){
        var _tg=findSolidBodyAt(pointer.x,pointer.y);
        if(_tg&&_tg!==B){
          var _gl=B.glyphs[0];
          try{
            /* attach 可能什么都没做（如目标形状不在电荷白名单，attach 直接 return）⇒ 只有真的生效才清场源体，
             * 否则 q 消失了物体却没变。 */
            var _before=bodies.length;
            attach(_tg,_gl);
            var _gave=(_gl.body===_tg)||(_tg.mem&&_tg.mem.indexOf(_gl)>=0)||(_tg.charge!=null);
            if(!_gave){/* 没生效 ⇒ 不动场源体，落回原来的摆位行为 */}
            else{killFieldBody(B,bodies.indexOf(B));grab.kind=null;grab.obj=null;return;}
          }catch(e){/* 赋予失败 ⇒ 落回原来的摆位行为 */}
        }
      }
      if(inPanel(pointer.x,pointer.y)&&!B.kind){
        // drop a formula body back onto the panel box -> its letters dock into the box
        for(var pi2=B.glyphs.length-1;pi2>=0;pi2--){if(B.glyphs[pi2].stk)killG(B.glyphs[pi2]);}
        var rl=[];if(B.massG)rl.push(B.massG);
        for(var mi3=0;mi3<B.mem.length;mi3++){if(B.mem[mi3]!==B.massG)rl.push(B.mem[mi3]);}
        for(var ri=0;ri<rl.length;ri++){
          var LG=rl[ri];
          if(LG.body===B){LG.body=null;LG.inBody=false;}
          LG.pop=0;
          dockLetter(LG);
        }
        killBody(B);
        grab.kind=null;grab.obj=null;
        return;
      }
      if(B.kind){
        // 双击弹簧与物体的连接处可断联：在任何分支的双击/解散/拆分之前先拦截——同一物体第二次点击
        // （位移<14、间隔<500ms）且点击位置落在某弹簧已锚定端点 SPR_PAD 范围内 ⇒ 解除那一端锚定，不走默认动作。
        // W/T 分支原本无双击逻辑，下面各分支末尾补记 dblState.t，让此拦截对它们也生效。
        var dsF=dblState,nowF=performance.now();
        /* T/W 分支要先补记 dblState，否则下面的双击拦截看不到第二下（dsF.t 恒 0），解除永不触发。 */
        if(dsF.body!==B){dsF.t=nowF;dsF.body=B;dsF.x=pointer.x;dsF.y=pointer.y;dsF.g=null;}
        if(dsF.body===B&&dsF.t>0&&nowF-dsF.t<500){
          var mvdF=Math.hypot(pointer.x-dsF.x,pointer.y-dsF.y);
          if(mvdF<14&&springDisconnectAtPoint(pointer.x,pointer.y)){
            dsF.t=0;dsF.body=null;dsF.g=null;
            grab.kind=null;grab.obj=null;
            return;
          }
        }
        if(B.kind==='S'){
          // 弹簧：双击整体 -> 解散回 k/x；非双击时松手这一刻判定两端端点是否碰到别的物体，碰到就拴住。
          // 双击判定必须在这里自己走：公共双击分支在 if(B.kind){...} 之外，而 S 分支无条件 return。
          // 又不能去掉 return：后面的公共分支会按普通刚体给轻质弹簧加初速度，还会试图吸附到字母上。
          var dsS=dblState,nowS=performance.now();
          if(dsS.body===B){
            var mvdS=Math.hypot(pointer.x-dsS.x,pointer.y-dsS.y);
            if(mvdS<14&&dsS.t>0&&nowS-dsS.t<500){
              dsS.t=0;dsS.body=null;dsS.g=null;
              dissolveSpring(B);
              grab.kind=null;grab.obj=null;
              return;
            }
            if(mvdS<14)dsS.t=nowS;
            else{dsS.t=0;dsS.body=null;}
          }
          // 只有两端端点处接触才算锚，判定点就是两个端点本身；线圈中段压到什么都不算（只是支撑）。
          springTryAnchor(B);
          B.vx=0;B.vy=0;B.om=0;
          if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
          grab.kind=null;grab.obj=null;
          return;
        }
        if(B.kind==='W'){
          // 圆形像真实球：松开时若指针有速度就带着初速度滚出去（真刚体，Matter 接着算）
          if(B.wshape==='circle'&&B.rad){
            var spc=Math.hypot(grab.svx,grab.svy);
            if(spc>20){var f2c=clamp(1-spc/6000,0.5,1);B.vx=grab.svx*f2c;B.vy=grab.svy*f2c;}
            else{B.vx=0;B.vy=0;}
            // 把初速度注入 Matter 体（B.vx 只是自定义物理的变量，Matter 自己不知道）
            if(B.mb&&MW){
              Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
              // 松手时同时注入与平动一致的滚动自旋 ω=v/R：拖拽期间每帧冻结速度与角速度，只写线速度的话球是纯滑动
              // 发射，随后被接触摩擦强行拉进纯滚动，表现为急刹（实测 438→147px/s，80ms 内刹完）；补上 ω 后接触点滑移为 0，
              // 速度保留 100%。
              //   ① 单位：B.vx 是 px/s，Matter 的 angularVelocity 是 rad/帧 ⇒ ω = (B.vx/60)/R。
              //   ② R 取 mb.circleRadius（= B.rad+BND_INK，含墨迹半厚），与每帧的 ω 镜像、传送带通道同口径。
              //   ③ 符号：屏幕 y 向下时「向右滚」= 正 ω（与 vx 同号）。
              //   ④ 空中甩出也注入：球没有自旋标记，视觉无副作用；落地时已带匹配自旋，更接近人手抛出。
              //   ⑤ 只在圆这一支补：其它 W 体没有「滚」的对应关系，保持 ω=0。
              var _Rv=B.mb.circleRadius||(B.rad+BND_INK);
              Matter.Body.setAngularVelocity(B.mb,B.vx/60/_Rv);
              B.om=B.vx/_Rv;                  // 同步产品侧镜像（每帧也会再写一遍，这里不留帧缝）
              Matter.Sleeping.set(B.mb,false);
            }
            springTryAnchorByHost(B);   // 物体拖到弹簧端点旁也连
            if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
            grab.kind=null;grab.obj=null;
            return;
          }
          // 所有边界体松手都带初速度（不只圆形）：W 体全部由 Matter 积分（stepPhysics 里 if(B.kind==='W')continue），
          // 有 mass/inertia；丢掉指针速度会导致抛不出去，摩擦调 0 也滑不动。
          // 单位：B.vx 是 px/s，Matter 的 velocity 是 px/帧 → /60，与圆形同口径。
          var spW=Math.hypot(grab.svx,grab.svy);
          if(spW>20){var f2w=clamp(1-spW/6000,0.5,1);B.vx=grab.svx*f2w;B.vy=grab.svy*f2w;}
          else{B.vx=0;B.vy=0;}
          releaseConstrainVel(B);     // 速度先落在绳/铰链的可行域里（见 releaseConstrainVel）
          if(B.mb&&MW){
            Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
            Matter.Sleeping.set(B.mb,false);   // 睡着的体设速度不生效，必须先唤醒
          }
          if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
          springTryAnchorByHost(B);   // 物体拖到弹簧端点旁也连
          if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
          grab.kind=null;grab.obj=null;
          return;
        }
        // 拖动已存在的杆，松手时扫自己的两个端点；与 placeDevice 里那一句（刚放下时）对称，
        // 合起来补全「杆↔物体」两个方向的吸附。
        if(B.kind==='T'){
          rodTryAnchor(B);
          if(inPanel(pointer.x,pointer.y)){killBody(B);grab.kind=null;grab.obj=null;return;}
          // 这一支必须与 W / S 各支一样补记 dblState.t：双击解除拦截（if(B.kind){…} 里、各 kind 分支之前）
          // 的门是 dsF.body===B && dsF.t>0 && nowF-dsF.t<500，t 由上一次松手在这里装填
          // （pointerdown 只在 body 变化时才清 t）。直接 return 的话杆的双击解除永不触发。
          // 新增 kind 分支时要同样复制这个收尾动作。
          if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
          grab.kind=null;grab.obj=null;
          return;
        }
        // spawned field symbol (B/q/I) dragged back onto the panel box -> remove it
        if(inPanel(pointer.x,pointer.y)){
          killBody(B);
          grab.kind=null;grab.obj=null;
          return;
        }
        var sp2=Math.hypot(grab.svx,grab.svy);
        if(sp2>20){var f2=clamp(1-sp2/6000,0.5,1);B.vx=grab.svx*f2;B.vy=grab.svy*f2;}
        else{B.vx=0;B.vy=0;}
        releaseConstrainVel(B);       // 速度先落在绳/铰链的可行域里（见 releaseConstrainVel）
        springTryAnchorByHost(B);   // 物体拖到弹簧端点旁也连（弧/字母/标尺等）
        if(dblState.body===B){dblState.t=performance.now();dblState.x=pointer.x;dblState.y=pointer.y;}
        grab.kind=null;grab.obj=null;
        return;
      }
      var ds=dblState;
      var didSplit=false;
      if(ds.body===B){
        var mvd=Math.hypot(pointer.x-ds.x,pointer.y-ds.y);
        var now=performance.now();
        if(mvd<14){
          if(ds.t>0&&now-ds.t<500){
            // F：双击弹簧与物体的连接处断联 —— 先检查是否落在已锚定端点附近
            if(springDisconnectAtPoint(pointer.x,pointer.y)){
              ds.t=0;ds.body=null;ds.g=null;
              grab.kind=null;grab.obj=null;
              return;
            }
            // 弹簧：双击整体 -> 解散变回 k / x（其余物体维持原有的「双击拆分」语义）
            if(B.kind==='S')dissolveSpring(B);else splitOne(B,ds.g);
            ds.t=0;ds.body=null;ds.g=null;
            didSplit=true;
          }else{
            ds.t=now;ds.x=pointer.x;ds.y=pointer.y;
          }
        }else{
          ds.t=0;ds.body=null;
        }
      }
      if(didSplit){
        grab.kind=null;grab.obj=null;
        return;
      }
      if(Math.abs(grab.svx)>20||Math.abs(grab.svy)>20){
        var f=clamp(1-Math.hypot(grab.svx,grab.svy)/6000,0.5,1);
        B.vx=grab.svx*f;B.vy=grab.svy*f;
      }else{
        B.vx=0;B.vy=0;
      }
      var fl=findFreeLetterTarget(B);
      if(fl){attach(B,fl);}
    }else if(grab.kind==='letter'){
      dblState.t=0;
      var L=grab.obj;
      if(inTrash(pointer.x,pointer.y)){
        killLetter(L);
        grab.kind=null;grab.obj=null;
        return;
      }
      if(inPanel(pointer.x,pointer.y)){
        // dropped back onto the panel box -> returns to box and disappears
        killLetter(L);
        grab.kind=null;grab.obj=null;
        return;
      }
      /* q 落在实心物体上优先赋予电荷；只有落在空白处才生成场源（否则 B/E/q/I 的场源分支会抢先）。 */
      /* 光速 v 落到 ½mv² 上 ⇒ 走 bossPlace（前两次排斥、第三次融合）。必须放在 findSolidBodyAt 之前：
       * ½mv² 是动态体会被它命中并送进 attach()，而 attach 对表达式目标无条件并入 mem（会毁掉公式）。
       * 用 bossIsEk() 精确判型后抢先分流。 */
      if(L.ch==='v'&&L.vLight){
        var _ek=bossFindEkNear(pointer.x,pointer.y);
        if(_ek){bossPlace(_ek,L);grab.kind=null;grab.obj=null;return;}
      }
      if(L.ch==='q'){
        var _qb=findSolidBodyAt(pointer.x,pointer.y);
        /* 命中了但形状不在电荷白名单（圆轨/凹槽/手绘笔画…）⇒ 不赋予，落到下面的场源体分支；绝不并进物体（见 attach）。 */
        if(_qb&&qGiveable(_qb)){attach(_qb,L);grab.kind=null;grab.obj=null;return;}
        /* q 在生成场源体之前先试一次 findMergeTarget，与 v 同序（v 命中失败会依次走 findTComboTarget →
         * findKXCombo → 实心命中 → findMergeTarget → findFreeMassTarget）；否则 q 被 spawnField('q') 分支
         * 直接 return 截断，同一落点 v 融得进去 q 融不进去。真的没有目标时 q 仍变成场源体。 */
        var _qm=findMergeTarget(L);
        if(_qm){attach(_qm,L);grab.kind=null;grab.obj=null;return;}
      }
      if(L.ch==='B'||L.ch==='q'||L.ch==='I'||L.ch==='E'){
        spawnField(L.ch,L.wx,L.wy,grab.svx||0,grab.svy||0);
        killLetter(L);
        grab.kind=null;grab.obj=null;
        return;
      }
      // 't' combos: qt -> I, gt -> v, vt -> rod (hijacks a simple body)
      var tc=findTComboTarget(L);
      if(tc){applyTCombo(L,tc);grab.kind=null;grab.obj=null;return;}
      // k 与 x 拼起来 = 弹簧（不分先后，见 findKXCombo）
      var sc=findKXCombo(L);
      if(sc){applyKXCombo(L,sc);grab.kind=null;grab.obj=null;return;}
      /* 赋予型字符（v/q）拖到实心物体上就生效：纯形状（无质量字母的方块/圆）在 canMerge 规则下不接收参数字母，
       * 但「赋予」不需要并入物体 ⇒ 单独按实心区域命中判定。 */
      if(L.ch==='v'||L.ch==='q'||L.ch==='a'){
        var _sb=findSolidBodyAt(pointer.x,pointer.y);
        if(_sb){attach(_sb,L);grab.kind=null;grab.obj=null;return;}
      }
      var B2=findMergeTarget(L);
      if(B2){
        attach(B2,L);
      }else{
        // shatter/split leaves letters FREE on the canvas. A loose mass (m/M) must still work
        // as a base: promote it to a body right here, then merge the dragged letter into it.
        // (mc, mg, mv, mG, Mm … all assemble again without a manual nudge.)
        var FM=findFreeMassTarget(L);
        if(FM){
          var fi3=freeL.indexOf(FM);if(fi3>=0)freeL.splice(fi3,1);
          var nb3=BODY(FM.wx,FM.wy);
          FM.pop=0;FM.body=nb3;FM.inBody=true;
          nb3.massG=FM;nb3.glyphs=[FM];
          refresh(nb3);
          if(canMerge(nb3,L)){
            attach(nb3,L);
            ringGo(nb3.x,nb3.y);
          }else{
            // not a valid merge after all — undo the promotion and keep the old behaviour
            var ri3=bodies.indexOf(nb3);if(ri3>=0)bodies.splice(ri3,1);
            FM.body=null;FM.inBody=false;FM.pop=0;
            if(freeL.indexOf(FM)<0)freeL.push(FM);
            placeLetter(FM);
            if(isMass(L)||L.type==='G'){
              var nb=BODY(L.wx,L.wy);
              L.pop=0;L.body=nb;L.inBody=true;
              if(isMass(L)){ nb.massG=L; nb.glyphs=[L]; refresh(nb); }
              else { nb.glyphs=[L]; attach(nb,L); }
              ringGo(nb.x,nb.y);
            }else{
              L.state='free';
              var spd=Math.hypot(grab.svx,grab.svy);
              if(spd>40){L.vx=grab.svx*clamp(1-spd/8000,0.4,1);L.vy=grab.svy*clamp(1-spd/8000,0.4,1);}
              else{L.vx=0;L.vy=0;}
              if(freeL.indexOf(L)<0)freeL.push(L);
              placeLetter(L);
            }
          }
        }else if(isMass(L)||L.type==='G'){
        // no body nearby accepts it -> spawn a fresh body here.
        // Masses become the base (massG); G is routed through attach() so it lands in
        // mem (setF/layoutGrav read G from mem, not massG).
        var nb=BODY(L.wx,L.wy);
        L.pop=0;L.body=nb;L.inBody=true;
        if(isMass(L)){ nb.massG=L; nb.glyphs=[L]; refresh(nb); }
        else { nb.glyphs=[L]; attach(nb,L); }
        ringGo(nb.x,nb.y);
      }else{
        L.state='free';
        var spd=Math.hypot(grab.svx,grab.svy);
        if(spd>40){L.vx=grab.svx*clamp(1-spd/8000,0.4,1);L.vy=grab.svy*clamp(1-spd/8000,0.4,1);}
        else{L.vx=0;L.vy=0;}
        if(freeL.indexOf(L)<0)freeL.push(L);
        placeLetter(L);
      }
      }
      cv.style.cursor='default';
    }else if(grab.kind==='rot'){
      // release: snap the angle to the nearest 90° multiple if within the snap band.
      // (Snapping only on RELEASE avoids freezing the drag — per-step snapping would pin
      // the angle at the initial multiple when dragging in small increments.)
      if(grab.obj){
        var RbU=grab.obj;
        // 方向锁装配体 -> 松手吸附也落到整个整体（同一套 springAssemblyRotate，幂等）
        if(springLockedAsmOf(RbU)){
          springAssemblyRotate(RbU,shortAng(snapAngle90(RbU.th)),tAnchor(RbU));
        }else{
          RbU.th=shortAng(snapAngle90(RbU.th));
          // 弹簧松手时同样要落到端点上（B.th 是派生量，改它没用）
          if(RbU.kind==='S')springRotate(RbU,RbU.th);
        }
        // W 边界的角度必须写进 Matter 本体：stepMatter 每帧用 mb.angle 覆写 B.th，
        // 不写回的话松手时的 90° 吸附会被弹回旧角度。
        if(RbU.kind==='W'&&RbU.mb){
          Matter.Body.setAngle(RbU.mb,RbU.th);
          Matter.Body.setAngularVelocity(RbU.mb,0);
          Matter.Sleeping.set(RbU.mb,false);
        }
      }
    }else if(grab.kind==='arcedit'){
      // 松开弧端点手柄：解除「编辑固定」。若之前右键固定过（B.fixed）则继续 static，否则恢复动态。
      // _snap 复位，静置检测重新计时。
      var Ab3=grab.obj;
      if(Ab3&&!Ab3.dead){
        Ab3.editLock=false;
        // 松手时再吸附一次（与旋转手柄同一约定）：拖动中已实时吸附过，这里是幂等兜底，覆盖最后一次
        // pointermove 落在吸附带边界这类时序。同样在世界系里做（arcEndWorldAng/arcParamFromWorldAng），
        // 吸本地 a0/a1 会在 th≠0 时把已吸正的世界方向拧回去。
        if(Ab3.ell)arcSetAngle(Ab3,grab.end,
                               arcParamFromWorldAng(Ab3,
                                 snapAngle90(arcEndWorldAng(Ab3,grab.end))));
        if(Ab3.mb){
          if(!Ab3.fixed)Matter.Body.setStatic(Ab3.mb,false);
          Matter.Sleeping.set(Ab3.mb,false);
        }
        Ab3._snap=null;
      }
    }else if(grab.kind==='rodlen'){
      // 松手：按最后一次指针位置无条件重建镜像板（force=true），保证松手时的长度就是碰撞板的真实长度
      // （拖动中为省开销允许 6px 容差漂移）。
      var Rb4=grab.obj;
      if(Rb4&&!Rb4.dead){
        if(Rb4.belt)setBeltEnds(Rb4,grab.fx,grab.fy,pointer.x,pointer.y,true);
        else if(Rb4.gnd)groundDragEnds(Rb4,grab,pointer.x,pointer.y,true);   // 地面器件
        else rodDragEnds(Rb4,grab,pointer.x,pointer.y);      // 同 pointermove：杆按索引摆
        Rb4.vx=0;Rb4.vy=0;Rb4.om=0;
        if(Rb4.mb&&Matter.Sleeping)Matter.Sleeping.set(Rb4.mb,false);
      }
    }else if(grab.kind==='resizeE'||grab.kind==='resizeB'){
      // release: nothing cached — fieldR already applied live during move
    }
    grab.kind=null;grab.obj=null;
  });
  DD.addEventListener('pointercancel',function(){
    if(grab.kind==='letter'&&grab.obj){
      var L=grab.obj;
      L.state='free';
      if(freeL.indexOf(L)<0)freeL.push(L);
      placeLetter(L);
    }
    rszHandle.classList.remove('on');
    cv.classList.remove('cur-ew','cur-ns');
    grab.kind=null;grab.obj=null;cv.style.cursor='default';
  });
}

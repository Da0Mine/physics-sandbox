/* 全局常量、DOM 引用、工具函数、字形对象、物体 / 杆 / 传送带构造（原 index.html 第 793–1437 行） */
var ctx2d=document.createElement('canvas').getContext('2d');
var F=48,GRAV=2600,AACC=1300,RM=150,MT={},RAISE=F*0.3;
var B_FIELD_RANGE=320,BZ_DIR=1,Q_OMEGA=2.4,A_FORCE=900,Q_FORCE=2.2;
/* ★R132-9zq：带电 **W 体**（矩形/圆形/三角形器件）在场里的施力系数。
   Matter 的 `applyForce` 对**帧级**调用只会影响 4 个子步中的 1 个，且 `body.force` 在
   每步末清零 ⇒ 不能直接照抄 `applyGivenAccel`（那是**逐子步**口径 `/1e6`）。
   ★这个值是**实测标定**出来的（不是推导）：`_diag_r361_qhole.py` H10b 去摩擦量加速度，
     `/1e6 → 比值 0.013`、`/12500 → 比值 9.0`（`eacc=0.05` 小倍率避开速度上限与右墙）
     ⇒ 线性外推到「实测 a == E_FIELD_ACC」得 **`/112500`**。 */
var QFIELD_K=112500;
var E_FIELD_RANGE=320,E_FIELD_ACC=1500;   // E field: SQUARE range (half-side 160), uniform direction (th), F=qE
var cv=document.getElementById('cv');
var panel=document.getElementById('panel');
var shadow=document.getElementById('shadow');
var handle=document.getElementById('handle');
var rszHandle=document.getElementById('fresize');
var ark=[document.getElementById('ark0'),document.getElementById('ark1')];   // R56 圆弧端点手柄
var arcHov=null;   // 手柄当前归属的弧（refreshHover 每帧更新）
var rodh=[document.getElementById('rodh0'),document.getElementById('rodh1')]; // R98-3 杆两端长度手柄
var rodHov=null;   // 长度手柄当前归属的杆（refreshHover 每帧更新）
var ring=document.getElementById('ring');
var menu=document.getElementById('menu');
var pbox=document.getElementById('pbox');
var ptitleEl=document.querySelector('.params .ptitle'),pvalEl=document.querySelector('.params .pval');
var prows=document.getElementById('prows'),pclose=document.getElementById('pclose'),
    pcontacts=document.getElementById('pcontacts');
var trash=document.getElementById('trash');
var pointer={x:-9999,y:-9999};
var W=0,H=0,groundY=0,t=0,menuBody=null,menuLetter=null;
var dragBody=null,dragLetter=null,rotBody=null,rotGrab=0,hoverBody=null,handleBody=null;
// R59：旋转手柄驻留 —— 手柄显示过之后即使 hover 丢了也再留一段时间，让指针来得及挪到手柄上
var handleKeep=null,handleLinger=0,HANDLE_LINGER=900;   // R59b 用户要求「缩短一半」（1800->900），随 R60 重做保留
var axisBody=null,axisLast=null;
var bodies=[],freeG=[],parts=[],ALL=[],slots={},samples=[];
var OPEN='(',CLOSE=')',PLUS='+',SQ='²',BAR='-',HALF='½',MU='μ',SUB1='₁',SUB2='₂',PRIME='′';
var SHATTER_SPEED=1100;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function shortAng(d){d=d%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
// snap an angle to the nearest multiple of 90° when within SNAP_DEG (default 8°), else unchanged.
var SNAP_DEG=8;
function snapAngle90(a){var q=Math.PI/2,d=Math.PI*SNAP_DEG/180;var near=Math.round(a/q);return Math.abs(a-near*q)<=d?near*q:a;}
/* R101③（用户：「角度调节是鼠标悬浮出现旋转按钮（在每45度的倍数的角度有吸附功能）」）：
 * ★★本条已在 **R102** 被用户更正，勿照旧注释改回去。
 *   R101③ 第一版的理解是「带子的角度是**量化**的」—— 写成 `Math.round(a/q)*q`，任何角度都
 *   吸到最近的 45° 档，自由斜角一律抹掉。用户的原话是「**在每45度的倍数的角度有吸附功能**」，
 *   他把这条否掉时的说法是：「我的意思是在**特定角度的附近吸附**，不是**只能**调到这几个角度」。
 *   ⇒ 正确语义与 snapAngle90 同款：**落在 ±BELT_SNAP_DEG 带内才吸**，带外保留自由斜角。
 *   详见 snapAngleDeg 上方 R102 那段注释（含「旧断言为什么要被反向，以及为什么那不是放宽
 *   判据而是适用面重新定界」的说明）。
 * ★另一条夹具教训仍然有效、别丢：第一版测试用了 60/135/270/−45（天然就是 45 的倍数）
 *   ⇒ 没有吸附的实现也能全绿 —— 那是「夹具把自己的结论喂给自己」。判定**必须**用非 45 倍数的
 *   目标角，且现在要分成「带内」与「带外」两组分别断言。
 * 其余物体（杆 / 弹簧 / E 场）的吸附一格不动，仍是 90°±8°。 */
var BELT_ANG_SNAP=45, BELT_SNAP_DEG=8;
/* 只在「离 45° 整数倍 ±BELT_SNAP_DEG 以内」才吸上去，带外一律保留**自由斜角**。
 * 第三参 tolDeg 留了口子（默认 BELT_SNAP_DEG），方便将来调手感。
 * ★★R102（用户：「我的意思是在特定角度的附近吸附，不是只能调到这几个角度」）：
 *   本函数原先是 `Math.round(a/q)*q` —— **任何**角度都被量化到最近的一档，**自由斜角被全部抹掉**。
 *   那时候的判据可以写成硬断言「落点必是 45 的整数倍」，看起来很美，但它把「可调」这一条
 *   用户原诉求（R101③ 的「角度调节」）本身给取消了 —— 用户要的是**调到 44° 时帮我落到 45°**，
 *   不是**永远只能取 0/45/90**。改成与 snapAngle90 同款的「落在吸附带内才吸」之后：
 *     · 拖到 44°  →  吸到 45°（用户说的「附近吸附」）
 *     · 拖到 30°  →  就是 30°（用户说的「不是只能调到这几个角度」）
 *   ⇒ `_diag_r101g_beltrot.py` 组 R 里「非整数倍目标必须等于原值」的旧断言需要**反向**改成
 *     「非整数倍且不在吸附带内 ⇒ 保持原值」，并**新增**一组「在吸附带内 ⇒ 落到 45 的倍数」
 *     （旧夹具的态度是「量化=对的」，本轮用户明确否掉了这个前提 ⇒ 这是**适用面重新定界**，
 *     不是放宽判据；见 §28.5）。 */
function snapAngleDeg(a,stepDeg,tolDeg){
  if(!(stepDeg>0))return a;
  var q=stepDeg*Math.PI/180;
  var tol=((tolDeg!=null)?tolDeg:BELT_SNAP_DEG)*Math.PI/180;
  var near=Math.round(a/q);
  return Math.abs(a-near*q)<=tol?near*q:a;
}
function met(ch,size){
  size=size||F;
  var key=ch+'@'+size;
  if(MT[key])return MT[key];
  ctx2d.font='italic '+size+'px Georgia,"Times New Roman",serif';
  var q=ctx2d.measureText(ch);
  var fba=q.fontBoundingBoxAscent||q.actualBoundingBoxAscent||60;
  var fbd=q.fontBoundingBoxDescent||q.actualBoundingBoxDescent||20;
  var ia=q.actualBoundingBoxAscent||0;
  var id=q.actualBoundingBoxDescent||0;
  var bl=(size-(fba+fbd))/2+fba;
  // il/ir: the INK's horizontal extent relative to the glyph's own centre (the element is
  // centred on the advance width q.width). The advance box carries side bearings, so its
  // edges are ~1px outside the ink — good enough for layout, but for collision it means a
  // contact would stop 1px early on each side. Fall back to ±w/2 when the ink metric is
  // missing or clearly bogus.
  var w2=q.width/2,aL=q.actualBoundingBoxLeft,aR=q.actualBoundingBoxRight;
  var il=(aL==null)?(-w2):(-aL-w2), ir=(aR==null)?(w2):(aR-w2);
  if(!(il<ir)||il<-w2-8||ir>w2+8||ir-il<=0){il=-w2;ir=w2;}
  MT[key]={top:bl-ia-size/2,bot:bl+id-size/2,w:q.width,il:il,ir:ir};
  return MT[key];
}
function isLet(d){return d.type==='g'||d.type==='a'||d.type==='v'||d.type==='r';}
function isMass(d){var t=(typeof d==='string')?d:d.type;return t==='m'||t==='M';}
function GD(ch,sc){
  sc=sc||1;
  var sz=F*sc;
  var el=document.createElement('div');
  el.className='char';
  el.style.fontSize=sz+'px';
  el.textContent=ch;
  document.body.appendChild(el);
  var d={el:el,ch:ch,type:ch,clone:false,body:null,sx:0,sy:0,w:el.offsetWidth,h:el.offsetHeight,wx:0,wy:0,vx:0,vy:0,anim:0,rung:false,pop:0,r:0,dead:false,m:met(ch,sz)};
  ALL.push(d);
  el._letterRef=d;   // back-pointer so panel-eat can find the letter behind the .char
  el.addEventListener('pointerdown',function(e){gdDown(e,d);});
  el.addEventListener('contextmenu',function(e){
    e.preventDefault();
    if(d.dead)return;
    var mb=d.body;
    if(mb&&mb.glyphs&&mb.glyphs.indexOf(d)>=0){openMenu(e.clientX,e.clientY,mb,d);return;}
    /* ★R131-44（用户：「右键经常没反应，好像每个 t 调节一次后就再也调不了」）：赋予型字符
     *  （v/a/q/t）promote 后**有宿主但不在 glyphs/mem 里** ⇒ 上面两个分支都不走 ⇒ 右键失灵。
     *  这里补一条：只要有宿主就照常弹菜单（参数面板仍然读它自己的赋值字段）。 */
    if(mb){openMenu(e.clientX,e.clientY,mb,d);return;}
    // a FREE (unmerged) letter has no body — promote it IN PLACE to a single-letter body so
    // right-clicking it (r, g, a, v, μ …) opens the param panel like any merged letter.
    if(!mb&&(d.state==='free'||d.state==='grab'||d.state==='idle')){
      var B=promoteFreeLetter(d);
      if(B)openMenu(e.clientX,e.clientY,B,d);
    }
    /* ★★R131-34（用户：「怎么我现在右键 t 没反应，不应该也有一个复制的按钮吗」）：
     *  面板（dock）里的字符右键**原本完全不弹菜单**（只有 free/grab/idle 才弹）⇒ 面板里
     *  右键 t/v/q 毫无反应。修：dock 态也弹——用 promoteFreeLetter 造一个**临时参数宿主**，
     *  立即从 bodies 摘掉（只作菜单/参数的载体，不上场）。 */
    if(!mb&&d.state==='dock'){
      var B2=promoteFreeLetter(d);
      if(B2){
        var bi2=bodies.indexOf(B2);if(bi2>=0)bodies.splice(bi2,1);
        /* ★★R132-9z：这个临时宿主**已经把字母从 bodies[] 摘掉了**（不是场上的体），
         *   却还挂在 `d.body` 上 ⇒ 字母变成「有个不在场上的宿主」的**孤儿**。
         *   后果实测（`_tmp_r370_qgive.py` B/C 臂）：右键面板 q 之后 `qO.hasBody` 变成 true，
         *   而 `promoteFreeLetter` 开头是 `if(d.body)return d.body;`
         *   ⇒ **下一次右键会复用这个已被摘除的孤儿宿主**，参数面板/菜单操作在一个不在场上的体上做。
         *   修：菜单照常用 B2（`openMenu` 自己持有引用），但把 `d.body` 立刻清回 null，
         *   状态仍是 `'dock'`（面板槽位不变）—— 下次右键会重新 promote 一个干净的临时宿主。 */
        d.body=null;
        openMenu(e.clientX,e.clientY,B2,d);
      }
    }
  });
  return d;
}
var mO=GD('m');
var gO=GD('g');
var aO=GD('a');
var vO=GD('v');
var rO=GD('r');
var M2O=GD('M');
var halfO=GD(HALF);
var muO=GD(MU);
var cO=GD('c');
var GO=GD('G');
var tO=GD('t');
var BO=GD('B');
var qO=GD('q');
var IO=GD('I');
var EO=GD('E');
// R57（用户 #7）：新增 k 和 x —— 它们是弹簧的两个组成字母（k·x -> 弹簧，见 makeSpring）
var kO=GD('k');
var xO=GD('x');
gO.el.style.zIndex='5';
aO.el.style.zIndex='5';
vO.el.style.zIndex='5';
rO.el.style.zIndex='5';
M2O.el.style.zIndex='5';
halfO.el.style.zIndex='5';
muO.el.style.zIndex='5';
cO.el.style.zIndex='5';
GO.el.style.zIndex='5';
tO.el.style.zIndex='5';
BO.el.style.zIndex='5';
qO.el.style.zIndex='5';
IO.el.style.zIndex='5';
EO.el.style.zIndex='5';
kO.el.style.zIndex='5';
xO.el.style.zIndex='5';
freeG.push(gO,aO,vO,rO,M2O,halfO,muO,cO,GO,tO,BO,qO,IO,EO,kO,xO);
function BODY(x,y){
  var B={x:x,y:y,vx:0,vy:0,th:0,sc:1,glyphs:[],mem:[],massG:null,mass:1,massCap:3,hasG:false,hasA:false,hasV:false,hasR:false,family:0,hw:40,hh:26,dv:0,drag:false,diss:false,orbit:null,pendingOrbit:false,param:{},
    kind:null,fg:null,fieldR:0,Bz:1,qsign:1,Isign:1,fieldState:null,L:48,
    er:null,   // E field: asymmetric 4-edge half-extents {l,r,t,b} — each edge drags independently
    bh:null,   // black-hole state {stage:0 growing/1 alive, r, R, t, age, spin, seed}
    st:{open:null,close:null,plus:null,sq:null,slash:null}};
  bodies.push(B);
  return B;
}
// promote a FREE (unmerged) letter in place to a single-letter body at its current position,
// so right-clicking any free adjustable letter (r/g/a/v/μ…) can open the param panel.
// Note: for SHATTER-derived stray letters this may feel invasive; we keep it minimal and
// only lift letters that carry an adjustable param (specIdForLetter != null).
function promoteFreeLetter(d){
  if(!d||d.dead)return null;
  if(d.body)return d.body;
  if(!specIdForLetter(d))return null;
  /* ★★R131-43（用户：「改过角度/参数的 v、a、q 就无法和物体融合了」）：真因——打开参数
   *  面板会把字符 promote 并 **并入 B.mem**，之后它就不再是"自由字符"⇒ 松手时的
   *  「实心命中 ⇒ 赋予」分支不再命中。修：**赋予型字符（v/a/q/t）promote 后只当参数宿主，
   *  不进 mem**（保持自由、可反复赋予）。 */
  var _sid=specIdForLetter(d);
  var _giveType=(_sid==='vsize'||_sid==='asize'||_sid==='qcharge'||_sid==='tscale');
  var x=d.wx!==undefined?d.wx:d.el.offsetLeft;
  var y=d.wy!==undefined?d.wy:d.el.offsetTop;
  var B=BODY(x,y);
  d.pop=0;d.body=B;d.inBody=true;
  /* ★★R131-50（用户：「ma 我现在都组合不了」——R131-43 让 a 「不并入 mem」把组合也一起
   *  掐掉了）：**按目标类型分流**——
   *   · 目标是**由字符组成的体**（massG / glyphs / mem 里有字母，即"表达式"）⇒ **正常并入**
   *     （恢复 ma、mc 这类组合）；
   *   · 目标是**纯形状物体**（方框/圆等，无字形）⇒ 走「赋予」（不进 mem）。
   */
  var _targetIsFormula=!!(B&&(B.massG||(B.glyphs&&B.glyphs.length)||(B.mem&&B.mem.length)));
  if(_giveType&&!_targetIsFormula){
    /* 赋予型字符：不并入 mem（否则后续无法再赋予）；也不占 glyphs。
     * state 必须是 **'free'**（可继续拖动/再次右键）。
     * ★★R131-50（真鼠标实测发现的缺陷）：这里 BODY(x,y) **已经把这个临时宿主体注册进
     *  bodies** ⇒ 场上多出一个"看不见的体"（实测拖 a 出来后 `bodies.length` 变成 2）——
     *  它会参与物理/碰撞、挡住点击、把字符带飞，是「a 拖不动/放到地面就消失」这一族怪象的
     *  共同来源。修：赋予型字符的宿主**只作参数载体，立即从场上摘除**（含 Matter 体）。 */
    /* ★★R131-59（用户：「右键/长按一次后字符就抓不动」的**根因**；REC + _diag_r172 实证）：
     *  上面第 772 行把 `d.inBody=true` 留下了。而 placeLetter()/syncGlyphs() 对
     *  `inBody && body` 的字母是**按宿主槽位 slot(B,g) 摆位**的 —— 但赋予型字符的宿主是
     *  `_paramOnly`（已从 bodies 摘除、不积分、永不移动）⇒ 字母的 DOM 元素被**钉死在
     *  promote 那一刻的位置**，与它自己的 wx/wy 彻底脱钩。实测（_diag_r172）：
     *    · 字母 wx 从 600 移到 760，元素中心仍停在 599.8（偏差 160px）；
     *    · 按住元素拖 100px，元素位移 **0.0px** ⇒ 用户看到的「字符抓不动」；
     *    · 那个钉住的元素还**吃掉画布的 pointerdown**（REC 里 pointer 底下的 el 恒为
     *      DIV.char、而真实字母早已飞到别处 —— 正是"抓两次才动/抓不动"的现场）。
     *  修：赋予型字符的宿主只是**参数载体**，绝不接管渲染 ⇒ inBody=false（元素继续按 wx/wy 摆）。
     *  另一处（同源）：**面板(dock)里的字符被右键**时不能顺手变成场上的自由字符 ——
     *  否则 state 从 'dock' 变 'free'，面板槽位就空了（sortPanel/dockedTwins 都按 'dock' 认）。 */
    var _wasDock=(d.state==='dock');
    d.state=_wasDock?'dock':'free';
    d.inBody=false;
    try{
      var _bi=bodies.indexOf(B);
      if(_bi>=0){
        if(B.mb&&MW&&MW.engine&&Matter&&Matter.Composite&&Matter.Composite.remove)
          Matter.Composite.remove(MW.engine.world,B.mb);
        bodies.splice(_bi,1);
      }
      B._paramOnly=true;
      B.dead=false;
    }catch(_e){}
    return B;
  }
  B.mem.push(d);
  if(isMass(d)){
    B.massG=d;B.glyphs=[d];
  }else{
    B.glyphs=[d];
    // set the letter's local offset straight from its current world position (no refresh):
    // layoutBody would crash on an isolated non-formula letter (a/v/r/μ…), so we place it
    // manually and let the param panel work off the body reference alone.
    var dx=x-B.x,dy=y-B.y;
    d.sx=dx;d.sy=dy;d.w=d.el.offsetWidth||F*0.7;d.h=d.el.offsetHeight||F;
    if(d.type==='r')B.hasR=true;else if(d.type==='v')B.hasV=true;
    else if(d.type==='g')B.hasG=true;else if(d.type==='a')B.hasA=true;
    else if(d.type===MU)B.hasMu=true;
    // box = the letter's own INK, not the whole F-tall em box (that one made a lone letter
    // hover ~13px above the ground). Symmetric about B.x/B.y, so the glyph never has to move.
    var mm=d.m||{w:d.w,top:-F/2,bot:F/2};
    B.hw=Math.max(6,Math.max(6,(mm.w||d.w)/2)+BOX_PAD);
    B.hh=Math.max(6,Math.max(Math.abs(mm.top),Math.abs(mm.bot==null?F/2:mm.bot))+BOX_PAD);
    initWorld(B);
    place(d,x,y,0,1,true);
  }
  var fi=freeL.indexOf(d);if(fi>=0)freeL.splice(fi,1);
  B.vx=0;B.vy=0;
  return B;
}
function spawnField(kind,x,y,svx,svy){
  var B=BODY(x,y);
  B.kind=kind;
  var g=GD(kind);
  g.pop=0;g.body=B;g.inBody=true;
  /* ★R132-9zf：场源体的字形必须**自洽**。原来 `GD()` 造出来的字形 `gx/gy` 是 **NaN**
     （`spawnField` 只挂了 body/inBody，从没写过偏移），而 `syncGlyphs`/`placeLetter` 之外的
     路径（悬停高亮、拖拽落点回算、录屏几何）都会读它 ⇒ 实测 `_tmp_r380_where.py`：
     场源体 q 的字形 `gx=NaN, gy=NaN`，而 DOM 靠 `slot()` 摆在 (1034,397)；
     场源体本体 (1047.8,420.9) 与用户松手点 (1106,376) 差了 (58,−45)
     ⇒ 「明明放在物体上、却偏了 45~58px」正是从这里来的。
     ⇒ 这里把偏移钉成 0、坐标钉成体位置：字形就真正「长在」场源体上。 */
  g.gx=0;g.gy=0;g.wx=B.x;g.wy=B.y;
  B.fg=g;
  B.glyphs=[g];
  var sp=Math.hypot(svx||0,svy||0);
  var f=sp>20?clamp(1-sp/6000,0.5,1):0;
  if(kind==='B'){B.fieldR=B_FIELD_RANGE;B.Bz=BZ_DIR;B.vx=0;B.vy=0;}
  else if(kind==='E'){B.er={l:160,r:160,t:160,b:160};B.fieldR=320;B.th=0;B.vx=0;B.vy=0;}   // E field: uniform direction, rotatable via th; 4 independent edges
  /* ★★R132-9zh（用户 2026-10-03：「放进去根本没反应」+ 录屏 `rec_2026-10-03-05-57-33.json`）：
   *   `q`/`I` 场源体原来**继承松手时的鼠标速度**（`svx/svy`），于是被"甩"出去后
   *   **一路滑行、永远不停** —— 场源体既没有重力也没有接触摩擦，只有 `stepPhysics` 的
   *   `B.x+=B.vx*dt` 在推它。`defineProperty` 陷阱实测（`_tmp_r381_whowrites.py`）：
   *   松手点 (1106,376) ⇒ 每帧 x−4~8 / y+3~6 地漂，4 帧后已偏到 (1078.9,396.9)；
   *   再多跑几十帧就是录屏里那 45~58px 的偏差（也是「明明放在物体上却偏了」的直接来源）。
   *   ⇒ **场（电荷场/电流场）没有惯性**：与 `B`/`E` 一致，**速度清零**，就落在松手点。
   *   （`f` 只留给真正该被甩出去的东西；场源体的 `svx/svy` 从此不参与。） */
  else if(kind==='q'){B.qsign=1;B.vx=0;B.vy=0;}
  else if(kind==='I'){B.Isign=1;B.vx=0;B.vy=0;}
  refresh(B);
  /* ★R132-9zg：**场源体必须落在松手点**。`refresh(B)` 对「几何来自字形」的体（场源体的
     `npts=0`，形状就是那个字符）会按字形盒重算 `B.x/B.y` ⇒ 实测（`_tmp_r380_where.py`）
     用户松手在 (1106,376)、场源体却建在 (1050.8,418.6)，**偏了 (55,−43)px** ——
     这就是「我明明放在物体上、却总是偏」的来源之一（而且它同时让"落点命中判定"整体错位）。
     ⇒ 建体后**把位置钉回请求点**，字形偏移同步归零。 */
  B.x=x;B.y=y;
  if(B.mb){try{Matter.Body.setPosition(B.mb,{x:x,y:y});}catch(e){}}
  if(B.glyphs&&B.glyphs[0]){B.glyphs[0].wx=x;B.glyphs[0].wy=y;B.glyphs[0].gx=0;B.glyphs[0].gy=0;}
  ringGo(x,y);
  return B;
}
function makeRod(x,y,vx,vy){
  var B=BODY(x,y);
  B.kind='T';                                // t-rod: a solid draggable/rotatable plank, like the ground but movable
  B.fg=null;
  B.hasG=true;                               // weighs & falls to rest, like a real plank
  B.len=170;B.php=F*0.55;
  // R100①（用户：「轻质杆要和弹簧一样，可以和物体直接连接啊」）：两端锚位，与弹簧**同构**
  // （{B:host, ox, oy, _noRot} 由 springAnchorOffset/springAnchoredWorld 维护）。
  // null = 这一端没连上。无锚定时全程零成本（rodSyncAnchors 第一行就早退）。
  B.anc=[null,null];
  refresh(B);
  B.vx=vx||0;B.vy=vy||0;
  return B;
}
// R71⑧：杆的质量。默认 1 kg（= 杆长 170px 的自然质量），面板 rodmass 可改。
// 手写通道的冲量份额与转动惯量 I=mL²/12 都用它 —— 这是「999kg 落体撬不撬得动 1kg 杠杆」
// 里那个「杠杆」的质量。
function rodMassOf(B){return (B&&B.rmass!=null)?B.rmass:((B&&B.len)?B.len/170:1);}
/* R98-1（先量后改：_diag_r97d_rodlen.py 实测）：杆的**唯一改长度咽喉**。
 * 诊断证实的既有 bug —— 改 B.len 只动画面（render 按 B.len 画、rod-vs-字母 SAT 用 live seg.len，
 *   这两条本来就跟着变），但**碰撞镜像板 `B.mb` 停在建板那一刻的宽度**（stepMatter 8422 只建一次，
 *   之后每子步只 setPosition/setAngle，从不按新长度重建）。后果：把杆拖长后，
 *   「杆 ↔ 画出来的线(W)」这一对支撑仍按旧板算 —— 看得见摸不着。
 * 修法照搬 springMirror(1872)：Matter 薄板不能改长，只能「漂移超容差就重建」。
 *   · force=true（参数面板 / 手柄松手）：无条件清 mb，下一帧 stepMatter 懒建按新 len 建板；
 *   · force=false（手柄拖动中）：只在 |len−_mlen|>ROD_MIRROR_TOL 时清，避免「每动一像素造一个体」。
 *   清 mb 后**当帧立刻**按当前姿态补一个（否则这一帧杆对 W 失去支撑，会闪一下穿透）——
 *   与 springMirror「重建后立刻 setPosition/setAngle」同一约定。
 * 记账 `B._mlen` 与建板处(8422) 共用同一变量名，两边任一改动都会让另一边的 stale 判定成立。 */
var ROD_MIRROR_TOL=6;   // 比弹簧的 10 略紧：杆不像弹簧那样高频「呼吸」，但手柄是逐像素拖的
/* R101①（用户：「轻质杆有平方（平放）在地面时一直在地面附近卡bug，不断抖动」）：
 * 杆的**碰撞半厚**（= 碰撞镜像板半高 = rodResolve 的接触口径）在这里收口成唯一真源。
 * （屏幕上画出来的那条线本身仍是 BND_INK=2.325 半厚，与碰撞差 0.325px —— 这是既有事实、
 *   肉眼不可见，**不要**顺手改成 BND_INK：镜像板尺寸与接触线全按 2 标定过。）
 * 之前它散在三处、其中一处是错的，这正是抖动的根因：
 *   · rebuildRodMirror 建板 `rectangle(...,4)` ⇒ 半高 2；
 *   · rodResolve 里 `var hh=2;`（注释写「与 bndSegs 对杆的口径一致」）；
 *   · **walls() 的杆分支却用 `B.hh`（=4）当半高** ⇒ 地面夹子把杆撑到 groundY−4=716，
 *     而 rodResolve 的接触线是 groundY−2=718 —— 杆永远悬在「够不着」的 2px 缝里：
 *     实测 rodResolve 整整 984 次调用**一次都没碰过杆**（pushDy=0.000），
 *     杆只能每帧自由落 g·dt²/2≈0.7px 再被夹子硬拍回去 ⇒ 帧边界上 30Hz 锯齿（y 峰峰 0.717）。
 *   · 附带第二条：夹子那句 `B.vy=-|vy|*0.5; if(|vy|<60)B.vy=0;` 给地面接了一个 **0.5 恢复
 *     系数**的蹦床（|vy|≥60 就反弹）——实测 vy 摆到 ±100、y 峰峰 3.73px、12Hz 弹跳。
 * 实测对照（_diag_r101a_rodflat.py ab，三种口径同夹具）：
 *     mode0 原样              y 均值 716.357  峰峰 0.717  push 0.00
 *     mode1 墨迹半厚 2+不反弹  y 均值 718.000  峰峰 **0.000**  push −40.07 / integ +40.07（精确相抵）
 *     mode2 地面全交 rodResolve 与 mode1 等价（所以选改动面最小的 mode1）
 * 结论：**杆的地面接触口径必须与 rodResolve 一致**，且支撑用 e=0（与 rodResolve 的
 * 「支撑不反弹」同义）——夹子降级为「深穿透安全网」，不再承担托住杆的职责。 */
var ROD_HH=2;
// ★R103-5（先量后改 _diag_r103b_link.py B 组实测）：锚定端点钉在**宿主表面上**，而镜像板是
// 全长矩形 ⇒ 板端帽插进宿主约 2px，Matter 每帧把宿主往外推 —— 装配体持续爬移
// （实测：铰链+杆+方块挂稳后，方块 x 从 502 一路爬到 374 不停）。这就是「杆/物体自己动」的主根因。
// 修法 = 「碰撞盒在锚定端**不外延**」（与开链笔画首/末段同一条哲学）：已锚定的那一端把板
// 缩进 ROD_MIRROR_INSET，板端不再插进宿主表面。弹簧用碰撞组（SPR_CGROUP）解决同一问题，
// 杆不能照抄：杆板是**承重面**（杠杆支点、物品搁杆上），一刀切负组会让「弹簧宿主搁在杆上」
// 直接穿板。锚定签名记在 _manc，锚定状态一变（吸附/双击解除）下一帧自动重建。
var ROD_MIRROR_INSET=5;
// 杆的 Matter 镜像板**唯一重建函数**（懒建 / setRodLen / 长度手柄 全走这里）。
// 建板参数（isStatic/friction0.4/restitution0/slop0.02、半厚 2）与原 stepMatter 懒建逐字保留，
// 只是补上 setAngle 到当前姿态 + 记账 _mlen。抽成一处的理由：镜像板的「姿态 + 宽度 + 反查引用」
// 是一个契约，有几处写入点就必须只有一份实现（R93① 的教训）。
function rebuildRodMirror(B){
  /* ★★R131-21（用户拍板：「杆没有碰撞箱，只是对物体起约束作用」）：
   *  杆的 Matter 镜像板（static 承重薄板）是此前一系列杆 bug 的总根源——
   *  它引入了多余的接触自由度：托住锚定宿主造成悬空停摆（R131-19）、插进物体造成
   *  排斥/爬移（R103-5）、与拖拽打架造成拉锯。板删除后：
   *  · 杆对物体**只起约束作用**（rodSyncAnchors 的 PBD 位置+速度相位），无碰撞、
   *    无支撑、无杠杆撬动——物品不能再搁杆上（用户已拍板）；
   *  · 宿主角度锁死（rodSyncLocks，见 springSyncLocks 旁）——自由度再减一；
   *  · 所有 `B.mb` 判断天然跳过（rodResolve/rodIntegrate/碰撞组/杠杆拖拽自动退役）。 */
  if(!MW)return;
  removeMatterBody(B);
  return;
  var in0=(B.anc[0]?ROD_MIRROR_INSET:0),in1=(B.anc[1]?ROD_MIRROR_INSET:0);
  var ml=Math.max(8,(B.len||170)-in0-in1);
  var tht=B.th||0,ux=Math.cos(tht),uy=Math.sin(tht);
  // rodEndWorld(0) 在 +u 侧：in0 收 +u 端、in1 收 −u 端 ⇒ 板中心向 −u·(in0−in1)/2 偏
  var mx=B.x+ux*(in1-in0)/2,my=B.y+uy*(in1-in0)/2;
  B.mb=Matter.Bodies.rectangle(mx,my,ml,ROD_HH*2,
        {isStatic:true,friction:0.4,restitution:0,slop:0.02,
         collisionFilter:{group:ROD_HOST_CGROUP}});
  B.mb._rodRef=B;
  Matter.Body.setAngle(B.mb,tht);
  Matter.Composite.add(MW.wLayer,B.mb);
  B._mlen=B.len||170;
  B._manc=((B.anc[0]?1:0)|(B.anc[1]?2:0));
}
function setRodLen(B,len,force){
  if(!B||B.kind!=='T')return;
  B.len=clamp(len,1,1e7);
  B._rodL=B.len;   // ★R107-1：目标长度的唯一真源（反棘轮）。只有**有意改长度**的入口写它
  B.hw=B.len/2+2;
  refresh(B);                                   // layoutField 的 T 分支重排 hw/hh
  if(!MW)return;
  // R103-5：stale 判定加**锚定签名** —— 双击解除/新吸附改变板端缩进，必须重建
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.len)>ROD_MIRROR_TOL)||
            (B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)));
  if(force||stale){rebuildRodMirror(B);}         // 重建即按新 len 造板 + setAngle 到当前姿态
  else{                                          // 漂移在容差内：只跟随姿态，不造体
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th||0);
  }
}
// R98-3：长度手柄专用 —— 从**两个端点**摆一根杆（远端固定、拖拽端跟指针）。
// 与 setRodLen（质心不动、两端对称伸缩，供参数面板用）语义不同：这里中心与角度都会随拖拽端移动。
// 镜像板跟随策略同 setRodLen：force/超容差才重建，否则只 setPosition/setAngle。
function setRodEnds(B,x0,y0,x1,y1,force){
  var dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy)||1;
  d=clamp(d,1,1e7);
  B.x=(x0+x1)/2;B.y=(y0+y1)/2;B.th=Math.atan2(dy,dx);
  B.len=d;B.hw=d/2+2;refresh(B);
  if(!MW||!B.mb)return;                          // 镜像板懒建交给 stepMatter（rebuildRodMirror 兜姿态）
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.len)>ROD_MIRROR_TOL)||
            (B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)));   // R103-5：锚定签名
  if(force||stale)rebuildRodMirror(B);
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
// 杆端点 i 的世界坐标（长度手柄定位 + 拖拽时取远端）
function rodEndWorld(B,i){
  var tht=B.th||0,hl=(B.len||170)/2,s=(i?-1:1);
  return {x:B.x+s*Math.cos(tht)*hl,y:B.y+s*Math.sin(tht)*hl};
}
/* ---- R100①：端点「索引」↔ setRodEnds 入参「槽位」的**唯一换算点** ------------------------------
 * 实测（_tmp_probe_rod2.py P1，别靠推）：setRodEnds(B, ax,ay, bx,by) 之后
 *     rodEndWorld(B,0) === (bx,by)      ← 槽位 1
 *     rodEndWorld(B,1) === (ax,ay)      ← 槽位 0
 * 索引与槽位**恒反**。原因：setRodEnds 把 th 定成 slot0→slot1 的方向（atan2(y1-y0,x1-x0)），
 * 而 rodEndWorld(0) 取的是 **+u** 那一侧 ⇒ 落到 slot1 上。
 *
 * R98 只有「两条没有名字的端点」，反着用不会现形（R98 注释里那句「th 翻 180° 编号会左右互换」
 * 就是这件事的影子）；R100① 给杆端加了 per-end 状态 anc[i]，反着用立刻变成
 * **「锚点记到了另一头」**（P2 实测：锚点记在 x=415，而接触面在 592；两端都记错之后
 * rodSyncAnchors 每帧把杆对拉一次，最后塌成 len=1）。
 *
 * ⇒ 凡**按编号**摆杆两端的地方一律走 rodPlaceEnds；setRodEnds 保持原签名与语义不变
 *   —— 它表达的是「哪一端被拖」这个**角色**（setBeltEnds 的长度 clamp 就靠这个角色：
 *   slot0 = 钉死端、slot1 = 被拖端），而不是编号。
 *   带子没有 per-end 状态，所以 R98 那条 setBeltEnds 路径**不需改**（改了反而会把 clamp 夹错端）。 */
function rodPlaceEnds(B,e0x,e0y,e1x,e1y,force){
  // 入参按**索引**：index0=(e0x,e0y)、index1=(e1x,e1y)；内部换成槽位序
  return setRodEnds(B,e1x,e1y,e0x,e0y,force);
}
// 长度手柄被拖时的两端（按索引）：被拖的是 grab.end，另一端钉在按下那刻锁存的 (fx,fy)。
function rodDragEnds(B,g,px,py,force){
  var r=rodPlaceEnds(B, g.end?g.fx:px, g.end?g.fy:py, g.end?px:g.fx, g.end?py:g.fy, force);
  B._rodL=B.len;                    // ★R107-1：拖长度手柄 = 有意改长度
  return r;
}
/* ---- R100⑤：传送带的两端长度手柄（与杆手柄同族，见 rodh 的 pointerdown 分派）------------
 * 语义与 R98-3 完全同构：拖一端 ⇒ 另一端钉死（按下那刻锁存远端坐标，避免逐帧现取导致整体漂移）。
 * 与杆的差别只在「写回」这一步：
 *   · 杆只有一条细板镜像，走 rebuildRodMirror（带 ROD_MIRROR_TOL 容差）；
 *   · 带子是一整块 W 体，本地矩形 B.pts / B.hw 被**多处**读（渲染 drawBeltBody、手写 SAT
 *     bndHit、beltFaceTouch 的接触门），所以 pts 必须跟着长度实时改；Matter 侧几何被编辑后
 *     重建复合体的既有咽喉是 rebuildWBody（buildMatterBody 会复位 fixed，rebuildWBody 已兜）。
 * 长度硬边界 [BELT_MIN_LEN, BELT_MAX_LEN]：太短则两端滚轮（半径=hh）会互相穿过，
 * 且 mkBoundary 本身有 BND_MIN_LEN 下限。
 * 带子是 `fixed` 的机器（不落、不被弹簧推、不参与导轨），所以**不需要** rodLenFrozen 那 6 处
 * 冻结门；但复用 grab.kind==='rodlen'，让「长度手柄」这一族只有一套语义、一套收口。 */
var BELT_MIN_LEN=80, BELT_MAX_LEN=1600;
function beltEndWorld(B,i){
  var tht=B.th||0,hl=B.hw||BELT_SPAWN_LEN/2,s=(i?-1:1);
  return {x:B.x+s*Math.cos(tht)*hl,y:B.y+s*Math.sin(tht)*hl};
}
function setBeltEnds(B,x0,y0,x1,y1,force){
  if(!B||!B.belt)return;
  var dx=x1-x0,dy=y1-y0,raw=Math.hypot(dx,dy)||1;
  var d=clamp(raw,BELT_MIN_LEN,BELT_MAX_LEN);
  var ux=dx/raw,uy=dy/raw;
  var x1c=x0+ux*d,y1c=y0+uy*d;                  // 夹到长度区间后的拖拽端
  B.x=(x0+x1c)/2;B.y=(y0+y1c)/2;B.th=Math.atan2(uy,ux);
  var hw=d/2,hh=B.hh||BELT_TH/2;
  B.len=d;B.hw=hw;
  B.pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];   // 本地矩形：渲染/接触三处都读它
  // ★R100⑤ 实测（组 F 的 F6）：这里必须让**凸包缓存**跟着作废。
  //   bndHullLocal(B) 只在 `B.hull` 为空时才由 B.pts 重算（10375 行），而本行是**整数组替换**
  //   ——新数组、新点对象，旧 hull 里存的是**上一批点对象**（hull2D 返回的是 B.pts 里那几个同一
  //   对象，见 8340 行注释），于是 B.hull 会永久停在出生那一刻的矩形上。
  //   后果实测：setBeltEnds 拉到 hw=200（pts 已对）后，Matter 镜像板 vertices 宽度仍是 264.65
  //   （= spawn 260 + 2×BND_INK），手写通道 bndHullWorld 读的也是旧 hull ⇒ 带子变长了、
  //   碰撞还是原来那截短的（球走到新露出的那半截上会掉下去）。
  //   注：Matter 体本身每次确实重建了（id 5→6→7→8），所以问题不在 rebuildWBody，而在
  //   「重建时读到的几何是缓存的」。作废点就放在几何真值被改写这一行之后。
  B.hull=null;
  if(!MW||!B.mb)return;                          // 未就绪：镜像板留给 ensureMatter 之后
  var stale=(B._mlen==null)||(Math.abs(B._mlen-d)>2);
  if(force||stale){B._mlen=d;rebuildWBody(B,B.th);}   // 重建即按新宽度造体 + 摆到当前姿态
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
/* R101③：改带子角度的**唯一咽喉** —— 绕 pivot（默认质心）把两端一起转到 th。
 * 为什么不是 `B.th=th`：带子的几何真值在**两端**（pts / hull / Matter 镜像都从它派生），
 * 只写 th 会让渲染转了、碰撞没转 —— 而 Matter 侧唯一的跟随通道是 stepMatter 里那句
 * 「grab.kind==='rot' 时 setAngle」，一旦松手、或者从参数面板改，就没有任何人在跟。
 * 走 setBeltEnds 则「pts 重写 + hull 作废 + 镜像板重建」三件事一次做全；且带长天然不变
 * （两端沿新方向各退 hl ⇒ 长度仍是 len，不会被 [MIN,MAX] 夹到）。 */
function setBeltAngle(B,th,pivot){
  if(!B||!B.belt)return;
  var hl=((B.len!=null)?B.len:2*(B.hw||BELT_SPAWN_LEN/2))/2;
  var px=(pivot&&pivot.x!=null)?pivot.x:B.x, py=(pivot&&pivot.y!=null)?pivot.y:B.y;
  var ux=Math.cos(th),uy=Math.sin(th);
  setBeltEnds(B,px-ux*hl,py-uy*hl,px+ux*hl,py+uy*hl,false);
}
// R98-3：长度手柄按住期间，这根杆的位姿归指针 —— 与 kind==='body'「被抓住」同一冻结语义。
// 之所以要单独一个谓词：下面 6 处「被抓住就跳过」的门全写成 `grab.kind==='body'`，
// 逐处补 `||grab.kind==='rodlen'` 会散成一地（且漏一处就是「拖长度时杆自己往下掉/被弹开」）。
function rodLenFrozen(B){
  return !!(B&&grab&&grab.kind==='rodlen'&&grab.obj===B);
}
// 法向接近速度超过这个值才算「撞击」，才启用杆的转动项（静置压着不算，见 collideBodies）
var ROT_MIN_VN=40;
function tAnchor(B){
  if(B.kind)return {x:B.x,y:B.y};
  return B.massG?slot(B,B.massG):{x:B.x,y:B.y};
}
// R71⑫：孤立的 g（唯一字形是 g、不是质量体、没有 kind）= 重力参数的可视化控件，浮空不落。
function isGravityLetterOnly(B){
  return !!(B&&!B.kind&&!B.massG&&B.glyphs&&B.glyphs.length===1
           &&B.glyphs[0]&&B.glyphs[0].type==='g');
}
function findTComboTarget(L){
  // t combines with: a field 'q' -> becomes I (current); a body with 'g' -> gt -> v; a
  // body with 'v' (and no g) -> vt -> plank/rod. Also a FREE lowercase v near the t -> vt -> rod,
  // so "v单独落下再放t" also works (no body needed). Only simple targets, never formulas.
  // IMPORTANT: combos ONLY trigger for the letter 't' — other letters must never be hijacked
  // (e.g. dropping a 2nd 'v' onto mv must make mv², not turn the body into a rod).
  if(!L||L.dead)return null;
  // R57（用户 #8）：「拼」不分先后。原来只有「把 t 拖到别人身上」才算组合；反过来把一个 v
  // 拖到一个孤零零的 t 上，两个字母只会叠在一起往下掉 —— 用户看到的正是「不是线条，而是个 x」。
  // 这里补上反向：L 是 v/g（且旁边有 free 的 t）时，同样触发组合，端点取两者中点。
  if(L.type!=='t'){
    if(L.type!=='v'&&L.type!=='g')return null;
    var ft=null,ftg=1e9;
    for(var fti=0;fti<freeL.length;fti++){
      var FT=freeL[fti];
      if(FT.type!=='t'||FT===L||FT.dead)continue;
      // R57：**也用指针落点判**。自由字母坠落时会有位移，加上从面板拖出来时的落点偏移，
      // 「字母到字母」的距离可能被拉开一截；而用户是**瞄着看得见的那个字母**松手的 ——
      // 指针到目标的距离才是他真正表达的意图。取两者中更近的那个。
      // R60c：两个都改成盒距（旧值 150px 的固定半径会把很远的字母也吸过来拼）
      var gap=Math.min(twoLetterGap(L,FT),
                       ptToGlyphGap(pointer.x,pointer.y,FT.wx,FT.wy,lw(FT),lh(FT)));
      if(gap<ftg){ftg=gap;ft=FT;}
    }
    if(!ft||ftg>MERGE_PAD)return null;
    if(L.type==='v')return {fv:L,other:ft,kind:'vt',rev:true};
    // g 拖到 free 的 t 上：gt -> v（和正向的 gt 一致），字母落点取两者中点
    return {B:null,freeG:L,other:ft,kind:'gtFree',rev:true};
  }
  var best=null,bg=1e9;
  // free v letter nearby -> make a rod on the spot
  for(var fvi=0;fvi<freeL.length;fvi++){
    var FV=freeL[fvi];
    if(FV.type!=='v'||FV===L||FV.dead)continue;
    var gap=Math.min(twoLetterGap(L,FV),
                     ptToGlyphGap(pointer.x,pointer.y,FV.wx,FV.wy,lw(FV),lh(FV)));
    if(gap<bg){bg=gap;best={fv:FV,kind:'vt'};}
  }
  if(!best){
    for(var i=0;i<bodies.length;i++){
      var B=bodies[i];
      if(B.massG===L||B.mem.indexOf(L)>=0)continue;
      var a=tAnchor(B);
      // R60c：宿主这一路也用盒距（tAnchor 只是锚点，旧写法拿它算 150px 半径）
      var gp=ptToGlyphGap(L.wx,L.wy,a.x,a.y,(B.hw||26)*2,(B.hh||26)*2);
      if(gp>bg)continue;
      var ok=false,kind='';
      if(B.kind==='q'){ok=true;kind='qt';}
      else if(B.kind&&B.kind!=='T'){continue;}
      else if(B.hasG&&B.mem.length<=2&&!B.hasGrav){ok=true;kind='gt';}
      else if((B.kind==='T')||(B.hasV&&!B.hasG&&!B.hasR&&!B.hasGrav&&B.mem.length<=1)){ok=true;kind='vt';}
      if(ok&&gp<bg){bg=gp;best={B:B,kind:kind};}
    }
  }
  return bg<=MERGE_PAD?best:null;
}
function applyTCombo(L,c){
  var B=c.B;
  if(c.kind==='vt'&&c.fv){
    // free v + t -> rod right here (no pre-existing body)
    // R57：反向（v 拖到 free 的 t 上）时取两者中点，正向仍以 t 自己的位置为锚（别动老行为）
    var rx=c.rev?((c.fv.wx+L.wx)/2):L.wx;
    var ry=c.rev?((c.fv.wy+L.wy)/2):L.wy;
    var rod=makeRod(rx,ry,0,0);
    // 反向时 c.fv 就是被拖的 L，另一个字母在 c.other 里 —— 两个都要收掉，少收一个会留下
    // 一个孤零零的 t 在画布上（R57 首轮就是这么漏的）。
    killLetter(c.fv===L&&c.other?c.other:c.fv);
    killLetter(L);
    ringGo(rod.x,rod.y);
    return;
  }
  if(c.kind==='gtFree'){
    // R57：g 拖到 free 的 t 上 = gt -> v（和正向 gt 同一个结果，只是没有宿主 body）
    var vx2=(L.wx+c.other.wx)/2,vy2=(L.wy+c.other.wy)/2;
    killLetter(c.other);killLetter(L);
    var vf=GD('v');
    freeLetter(vf,vx2,vy2,0,0,true);
    ringGo(vx2,vy2);
    return;
  }
  if(c.kind==='qt'){
    // current: t dropped onto a field q -> q becomes I (current symbol). "qt组合变成I"
    if(B.fg){B.fg.body=null;B.fg.inBody=false;killLetter(B.fg);B.fg=null;}
    B.kind='I';B.Isign=1;
    var ng=GD('I');ng.pop=0;ng.body=B;ng.inBody=true;B.fg=ng;
    killLetter(L);
    refresh(B);ringGo(B.x,B.y);
  }else if(c.kind==='gt'){
    // gt -> v : remove the g and the t, add a v (g·t = v)
    for(var qi=B.mem.length-1;qi>=0;qi--){
      if(B.mem[qi].type==='g'){var gi2=B.mem[qi];B.mem.splice(qi,1);killLetter(gi2);}
    }
    killLetter(L);
    var vg=GD('v');vg.pop=0;vg.body=B;vg.inBody=true;B.mem.push(vg);
    refresh(B);ringGo(B.x,B.y);
  }else if(c.kind==='vt'){
    // vt -> plank: the mass-v body becomes a solid rod (like the ground but movable/rotatable)
    for(var jj=B.glyphs.length-1;jj>=0;jj--){
      var og=B.glyphs[jj];
      if(og.body===B){og.body=null;og.inBody=false;killLetter(og);}
    }
    for(var mmi=B.mem.length-1;mmi>=0;mmi--){var mo2=B.mem[mmi];B.mem.splice(mmi,1);killLetter(mo2);}
    killLetter(L);
    B.massG=null;
    B.hasG=true;B.hasV=false;B.kind='T';B.fg=null;
    B.len=170;B.php=F*0.55;
    refresh(B);ringGo(B.x,B.y);
  }
}

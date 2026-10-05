/* 全局常量、DOM 引用、工具函数、字形对象、物体 / 杆 / 传送带构造（原 index.html 第 793–1437 行） */
var ctx2d=document.createElement('canvas').getContext('2d');
var F=48,GRAV=2600,AACC=1300,RM=150,MT={},RAISE=F*0.3;
var B_FIELD_RANGE=320,BZ_DIR=1,Q_OMEGA=2.4,A_FORCE=900,Q_FORCE=2.2;
/* 带电 W 体（矩形/圆形/三角形器件）在场里的施力系数。
 * Matter 的 applyForce 在帧级调用只影响 4 个子步中的 1 个，且 body.force 每步末清零，
 * 所以不能照抄 applyGivenAccel 的逐子步口径 /1e6。
 * 此值为实测标定（非推导）：去摩擦测加速度，/1e6 → 比值 0.013、/12500 → 比值 9.0
 * （eacc=0.05 小倍率，避开速度上限与右墙），线性外推到实测 a == E_FIELD_ACC 得 /112500。 */
var QFIELD_K=112500;
var E_FIELD_RANGE=320,E_FIELD_ACC=1500;   // E field: SQUARE range (half-side 160), uniform direction (th), F=qE
var cv=document.getElementById('cv');
var panel=document.getElementById('panel');
var shadow=document.getElementById('shadow');
var handle=document.getElementById('handle');
var rszHandle=document.getElementById('fresize');
var ark=[document.getElementById('ark0'),document.getElementById('ark1')];   // 圆弧端点手柄
var arcHov=null;   // 手柄当前归属的弧（refreshHover 每帧更新）
var rodh=[document.getElementById('rodh0'),document.getElementById('rodh1')]; // 杆两端长度手柄
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
// 旋转手柄驻留：手柄显示过之后即使 hover 丢失也再保留一段时间，让指针来得及挪到手柄上
var handleKeep=null,handleLinger=0,HANDLE_LINGER=900;   // 驻留时长 ms
var axisBody=null,axisLast=null;
var bodies=[],freeG=[],parts=[],ALL=[],slots={},samples=[];
var OPEN='(',CLOSE=')',PLUS='+',SQ='²',BAR='-',HALF='½',MU='μ',SUB1='₁',SUB2='₂',PRIME='′';
var SHATTER_SPEED=1100;
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function shortAng(d){d=d%(Math.PI*2);if(d>Math.PI)d-=Math.PI*2;if(d<-Math.PI)d+=Math.PI*2;return d;}
// snap an angle to the nearest multiple of 90° when within SNAP_DEG (default 8°), else unchanged.
var SNAP_DEG=8;
function snapAngle90(a){var q=Math.PI/2,d=Math.PI*SNAP_DEG/180;var near=Math.round(a/q);return Math.abs(a-near*q)<=d?near*q:a;}
/* 传送带角度吸附：离 45° 整数倍 ±BELT_SNAP_DEG 以内才吸，带外保留自由斜角（与 snapAngle90 同款语义）。
 * 不要改成 Math.round(a/q)*q 的量化写法：那会抹掉所有自由斜角，需求是「特定角度附近吸附」而非「只能取这几档」。
 * 测试注意：目标角必须用非 45 倍数（如 60/135/270/−45 天然是倍数，不吸附的实现也能全过），
 * 并分「带内」「带外」两组断言。
 * 其余物体（杆 / 弹簧 / E 场）仍是 90°±8° 吸附。 */
var BELT_ANG_SNAP=45, BELT_SNAP_DEG=8;
/* 只在离 stepDeg 整数倍 ±tolDeg（默认 BELT_SNAP_DEG）以内才吸上去，带外保留自由斜角。
 * 例：拖到 44° → 吸到 45°；拖到 30° → 保持 30°。 */
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
  el._letterRef=d;   // 反向指针：吃进面板时据此从 .char 找回字母
  el.addEventListener('pointerdown',function(e){gdDown(e,d);});
  el.addEventListener('contextmenu',function(e){
    e.preventDefault();
    if(d.dead)return;
    var mb=d.body;
    if(mb&&mb.glyphs&&mb.glyphs.indexOf(d)>=0){openMenu(e.clientX,e.clientY,mb,d);return;}
    /* 赋予型字符（v/a/q/t）promote 后有宿主但不在 glyphs/mem 里，上面两个分支都不走；
     * 只要有宿主就照常弹菜单（参数面板读它自己的赋值字段），否则右键失灵。 */
    if(mb){openMenu(e.clientX,e.clientY,mb,d);return;}
    // a FREE (unmerged) letter has no body — promote it IN PLACE to a single-letter body so
    // right-clicking it (r, g, a, v, μ …) opens the param panel like any merged letter.
    if(!mb&&(d.state==='free'||d.state==='grab'||d.state==='idle')){
      var B=promoteFreeLetter(d);
      if(B)openMenu(e.clientX,e.clientY,B,d);
    }
    /* 面板（dock）里的字符右键也弹菜单：用 promoteFreeLetter 造一个临时参数宿主，
     * 立即从 bodies 摘掉（只作菜单/参数载体，不上场）。 */
    if(!mb&&d.state==='dock'){
      var B2=promoteFreeLetter(d);
      if(B2){
        var bi2=bodies.indexOf(B2);if(bi2>=0)bodies.splice(bi2,1);
        /* 临时宿主已从 bodies 摘除，必须把 d.body 清回 null：promoteFreeLetter 开头是 if(d.body)return d.body，
         * 不清的话下次右键会复用这个不在场上的孤儿宿主。openMenu 自己持有 B2 引用；state 仍为 'dock'，面板槽位不变。 */
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
// k 和 x 是弹簧的两个组成字母（k·x → 弹簧，见 makeSpring）
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
  /* 赋予型字符（v/a/q/t）promote 后只当参数宿主、不进 B.mem，保持自由、可反复赋予：
   * 并入 mem 后它不再是自由字符，松手时「实心命中 ⇒ 赋予」分支就不再命中。 */
  var _sid=specIdForLetter(d);
  var _giveType=(_sid==='vsize'||_sid==='asize'||_sid==='qcharge'||_sid==='tscale');
  var x=d.wx!==undefined?d.wx:d.el.offsetLeft;
  var y=d.wy!==undefined?d.wy:d.el.offsetTop;
  var B=BODY(x,y);
  d.pop=0;d.body=B;d.inBody=true;
  /* 按目标类型分流：
   *  · 目标是由字符组成的体（massG / glyphs / mem 里有字母，即表达式）⇒ 正常并入（ma、mc 这类组合）；
   *  · 目标是纯形状物体（方框/圆等，无字形）⇒ 走「赋予」（不进 mem）。 */
  var _targetIsFormula=!!(B&&(B.massG||(B.glyphs&&B.glyphs.length)||(B.mem&&B.mem.length)));
  if(_giveType&&!_targetIsFormula){
    /* 赋予型字符：不并入 mem（否则后续无法再赋予），也不占 glyphs；state 必须是 'free'（可继续拖动/再次右键）。
     * BODY(x,y) 已把临时宿主注册进 bodies，必须立即从场上摘除（含 Matter 体）：否则场上多一个看不见的体，
     * 参与碰撞、挡住点击、把字符带飞（a 拖不动/落地消失）。 */
    /* inBody 必须置 false：placeLetter()/syncGlyphs() 对 inBody && body 的字母按宿主槽位 slot(B,g) 摆位，
     * 而 _paramOnly 宿主已摘除、永不移动 ⇒ DOM 元素会被钉死在 promote 时的位置、与 wx/wy 脱钩，
     * 表现为字符抓不动，且钉住的元素还会吃掉画布的 pointerdown。
     * 面板（dock）里的字符被右键时保持 'dock'，不能变成 'free'：否则面板槽位变空（sortPanel/dockedTwins 都按 'dock' 认）。 */
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
  /* 场源体字形必须自洽：GD() 造出的字形 gx/gy 原为 NaN（spawnField 不写偏移），
   * 而悬停高亮、拖拽落点回算、录屏几何等 syncGlyphs/placeLetter 之外的路径都会读它，导致落点偏 45~58px。
   * 这里把偏移钉成 0、坐标钉成体位置，让字形真正长在场源体上。 */
  g.gx=0;g.gy=0;g.wx=B.x;g.wy=B.y;
  B.fg=g;
  B.glyphs=[g];
  var sp=Math.hypot(svx||0,svy||0);
  var f=sp>20?clamp(1-sp/6000,0.5,1):0;
  if(kind==='B'){B.fieldR=B_FIELD_RANGE;B.Bz=BZ_DIR;B.vx=0;B.vy=0;}
  else if(kind==='E'){B.er={l:160,r:160,t:160,b:160};B.fieldR=320;B.th=0;B.vx=0;B.vy=0;}   // E field: uniform direction, rotatable via th; 4 independent edges
  /* 场（电荷场 q / 电流场 I）没有惯性：与 B/E 一致速度清零，落在松手点。
   * 场源体既无重力也无接触摩擦，若继承松手时的鼠标速度 svx/svy，stepPhysics 的 B.x+=B.vx*dt 会让它一路滑行永不停。 */
  else if(kind==='q'){B.qsign=1;B.vx=0;B.vy=0;}
  else if(kind==='I'){B.Isign=1;B.vx=0;B.vy=0;}
  refresh(B);
  /* 场源体必须落在松手点：refresh(B) 对几何来自字形的体（npts=0）会按字形盒重算 B.x/B.y，
   * 实测偏约 (55,−43)px，连带落点命中判定整体错位。建体后把位置钉回请求点，字形偏移同步归零。 */
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
  // 两端锚位，与弹簧同构（{B:host, ox, oy, _noRot} 由 springAnchorOffset/springAnchoredWorld 维护）。
  // null = 这一端没连上；无锚定时 rodSyncAnchors 第一行就早退。
  B.anc=[null,null];
  refresh(B);
  B.vx=vx||0;B.vy=vy||0;
  return B;
}
// 杆的质量：默认 1 kg（= 杆长 170px 的自然质量），面板 rodmass 可改。
// 手写通道的冲量份额与转动惯量 I=mL²/12 都用它。
function rodMassOf(B){return (B&&B.rmass!=null)?B.rmass:((B&&B.len)?B.len/170:1);}
/* 杆的唯一改长度入口。
 * 改 B.len 只影响画面（render 与 rod-vs-字母 SAT 本就跟着变），碰撞镜像板 B.mb 却停在建板时的宽度
 * （stepMatter 只建一次，之后只 setPosition/setAngle）⇒ 看得见摸不着。
 * Matter 薄板不能改长，只能「漂移超容差就重建」（同 springMirror）：
 *  · force=true（参数面板 / 手柄松手）：无条件清 mb，按新 len 重建；
 *  · force=false（手柄拖动中）：只在 |len−_mlen|>ROD_MIRROR_TOL 时重建，避免每动一像素造一个体。
 * 清 mb 后当帧立刻按当前姿态补建，否则这一帧杆对 W 失去支撑会闪一下穿透。
 * B._mlen 与建板处共用，两边任一改动都会让另一边的 stale 判定成立。 */
var ROD_MIRROR_TOL=6;   // 比弹簧的 10 略紧：杆不像弹簧那样高频「呼吸」，但手柄是逐像素拖的
/* 杆的碰撞半厚（= 碰撞镜像板半高 = rodResolve 的接触口径）的唯一真源。
 * 屏幕上画的线是 BND_INK=2.325 半厚，差 0.325px 肉眼不可见；不要改成 BND_INK，镜像板与接触线全按 2 标定。
 * 杆的地面接触口径必须与 rodResolve 一致，且支撑用 e=0（不反弹）：
 *  · 若 walls() 用 B.hh(=4) 当半高，夹子把杆撑到 groundY−4，而 rodResolve 接触线在 groundY−2，
 *    杆永远悬在 2px 缝里每帧自由落再被拍回 ⇒ 30Hz 锯齿抖动（y 峰峰 0.717）；
 *  · 夹子若带 0.5 恢复系数（|vy|≥60 反弹）⇒ 12Hz 弹跳（y 峰峰 3.73px）。
 * 统一半厚 2 且不反弹后 y 峰峰为 0。夹子只作深穿透安全网，不承担托住杆的职责。 */
var ROD_HH=2;
// 已锚定的一端把镜像板缩进 ROD_MIRROR_INSET，碰撞盒在锚定端不外延：锚定端点钉在宿主表面上，
// 全长板的端帽会插进宿主约 2px，Matter 每帧把宿主往外推，装配体持续爬移。
// 不能照抄弹簧的碰撞组（SPR_CGROUP）方案：杆板是承重面，一刀切负组会让搁在杆上的弹簧宿主穿板。
// 锚定签名记在 _manc，锚定状态一变（吸附/双击解除）下一帧自动重建。
var ROD_MIRROR_INSET=5;
// 杆的 Matter 镜像板唯一重建函数（懒建 / setRodLen / 长度手柄都走这里）。
// 建板参数：isStatic、friction 0.4、restitution 0、slop 0.02、半厚 ROD_HH；建后 setAngle 到当前姿态并记账 _mlen。
// 镜像板的「姿态 + 宽度 + 反查引用」是一个契约，只能有一份实现。
function rebuildRodMirror(B){
  /* 杆没有碰撞箱，只对物体起约束作用，因此这里直接移除镜像板并返回（下面的建板代码不再执行）。
   * 静态承重板会引入多余的接触自由度：托住锚定宿主导致悬空停摆、插进物体导致排斥/爬移、与拖拽拉锯。
   *  · 约束由 rodSyncAnchors 的 PBD（位置 + 速度）完成，无碰撞、无支撑、无杠杆撬动，物品不能搁在杆上；
   *  · 宿主角度锁死（rodSyncLocks，见 springSyncLocks 旁）；
   *  · 所有 B.mb 判断自然跳过（rodResolve/rodIntegrate/碰撞组/杠杆拖拽随之失效）。 */
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
  B._rodL=B.len;   // 目标长度的唯一真源（防棘轮）：只有有意改长度的入口写它
  B.hw=B.len/2+2;
  refresh(B);                                   // layoutField 的 T 分支重排 hw/hh
  if(!MW)return;
  // stale 判定含锚定签名：双击解除/新吸附会改变板端缩进，必须重建
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.len)>ROD_MIRROR_TOL)||
            (B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)));
  if(force||stale){rebuildRodMirror(B);}         // 重建即按新 len 造板 + setAngle 到当前姿态
  else{                                          // 漂移在容差内：只跟随姿态，不造体
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th||0);
  }
}
// 长度手柄专用：从两个端点摆一根杆（远端固定、拖拽端跟指针）。
// 与 setRodLen（质心不动、两端对称伸缩，供参数面板用）不同：这里中心与角度都随拖拽端移动。
// 镜像板跟随策略同 setRodLen：force/超容差才重建，否则只 setPosition/setAngle。
function setRodEnds(B,x0,y0,x1,y1,force){
  var dx=x1-x0,dy=y1-y0,d=Math.hypot(dx,dy)||1;
  d=clamp(d,1,1e7);
  B.x=(x0+x1)/2;B.y=(y0+y1)/2;B.th=Math.atan2(dy,dx);
  B.len=d;B.hw=d/2+2;refresh(B);
  if(!MW||!B.mb)return;                          // 镜像板懒建交给 stepMatter（rebuildRodMirror 兜姿态）
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.len)>ROD_MIRROR_TOL)||
            (B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)));   // 锚定签名
  if(force||stale)rebuildRodMirror(B);
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
// 杆端点 i 的世界坐标（长度手柄定位 + 拖拽时取远端）
function rodEndWorld(B,i){
  var tht=B.th||0,hl=(B.len||170)/2,s=(i?-1:1);
  return {x:B.x+s*Math.cos(tht)*hl,y:B.y+s*Math.sin(tht)*hl};
}
/* 端点「索引」↔ setRodEnds 入参「槽位」的唯一换算点。
 * setRodEnds(B, ax,ay, bx,by) 之后 rodEndWorld(B,0) === (bx,by)、rodEndWorld(B,1) === (ax,ay)，索引与槽位恒反：
 * setRodEnds 把 th 定成 slot0→slot1 方向，而 rodEndWorld(0) 取 +u 一侧，落在 slot1 上。
 * 有 per-end 状态 anc[i] 后，反着用会把锚点记到另一头（rodSyncAnchors 每帧对拉，最后塌成 len=1）。
 * ⇒ 凡按编号摆杆两端的地方一律走 rodPlaceEnds；setRodEnds 保持原语义，表达「哪一端被拖」的角色
 *   （slot0 = 钉死端、slot1 = 被拖端）。setBeltEnds 的长度 clamp 靠这个角色，带子无 per-end 状态，不要改它。 */
function rodPlaceEnds(B,e0x,e0y,e1x,e1y,force){
  // 入参按索引：index0=(e0x,e0y)、index1=(e1x,e1y)；内部换成槽位序
  return setRodEnds(B,e1x,e1y,e0x,e0y,force);
}
// 长度手柄被拖时的两端（按索引）：被拖的是 grab.end，另一端钉在按下那刻锁存的 (fx,fy)。
function rodDragEnds(B,g,px,py,force){
  var r=rodPlaceEnds(B, g.end?g.fx:px, g.end?g.fy:py, g.end?px:g.fx, g.end?py:g.fy, force);
  B._rodL=B.len;                    // 拖长度手柄 = 有意改长度
  return r;
}
/* 传送带两端长度手柄（与杆手柄同族，见 rodh 的 pointerdown 分派）。
 * 拖一端 ⇒ 另一端钉死（按下时锁存远端坐标，避免逐帧现取导致整体漂移）。
 * 与杆的差别只在写回：带子是整块 W 体，本地矩形 B.pts / B.hw 被多处读（drawBeltBody、手写 SAT bndHit、
 * beltFaceTouch 接触门），pts 必须随长度实时改；Matter 侧走 rebuildWBody（buildMatterBody 会复位 fixed，rebuildWBody 已兜）。
 * 长度边界 [BELT_MIN_LEN, BELT_MAX_LEN]：太短则两端滚轮（半径=hh）互相穿过，且 mkBoundary 有 BND_MIN_LEN 下限。
 * 带子是 fixed 的机器，不需要 rodLenFrozen 冻结门；但复用 grab.kind==='rodlen'，长度手柄只有一套语义。 */
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
  // 必须作废凸包缓存：bndHullLocal(B) 只在 B.hull 为空时才由 B.pts 重算，而上一行是整数组替换，
  // 旧 hull 引用的是上一批点对象 ⇒ hull 永久停在出生时的矩形，Matter 镜像与手写通道 bndHullWorld
  // 都读旧几何（带子变长了，碰撞还是原来那截）。
  B.hull=null;
  if(!MW||!B.mb)return;                          // 未就绪：镜像板留给 ensureMatter 之后
  var stale=(B._mlen==null)||(Math.abs(B._mlen-d)>2);
  if(force||stale){B._mlen=d;rebuildWBody(B,B.th);}   // 重建即按新宽度造体 + 摆到当前姿态
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
/* 改带子角度的唯一入口：绕 pivot（默认质心）把两端一起转到 th。
 * 不能只写 B.th：带子几何真值在两端（pts / hull / Matter 镜像都从它派生），只写 th 会渲染转了碰撞没转，
 * 而 Matter 侧只在 grab.kind==='rot' 时 setAngle，松手或从参数面板改就没人跟。
 * 走 setBeltEnds 一次完成 pts 重写 + hull 作废 + 镜像重建；带长不变，不会被 [MIN,MAX] 夹到。 */
function setBeltAngle(B,th,pivot){
  if(!B||!B.belt)return;
  var hl=((B.len!=null)?B.len:2*(B.hw||BELT_SPAWN_LEN/2))/2;
  var px=(pivot&&pivot.x!=null)?pivot.x:B.x, py=(pivot&&pivot.y!=null)?pivot.y:B.y;
  var ux=Math.cos(th),uy=Math.sin(th);
  setBeltEnds(B,px-ux*hl,py-uy*hl,px+ux*hl,py+uy*hl,false);
}
// 长度手柄按住期间，这根杆的位姿归指针，与 kind==='body' 被抓住同一冻结语义。
// 单独一个谓词，供 6 处「被抓住就跳过」的门共用（漏一处就是拖长度时杆自己往下掉/被弹开）。
function rodLenFrozen(B){
  return !!(B&&grab&&grab.kind==='rodlen'&&grab.obj===B);
}
// 法向接近速度超过这个值才算「撞击」，才启用杆的转动项（静置压着不算，见 collideBodies）
var ROT_MIN_VN=40;
function tAnchor(B){
  if(B.kind)return {x:B.x,y:B.y};
  return B.massG?slot(B,B.massG):{x:B.x,y:B.y};
}
// 孤立的 g（唯一字形是 g、不是质量体、没有 kind）= 重力参数的可视化控件，浮空不落。
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
  // 组合不分先后：L 是 v/g 且旁边有自由的 t 时同样触发组合，端点取两者中点
  // （否则 v 拖到孤立的 t 上只会叠在一起往下掉）。
  if(L.type!=='t'){
    if(L.type!=='v'&&L.type!=='g')return null;
    var ft=null,ftg=1e9;
    for(var fti=0;fti<freeL.length;fti++){
      var FT=freeL[fti];
      if(FT.type!=='t'||FT===L||FT.dead)continue;
      // 同时用指针落点判：自由字母坠落位移、面板拖出的落点偏移都会拉开字母间距，
      // 而用户是瞄着看得见的字母松手的；取两者中更近的。两者都用盒距（固定 150px 半径会吸来很远的字母）。
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
      // 宿主这一路也用盒距（tAnchor 只是锚点）
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
    // 反向（v 拖到自由 t 上）取两者中点，正向仍以 t 的位置为锚
    var rx=c.rev?((c.fv.wx+L.wx)/2):L.wx;
    var ry=c.rev?((c.fv.wy+L.wy)/2):L.wy;
    var rod=makeRod(rx,ry,0,0);
    // 反向时 c.fv 就是被拖的 L，另一个字母在 c.other 里，两个都要收掉，
    // 否则画布上会留下一个孤零零的 t。
    killLetter(c.fv===L&&c.other?c.other:c.fv);
    killLetter(L);
    ringGo(rod.x,rod.y);
    return;
  }
  if(c.kind==='gtFree'){
    // g 拖到自由的 t 上 = gt → v（与正向 gt 同结果，只是没有宿主体）
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

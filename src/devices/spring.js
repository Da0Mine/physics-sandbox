/* 弹簧：几何、锚定、受力、组装体操作 */
import Matter from 'matter-js';
import { BODY, killBody } from '../bodies/body.js';
import { rodEndWorld, rodHingeTorque, rodLenFrozen, rodPlaceEnds, rodResyncRodPose, rodSyncLocks, rodSyncNoCollide, rodTryAnchor } from '../bodies/rod.js';
import { SPR_KHOST, bodies } from '../core/dom.js';
import { SNAP_DEG, clamp, shortAng } from '../core/math.js';
import { distToHost, hingeSurfacePoint, hostClosestPoint, hostCornerSnapPoint, hostMidSnapPoint } from './anchor.js';
import { hostIsAnvil } from './constraint.js';
import { dragPtrAxis } from './drag-lock.js';
import { hingeCaptureFold, hingeConstraintDrop, hingeSolve } from './hinge.js';
import { initRopeNodes, ropeSolve, ropeVerletStep } from './rope.js';
import { grab, pointer } from '../input/pointer.js';
import { GD } from '../letters/glyph.js';
import { refresh } from '../letters/layout.js';
import { freeLetter } from '../letters/panel.js';
import { GRAV } from '../params/defs.js';
import { MW, removeMatterBody } from '../physics/matter.js';
import { cvx } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { PHYS_MODE } from '../ui/settings.js';

export const SPR_PAD=15;          // 端点判定「碰到别的物体」的距离
export const SPR_KS_DEF=250;      // 默认刚度 N/m。夹子缩放锚点已冻结在 SPR_KS_ANCHOR，改默认值不影响夹子行为。
export const SPR_DAMP=0.8;        // 高中模式阻尼比 ζ = damp/SPR_HIGH_ZETA_DIV
                         // = 0.8/10 = 0.08。⚠ 大学模式同一个滑块读的是有量纲阻尼 D=0.8
                         // （ζ_大学 = D/(2√(k·m))，k=150/m=1 ⇒ ζ≈0.033）。
export const SPR_MIRROR_TOL=10;   // Matter 镜像长度变化超过它才重建（不能每帧造体）
// 弹力对 W 体的水平加速度上限（单位 g），防止弹簧水平拉动时把地面上的方块拉翻。
// 方块被水平拉动时「翻」与「滑」的分界是绕底边取矩：
//   翻倒力矩 = F·(h/2)；回复力矩 = mg·(w/2)  ⇒  a_x > g·w/h 就翻（正方形即 a_x > g）。
// 该阈值与摩擦无关：把 a_x 压到阈值以下，无论方块大小、ks、拖速都只能滑、不能翻。
// w/h 必须按每个物体自己的纵横比算，不能一刀切：竖长方形 90x110 阈值只有 0.818g（一刀切 0.95g
//   会把它掀翻 115.6°）；扁长方形 140x80 阈值 1.75g（一刀切会白白少给一倍拉力）。
// 按纵横比缩放后六种形状（40/60/90/130 正方形、90x110、140x80）翻转全部为 0°。
// 0.90 是余量：滑动中的接触抖动会额外贡献角冲量，贴着 1.00 太危险。
// 竖直分量不受此限（见 SPR_AY_G），弹簧吊起物体、斜向上拽照旧。
export const SPR_AX_G=0.90;
// 多边形（画的方块/笔画/凹槽）受弹力的力矩上限（单位 g）。SPR_AX_G 只管「拉力偶」
// （力作用在质心 + 地面摩擦）；这条管直接拧（τ = r×F，力作用在锚点上）。力臂口径取 min(hw,hh)
// （各种躺法里最保守的半宽），地面上躺稳时回复力矩 mg·半宽 恒能压住，拧不翻。
// 这条通道必须存在：没有它弹力永远作用在质心，方块朝向落稳后就再也无法改变。
// 已接受的代价：悬空时没有地面回复力矩，侧面锚点的方块会被拧到「锚点朝上」（钟摆行为），快速上提会翻。
// 参数扫描：tau=0 完全不转；0.15/0.30/0.45/0.60 上提分别翻 −90/−180/−113/−270°，水平拖各档均 ≈0°。
// 取 0.30：足以带动转向跟手，ω 峰值 496°/s（0.60 档 700°/s，甩得太狠）。
export const SPR_TAU_G=0.30;
// 弹力对 W 体的竖直加速度上限（单位 g），与 SPR_AX_G 成对。必须大于 1g，否则弹簧吊不起任何东西
// （悬挂平衡需要 F=mg）。作用是掐掉「猛地一提」时的瞬时过冲（实测 9.2g）—— 过冲会把下方方块甩上天、
// 落地翻滚。1.35 ⇒ 被吊方块最多以 0.35g 净加速度上升，跟得上手又不会被弹射。
export const SPR_AY_G=1.35;
// 三道夹子必须随 ks 缩放，否则调 k 没效果。
// 若用与 ks 无关的绝对夹子 —— ① stepSprings 的 clamp(ks·Δx + D·vrel, ±24000)；② springForceOn 的
//   |a_y| ≤ SPR_AY_G·g —— k≳3600 的弹簧会被压成恒力装置，k 从公式里消失。实测 1kg 球 k=50/500/5000/50000
//   静平衡伸长 51.7/5.21/5.73/63.2px（理论 mg/k = 52/5.2/0.52/0.052），k 大时方向甚至反了。
// 每条夹子按其物理含义换算：
//   ① 力上限 =「过形变超过 480px 就不信任弹簧模型」⇒ fMax = ks·(SPR_FMAX/SPR_KS_ANCHOR)。
//      480px = 24000/50（自然长度 170px 的 2.8 倍，正常实验到不了，只在几何坏掉时兜底）。
//   ② 加速度上限 =「不掀翻静置方块」⇒ 随 ks 线性放大，封顶 SPR_ACC_GAIN_MAX。封顶是数值必需：a·dt 是
//      单子步速度增量，8×1.35g 在 dt=1/240 下是 118px/s/子步，再大则一子步位移超过墨线厚度（4.65px）而穿壁。
//   ③ 阻尼 D 随 √ks 放大（保持阻尼比 ζ = D/(2√(km)) 不随 k 漂），同样封顶。不缩放则 k=50000 时 ζ 只有 0.016，
//      球以 ~35Hz 振铃，高于 60fps 的奈奎斯特频率 ⇒ 画面乱抖（混叠）。
// 三条都按冻结锚点 SPR_KS_ANCHOR=150 缩放，gain = max(1, ks/锚点)。
// 不要让锚点跟随 SPR_KS_DEF：默认值一改，同一 ks 的夹子就会变（默认 150→300 时同 ks=300 的夹子减半），
//   依赖默认 k 的既有标定随之失效。
export const SPR_FMAX=24000;        // ks = SPR_KS_ANCHOR 时的弹力上限（等价于「过形变 480px」）
export const SPR_KS_ANCHOR=150;     // 三条夹子的缩放锚点，冻结为 150（夹子标定时的默认值）
export const SPR_ACC_GAIN_MAX=8;    // 加速度上限的放大倍数上限（竖直 1.35g → 10.8g；水平 0.9g·asp 同倍）
export const SPR_DAMP_GAIN_MAX=10;  // 阻尼的放大倍数上限（D·dt/m ≤ 0.30，显式积分稳定余量充足）
// 本机能稳定表示的刚度上限（实测硬墙，不是保守取值）。静置后逐帧看 (cur−len) 峰峰：
//   k=5000  ω·dt=1.18 峰峰 0.021px 稳      k=10000 ω·dt=1.67 峰峰 118.5px 极限环
//   k=8000  ω·dt=1.49 峰峰 15.046px 极限环   k=50000 ω·dt=3.73 峰峰 508.1px 极限环
// 加大阻尼救不回来（k=20000 下 D=71/100/118 全是极限环）：这是积分器本身的稳定边界，与夹子无关。
// 所以夹子按 ks 缩放只做到 k≈5000，再往上必须截断有效刚度。
// ⚠ 截断必须按宿主而不是按单根弹簧做：刚度是叠加的 —— 同一个球上并联两根 k=3000（有效 6000）当场极限环，
//   单根 k=3000 只是偶尔微振。账本保证一个宿主身上的有效刚度总和 ≤ SPR_K_MAX（见 springKBook/springKShare）。
// 取 2000（ω·dt = 0.745，离墙 1.49 有 2 倍余量）；k=50 静伸长 52px vs k≥2000 的 1.3px，量程仍有意义。
export const SPR_K_MAX=2000;
export function springKEff(ks){
  var k=(ks>0?ks:SPR_KS_DEF);
  return k>SPR_K_MAX?SPR_K_MAX:k;
}
export function springKBook(){
  var i,e,S,a;
  for(i=0;i<SPR_KHOST.length;i++)SPR_KHOST[i]._kS=0;
  SPR_KHOST.length=0;
  for(i=0;i<bodies.length;i++){
    S=bodies[i];
    if(!S||S.kind!=='S'||S.dead)continue;
    var ke=springKEff(S.ks);
    for(e=0;e<2;e++){
      a=S.anc[e];
      if(!a||!a.B||a.B.dead)continue;
      if(!a.B._kS){a.B._kS=0;SPR_KHOST.push(a.B);}
      a.B._kS+=ke;
    }
  }
}
export function springKShare(h){
  if(!h||!h._kS||h._kS<=SPR_K_MAX)return 1;
  return SPR_K_MAX/h._kS;
}
// 三个「按 ks 缩放」的取用口，集中在这里免得四处各写一遍（口径不一致是最难查的 bug）。
export function springFMax(ks){
  var fmax=(ks>0?ks:SPR_KS_DEF)*(SPR_FMAX/SPR_KS_ANCHOR);
  return fmax<SPR_FMAX?SPR_FMAX:fmax;          // ks < 锚点时不下调（下限就是 SPR_FMAX）
}
export function springAccGain(ks){
  var g=(ks>0?ks:SPR_KS_DEF)/SPR_KS_ANCHOR;
  if(g<1)g=1;if(g>SPR_ACC_GAIN_MAX)g=SPR_ACC_GAIN_MAX;
  return g;
}
export function springDampGain(ks){
  var g=(ks>0?ks:SPR_KS_DEF)/SPR_KS_ANCHOR;
  if(g<1)g=1;
  g=Math.sqrt(g);if(g>SPR_DAMP_GAIN_MAX)g=SPR_DAMP_GAIN_MAX;
  return g;
}
// 弹簧的 Matter 镜像（一根静态薄板）必须和它自己拴住的宿主互不碰撞：端点在宿主内部，板必然穿过宿主，
// 求解器每帧强行分开会向宿主注入巨大能量（实测球被弹到 5000+ px/s）。
// Matter 里同一个负 group 的两个体永远不碰撞，不同 group 走 category/mask —— 所以宿主(-2) 对普通物体(0)
// 照常碰撞，只关掉「弹簧 ↔ 宿主」。副作用：两个都被弹簧拴住的物体之间也不碰撞（可接受）。
// SPR_STOP_E：弹簧压到最短（触底）时的挡板恢复系数，速度响应 λ = (1+e)：
//   e=0 → 抹掉接近速度（完全非弹性，每次触底掉一截能量，首次约 26%）；e=1 → 原样弹回（能量守恒）。
//   取 1：触底段总机械能峰值离散度 < 1%；固体高度的钢弹簧本来也近乎弹性。
export const SPR_STOP_E=1;
export const SPR_CGROUP=-2;
// 铰链宿主专用负组：销接双方互不碰撞。独立于 SPR_CGROUP。
export const HINGE_CGROUP=-3;
export function makeSpring(ax,ay,bx,by){
  var dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy);
  if(d<1){dx=1;dy=0;d=1;}
  var len=clamp(d,110,340);              // 自然长度 = 两个字母的间距（做了上下限钳制）
  // 高中模式没有斜弹簧：拖出的方向就地吸附到最近的轴（|dx|≥|dy| 取水平，否则竖直）；起点与长度不变
  //   （吸附在长度钳制之后）。配合高中①的无力矩，弹簧不会把物体拉翻滚。
  if(PHYS_MODE==='high'){
    if(Math.abs(dx)>=Math.abs(dy)){dx=(dx<0?-1:1);dy=0;}
    else{dx=0;dy=(dy<0?-1:1);}
    d=1;                                 // 方向已归一 ⇒ 下面的 dx/d 就是单位方向
  }
  var ex=ax+dx/d*len,ey=ay+dy/d*len;
  var B=BODY((ax+ex)/2,(ay+ey)/2);
  B.kind='S';
  B.e0={x:ax,y:ay};B.e1={x:ex,y:ey};
  B.anc=[null,null];                     // 两端各自的锚：null = 没接上（自身固定，只能拖）
  B.len=len;B.ks=SPR_KS_DEF;
  B.bounc=0;
  // 高中模式只在画出那一刻吸附方向不够：B.th 由两端派生，而 e0/e1 每帧随宿主重算，宿主一动方向就自由了。
  //   所以把吸附后的轴记成方向锁 dirLock（导轨），端点每帧投影回这条轴 ⇒ 弹簧整个生命周期都只沿轴伸缩。
  //   ⚠ 与手动「固定方向」的唯一差别：自动锁不冻结宿主自转（球照样能滚），故打 auto 标记，springSyncLocks 见到就跳过。
  //   刚画出时端点已在轴上，投影是恒等变换。
  if(PHYS_MODE==='high'){
    B.dirLock={mx:B.x,my:B.y,ux:(ex-ax)/len,uy:(ey-ay)/len,auto:true};
  }
  refreshSpringGeom(B);
  return B;
}
// B.x/B.y/B.th/B.hw 全部从两端派生 —— 单一几何来源，避免「改了 e0 忘了同步 th」这类漂移。
// 方向锁 = 导轨模型：S.dirLock 记下锁定那一刻的导轨线（中点 + 单位方向），端点先投影到导轨上再派生 ——
// 只去掉垂直分量、保留轴向分量，于是 cur/th/渲染/镜像板/弹力方向全部锁在这条线上。
// 投影必须放在 refreshSpringGeom：它是所有几何路径（stepSprings / springSetLen / springMoveRig /
// copySpringBody / 锚定）的唯一咽喉，漏一条路径就会出现「拖一下又转回去」。
export function refreshSpringGeom(B){
  if(B.dirLock){
    var Lk=B.dirLock;
    for(var li=0;li<2;li++){
      var le=(li===0)?B.e0:B.e1;
      var lt=(le.x-Lk.mx)*Lk.ux+(le.y-Lk.my)*Lk.uy;   // 轴向坐标（投影保留它）
      le.x=Lk.mx+Lk.ux*lt;le.y=Lk.my+Lk.uy*lt;
    }
  }
  var dx=B.e1.x-B.e0.x,dy=B.e1.y-B.e0.y,d=Math.hypot(dx,dy)||1e-6;
  B.x=(B.e0.x+B.e1.x)/2;B.y=(B.e0.y+B.e1.y)/2;
  B.th=Math.atan2(dy,dx);
  B.cur=d;                               // 当前长度（形变量 = cur - len）
  B.hw=d/2;B.hh=4;
}
export function springEnd(B,i){return i?B.e1:B.e0;}
export function springSetEnd(B,i,x,y){var e=springEnd(B,i);e.x=x;e.y=y;}
// 记下「端点相对宿主的本地偏移」：宿主之后平移/旋转，端点都能跟着走。
// 旋转约定与 nearInk / arcWorldCenter 一致：world = pos + R(th)·local，R(th)=[[c,-s],[s,c]]。
// （高中模式曾把弹簧锚点偏移冻结在质心系（_noRot=true，不随宿主转），已撤销：宿主有残余转动时连接点会在
//   表面滑移；现在各元件一律记在本地系，见 springAnchorOffset。）
// anyEndPoint：可锚定元件的端点取值 —— 弹簧 = e0/e1（live 对象，移动它即移动弹簧端），
// 杆 = 两端世界坐标（每次新建的对象；改杆端点请走 setRodEnds）。
// springAnchorOffset / springDisconnectAtPoint / springTryAnchorByHost 都读它。
export function anyEndPoint(B,i){
  if(!B)return null;
  if(B.kind==='S')return springEnd(B,i);
  if(B.kind==='T')return rodEndWorld(B,i);
  return null;
}
                                         //   Matter 积分互斗时会自激（实测 ω 炸到 1e6 rad/s），这是保险丝。
export function springAnchorOffset(B,i){
  var a=B.anc[i];if(!a||!a.B)return;
  var h=a.B,e=anyEndPoint(B,i);          // 端点按元件种类取（弹簧 e0/e1 / 杆两端）
  if(!e)return;
  var dx=e.x-h.x,dy=e.y-h.y;
  /* 杆两端锚点不分模式一律记在宿主本地系（随宿主转）；若用世界系冻结，宿主一转连接点就在物体表面滑动。 */
  if(B.kind==='T'){
    /* 质心吸附：杆端落在质心吸附带内 ⇒ 锚到质心。质心是物体上固定的一点，连接点仍相对物体不动，
     *  且力过质心 = 无力矩。带外 = 表面接触点（材料点）。
     *  ⚠ 只做吸附判定：不做球面滑动、不做深度升级（那会移动连接点）。 */
    var dcT=Math.hypot(dx,dy);
    var cradT=(h.wshape==='circle')?h.rad:null;
    var zoneT=cradT?cradT*0.7:Math.min(h.hw||30,h.hh||24)*0.9;
    /* 质心吸附只对杆(T)生效；铰链(S+hinge)/弹簧跳过质心带（走角/表面）。 */
    var _isRodT=!!(B&&B.kind==='T');
    if(_isRodT&&dcT<=zoneT){
      a.ox=0;a.oy=0;a._noRot=false;a._dyn=0;return;
    }
    /* 端点接触表面（dc≈rad，带外）时，若杆的轴线穿过质心（另一端与端点分居质心两侧，即往质心方向插）
     *  ⇒ 吸到质心；否则是表面横搭 ⇒ 材料点。 */
    /* 质心入口有两处（上面的质心带 + 这里的「杆轴指向质心」），都必须只对杆(T)生效，否则独立铰链也会吸到质心。 */
    var _oeT=_isRodT?anyEndPoint(B,1-i):null;
    if(_oeT&&cradT){
      var _oxT=_oeT.x-h.x,_oyT=_oeT.y-h.y;
      var _side=_oxT*dx+_oyT*dy;                 // 端点-质心 在「质心→另一端」方向上的投影
      if(_side<0&&dcT<=cradT+15){                // 端点在质心的另一侧 ⇒ 杆指向质心 ⇒ 吸
        a.ox=0;a.oy=0;a._noRot=false;a._dyn=0;return;
      }
    }
    /* 不要把高中圆的杆锚点改到球心（质点语义）：实测高中杆仍会飞出，无效。高中杆飞出的根因是
     *  「质点+无力矩+自转冻结」与杆约束的语义冲突（不是速度重建、也不是锚点位置），需专项重做高中杆约束模型。 */
    var cT=Math.cos(h.th||0),sT=Math.sin(h.th||0);
    a.ox=dx*cT+dy*sT;a.oy=-dx*sT+dy*cT;a._noRot=false;return;
  }
  /* 绳与杆一样是点附着约束：锚点必须钉在材料点、随宿主转，不分模式。若套用世界系冻结的锚点，
   *  重物下落/旋转时绳端在物体表面滑移，看起来就是绳子和物体分离。 */
  /* 不要把绳锚点做成「动态最近点」（按另一端每帧重算 ox/oy）：锚点永不钉死，拖绳身时固定点会在宿主表面滑动。 */
  /* 弹簧同样不分模式一律本地系钉材料点：世界系偏移（不随宿主转）在宿主有残余转动时会让连接点在表面滑移
   *  （例如抓住/松开一侧物体后另一侧连接点轻微偏移）。 */
  var c=Math.cos(h.th||0),s=Math.sin(h.th||0);
  a.ox=dx*c+dy*s;a.oy=-dx*s+dy*c;a._noRot=false;
}
/* 拖动中的轻质杆 = 拖整个装配体：已锚定的宿主必须逐子步被摆回杆端，不能只在 pointermove 里跟。
 * 宿主位姿归 Matter，会在子步里被重力带下去；pointermove 只在事件到达时补一次，指针停住就一个事件都没有
 * ⇒ 拖到高处停住时宿主脱离下落，松手才回弹。
 * 所以落点必须在子步求解之后（stepMatter 的 240Hz 循环里）。拖拽期宿主归杆端（拖拽端在约束里永远是权威）；
 * 位移精确等于残差 ⇒ 本子步结束时残差恒 0；同时清掉宿主速度 ⇒ 不会攒下松手弹飞的动能。
 * 另一端是铁砧（static / 右键固定）时跳过。
 * 只在杆正被指针抓着时调用（见 stepMatter 子步循环与 pointermove 的 T 分支），其余时刻宿主位姿由
 * rodSyncAnchors 决定，两条路径互为逆运算，松手那一刻无缝。 */
/* relax：可动宿主搬运量的打折比例（默认 1 = 一次搬到位）。多杆链里同一宿主被两根杆约束时，
 *  两根杆的硬投影会互相破坏、来回振荡不收敛；带松弛的交替投影才收敛到两约束的折中（可行时即交集）。 */
/* 宿主 h 是否被别的元件锁到铁砧上（那条元件另一端是 hostIsAnvil）；是则对该杆而言这一端当铁砧。
 *  场景：墙 —绳1— A —杆2— B，拖杆2。A 被绳1 锁住，pass2 若把宿主搬到杆端会把杆2 自己拉长。
 *  语义与绳/杆一致：够不着 ⇒ 拖不动，但不分离；杆的「拖不动」= 绕另一端旋转（pass1 的静态端语义）。
 *  ⚠ 绳只有绷直才算锁：绳松弛时 conPull 不动（只在 over=d-target>0 时收），宿主是自由的。杆是刚性的 ⇒ 恒锁。
 *  ⚠ 只影响该杆的求解，不改全局 hostIsAnvil —— 它被 conMov / ropeSolve / conDragConstrain 共用，放宽会改变绳的位移分配。
 *  ⚠ exceptB = 正在处理的这根杆自己，不排除会被自己的另一端锁住（自锁）。
 *  ⚠ 不能反过来用 hostMovableByConstraint 判可动：会把临时被锁的宿主算成可动，循环分配不收敛。
 *  ⚠ 别加 !h.anc 守卫：W 体没有 anc 字段，而那正是本函数要判的对象（加了函数恒返回 false）。 */
export function springHostPinnedByAnvil(h,exceptB){
  if(!h)return false;
  for(var i=0;i<bodies.length;i++){
    var E=bodies[i];
    if(!E||E.dead||E===exceptB||!E.anc)continue;
    var isRod=(E.kind==='T'),isRope=(E.kind==='S'&&E.rope);
    if(!isRod&&!isRope)continue;
    for(var j=0;j<2;j++){
      var a=E.anc[j];
      if(!a||a.B!==h)continue;
      var o=E.anc[1-j];
      if(!o||!o.B||o.B===h)continue;
      if(!hostIsAnvil(o.B))continue;      // 另一端没钉死 ⇒ 这条元件锁不住 h
      if(isRope){                         // 绳：只有绷直才锁（松弛 ⇒ conPull 一句不动）
        var L=E.len||0;
        if(!(L>0)){return true;}
        var p=springAnchoredWorld(E,j),q=springAnchoredWorld(E,1-j);
        if(!p||!q)continue;
        if(Math.hypot(p.x-q.x,p.y-q.y)<L-ROPE_TAUT_EPS)continue;
      }
      return true;
    }
  }
  return false;
}
/* 拖拽中的 S 族（弹簧 / 轻绳 / 光滑铰链）= 拖整个装配体，且必须逐子步摆（与 rodDragPinHosts 同理）。
 * pointermove 里的 springMoveRig(B,sdx,sdy) 是增量式的，指针一停就没有事件 ⇒ 装配体位姿归 Matter ⇒ 重力把整体带走。
 * 做法：逐子步把被抓住的那一点精确摆回指针 —— 用按下时记的本地偏移（glx/gly，物体转动后抓的始终是同一块材料）
 * 还原该材料点的世界坐标，把残差整份交给 springMoveRig（搬弹簧两端 + 所有非铁砧宿主，并清宿主速度
 * ⇒ 不攒松手弹飞的动能）。增量那一路保留（更跟手），两条路都收敛到「材料点在指针下」。 */
export function springDragPinRig(B){
  if(!B||B.dead||B.kind!=='S')return false;
  if(!grab||grab.kind!=='body'||grab.obj!==B)return false;
  var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
  var glx=(grab.glx!=null)?grab.glx:(grab.gx||0);
  var gly=(grab.gly!=null)?grab.gly:(grab.gy||0);
  var wx=B.x+glx*c-gly*s,wy=B.y+glx*s+gly*c;         // 被抓材料点的世界坐标
  var ep=dragPtrAxis();   // 与 W/T 同口径
  var tx=(ep&&ep.x!=null)?ep.x:pointer.x,ty=(ep&&ep.y!=null)?ep.y:pointer.y;
  var dx=tx-wx,dy=ty-wy;
  if(!dx&&!dy)return false;
  springMoveRig(B,dx,dy);
  return true;
}
export function springAnchoredWorld(B,i){
  var a=B.anc[i];
  if(!a||!a.B)return null;
  var h=a.B;
  if(a._noRot&&B.kind!=='T')return {x:h.x+a.ox,y:h.y+a.oy};  // _noRot：只跟平动（高中弹簧旧语义，springAnchorOffset 已不再写入）；杆两模式都随宿主转
  var c=Math.cos(h.th||0),s=Math.sin(h.th||0);
  return {x:h.x+a.ox*c-a.oy*s,y:h.y+a.ox*s+a.oy*c};
}
export function springSyncEnds(B){
  for(var i=0;i<2;i++){
    var a=B.anc[i];
    if(!a)continue;
    // 宿主没了（被删除/被黑洞吃掉）-> 锚自动失效，那一端就地变成自由端
    if(!a.B||a.B.dead||bodies.indexOf(a.B)<0){B.anc[i]=null;continue;}
    var p=springAnchoredWorld(B,i);
    springSetEnd(B,i,p.x,p.y);
  }
  /* 光滑铰链的 len 恒为 0：它是一个销钉（一个点），两端天生必须重合。半连接（只锚一端）时，未锚端若留在原地，
   *   宿主一转就会与已锚端分开（已锚端沿弧线走、未锚端只跟质心平移，d = r·Δθ），drawHinge 会把这段距离画成一条臂。
   *   所以未锚端跟随已锚端。这样第二端仍能在 SPR_PAD 内锚上第二个物体（不能把自由端钉死，否则第二端永远拴不上）。
   *   放在这个咽喉里 ⇒ 所有调用点（stepSprings / hingeSolve / 拖拽 / 触底块…）同时生效。 */
  if(B.hinge&&(B.anc[0]||B.anc[1])&&!(B.anc[0]&&B.anc[1])){
    var k=B.anc[0]?0:1;                       // k = 已锚的那一端
    var src=(k===0)?B.e0:B.e1,dst=(k===0)?B.e1:B.e0;
    dst.x=src.x;dst.y=src.y;
  }
  /* 铰链一旦不再双端都锚上，真 Constraint 就必须摘掉。必须放在这个咽喉里而不是 hingeSolve：宿主被删时 anc[i]
   *   在这里被清成 null，而 hingeSolve 第一行就 return，跑不到摘除点 ⇒ 约束留在世界里把两个体隐形地永久钉住。 */
  if(B.hinge&&!(B.anc[0]&&B.anc[1]))hingeConstraintDrop(B);
  refreshSpringGeom(B);
}
// 方向锁的导向力：真实锚点相对导轨的偏移是纯垂直的（投影保留轴向坐标），
// 把它当成一根横向小弹簧（同一根 ks + 阻尼）拉回导轨 —— 相当于「弹簧装在导轨上」的滑块约束。
// 走 springForceOn（作用点 = 真实锚点）：水平/竖直限幅与力矩上限自动生效，不会掀翻宿主。
// 必须放在 stepSprings（有 dt）而不是 springSyncEnds（它被拖拽/复制等无 dt 的路径调用）。
export function springGuideForce(B,dt){
  var Lk=B.dirLock;
  for(var i=0;i<2;i++){
    var a=B.anc[i];
    if(!a||!a.B||a.B.dead)continue;
    var p=springAnchoredWorld(B,i);       // 真实锚点（投影前的位置）
    var e=(i===0)?B.e0:B.e1;              // 已投影到导轨上的端点
    var wx=p.x-e.x,wy=p.y-e.y;            // 导轨 -> 锚点（纯法向）
    var off=Math.hypot(wx,wy);
    if(off<0.5)continue;                  // 贴着导轨就不折腾（死区，免得数值噪声常驻微力）
    var nx=wx/off,ny=wy/off;
    var v=springHostVel(a.B,nx,ny,p.x,p.y);
    // 力上限与宿主加速度上限同样要随 ks 走（导向力与原弹簧共用 ks/阻尼）；
    // 写死 24000 会让「方向锁 + 硬弹簧」退化成恒力约束。
    var keff=springKEff(B.ks)*springKShare(a.B);
    var fmax=springFMax(keff);
    var f=clamp(-keff*off-springDamp(B,a.B,null)*v,-fmax,fmax);
    if(f)springForceOn(a.B,f*nx,f*ny,dt,p.x,p.y,keff);
  }
}
// 「被支撑」判定：主机是否压在不可动的东西上（地面 / 墙 / 天花板 / 右键固定过的体）。
// 用途：springRailFollow 每帧把可动宿主的锚点绝对搬到导轨上（setPosition）。参考取两端平均时，
//   落不了地的一端会把支撑端一起拖向自己 ⇒ 支撑端每帧被按进地面、接触又顶回来，永不收敛
//   （实测每帧约 1.2px 往返改正），表现为悬空端垂直于弹簧方向抖动 + 压地端穿模。
// 支撑面与静止/固定体同属外部位移源，因此当作导轨参考（导轨钉在它身上）：它对导轨的偏移恒为 0
//   ⇒ 校正量 0 ⇒ 永远不会被搬；悬空端只能沿轴动。
//   不要改成「把被支撑端排除在对齐之外」（冻结）：会让「拖任一只都把整体抬起来」失效。
// 适用范围：只在恰好一端被支撑时钉（两端都压地时取平均本来就是 0 校正）；优先级低于被拖端；
//   拖拽侧的轴向锁 dragAxisLock 不用它（那里只认真固定，否则两只压地的球组成的弹簧永远抬不起来）。
// 判据刻意保守，否则落地瞬间的冲击会把整个装配体误判成有支撑而锁死：
//   ① 有活动接触且对方 isStatic（地面/墙/固定体，含复合体的 parts）；
//   ② 自身几乎没在动（真值 ≤ 45px/s ⇒ prop ≤ 0.75；velocity 单位是「每 1/60s」）。
export function railHostSupported(h){
  if(!h||!h.mb||h.mb.isStatic||h.fixed)return false;
  if(!MW||!MW.engine)return false;
  var v=h.mb.velocity||{x:0,y:0};
  if(Math.hypot(v.x,v.y)*60>45)return false;
  var mb=h.mb;
  // ① 包围盒贴地/贴墙（3px 容差）。必须有这条：接触求解允许物体停在离地面 2~3px 处（实测静止位 −2.31px），
  // 而 Matter 的接触判定要求包围盒真的相交 —— 只查 pairs 会漏判，判据在帧间忽真忽假（= 抖）。
  if(MW.ground&&MW.ground.bounds&&mb.bounds){
    var bb=mb.bounds,gb=MW.ground.bounds;
    if(bb.max.y>=gb.min.y-3&&bb.min.y<=gb.max.y)return true;
  }
  if(MW.wl&&MW.wl.bounds&&mb.bounds){
    var bb2=mb.bounds,wb=MW.wl.bounds;
    if(bb2.max.x>=wb.min.x-3&&bb2.min.x<=wb.max.x)return true;
  }
  if(MW.wr&&MW.wr.bounds&&mb.bounds){
    var bb3=mb.bounds,wb2=MW.wr.bounds;
    if(bb3.max.x>=wb2.min.x-3&&bb3.min.x<=wb2.max.x)return true;
  }
  /* 天花板也算支撑面（同左右墙口径），见 ensureMatter 的 wt。 */
  if(MW.wt&&MW.wt.bounds&&mb.bounds){
    var bb4=mb.bounds,wb3=MW.wt.bounds;
    if(bb4.min.y<=wb3.max.y+3&&bb4.max.y>=wb3.min.y)return true;
  }
  // ② 与任何 static 体有活动接触（右键固定过的物体、用户画的固定图形等）。
  //    复合体的接触挂在 part 上，所以要用 parts 去比对。
  if(!MW.engine.pairs)return false;
  var pl=MW.engine.pairs.list,ps=mb.parts||[mb];
  for(var i=0;i<pl.length;i++){
    var pr=pl[i];
    if(!pr||!pr.isActive)continue;
    var oth=null;
    for(var j=0;j<ps.length;j++){
      if(pr.bodyA===ps[j]){oth=pr.bodyB;break;}
      if(pr.bodyB===ps[j]){oth=pr.bodyA;break;}
    }
    if(oth&&oth.isStatic)return true;
  }
  return false;
}
// 导轨跟随：方向锁只锁方向、不锁位置 —— 锚点往垂直方向挪时，导轨跟着平移过去。轴向坐标不受
// 垂直平移影响（投影只清垂直分量），弹簧长度/弹力通道无感，于是「弹簧+物体」在垂直方向上整体平移。
// 参考点选取（按优先级）：
//   ① 有 static/fixed 的锚 -> 导轨钉死在该锚上；
//   ② 某锚的宿主正被鼠标拖动 -> 导轨完全跟随该锚（取平均会让弹簧只跟一半，看起来拖不动）；
//   ③ 否则取所有锚的垂直偏移平均值 —— 两端偏移差（剪切）仍由 springGuideForce 拉回。
// 调用顺序：stepSprings 中 springSyncEnds 之后、springGuideForce 之前（先同步锚点真实位置，
// 再搬导轨、重投影，残余剪切交给导向力）。
//
// springRailRelaxed：高中模式 + 水平导轨 + 没在拖 ⇒ 放松法向刚性。
// 此时导轨不对宿主行使任何位移/速度权，只把导轨自己摆到两端锚点的平均高度；端点照旧由
//   refreshSpringGeom 投影到导轨 ⇒ 弹簧恒水平，两个连接点沿各自宿主侧面上下滑动，物体各自服从重力与接触。
// 原因：水平导轨的法向正是重力方向，把宿主搬到导轨上等于用竖直刚杆把物体吊在半空 —— 落不了地，
//   接触又把它顶回来 ⇒ 悬空端抖 + 压地端穿模；若改为清零法向速度，整体又动不了。竖直刚性本身自相矛盾，
//   而高中模型里弹簧力只沿轴向，本就不该对物体施加竖直方向的力。
//   · 稳态下两端等高，平均高度就是各自锚点高度、偏移 ≡ 0，连接点不滑动；只有两端高度不一致的瞬态里
//     端点各滑一半，滑动量 ≤ 高差/2，且被公共区间夹住不会滑出宿主侧面。
//   · 拖拽时不放松（导轨焊在被拖锚上，另一只刚性跟随）。
//   · 仅限高中模式且导轨水平（|uy| < 1e-3，高中模式方向吸附保证轴对齐）。竖直导轨的法向与重力正交，
//     不存在吊在半空的问题，不碰。
export function springRailRelaxed(B){
  var Lk=B&&B.dirLock;
  if(!Lk||PHYS_MODE!=='high'||Math.abs(Lk.uy)>=1e-3)return false;
  // 拖杆的长度手柄也算拖拽态（宿主正被手按住，导轨不能反过来搬它）
  if(grab&&(grab.kind==='body'||grab.kind==='rodlen')){
    for(var i=0;i<2;i++){var a=B.anc[i];if(a&&a.B&&a.B===grab.obj)return false;}  // 拖拽态：不放松，走常规导轨跟随
  }
  return true;
}
// 能力标记：供外部探针脚本识别该行为是否存在（缺失时 SKIP）。
export function springRailFollow(B){
  var Lk=B.dirLock;
  /* 单端锚定 + 方向锁：导轨线整体跟随锚定端（mx,my=锚端），自由端摆在「锚端 ± 轴向×自然长度」，
   * 整体平移、保持自然长度、方向仍锁死。不要只处理法向偏移：导轨钉在锁定时的世界位置上，
   * 沿轴向拖固定端时自由端轴向坐标不变，会被纯拉伸（看起来像钉在原地）。
   * 自由端被拖到另一侧时尊重现状的符号。双端锚定走下面的逻辑。 */
  var _n0=B.anc[0]?B.anc[0].B:null,_n1=B.anc[1]?B.anc[1].B:null;
  if((_n0?1:0)+(_n1?1:0)===1){
    /* 弹簧本体正被拖（拖自由端去锚第二个物体）⇒ 几何归指针，不摆回自然长度，否则自由端永远够不着目标。 */
    if(grab&&grab.kind==='body'&&grab.obj===B){
      /* 弹簧本体被拖（拖自由端换边/锚第二物体）⇒ 朝向记忆跟着现状走，松手后不回跳 */
      var pX=springAnchoredWorld(B,_n0?0:1),_feX=_n0?B.e1:B.e0;
      if(pX)B._capSide=Math.sign((_feX.x-pX.x)*Lk.ux+(_feX.y-pX.y)*Lk.uy)||B._capSide||1;
      return;
    }
    var _i0=_n0?0:1,_hA=B.anc[_i0].B,_fE=_i0?B.e0:B.e1;
    var pA=springAnchoredWorld(B,_i0);
    if(pA){
      /* 自由端所在侧 sgn 记忆化（B._capSide 首次定死）：按当前位置重算会在锚端被拖越过自由端时反号，
       * 自由端瞬移到轴的另一侧。锚端无论被抓着拖还是物理移动，自由端都做「锚端 + 轴向×len」的刚性平移跟随
       * （自由端无质量，瞬时跟随是正确的）。 */
      if(B._capSide==null){
        B._capSide=Math.sign((_fE.x-pA.x)*Lk.ux+(_fE.y-pA.y)*Lk.uy)||1;
      }
      var sgn=B._capSide;
      /* 端帽压缩量纳入摆位：自由端停在「自然长度 − 压缩」处；_capCmp 由 springEndCaps 的接触压入状态机维护。 */
      var _cmp=B._capCmp||0;
      _fE.x=pA.x+Lk.ux*((B.len||0)-_cmp)*sgn;_fE.y=pA.y+Lk.uy*((B.len||0)-_cmp)*sgn;
      Lk.mx=pA.x;Lk.my=pA.y;
      refreshSpringGeom(B);
    }
    return;
  }
  var nx=-Lk.uy,ny=Lk.ux;                 // 导轨法向（单位向量，u 转九十度）
  // 高中 + 水平导轨 + 没在拖（springRailRelaxed）：导轨只跟随两端锚点的平均高度，宿主不动。
  // 夹进两端宿主都够得着的公共区间 [lo,hi]：防高度差大时端点滑出宿主、弹簧画在半空。
  // 区间为空（两端纵向完全错开）时退回纯平均。
  if(springRailRelaxed(B)){
    var ry=0,rn=0,lo=-1e9,hi=1e9;
    for(var qi=0;qi<2;qi++){
      var aq=B.anc[qi];
      if(!aq||!aq.B||aq.B.dead)continue;
      var pq=springAnchoredWorld(B,qi);
      if(!pq)continue;
      ry+=pq.y;rn++;
      var hq=aq.B,hb=(hq.hh!=null)?hq.hh:0;
      if(hb>0){
        var hyc=(hq.mb&&hq.mb.position)?hq.mb.position.y:hq.y;
        if(hyc-hb>lo)lo=hyc-hb;
        if(hyc+hb<hi)hi=hyc+hb;
      }
    }
    if(rn){
      var ty=ry/rn;
      if(hi>lo)ty=clamp(ty,lo,hi);
      // 死区只省 refreshSpringGeom（亚像素噪声不值得重投影）。
      if(Math.abs(ty-Lk.my)>=0.01){Lk.my=ty;refreshSpringGeom(B);}
    }
    return;
  }
  var dsum=0,cnt=0,pin=null,drag=null,sup=null,supN=0;
  for(var i=0;i<2;i++){
    var a=B.anc[i];
    if(!a||!a.B||a.B.dead)continue;
    var p=springAnchoredWorld(B,i);
    var d=(p.x-Lk.mx)*nx+(p.y-Lk.my)*ny;  // 锚点相对导轨的垂直偏移（带符号）
    if(a.B.mb&&(a.B.mb.isStatic||a.B.fixed)){pin=d;break;}   // 静止端：导轨钉在它身上
    if(grab&&grab.kind==='body'&&grab.obj===a.B){drag=d;}    // 被拖的锚：整体焊在它身上
    // 被支撑端（railHostSupported）也把导轨钉在自己身上，两个边界：
    //   ① 优先级低于被拖端：拖装配体的任何一员都必须能把它整体抬起来（否则拖一只压地的球向上时整块抬不动）；
    //   ② 只在恰好一端被支撑时钉（supN===1）：两端都压地时偏移本来相等、校正量为 0，钉了反而偏心。
    if(railHostSupported(a.B)){supN++;sup=d;}
    dsum+=d;cnt++;
  }
  var d=(pin!=null)?pin:(drag!=null)?drag:((supN===1)?sup:(cnt?dsum/cnt:0));
  // d 的死区只决定导轨要不要平移，不能拿来跳过下面的法向刚性对齐：
  // 否则拖动刚停下时 d≈0，其余宿主不再被对齐，重力立刻把它拉离导轨（实测按住 0.3s 拉开约 20px），
  // 只能靠导向力慢慢回弹。固定方向 = 这条导轨线在法向上对装配体是刚性的。
  if(isFinite(d)&&Math.abs(d)>=0.01){
    Lk.mx+=nx*d;Lk.my+=ny*d;                // 导轨整体平移到参考偏移处
    refreshSpringGeom(B);                   // 端点重新投影（轴向坐标原样保留）
  }
  // 刚性对齐：把其余宿主的锚点绝对对齐到（已平移后的）导轨上 —— 不是按 d 平移，而是把锚点对导轨的
  // 残余偏移 o2（含上一帧重力下坠）一次性清零，垂直方向真刚性。轴向不动（保留拉伸语义）。
  // 每帧都做（不只拖拽时）：refreshSpringGeom 把端点投影在导轨上，锚点却记在宿主上 —— 宿主一旦离开
  // 导轨，端点就与锚点分开，表现为弹簧端点在物体表面爬。仅靠 springGuideForce 不够：高中 damp=0 时
  // 横向偏移是永不衰减的振荡（实测 ±29.5px），开重力时方块稳定挂在导轨下方 160px。
  // 所以「连接点钉在物体上 + 弹簧只许水平/竖直」只能靠搬宿主保证，不能靠搬端点。三条纪律：
  //   ① 只对齐可动宿主；静止/固定/正被拖的宿主跳过 —— 它们是导轨参考（外部位移源），不能被弹簧改写；
  //   ② 法向速度：有静止/被拖参考时归零（刚性连杆接到墙/指针）；没有参考时取可动宿主的平均法向速度，
  //      否则整体垂直平移会被每帧清零。取平均保证动量守恒且是耗散性的；
  //   ③ 位移只做差分校准（每端各自朝导轨动 o_i），整体平移量不受影响。
  var align=[],frozen=false,vsum=0,nmov=0;
  for(var j=0;j<2;j++){
    var b2=B.anc[j];
    if(!b2||!b2.B||b2.B.dead||!b2.B.mb)continue;
    var h2=b2.B;
    var p2=springAnchoredWorld(B,j);
    var o2=(p2.x-Lk.mx)*nx+(p2.y-Lk.my)*ny;   // 锚点对新导轨的残余偏移
    var vv=h2.mb.velocity||{x:0,y:0},v2=vv.x*nx+vv.y*ny;
    // 这里不要加 railHostSupported 冻结：会让「拖任一只都把整体抬起来」失效。被支撑端由上面的
    // 钉参考保护：导轨焊在它身上 ⇒ 它自己的校正量恒为 0 ⇒ 不会被搬。
    if(h2.mb.isStatic||h2.fixed||
       (grab&&grab.kind==='body'&&grab.obj===h2)||
       rodLenFrozen(h2)){frozen=true;continue;}   // 正被长度手柄按住的杆不许被导轨搬
    align.push([h2,o2]);vsum+=v2;nmov++;
  }
  var vtgt=frozen?0:(nmov?vsum/nmov:0);
  for(var k=0;k<align.length;k++){
    var hk=align[k][0],ok=align[k][1];
    if(Math.abs(ok)>0.01){
      Matter.Body.setPosition(hk.mb,{x:hk.mb.position.x-nx*ok,y:hk.mb.position.y-ny*ok});
      hk.x=hk.mb.position.x;hk.y=hk.mb.position.y;
      if(Matter.Sleeping)Matter.Sleeping.set(hk.mb,false);
    }
    var vk=hk.mb.velocity||{x:0,y:0},vnk=vk.x*nx+vk.y*ny;
    if(Math.abs(vnk-vtgt)>1e-9)
      Matter.Body.setVelocity(hk.mb,{x:vk.x+nx*(vtgt-vnk),y:vk.y+ny*(vtgt-vnk)});
  }
}
// 方向锁弹簧的宿主冻结自转（与弹簧组成整体，只随整体旋转）。每帧把角速度清零（stepSprings 在
// stepMatter 的引擎步进之后跑，此刻清零保证渲染与下一帧积分都看到 ω=0，碰撞残余角速度活不过一帧），
// 且弹簧力通道不再对它产生力矩（springForceOn 里 _lockRot 时把作用点折叠到质心）。
// 两根弹簧一锁一不锁共宿主时按锁的算（并集语义）。
export function springSyncLocks(){
  var i,e,B;
  for(i=0;i<bodies.length;i++){if(bodies[i]._lockRot)bodies[i]._lockRot=false;}
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='S'||B.dead||!B.dirLock)continue;
    // 大学模式的自动轴锁不冻结宿主自转：它只锁方向，自转与导轨无耦合，冻结会让连了弹簧的球滚不起来。
    //   手动「固定方向」（右键菜单，无 auto 标记）照常冻结。
    // 高中模式下 auto 锁的宿主也冻结（球除外，球要能滚）：非球物块在高中是质点模型，自转无合法语义；
    //   且高中无力矩通道、无空气阻力，碰撞注入的 ω 没有衰减通道，不冻结会永远匀速转下去
    //   （实测注入 3rad/s 四秒不衰减）。
    if(B.dirLock.auto&&PHYS_MODE!=='high')continue;
    for(e=0;e<2;e++){
      var a=B.anc[e];
      if(!a||!a.B||a.B.dead||!a.B.mb||a.B.mb.isStatic)continue;
      // 高中 auto 锁下球不冻（连了弹簧还要能滚）
      if(B.dirLock.auto&&a.B.wshape==='circle'&&a.B.rad)continue;
      a.B._lockRot=true;
      if(a.B.mb.angularVelocity)Matter.Body.setAngularVelocity(a.B.mb,0);
      if(a.B.om)a.B.om=0;                 // 渲染侧的角速度派生量一并清零
    }
  }
}
// 宿主附着点在弹簧轴上的速度分量（阻尼项要用相对速度）：v_P·u = v_com·u + ω·(r × u)，
// r = 附着点 − 质心（2D 叉积 z 分量）。必须含 ω×r 项：否则转动态不在阻尼作用范围内，「弹簧 + 球 + 地面」
// 会成为不衰减的极限环（滚动接触把自旋换成平移，力矩又把自旋喂回来；实测 12s 不停）。
export function springHostVel(h,ux,uy,px,py){
  if(!h)return 0;
  var v=(h.vx||0)*ux+(h.vy||0)*uy;
  if(px!=null&&h.mb){
    var rx=px-h.mb.position.x, ry=py-h.mb.position.y;
    v+=(h.mb.angularVelocity*60)*(rx*uy-ry*ux);   // angularVelocity 是 rad/「1/60 步」，×60 得 rad/s
  }
  return v;
}
// px,py = 力的作用点（世界坐标，即锚点）。力推质心，同时把 τ = r × F（r = 锚点 − 质心）折成角速度增量；
// 否则对宿主零力矩，勾在圆边缘上的球会以原姿态僵在半空，而真实刚体会绕挂点转到正上方才稳。
// 配套 springHostVel 里的 ω×r 阻尼项。
export function springForceOn(h,fx,fy,dt,px,py,ks){
  if(!h||h.dead)return;
  if(h.kind==='S')return;                      // 弹簧不直接推弹簧（避免连锁拖动/自激）
  if(h.mb&&h.mb.isStatic)return;               // 右键固定过的物体、铁砧：不动
  // 质量口径刻意用 JS 侧的 h.mass（默认 1），不是 Matter 按面积算的真实质量（90x90 方块 mass=9.216），
  //   不要「顺手修正」：整条弹力通道（含下面角速度分支的单位转动惯量 I/m = r²/2）都按 m=1 标定，
  //   如悬挂伸长 mg/k ≈ 14.4px、挂在边缘的球绕挂点转正。换成真实质量会下垂 9 倍、自转慢 9 倍。
  //   防翻倒用的是纯加速度判据（a_x > g，见 SPR_AX_G），与质量口径无关。
  var m=(h.mass&&h.mass>0)?h.mass:1;
  if(h.kind==='W'&&h.mb){
    // 方向锁宿主冻结自转（springSyncLocks 每帧打标）：力作用在质心，不产生力矩。
    if(h._lockRot)px=null;
    // 高中模式：弹簧不算力矩，力只沿弹簧方向作用在质心。置 null 后下方 τ=r×F 通道整体跳过
    // （主弹簧力与方向锁导向力都走本函数）。
    if(PHYS_MODE==='high')px=null;
    // 防翻倒：水平加速度限幅到 SPR_AX_G·g·(w/h)，即不翻倒阈值 g·w/h 再打九折 —— 翻倒力矩恒小于重力回复力矩，
    // 方块无论多大、多重、ks 多大、拖多快都只会滑、不会翻。必须按物体自己的 w/h 算（一刀切会把竖长方形掀翻）。
    // 竖直分量限到 SPR_AY_G·g（=1.35g）：仍大于 1g，吊起/斜拽照旧，只掐掉猛提时约 9.2g 的瞬时过冲。
    // 实测（300px/600ms 拖拽，六种形状）：限幅前远端块翻 92~362°，限幅后 0°。
    // GRAV=0 时整段跳过：没有重力就无所谓翻倒，也保证 GRAV=0 隔离实验中弹力通道行为不变。
    if(GRAV>0){
      // 两个上限按 ks 缩放（springAccGain）：否则 k ≳ 3600 后弹力永远吃满 1.35g，k 从公式里消失
      // （实测 k=50~50000 加速度峰值全等）。ks ≤ 默认值时 gain 恒为 1，ks 大时线性放大并封顶。
      var gain=springAccGain(ks);
      // 用本体的本征纵横比（hw/hh 是未旋转的局部半宽半高）。下限 0.25 防极端细长体（w/h -> 0）把拉力削到接近 0。
      var rw=h.hw||0,rh=h.hh||0;
      var asp=(rw>0&&rh>0)?Math.max(0.25,rw/rh):1;
      var limX=SPR_AX_G*GRAV*m*asp*gain;
      if(fx>limX)fx=limX;else if(fx<-limX)fx=-limX;
      var limY=SPR_AY_G*GRAV*m*gain;
      if(fy>limY)fy=limY;else if(fy<-limY)fy=-limY;
    }
    // 边界/图形的位姿归 Matter 管：stepMatter 每帧把 B.vx/B.vy 用位姿差分写成只读派生量，
    // 对 W 写 h.vx 会在下一帧被覆盖、力静默消失。
    // 所以走 Matter.Body.setVelocity：其 velocity 单位是「px / 1 个 1/60 步」，fx/m*dt 是 px/s，要 /60 换算；
    // setVelocity 内部会一起修正 positionPrev，不产生幻影速度。
    // 不用 applyForce：那要把力塞进 Matter 的 deltaTime² 量纲（force/mass*dt²），缩放系数一旦和
    // timeScale / body.mass 脱节就会静默失力。
    Matter.Sleeping.set(h.mb,false);
    var mv=h.mb.velocity;
    Matter.Body.setVelocity(h.mb,{x:mv.x+fx/m*dt/60,y:mv.y+fy/m*dt/60});
    // 力矩：力只作用于质心的话，弹簧永远转不动宿主 —— 挂在边缘的球不会转到挂点朝上；多边形一旦躺稳
    // （重力力矩=0）就再无任何通道改变朝向，方向永久锁死。拴在附着点上的力必须真的作用在附着点，
    // 所以圆和多边形都接 τ=r×F。锚点在侧面中点、水平拉时 r 与 F 共线，τ 恒为 0；力矩通道只在
    // 斜拉 / 提起 / 绕圈时参与。防掀翻靠上面的 limX 与下面的 SPR_TAU_G 力矩上限。
    // 惯量：圆用单位质量圆盘 I=r²/2，多边形用单位质量矩形 I=(hw²+hh²)/3。
    if(px!=null){
      var rx=px-h.mb.position.x,ry=py-h.mb.position.y;
      var tq=rx*fy-ry*fx;                      // 2D 叉积 r × F
      if(tq){
        var rw2=h.hw||0,rh2=h.hh||0;
        // 单位质量极转动惯量（与线速度那一路的 m=1 同口径）；退化成 0 就放弃旋转，别除零
        var Iu=h.rad?h.rad*h.rad/2:((rw2>0&&rh2>0)?(rw2*rw2+rh2*rh2)/3:0);
        if(Iu>1e-6){
          // 多边形的力矩上限（圆不夹）。取 min(hw,hh) 作力臂口径：方块躺在地上时，回复力矩 mg·(半宽)
          // 恒压住 τ 上限，拧不翻躺稳的方块。悬空/悬挂时没有地面回复力矩，锚点在侧面的方块会被拧到
          // 锚点朝上 —— 这是有意保留的：朝向应能跟着拉力变。
          // 与 limX 分工：limX 管拉力偶，这条管直接拧。GRAV=0 时同样放开（无重力就无所谓掀翻）。
          if(!h.rad&&GRAV>0){
            var tlim=SPR_TAU_G*GRAV*m*Math.min(rw2,rh2);
            if(tq>tlim)tq=tlim;else if(tq<-tlim)tq=-tlim;
          }
          // 单位换算与线速度完全一致：τ/I 是 rad/s²，×dt 得 rad/s，再 /60 折成 Matter 的 rad/「1/60 步」
          Matter.Body.setAngularVelocity(h.mb,h.mb.angularVelocity+tq/Iu*dt/60);
        }
      }
    }
    return;
  }
  h.vx+=fx/m*dt;h.vy+=fy/m*dt;
}
// 改自然长度必须让弹簧真的变长/变短，而不是只改一个数（否则画面不动、还因 cur≠len 被染成红/蓝）。
// 优先把没拴住的那一端沿轴挪到新的自然长度处；两端都拴住时几何由宿主决定，只能改 len
// （预紧力语义：长度不变，弹力变）。
// springRotate：旋转转的是端点而不是 B.th —— B.th 是 refreshSpringGeom 从 e0/e1 派生的只读量，
// 直接改它下一帧就被覆盖。语义：绕钉住的那一端转自由端；两端都自由则绕中心对称转；
// 两端都拴死时转不动（返回 false，调用方据此不显示手柄）。
export function springRotate(B,th){
  // 高中模式没有斜弹簧：旋转手柄无条件吸附到 90° 整数倍。不能复用 snapAngle90：它只在
  // ±SNAP_DEG(8°) 带内才吸，带外会保留任意斜角。
  /* 只有真弹簧受此约束：kind==='S' 里也包括轻绳（isRope = kind==='S' && E.rope），
   * 不加 !B.rope 会把轻绳也锁成只有四个方向。 */
  if(PHYS_MODE==='high'&&!B.rope)th=Math.round(th/(Math.PI/2))*(Math.PI/2);
  var a0=B.anc[0],a1=B.anc[1],h=B.cur;
  if(a0&&a1)return false;
  if(!a0&&!a1){
    var cx=(B.e0.x+B.e1.x)/2,cy=(B.e0.y+B.e1.y)/2,hh=h/2;
    B.e0.x=cx-Math.cos(th)*hh;B.e0.y=cy-Math.sin(th)*hh;
    B.e1.x=cx+Math.cos(th)*hh;B.e1.y=cy+Math.sin(th)*hh;
  }else if(a0){
    B.e1.x=B.e0.x+Math.cos(th)*h;B.e1.y=B.e0.y+Math.sin(th)*h;
  }else{
    B.e0.x=B.e1.x-Math.cos(th)*h;B.e0.y=B.e1.y-Math.sin(th)*h;
  }
  refreshSpringGeom(B);
  return true;
}
export function springSetLen(B,L){
  // 原长不设上限（弹簧原长没有物理上限），只保证 L>0。
  L=clamp(L,1,1e7);
  var old=B.len;B.len=L;
  var dx=B.e1.x-B.e0.x,dy=B.e1.y-B.e0.y,d=Math.hypot(dx,dy)||1e-6;
  var ux=dx/d,uy=dy/d;
  if(!B.anc[1]&&!B.anc[0]){
    // 两端都自由：绕中点对称伸缩，视觉上最自然
    var cx=(B.e0.x+B.e1.x)/2,cy=(B.e0.y+B.e1.y)/2;
    B.e0.x=cx-ux*L/2;B.e0.y=cy-uy*L/2;
    B.e1.x=cx+ux*L/2;B.e1.y=cy+uy*L/2;
  }else if(!B.anc[1]){
    B.e1.x=B.e0.x+ux*L;B.e1.y=B.e0.y+uy*L;
  }else if(!B.anc[0]){
    B.e0.x=B.e1.x-ux*L;B.e0.y=B.e1.y-uy*L;
  }
  refreshSpringGeom(B);
  if(B.rope)initRopeNodes(B);          // 绳长改变 → 链沿新端线重铺
  return old;
}
export function springCanRotate(B){
  // 铰链没有方向（长度 0、两锚点重合），不出现旋转手柄。
  if(B&&B.hinge)return false;
  // 弹簧只有至少一端自由才转得动（两端都拴住时几何由宿主决定）；
  // 方向锁弹簧永远显示旋转手柄：它拧的是整个装配体（springAssemblyRotate，含导轨朝向），不受此限制。
  return !!(B&&B.kind==='S'&&(B.dirLock||!(B.anc[0]&&B.anc[1])));
}
export function springMirror(B){
  // 轻绳 / 光滑铰链不参与碰撞，没有 Matter 薄板镜像（绳只传张力，铰链是销钉，都不挡路）。
  if(B&&(B.rope||B.hinge))return;
  // W（画出来的线）与弹簧的碰撞归 Matter 管（和 T 杆同一条规则），所以弹簧也要有一个 Matter
  // 镜像：一根静态薄板，每帧跟着 e0->e1 走。Matter 的薄板不能改长度，所以长度变化超过
  // SPR_MIRROR_TOL 才重建 —— 否则弹簧每「呼吸」一次就造一个新体。
  if(!MW)return;
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.cur)>SPR_MIRROR_TOL);
  if(B.mb&&!stale){
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th||0);
    springEndCaps(B);       /* 非 stale 早退路径也要摆端帽/测接触，否则压缩状态机永不运行 */
    return;
  }
  removeMatterBody(B);
  B.mb=Matter.Bodies.rectangle(B.x,B.y,Math.max(8,B.cur),8,
        {isStatic:true,friction:0.3,frictionStatic:0.6,restitution:0,slop:0.02,
         collisionFilter:{group:SPR_CGROUP}});
  B._mlen=B.cur;
  Matter.Composite.add(MW.wLayer,B.mb);
  springEndCaps(B);
}
/* 未锚定的自由端有一个横向端帽（static 薄板，垂直弹簧方向、宽 SPR_CAP_W、厚 SPR_CAP_T，从端点向外延伸），
 * 使物体撞到弹簧自由端时弹簧也会压缩并受力：物体对端帽的轴向压入量转成压缩量与回复力（见 springEndCaps）。
 * 已锚端没有端帽。生命周期：springMirror 每帧摆位/增删；removeMatterBody 里随宿主一起清。 */
export const SPR_CAP_W=40, SPR_CAP_T=10;
/* 物体在正交基 (u,n) 下的真实投影半宽（以质心为原点，遍历复合体全部 parts），返回 {u, n}。
 * 用于端帽（springEndCaps）的轴向 reach 与横向带判定。
 * 不用 (AABBw+AABBh)/4：那是被长边主导的平均半径，512×60 的横躺条带会算出 143px 假半径，
 * 在 136px 外就被判压在端帽上，弹簧隔空把物体推走。
 * 不用 mb.vertices：复合体的 mb.vertices 只等于 parts[0]，会漏掉其它 part。 */
export function projHalfExtent(mb,ux,uy){
  var ru=0,rn=0,ps=mb&&mb.parts&&mb.parts.length?mb.parts:[mb];
  for(var i=0;i<ps.length;i++){
    var p=ps[i];if(!p||!p.vertices)continue;
    var cx=p.position.x,cy=p.position.y;
    for(var k=0;k<p.vertices.length;k++){
      var vx=p.vertices[k].x-cx,vy=p.vertices[k].y-cy;
      var pu=vx*ux+vy*uy; pu=pu<0?-pu:pu; if(pu>ru)ru=pu;
      var pn=vx*(-uy)+vy*ux; pn=pn<0?-pn:pn; if(pn>rn)rn=pn;
    }
  }
  if(!ru&&!rn){  // 兜底：无顶点信息 ⇒ 退回 AABB 平均半径口径
    var bb=mb.bounds;
    ru=rn=(bb.max.x-bb.min.x+bb.max.y-bb.min.y)/4;
  }
  return {u:ru,n:rn};
}
export function springEndCaps(B){
  if(!B||B.rope||B.hinge)return;
  var _nA0=(B.anc&&B.anc[0]&&B.anc[0].B)?1:0,_nA1=(B.anc&&B.anc[1]&&B.anc[1].B)?1:0;
  if(_nA0+_nA1===2)return;                       // 两端都锚定 ⇒ 没有未锚端 ⇒ 没有端帽
  /* 端帽：设计原则是几何永不因压缩而移动。三条约束（改动前务必理解）：
   *
   * ① 端点基准恒为 B.e0/B.e1 本身，压缩量绝不回写端点。
   *    _capCmp 是纯视觉 + 纯力的状态量：视觉由 drawSpring 消费，力由本函数消费（f = ks·cmp，保守力 ⇒ 能弹回）。
   *    只要压缩量参与几何，判据基准就会随状态漂移形成正反馈：基准随 cmp 外移 ⇒ 物体越推越远、cmp 越涨，
   *    最终物体原地不动、永不弹开。
   *
   * ② 最近端归属：双端自由弹簧的两个端帽都看得见同一个物体，按物体中心到哪个自由端更近裁决归属，
   *    否则两端对同一物体互推，位置乱套、cmp 冻结。
   *
   * ③ 碰撞组隔离：物体一进入端帽带就放进 SPR_CGROUP（与弹簧镜像薄板同组 ⇒ Matter 窄相位跳过这一对）。
   *    否则物体先被镜像板（static、restitution:0）的非弹性碰撞撞停，动能被 Matter 吃掉，弹不回来。
   *
   * 判据阈值：轴向 reach = 真实投影半宽 ru + SPR_CAP_T/2、横向带 ±(SPR_CAP_W/2 + rn)；
   *   ru/rn 由 projHalfExtent 计算（不用 AABB 平均半径，原因见彼处）。 */
  var _len=(B.len||0);
  var _maxCmp=Math.max(0,_len-Math.max(8,_len*0.12));
  var _fe=[];
  if(!_nA0)_fe.push({i:0,e:B.e0,o:B.e1});
  if(!_nA1)_fe.push({i:1,e:B.e1,o:B.e0});
  var _hits=[],_maxPen=0,_hitEnd=null;
  for(var j=0;j<bodies.length;j++){
    var b=bodies[j];
    if(b.dead||!b.mb||b.mb.isStatic||b===B)continue;
    if(B.anc[0]&&B.anc[0].B===b)continue;
    if(B.anc[1]&&B.anc[1].B===b)continue;
    var _bf=null,_bd=1e18;
    for(var fi=0;fi<_fe.length;fi++){
      var _f=_fe[fi];
      var _adx=b.mb.position.x-_f.e.x,_ady=b.mb.position.y-_f.e.y;
      var _dd=_adx*_adx+_ady*_ady;
      if(_dd<_bd){_bd=_dd;_bf=_f;}
    }
    if(!_bf)continue;
    var _dxo=_bf.o.x-_bf.e.x,_dyo=_bf.o.y-_bf.e.y,_dl=Math.hypot(_dxo,_dyo)||1e-6;
    var ux=_dxo/_dl,uy=_dyo/_dl;                 // 向内（指向另一端）
    var oxw=-ux,oyw=-uy;                         // 向外（远离弹簧体）
    var _ph=projHalfExtent(b.mb,ux,uy);
    var rx=b.mb.position.x-_bf.e.x, ry=b.mb.position.y-_bf.e.y;
    var ptOut=-(rx*ux+ry*uy), ptNorm=rx*(-uy)+ry*ux;
    if(Math.abs(ptNorm)>SPR_CAP_W/2+_ph.n)continue;   // 法向超出横档宽
    var pReach=_ph.u+SPR_CAP_T/2;
    var penRaw=pReach-ptOut;
    if(penRaw<=0)continue;
    var pen=penRaw>_maxCmp?_maxCmp:penRaw;
    _hits.push({b:b,pen:pen,raw:penRaw,ox:oxw,oy:oyw});
    if(pen>_maxPen)_maxPen=pen;
    _hitEnd=_bf.i;
  }
  /* 压缩状态量：接触帧瞬间跟上涨（可比上一帧小 ⇒ 物体回退时视觉跟着回），
   * 无接触帧每帧衰减 18% ⇒ 「压扁 → 弹开 → 弹簧自己回弹恢复」三段都看得见。 */
  if(_hits.length){
    var _c=Math.max(_maxPen,(B._capCmp||0)*0.94);
    if(_c>_maxCmp)_c=_maxCmp;
    B._capCmp=_c;B._capEIdx=_hitEnd;
  }else if(B._capCmp){
    B._capCmp*=0.82;
    if(B._capCmp<0.05){B._capCmp=0;B._capEIdx=null;}
  }
  var _capCmp=B._capCmp||0;
  for(var h=0;h<_hits.length;h++){
    var H=_hits[h],hb=H.b;
    if(!hb._capG){
      setCGroup(hb.mb,SPR_CGROUP);
      hb._capG=true;(B._capGL||(B._capGL=[])).push(hb);
    }
    /* ① 保守回复力 f = ks·cmp 沿向外 —— 物体减速到 0 后被原速弹回（能量不丢） */
    var _fCap=(B.ks||SPR_KS_DEF)*_capCmp;
    if(_fCap>0){
      var _v=hb.mb.velocity||{x:0,y:0};
      var _dv=_fCap/(hb.mb.mass||1)*(1/60)*(1/60);   // 与产品力律同口径 dv=f/m·dt/60
      Matter.Body.setVelocity(hb.mb,{x:_v.x+H.ox*_dv,y:_v.y+H.oy*_dv});
    }
    /* ② 防穿透兜底：压过最小工作长度才把超出部分推回（不做全量硬挡 ⇒ 不会「急停」） */
    if(H.raw>_maxCmp){
      var _ov=H.raw-_maxCmp+0.5;
      Matter.Body.setPosition(hb.mb,{x:hb.mb.position.x+H.ox*_ov,y:hb.mb.position.y+H.oy*_ov});
    }
  }
  if(!_hits.length&&B._capGL&&B._capGL.length){
    for(var _gi=0;_gi<B._capGL.length;_gi++){
      var _gb=B._capGL[_gi];
      if(_gb&&_gb.mb){setCGroup(_gb.mb,0);_gb._capG=false;}
    }
    B._capGL.length=0;
  }
}
// 把「弹簧 ↔ 它拴住的宿主」这一对放进同一个负 group，让它们互不碰撞。
// 复合体的 collisionFilter 要连 parts 一起设（Matter 的窄相位看的是 part）。
export function setCGroup(body,g){
  if(!body)return;
  var i,pp;
  if(!body.collisionFilter)body.collisionFilter={category:1,mask:0xFFFFFFFF,group:0};
  body.collisionFilter.group=g;
  if(body.parts&&body.parts.length>1){
    for(i=1;i<body.parts.length;i++){          // parts[0] 是父体自身
      pp=body.parts[i];
      if(!pp.collisionFilter)pp.collisionFilter={category:1,mask:0xFFFFFFFF,group:0};
      pp.collisionFilter.group=g;
    }
  }
}
// 每帧重算一次：先清掉上一帧被打过标记的宿主，再按当前锚关系重新打标。
// 「先全清再重设」而不是在锚定/解除时单独维护，是因为锚关系有三条会变的路径
// （springTryAnchor / springSyncEnds 里宿主消失 / dissolveSpring），漏一条就会留下一个
// 再也收不回来的 -2。
export function springSyncGroups(){
  var i,e,B,S;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B._sprG&&B.mb){setCGroup(B.mb,0);B._sprG=false;}
    if(B._hinG&&B.mb){setCGroup(B.mb,0);B._hinG=false;}   // 铰链组标记也要逐帧重算
  }
  for(i=0;i<bodies.length;i++){
    S=bodies[i];
    if(S.kind!=='S'||S.dead)continue;
    // 铰链没有 Matter 镜像板，把它两端宿主塞进 −2 毫无用处，反而让两个被铰住的普通物体互相穿过（重叠穿模）。
    // 只有弹簧需要 −2（豁免自家镜像板），铰链跳过；杆参与的铰链由下面的 HINGE_CGROUP 分支处理。
    if(!S.hinge){
      for(e=0;e<2;e++){
        var a=S.anc[e];
        if(!a||!a.B||a.B.dead||!a.B.mb)continue;
        setCGroup(a.B.mb,SPR_CGROUP);a.B._sprG=true;
      }
    }
    // 至少一端是杆的铰链：宿主放进独立负组 −3（不与弹簧的 −2 混，否则「弹簧宿主搁在铰链宿主上」会意外穿透）。
    // 两个普通物体被铰住时必须保持碰撞（否则绕销转动的块会转进固定块里、完全重叠）。
    if(S.hinge){
      var h0=S.anc[0],h1=S.anc[1];
      var rodIn=(h0&&h0.B&&h0.B.kind==='T')||(h1&&h1.B&&h1.B.kind==='T');
      if(rodIn){
        for(e=0;e<2;e++){
          var ha=S.anc[e];
          if(!ha||!ha.B||ha.B.dead||!ha.B.mb)continue;
          setCGroup(ha.B.mb,HINGE_CGROUP);ha.B._hinG=true;
        }
      }
    }
  }
}
// 弹簧阻尼系数（参数面板可调到 0 = 无阻尼），缺省回落到 SPR_DAMP。
// 阻尼随 √ks 放大，使阻尼比 ζ = D/(2√(km)) 不随 k 漂（「k 越大越干脆」而不是「越像乱抖」）；
// ks ≤ 默认值时 gain=1。
//
// 高中模式把面板值解释成阻尼比 ζ（无量纲的能量耗散速率）：
//     ζ = damp / SPR_HIGH_ZETA_DIV      （面板 0..30 常用段 → ζ 0..3，默认 7.1 → ζ=0.71）
//     D = 2·ζ·√(keff·μ)                 （μ = 两宿主的折合质量 m0·m1/(m0+m1)）
//   Rayleigh 阻尼 F = −D·v_rel，耗散功率 P = D·v_rel²，所以滑块就是「相对临界值的耗散速率」。
//   不要在高中模式直接返回 0：滑块会完全失效，只剩 ks 影响停下的快慢，看起来像阻尼在调劲度。
//   默认 ζ=0.71：竖直弹簧拉伸后约 4% 过冲、一个来回就停；水平弹簧被撞后两端相对速度指数衰减、快速共速。
//   ζ→0 = 完全无耗散的理想简谐振荡。
//   μ 取两端真实可动体的折合质量；两端都没有质量（铁砧+自由端）时归一到 1kg，避免 μ=0 让阻尼消失。
export const SPR_HIGH_ZETA_DIV=10;
export function springRedMass(h0,h1){
  var m0=(h0&&h0.mb&&!h0.mb.isStatic)?(h0.mb.mass||0):0;
  var m1=(h1&&h1.mb&&!h1.mb.isStatic)?(h1.mb.mass||0):0;
  if(m0>0&&m1>0)return m0*m1/(m0+m1);
  if(m0>0)return m0;
  if(m1>0)return m1;
  return 1;
}
export function springDamp(B,h0,h1){
  var d=(B&&B.damp!=null)?B.damp:SPR_DAMP;
  if(PHYS_MODE!=='high')return d*springDampGain(springKEff(B?B.ks:SPR_KS_DEF));
  var z=d/SPR_HIGH_ZETA_DIV;
  var k=springKEff(B?B.ks:SPR_KS_DEF);
  return 2*z*Math.sqrt(k*springRedMass(h0,h1));
}
export function stepSprings(dt){
  springKBook();         // 宿主刚度账本（超预算时同比例缩水，见 springKBook）
  springSyncLocks();     // 方向锁宿主冻结自转（清角速度 + 打 _lockRot 标志，供 springForceOn 用）
  rodSyncLocks();        // 杆锚定宿主角度锁死（同 _lockRot 通道）
  rodHingeTorque();      // 复摆重力力矩（锚定物体绕固定点摆动）
  rodSyncNoCollide();    // 铰链两物体互不碰撞（消除边界抖动）
  springSyncGroups();
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='S'||B.dead)continue;
    springSyncEnds(B);
    var freeEndOnly=false;               // 只有一端拴住 = 自由端无载荷 → 内力恒为 0
    if(B.dirLock)springRailFollow(B);    // 垂直方向导轨跟随（整体一起平移）
    // 放松态（springRailRelaxed）里必须跳过导向力：springGuideForce 用横向小弹簧把偏离导轨的锚点拽回，
    // 而水平导轨的法向是竖直方向，跑它 = 用 keff*off 的竖直力继续把物体吊在半空。
    // 跳过后锚点与端点的偏移才允许长期存在（连接点可变动）。
    if(B.dirLock&&!springRailRelaxed(B))springGuideForce(B,dt); // 方向锁的垂直导向力（轴向力在下面统一算）
    var dx=B.e1.x-B.e0.x,dy=B.e1.y-B.e0.y,d=Math.hypot(dx,dy)||1e-6;
    var ux=dx/d,uy=dy/d;
    var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
    // 两端都拴住时没有自由端，跟踪基准立刻作废 —— 否则「两端拴住 -> 放开一端」时会拿过期基准补位移，
    // 自由端瞬移一大截。
    if(h0&&h1)B._freeTk=null;
    // 只有一端拴住时，轻质（无质量）弹簧的自由端不能钉在世界坐标里（否则宿主走到哪弹簧就被拉长到哪，
    // 并持续施加虚假拉力），必须整体跟着宿主走。
    // 不要每帧按方向+原长重算自由端位置：那会把自由端钉在轴上只能转不能挪，而拖自由端去拴第二个物体
    // 正靠它挪动，第二端就再也拴不上。
    // 实现：记下上一帧的「宿主位置 + 自由端位置」；只有自由端没被外力移动过时才把宿主位移补给自由端。
    // 用户（或手柄）动了自由端 -> 本帧不补、重记基准，于是拖拽永远赢。方向、长度都不被改写。
    /* 光滑铰链不走自由端跟随：它由 springSyncEnds 的「未锚端 = 已锚端」直接对齐（销是一个点）。
     * 在这里再补一次质心平移会与那条对齐互相追打，每帧往返抖动。 */
    if(!B.dirLock&&(h0||h1)&&!(h0&&h1)&&!B.hinge){
      var hostF=h0||h1,fEnd=h0?B.e1:B.e0,tk=B._freeTk;
      // 正在被拖的弹簧：几何归指针管，这里不碰位置。否则拖弹簧时 springMoveRig 会连宿主一起搬，宿主在半空
      // 按重力下落，自由端在指针停住的几帧被判为「用户没动它」而跟着下坠，松手时端点已飘出 SPR_PAD(15px)，
      // 第二端锚不上。拖动期间只刷新基准，让松手后的第一帧从正确位置起算。
      var dragging=(grab.kind==='body'&&grab.obj===B);
      if(dragging){
        if(tk){tk.hx=hostF.x;tk.hy=hostF.y;tk.ex=fEnd.x;tk.ey=fEnd.y;}
      }else if(!tk||tk.host!==hostF){
        tk=B._freeTk={host:hostF,hx:hostF.x,hy:hostF.y,ex:fEnd.x,ey:fEnd.y};
      }else{
        var fmoved=(Math.abs(fEnd.x-tk.ex)>1e-3||Math.abs(fEnd.y-tk.ey)>1e-3);
        if(!fmoved){fEnd.x+=hostF.x-tk.hx;fEnd.y+=hostF.y-tk.hy;}
        tk.hx=hostF.x;tk.hy=hostF.y;tk.ex=fEnd.x;tk.ey=fEnd.y;
      }
      refreshSpringGeom(B);
      dx=B.e1.x-B.e0.x;dy=B.e1.y-B.e0.y;d=Math.hypot(dx,dy)||1e-6;
      if(d>1e-6){ux=dx/d;uy=dy/d;}
      freeEndOnly=true;
    }
    // 轻绳 / 光滑铰链走各自的约束求解（位置 + 冲量投影），与弹簧力律完全分开。
    // continue 同时跳过本函数尾部的 springMirror(B) —— 两者都没有 Matter 镜像。
    if(B.rope){
      if(!B.nodes)initRopeNodes(B);    // 旧绳/加载恢复时自动链化
      /* 绳锚点不逐帧刷新：锚点钉在宿主材料点上随宿主转，固定点永不滑动（高中绳与大学绳一致）。
       * 见 springAnchorOffset。 */
      ropeVerletStep(B,dt);
      ropeSolve(B,dt,h0,h1);continue;
    }
    if(B.hinge){hingeSolve(B,dt,h0,h1);continue;}
    // 弹簧有最小工作长度（线圈不可重叠 = 压到底相当于直接碰撞）。三道保险防止「反向压缩」：
    // ① 稳定轴 B._ax/_ay：端点近重合时 (dx,dy)≈0，u 漂移；端点一旦交叉，u 反向，斥力变成
    //    把两端往错误方向推。用上一帧稳定方向代替，斥力始终沿正确方向把两端推开。
    // ② 交叉检测（有向投影 proj<0 = 端点已越过对方）：一旦越过，力按 minLen 算（最大斥力），
    //    不让 d 继续涨回去使 ks*(d-len) 翻正成吸引力 —— 否则交叉后两端分开到 d>len 时，
    //    力变拉力把两端往错误方向越拉越远。
    // ③ dEff=max(d,minLen)：压到底后力不再随 d→0 发散，固定在触底斥力，相当于刚性挡板。
    var minLen=Math.max(8,B.len*0.12);
    if(B._ax==null){B._ax=ux;B._ay=uy;}
    var projG=dx*B._ax+dy*B._ay;          // 有向投影：>0 正常，<0 已交叉
    var crossedG=projG<0;
    if(!crossedG&&d>=minLen){B._ax=ux;B._ay=uy;}  // 正常时更新稳定轴
    if(crossedG||d<minLen){ux=B._ax;uy=B._ay;}    // 触底/交叉时用稳定轴
    var dEff=crossedG?minLen:Math.max(d,minLen);
    // v_rel > 0 表示两端在互相远离。Rayleigh 阻尼：F_damp = -D*(dd/dt) 沿 ∂d/∂e —— h1 受 -D*vrel*u，
    // 折进 f 就是 +DAMP*vrel。不要写成 f=ks*(d-len)-DAMP*vrel：那是反阻尼（分离越快回复力越小），振幅指数增长；
    // Matter 的 frictionAir 会部分掩盖它，泄能通道弱时（球在地上弹、弹簧长、ks 大）就越弹越大。
    var vrel=springHostVel(h1,ux,uy, h1?B.e1.x:null,h1?B.e1.y:null)
            -springHostVel(h0,ux,uy, h0?B.e0.x:null,h0?B.e0.y:null);
    // 力上限随 ks 换算（见 SPR_FMAX 注释），不要写死 24000：那只是 ks=默认值那一档，写死会让 k ≳ 3600 的
    // 弹簧变成恒力机。keff 是被稳定墙截断后的刚度（见 SPR_K_MAX）：k 越大越硬仍成立，超过上限后按本机最硬的
    // 可稳定弹簧执行。share 是宿主预算的分摊比例：同一宿主挂 n 根弹簧时分 SPR_K_MAX 这一份，刚度封顶而不是叠加到爆。
    var keff=springKEff(B.ks)*Math.min(springKShare(h0),springKShare(h1));
    var fmax=springFMax(keff);
    var f=clamp(keff*(dEff-B.len)+springDamp(B,h0,h1)*vrel,-fmax,fmax);
    // 自由端无载荷 → 内力必须为 0。否则一端拴住的弹簧会靠阻尼项 D·v_rel 对宿主施加沿轴向的虚假阻力
    // （宿主下落时 v_rel≠0），表现为弹簧拖住了物体。
    if(freeEndOnly)f=0;
    // 力的方向：u 是 e0->e1。拉长（f>0）时 e1 端被拽向 e0（沿 -u），e0 端沿 +u；符号写反会让形变量指数发散。
    // 存下两个宿主施力前的轴向速度 B._sv0/_sv1：触底反射必须作用在本帧弹力施加之前的轴向速度上（推导见下方触底块）。
    // 此刻 ux,uy 已替换成触底/交叉时用的稳定轴 B._ax/_ay，与随后施力的方向一致。
    B._sv0=(h0&&h0.mb&&!h0.mb.isStatic&&h0.kind!=='S'&&!h0.dead)?(h0.mb.velocity.x*ux+h0.mb.velocity.y*uy):null;
    B._sv1=(h1&&h1.mb&&!h1.mb.isStatic&&h1.kind!=='S'&&!h1.dead)?(h1.mb.velocity.x*ux+h1.mb.velocity.y*uy):null;
    if(f){
      // 力作用在锚点上（e0/e1 就是锚的世界坐标），宿主才会绕挂点转
      springForceOn(h0, f*ux, f*uy,dt, h0?B.e0.x:null, h0?B.e0.y:null,keff);
      springForceOn(h1,-f*ux,-f*uy,dt, h1?B.e1.x:null, h1?B.e1.y:null,keff);
    }
    // 触底的位置+速度约束：力通道有限幅，重物/高速冲击时一帧刹不住（m=5、v=5000px/s 时一帧位移 83px，
    // 远超 minLen 20px），检测到触底时端点早已穿透，所以要像物理引擎处理穿透一样：
    // ① 位置修正：沿稳定轴把两端推回到 d=minLen（穿透量 = minLen - projG，交叉时更大），质量加权分配（重的少动）。
    //    setPosition 的第三参必须省略：内嵌的 Matter 0.20 里 setPosition(e,t,n) 的 n 为真时 velocity = delta
    //    （把位移当速度），缺省时 positionPrev += delta（速度原样保留）。传 true 会让每次触底都凭空把速度
    //    赋值成 penG，越弹越快（GRAV=0/damp=0 隔离台实测能量涨到 94 倍）。
    // ② 速度清零：清掉接近方向的线速度分量 = 非弹性碰撞响应。角速度分量由力通道后续帧处理。
    // 判据与响应必须同源，都用 Matter 本体速度（px/步）：JS 侧的 vrel 是 stepMatter 用位置差分写回的派生量，
    //   会被本块上一帧的位置修正污染（实测幅值差 1.4 倍，甚至符号相反），把「该刹停」算成「该反推」，
    //   每弹一次多给一点能量。
    var vrelM=0;
    if(h0&&h0.mb)vrelM-=(h0.mb.velocity.x*ux+h0.mb.velocity.y*uy);
    if(h1&&h1.mb)vrelM+=(h1.mb.velocity.x*ux+h1.mb.velocity.y*uy);
    if(!freeEndOnly&&(crossedG||d<=minLen)&&vrelM<0){
      var h0f=h0&&h0.mb&&!h0.mb.isStatic&&h0.kind!=='S'&&!h0.dead;
      var h1f=h1&&h1.mb&&!h1.mb.isStatic&&h1.kind!=='S'&&!h1.dead;
      var penG=minLen-projG;                  // projG<0(交叉)时 penG>minLen，正确加大修正量
      if(penG>0.01){
        if(h0f&&h1f){
          var m0g=(h0.mass&&h0.mass>0)?h0.mass:1, m1g=(h1.mass&&h1.mass>0)?h1.mass:1;
          var s0g=m1g/(m0g+m1g), s1g=m0g/(m0g+m1g);
          Matter.Body.setPosition(h0.mb,{x:h0.mb.position.x-penG*s0g*ux,y:h0.mb.position.y-penG*s0g*uy});
          Matter.Body.setPosition(h1.mb,{x:h1.mb.position.x+penG*s1g*ux,y:h1.mb.position.y+penG*s1g*uy});
        }else if(h0f){
          Matter.Body.setPosition(h0.mb,{x:h0.mb.position.x-penG*ux,y:h0.mb.position.y-penG*uy});
        }else if(h1f){
          Matter.Body.setPosition(h1.mb,{x:h1.mb.position.x+penG*ux,y:h1.mb.position.y+penG*uy});
        }
      }
      // 速度响应也走 Matter 口径（同一帧、同一来源、同一单位）。只在 v0g>0 时处理的符号判据也钉在 Matter 上：
      //   反射过一次后本体轴向速度已变号，下一帧不会重复反射（用 JS 派生量会重复施加）。
      // 反射的目标速度取本帧弹力施加之前的轴向速度（B._sv0），而不是施力之后的本体速度：
      //   frame() 的次序是「Matter 推进位置 → stepSprings 施力 → 触底块」，触底判据成立时位置已推进整整一帧，
      //   物体其实只有一小段（≈ minLen/|v| 帧）贴住挡板，弹力却按整帧结算了一份固定冲量 f=ks(minLen−len)。
      //   把它算进反射等于每弹一次多扣一份冲量，振荡能量会一直被吃到刚好碰不到挡板（½ks(minLen−len)²）为止。
      //   这不是能量维护：没有目标能量、没有增益系数，只是撤掉一份不该参与碰撞响应的冲量；E<1 时仍按 SPR_STOP_E 衰减。
      // 响应方式是两端各自反号绝对轴向速度（撞墙反射），不做「两端之间 1D 碰撞」。代价：两端都是自由体时
      //   整体动量反号（Px' = −E·Px），这是有意保留的手感。一端是铁砧/静止体时就是撞墙反射。
      if(h0f){
        var mv0g=h0.mb.velocity||{x:0,y:0}, v0g=mv0g.x*ux+mv0g.y*uy;
        var v0p=(B._sv0==null)?v0g:B._sv0;              // 施力前的轴向速度
        if(v0g>0){
          var dvg=-SPR_STOP_E*v0p-v0g;                  // 目标轴向速度 = −E·(施力前速度)
          Matter.Body.setVelocity(h0.mb,{x:mv0g.x+dvg*ux,y:mv0g.y+dvg*uy});
          Matter.Sleeping.set(h0.mb,false);
        }
      }
      if(h1f){
        var mv1g=h1.mb.velocity||{x:0,y:0}, v1g=mv1g.x*ux+mv1g.y*uy;
        var v1p=(B._sv1==null)?v1g:B._sv1;              // 施力前的轴向速度（同 h0）
        if(v1g<0){
          var dvg1=-SPR_STOP_E*v1p-v1g;
          Matter.Body.setVelocity(h1.mb,{x:mv1g.x+dvg1*ux,y:mv1g.y+dvg1*uy});
          Matter.Sleeping.set(h1.mb,false);
        }
      }
      springSyncEnds(B);                       // 宿主已移动，端点/几何重新计算
    }
    springMirror(B);
  }
  /* 全场收口，必须是本函数最后一句：stepSprings 里每条绳按 bodies 顺序各解一次，后解的绳会把共享宿主拉出去
   * （拖绳2时绳1先解到绳长，绳2 后解又把宿主拉出约 24px，后写者赢 ⇒ 绳1 看起来变长/脱钩）。
   * 所以全部绳解完之后，最后再执行一次「被铁砧端钉住的宿主 = 绳长」（纯径向、无上限、幂等）；
   * 绳只拉不推 ⇒ 松弛态不碰，与 ropeSolve 同语义。 */
  springPinHostsToOtherAnchors(null,null);
}
export function springTryAnchor(B){
  // 只有两端端点处与其他物体发生接触才固定，所以判定点就是两个端点本身。
  for(var i=0;i<2;i++){
    if(B.anc[i])continue;                        // 已经拴住的保持原样（不抢不换）
    var e=springEnd(B,i),bd=SPR_PAD,hit=null;
    // 一根连接件的两头不许拴在同一个宿主上：铰链构造时 e0≡e1（len 恒 0），逐端扫描时两端会落在同一宿主上
    //   且都满足 SPR_PAD，一次就把 anc[0]、anc[1] 都记成它，之后再也吸不上别的物体。
    //   对弹簧/绳同样成立：两端拴在同一刚体上，内力自成闭环、对外恒为零。
    var other=((i===0)?B.anc[1]:B.anc[0]);
    for(var j=0;j<bodies.length;j++){
      var h=bodies[j];
      if(h===B||h.dead)continue;
      if(grab.kind==='body'&&grab.obj===h)continue;   // 正在被拖的东西不算「固定物」
      if(other&&other.B===h)continue;                 // 另一头已拴在它身上 ⇒ 不能重复占
      // 铰链不能吸到传送带上：传送带是钉死的 static 机器，约束推不动它（inverseMass=0，只搬另一端），
      // 铰链会退化成把物体钉在带面上的桩。从候选里直接剔除，比事后解绑干净（事后解绑会吸上去又弹开）。
      if(B.hinge&&h.belt)continue;
      // 铰链也不能吸到轻绳上：轻绳是无质量幽灵（conSide 里 kind==='S' 直接 null，约束推不动它），
      // 销钉会钉在一条可被随便拽走的线上。绳子自己落点吸附时也不许吸到绳/铰链上（同为幽灵互吸）。
      if(B.hinge&&h.rope)continue;
      if(B.rope&&(h.rope||h.hinge))continue;
      // 与 springTryAnchorByHost 里那条同款（同一语义的两个入口）：本端已通过铰链连着候选宿主 ⇒
      // 不许再直接锚（过约束互推）。
      var hin2=false;
      for(var hk=0;hk<bodies.length;hk++){
        var H2=bodies[hk];
        if(H2===B||H2.dead||H2.kind!=='S'||!H2.hinge||!H2.anc)continue;
        var r0=H2.anc[0],r1=H2.anc[1];
        if(r0&&r1&&((r0.B===B&&r1.B===h)||(r0.B===h&&r1.B===B))){hin2=true;break;}
      }
      if(hin2)continue;
      var dd=distToHost(h,e.x,e.y);
      if(dd<bd){bd=dd;hit=h;}
      /* 铰链端进入物体内部也视为命中（杆有 rodTryAnchor 的内部命中分支，弹簧/铰链这一族原本没有）：
       * 否则拖进物体内部时不吸附、停在内部（视觉上像吸在质心）。落点由下面 B.hinge 分支收到角/表面点。 */
      if(B.hinge&&dd>=bd){
        var _dcIn2=Math.hypot(e.x-h.x,e.y-h.y);
        var _rIn2=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
        if(_dcIn2<_rIn2){bd=-1;hit=h;}          // 内部 ⇒ 命中（落点由 B.hinge 分支收到表面）
      }
    }
    if(hit){
      // SPR_PAD=15 是为了手感（不必像素级对齐），但落点必须收到宿主表面上，否则画面上「没碰到却已经粘住」。
      // 先把端点吸到最近的表面点（hostClosestPoint），再记偏移。
      /* 吸附点 = 接触点（hostClosestPoint 优先）；边中点磁吸不抢占弹簧/绳/铰链的落点（否则会强制回到中点、
       * 反复位移），中点标记仍显示。 */
      /* 铰链（S+hinge）⇒ 角优先（够得着就吸角），否则最近表面点，不用边中点；
       * 普通弹簧/绳 ⇒ 表面点优先、中点次之。 */
      var q=null;
      if(B.hinge){
        /* 铰链的落点一律收到物体表面（角优先、否则最近表面点），不允许停在内部，否则等于吸在质心。 */
        var _cornerQ=hostCornerSnapPoint(hit,e.x,e.y);
        var _qs=_cornerQ||hostClosestPoint(hit,e.x,e.y);
        q=_qs||{x:e.x,y:e.y};
      }else{
        q=hostClosestPoint(hit,e.x,e.y)||hostMidSnapPoint(hit,e.x,e.y);
      }
      // 铰链的锚点必须落在宿主的碰撞面上（两锚点重合 ⇒ 两碰撞体相切而非互埋，见 hingeSurfacePoint 注释）。
      // 弹簧/轻绳不动。
      /* 这一步外推不能省（角点也一样），否则两体互埋 ⇒ 抖动。角点的处理在 hingeSurfacePoint 内部。 */
      if(q&&B.hinge)q=hingeSurfacePoint(hit,q);
      if(q){e.x=q.x;e.y=q.y;}
      B.anc[i]={B:hit};springAnchorOffset(B,i);
      // 铰链两端都锚上的那一刻 = 折角基准（限位从此偏差量起算）
      if(B.hinge&&B.anc[0]&&B.anc[1])hingeCaptureFold(B);
      // 自由端的跟踪基准必须记在锚定这一刻：若留给 stepSprings 的第一帧去建，「锚定 -> 第一帧」之间宿主的
      // 位移会被整段丢掉。在这里建，基准就是锚定瞬间的真实位姿，此后宿主走多少补多少。
      var oth=1-i;
      if(!B.anc[oth]){
        var fe=springEnd(B,oth);
        B._freeTk={host:hit,hx:hit.x,hy:hit.y,ex:fe.x,ey:fe.y};
      }
    }
  }
}
// 反向锚定：释放一个物体时，扫场上所有弹簧的未锚定端点，若该物体在端点 SPR_PAD 范围内，就把那一端拴到该物体上。
// 与 springTryAnchor 对称：后者是「拖弹簧释放 → 找物体」，这里是「拖物体释放 → 找弹簧」。
export function springTryAnchorByHost(host){
  if(!host||host.dead)return;
  // 松手的是杆 → 先试它自己两端能不能连上（调用点都在 pointerup 里，挂在这里等于松手即尝试连接）。
  // 杆不走 springTryAnchor：那条路会维护 _freeTk，而杆没有自由端跟进的语义。
  if(host.kind==='T')rodTryAnchor(host);
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    // 杆也接受「物体拖到它端点旁」的反向连接（与弹簧同构）
    if((S.kind!=='S'&&S.kind!=='T')||S.dead||S===host||!S.anc)continue;
    for(var i=0;i<2;i++){
      if(S.anc[i])continue;
      // 与 springTryAnchor 里那两条同款（同一语义的两个入口，必须一起改）：
      //   ① 另一头已拴在 host 上 ⇒ 不许重复占；② 铰链不许吸到传送带。
      var othR=((i===0)?S.anc[1]:S.anc[0]);
      if(othR&&othR.B===host)continue;
      if(S.hinge&&host.belt)continue;
      // 与 springTryAnchor 同款：铰链不吸绳；绳不吸绳/铰链（幽灵互吸）。
      if(S.hinge&&host.rope)continue;
      if(S.rope&&(host.rope||host.hinge))continue;
      // 这个自由端若已通过铰链连着 host（某铰链一端吸本器件、另一端吸 host），就不许再直接锚到 host：
      //   铰链（两锚点钉死重合）+ 直接锚定 = 同一物理点两重约束，过约束互推 ⇒ 装配体爬行，双击解除也会落空。
      var hingedToHost=false;
      for(var hj=0;hj<bodies.length;hj++){
        var HH=bodies[hj];
        if(HH===S||HH.dead||HH.kind!=='S'||!HH.hinge||!HH.anc)continue;
        var p0=HH.anc[0],p1=HH.anc[1];
        if(p0&&p1&&((p0.B===S&&p1.B===host)||(p0.B===host&&p1.B===S))){hingedToHost=true;break;}
      }
      if(hingedToHost)continue;
      var e=anyEndPoint(S,i);
      if(!e)continue;
      var dd=distToHost(host,e.x,e.y);
      if(dd<SPR_PAD){
        // 与 springTryAnchor 同款（同一语义的两个入口，漏一处就只一半生效）
        var q=hostClosestPoint(host,e.x,e.y)||hostMidSnapPoint(host,e.x,e.y);
        // 入口 2 也要把铰链锚点推到碰撞面上（与 springTryAnchor 同款）
        if(q&&S.hinge)q=hingeSurfacePoint(host,q);
        if(q){e.x=q.x;e.y=q.y;}
        if(S.kind==='T'){                       // 杆：端点得靠 rodPlaceEnds 真正搬过去（见 rodTryAnchor）
          var o=rodEndWorld(S,1-i),qx=q?q.x:e.x,qy=q?q.y:e.y;
          rodPlaceEnds(S, i?o.x:qx, i?o.y:qy, i?qx:o.x, i?qy:o.y);
        }
        S.anc[i]={B:host};springAnchorOffset(S,i);
        // 铰链两端都锚上的那一刻 = 折角基准（同 springTryAnchor）
        if(S.hinge&&S.anc[0]&&S.anc[1])hingeCaptureFold(S);
        var oth=1-i;
        if(S.kind==='S'&&!S.anc[oth]){
          var fe=springEnd(S,oth);
          S._freeTk={host:host,hx:host.x,hy:host.y,ex:fe.x,ey:fe.y};
        }
      }
    }
  }
}
// 双击弹簧与物体的连接处可断联：点击位置落在已锚定端点附近（SPR_PAD 范围）则解除该端锚定（S.anc[i]=null）。
// 扫完全场，把落点 SPR_PAD 内的已锚端点全部解开：铰链两端恒重合（len=0），一个连接点上可能叠着好几条锚
// （铰链两端 + 杆端），只解第一条看起来就像没解开。
// 返回 true 表示已处理（调用方应 return，不走默认双击动作）。
export function springDisconnectAtPoint(x,y){
  var hitAny=false;
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    // 杆也进这一族（点端点附近 = 断开那一端）
    if((S.kind!=='S'&&S.kind!=='T')||S.dead||!S.anc)continue;
    for(var i=0;i<2;i++){
      if(!S.anc[i])continue;
      var e=anyEndPoint(S,i);
      if(e&&Math.hypot(e.x-x,e.y-y)<SPR_PAD){
        S.anc[i]=null;
        /* 解除冷却：否则松手时 pointerup 统一调用的 rodTryAnchor 自动吸附会把刚解除的端立刻重新吸回。 */
        S._snapCool=performance.now()+800;
        if(!S.anc[0]&&!S.anc[1])S._freeTk=null;
        hitAny=true;
      }
    }
  }
  return hitAny;
}
export function springRig(B,out){
  // 弹簧 + 它拴住的所有宿主（装配体）。弹簧串弹簧暂不递归，避免意外的连锁拖动。
  out=out||{S:[],B:[]};
  if(out.S.indexOf(B)>=0)return out;
  out.S.push(B);
  for(var i=0;i<2;i++){
    var a=B.anc[i];
    if(!a||!a.B||a.B.dead||a.B.kind==='S')continue;
    if(out.B.indexOf(a.B)<0)out.B.push(a.B);
  }
  return out;
}
export function springMoveRig(B,dx,dy){
  var rig=springRig(B),i,e;
  /* 先搬宿主，再算端点：springSyncEnds 对已锚端用 springAnchoredWorld 按宿主重算，若宿主还没搬，
   * 会把端点刚加的 (dx,dy) 覆盖回去，每子步留下「端点落后宿主一个 dx」的残差（铰链 len=0 时放大成明显滞后）。
   * 最终位置都是整体平移 (dx,dy)；跳过的仍是铁砧（static / 已固定）。 */
  for(i=0;i<rig.B.length;i++){
    var h=rig.B[i];
    if(h.dead)continue;
    if(h.mb&&h.mb.isStatic)continue;           // 铁砧不动
    h.x+=dx;h.y+=dy;
    // W 的位姿由 Matter 掌管：只改 h.x/h.y 会在下一帧被 stepMatter 的位姿回写覆盖，所以这里
    // 必须同步把 Matter 体搬过去（并清掉它的速度，避免跟着滑出去）。
    if(h.mb&&MW){
      Matter.Body.setPosition(h.mb,{x:h.x,y:h.y});
      Matter.Body.setVelocity(h.mb,{x:0,y:0});
      Matter.Body.setAngularVelocity(h.mb,0);
      Matter.Sleeping.set(h.mb,false);
    }
  }
  for(i=0;i<rig.S.length;i++){
    var S=rig.S[i];
    // 拖整体 = 导轨跟着搬（否则 springSyncEnds 会把端点投回旧导轨，弹簧拖不动）
    if(S.dirLock){S.dirLock.mx+=dx;S.dirLock.my+=dy;}
    for(e=0;e<2;e++){
      var a=S.anc[e];
      // 只有铁砧拖不动：被右键固定过 / 本身就是 static 的物体。其余对象（含画出来的动态图形/线）都跟着整体走 ——
      // 拖已固定的弹簧就是拖整个整体。不要排除 kind==='W'：否则拖弹簧时方块留在原地，又被锚偏移拽回去，看起来拖不动。
      if(a&&a.B&&a.B.mb&&a.B.mb.isStatic)continue;
      if(e===0){S.e0.x+=dx;S.e0.y+=dy;}else{S.e1.x+=dx;S.e1.y+=dy;}
    }
    springSyncEnds(S);
  }
  /* 搬完宿主后必须再受一次既有约束的检查，见 springPinHostsToOtherAnchors 的注释。 */
  if(springPinHostsToOtherAnchors(rig.B,B)){
    for(i=0;i<rig.S.length;i++)springSyncEnds(rig.S[i]);
  }
  return rig;
}
/* 拖弹簧/绳 = 平移整个装配体（springMoveRig），这种宿主搬动没有上限，也不检查宿主是否已被另一条轻绳的
 * 铁砧端钉在可达域里。ropeSolve 每帧被 CON_DRAG_STEP=48 限步，追不上 ⇒ 宿主卡在不可达处，绳看起来变长/脱钩。
 *
 * springPinHostsToOtherAnchors：搬完之后，把每个「被别的轻绳的铁砧端钉住」的宿主精确投影回那条绳的可行域：
 *   · 沿（锚点 → 铁砧锚点）的径向缩回越界量 over = d − len；
 *   · 切向位移原样保留 ⇒ 宿主仍能绕铁砧自由摆动；
 *   · 只在 d > len 时动手（绳只拉不推，松弛态不碰）；
 *   · 幂等、纯几何、无上限 ⇒ 本子步结束时残差恒 0。
 *   语义：够不着 ⇒ 拖不动，但绝不分离/拉长（与杆链 rodDragPinChain 同构）。
 *   范围只做绳：杆已有 rodDragPinChain，铰链走 hingeSolve/conProj 双边通道，再叠一层会变成两个写入者互相追打。
 *   excludeB = 本次正在被搬的元件自己（不能拿它自己的约束否决它自己的平移）。
 *   第二个调用点在 stepSprings 末尾（hosts=null ⇒ 全场收口），原因见彼处。
 *
 * springFollowHostShift：收了宿主 h（位移 mv）之后，把锚在 h 上的其它元件（杆 + 轻绳）的另一端宿主也平移 mv。
 *   元件是刚体/不可伸长的 ⇒ 两端一起走，锚距不变 ⇒ 整条被拖装配体被刚性拽回可达域；只搬一半会把被拖元件拉长。
 *   另一端是铁砧（static / fixed / _dragPin）时不搬：整体平移会破坏那一端的锚，那种构型归 rodDragPinHosts 与
 *   conDragConstrain 管。同一次调用里同一个宿主只搬一次（done），否则多根元件会重复施加 mv。 */
export function springFollowHostShift(h,mvx,mvy,excludeB){
  if(!h)return;
  if(!mvx&&!mvy)return;
  if(!h.mb||h.kind!=='W')return;
  var done=[];
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    if(!R||R.dead||R===excludeB||!R.anc)continue;
    var isRod=(R.kind==='T');
    if(!isRod&&!(R.kind==='S'&&R.rope))continue;
    for(var j=0;j<2;j++){
      var a=R.anc[j];
      if(!a||a.B!==h)continue;
      var o=R.anc[1-j];
      if(!o||!o.B||o.B.dead)continue;
      if(o.B===h)continue;                    // 两端同一宿主：没有"另一端"可言
      if(hostIsAnvil(o.B))continue;           // 另一端是铁砧 ⇒ 整体平移会破坏那一端，不搬
      var oh=o.B;
      if(oh.kind!=='W'||oh.fixed)continue;
      if(done.indexOf(oh)>=0){                // 宿主已搬过 ⇒ 只平移元件自己（保刚体关系）
        if(isRod){R.x+=mvx;R.y+=mvy;}
        break;
      }
      oh.x+=mvx;oh.y+=mvy;
      if(oh.mb&&MW){
        Matter.Body.setPosition(oh.mb,{x:oh.x,y:oh.y});
        if(Matter.Sleeping)Matter.Sleeping.set(oh.mb,false);
      }
      if(isRod){R.x+=mvx;R.y+=mvy;}           // 杆自己也跟着（刚体整体平移，不动 th）
      done.push(oh);
      break;
    }
  }
}
export function springPinHostsToOtherAnchors(hosts,excludeB){
  /* 必须多遍（Gauss-Seidel）收敛，一遍只解决第一环：拓扑 墙W—元件1—A—元件2—B（拖元件2）时，
   * 第一遍把 A 收回、元件2 的 B 端随 A 平移，但元件2 自己（两端都不锚铁砧）仍被拉长。
   * 每遍按「哪一端锚在不可动的铁砧宿主上」定锁定端，把另一端宿主沿径向收回 over；每遍重新量。
   * 与杆链的 ROD_CHAIN_ITERS 同构。 */
  var PINS=8,pass,i,j,k;
  for(pass=0;pass<PINS;pass++){
    var moved=false;
    for(i=0;i<bodies.length;i++){
      var S=bodies[i];
      if(!S||S.dead||S===excludeB||!S.anc)continue;
      var isRod=(S.kind==='T');
      var isRope=(S.kind==='S'&&S.rope);
      if(!isRod&&!isRope)continue;
      /* 两端都锚定才有"刚性关系"可言；只有一端锚定 = 自由元件，几何归自由端跟随管。 */
      if(!S.anc[0]||!S.anc[1])continue;
      var L=isRope?(S.len||0):((S._rodL!=null&&S._rodL>0)?S._rodL:(S.len||170));
      var touched=false;
      for(j=0;j<2;j++){
        var a=S.anc[j],oh=S.anc[1-j];
        if(!a||!a.B||!oh||!oh.B)continue;
        if(hosts&&hosts.length&&hosts.indexOf(a.B)<0)continue;  // hosts=null ⇒ 全场
        /* 哪一端可以吸收：本端宿主仍可被约束搬动，另一端必须是不可动的铁砧（static / fixed / _dragPin 被指针拖住）。
         * 不要用 hostMovableByConstraint 反向判断：会把被另一根元件临时锁住的 W 体也算成可动 ⇒ 循环分配、谁都不收敛。 */
        if(!hostIsAnvil(oh.B))continue;               // 另一端不是铁砧 ⇒ 它可以带着宿主一起走
        if(a.B===oh.B)continue;                       // 两端同一宿主：没有"另一端"可言
        var h=a.B;
        if(hostIsAnvil(h))continue;                   // 本端宿主自己也动不了 ⇒ 无从吸收
        if(h.kind!=='W'||h.fixed||h.dead)continue;
        var p=springAnchoredWorld(S,j),q=springAnchoredWorld(S,1-j);
        if(!p||!q)continue;
        var ddx=p.x-q.x,ddy=p.y-q.y,d=Math.hypot(ddx,ddy);
        if(!(d>L+0.01))continue;                      // 只收拉长这一侧（变长/脱钩）
        var ux=ddx/d,uy=ddy/d,over=d-L;
        var mvx=-ux*over,mvy=-uy*over;
        h.x+=mvx;h.y+=mvy;                            // 精确径向收回（切向位移保留）
        if(h.mb&&MW){
          Matter.Body.setPosition(h.mb,{x:h.x,y:h.y});
          if(Matter.Sleeping)Matter.Sleeping.set(h.mb,false);
        }
        /* 收了宿主 h ⇒ 把锚在 h 上的其它元件的另一端也整体刚性平移同一位移（详见 springFollowHostShift）。 */
        springFollowHostShift(h,mvx,mvy,S);
        touched=true;moved=true;
      }
      /* 搬过之后补「缓存一致性」：杆的姿态按新锚点重算（纯位姿重算，不搬宿主、
       * 不写 _rodL、不碰速度）；S 族的端点钉回锚点（否则一帧的视觉脱钩）。 */
      if(touched){
        if(isRod)rodResyncRodPose(S);
        for(k=0;k<bodies.length;k++){
          var S2=bodies[k];
          if(S2&&!S2.dead&&S2.kind==='S'&&S2.anc)springSyncEnds(S2);
        }
      }
    }
    if(!moved)break;
  }
  return pass>0;
}
// 整体旋转：旋转手柄拧的是 seed 的角度，但 seed 属于含方向锁弹簧的装配体时，转动必须落到每一个成员上 ——
// 否则只转宿主，弹簧端点被锚偏移拽回来（springSyncEnds 每帧按锚重算端点），拧了没反应。刚体旋转的分工：
//   · 所有成员的中心绕 pivot 转（pos' = pivot + R(dth)·(pos − pivot)）；
//   · W/S/T 成员的朝向跟着转 th += dth（anchor = x + R(th)·o，th 转了偏移 o 就不用动）；
//   · 无 kind 的公式体朝向不转，但锚偏移要转（o' = R(dth)·o），锚点世界位置才落在刚体旋转
//     的正确处 —— 两类成员各转一半，锚点殊途同归，绝不能两边同时转（会转两次）。
//   · 方向锁弹簧的导轨整体转：中点绕 pivot 转、方向向量乘 R(dth)。「固定方向」锁的是物理
//     过程中的自转/摆动，不是「用户手动旋转整体时也不许转」。
// 返回 false = seed 不在方向锁装配体里，调用方退回单体的旋转路径。
export function springLockedAsmOf(seed){
  if(!seed)return null;
  var mem=springAssemblyOf(seed),i;
  for(i=0;i<mem.length;i++){if(mem[i].kind==='S'&&mem[i].dirLock)return mem;}
  return null;
}
// 高中模式「旋转手柄 → 目标角」。纯函数、无副作用，便于单独测试死区。
//   高中只有 4 个方向，但目标不能取「raw 最近的 90° 倍数」：raw 与按下时方向 th0 夹角 <45° 时会算回原角度，
//   dth=0，手柄有 45° 死区（连上物体后转不动）。改为以 th0 为基准跨一格：raw 偏离 th0 超过 SNAP_DEG 就跳到
//   相邻 90° 倍数 ⇒ 死区 8°，与 snapAngle90 的带内不动语义衔接。
//   基准必须用 th0（按下那一刻锁定），不能用 seed.th：后者第一次跨格后已变，会让手柄在 90°/180° 间来回振荡。
export function springRotTargetHigh(th0,raw){
  var Q=Math.PI/2;
  var base=Math.round((th0||0)/Q)*Q;
  var dev=shortAng(raw-base);
  if(Math.abs(dev)>=SNAP_DEG*Math.PI/180)return base+(dev>0?1:-1)*Q;
  return base;
}
export function springAssemblyRotate(seed,tgt,pivot){
  var mem=springLockedAsmOf(seed);
  if(!mem)return false;
  /* 装配整体旋转不做 90° 吸附，完全按用户给的角度走：组里只要挂着弹簧，组级吸附会把同组的圆轨/圆弧/电磁场等
   * 一起锁死。高中模式「没有斜弹簧」只在直接旋转那根弹簧时执行（见 springRotate）。 */
  var dth=shortAng(tgt-(seed.th||0));
  if(!dth)return true;
  var c=Math.cos(dth),s=Math.sin(dth);
  for(var i=0;i<mem.length;i++){
    var M=mem[i];
    if(M.kind==='S'){
      // 导轨 + 端点一起转（锚定端下一帧由 springSyncEnds 重算，结果一致；自由端靠这里转到位）。
      // 中心 M.x/M.y 由 refreshSpringGeom 从端点派生 —— 端点转完中心自然对，不要单独写。
      if(M.dirLock){
        var ldx=M.dirLock.mx-pivot.x,ldy=M.dirLock.my-pivot.y;
        M.dirLock.mx=pivot.x+ldx*c-ldy*s;M.dirLock.my=pivot.y+ldx*s+ldy*c;
        var lux=M.dirLock.ux*c-M.dirLock.uy*s,luy=M.dirLock.ux*s+M.dirLock.uy*c;
        M.dirLock.ux=lux;M.dirLock.uy=luy;
      }
      for(var e=0;e<2;e++){
        var ee=springEnd(M,e),edx=ee.x-pivot.x,edy=ee.y-pivot.y;
        ee.x=pivot.x+edx*c-edy*s;ee.y=pivot.y+edx*s+edy*c;
      }
      refreshSpringGeom(M);            // 端点已在转后的导轨上（刚体旋转保线），投影只清浮点误差
      continue;
    }
    var dx=M.x-pivot.x,dy=M.y-pivot.y;
    M.x=pivot.x+dx*c-dy*s;M.y=pivot.y+dx*s+dy*c;
    if(M.kind==='W'||M.kind==='T'){
      M.th=shortAng((M.th||0)+dth);
      if(M.mb&&MW){
        Matter.Body.setPosition(M.mb,{x:M.x,y:M.y});
        Matter.Body.setAngle(M.mb,M.th);
        Matter.Sleeping.set(M.mb,false);
      }
      if(M.kind==='T')refresh(M);
    }else{
      M.vx=0;M.vy=0;                  // 公式体：整体旋转期间不带旧速度甩出去
    }
  }
  // 公式体成员的锚偏移旋转：装配内每根弹簧的 anc，宿主是无 kind 的公式体时偏移随整体转
  for(i=0;i<mem.length;i++){
    var S2=mem[i];
    if(S2.kind!=='S')continue;
    for(var e2=0;e2<2;e2++){
      var a2=S2.anc[e2];
      if(!a2||!a2.B||a2.B.kind)continue;      // W/S/T 宿主的朝向已转，偏移保持不动
      var ox=a2.ox*c-a2.oy*s,oy=a2.ox*s+a2.oy*c;
      a2.ox=ox;a2.oy=oy;
    }
  }
  return true;
}
export function dissolveSpring(B){
  // 轻绳 / 铰链不是 kx 拼出来的，双击就是删除它（变回 k 和 x 是错误语义）。
  if(B&&(B.rope||B.hinge)){ringGo(B.x,B.y);killBody(B);return;}
  // 双击整体 -> 解散变回原样（k 和 x 各自回到两个端点处，作为自由字母落回画布）
  var cx=B.x,cy=B.y;
  var ux=B.e1.x-B.e0.x,uy=B.e1.y-B.e0.y,d=Math.hypot(ux,uy)||1;
  ux/=d;uy/=d;
  var kg=GD('k'),xg=GD('x');
  freeLetter(kg,B.e0.x+ux*12,B.e0.y+uy*12,0,0,true);
  freeLetter(xg,B.e1.x-ux*12,B.e1.y-uy*12,0,0,true);
  killBody(B);
  ringGo(cx,cy);
}
// 从 seed 出发沿「弹簧 ↔ 宿主」锚定关系走到底，得到整个装配体的成员。
// 「复制整体」的唯一来源：点弹簧或点其中一个物体都得到同一套成员。
export function springAssemblyOf(seed){
  if(!seed)return [];
  var set=[],seen=[seed],q=[seed],guard=0;
  while(q.length&&guard++<2000){
    var B=q.shift();set.push(B);
    if(B.kind==='S'){
      for(var e=0;e<2;e++){
        var a=B.anc[e];
        if(!a||!a.B||a.B.dead||seen.indexOf(a.B)>=0)continue;
        seen.push(a.B);q.push(a.B);
      }
    }else{
      for(var i=0;i<bodies.length;i++){
        var S=bodies[i];
        if(S.kind!=='S'||S.dead)continue;
        for(var e2=0;e2<2;e2++){
          var a2=S.anc[e2];
          if(!a2||a2.B!==B||seen.indexOf(S)>=0)continue;
          seen.push(S);q.push(S);
        }
      }
    }
  }
  return set;
}
/* ---- 弹簧的绘制：锯齿线圈 + 锚点 ------------------------------------------------ */
// 拴住的一端，线圈要停在宿主表面，不能画进物体里。
// 不要用宿主的某个尺寸做回收量近似：按半径/半宽硬减假设锚点在中心（吸附时锚点几乎总在边缘），
// 用包围盒沿轴支撑对非矩形 W 体是高估 —— 两者都会空出 70~150px。
// 做法是对宿主的真实几何求解：
//   · 圆      ：解 |m + u·t| = R 的正根（锚点在体外 -> 0）
//   · 开笔画/弧：锚点本来就在线上，没有「内部」-> 0
//   · 闭合图形 ：锚点在体外 -> 0；在里面 -> 沿 u 射线走到边界为止
// 实测（圆/线/矩形/三角形/涂鸦 × 16 方向 × 3 个内外偏移）最长回收 6.3px，其中圆的 3px 是有意留的内缩。
// 世界坐标约定 world = pos + R(th)·local，与 distToHost / springAnchorOffset 一致。
export function hostInsideInk(H,px,py){
  var p=H.pts;if(!p||p.length<3)return false;
  var c=Math.cos(H.th||0),s=Math.sin(H.th||0),ins=false;
  for(var i=0,j=p.length-1;i<p.length;j=i++){
    var ai=p[i],aj=p[j];
    var ax=H.x+ai[0]*c-ai[1]*s, ay=H.y+ai[0]*s+ai[1]*c;
    var bx=H.x+aj[0]*c-aj[1]*s, by=H.y+aj[0]*s+aj[1]*c;
    if(((ay>py)!==(by>py))&&(px<(bx-ax)*(py-ay)/(by-ay)+ax))ins=!ins;   // 奇偶规则
  }
  return ins;
}
// 从 (px,py) 沿 (ux,uy) 走出闭合图形的最小正距离（射线 × 各边求交）
export function hostExitDist(H,px,py,ux,uy){
  var p=H.pts;if(!p||p.length<3)return 0;
  var c=Math.cos(H.th||0),s=Math.sin(H.th||0),best=1e9;
  for(var i=0,j=p.length-1;i<p.length;j=i++){
    var ai=p[i],aj=p[j];
    var ax=H.x+ai[0]*c-ai[1]*s, ay=H.y+ai[0]*s+ai[1]*c;
    var bx=H.x+aj[0]*c-aj[1]*s, by=H.y+aj[0]*s+aj[1]*c;
    var ex=bx-ax,ey=by-ay,den=ux*ey-uy*ex;
    if(Math.abs(den)<1e-9)continue;                       // 射线与这条边平行
    var t=((ax-px)*ey-(ay-py)*ex)/den;                    // 交点沿射线
    var v=((ax-px)*uy-(ay-py)*ux)/den;                    // 交点在这条边上的位置
    if(t>0.01&&v>=0&&v<=1&&t<best)best=t;
  }
  return best<1e9?best:0;
}
// 拴住的一端，线圈要从锚点朝**弹簧那一侧**退多少才刚好贴住宿主表面。
// (ux,uy) 就是「朝弹簧」的方向 —— 与 drawSpring 的两处调用一致（e0 端传 +u、e1 端传 -u）。
export function springHostSurfDist(H,px,py,ux,uy){
  if(!H)return 0;
  var mx=px-H.x,my=py-H.y,m2=mx*mx+my*my;
  if(H.rad){                                              // 圆：|m + u·t| = R 的正根
    var R=H.rad+3;
    if(m2>=R*R)return 0;                                  // 锚点已在体外
    var a=mx*ux+my*uy,disc=a*a-m2+R*R;
    return disc>0?Math.max(0,-a+Math.sqrt(disc)):0;
  }
  if(!H.closed)return 0;                                  // 开笔画 / 弧：没有「内部」
  if(!hostInsideInk(H,px,py))return 0;                    // 闭合图形的体外
  return hostExitDist(H,px,py,ux,uy);
}
export function drawSpring(B){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1,ux=dx/L,uy=dy/L,px=-uy,py=ux;
  /* 端帽压缩量 _capCmp 的唯一消费者：被撞那一端沿轴向内缩 _capCmp，线圈挤在更短的一段上
   * （螺距变小，像真弹簧被压扁）；物体弹开后 _capCmp 指数回落，弹簧自己弹回来。
   * 不要在 refreshSpringGeom / springEndCaps 里挪 e0/e1：压缩量一旦参与几何，判据基准随状态漂移
   * ⇒ 正反馈（物体被越推越远 / 弹簧冻死）。几何保持自然长度，压缩只做渲染 + 力。
   * 只画未锚定端（锚定端钉在宿主上，没有端帽）。 */
  if(B._capCmp>0){
    var _ci=(B._capEIdx===1)?1:0,_ce=(_ci===1)?B.e1:B.e0;
    var _sgn=(_ci===1)?-1:1;                     // 该端向内 = 沿 e0→e1 方向（i=1 时为 −u）
    var _cp=B._capCmp,_cL=Math.hypot(_cp,0);
    if(_cp>0&&_cp<L-8){
      _cp=_cp>L-8?L-8:_cp;
      if(_ci===1){x1=x1-ux*_cp;y1=y1-uy*_cp;}
      else{x0=x0+ux*_cp;y0=y0+uy*_cp;}
      dx=x1-x0;dy=y1-y0;L=Math.hypot(dx,dy)||1;ux=dx/L;uy=dy/L;px=-uy;py=ux;
    }
  }
  // 弹簧恒用墨线画，不按拉长/压缩染色（形变信息由参数面板的劲度系数/自然长度承担）。
  var col='rgba(38,34,28,0.85)';
  // 圈数由自然长度定，与当前拉伸量无关：真实弹簧圈数固定，拉长时螺距变大、压缩时螺距变小。
  var nc=Math.round(clamp(B.len/16,6,20)),amp=8;
  var r0=B.anc[0]?springHostSurfDist(B.anc[0].B,x0,y0, ux, uy):0;      // 拴住的一端止于表面
  var r1=B.anc[1]?springHostSurfDist(B.anc[1].B,x1,y1,-ux,-uy):0;
  var room=L-16;                                  // 至多退到只剩 16px 线圈，不许退穿
  if(r0+r1>room&&r0+r1>0){var rt=room/(r0+r1);r0*=rt;r1*=rt;}
  var c0x=x0+ux*r0,c0y=y0+uy*r0,c1x=x1-ux*r1,c1y=y1-uy*r1;
  var CL=Math.hypot(c1x-c0x,c1y-c0y)||1;
  var lead=Math.min(9,CL*0.12);
  cvx.strokeStyle=col;cvx.lineWidth=2.4;cvx.lineJoin='round';cvx.lineCap='round';
  cvx.beginPath();
  cvx.moveTo(c0x,c0y);
  cvx.lineTo(c0x+ux*lead,c0y+uy*lead);
  var span=Math.max(1,CL-2*lead),steps=nc*2;
  for(var i=1;i<=steps;i++){
    var t=lead+span*i/steps,sgn=(i%2===0)?1:-1;
    cvx.lineTo(c0x+ux*t+px*amp*sgn,c0y+uy*t+py*amp*sgn);
  }
  cvx.lineTo(c1x,c1y);
  cvx.stroke();
  cvx.fillStyle=col;
  for(var a=0;a<2;a++){
    if(!B.anc[a])continue;                 // 只有拴住的一端才画锚点
    cvx.beginPath();cvx.arc(a?x1:x0,a?y1:y0,4.4,0,6.2832);cvx.fill();
  }
}
/* 两个让链停住的门：
 *   · ROPE_TAUT_EPS 绷直判据：端距 de ≥ len−0.5 时，满足「链总长=len、两端钉死」的构型只有直线
 *     ⇒ 直接等分铺点 + 清 verlet 速度（px=x/py=y），跳过本帧积分/约束。否则重力每帧把节点往下坠、
 *     只拉不推的段约束再拉回，位移全变成节点速度 ⇒ 放下即弯、晃好几秒（实测 0.25s 内垂度 0→7.95px）。
 *   · ROPE_SETTLE 静止冻结门：松弛链收敛后（本帧最大节点位移 < 0.03px）把 px/py 对齐 x/y
 *     ⇒ verlet 速度清零，链彻底停住；单靠阻尼要几十帧才耗完。 */
export const ROPE_TAUT_EPS=0.5;       // 绷直判据（px）：端距距 len 不足此值视为绷直

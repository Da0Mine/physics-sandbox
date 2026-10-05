/* 参数定义（右键 → 参数）与参数应用 */
import Matter from 'matter-js';
import { app } from '../state.js';
import { setBeltAngle } from '../bodies/belt.js';
import { rodMassOf, setRodLen } from '../bodies/rod.js';
import { bossLightReset, bossLightState } from '../boss/boss.js';
import { bodies } from '../core/dom.js';
import { clamp, shortAng } from '../core/math.js';
import { GROUND_MAX_LEN, GROUND_MIN_LEN, GROUND_SPAWN_LEN, setGroundAngle, setGroundEnds } from '../devices/ground.js';
import { SPR_DAMP, SPR_KS_DEF, springSetLen } from '../devices/spring.js';
import { isMVR, refresh } from '../letters/layout.js';
import { MU } from '../letters/merge.js';
import { charDefWrite } from '../letters/panel.js';
import { PX_PER_M, ROD_SPAWN_LEN, ROPE_SPAWN_LEN, SPR_SPAWN_LEN, paramLetter } from './panel.js';
import { WFRICT_DEF, applyWAir, applyWBounc, applyWFrict } from '../physics/material.js';
import { BALL_REST, MW } from '../physics/matter.js';
import { PHYS_MODE } from '../ui/settings.js';

export let GRAV=2600;
export let WAIR_GLOBAL=0;       // 全局空气阻力（面板 wair 的唯一真源）
export function pv(B,k,d){var v=B.param?B.param[k]:null;return (v===null||v===undefined||isNaN(v))?d:v;}
/* 传送带默认带速 CONV_DEF = 130 px/s = 0.5 m/s（内部一律 px/s，面板显示时才除以 PX_PER_M）。
 * 必须声明在 PARAM_DEFS 之前：参数表的 def:CONV_DEF 在对象字面量求值时取值，
 * var 只提升声明不提升赋值，声明在后面会取到 undefined。全文件只此一处声明。
 * 取 0.5 而非 1.0：传送带放下去电机就在转，默认太快货物会被甩远，用户容易误判为器件坏了。 */
export let CONV_DEF;
// 上限只保留物理上真实存在的：弹性 e∈[0,1]、空气阻力 <1（它是每帧速度占比，≥1 会把速度反向）；
// μ>1 是物理的（橡胶-玻璃 ≈2），质量/长度/刚度/阻尼均无上限。
// 滑块 min/max 只是可视化量程（数字输入框不受限），真正的硬边界在 applyParam。
export let PARAM_DEFS;
// 参数标签随模式切换：同一个 sdamp 字段在大学模式是 Rayleigh 阻尼系数 D（有量纲），
// 高中模式是阻尼比 ζ（无量纲，见 springDamp）。
export function paramLabel(spec){
  if(spec&&spec.key==='sdamp'&&PHYS_MODE==='high')return '阻尼比 ζ';
  return spec?spec.label:'';
}
// which PARAM_DEFS entry a SINGLE letter exposes (right-click m -> mass, g -> grav, ...).
// Returns the spec id, or null when the letter has no adjustable param.
// v is special: on a vt-ROD (kind 'T') it controls the ROD LENGTH (rodlen); on a formula
// body it stays the bounce/elasticity (bounc) — "v 改变的还是 vt 后的线段的长度".
export function specIdForLetter(d,B){
  if(!d)return null;
  var t=d.type||d.ch;
  if(t==='m')return 'mass';
  if(t==='M')return 'massM';
  if(t==='g')return 'grav';
  /* a 语义 = 赋予持续加速度，映射到 asize/aang；不要在此之前保留旧的 return 'acc'，否则方向行永远到不了。 */
  /* v 不再是弹性参数，而是赋予速度（vsize 大小 + vang 方向）；vt 杆上 v 控制杆长。 */
  if(t==='v')return (B&&B.kind==='T')?'rodlen':'vsize';
  if(t==='a')return 'asize';   // a = 赋予持续加速度（与 v 同构）
  if(t===MU)return 'frict';
  /* t = 世界时间倍率（Δt）；q = 电荷量 */
  if(t==='t')return 'tscale';
  if(t==='q')return 'qcharge';
  if(t==='r')return 'scale';
  if(t==='B')return 'bz';
  if(t==='E')return 'eacc';
  if(t==='I')return 'iacc';
  return null;
}
// ordered param ids a body exposes when the WHOLE body is parameterised (fallback / compat).
export function paramDef(B){
  var ids=[];
  if(!B)return ids;
  if(B.kind==='T'){ids.push('rodlen');ids.push('rodmass');return ids;}
  // 弹簧暴露 k / L₀ / 阻尼；铰链只有「固定铰链」开关（光滑、长度恒 0）；轻绳只有绳长。
  if(B.kind==='S'&&B.hinge){ids.push('hfix');return ids;}
  if(B.kind==='S'&&B.rope){ids.push('rlen');return ids;}
  if(B.kind==='S'){ids.push('sk');ids.push('slen');ids.push('sdamp');return ids;}
  // W 体暴露 质量（乘数）/ 摩擦 / 弹性 / 空气阻力；圆的摩擦调节只有 μ 一个旋钮（无滚动摩擦）。
  /* 地面/墙面只发两行（长度 / 角度）：它是外部支撑源（可摆角的静态板），
   * 质量/摩擦/弹性/空气阻力对它没有意义。 */
  if(B.gnd)return ['gndlen','gndang'];
  if(B.kind==='W'){
    // 传送带只发带速与角度：它是一台机器，质量/摩擦/弹性/空气阻力旋钮只会让人困惑。
    // 带面 μ=0.6 固定在 makeBelt 里。早退必须在 push 任何内建项之前。
    if(B.belt)return ['convspeed','beltangle'];
    ids.push('wmass');ids.push('wfrict');ids.push('wbounc');ids.push('wair');
    if(B.charge)ids.push('wcharge');   // 被赋予电荷的物体可再调电荷量
    /* 被 a 赋予过加速度的物体，面板里出现「赋予加速度」大小 + 方向两行。 */
    /* 方向行 waccang 必须和 wacc 一起进清单：paramIdsForLetter 的 'wacc' 分支只在右键字母时走，
     * 而 specIdForLetter 从不返回 'wacc'，漏掉这里就只能改大小、改不了方向（恒为 0°）。 */
    if(B.accGive!=null||B.accX!=null||B.accY!=null){ids.push('wacc');ids.push('waccang');}
    return ids;
  }
  if(B.kind==='B')ids.push('bz');
  else if(B.kind==='E')ids.push('eacc');
  else if(B.kind==='I')ids.push('iacc');
  else if(isMVR(B)){                             // mv²/r whole: r affects scale+orbit
    if(B.massG)ids.push(B.massG.type==='M'?'massM':'mass');
    ids.push('scale');
  }else{
    if(B.massG)ids.push(B.massG.type==='M'?'massM':'mass');
    for(var i=0;i<B.mem.length;i++){
      var t=B.mem[i].type;
      if(t==='g'&&ids.indexOf('grav')<0)ids.push('grav');
      else if(t==='a'&&ids.indexOf('acc')<0)ids.push('acc');
      else if(t==='v'&&ids.indexOf('bounc')<0)ids.push('bounc');
      else if(t===MU&&ids.indexOf('frict')<0)ids.push('frict');
      else if(t==='r'&&ids.indexOf('scale')<0)ids.push('scale');
    }
  }
  return ids;
}
// 按字母分行：右键哪个字母，面板就显示那个字母的参数。
// 无参数的字母（½/²/c/G…）返回空。
export function paramDefForLetter(B,d){
  if(!B)return [];
  var sid=specIdForLetter(d,B);
  /* v 的面板两行：速度大小 + 速度方向（默认 0° = 水平向右）。 */
  if(sid==='vsize')return ['vsize','vang'];
  if(sid==='asize')return ['asize','aang'];
  if(sid==='wacc')return ['wacc','waccang'];
  return sid?[sid]:[];
}
/* 默认值可以随本体而定：wbounc 的出厂值对圆是 BALL_REST（0.52），其它 W 体是 0。
 * 读数（paramV 的 wbounc 分支）与「默认」按钮（paramDefVal）共用本函数，保证两者同源，
 * 否则会出现圆出生读数 0.52、点「默认」却写 0 的不一致。 */
export function wBouncDef(B){
  if(PHYS_MODE==='high')return 0;                        // 高中模式：μ/e 全 0
  return (B&&B.wshape==='circle')?BALL_REST:0;
}
/* 面板「默认」按钮 / 输入框清空时统一从这里取回退值：
 *   ① 有动态口径（随本体而定）的参数用它（目前只有 wbounc）；
 *   ② 否则回落到静态的 spec.def。
 * 新增「默认值随本体而定」的参数时只改这一个分派点 + 加一个 <x>Def(B) 函数，
 * 不要在按钮/输入框调用点各写一套表达式。 */
export function paramDefVal(B,spec){
  if(!spec)return 0;
  if(spec.key==='wbounc')return wBouncDef(B);
  return spec.def;
}
export function paramV(B,id){
  var spec=PARAM_DEFS[id];
  /* 赋予型参数的读取：Δt 读全局量；v/a/q 的值存在宿主字段或字符（paramLetter）上。
   * 缺了读取分支面板会一直显示 spec.def，与真实值不同步。 */
  if(id==='tscale')return app.TIME_SCALE;
  if(id==='vsize')return (B&&B.vGive!=null)?B.vGive:((paramLetter&&paramLetter.vGive!=null)?paramLetter.vGive:spec.def);
  if(id==='vang')return (B&&B.vAng!=null)?B.vAng:((paramLetter&&paramLetter.vAng!=null)?paramLetter.vAng:spec.def);
  if(id==='asize')return (B&&B.aGive!=null)?B.aGive:((paramLetter&&paramLetter.aGive!=null)?paramLetter.aGive:spec.def);
  if(id==='aang')return (B&&B.aAng!=null)?B.aAng:((paramLetter&&paramLetter.aAng!=null)?paramLetter.aAng:spec.def);
  if(id==='qcharge')return (B&&B.qCharge!=null)?B.qCharge:((paramLetter&&paramLetter.qCharge!=null)?paramLetter.qCharge:spec.def);
  if(id==='wcharge')return (B&&B.charge!=null)?B.charge:0;
  if(id==='wacc'){
    if(!B)return 0;
    if(B.accX!=null||B.accY!=null)return Math.hypot(B.accX||0,B.accY||0);   // 合成大小
    return (B.accGive!=null)?B.accGive:0;
  }
  if(id==='waccang'){
    if(!B)return 0;
    if(B.accX!=null||B.accY!=null){
      var _ag=Math.atan2(B.accY||0,B.accX||0)*180/Math.PI;                 // 合成方向
      return _ag;
    }
    return (B.accAng!=null)?B.accAng:0;
  }
  // 弹簧的 k / L₀ 存在 B.ks / B.len，不在 B.param 里（pv 只读 B.param 和 spec.def）。
  // 不特判的话面板永远显示 spec.def，用户改的值会被面板盖掉。下面各专用字段同理。
  if(id==='sk'&&B&&B.kind==='S')return B.ks;
  if(id==='slen'&&B&&B.kind==='S')return B.len;
  // 轻绳的绳长（专用字段 B.len）。
  if(id==='rlen'&&B&&B.rope)return B.len;
  // W 体的质量乘数 / 摩擦系数存在专用字段。
  if(id==='wmass'&&B&&B.kind==='W')return B.mMul||1;
  if(id==='wfrict'&&B&&B.kind==='W')return (B.wFrict!=null)?B.wFrict:(PHYS_MODE==='high'?0:WFRICT_DEF);   // 高中默认 0
  // 带速存在 B.conv（专用字段）
  if(id==='convspeed'&&B&&B.belt)return B.conv||0;
  /* 地面/墙面的长度/角度存在专用字段 B.len / B.th。
   * 角度必须返回度（与 PARAM_DEFS.gndang 的 unit:'°' 一致）。 */
  if(id==='gndlen'&&B&&B.gnd)return B.len||0;
  if(id==='gndang'&&B&&B.gnd)return (B.th||0)*180/Math.PI;
  // 传送带角度存在 B.th（专用字段），不特判则面板显示 def=0，拖过手柄再开面板也会被 0 盖掉。
  if(id==='beltangle'&&B&&B.belt)return B.th||0;
  // 弹性：没调过时显示实际生效的默认（圆 = BALL_REST，其它 = 0；高中模式全 0，与 wEffE 同步）
  if(id==='wbounc'&&B&&B.kind==='W')return (B.wBounc!=null)?B.wBounc:wBouncDef(B);   // 与「默认」按钮同源
  // 空气阻力：全局参数（默认 0）
  if(id==='wair'&&B&&B.kind==='W')return WAIR_GLOBAL;   // 全局参数，读同一份真源
  // g 的参数是全局重力，面板显示当前全局 GRAV（不是本体私有覆盖值）
  if(id==='grav')return GRAV;
  // 弹簧阻尼（可调到 0 = 无阻尼），专用字段 B.damp。
  if(id==='sdamp'&&B&&B.kind==='S')return (B.damp!=null)?B.damp:SPR_DAMP;
  // 杆的质量，专用字段。
  if(id==='rodmass'&&B&&B.kind==='T')return rodMassOf(B);
  return pv(B,spec.key,spec.def);
}
export function applyParam(B,spec,val){
  val=+val||0;
  if(!B.param)B.param={};
  B.param[spec.key]=val;
  var key=spec.key;
  /* 按数值途径写入 vsize 时退出光速态（不重渲染，免得正在编辑的输入框失焦）。
   * 光速态原本只由 bossFinish/bossAbort 复位，不在这里退出的话面板会被锁在「c = 光速」改不回数字。
   * 输入 c 走 keydown 里的 bossLightOn，不受这里影响。 */
  if(key==='vsize'&&bossLightState())bossLightReset(true);
  /* 赋予型参数的写入：Δt 写全局 TIME_SCALE；v 的大小/方向写字符字段；
   * q 的电荷写字符 qCharge；物体的电荷写 B.charge（并同步 Matter 体的电荷渲染）。 */
  if(key==='tscale'){
    app.TIME_SCALE=(val<0)?0:(val>20?20:val);
    return;
  }
  /* dock 字符的参数宿主是临时体，需要把值写回字符本身（paramLetter），否则拖出来就丢了。
   * 但面板（dock）里的字符是单例模板（vO/aO/qO…），gdDown 克隆时会拷贝 vGive 等字段：
   * dock 态不要写回模板（改走 charDefWrite），否则之后拖出的所有克隆都会继承这个值。
   * 只有世界里那个字符本身才写回，每个拖出来的字符各自独立。 */
  if(key==='vsize'){B.vGive=(val<0?0:val);
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.vGive=B.vGive;else charDefWrite(paramLetter,'vGive',B.vGive);}return;}
  if(key==='vang'){B.vAng=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.vAng=val;else charDefWrite(paramLetter,'vAng',val);}return;}
  /* a 的两行同口径（dock 单例不写回；世界里那个字符才写回）。 */
  if(key==='asize'){B.aGive=(val<0?0:val);
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.aGive=B.aGive;else charDefWrite(paramLetter,'aGive',B.aGive);}return;}
  if(key==='aang'){B.aAng=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.aAng=val;else charDefWrite(paramLetter,'aAng',val);}return;}
  /* q 同口径：dock 态不写回单例模板。否则面板上调过 q 后拖出的每个克隆都带着该值
   * （gdDown 克隆会拷贝 qCharge），与「赋予」路径叠加会导致抽搐。 */
  if(key==='qcharge'){B.qCharge=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.qCharge=val;else charDefWrite(paramLetter,'qCharge',val);}return;}
  if(key==='wcharge'){B.charge=val;return;}
  if(key==='wacc'){
    /* 改「合成大小」= 保持当前方向、重设长度 */
    var _cur=Math.atan2(B.accY||0,B.accX||0);
    B.accGive=(val<0?0:val);
    B.accX=Math.cos(_cur)*B.accGive;B.accY=Math.sin(_cur)*B.accGive;
    return;
  }
  if(key==='waccang'){
    /* 改「合成方向」= 保持当前大小、旋转矢量 */
    var _len0=Math.hypot(B.accX||0,B.accY||0)||(B.accGive||0);
    var _rb=val*Math.PI/180;
    B.accX=Math.cos(_rb)*_len0;B.accY=Math.sin(_rb)*_len0;
    B.accAng=val;B.accGive=_len0;
    return;
  }
  if(key==='mass'){
    // 质量无上限；只守 >0（质量 ≤0 违反物理）
    B.mass=(val>0)?val:0.001;
  }else if(key==='massM'){
    B.massCap=(val>0)?val:0.001;  // capital-M mass (independently tunable from lowercase m)
  }else if(key==='grav'){
    // g 的参数改全局 GRAV（不写本体的 B.grav 私有覆盖）：与 stepPhysics 的 GRAV、
    // stepMatter 的 MW.engine.gravity.y=GRAV/1000 同源，所有受重力物体一起变重。
    // 原本无重力的字符不受影响：重力入口仍是 if(B.hasG)。
    // B.grav 通道本身保留（物理侧照旧认它，回归用例会直接写 nb.grav 验证加速度）。
    GRAV=clamp(val,0,1e7);    // 上限只是防 NaN 的护栏，物理上 g 不设上限
    if(MW)MW.engine.gravity.y=GRAV/1000;
  }else if(key==='acc'){
    B.acc=val;
  }else if(key==='bounc'){
    B.bounc=clamp(val,0,1);   // 物理边界：恢复系数 ∈[0,1]
  }else if(key==='gndlen'){
    // 绕质心对称伸缩（与 setRodLen 语义一致），统一走 setGroundEnds
    if(B.gnd){
      var gh=B.len/2,gu=Math.cos(B.th||0),gv=Math.sin(B.th||0);
      var glen=clamp(val,GROUND_MIN_LEN,GROUND_MAX_LEN);
      setGroundEnds(B,B.x-gu*glen/2,B.y-gv*glen/2,B.x+gu*glen/2,B.y+gv*glen/2,true);
    }
  }else if(key==='gndang'){
    // 角度（度）。走 setGroundAngle（只写 th + 摆镜像）
    if(B.gnd)setGroundAngle(B,val*Math.PI/180);
  }else if(key==='rodlen'){
    // 杆长无物理上限，只保留 L>0。
    // 必须走 setRodLen（force=true 无条件重建）：只写 B.len+refresh 时镜像碰撞板不会跟着重建。
    if(B.kind==='T')setRodLen(B,val);
    else B.len=clamp(val,1,1e7);
  }else if(key==='rodmass'){
    // 杆的质量：手写通道的冲量份额、绕质心转动惯量 I=mL²/12 都取自它；无物理上限，>0 即可。
    // 杆的 Matter 镜像是位置驱动的（只跟随姿态，不参与求解），无需同步到 Matter。
    B.rmass=clamp(val,0.01,1e7);
  }else if(key==='frict'){
    B.frict=val;              // μ>1 是物理的（橡胶-玻璃≈2），不设上限
  }else if(key==='sk'){
    // 弹簧劲度系数，无物理上限
    B.ks=clamp(val,0,1e6);
  }else if(key==='slen'){
    // 改 L₀ 要让弹簧真的变长/变短（springSetLen），而不只改数字（否则画面不动且因 cur≠L₀ 被染色）。
    // 两端都拴住时几何由宿主决定，springSetLen 退化为只改 L₀ = 预紧力语义。
    if(B.kind==='S')springSetLen(B,val);
    else B.len=clamp(val,1,1e7);
  }else if(key==='rlen'){
    // 改绳长同样走 springSetLen 让绳真的变长；
    // 两端都拴住时退化为只改 L = 松弛量变化。
    if(B.rope)springSetLen(B,val);
    else B.len=clamp(val,1,1e7);
  }else if(key==='hfix'){
    // 「固定铰链」开关（0/1）。开启 = 角度定死在此刻的构型上，必须作废旧基准 B._hFold0，
    // 否则会瞬跳回两端刚连上那一刻的折角；hingeFoldLimit 下一帧按当前几何懒捕获。
    if(val&&B.hinge){B._hFold0=null;}
  }else if(key==='sdamp'){
    // 弹簧阻尼系数（0 = 无阻尼），存 B.damp，stepSprings / springGuideForce 都读它，缺省回落 SPR_DAMP。
    // 无物理上限（越大只是越快进入过阻尼）。
    B.damp=clamp(val,0,1e6);
  }else if(key==='scale'){
    if(!(val>0))val=1;                       // guard: scale must stay positive (input is unclamped)
    B.scaleParam=val;
    // refresh() re-lays-out (unscaled hw/hh) then applies scaleParam ONCE — no cumulative growth.
    if(B.isWell)B.wellR=(B.baseWellR||360)*val;   // GMm/r² well: r scales its attraction range
    refresh(B);
  }else if(key==='bz'){
    B.Bz=val;
  }else if(key==='eacc'){
    B.eacc=val;
  }else if(key==='iacc'){
    B.iacc=val;
  }else if(key==='wmass'){
    // 质量乘数。JS 侧 B.mass（弹簧 Δv=f/m、手写 SAT 冲量份额）与 Matter 侧
    // setMass(自然质量×乘数) 同步；setMass 会按比例调惯量，重的方块更难被拧转。
    // 重力加速度与质量无关，「重」只体现在碰撞与弹簧响应上。
    // static 体跳过 setMass（static 质量是 Infinity 语义）。
    var mv64=clamp(val,0.01,1e7);   // 质量无物理上限，>0 即可
    B.mMul=mv64;B.mass=mv64;
    if(B.mb&&B._natMass&&!B.mb.isStatic)Matter.Body.setMass(B.mb,B._natMass*mv64);
  }else if(key==='convspeed'){
    // 带面速度只写 B.conv（beltTract 每帧现读），无需同步 Matter 材质 —— 牵引在手写通道里加。
    // 负值 = 反向（人字纹渲染也跟着掉头）。
    if(B.belt)B.conv=clamp(val,-1e5,1e5);
  }else if(key==='beltangle'){
    // 面板改角度走 setBeltAngle（pts/hull/镜像板一次做全），绕质心转，带长与中心不动。
    // val 是弧度（面板已按 siK 换算），shortAng 归一化到 (−π,π]。这里不做 45° 量化。
    if(B.belt)setBeltAngle(B,shortAng(val),null);
  }else if(key==='wfrict'){
    // 本体摩擦系数（动摩擦配对取 min、静摩擦取 max —— Matter 规则）。
    // 改完必须刷新当前活动碰撞对：pair.friction 只在 collisionStart 算一次，不刷新要等重新接触才生效。
    B.wFrict=clamp(val,0,1e6);   // μ>1 是物理的，不设上限
    applyWFrict(B);
  }else if(key==='wbounc'){
    // W 体碰撞恢复系数。Matter 取双方 restitution 的 max，地面/普通体保持 0，
    // 所以只改本体（含 parts）+ 刷活动对即可。
    B.wBounc=clamp(val,0,1);     // 物理边界：e∈[0,1]
    applyWBounc(B);
  }else if(key==='wair'){
    // 空气阻力（独立于弹簧阻尼的耗散通道），0 = 无空气阻力；上限 0.5 是物理边界
    // （每帧速度占比，≥1 会把速度反向）。
    /* 全局参数：一调全场所有 W 体同步（含 parts），新出生体经 wAirDef 回退到 WAIR_GLOBAL 拿到同一值。 */
    WAIR_GLOBAL=clamp(val,0,0.5);
    for(var _iw=0;_iw<bodies.length;_iw++){
      var _bw=bodies[_iw];
      if(_bw.kind!=='W'||_bw.dead||!_bw.mb)continue;
      _bw.wAir=WAIR_GLOBAL;
      applyWAir(_bw);
    }
  }
  return val;
}

export function setupParamsDefs(){
  CONV_DEF=Math.round(0.5*PX_PER_M);
  PARAM_DEFS={
    // 滑块 min/max 保持常用小量程，不要放大到「不设上限」的量级：量程拉到 0..10000 后
    // 想把质量从 1 调到 2 只能在滑轨最左端蹭，滑块等于废了。
    // 「不设上限」由数字输入框承担（applyParam 只守物理边界），键入 10000 一样生效。
    mass:{key:'mass',label:'质量 mass',min:0.2,max:5,step:0.1,unit:'kg',siK:1,def:1},
    massM:{key:'massM',label:'质量 M',min:1,max:12,step:0.5,unit:'kg',siK:1,def:3},
    grav:{key:'grav',label:'重力 g',min:200,max:6000,step:50,unit:'m/s²',siK:PX_PER_M,def:2600},
    acc:{key:'acc',label:'加速度 a',min:100,max:4000,step:50,unit:'m/s²',siK:PX_PER_M,def:1300},
    bounc:{key:'bounc',label:'弹性 bounce',min:0,max:1,step:0.01,unit:'',def:0.6},
    /* Δt（世界时间倍率，滑条 0~1、数字框可更高）/ v 赋予速度（大小+方向）/ q 电荷量 / 物体电荷量 */
    tscale:{key:'tscale',label:'Δt 时间倍率',min:0,max:1,step:0.01,unit:'×',def:1},
    /* v 的速度按国际单位制显示/输入（内部 px/s，面板以 m/s 呈现，同 g / a 的 siK 通道）。 */
    vsize:{key:'vsize',label:'赋予速度 v',min:0,max:6000,step:100,unit:'m/s',siK:PX_PER_M,def:1800},
    vang:{key:'vang',label:'速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
    asize:{key:'asize',label:'赋予加速度 a',min:0,max:6000,step:100,unit:'m/s²',siK:PX_PER_M,def:1300},
    aang:{key:'aang',label:'加速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
    /* 电荷用 C（库仑）显示（内部=显示值，作相对电荷量使用） */
    qcharge:{key:'qcharge',label:'电荷量 q',min:-5,max:5,step:0.1,unit:'C',def:1},
    wcharge:{key:'wcharge',label:'电荷量 q',min:-5,max:5,step:0.1,unit:'C',def:0},
    /* 被赋予加速度的物体可再调（SI：m/s² 与方向） */
    wacc:{key:'wacc',label:'赋予加速度 a',min:0,max:6000,step:100,unit:'m/s²',siK:PX_PER_M,def:1300},
    waccang:{key:'waccang',label:'加速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
    // def 必须引用出生尺寸常量，不要写死数字：写死会与出生值形成两处真源，出生值一改就漂移。
    rodlen:{key:'rodlen',label:'杆长 length',min:60,max:420,step:10,unit:'m',siK:PX_PER_M,def:ROD_SPAWN_LEN},
    gndlen:{key:'gndlen',label:'长度 length',min:60,max:1600,step:10,unit:'m',siK:PX_PER_M,def:GROUND_SPAWN_LEN},
    gndang:{key:'gndang',label:'角度 angle',min:-180,max:180,step:1,unit:'°',siK:1,def:0},
    // 杆（vt 造的木板）的质量独立可调，使重物能撬动杠杆等碰撞效果依赖质量。
    // 默认 1kg（= 杆长 170px 的自然质量）
    rodmass:{key:'rodmass',label:'质量 mass',min:0.05,max:20,step:0.05,unit:'kg',siK:1,def:1},
    // 弹簧参数：k = 劲度系数，L₀ = 自然长度。
    // def 必须跟随 SPR_KS_DEF，不能写死；否则建弹簧用的值与面板显示的默认不一致。
    // max 取 2×默认（600）：默认值若超出滑块量程，面板一碰就会把 k 拉回 max。
    // 输入框不受 min/max 约束（物理边界 0..1e6 在 applyParam）。
    sk:{key:'sk',label:'劲度系数 k',min:2,max:600,step:1,unit:'N/m',siK:1,def:SPR_KS_DEF},
    // def 引用 SPR_SPAWN_LEN，使「默认」与出生长度同源（否则点「默认」会从 0.423 m 跳到 0.654 m）。
    slen:{key:'slen',label:'自然长度 L₀',min:60,max:420,step:10,unit:'m',siK:PX_PER_M,def:SPR_SPAWN_LEN},
    // 轻绳的绳长。不复用 slen（那行标签是「自然长度 L₀」，对绳是错误称呼）；
    // 量程随轻绳的 [ROPE_MIN_LEN, ROPE_MAX_LEN]（滑条常用区间取 60..600，数字框不受限）。
    // def 引用 ROPE_SPAWN_LEN，与出生长度同源。
    rlen:{key:'rlen',label:'绳长 L',min:60,max:600,step:10,unit:'m',siK:PX_PER_M,def:ROPE_SPAWN_LEN},
    // 铰链的「固定铰链」开关（布尔）。关闭 = 完全光滑（相对转动不受限）；
    // 开启 = 角度定死在开启那一刻（刚接）。没有可调角度数值（见 HINGE_FOLD_* 段）。
    hfix:{key:'hfix',label:'固定铰链',bool:true,def:0},
    // 弹簧阻尼系数独立可调。D=0 即完全无阻尼；默认值是与刚度配套的 SPR_DAMP。
    sdamp:{key:'sdamp',label:'阻尼 D',min:0,max:30,step:0.2,unit:'',def:SPR_DAMP},
    frict:{key:'frict',label:'摩擦系数 μ',min:0,max:1,step:0.01,unit:'',def:0.1},
    scale:{key:'scale',label:'尺寸 scale',min:0.4,max:3,step:0.05,unit:'×',def:1},
    bz:{key:'bz',label:'磁场强度 B',min:-3,max:3,step:0.1,unit:'T',def:1},
    eacc:{key:'eacc',label:'电场强度 E',min:-3,max:3,step:0.1,unit:'V/m',def:1},
    iacc:{key:'iacc',label:'电流强度 I',min:-3,max:3,step:0.1,unit:'A',def:1},
    // W 体（画出来的线/图形/圆）的专属参数。wmass 是乘数：JS 侧 B.mass 与
    // Matter 侧 setMass(自然质量×乘数) 同步。弹簧标定口径是单位质量，乘数只是把
    // 本体的 m 从 1 换成用户值，弹簧公式照旧成立（加速度限幅随 m 等比放大）。
    wmass:{key:'wmass',label:'质量 mass',min:0.2,max:5,step:0.1,unit:'kg',siK:1,def:1},
    // wfrict 是本体的摩擦系数；实际接触用配对规则（动/静摩擦均取双方 min），
    // 面板下方会实时列出当前每对接触实际生效的数值。
    wfrict:{key:'wfrict',label:'摩擦系数 μ',min:0,max:1,step:0.01,unit:'',def:WFRICT_DEF},
    // W 体的碰撞恢复系数。没调过时保留 buildMatterBody 的默认（圆 = BALL_REST，其它 = 0），与 wfrict 同一守卫规则。
    wbounc:{key:'wbounc',label:'弹性 bounce',min:0,max:1,step:0.01,unit:'',def:0},
    // W 体的空气阻力（frictionAir，每帧按速度占比泄能），独立于弹簧阻尼的耗散通道。
    // 设 0 = 无空气阻力（配 sdamp=0 即理想简谐振荡）；默认 0。
    // 上限 0.5 是物理边界（每帧速度占比，≥1 会把速度反向）。
    wair:{key:'wair',label:'空气阻力 air',min:0,max:0.5,step:0.001,unit:'',def:0},
    // 传送带带面速度（可正可负 = 正/反向）。内部 px/s，显示 m/s（siK=PX_PER_M）。
    // ±4 m/s 覆盖课堂量级。只有 belt 才显示这一行（见 paramDef）。
    convspeed:{key:'convspeed',label:'带速 v',min:-1040,max:1040,step:10,unit:'m/s',siK:PX_PER_M,def:CONV_DEF},
    // 传送带角度行。内部单位 = 弧度（B.th），显示/输入单位 = 度：靠 siK=π/180 换算
    // （面板口径 internal = SI × siK，见 renderParamPanel 的 kSI），滑块 ±180°、step 1°。
    // 面板是自由角度（37° 就存 37°），45° 量化只属于旋转手柄那一路；
    // 两者都经 setBeltAngle 写同一个 B.th，不会冲突。
    beltangle:{key:'beltangle',label:'角度 θ',min:-Math.PI,max:Math.PI,step:Math.PI/180,unit:'°',siK:Math.PI/180,def:0}
  };
}

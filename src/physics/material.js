/* 摩擦 / 弹性 / 空气阻力等材质参数映射到 Matter */
import Matter from 'matter-js';
import { bodies } from '../core/world.js';
import { GRAV, WAIR_GLOBAL } from '../params/defs.js';
import { BALL_REST, MW, refreshWPairs } from './matter.js';
import { PHYS_MODE } from '../ui/settings.js';

                         //   理论悬挂伸长 mg/k = 2600/250 = 10.4px（自然长度 110px，+9.5%）；180 已太硬（1kg 球高频抖动）。
                         // ⚠ 改这个数必须同时抬 sk 滑块的 max（见 PARAM_DEFS.sk），否则默认值顶在量程上沿、滑块满格拉不上去。
/* W 体默认摩擦系数。
 * 测量摩擦效果要用「滑行距离 / 停住时间」，不要用固定窗口的平均减速度：物体在窗口内已停住时
 * (v0−v1)/Δt 恒等于 v0/Δt，指标饱和。夹具要用贴地静置的宽扁块（240×36，给 500px/s）；
 * 从空中落下或窄高块会被下落冲击和前倾翻倒淹没摩擦信号。
 * 实测（干净夹具）：μ=0.05 滑行 72px、μ=1.0 滑行 20px，只差 3.6×（远小于 1/μ 的 20×），原因未定位。 */
export const WFRICT_DEF=0.08;
export const WF_STATIC_CAP=0.6;
/* W 体静摩擦的唯一真源（体级、parts、配对覆盖三处都走它，不要各写各的常数）。
 * 摩擦冲量 = friction × 法向力，而 frictionStatic 决定低速段直接粘住不滑；与 μ 无关的静摩擦地板会把
 * 刹车力抬到 ≈0.67g，压缩 μ 的效果（实测 μ=0.05 vs 0.5 滑行 72.1 vs 26.0px，μ=0.6→1.0 仅差 15%）。
 * 因此静态框静摩擦设为 1（不成为天花板），μ>cap 时让物体静摩擦跟随 μ。 */
export function wfStaticOf(mu){
  /* μ≤cap 仍取 0.6：保证停下来的物体站得稳（未调过的体 fs=0.6）。μ>cap 才跟随 μ ——
   静态框已是 1.0，配对 min 后天花板就是物体自己，不放开则 μ>0.6 仍是死区。 */
  return (mu>WF_STATIC_CAP)?mu:((mu>0)?0.6:0);      /* μ=0 必须真为 0（光滑语义） */
}
// 把用户调过的质量乘数（mMul）与摩擦系数（wFrict）应用到 Matter 体上。
// buildMatterBody 的所有路径（新建 / rebuildWBody 重建 / 复制）最后都走这里，重建不会把用户参数洗回默认。
export function applyWMul(B){
  if(!B.mb)return;
  if(B.mMul&&B.mMul!==1){
    B.mass=B.mMul;
    if(B._natMass&&!B.mb.isStatic)Matter.Body.setMass(B.mb,B._natMass*B.mMul);
  }
  applyWFrict(B);
  applyWBounc(B);
  applyEffRest(B);     // 高中模式默认弹性全 0：effRest 读 PHYS_MODE；applyWFrict/applyWBounc 有 null 守卫不调它，默认体也要在这里刷
}
/* 自算的库仑摩擦（逐子步，挂在引擎 afterUpdate 上，见 ensureMatter；此时本子步的接触对表是新的）。
 * dv = μ·g·dt，与质量无关（滑行距离 ∝ 1/μ），方向与当前速度相反；只刹到停、不反向，静摩擦交给接触求解器。
 * 只处理本子步有活动接触且用户显式调过 μ 的 W 体（_ownFric），其余体不受影响。 */
export function wfSelfFriction(dt){
  if(!MW||!MW.engine)return;
  var list=MW.engine.pairs.list,any=0,i,k,B,pr;
  for(i=0;i<bodies.length;i++)if(bodies[i]&&bodies[i]._ownFric){any=1;break;}
  if(!any)return;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(!B||B.dead||B.kind!=='W'||!B.mb||B.mb.isStatic||!B._ownFric)continue;
    var mu=B.wFrict;
    if(!(mu>0))continue;                       // μ=0 = 真正光滑
    var touch=false;
    for(k=0;k<list.length;k++){
      pr=list[k];
      if(pr&&pr.isActive&&(pr.bodyA===B.mb||pr.bodyB===B.mb)){touch=true;break;}
    }
    if(!touch)continue;
    var v=B.mb.velocity;
    if(!v)continue;
    var sp=Math.hypot(v.x,v.y);
    if(!(sp>1e-9))continue;
    /* 单位换算：Matter 0.19 Body.update 中 velocity 是每子步位移（px/子步），重力项为 (force/mass)·deltaTime²，
     * 所以减速度 a=μ·g 折算到存储口径要乘 dt²。
     * 校核：μ=1、v0=500px/s ⇒ kk=0.04514 px/子步 ⇒ 46 子步(0.192s)停 ⇒ 滑行 48px = v²/(2μg)。
     * 不要写成 μ·g·dt：大 240 倍，几帧就停住。 */
    var kk=mu*GRAV*dt*dt;
    if(kk>sp)kk=sp;
    var ux=v.x/sp,uy=v.y/sp;
    /* Matter 0.19 的 Body.setVelocity 入参是 _baseDelta(16.667ms) 单位，内部乘 deltaTime/_baseDelta
     * （子步 4.1667ms ⇒ 0.25）再存，而 body.velocity 读出的是 px/子步，两者差这个因子。
     * 不补的话实测减速度只有 μ·g 的 1/4。用 Matter 自己的换算因子，别写死 4。 */
    var _bd=Matter.Body._baseDelta||16.6667;
    var _ts=(B.mb.deltaTime||_bd)/_bd;
    if(!(Math.abs(_ts)>1e-6))_ts=1;
    var kIn=kk/_ts;
    Matter.Body.setVelocity(B.mb,{x:v.x-ux*kIn,y:v.y-uy*kIn});
  }
}
export function applyWFrict(B){
  if(!B.mb)return;
  // wFrict 为 null（用户没调过）时绝不能写 mb.friction=undefined：求解器会算出 NaN，物体飞出屏幕。
  // 未调过的体按当前模式写回确定的默认值（高中 0；大学 WFRICT_DEF，与 buildMatterBody 同一套默认）：
  //   · 高中模式必须真写 0，否则面板读数（wEffMu）为 0 而物理仍按 0.08 咬合，读数与物理不同源；
  //   · 大学模式也不能早退，否则高中→大学往返后 mb.friction / frictionStatic 残留高中的 0，
  //     frictionStatic=0 让 pair fs 钉在 0，调任何参数都像没调。
  // 用户显式调过的（wFrict!=null）两种模式下都只同步、不改用户值。
  var v=(B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;
  if(v==null)return;
  B.mb.friction=v;
  // μ=0 → 动/静摩擦全 0 = 真正光滑；μ>0 → 静摩擦至少 0.6，停下的物体仍站得稳。frictionStatic 不影响动摩擦，二者可解耦。
  // 不要让小 μ 时静摩擦跟着变小（如 μ=0.1 ⇒ 0.1）：物体会停不稳。
  /* 静摩擦经 wfStaticOf 跟随 μ：写死常数时有效摩擦完全由它决定（实测 μ=0.05/0.3/1.0 减速度恒为 1500px/s²），调 μ 无反应。
   * 只放开 μ>WF_STATIC_CAP（静态框侧已抬到 1，见 ensureMatter，配对取 min 后上限就是物体自己）；μ≤cap 不变，默认手感不变。 */
  B.mb.frictionStatic=wfStaticOf(v);
  /* 用户显式调过 μ 的 W 体（wFrict!=null）改走自算库仑摩擦 wfSelfFriction，这里关掉 Matter 自己的摩擦通道
   * （friction=0），避免两个来源叠加。
   * 原因：Matter 的摩擦按每个接触点各施 friction×N 的冲量，方块躺在平地上有 2 个接触点，
   * 实测减速度 ≈ 0.65g + 1.7·μ·g（不是 μg），μ=0.6 与 1.0 滑行距离只差 15%。
   * 自算口径 = 教科书库仑摩擦：切向减速度 μ·g，与质量无关，0~1 量程线性。默认体（0.08）行为不变。 */
  var _own=(B.wFrict!=null);
  B._ownFric=_own;
  B.mb.friction=_own?0:v;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++){ps[i].friction=_own?0:v;ps[i].frictionStatic=wfStaticOf(v);}
  refreshWPairs(B);
  applyEffRest(B);     // μ=0 极值体的体级弹性 = 1（见 effRest；调 μ 也会改变生效弹性）
  applyWAir(B);
}
// 把用户调过的弹性（wBounc）应用到 Matter 体上。不做 null 早退：未调过的体也要按当前模式写回默认，
// 否则模式往返后残留上一模式的值。写入全交给 applyEffRest（effRest 覆盖全部情形：调过 = 用户值；
// 没调过 = 模式默认（高中 0 / 大学圆 BALL_REST、其它 0）；显式 μ=0 = 1）。
// ⚠ 不要在这里手搓默认值再覆盖：会把 μ=0 极值体的 rest=1 洗回 0.52/0。applyEffRest 写的永远是确定数值，不会是 undefined。
export function applyWBounc(B){
  if(!B.mb)return;
  applyEffRest(B);     // 见上：唯一写入点，四种情形全在 effRest 里
  refreshWPairs(B);
  applyWAir(B);
}
// 生效弹性 = 用户旋钮（wEffE）受 μ 极值语义覆盖：显式 μ=0 的体 → 1。
// 必须在体级生效：若只在帧末 refreshAllPairs 把 pair.restitution 置 1，子步内 Matter 仍按双方 body.restitution
// 取 max（e=0 → 0）做非弹性求解，曲面滑移每子步的法向接近速度被杀掉（凹槽实测损耗 ~0.28/子步，球越滑越低）。
// 体级为 1 时新 pair 创建即带 1，子步内直接弹性求解；EL_Z 恢复只作残余兜底（预算门照旧，不会过补）。
export function effRest(B){
  // 极值语义只在用户显式声明 μ=0 时成立：高中模式的默认 μ=0 是教学默认值，不能把体级 e 抬到 1，
  // 否则「高中默认弹性全 0」失效（全场每一对 rest=1）。见 wMuIdeal。
  if(wMuIdeal(B))return 1;
  return wEffE(B);
}
export function applyEffRest(B){
  if(!B.mb)return;
  var r=effRest(B);
  B.mb.restitution=r;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].restitution=r;
}
// 空气阻尼 frictionAir 与 μ、e 联动（applyWAir，未显式设 wAir 时）：
//   air = defAir × min(1, μ/0.08) × (1 − e)
//   · μ=0 → air=0：完全光滑，匀速滑行；e=1 → air=0：完全弹性，一直弹；
//   · 默认（μ=0.08, e=0）→ air=defAir；默认球（e=BALL_REST=0.52）air 略小，弹跳衰减本由 restitution 主导。
// 否则 air 会独立泄能：实测 μ=0 时 2s 内 vx 6.4→2.5；e=1 时弹跳峰高 600→308→190（air=0 后 562→557→541）。
// μ / e 未调过时按默认值（0.08 / 圆 BALL_REST、其它 0）参与计算。
export function wEffMu(B){return (B.wFrict==null)?(PHYS_MODE==='high'?0:WFRICT_DEF):B.wFrict;}
// 高中模式未调过的体默认 μ=0（wEffMu）。μ=0 的极值语义（air 归零 / 禁用睡眠 / pair rest=1 / 体级 e=1）
// 必须按显式声明判定（wMuIdeal：wFrict===0），不能用 wEffMu(B)===0：否则高中默认 μ=0 让全场 W 体都进 EL_Z，
// refreshAllPairs 把每一对 restitution 抬到 1，「高中默认弹性全 0」被推翻（全场永远弹）。
// 极值语义是用户声明的「理想光滑面」，不是教学默认值。
export function wMuIdeal(B){return !!B&&B.wFrict===0;}
// 高中模式：未调过的体默认弹性全 0（不给圆 BALL_REST）；显式调过 wBounc 的不受影响。effRest 的 μ=0 极值覆盖仍优先。
export function wEffE(B){return (B.wBounc==null)?(PHYS_MODE==='high'?0:((B.wshape==='circle'&&B.rad)?BALL_REST:0)):B.wBounc;}
// 空气阻力 frictionAir 独立于弹簧阻尼（sdamp 只管弹簧自身的 -D·v），Matter 默认 0.01/帧约 1.2s 能量减半，
// 所以开放成参数 wair：设 0 + sdamp=0 = 理想简谐振荡。
export function wAirDef(B){if(PHYS_MODE==='high')return 0;return (B.wAir!=null)?B.wAir:WAIR_GLOBAL;}   // 出厂默认 0；高中恒 0；未设置的体回退全局 WAIR_GLOBAL
export function applyWAir(B){
  if(!B.mb)return;
  // 高中模式不算空气阻力：忽略显式 wair，frictionAir 恒 0。
  if(PHYS_MODE==='high'){
    B.mb.frictionAir=0;
    var psH=B.mb.parts||[];
    for(var qH=0;qH<psH.length;qH++)psH[qH].frictionAir=0;
    return;
  }
  // 显式设过 wAir 时它就是权威值，不再被 μ/e 联动乘掉。
  if(B.wAir!=null){
    B.mb.frictionAir=B.wAir;
    var ps8=B.mb.parts||[];
    for(var q8=0;q8<ps8.length;q8++)ps8[q8].frictionAir=B.wAir;
    return;
  }
  var air=wAirDef(B)*Math.min(1,wEffMu(B)/WFRICT_DEF)*(1-Math.min(1,wEffE(B)));
  B.mb.frictionAir=air;
  var ps=B.mb.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].frictionAir=air;
}
// pair 级空气阻尼归零：pair 有效摩擦（min）=0 或有效弹性（max）≥1 时，双方（含复合体 parts）的 frictionAir 全部归零，
// 完全光滑/完全弹性的接触里不允许第三条泄能通道。只做体级联动不够：球贴着 μ=0 的弧/凹槽滚动时，
// 球自己（未调过）的 frictionAir≈0.0067 仍在逐帧泄能。脱离接触后下一帧由 refreshAllPairs 按各自语义恢复。
export function wZeroAir(m){
  m.frictionAir=0;
  var ps=m.parts||[];
  for(var i=0;i<ps.length;i++)ps[i].frictionAir=0;
}

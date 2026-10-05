/* 参数系统、参数面板、复制、垃圾桶 / 删除（原 index.html 第 8970–10591 行） */
/* ================= PARAMETER SYSTEM (right-click -> 参数 slider + input) =================
 * Every designer letter exposes a real physics parameter that feeds the simulation:
 *   m/M  mass   -> collideBodies impulse share + binary-star m1·r1=m2·r2 + well mass
 *   g    gravity-> stepPhysics fall acceleration (GRAV / mass)
 *   a    accel  -> stepPhysics hasA thrust (AACC / mass)
 *   v    bounc  -> wall/ground restitution e (0=viscous … 1=elastic) & collision e
 *   μ    frict  -> wall friction drag multiplier (0..1 per wall hit; 1 = no friction)
 *   r    scale  -> body visual + collision radius & orbit R; well GMm/r² range
 *   B    Bz     -> magnetic Lorentz turning strength (B_FIELD*Bz)
 *   E    Eacc   -> electric field force (E_FIELD_ACC * E)
 *   I    Iacc   -> current magnetic force (A_FORCE * I)
 * Values are stored per-body in B.param (so two m's can have different masses); the
 * in-place value also lives back on the letter symbol (B.paramVal) so a right-click
 * re-open shows the last set value. min/max pick sane gameplay ranges.
 */
var PF={};
function pv(B,k,d){var v=B.param?B.param[k]:null;return (v===null||v===undefined||isNaN(v))?d:v;}
// 比例尺 260 px = 1 m：默认重力 2600 px/s² 显示为 10 m/s²，画布高约 3.5 m。
// 内部计算全部仍是 px；换算只发生在参数面板的显示/输入层：SI 显示值 = 内部值 / siK。
// 1 单位质量 = 1 kg；k 的 N/m 是标称值 —— F=ks·Δx 按 F=ma 走加速度通道时，
// kg/s² 的数值与内部值一致（px 与比例尺在分式里约掉）。
var PX_PER_M=260;
/* 传送带默认带速 CONV_DEF = 130 px/s = 0.5 m/s（内部一律 px/s，面板显示时才除以 PX_PER_M）。
 * 必须声明在 PARAM_DEFS 之前：参数表的 def:CONV_DEF 在对象字面量求值时取值，
 * var 只提升声明不提升赋值，声明在后面会取到 undefined。全文件只此一处声明。
 * 取 0.5 而非 1.0：传送带放下去电机就在转，默认太快货物会被甩远，用户容易误判为器件坏了。 */
var CONV_DEF=Math.round(0.5*PX_PER_M);
/* 必须声明在 PARAM_DEFS 之前（同 CONV_DEF）：gndlen 的 def 在对象字面量求值时取值，
 * 声明在后则为 undefined ⇒ 点「默认」时 applyParam 把它当 0 ⇒ 被 clamp 到量程下限 60px 而非 260px。
 * 全文件只此一处声明。 */
var GROUND_SPAWN_LEN=260;
/* 出生尺寸常量区：所有器件的出生尺寸常量都集中在这里。
 * ① PARAM_DEFS 里 slen.def:SPR_SPAWN_LEN 这类写法在对象字面量求值时取值，
 *    var 只提升声明不提升赋值 ⇒ 常量必须声明在参数表之前，否则是 undefined（点「默认」掉到量程下限）。
 * ② 这是「默认值 == 出生值」不变式的唯一真源：只改这里一个数，参数表默认值机械跟随。
 *    不要在别处重复声明或在 PARAM_DEFS 里写死数字，否则两处会漂移（曾出现出生 110 / 默认 170）。 */
var SPR_SPAWN_LEN=110;    // 弹簧：= makeSpring 长度钳制 clamp(d,110,340) 的下限
var ROPE_SPAWN_LEN=110;   // 轻绳：与弹簧同款「拖出来即可用」的默认长度
var ROD_SPAWN_LEN=170;    // 轻质杆：= makeRod 的默认，也是 vt 拼接实际得到的长度
var BELT_SPAWN_LEN=260;   // 传送带：矩形宽（带子长度暂不可调，只影响出生尺寸）
// 铰链折角限位（度）。折角 = 「销→宿主0中心」与「销→宿主1中心」夹角相对连接那一刻的偏差，
// 超过 ±限位 即投影回边界（硬限位）。无限位时挂在销下的方块被踢一脚能整圈转、钻进固定块。
// 面板上只有「固定铰链」开关，没有可调角度：
//   · 关闭（默认）= 完全光滑铰链，相对转动不受限；防穿模由碰撞解算保证（两宿主保持互相碰撞，见 springSyncGroups），
//     不靠限制转角。
//   · 开启 = 刚接：限位角取 0°，折角冻结在开启那一刻的构型上。
// HINGE_FOLD_DEF=90 已不是面板默认，仅保留名字供回归脚本引用。
var HINGE_FOLD_DEF=90;
var HINGE_FOLD_STEP=0.08;   // 限位回转每子步限步（rad），防传送瞬滑（见 hingeFoldLimit）
var HINGE_FOLD_DMAX=2;      // 闭合门：两端距离超过此值视作「未钉合成销」，限位跳过
// 上限只保留物理上真实存在的：弹性 e∈[0,1]、空气阻力 <1（它是每帧速度占比，≥1 会把速度反向）；
// μ>1 是物理的（橡胶-玻璃 ≈2），质量/长度/刚度/阻尼均无上限。
// 滑块 min/max 只是可视化量程（数字输入框不受限），真正的硬边界在 applyParam。
var PARAM_DEFS={
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
// 参数标签随模式切换：同一个 sdamp 字段在大学模式是 Rayleigh 阻尼系数 D（有量纲），
// 高中模式是阻尼比 ζ（无量纲，见 springDamp）。
function paramLabel(spec){
  if(spec&&spec.key==='sdamp'&&PHYS_MODE==='high')return '阻尼比 ζ';
  return spec?spec.label:'';
}
// which PARAM_DEFS entry a SINGLE letter exposes (right-click m -> mass, g -> grav, ...).
// Returns the spec id, or null when the letter has no adjustable param.
// v is special: on a vt-ROD (kind 'T') it controls the ROD LENGTH (rodlen); on a formula
// body it stays the bounce/elasticity (bounc) — "v 改变的还是 vt 后的线段的长度".
function specIdForLetter(d,B){
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
function paramDef(B){
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
function paramDefForLetter(B,d){
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
function wBouncDef(B){
  if(PHYS_MODE==='high')return 0;                        // 高中模式：μ/e 全 0
  return (B&&B.wshape==='circle')?BALL_REST:0;
}
/* 面板「默认」按钮 / 输入框清空时统一从这里取回退值：
 *   ① 有动态口径（随本体而定）的参数用它（目前只有 wbounc）；
 *   ② 否则回落到静态的 spec.def。
 * 新增「默认值随本体而定」的参数时只改这一个分派点 + 加一个 <x>Def(B) 函数，
 * 不要在按钮/输入框调用点各写一套表达式。 */
function paramDefVal(B,spec){
  if(!spec)return 0;
  if(spec.key==='wbounc')return wBouncDef(B);
  return spec.def;
}
function paramV(B,id){
  var spec=PARAM_DEFS[id];
  /* 赋予型参数的读取：Δt 读全局量；v/a/q 的值存在宿主字段或字符（paramLetter）上。
   * 缺了读取分支面板会一直显示 spec.def，与真实值不同步。 */
  if(id==='tscale')return TIME_SCALE;
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
function applyParam(B,spec,val){
  val=+val||0;
  if(!B.param)B.param={};
  B.param[spec.key]=val;
  var key=spec.key;
  /* 按数值途径写入 vsize 时退出光速态（不重渲染，免得正在编辑的输入框失焦）。
   * 光速态原本只由 bossFinish/bossAbort 复位，不在这里退出的话面板会被锁在「c = 光速」改不回数字。
   * 输入 c 走 keydown 里的 bossLightOn，不受这里影响。 */
  if(key==='vsize'&&typeof bossLightState==='function'&&bossLightState()
     &&typeof bossLightReset==='function')bossLightReset(true);
  /* 赋予型参数的写入：Δt 写全局 TIME_SCALE；v 的大小/方向写字符字段；
   * q 的电荷写字符 qCharge；物体的电荷写 B.charge（并同步 Matter 体的电荷渲染）。 */
  if(key==='tscale'){
    TIME_SCALE=(val<0)?0:(val>20?20:val);
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
    if(B.kind==='T')setRodLen(B,val,true);
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
// 从 seed 出发沿「弹簧 ↔ 宿主」锚定关系走到底，得到整个装配体的成员。
// 「复制整体」的唯一来源：点弹簧或点其中一个物体都得到同一套成员。
function springAssemblyOf(seed){
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
// 复制一个画出来的线/图形（W 体）。
// W 体不能走 spawnField('W')：那会造出没有 B.pts 的畸形体，drawBoundaries / nearInk / distToHost
// 每帧读 B.pts[0] 抛异常，rAF 链断掉、页面卡死。
function copyWBody(src,dx,dy,quiet){
  if(!src||src.kind!=='W'||!src.pts||src.pts.length<2)return null;
  // 直接把 src 的**本地** pts 平移过去（不把转角烘进点里）：mkBoundary 会按同样的点算出同样的
  // 质心，于是 B.pts / B.ell / B.notch 全落在与源完全一致的本地坐标系里，转角单独用 th 还原。
  var p=[],i;
  for(i=0;i<src.pts.length;i++)p.push([src.pts[i][0]+src.x+dx,src.pts[i][1]+src.y+dy]);
  var opt={shape:src.wshape||'poly',rad:src.rad||0,closed:!!src.closed,notch:src.notch||null};
  if(src.ell)opt.ell={cx:src.x+src.ell.lcx+dx,cy:src.y+src.ell.lcy+dy,
                      rx:src.ell.rx,ry:src.ell.ry,a0:src.ell.a0,a1:src.ell.a1};
  // 凹槽真弧元数据随副本平移（本地 -> 世界，mkBoundary 会再转回本地）
  if(src.arcs)opt.arcs=src.arcs.map(function(a){
    return {i0:a.i0,i1:a.i1,cx:src.x+a.lcx+dx,cy:src.y+a.lcy+dy,
            mx:src.x+a.lmx+dx,my:src.y+a.lmy+dy,r:a.r};});
  var B=mkBoundary(p,opt);
  if(!B)return null;
  if(src.th){B.th=src.th;if(B.mb)Matter.Body.setAngle(B.mb,src.th);}
  B.sc=src.sc||1;
  // 副本继承用户调过的质量乘数、摩擦系数与弹性（applyWMul 走 B.mb 已就位的路径）
  if(src.mMul)B.mMul=src.mMul;
  if(src.wFrict!=null)B.wFrict=src.wFrict;
  if(src.wBounc!=null)B.wBounc=src.wBounc;
  applyWMul(B);
  /* 器件身份也要复制：否则地面/墙面的副本会变成普通木板（无 gnd、参数面板不对）。
   * 已知限制：belt 的副本同样会丢身份，尚未处理。 */
  if(src.gnd){B.gnd=1;B.len=src.len;B.hw=(src.len||GROUND_SPAWN_LEN)/2;B.hh=src.hh||GROUND_TH/2;}
  if(src.fixed){B.fixed=true;if(B.mb&&MW){Matter.Body.setStatic(B.mb,true);Matter.Sleeping.set(B.mb,false);}}
  B.pop=1;B.orbPulse=1;B.copied=true;
  // 注意：**不能** refresh(B)。refresh 走 layoutField，而 layoutField 只为 S/T 分支做了处理，
  // 落到 'W' 时会执行 `B.fg.body=B` —— W 体没有 fg，直接抛 "Cannot set properties of null"，
  // 而且它先一步写的 `B.glyphs=[null]` 已经污染了数组，之后每帧渲染读 glyph.dead 全部炸。
  if(!quiet)ringGo(B.x,B.y);
  return B;
}
function copySpringBody(src,dx,dy,quiet){
  var sdx=src.e1.x-src.e0.x,sdy=src.e1.y-src.e0.y;
  // 复制按标志分派（铰链两端重合，用 sdx/sdy 造会退化成长度 1 的假弹簧）。
  var ns=src.hinge?makeHinge(src.x+dx,src.y+dy)
        :src.rope?makeRope(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy)
        :makeSpring(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy);
  if(ns.rope)ns.len=src.len;
  else if(!ns.hinge){ns.len=src.len;ns.ks=src.ks;}
  if(src.dirLock)ns.dirLock={mx:src.dirLock.mx+dx,my:src.dirLock.my+dy,
                             ux:src.dirLock.ux,uy:src.dirLock.uy,
                             auto:!!src.dirLock.auto};   // 导轨随副本平移，auto 标记一并继承
                             // （漏掉 auto：高中模式复制出来的弹簧会开始冻结宿主自转）
  refreshSpringGeom(ns);
  ns.pop=1;ns.orbPulse=1;ns.copied=true;
  if(!quiet)ringGo(ns.x,ns.y);
  return ns;
}
// R60c：整体复制。成员一起平移 (dx,dy)，弹簧按**本地偏移原样**重新锚到宿主的副本上，
// 于是复制出来的装配体与原装配体几何完全一致（相对位置、锚点、自然长度、劲度全保留）。
function copyAssembly(src,mem){
  var dx=56,dy=44,i,j,pairs=[];
  for(i=0;i<mem.length;i++){
    var O=mem[i],C=null;
    if(O.kind==='W')C=copyWBody(O,dx,dy,true);
    else if(O.kind==='S')C=copySpringBody(O,dx,dy,true);
    else if(O.kind==='T'||O.kind)continue;      // 杆/场源先不进装配体复制（保持旧行为）
    if(C)pairs.push([O,C]);
  }
  for(i=0;i<pairs.length;i++){
    var O2=pairs[i][0],C2=pairs[i][1];
    if(O2.kind!=='S')continue;
    for(j=0;j<2;j++){
      var a=O2.anc[j];if(!a||!a.B)continue;
      var cp=null;
      for(var k2=0;k2<pairs.length;k2++)if(pairs[k2][0]===a.B){cp=pairs[k2][1];break;}
      if(cp)C2.anc[j]={B:cp,ox:a.ox,oy:a.oy};        // 本地偏移照搬 = 几何复制
    }
    springSyncEnds(C2);
  }
  var focus=null;
  for(i=0;i<pairs.length;i++)if(pairs[i][0]===src){focus=pairs[i][1];break;}
  focus=focus||(pairs.length?pairs[0][1]:null);
  if(focus)ringGo(focus.x,focus.y);
  springSyncGroups();
  return focus;
}
function copyBody(src){
  if(!src)return;
  // 装配体必须整体复制：成员 >1 走整体复制；单体才走各自的复制逻辑。
  var mem=springAssemblyOf(src);
  if(mem.length>1){
    var hasS=false,hasW=false;
    for(var mi=0;mi<mem.length;mi++){
      if(mem[mi].kind==='S')hasS=true;
      if(mem[mi].kind==='W')hasW=true;
    }
    if(hasS&&hasW){var got=copyAssembly(src,mem);sortPanel();return got;}
  }
  if(src.kind==='S'){
    // 弹簧：复制一条同长同角度的新弹簧（锚点不复制 —— 新弹簧从「没接上」开始）
    var ns=copySpringBody(src,56,44,false);
    sortPanel();
    return ns;
  }
  if(src.kind==='W'){
    // 画出来的线/图形：按几何原样复制（不能落到下面的 if(src.kind) 场源分支，见 copyWBody）。
    return copyWBody(src,56,44,false);
  }
  if(src.kind==='T'){
    // copy a vt-rod: a fresh rod of the same length + rotation
    var nr=makeRod(src.x+48+Math.random()*40-20,src.y+42+Math.random()*30-15,0,0);
    nr.th=src.th||0;nr.len=src.len||170;nr.hw=nr.len/2+2;
    /* 副本带上反棘轮目标长度 _rodL（rodSyncAnchors 计算 err 的基准），
     * 否则惰初始化前的那一帧 err 会按旧值算。 */
    nr._rodL=src._rodL||nr.len;
    nr.pop=1;nr.orbPulse=1;nr.copied=true;
    refresh(nr);
    ringGo(nr.x,nr.y);
    return nr;
  }
  if(src.kind){
    // 场源复制（B / q / I / E）：复制同种场源并保留方向/极性（E 保留 th，B 保留 Bz，q/I 保留符号）。
    var nb=spawnField(src.kind,src.x+48+Math.random()*40-20,src.y+42+Math.random()*30-15,0,0);
    if(src.kind==='E'){nb.th=src.th||0;if(src.er)nb.er={l:src.er.l,r:src.er.r,t:src.er.t,b:src.er.b};}
    else if(src.kind==='B'){nb.Bz=src.Bz;}
    else if(src.kind==='q'){nb.qsign=src.qsign;}
    else if(src.kind==='I'){nb.Isign=src.Isign;}
    nb.pop=1;nb.orbPulse=1;nb.copied=true;
    refresh(nb);
    ringGo(nb.x,nb.y);
    sortPanel();
    return nb;
  }
  var ch=(src.massG&&src.massG.type==='M')?'M':'m';
  var massN=GD(ch);
  massN.pop=0;
  var B=BODY(src.x+40+Math.random()*60-30,src.y+30+Math.random()*40-20);
  B.massG=massN;
  massN.body=B;
  var old=B.glyphs;
  B.glyphs=[];B.mem=[];
  var mm=[];
  for(var i=0;i<src.mem.length;i++){
    var c2=src.mem[i].type;
    var g2=GD(c2);g2.pop=0;
    B.mem.push(g2);
    mm.push(g2);
  }
  var list=[massN].concat(mm);
  list.forEach(function(g){g.body=B;g.inBody=true;g.prev={x:0,y:0};B.glyphs.push(g);});
  refresh(B);
  B.pop=1;
  B.orbPulse=1;
  B.copied=true;
  // carry over any per-body physics params the source had (mass/grav/acc/bounc/frict/scale…)
  if(src.param)for(var pk2 in src.param)if(src.param.hasOwnProperty(pk2))B.param[pk2]=src.param[pk2];
  if(B.param.mass!=null)B.mass=B.param.mass;   // refresh() ran before the copy — sync B.mass manually
  if(B.param.massM!=null)B.massCap=B.param.massM;   // capital-M mass (independent key)
  if(B.scaleParam!=null)refresh(B);
  ringGo(B.x,B.y);
  var ms=slot(B,B.massG);
  B.x+=src.x-ms.x;B.y+=src.y-ms.y;
  refresh(B);
  B.vx=60;B.vy=-40;
  sortPanel();
}
/* ================= PARAM PANEL (per-letter rows: slider + number + 默认) ================= */
var paramBody=null,paramLetter=null,paramRows=[];
// 当前展开的配对行（'mu' = 摩擦、'e' = 弹性；null = 都没展开，接触区按摩擦口径）。
var pairOpenField=null;
function openParams(B,d){
  if(!B)return;
  var ids=(d)?paramDefForLetter(B,d):paramDef(B);
  if(!ids.length)return;
  closeMenu();
  paramBody=B;
  paramLetter=d||null;
  paramRows=[];
  pairOpenField=null;   // 换成另一个物体 = 配对展开状态重置
  pbox.style.left=clamp(B.x-120,4,W-248)+'px';
  pbox.style.top=clamp(B.y+44,4,H-190)+'px';
  pbox.classList.add('on');
  renderParamPanel();
  // 先显示、再量实际尺寸、按视口收（面板行数变多时固定偏移会把底部顶出视口）。
  // 接触区行数每帧还会变，逐帧复收见 clampParamPanel。
  clampParamPanel();
}
// 参数面板视口收位。以当前 style 位置为基准夹紧，不追踪物体位置（物体移动时面板不能跟着瞬移），
// 只保证整块落在窗口内。接触区（updateParamContacts）每帧增减行高后调用。
function clampParamPanel(){
  if(!paramBody||!pbox.classList.contains('on'))return;
  var prr=pbox.getBoundingClientRect();
  if(prr.width<2)return;                       // 尚未渲染出来，没得量
  var l=parseFloat(pbox.style.left),t=parseFloat(pbox.style.top);
  if(isNaN(l))l=prr.left;
  if(isNaN(t))t=prr.top;
  pbox.style.left=clamp(l,4,Math.max(4,window.innerWidth-prr.width-6))+'px';
  pbox.style.top=clamp(t,4,Math.max(4,window.innerHeight-prr.height-6))+'px';
}
// 整块物体一次暴露多行参数时（GMm/r² 有 M/m/r、弹簧有 k/L₀/D、vt 杆有长度/质量），每行标注归属：
// 符号参数归它自己的字母，弹簧归 kx，杆归 vt，W 体归本体。
// 放在独立的 .pown span 里、不动 .plab 的文本（探针按 .plab 取标签）。
var PARAM_OWNER={mass:'m',massM:'M',grav:'g',acc:'a',bounc:'v',frict:'μ',scale:'r',
  bz:'B',eacc:'E',iacc:'I',rodlen:'vt 杆',rodmass:'vt 杆',
  sk:'kx 弹簧',slen:'kx 弹簧',sdamp:'kx 弹簧',
  wmass:'本体',wfrict:'本体',wbounc:'本体',wair:'本体',convspeed:'本体',beltangle:'本体',rlen:'本体'};
function renderParamPanel(){
  if(!paramBody)return;
  // 标题用编号名（圆1、弧1…），不显示裸 kind（'W'/'S'/'T'）。
  /* 针对某个字符打开面板（paramLetter 非空）时标题用字符本身：此时 paramBody 是临时参数宿主体
   * （openMenu 里的 mb，不在 glyphs/mem 里），bodyName() 只能编出「物体1」。 */
  ptitleEl.textContent=(paramLetter?paramLetter.ch:bodyName(paramBody))+' · 参数';
  var sub=[];
  if(paramLetter)sub.push(paramLetter.ch+' → '+specIdForLetter(paramLetter,paramBody));
  else sub.push(paramBody.mem.length?paramBody.mem.map(function(g){return g.type;}).join(' '):(paramBody.kind||''));
  pvalEl.textContent=sub.join(' ');
  var ids=(paramLetter)?paramDefForLetter(paramBody,paramLetter):paramDef(paramBody);
  prows.innerHTML='';
  paramRows=[];
  for(var i=0;i<ids.length;i++){
    var spec=PARAM_DEFS[ids[i]];
    // W 体的弹性/摩擦用「下拉框 + 逐物配对表」渲染，而不是普通滑块。
    if(paramBody.kind==='W'&&ids[i]==='wbounc'){appendPairRow(spec,'e');continue;}
    if(paramBody.kind==='W'&&ids[i]==='wfrict'){appendPairRow(spec,'mu');continue;}
    // 布尔参数（「固定铰链」开关）渲染成开/关按钮，不是滑块+数字框；
    // 复用设置面板 .sbtn/.sbtn.act 的选中视觉。
    if(spec.bool){
      var rowB=document.createElement('div');rowB.className='prow';
      var hdB=document.createElement('div');hdB.className='prhead';
      var lbB=document.createElement('span');lbB.className='plab';lbB.textContent=paramLabel(spec);
      var owB=document.createElement('span');owB.className='pown';
      owB.textContent=PARAM_OWNER[ids[i]]||'';
      owB.title='该参数归属的对象';
      owB.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
      var vlB=document.createElement('span');vlB.className='prval';
      hdB.appendChild(lbB);hdB.appendChild(owB);hdB.appendChild(vlB);
      var onB=!!+paramV(paramBody,ids[i]);
      vlB.textContent=onB?'已开启：角度定死（刚接）':'关闭：完全光滑（自由转动）';
      var tg=document.createElement('button');
      tg.className='sbtn'+(onB?' act':'');
      tg.style.cssText='align-self:flex-start;padding:5px 16px;border-radius:8px;font-size:13px';
      tg.textContent=onB?'已开启':'关闭';
      tg.title='开启后铰链两端的角度被定死在开启那一刻，不再能相对转动';
      tg.addEventListener('click',function(e){
        e.stopPropagation();
        applyParam(paramBody,spec,paramV(paramBody,spec.key)?0:1);
        renderParamPanel();
      });
      rowB.appendChild(hdB);rowB.appendChild(tg);
      prows.appendChild(rowB);
      continue;
    }
    var row=document.createElement('div');
    row.className='prow';
    var head=document.createElement('div');
    head.className='prhead';
    var lab=document.createElement('span');
    lab.className='plab';lab.textContent=paramLabel(spec);
    var own=document.createElement('span');
    own.className='pown';own.textContent=PARAM_OWNER[ids[i]]||'';
    own.title='该参数归属的对象';
    own.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
    var val=document.createElement('span');
    val.className='prval';
    head.appendChild(lab);head.appendChild(own);head.appendChild(val);
    var sl=document.createElement('input');
    sl.type='range';
    var nu=document.createElement('input');
    nu.type='number';
    var pb=document.createElement('div');
    pb.className='presets';
    row.appendChild(head);row.appendChild(sl);row.appendChild(nu);
    /* 可视化角度调节：方向行加一个可拖动的指向箭头圆盘，与数字框/滑块双向同步
     * （0° = 水平向右，屏幕坐标系向下为正）。 */
    if(spec.key==='vang'||spec.key==='aang'||spec.key==='waccang'){
      /* 圆盘由 vang / aang / waccang 三行共用，必须用 IIFE 逐行捕获自己那一行的 spec / sl / nu / val：
       * 不要写死 vang，也不要直接引用循环变量（函数作用域，循环结束后停在最后一行）
       * 或用 paramRows[paramRows.length-1] 取控件。 */
      (function(_spec,_sl,_nu,_val){
      var dial=document.createElement('div');
      dial.className='pdial';
      dial.style.cssText='width:44px;height:44px;flex:none;cursor:grab;touch-action:none;margin:2px 0 0 6px';
      /* 轮盘外观与 .ttoggle / .sbtn 一致：半透明白底 + 细边框 + 柔和阴影 + 四周刻度 + 圆头指针 + 中心小圆。 */
      var _ticks='';
      for(var _ti=0;_ti<12;_ti++){
        var _a=_ti*30*Math.PI/180, _r1=15.5, _r2=(_ti%3===0)?11.5:13.5;
        _ticks+='<line x1="'+(22+Math.cos(_a)*_r1).toFixed(2)+'" y1="'+(22+Math.sin(_a)*_r1).toFixed(2)
              +'" x2="'+(22+Math.cos(_a)*_r2).toFixed(2)+'" y2="'+(22+Math.sin(_a)*_r2).toFixed(2)
              +'" stroke="rgba(38,34,28,'+(_ti%3===0?'0.34':'0.18')+')" stroke-width="1" stroke-linecap="round"/>';
      }
      dial.innerHTML='<svg viewBox="0 0 44 44" width="44" height="44">'
        +'<circle cx="22" cy="22" r="17" fill="rgba(255,255,255,.62)" stroke="rgba(38,34,28,.22)" stroke-width="1"/>'
        +_ticks
        +'<line class="darw" x1="22" y1="22" x2="22" y2="5.5" stroke="#3E7C74" stroke-width="2.4" stroke-linecap="round"/>'
        +'<circle cx="22" cy="22" r="2.2" fill="#26221C" opacity=".72"/>'
        +'<circle class="dknob" cx="22" cy="5.5" r="4.2" fill="#3E7C74" opacity=".9"/></svg>';
      /* 0° = 水平向右 ⇒ 图形初始指向上(-90°)，旋转量 = deg+90 */
      var _setArrow=function(deg){
        var g=dial.querySelectorAll('.darw,.dknob');
        for(var _q=0;_q<g.length;_q++)g[_q].setAttribute('transform','rotate('+(deg+90)+' 22 22)');
      };
      _setArrow(paramV(paramBody,_spec.key)||0);   // 读本行的角度
      var _drag=false;
      dial.addEventListener('pointerdown',function(e){
        e.preventDefault();e.stopPropagation();_drag=true;dial.style.cursor='grabbing';
        if(dial.setPointerCapture)dial.setPointerCapture(e.pointerId);
      });
      dial.addEventListener('pointermove',function(e){
        if(!_drag)return;
        var r=dial.getBoundingClientRect();
        var cx=r.left+r.width/2, cy=r.top+r.height/2;
        var deg=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI;
        deg=Math.round(deg);
        _setArrow(deg);
        /* 与滑块/数字框同一入口写回参数（applyParam），写回字符也按本行分派。 */
        applyParam(paramBody,_spec,deg);
        if(paramLetter){
          if(_spec.key==='vang')paramLetter.vAng=deg;
          else if(_spec.key==='aang')paramLetter.aAng=deg;
        }
        /* 同步本行的滑块/数字框/读数 */
        _sl.value=deg;_nu.value=deg;
        if(_val)_val.textContent=fmtVal(deg,_spec);
      });
      dial.addEventListener('pointerup',function(e){_drag=false;dial.style.cursor='grab';});
      dial.title='拖动旋钮设定'+(paramLabel(_spec).replace('方向 θ','')||'')+'方向（0°=水平向右，向上为 −90°）';
      dial.addEventListener('pointerenter',function(){dial.style.filter='brightness(1.03)';});
      dial.addEventListener('pointerleave',function(){dial.style.filter='';});
      row.appendChild(dial);
      })(spec,sl,nu,val);   // IIFE 收口：每个圆盘只认自己那一行的 spec/控件
    }
    // 面板以 SI 单位显示/输入（SI = 内部/siK），内部仍是 px —— 滑块范围、步长一并换算。
    var kSI=spec.siK||1;
    var cur=paramV(paramBody,ids[i])/kSI;
    sl.min=spec.min/kSI;sl.max=spec.max/kSI;sl.step=spec.step/kSI;sl.value=cur;
    nu.value=Math.round(cur*1000)/1000;
    val.textContent=fmtVal(cur,spec);
    /* 光速态回显：面板重渲染（换体/点默认/拖圆盘）后保留「c = 光速」。
     * 滑块顶到最右（max 临时放宽到光速），数字框留空 + placeholder='c'。 */
    if(spec.key==='vsize'&&bossLightState()){
      sl.max=C_LIGHT;sl.value=C_LIGHT;
      nu.value='';nu.placeholder='c';
      /* 用 ≈ 而非 =：屏幕上是换算后的读数，与 bossLightOn 里的文案保持一致。 */
      val.textContent='c ≈ '+C_LIGHT+' m/s';
    }
    // single 默认 button: resets THIS row's param to its default value
    var dflt=document.createElement('button');
    dflt.textContent='默认';
    dflt.title='回到默认数值';
    // 用 IIFE 固定本行的 spec：spec 是函数作用域的循环变量，直接闭包引用会让每一行的
    // 「默认」都只重置最后一行的参数。paramBody 取全局引用即可（换体时 openParams 会整体重渲染）。
    dflt.addEventListener('click',(function(spec2){
      return function(e){e.stopPropagation();applyParam(paramBody,spec2,paramDefVal(paramBody,spec2));renderParamPanel();};
    })(spec));
    pb.appendChild(dflt);
    row.appendChild(pb);
    prows.appendChild(row);
    paramRows.push({spec:spec,sl:sl,nu:nu,val:val});
    sl.oninput=(function(spec2,B2,sl2,nu2,val2,k2){
      return function(){applyParam(B2,spec2,+sl2.value*k2);nu2.value=Math.round(+sl2.value*1000)/1000;val2.textContent=fmtVal(+sl2.value,spec2);};
    })(spec,paramBody,sl,nu,val,kSI);
    nu.onchange=(function(spec2,B2,nu2,sl2,val2,k2){
      return function(){
        var v=+nu2.value;
        /* 光速态下输入框是空的（placeholder='c'）。此时不要按「空 ⇒ 回默认值」处理，
         * 否则会把光速打回默认并清掉光速态；直接跳过，想改回数字就输入一个数。 */
        if((isNaN(v)||nu2.value==='')&&typeof bossLightState==='function'&&bossLightState())return;
        if(isNaN(v)||v==='')v=paramDefVal(B2,spec2)/k2;
        // number input has UNLIMITED range — no clamp here. The slider is clamped by
        // its own min/max (it will just rest at an endpoint for out-of-range values).
        applyParam(B2,spec2,v*k2);
        sl2.value=v;   // browser clamps the displayed slider position only
        nu2.value=Math.round(v*1000)/1000;
        val2.textContent=fmtVal(v,spec2);
      };
    })(spec,paramBody,nu,sl,val,kSI);
    // blur = apply immediately (same as pressing enter / firing change).
    // NOTE: capture the body in a CLOSURE — by the time blur fires, closeParams() may
    // already have nulled the global paramBody (document pointerdown runs first).
    nu.addEventListener('blur',(function(spec2,B2,nu2,sl2,val2,k2){
      return function(){
        var v=+nu2.value;
        /* 光速态下输入框是空的（placeholder='c'）。此时不要按「空 ⇒ 回默认值」处理，
         * 否则会把光速打回默认并清掉光速态；直接跳过，想改回数字就输入一个数。 */
        if((isNaN(v)||nu2.value==='')&&typeof bossLightState==='function'&&bossLightState())return;
        if(isNaN(v)||v==='')v=paramDefVal(B2,spec2)/k2;
        applyParam(B2,spec2,v*k2);
        sl2.value=v;
        nu2.value=Math.round(v*1000)/1000;
        val2.textContent=fmtVal(v,spec2);
      };
    })(spec,paramBody,nu,sl,val,kSI));
    // 回车 = 应用 + 交还焦点：否则焦点留在框里，后续按键仍被当成编辑，画布快捷键失效。
    nu.addEventListener('keydown',(function(nu2){
      return function(e){ if(e.key==='Enter'){e.stopPropagation();nu2.blur();} };
    })(nu));
    /* v 的大小框里输入字母 c ⇒ 数值变成光速。
     * <input type=number> 会吞掉字母（keydown 之后 value 变空），所以只能在 keydown 阶段捕获。只在 vsize 行生效。 */
    if(spec.key==='vsize'){
      nu.addEventListener('keydown',(function(nu2,val2){
        return function(e){
          if(e.key==='c'||e.key==='C'){
            e.preventDefault();e.stopPropagation();
            bossLightOn(nu2,val2);
          }
        };
      })(nu,val));
    }
  }
}
function fmtVal(v,spec){
  v=Math.round(v*1000)/1000;
  if(spec.unit==='×')return '× '+v;
  if(spec.unit)return v+' '+spec.unit;
  return ''+v;
}
function closeParams(){if(pbox)pbox.classList.remove('on');paramBody=null;paramLetter=null;}
// 每个物体都有稳定的中文名：首次请求时生成并缓存进 B._nm，之后即使前面同类物体被删也不变
// （否则按名字设好的配对系数会因改名而错位）。
function nameBase(B){
  if(!B)return '物体';
  if(B.kind==='W'){
    if(B.wshape==='circle'&&B.rad)return '圆';
    // 显示名「圆轨」，内部键仍是 'ring'。
    if(B.wshape==='ring'&&B.rad)return '圆轨';   // 空心圆
    if(B.wshape==='arc')return '弧';
    if(B.wshape==='tri')return '三角';
    if(B.wshape==='trough')return '半凹槽';
    if(B.wshape==='tub')return '凹槽';
    return B.closed?'图形':'线';
  }
  if(B.kind==='S'){
    if(B.hinge)return '光滑铰链';
    if(B.rope)return '轻绳';
    return '弹簧';
  }
  if(B.kind==='T')return '杆';
  if(B.kind==='B')return '磁场';
  if(B.kind==='E')return '电场';
  if(B.kind==='I')return '电流';
  if(B.kind==='q')return '电荷';
  var s='';
  if(B.massG&&B.massG.type)s+=B.massG.type;
  if(B.mem&&B.mem.length)for(var i=0;i<B.mem.length;i++)s+=B.mem[i].type;
  return s||(B.kind||'物体');
}
function bodyName(B){
  if(!B)return '—';
  if(B._nm)return B._nm;
  var base=nameBase(B),n=0;
  for(var i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(O===B)break;
    if(nameBase(O)===base)n++;          // 只数**排在它前面**的同名类，与缓存无关
  }
  B._nm=base+(n+1);
  return B._nm;
}
// 配对键：物体用惰性分配的稳定 _pid；引擎常驻静态体给它自己的短键。
var PID_SEQ=0;
function bodyPid(B){if(!B)return null;if(!B._pid)B._pid='b'+(++PID_SEQ);return B._pid;}
function peerKeyOf(B){
  if(!MW||!B)return B?bodyPid(B):null;
  if(B===MW.ground)return '@ground';
  if(B===MW.wl||B===MW.wr||B===MW.wt)return '@wall';
  return bodyPid(B);
}
function peerNameByKey(k){
  if(k==='@ground')return '地面';
  if(k==='@wall')return '墙';
  for(var i=0;i<bodies.length;i++){
    if(bodyPid(bodies[i])===k)return bodyName(bodies[i]);
  }
  return '（已移除）';
}
// 一对 (A,B) 实际生效的配对覆盖。返回 {e:…|null, mu:…|null}（null = 用默认规则）。
// 双方都显式设过同一条 → 取平均（不偏袒任一方）。
function pairOvAB(A,B){
  var ka=A?bodyPid(A):null, kb=B?bodyPid(B):null;
  var oa=(A&&A.pOv&&kb)?A.pOv[kb]:null;
  var ob=(B&&B.pOv&&ka)?B.pOv[ka]:null;
  function pick(f){
    if(oa&&ob){
      if(oa[f]!=null&&ob[f]!=null)return (oa[f]+ob[f])/2;
      return (oa[f]!=null)?oa[f]:ob[f];
    }
    var o=oa||ob;
    return o?(o[f]!=null?o[f]:null):null;
  }
  return {e:pick('e'),mu:pick('mu')};
}
function setPairOv(B,key,field,val){
  if(!B||!key)return;
  if(!B.pOv)B.pOv={};
  if(!B.pOv[key])B.pOv[key]={e:null,mu:null};
  B.pOv[key][field]=val;
  // A↔B 双向镜像写入：A 面板里设「相对于 B」的值，B 面板里「相对于 A」同步。
  // 只对能反查出场上实体的键联动（地面/墙没有面板，镜像进去是死数据，不写）；
  // 本体默认行（key=null）走 applyParam 不经这里。同 field 同值，last-write-wins。
  var peer=null;
  if(typeof key==='string'&&key.charAt(0)==='b'){
    for(var i=0;i<bodies.length;i++){
      if(!bodies[i]||bodies[i].dead)continue;
      if(bodyPid(bodies[i])===key){peer=bodies[i];break;}
    }
  }
  if(peer&&peer!==B){
    if(!peer.pOv)peer.pOv={};
    var rev=bodyPid(B);
    if(rev){
      if(!peer.pOv[rev])peer.pOv[rev]={e:null,mu:null};   // A↔B 双向镜像
      peer.pOv[rev][field]=val;
    }
  }
}
// 由 Matter 体反查实体（配对覆盖要用实体级字段，不能只看 mb）
function bodyOfMb(mb){
  if(!MW||!mb)return null;
  if(mb===MW.ground||mb===MW.wl||mb===MW.wr||mb===MW.wt)return null;
  for(var i=0;i<bodies.length;i++)if(bodies[i].mb===mb)return bodies[i];
  return null;
}
// Matter 体 -> 可读名字（接触区用）。ground/wall 是引擎常驻静态体，其余按 mb 反查实体，
// 用编号名（圆1/弧1/杆1…），与配对表标题同源。
function matterBodyLabel(mb){
  if(!MW)return '物体';
  if(mb===MW.ground)return '地面';
  if(mb===MW.wl||mb===MW.wr||mb===MW.wt)return '墙';
  for(var i=0;i<bodies.length;i++){
    if(bodies[i].mb===mb)return bodyName(bodies[i]);
  }
  return '物体';
}
// 配对表的行：本体默认 + 地面 + 墙 + 场上每一个其它物体
function pairPeers(B){
  var out=[{key:null,name:'本体默认'},
           {key:'@ground',name:'地面'},
           {key:'@wall',name:'墙'}];
  for(var i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(!O||O===B||O.dead)continue;
    out.push({key:bodyPid(O),name:bodyName(O)});
  }
  return out;
}
// 一行「下拉框 + 展开的配对表」。specId = 'wbounc'(弹性 e) 或 'wfrict'(摩擦 μ)。
// 结构保留 .prow/.prhead/.plab/.prval/.presets —— 探针按这些类名数行/取标签。
function appendPairRow(spec,field){
  var B=paramBody;
  var row=document.createElement('div');
  row.className='prow';
  var head=document.createElement('div');
  head.className='prhead';
  var lab=document.createElement('span');
  lab.className='plab';lab.textContent=spec.label;
  // μ / e 走这条独立渲染分支，归属标注也要在这里加。
  var own=document.createElement('span');
  own.className='pown';own.textContent=PARAM_OWNER[spec.key]||'';
  own.title='该参数归属的对象';
  own.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
  var val=document.createElement('span');
  val.className='prval';val.textContent=fmtVal(paramV(B,spec.key),spec);
  var dd=document.createElement('button');
  dd.className='pdd';dd.type='button';dd.textContent='配对 ▾';
  dd.title='展开：逐个物体设置这一对的碰撞系数（空 = 跟随默认规则）';
  head.appendChild(lab);head.appendChild(own);head.appendChild(val);head.appendChild(dd);
  row.appendChild(head);

  var pane=document.createElement('div');
  pane.className='ppairs';
  pane.innerHTML='<div class="pph"><span>物体</span><span>'+
                 (field==='e'?'弹性 e':'摩擦 μ')+
                 '</span><span></span></div>';
  // 面板重建时还原展开状态：pairOpenField 是模块级的，重建后 DOM 是新的，不还原则输入一个数展开就塌了。
  if(pairOpenField===field){pane.classList.add('on');dd.classList.add('open');dd.textContent='配对 ▴';}
  var peers=pairPeers(B);
  for(var i=0;i<peers.length;i++){
    (function(pe){
      var pr=document.createElement('div');
      pr.className='pprow';
      var nm=document.createElement('span');
      nm.className='ppn';nm.textContent=pe.name;
      var inp=document.createElement('input');
      inp.className='ppc';inp.type='number';inp.min=0;
      // 输入域的上限/步长取 spec（μ/e 都是 1 / 0.01），不要写死。
      inp.max=(spec.max!=null)?spec.max:1;
      inp.step=(spec.step!=null)?spec.step:0.01;
      inp.placeholder='默认';
      var cur=null;
      if(pe.key===null)cur=paramV(B,spec.key);
      else if(B.pOv&&B.pOv[pe.key])cur=(B.pOv[pe.key][field]!=null)?B.pOv[pe.key][field]:null;
      if(cur===null){inp.value='';}
      else{inp.value=Math.round(cur*1000)/1000;inp.classList.add('set');}
      var clr=document.createElement('button');
      clr.className='ppx';clr.type='button';clr.textContent='×';
      clr.title='清空该对的显式系数（回到默认规则）';
      pr.appendChild(nm);pr.appendChild(inp);pr.appendChild(clr);
      inp.onchange=(function(pe2,inp2){
        return function(){
          var raw=inp2.value;
          if(raw===''||raw===null||isNaN(+raw)){
            inp2.value='';inp2.classList.remove('set');
            if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));}
            else{setPairOv(paramBody,pe2.key,field,null);refreshPairUI();}
            return;
          }
          var v=clamp(+raw,0,(spec.max!=null)?spec.max:1);
          inp2.value=Math.round(v*1000)/1000;inp2.classList.add('set');
          if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],v);}
          else{setPairOv(paramBody,pe2.key,field,v);refreshPairUI();}
        };
      })(pe,inp);
      clr.onclick=(function(pe2,inp2){
        return function(){
          inp2.value='';inp2.classList.remove('set');
          if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));}
          else{setPairOv(paramBody,pe2.key,field,null);}
          refreshPairUI();
        };
      })(pe,inp);
      // 回车即完成输入（同主参数行）
      inp.addEventListener('keydown',(function(inp3){
        return function(e){ if(e.key==='Enter'){e.stopPropagation();inp3.blur();} };
      })(inp));
      pane.appendChild(pr);
    })(peers[i]);
  }
  dd.onclick=function(){
    var on=pane.classList.toggle('on');
    dd.classList.toggle('open',on);
    dd.textContent=on?'配对 ▴':'配对 ▾';
    // 下方接触区跟着最后展开的那一行走。
    // 这里不能调 renderParamPanel()（会重建面板、展开状态丢失）；接触区本就逐帧刷新，直接调一次即可。
    pairOpenField = on ? field : (pairOpenField===field ? null : pairOpenField);
    updateParamContacts();
    clampParamPanel();
  };
  row.appendChild(pane);
  var pb=document.createElement('div');
  pb.className='presets';
  var dflt=document.createElement('button');
  dflt.textContent='默认';
  dflt.title='本体回到默认数值，并清空本体的全部配对覆盖';
  dflt.addEventListener('click',function(e){
    e.stopPropagation();
    applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));
    paramBody.pOv=null;
    renderParamPanel();
  });
  pb.appendChild(dflt);
  row.appendChild(pb);
  prows.appendChild(row);
}
// 配对覆盖改动后，让 Matter 的**当前活动对**立刻按新值生效（否则要等重新接触）
function refreshPairUI(){
  if(paramBody&&paramBody.kind==='W')refreshWPairs(paramBody);
  if(paramBody)renderParamPanel();
}
// 参数面板开着且对象是 W 体时，列出全场所有对象（含地面/墙）的配对实际生效值：
// 接触中的显示 Matter pair 的实际值，未接触的显示按配对规则将要生效的值。
// （动摩擦 = 双方 min、静摩擦 = 双方 max；面板里调的 μ 只是本体那一份。）
function updateParamContacts(){
  if(!pcontacts)return;
  var show=paramBody&&paramBody.kind==='W'&&paramBody.mb&&MW&&pbox.classList.contains('on');
  if(!show){pcontacts.classList.remove('on');pcontacts.innerHTML='';return;}
  // 显示的量跟着展开的配对行走：展开 μ 看摩擦、展开 e 看弹性、都收起时看摩擦。
  // pairOpenField 由 appendPairRow 的配对按钮维护。
  var isE=(pairOpenField==='e');
  // 接触中的 Matter pair 索引（实际生效值优先于规则推算值）
  var map={},list=MW.engine.pairs.list,i;
  for(i=0;i<list.length;i++){
    var pr=list[i];
    var act=pr.isActive||((pr.bodyA.isStatic||pr.bodyA.isSleeping)&&(pr.bodyB.isStatic||pr.bodyB.isSleeping));
    if(!act)continue;
    var a=pr.bodyA.parent||pr.bodyA,b=pr.bodyB.parent||pr.bodyB;
    if(a===paramBody.mb)map[b.id]=pr;
    else if(b===paramBody.mb)map[a.id]=pr;
  }
  function muOf(O){                       // 对方的本体 μ（未接触时按规则推算用）
    if(O===MW.ground||O===MW.wl||O===MW.wr||O===MW.wt)return 0.6;
    if(O.kind==='W')return wEffMu(O);
    if(O.kind==='T')return 0.4;          // 杆镜像板的材质摩擦
    return null;                         // 公式体/场源：手写通道，无单一 μ 口径
  }
  function restOf(O){                     // 对方的本体 e（未接触时按规则推算用，地面/墙恒 0）
    if(O===MW.ground||O===MW.wl||O===MW.wr||O===MW.wt)return 0;
    if(O.kind==='W')return wEffE(O);
    if(O.kind==='T')return 0;            // 杆镜像板无弹性
    return null;
  }
  var rows='',n=0;
  function row(name,pr,muOther,restOther,muIdealOther,othMb){
    var txt;
    if(isE){
      if(pr)txt='e='+Math.round(pr.restitution*1000)/1000;   // 显式配对覆盖已写进 pr，直接用实际值
      else if(restOther!=null){
        var effE=Math.max(wEffE(paramBody),restOther);       // 默认规则：取双方 max
        // μ=0 极值 ⇒ rest=1 的显示与物理同源：只在显式声明 μ=0 时才算，
        // 否则高中模式默认 μ=0 会让每行都显示 e=1，而实际物理是 0。
        if(muIdealOther||wMuIdeal(paramBody))effE=1;
        txt='max 规则 → '+Math.round(effE*1000)/1000;
      }else txt='—';
    }else{
      if(pr)txt='μ='+Math.round(pr.friction*1000)/1000+'（静 '+Math.round(pr.frictionStatic*1000)/1000+'）';
      else if(muOther!=null){
        var eff=Math.min(wEffMu(paramBody),muOther);         // 默认规则：取双方 min
        txt='μ=min 规则 → '+Math.round(eff*1000)/1000;
      }else txt='—';
    }
    rows+='<div class="pc-r"><span>'+(pr?'● ':'○ ')+name+'</span><span>'+txt+'</span></div>';
  }
  row('地面',map[MW.ground.id],0.6,0,false,MW.ground);
  row('墙',map[MW.wl.id]||map[MW.wr.id]||(MW.wt?map[MW.wt.id]:null),0.6,0,false,MW.wl);
  for(i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(!O||O===paramBody||O.dead)continue;
    n++;
    row(bodyName(O),O.mb?map[O.mb.id]:null,O.mb?muOf(O):null,O.mb?restOf(O):null,wMuIdeal(O),O.mb);
  }
  pcontacts.classList.add('on');
  pcontacts.innerHTML='<div class="pc-t">全场对象 · 配对'+
                      (isE?'弹性 e':'摩擦 μ')+
                      '（● 接触中 / ○ 未接触）</div>'+rows;
  clampParamPanel();   // 接触行每帧增减，面板高度变了就重新夹紧
}
if(pclose)pclose.addEventListener('click',function(){closeParams();});
document.addEventListener('pointerdown',function(e){
  if(e.target.closest('#pbox')||e.target.closest('#menu'))return;
  closeParams();
});
function inTrash(x,y){
  var r=trash.getBoundingClientRect();
  return x>r.left-10&&x<r.right+10&&y>r.top-10&&y<r.bottom+10;
}
function inPanel(x,y){
  var r=panel.getBoundingClientRect();
  return x>r.left-12&&x<r.right+12&&y>r.top-12&&y<r.bottom+12;
}
/* 把支撑体拖走时唤醒压在它上面的睡眠体：Matter 的睡眠体不会因为脚下支撑消失而自己醒来，
 * 否则会悬在空中（是否睡着有随机性，所以表现为「有概率」）。删除体的同类处理见 killBody。
 * 只唤醒附近的：拖动是交互态，全场唤醒会白费休眠。 */
function wakeSleepNear(x,y,rad){
  if(!MW||!MW.engine||typeof Matter==='undefined'||!Matter.Sleeping)return 0;
  var bs=Matter.Composite.allBodies(MW.engine.world),n=0;
  for(var i=0;i<bs.length;i++){var b=bs[i];
    if(!b||b.isStatic||!b.isSleeping)continue;
    if(Math.hypot(b.position.x-x,b.position.y-y)<=rad){Matter.Sleeping.set(b,false);n++;}}
  return n;
}

function clearAll(){
  /* 清屏必须把黑洞特效状态一并复位（粒子/光环/合并态/终局态），否则粒子残留。 */
  try{
    if(typeof particles!=='undefined'&&particles&&particles.length)particles.length=0;
    if(typeof rings!=='undefined'&&rings&&rings.length)rings.length=0;
    if(typeof sparks!=='undefined'&&sparks&&sparks.length)sparks.length=0;
    if(typeof BH_MERGE!=='undefined')BH_MERGE=null;
    if(typeof BH_FINALE!=='undefined')BH_FINALE=null;
    /* 清屏会重新 dockLetter，布局回到默认 ⇒ 必须重跑 fixPanelSlot 重新施加面板排布。 */
    if(typeof fixPanelSlot==='function')setTimeout(fixPanelSlot,0);
  }catch(e){}
  /* 清空必须连约束一起清：clearAll 不走 killBody，那里的约束清理跑不到，
   铰链的真 Constraint 会残留并累积。体都没了，直接清空世界的 constraints 列表。 */
  if(MW&&MW.engine&&MW.engine.world&&typeof Matter!=='undefined'&&Matter.Composite){
    var _cs2=Matter.Composite.allConstraints(MW.engine.world);
    for(var _cj=_cs2.length-1;_cj>=0;_cj--)Matter.Composite.remove(MW.engine.world,_cs2[_cj]);
  }
  // if the black-hole finale is mid-flight, drop its letters and put the bin back home
  if(BH_FINALE){
    for(var fz=0;fz<BH_FINALE.letters.length;fz++){
      var Lz=BH_FINALE.letters[fz];
      if(!Lz.arr){Lz.arr=true;if(Lz.el&&Lz.el.parentNode)Lz.el.parentNode.removeChild(Lz.el);}
    }
    BH_FINALE=null;
  }
  resetTrashPos();
  for(var i=bodies.length-1;i>=0;i--){
    var B=bodies[i];
    for(var j=0;j<B.glyphs.length;j++){
      var g=B.glyphs[j];
      if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}
    }
    B.glyphs=[];B.mem=[];
    if(B.bh)B.bh.dead=true;
    removeMatterBody(B);
    bodies.splice(i,1);
  }
  if(MW)Matter.Composite.clear(MW.wLayer,false);   // W bodies & rod mirrors; static frame stays
  // 恢复面板单例：活着的回 dock；死掉的（被黑洞吞掉）从头重建，避免面板残缺。
  var kids=[mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO,kO,xO];
  var names=['mO','M2O','gO','aO','vO','rO','halfO','muO','cO','GO','tO','BO','EO','qO','IO','kO','xO'];
  for(var i2=0;i2<kids.length;i2++){
    var d=kids[i2];
    var fi=freeL.indexOf(d);if(fi>=0)freeL.splice(fi,1);
    if(d.dead){
      var nd=GD(d.ch);
      switch(names[i2]){
        case 'mO':mO=nd;break;case 'M2O':M2O=nd;break;case 'gO':gO=nd;break;case 'aO':aO=nd;break;
        case 'vO':vO=nd;break;case 'rO':rO=nd;break;case 'halfO':halfO=nd;break;case 'muO':muO=nd;break;
        case 'cO':cO=nd;break;case 'GO':GO=nd;break;case 'tO':tO=nd;break;case 'BO':BO=nd;break;
        case 'EO':EO=nd;break;case 'qO':qO=nd;break;case 'IO':IO=nd;break;
        case 'kO':kO=nd;break;case 'xO':xO=nd;break;
      }
      d=nd;
    }
    if(d.body){d.body=null;}
    d.inBody=false;d.state='dock';d.pop=0;d.vx=0;d.vy=0;d.fade=null;d.bhShed=0;d.bhFade=null;
    if(d.el&&d.el.parentNode!==panel)panel.appendChild(d.el);
    if(d.el){d.el.style.display='';d.el.style.fontSize='34px';
             d.el.style.left='';d.el.style.top='';d.el.style.transform='';d.el.style.opacity='';}
  }
  for(var k=freeL.length-1;k>=0;k--){killLetter(freeL[k]);freeL.splice(k,1);}
  for(var f=formulas.length-1;f>=0;f--){killFormula(formulas[f]);formulas.splice(f,1);}
  panel.style.opacity='';   // un-fade the panel after panel-eating has punched it
  // 清掉 dock 异常遗留的重复克隆：面板只保留规范单例，每格一个。
  var canon=[mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO,kO,xO];
  [].slice.call(panel.querySelectorAll('.char')).forEach(function(e){
    var keep=false;
    for(var ci=0;ci<canon.length;ci++)if(canon[ci].el===e){keep=true;break;}
    if(!keep&&e.parentNode===panel)panel.removeChild(e);
  });
  sortPanel();
  /* 清屏时一并收掉 boss。bossFinish 本身调用 clearAll()，所以要容忍 BOSS 已被置 null
   * （bossAbort 开头 if(!BOSS)return）；手动清屏时必须撤掉平台/遮罩/冻结的原型体。 */
  try{ if(typeof bossAbort==='function')bossAbort(); }catch(e){}
}
trash.addEventListener('dblclick',function(e){e.preventDefault();clearAll();});
/* 原生 dblclick 通道（捕获阶段）：双击锚定端/锚定点 ⇒ 断开该端锚定。
 * 不依赖 pointerdown 的 dblState 路径（手柄与其它分支会把它吃掉）。 */
DD.addEventListener('dblclick',function(e){
  var x=e.clientX,y=e.clientY;
  if(typeof springDisconnectAtPoint==='function'&&springDisconnectAtPoint(x,y)){
    if(grab){grab.kind=null;grab.obj=null;}
    if(typeof dblState!=='undefined'&&dblState){dblState.t=0;dblState.body=null;}
    e.preventDefault();e.stopPropagation();
  }
},true);
/* 触屏：dblclick 不可靠 ⇒ 用两次 tap（<450ms）触发清屏；
 * 单指按住拖动 = 拖垃圾桶（trashDrag 由 pointerdown 启动）。 */
var trashTapT=0;
trash.addEventListener('pointerup',function(e){
  if(!uiTouch())return;
  var now=performance.now();
  if(now-trashTapT<450){e.preventDefault();clearAll();trashTapT=0;}
  else trashTapT=now;
});
var trashDrag={active:false};
function overlap(a,b){return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);}
function eraseUnderTrash(){
  var r=trash.getBoundingClientRect();
  var rcx=r.left+r.width/2, rcy=r.top+r.height/2;    // 弹簧/杆没有字形，要按线段判
  for(var i=freeL.length-1;i>=0;i--){
    var d=freeL[i];
    if(overlap(r,d.el.getBoundingClientRect()))killLetter(d);
  }
  for(var j=bodies.length-1;j>=0;j--){
    var B=bodies[j],hit=false;
    if(B.kind==='S'){
      // 弹簧没有字形（B.glyphs 为空），用线圈线段（带 SPR_GRAB 容差）+ 两端点做命中判定。
      hit=segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,rcx,rcy)<SPR_GRAB
          ||overlap(r,{left:Math.min(B.e0.x,B.e1.x)-6,right:Math.max(B.e0.x,B.e1.x)+6,
                       top:Math.min(B.e0.y,B.e1.y)-6,bottom:Math.max(B.e0.y,B.e1.y)+6});
    }else if(B.kind==='T'){
      // 杆也没有字形，同理用它的线段
      var hl=(B.len||170)/2,cT=Math.cos(B.th||0),sT=Math.sin(B.th||0);
      var ax2=B.x-cT*hl,ay2=B.y-sT*hl,bx2=B.x+cT*hl,by2=B.y+sT*hl;
      hit=segPointDist(ax2,ay2,bx2,by2,rcx,rcy)<=8
          ||overlap(r,{left:Math.min(ax2,bx2)-6,right:Math.max(ax2,bx2)+6,
                       top:Math.min(ay2,by2)-6,bottom:Math.max(ay2,by2)+6});
    }else if(B.kind==='W'){
      // a boundary has no glyphs to overlap-test, so use its live bounding box
      hit=overlap(r,{left:B.x-B.hw,right:B.x+B.hw,top:B.y-B.hh,bottom:B.y+B.hh});
    }else{
      for(var k=0;k<B.glyphs.length;k++){
        if(B.glyphs[k].el&&overlap(r,B.glyphs[k].el.getBoundingClientRect())){hit=true;break;}
      }
    }
    if(hit)killBody(B);
  }
}
trash.addEventListener('pointerdown',function(e){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  trashDrag.active=true;
  var r=trash.getBoundingClientRect();
  trash.style.right='auto';trash.style.bottom='auto';
  trash.style.left=r.left+'px';trash.style.top=r.top+'px';
  trash.classList.add('on');
});

function killLetter(d){
  d.dead=true;
  var i=freeL.indexOf(d);if(i>=0)freeL.splice(i,1);
  i=freeG.indexOf(d);if(i>=0)freeG.splice(i,1);
  i=ALL.indexOf(d);if(i>=0)ALL.splice(i,1);
  if(d.el&&d.el.parentNode)d.el.parentNode.removeChild(d.el);
}
function killBody(B){
  /* 铰链被删除时必须摘掉它的真 Constraint，否则会继续把两个宿主隐形地钉在一起。 */
  if(B&&B._hcon&&typeof hingeConstraintDrop==='function')hingeConstraintDrop(B);
  /* 删体 ⇒ 世界里任何引用它的约束都要摘掉。放在删除源头而非 hingeSolve / springSyncEnds：
   宿主被删后 hingeSolve 第一行就返回，springSyncEnds 也可能跑不到，约束会残留并隐形地钉住另一个体。 */
  if(B&&B.mb&&MW&&typeof Matter!=='undefined'&&Matter.Composite&&Matter.Composite.allConstraints){
    var _cs=Matter.Composite.allConstraints(MW.engine.world);
    for(var _ci=0;_ci<_cs.length;_ci++){
      var _c=_cs[_ci];
      if(_c&&(_c.bodyA===B.mb||_c.bodyB===B.mb))Matter.Composite.remove(MW.engine.world,_c);
    }
  }
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  removeMatterBody(B);    // boundaries & rod mirrors live in the Matter world as well
  /* 删掉支撑体后唤醒世界里所有睡眠的非静止体，否则它们会挂在空中
   （实测删平台后方块停在 y=561 且 isSleeping=true，唤醒后落到地面 y=693）。
   只在删体时做一次，不影响每帧开销。 */
  if(MW&&typeof Matter!=='undefined'&&Matter.Composite&&Matter.Composite.allBodies&&Matter.Sleeping){
    var _bs=Matter.Composite.allBodies(MW.engine.world);
    for(var _bi=0;_bi<_bs.length;_bi++){
      var _b=_bs[_bi];
      if(_b&&!_b.isStatic&&_b.isSleeping)Matter.Sleeping.set(_b,false);
    }
  }
  // dissolve any binary-star / orbit link involving B (release partner tangentially)
  if(B.go){
    var gD=B.go, txd=-Math.sin(gD.ang), tyd=Math.cos(gD.ang);
    var P2=(gD.bin)?gD.by:null;
    if(P2&&bodies.indexOf(P2)>=0){
      P2.vx=txd*gD.w*(gD.rad*((gD.bin)?gD.rP:1));P2.vy=tyd*gD.w*(gD.rad*((gD.bin)?gD.rP:1));
      P2.goB=null;
    }
    B.go=null;
  }
  if(B.goB&&bodies.indexOf(B.goB)>=0){
    var H=B.goB,gH=H.go;
    if(gH){var txd2=-Math.sin(gH.ang),tyd2=Math.cos(gH.ang);H.vx=txd2*gH.w*(gH.rad*gH.rB);H.vy=tyd2*gH.w*(gH.rad*gH.rB);H.go=null;}
    H.goB=null;
    B.goB=null;
  }
  if(B.bh){B.bh.dead=true;B.bh=null;}   // kill a black hole: the hole itself vanishes
  B.diss=true;
  for(var j=0;j<B.glyphs.length;j++){
    var g=B.glyphs[j];
    if(g.body===B){
      g.body=null;g.inBody=false;
      killLetter(g);
    }
  }
  B.glyphs=[];B.mem=[];
}

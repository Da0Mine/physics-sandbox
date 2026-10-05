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
// R68（用户：「对所有的参数都定一个标，以国际单位制为基准」）：**比例尺 260 px = 1 m** ——
// 默认重力 2600 px/s² 恰好显示 10 m/s²，画布高度 ≈ 3.5 m，物理量级合理。
// 内部计算**全部仍是 px**（所有回归、标定、弹簧公式原样不动）；换算只发生在参数面板的
// 显示/输入层：SI 显示值 = 内部值 / siK。1 单位质量 = 1 kg；k 的 N/m 是标称值 —— F=ks·Δx
// 按 F=ma 走加速度通道时，kg/s² 的数值与内部值恰好一致（px 与比例尺在分式里约掉）。
var PX_PER_M=260;
/* R102（用户：「传送带的默认速度改成0.5m/s」）：传送带默认带速 CONV_DEF = 130 px/s = **0.5 m/s**
 * （内部一律 px/s，面板显示时才除以 PX_PER_M）。
 * ★为什么常量要声明在**这里**（PX_PER_M 的下一行）：参数表 convspeed 的 `def:CONV_DEF`（下面
 *   几十行处）是在**对象字面量求值那一刻**就把值抓走的；原先 CONV_DEF 声明在 makeBelt 那一带
 *   （文件后半），`var` 提升让它在那时还是 **undefined** ⇒ 面板里「带速」的默认值实际是
 *   undefined，只有 makeBelt 里显式写的那份 260 才是真的 —— 同一个默认值有两份、其中一份是空的。
 *   把声明前移到 PX_PER_M 旁边之后：字面量抓到的是真值，且全文件只有这一个声明（唯一真源）。
 * ★0.5 而不是 1.0：传送带这台机器**放下去电机就是转着的**（不像弹簧放下去默认在原长静止），
 *   默认越快，用户第一眼看到的就是货被甩出去好远，判断会落到「器件坏了」而不是「还没调速」。
 *   0.5 m/s 是「慢到看得清方向、又快到看得清它在动」的那档。 */
var CONV_DEF=Math.round(0.5*PX_PER_M);
/* ★★R125（用户报「点默认按钮没反应，也不退回去」查出来的**第二条**通道，与 R124 的闭包共享并列）：
 *   参数表 `gndlen` 的 `def:GROUND_SPAWN_LEN` —— 而 `GROUND_SPAWN_LEN` 原先声明在文件后半
 *   （makeGround 那一带，约 11644 行）。对象字面量 `PARAM_DEFS` 是在**求值那一刻**就把值抓走的，
 *   `var` 提升只提升声明、不提升赋值 ⇒ 那时它是 **undefined** ⇒ 面板「长度 length」行点「默认」
 *   会把 undefined 喂进 applyParam（入口 `val=+val||0` ⇒ 0）⇒ 被 clamp 到量程下限 **60px**，
 *   而不是默认 **260px** —— 用户看到的就是「点了默认，数字没回到该有的样子」。
 *   ★这正是 R102 在 `CONV_DEF` 上踩过的**同一个坑**（见上方那段注释）：当年只搬了那一个常量、
 *     没做全量扫描，于是 R108 加地面参数时又踩了一遍。R125 补了守卫
 *     （`_verify_r61.py` D12：「每个参数条目的 def 必须是 number」+ D13：地面长度行点默认必须回 260），
 *     这类问题不再靠人记。
 *   ★规矩与 CONV_DEF 相同：常量声明必须在参数表**之前**，且全文件只此一处（唯一真源）。 */
var GROUND_SPAWN_LEN=260;
/* ★★R126（用户：「你这个弹簧的默认长度和初始长度不一致啊，肯定以初始长度为准啊」）：
 *   ——「出生尺寸」常量区。**全部**器件出生尺寸常量都收在这里，理由是两条：
 *   ① `PARAM_DEFS` 里 `slen.def:SPR_SPAWN_LEN` 这类写法，必须在**对象字面量求值那一刻**就抓到值。
 *      `var` 只提升声明、不提升赋值 ⇒ 常量若声明在参数表之后，那一刻就是 `undefined`。
 *      R102 在 `CONV_DEF`、R125 在 `GROUND_SPAWN_LEN` 已经各踩过一次（点「默认」掉到量程下限）。
 *   ② 这是「**默认值 == 出生值**」这条不变式的**唯一真源**：出生尺寸只在这里改一个数，
 *      参数表的默认值机械跟随 ⇒ 结构上不可能再漂移。
 *      ★R97 就是栽在这里：它把出生长度从 170 改成 110（注释里明写「把默认改成 110，两条入口
 *        的默认参数就完全一致」），但**只改了出生那半条**、`PARAM_DEFS.slen.def` 留在 170
 *        ⇒ 同一个语义两处真源 ⇒ 用户 2026-09-23 实测报出「默认长度和初始长度不一致」。
 *   原声明点已改成**指针注释**，别再加回去（重复声明会让「唯一真源」失效）。 */
var SPR_SPAWN_LEN=110;    // 弹簧：= makeSpring 长度钳制 clamp(d,110,340) 的下限
var ROPE_SPAWN_LEN=110;   // 轻绳：与弹簧同款「拖出来即可用」的默认长度
var ROD_SPAWN_LEN=170;    // 轻质杆：= makeRod 的默认，也是 vt 拼接实际拿到的那一个
var BELT_SPAWN_LEN=260;   // 传送带：矩形宽（带子长度暂不可调，只影响出生尺寸）
// ★R103-8（用户：「铰链连接两个物体后，转动角度也有限制，不能让两个物体卡bug，重叠」）：
// 铰链的**折角限位**（度）。折角 = 「销→宿主0中心」与「销→宿主1中心」两个方向的夹角
// 相对**连接那一刻**的偏差；超过 ±限位 就被投影回边界（硬限位）。诊断实测（_diag_r103b D 组）：
// 无限位时挂在销下的方块被踢一脚能整圈风车、转顶时钻进固定块的盒子里（AABB 重叠）。
// ★★R105-6（用户纠正了这条需求的语义，本条按新语义重写）：
//   「我说的限位角是保证连接的两个物体不互相穿模而说的限位角，里面的参数应该是**固定铰链**，
//     默认关闭，开启后角度被定死」。
//   ⇒ 面板上**不再有**「限位角」这个可调角度；只有一个是/否的「固定铰链」开关：
//     · 关闭（默认）= 完全光滑铰链，相对转动**不受任何限制**（= 旧语义里 180° 那一档）；
//       「不互相穿模」由**碰撞解算**保证（两个宿主保持互相碰撞，见 springSyncGroups），
//       而不是靠限制转角 —— 这是用户明确要的分工。
//     · 开启 = 刚接：限位角取 0°，折角被冻结在**开启那一刻**的构型上（角度定死）。
//   旧常量 HINGE_FOLD_DEF=90 不再是面板默认（保留只为历史/回归脚本里出现过这个名字）。
var HINGE_FOLD_DEF=90;
var HINGE_FOLD_STEP=0.08;   // ★R103-8：限位回转每子步限步（rad），防传送瞬滑（见 hingeFoldLimit）
var HINGE_FOLD_DMAX=2;      // ★R103-8 闭合门：两端距离超过此值视作「未钉合成销」，限位跳过（I1 回归）
// R72（用户：「质量不要设置上限，其他的也是，只要不违背物理规律即可」）：上限只保留
// **物理上真实存在**的那几个 —— 弹性 e∈[0,1]、空气阻力 <1（它是「每帧速度的占比」，
// ≥1 会把速度反向，违反物理）；μ>1（橡胶-玻璃 ≈2）完全物理，质量/长度/刚度/阻尼均无上限。
// 滑块的 min/max 只是可视化量程（数字输入框本来就不限），真正的硬边界在 applyParam。
var PARAM_DEFS={
  // R73-F（用户：「是有我说的参数不设上限，但是那个滑动条还是保持之前的范围，只有输入框可以
  // 输入大数」）：R72 把滑块的 min/max 一起放大到「两个数量级」是**过度执行** —— 滑块的可视
  // 量程被拉到 0..10000 之后，想把质量从 1 调到 2 得在滑轨左边 0.01% 的宽度里蹭，滑块等于废了。
  // 用户要的是**输入不设上限**（数字框），不是**拖动量程放大**。故 min/max 全部还原成 R71 的
  // 常用范围；数字输入框照旧不受 min/max 约束（`applyParam` 只守物理边界，见下），键入 10000
  // 一样生效。R72-I 的「不设上限」由数字框承担，滑块回到好用的小量程。
  mass:{key:'mass',label:'质量 mass',min:0.2,max:5,step:0.1,unit:'kg',siK:1,def:1},
  massM:{key:'massM',label:'质量 M',min:1,max:12,step:0.5,unit:'kg',siK:1,def:3},
  grav:{key:'grav',label:'重力 g',min:200,max:6000,step:50,unit:'m/s²',siK:PX_PER_M,def:2600},
  acc:{key:'acc',label:'加速度 a',min:100,max:4000,step:50,unit:'m/s²',siK:PX_PER_M,def:1300},
  bounc:{key:'bounc',label:'弹性 bounce',min:0,max:1,step:0.01,unit:'',def:0.6},
  /* ★★R131-34 新增：Δt（世界时间倍率，滑条 0~1、数字框可更高）/ v 赋予速度（大小+方向）
     / q 电荷量 / 物体电荷量 */
  tscale:{key:'tscale',label:'Δt 时间倍率',min:0,max:1,step:0.01,unit:'×',def:1},
  /* ★R131-35：v 的速度按**国际单位制**显示/输入（内部仍是 px/s，面板以 m/s 呈现）——
   *  与 g / a 同一条 siK 通道，不再出现「px/s」这种内部单位漏到界面上。 */
  vsize:{key:'vsize',label:'赋予速度 v',min:0,max:6000,step:100,unit:'m/s',siK:PX_PER_M,def:1800},
  vang:{key:'vang',label:'速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
  asize:{key:'asize',label:'赋予加速度 a',min:0,max:6000,step:100,unit:'m/s²',siK:PX_PER_M,def:1300},
  aang:{key:'aang',label:'加速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
  /* ★R131-35：电荷用国际单位 **C（库仑）**（内部=显示值，作相对电荷量使用） */
  qcharge:{key:'qcharge',label:'电荷量 q',min:-5,max:5,step:0.1,unit:'C',def:1},
  wcharge:{key:'wcharge',label:'电荷量 q',min:-5,max:5,step:0.1,unit:'C',def:0},
  /* ★R131-44：被赋予加速度的物体可再调（SI：m/s² 与方向） */
  wacc:{key:'wacc',label:'赋予加速度 a',min:0,max:6000,step:100,unit:'m/s²',siK:PX_PER_M,def:1300},
  waccang:{key:'waccang',label:'加速度方向 θ',min:-180,max:180,step:1,unit:'°',def:0},
  // ★R126：`def` 必须**引用出生尺寸常量**，不许再写死数字 —— 写死就是「同一语义两处真源」，
  //   出生值一改这里就悄悄漂移（R97 的 170/110 就是这么来的：用户实测报「默认和初始不一致」）。
  rodlen:{key:'rodlen',label:'杆长 length',min:60,max:420,step:10,unit:'m',siK:PX_PER_M,def:ROD_SPAWN_LEN},
  gndlen:{key:'gndlen',label:'长度 length',min:60,max:1600,step:10,unit:'m',siK:PX_PER_M,def:GROUND_SPAWN_LEN},
  gndang:{key:'gndang',label:'角度 angle',min:-180,max:180,step:1,unit:'°',siK:1,def:0},
  // R71⑧（用户：「物体质量不影响碰撞效果（999kg 落体撬不动 1kg 杠杆）」）：杆（vt 造的木板）
  // 的质量独立可调。默认 1kg（= 杆长 170px 的自然质量）
  rodmass:{key:'rodmass',label:'质量 mass',min:0.05,max:20,step:0.05,unit:'kg',siK:1,def:1},
  // R57（用户 #7/#8）：弹簧的两个参数 —— k 直接对应「劲度系数 k」，L₀ 对应「自然长度」
  // R61（用户：「弹簧的默认劲度系数没改变啊」）：def 必须跟随 SPR_KS_DEF，不能再写死 26 ——
  // 建弹簧时用的是 SPR_KS_DEF（=94），面板却显示旧的 26，看起来就是「默认值没改」。
  // R87-E（用户：「滑动条在正常区间调控」）：sk 量程从 [2,300] 收到 [2,100] ——
  // 300 是旧 k=180 时代的量程，现在默认 50，留 2 倍余量到 100 已覆盖常见实验室弹簧。
  // 输入框照旧不受 min/max 约束（物理边界 0..1e6 在 applyParam）。
  // ★R119：SPR_KS_DEF 提到 150（用户拍板），量程必须跟着抬 —— 旧的 max=100 会让默认值
  // 顶在量程外，面板一碰就把 k 拉回 100（「默认值没改」的同一类 bug，见 R61）。
  // ★R130：默认 150→300 ⇒ max 必须同步抬到 600（= 2×默认），否则默认值顶在滑块上沿。
  sk:{key:'sk',label:'劲度系数 k',min:2,max:600,step:1,unit:'N/m',siK:1,def:SPR_KS_DEF},
  // ★R126（用户：「你这个弹簧的默认长度和初始长度不一致啊，肯定以初始长度为准啊」）：
  //   `def` 从写死的 170 改成 **引用 `SPR_SPAWN_LEN`**。原来两者是两个数（出生 110 / 默认 170）
  //   ⇒ 面板上「自然长度 L₀」显示 0.423 m，点「默认」却跳到 0.654 m —— 用户看到的
  //   「默认长度和初始长度不一致」。修后两者同源，改出生尺寸即机械跟随。
  slen:{key:'slen',label:'自然长度 L₀',min:60,max:420,step:10,unit:'m',siK:PX_PER_M,def:SPR_SPAWN_LEN},
  // R101⑦ 轻绳的绳长。**不复用 slen**（那行的标签是「自然长度 L₀」，对绳是错的称呼）；
  // 量程随轻绳自己的 [ROPE_MIN_LEN, ROPE_MAX_LEN]（滑条常用区间取 60..600，数字框不受限）。
  // ★R126：同 `slen` 那条 —— 轻绳出生 110px，`def` 却写死 170 ⇒ 点「默认」把绳从 0.423 m
  //   跳到 0.654 m。改成引用 `ROPE_SPAWN_LEN`（同一个病理的**第二条通道**，用户还没报，
  //   但同一句话的 bug 要把所有通道一次查干净 —— 见 MEMORY「同一句话有几个通道」）。
  rlen:{key:'rlen',label:'绳长 L',min:60,max:600,step:10,unit:'m',siK:PX_PER_M,def:ROPE_SPAWN_LEN},
  // ★R105-6：铰链的「固定铰链」开关（布尔）。关闭 = 完全光滑（相对转动不受限）；
  // 开启 = 角度定死在开启那一刻（刚接）。**不再有**可调的角度数值（见上面 HINGE_FOLD_* 段）。
  hfix:{key:'hfix',label:'固定铰链',bool:true,def:0},
  // R71④（用户：「弹簧的阻尼运动是不是也应该有一个参数可以调节（可以调到无阻尼的状态）」）：
  // 阻尼系数独立成一条参数。D=0 即完全无阻尼；默认值仍是与刚度配套的 SPR_DAMP。
  // R87-E：阻尼量程从 [0,60] 收到 [0,30] —— 默认 D 从 7.89 降到 4.2，旧量程太宽滑块不好用。
  sdamp:{key:'sdamp',label:'阻尼 D',min:0,max:30,step:0.2,unit:'',def:SPR_DAMP},
  frict:{key:'frict',label:'摩擦系数 μ',min:0,max:1,step:0.01,unit:'',def:0.1},
  scale:{key:'scale',label:'尺寸 scale',min:0.4,max:3,step:0.05,unit:'×',def:1},
  bz:{key:'bz',label:'磁场强度 B',min:-3,max:3,step:0.1,unit:'T',def:1},
  eacc:{key:'eacc',label:'电场强度 E',min:-3,max:3,step:0.1,unit:'V/m',def:1},
  iacc:{key:'iacc',label:'电流强度 I',min:-3,max:3,step:0.1,unit:'A',def:1},
  // R64（用户：「给那些物体的参数里面增加可以调控质量大小，与地面的摩擦系数大小」）：
  // W 体（画出来的线/图形/圆）的专属参数。wmass 是**乘数**：JS 侧 B.mass 与
  // Matter 侧 setMass(自然质量×乘数) 同步 —— L024 的弹簧标定口径是「单位质量」，乘数只是把
  // 本体的 m 从 1 换成用户值，R57/R58 的公式全部照旧成立（加速度限幅随 m 等比放大）。
  wmass:{key:'wmass',label:'质量 mass',min:0.2,max:5,step:0.1,unit:'kg',siK:1,def:1},
  // wfrict 是**本体**的摩擦系数；实际接触用配对规则（动摩擦取双方 min、静摩擦取 min，
  // R68 起静摩擦也取 min），面板下方会实时列出当前每对接触实际生效的数值。
  wfrict:{key:'wfrict',label:'摩擦系数 μ',min:0,max:1,step:0.01,unit:'',def:WFRICT_DEF},
  // R65（用户：「关于物体和地面的弹性碰撞也搞一个参数可以调节」）：W 体的碰撞恢复系数。
  // 没调过时保留 buildMatterBody 的默认（圆 = BALL_REST，其它 = 0），与 wfrict 同一条守卫规则。
  wbounc:{key:'wbounc',label:'弹性 bounce',min:0,max:1,step:0.01,unit:'',def:0},
  // R72（用户：「弹簧阻尼调成 0 还是很快停止」的真凶）：W 体的**空气阻力**（frictionAir，
  // 每帧按速度占比泄能）是一条独立于弹簧阻尼的耗散通道。设 0 = 无空气阻力（配 sdamp=0
  // 即理想简谐振荡）。上限 0.5 = 物理边界（它是每帧速度占比，≥1 会把速度反向）。
  // R73-C（用户：「空气阻力默认为 0，先暂时不要考虑空气阻力」）：默认值从 0.01 改成 0 ——
  // 出厂状态就没有这条耗散通道，用户要阻尼时自己往上调。
  wair:{key:'wair',label:'空气阻力 air',min:0,max:0.5,step:0.001,unit:'',def:0},
  /* ★R115（用户 2026-09-22：「大概是引入了滚动摩擦导致的问题，把滚动摩擦的参数调节删了，
   *   回退回之前没有滚动摩擦的相关圆的运动代码，就只留一个调节摩擦系数的」）：
   *   原 `wroll:{key:'wroll',label:'滚动摩擦 ω',...}` 定义已**整体删除**。
   *   连带删除（同一轮，一次删干净，不留半条链）：`wRollEff()`、`applyWRoll()`、
   *   `ROLL_GRIP_SLIP`、stepMatter 里的 `applyWRoll(BW,false)` 调用、参数面板的 wroll 行
   *   （paramV / applyParam / 本体映射 / 逐物配对表渲染）、以及 `pairOv*` 三兄弟里的 `roll` 字段。
   *   ★圆的摩擦调节从此**只剩 μ 一个旋钮**（+ 质量/弹性/空气阻力，与其它 W 体一致）。
   *   ★`highPureRoll` 已于 R117 **整体删除**（用户：「把这个圆的运动回退回去，用之前的来」
   *     —— 回到 R91_pre：高中不再有任何「写 ω」的通道）。 */
  // R99 传送带：带面速度（可正可负 = 正/反向）。内部 px/s，显示 m/s（siK=PX_PER_M=260）。
  // ±4 m/s 覆盖课堂量级；def=260px/s = 1 m/s。只有 belt 才显示这一行（见 paramDef）。
  convspeed:{key:'convspeed',label:'带速 v',min:-1040,max:1040,step:10,unit:'m/s',siK:PX_PER_M,def:CONV_DEF},
  // R101③（用户：「也可以在里面的参数设置中调节（角度）」）：带子的角度行。
  // 内部单位 = **弧度**（B.th 的本体），显示/输入单位 = 度：靠 siK=π/180 换算
  // （面板口径是 internal = SI × siK，见 renderParamPanel 的 kSI）。于是：
  //   滑块 min/max = ±π/(π/180) = ±180°，step = 1°，回读 = th×180/π。
  // ★面板这一路是**自由角度**（37° 就存 37°）—— 45° 量化只属于旋转手柄那一路：
  //   手柄是「快速摆到几个常用档」，面板是「要多少度给多少度」，两条各司其职。
  //   两者最后都写同一个字段（B.th）且都经 setBeltAngle，所以不会打架。
  beltangle:{key:'beltangle',label:'角度 θ',min:-Math.PI,max:Math.PI,step:Math.PI/180,unit:'°',siK:Math.PI/180,def:0}
};
// ★R104-7：参数**标签**必须随模式切换。同一个 sdamp 字段在两种模式下是两种物理量：
//   大学模式 = Rayleigh 阻尼系数 D（有量纲），高中模式 = 阻尼比 ζ（无量纲，见 springDamp）。
//   旧实现在高中模式把阻尼恒置 0（滑块无效），所以标签一直没暴露这个问题；现在它真的起
//   作用了，标签也得说实话 —— 否则用户看到「阻尼 D」而实际调的是耗散比，等于文案撒谎。
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
  /* ★★R131-45（用户：「a 里面的面板应该要能调节角度、和 v 一样」）：真因=**这里有一条
   *  更早的旧映射 `return 'acc'`**，它先返回 ⇒ 下面新加的 asize/aang 永远到不了（实测
   *  面板里只有一行"加速度 a"、没有方向行/方向盘）。a 现语义 = **赋予持续加速度** ⇒ 删掉旧映射。 */
  /* if(t==='a')return 'acc';  ← R131-45 移除（a 已改为赋予型字符） */
  /* ★★R131-34：v 不再有「弹性」参数（用户：所有字符弹性一致、用默认值）——v 改为
   *  **赋予速度**参数（vsize 大小 + vang 方向）。 */
  if(t==='v')return (B&&B.kind==='T')?'rodlen':'vsize';
  if(t==='a')return 'asize';   // ★R131-42：a = 赋予持续加速度（与 v 同构）
  if(t===MU)return 'frict';
  /* ★R131-34：t = 世界时间倍率（Δt）；q = 电荷量 */
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
  if(B.kind==='T'){ids.push('rodlen');ids.push('rodmass');return ids;}   // R71⑧ 加质量
  // R57：弹簧暴露 劲度系数 k 与 自然长度 L₀
  // R101⑦：铰链没有可调参数（光滑 = 无摩擦、长度恒 0）；轻绳只有绳长。
  // ★R105-6：铰链的参数行从「限位角」改成「固定铰链」开关（默认关，开启后角度被定死）。
  if(B.kind==='S'&&B.hinge){ids.push('hfix');return ids;}
  if(B.kind==='S'&&B.rope){ids.push('rlen');return ids;}
  if(B.kind==='S'){ids.push('sk');ids.push('slen');ids.push('sdamp');return ids;}   // R71④ 加阻尼
  // R64：W 体暴露 质量（乘数）与 摩擦系数 —— 之前 W 体没有 mem 字母，永远走不到参数分支
  // R65：再加 弹性 bounce（W 体的碰撞恢复系数）
  // R72：再加 空气阻力 air（独立于弹簧阻尼的耗散通道，设 0 = 真·无阻尼）
  // ★R115：R91 加的「滚动摩擦 wroll」行已删（用户要求回退）—— 圆的摩擦调节只剩 μ 一个旋钮。
  /* R108：地面/墙面**只发两行**（长度 / 角度）—— 它的语义就是「一块可以摆角的静态板」，
   *   质量/摩擦/弹性/空气阻力对它没有意义（它是外部支撑源，不是被模拟的物体）。
   *   与传送带「只发带速」同一条纪律：不把永远没用的旋钮摆给用户。 */
  if(B.gnd)return ['gndlen','gndang'];
  if(B.kind==='W'){
    // R100③（用户：「那个传送带，里面的参数不需要其他东西，只要速度」）：传送带**只发带速**。
    // 它不是「一块可以被调的板」，而是一台机器 —— 质量/摩擦/弹性/空气阻力这四个旋钮
    // 留给用户只会让人以为「这带子怎么调都不对」。带面 μ=0.6 固定在 makeBelt 里（器件自带
    // 属性），要改就去改那个常量。早退在 push 任何内建项**之前**，面板不可能漏掉一行。
    if(B.belt)return ['convspeed','beltangle'];
    ids.push('wmass');ids.push('wfrict');ids.push('wbounc');ids.push('wair');
    if(B.charge)ids.push('wcharge');   // ★R131-34：被赋予电荷的物体可再调电荷量
    /* ★R131-44（用户：「a 融合进物体后在参数面板中也要可以调节」）：被 a 赋予过加速度的
     *  物体，面板里出现「赋予加速度」（大小 + 方向）两行。 */
    /* ★★R131-60（用户：「物体面板里不是还要有关于其角度的调节面板吗」）：原来只 push 了
     *  `wacc`（大小）——方向行 `waccang` **定义了、读写分支也全有，却从来没进过这个清单**
     *  （`paramIdsForLetter` 里的 'wacc→[wacc,waccang]' 只有右键**字母**时才走，
     *  而 `specIdForLetter` 从不返回 'wacc' ⇒ 那一行分支是死的）。
     *  ⇒ 赋予之后**只能改大小、改不了方向**，方向永远停在出厂的 0°（水平向右）
     *  —— 这正是「我给了向上的加速度却飞不起来」的一半原因。 */
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
// PER-LETTER param rows: right-clicked letter decides which row the panel shows.
// 右键哪个字母 -> 调整那个字母的参数（m→mass, g→grav, v→bounc, μ→frict, r→scale,
// a→acc, B→bz, E→eacc, I→iacc, M→massM）。无参数的字母（½/²/c/t/q/G…）返回空。
function paramDefForLetter(B,d){
  if(!B)return [];
  var sid=specIdForLetter(d,B);
  /* ★R131-34：v 的参数面板要两行——**速度大小** + **速度方向**（方向默认水平向右=0°）。 */
  if(sid==='vsize')return ['vsize','vang'];
  if(sid==='asize')return ['asize','aang'];
  if(sid==='wacc')return ['wacc','waccang'];
  return sid?[sid]:[];
}
/* ★★R126：「默认值」不一定是个**常数** —— 它可以**随本体而定**（用户口径：「以初始值为准」）。
 *   `wbounc`（弹性 bounce）就是这种参数：圆的出厂恢复系数是 `BALL_REST`（0.52），其它 W 体是 0
 *   —— 这是**本体自己的出生状态**，不是「没设过就随便给个 0」。
 *   于是出现与弹簧长度同款的不一致（实测 `_diag_r126a.py`）：
 *     圆 · 弹性行：出生读数 0.52，点「默认」却写 0 ⇒ 把用户改到「它出生时都不是这个数」的状态。
 *   ★修法 = **读数与默认值共用同一个真源**（本函数）：`paramV` 的 wbounc 分支改用 `wBouncDef(B)`，
 *     面板的「默认」按钮/清空按钮改走 `paramDefVal(B,spec)`。两处再也不可能各写一套表达式。
 *   （这个「同一语义两处真源」的病，本文件已经犯过三次：R97 的 110/170、R102 的 CONV_DEF、
 *     R125 的 GROUND_SPAWN_LEN —— 每次都靠实测量出来，不能靠读代码。） */
function wBouncDef(B){
  if(PHYS_MODE==='high')return 0;                        // 高中：μ/e 全 0（R74-D/J 口径）
  return (B&&B.wshape==='circle')?BALL_REST:0;
}
/* 面板按钮/输入框清空时统一从这里取「该回到的值」：
 *   ① 先问「这个参数有没有动态口径」—— 有就用它（目前只有 `wbounc`）；
 *   ② 否则回落到静态的 `spec.def`。
 * ★今后新增「默认值随本体而定」的参数，只改**这一个**分派点 + 加一个 `<x>Def(B)` 函数；
 *   不许再往按钮/输入框那些调用点里各写一套表达式（那正是本文件反复栽的「两处真源」）。 */
function paramDefVal(B,spec){
  if(!spec)return 0;
  if(spec.key==='wbounc')return wBouncDef(B);
  return spec.def;
}
function paramV(B,id){
  var spec=PARAM_DEFS[id];
  /* ★★R131-42b：**新参数的读取分支曾整体缺失**（tscale/vang/qcharge/wcharge/aang 全无）
   *  ⇒ 面板显示的一直是 spec.def、与真实值不同步（用户看到的"改了没反应"就是这个）。
   *  这里统一补齐：Δt 全局量；v/a/q 的赋值存在字符（paramLetter）或宿主字段上。 */
  if(id==='tscale')return TIME_SCALE;
  if(id==='vsize')return (B&&B.vGive!=null)?B.vGive:((paramLetter&&paramLetter.vGive!=null)?paramLetter.vGive:spec.def);
  if(id==='vang')return (B&&B.vAng!=null)?B.vAng:((paramLetter&&paramLetter.vAng!=null)?paramLetter.vAng:spec.def);
  if(id==='asize')return (B&&B.aGive!=null)?B.aGive:((paramLetter&&paramLetter.aGive!=null)?paramLetter.aGive:spec.def);
  if(id==='aang')return (B&&B.aAng!=null)?B.aAng:((paramLetter&&paramLetter.aAng!=null)?paramLetter.aAng:spec.def);
  if(id==='qcharge')return (B&&B.qCharge!=null)?B.qCharge:((paramLetter&&paramLetter.qCharge!=null)?paramLetter.qCharge:spec.def);
  if(id==='wcharge')return (B&&B.charge!=null)?B.charge:0;
  if(id==='wacc'){
    if(!B)return 0;
    if(B.accX!=null||B.accY!=null)return Math.hypot(B.accX||0,B.accY||0);   // ★合成大小
    return (B.accGive!=null)?B.accGive:0;
  }
  if(id==='waccang'){
    if(!B)return 0;
    if(B.accX!=null||B.accY!=null){
      var _ag=Math.atan2(B.accY||0,B.accX||0)*180/Math.PI;                 // ★合成方向
      return _ag;
    }
    return (B.accAng!=null)?B.accAng:0;
  }
  // R61：弹簧的 k / L₀ **不是** B.param 里的条目，而是 B.ks / B.len（pv 只读 B.param 和 spec.def）。
  // 不特判的话面板永远显示 spec.def，用户改了 k 也会被面板盖掉 —— 「默认劲度系数没改变」就是这么来的。
  if(id==='sk'&&B&&B.kind==='S')return B.ks;
  if(id==='slen'&&B&&B.kind==='S')return B.len;
  // R101⑦：轻绳的绳长。与 sk/slen 同一条「专用字段」纪律（不特判 ⇒ 面板永远显示 def，
  // 用户改过也会被 def 盖回去 —— R61 在 k 上吃过一次）。
  if(id==='rlen'&&B&&B.rope)return B.len;
  // R64：W 体的质量乘数 / 摩擦系数存在专用字段（同弹簧的 B.ks 陷阱：pv 只读 B.param，不特判
  // 面板就永远显示 def，滑一动还会把用户值盖回去 —— R61 已在弹簧上吃过一次）
  if(id==='wmass'&&B&&B.kind==='W')return B.mMul||1;
  if(id==='wfrict'&&B&&B.kind==='W')return (B.wFrict!=null)?B.wFrict:(PHYS_MODE==='high'?0:WFRICT_DEF);   // R76：高中默认 0
  // R99：带速存在 B.conv（同弹簧 B.ks 的陷阱：pv 只读 B.param，不特判面板就永远显示 def）
  if(id==='convspeed'&&B&&B.belt)return B.conv||0;
  /* R108：地面/墙面的两个参数也存在**专用字段**（B.len / B.th），
   *   不特判就会踍上带子/铁钉的同一个陨阱（R61、R99 都吃过）。
   *   角度必须返回**度**（与 PARAM_DEFS.gndang 的 unit:'°' 一致）。 */
  if(id==='gndlen'&&B&&B.gnd)return B.len||0;
  if(id==='gndang'&&B&&B.gnd)return (B.th||0)*180/Math.PI;
  // R101③：带子角度。角度**不是** B.param 里的条目而是 B.th 本体（与 sk/rodmass 同一条
  // 「专用字段」纪律）—— 不特判的话面板永远显示 def=0，拖过手柄再开面板也会被 0 盖掉。
  if(id==='beltangle'&&B&&B.belt)return B.th||0;
  // R65：弹性 —— 没调过时显示**实际生效**的默认（圆 = BALL_REST，其它 = 0），不是写死 0
  // R74-D/J：高中模式下默认全 0（与 wEffE 同步）
  if(id==='wbounc'&&B&&B.kind==='W')return (B.wBounc!=null)?B.wBounc:wBouncDef(B);   // ★R126：与「默认」按钮同源
  // R72：空气阻力 —— 没调过时显示**实际生效**的默认（R73-C 起全为 0）
  if(id==='wair'&&B&&B.kind==='W')return WAIR_GLOBAL;   // ★R131：全局参数，读同一份真源
  // ★R115：`wroll` 的读数分支已删（参数本身已移除，见 PARAM_DEFS 处的 R115 详录）。
  // R71⑬：g 的参数是**全局**重力，面板显示当前全局 GRAV（不再是本体私有覆盖值）
  if(id==='grav')return GRAV;
  // R71④：弹簧阻尼（可调到 0 = 无阻尼）。与 sk/slen 同一条「专用字段」纪律，否则面板
  // 永远显示 def、滑块一动就被 def 盖回去（R61 在 k 上已经吃过一次）。
  if(id==='sdamp'&&B&&B.kind==='S')return (B.damp!=null)?B.damp:SPR_DAMP;
  // R71⑧：杆的质量。与 sk/wmass 同一条「专用字段」纪律 —— 不特判的话面板永远显示 def，
  // 滑块一动就被 def 盖回去（R61 在 k、R64 在 wmass 上各吃过一次）。
  if(id==='rodmass'&&B&&B.kind==='T')return rodMassOf(B);
  return pv(B,spec.key,spec.def);
}
function applyParam(B,spec,val){
  val=+val||0;
  if(!B.param)B.param={};
  B.param[spec.key]=val;
  var key=spec.key;
  /* ★★R132-9d（用户 2026-10-01：「v 数值改成 c 后，怎么再修改数值都修改不了了？」）：
   *  光速态原本只由 `bossFinish/bossAbort` 复位 ⇒ 用户把 v 设成 c 之后，`bossLightState()` 恒真，
   *  面板那一行被锁在「c = 光速」（数字框被清空 + placeholder='c'、滑块顶到最右）⇒ 再也改不回数字。
   *  修：**一旦按数值途径写入 vsize，就退出光速态**（不重渲染，免得正在编辑的输入框失焦）。
   *  （输入 `c` 那条路走的是 `bossLightOn`，在 keydown 里，不受这里影响。） */
  if(key==='vsize'&&typeof bossLightState==='function'&&bossLightState()
     &&typeof bossLightReset==='function')bossLightReset(true);
  /* ★★R131-34：新参数的写入——Δt 写全局 TIME_SCALE；v 的大小/方向写字符字段；
   *  q 的电荷写字符 qCharge；物体的电荷写 B.charge（并同步 Matter 体的电荷渲染）。 */
  if(key==='tscale'){
    TIME_SCALE=(val<0)?0:(val>20?20:val);
    return;
  }
  /* dock 字符的参数宿主是临时体 ⇒ **同时写回字符本身**（paramLetter），否则拖出来就丢了。
   * ★★R132-9d（用户 2026-10-01：「改一个字符 v 的值，怎么后面拖出来所有的 v 里面数值都变了？」）：
   *   面板（dock）里的字符是**单例**（`vO`/`aO`/`qO`…），而面板行编辑时 `paramLetter` 就是那个单例
   *   ⇒ 写回单例 = 把数值钉在模板上，之后每次从面板拖出的克隆都会继承它
   *   （`gdDown` 的克隆分支会拷贝 `d.vGive`）⇒ 用户看到「改一个，后面拖出来的全变了」。
   *   修：**dock 态不写回**（模板只负责颜值，不负责数值）；只有世界里那个字符本身才写回。
   *   ⇒ 每个拖出来的 v 各自独立，改谁只影响谁。 */
  /* 面板上的改法见上（CHAR_DEF）；**世界里那个字符**才写回它自己。 */
  if(key==='vsize'){B.vGive=(val<0?0:val);
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.vGive=B.vGive;else charDefWrite(paramLetter,'vGive',B.vGive);}return;}
  if(key==='vang'){B.vAng=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.vAng=val;else charDefWrite(paramLetter,'vAng',val);}return;}
  /* ★R132-9k：a 的两行同口径（面板单例不写回；世界里那个字符才写回）。 */
  if(key==='asize'){B.aGive=(val<0?0:val);
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.aGive=B.aGive;else charDefWrite(paramLetter,'aGive',B.aGive);}return;}
  if(key==='aang'){B.aAng=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.aAng=val;else charDefWrite(paramLetter,'aAng',val);}return;}
  /* ★★R132-9k（用户 2026-10-02：「q 赋予抽搐问题，我又成功复现了，现在更加精准，
   *  是**对 q 调节过参数之后**再进行赋予就会出现这样的问题」）：
   *  R132-9d 只给 `vsize`/`vang` 两行加了 `paramLetter.state!=='dock'` 的门 **✗ 漏了这三行**
   *  ⇒ 面板里的 q/a 单例仍被数值写回 —— 用户在面板上把 q 调过参数之后，
   *    之后拖出来的每个 q 克隆都带着这个值（`gdDown` 的克隆分支会拷贝 `d.qCharge`），
   *    与"赋予"路径叠加就出了用户报的抽搐。
   *  ⇒ 与 v 同口径：**dock 态不写回**（模板只负责颜值，不负责数值）。 */
  if(key==='qcharge'){B.qCharge=val;
    if(paramLetter){if(paramLetter.state!=='dock')paramLetter.qCharge=val;else charDefWrite(paramLetter,'qCharge',val);}return;}
  if(key==='wcharge'){B.charge=val;return;}
  if(key==='wacc'){
    /* ★R131-50：改「合成大小」= 保持当前方向、重设长度（等价于把合成矢量重新标定） */
    var _cur=Math.atan2(B.accY||0,B.accX||0);
    B.accGive=(val<0?0:val);
    B.accX=Math.cos(_cur)*B.accGive;B.accY=Math.sin(_cur)*B.accGive;
    return;
  }
  if(key==='waccang'){
    /* ★R131-50：改「合成方向」= 保持当前大小、旋转矢量 */
    var _len0=Math.hypot(B.accX||0,B.accY||0)||(B.accGive||0);
    var _rb=val*Math.PI/180;
    B.accX=Math.cos(_rb)*_len0;B.accY=Math.sin(_rb)*_len0;
    B.accAng=val;B.accGive=_len0;
    return;
  }
  if(key==='mass'){
    // R72：质量无上限；只守 >0（质量 ≤0 违反物理）
    B.mass=(val>0)?val:0.001;
  }else if(key==='massM'){
    B.massCap=(val>0)?val:0.001;  // capital-M mass (independently tunable from lowercase m)
  }else if(key==='grav'){
    // R71⑬（用户：「右键 g 的修改里面的参数影响的是**全局**的重力加速度，包括那些物体
    // （其他之前没有重力的字符不受影响）」）：g 的参数不再写进本体的 B.grav（那是「只让这个体
    // 变重」的私有覆盖），而是改**全局** GRAV —— 与 stepPhysics 的 `GRAV`、stepMatter 的
    // `MW.engine.gravity.y=GRAV/1000` 同源，所以看得见的物体会一起变重。
    // 「原本无重力的字符不受影响」自动成立：重力力的入口仍是 `if(B.hasG)`，没有 hasG 的
    // 公式字母/参数控件本来就不落，改了 GRAV 也不会突然获得重力。
    // 保留 B.grav 通道本身（物理侧照旧认它），只改**面板写哪里** —— r69 的 2c 用例直接写
    // nb.grav=2600 验证加速度，靠的就是这条通道。
    GRAV=clamp(val,0,1e7);    // R72：上限只是防 NaN 的护栏，物理上 g 不设上限
    if(MW)MW.engine.gravity.y=GRAV/1000;
  }else if(key==='acc'){
    B.acc=val;
  }else if(key==='bounc'){
    B.bounc=clamp(val,0,1);   // 物理边界：恢复系数 ∈[0,1]（用户 R72 明确认可的唯一一类上限）
  }else if(key==='gndlen'){
    // R108：绕**质心**对称伸缩（与 setRodLen 的语义一致），走 setGroundEnds 唯一咽喉
    if(B.gnd){
      var gh=B.len/2,gu=Math.cos(B.th||0),gv=Math.sin(B.th||0);
      var glen=clamp(val,GROUND_MIN_LEN,GROUND_MAX_LEN);
      setGroundEnds(B,B.x-gu*glen/2,B.y-gv*glen/2,B.x+gu*glen/2,B.y+gv*glen/2,true);
    }
  }else if(key==='gndang'){
    // R108：角度（度）。走 setGroundAngle（只写 th + 摆镜像）
    if(B.gnd)setGroundAngle(B,val*Math.PI/180);
  }else if(key==='rodlen'){
    // R72：原 40..520 是「别让杆横穿全屏」的实用护栏，不是物理约束 —— 杆长无物理上限。
    // 只保留 L>0（零长杆无意义）。
    // R98-1：改走 setRodLen 咽喉 —— 旧实现只写 B.len+refresh，镜像碰撞板不跟着重建
    //   （_diag_r97d_rodlen.py 实测：改到 300，boundsW 恒为建板时的 170）。force=true 无条件重建。
    if(B.kind==='T')setRodLen(B,val,true);
    else B.len=clamp(val,1,1e7);
  }else if(key==='rodmass'){
    // R71⑧：杆的质量。手写通道的冲量份额、以及绕质心的转动惯量 I=mL²/12 都取自它；
    // 杆的 Matter 镜像是「位置驱动」的（只跟随姿态，不参与求解），所以不需要同步到 Matter。
    // R72：质量无物理上限，>0 即可。
    B.rmass=clamp(val,0.01,1e7);
  }else if(key==='frict'){
    B.frict=val;              // R72：μ>1 完全物理（橡胶-玻璃≈2），不设上限
  }else if(key==='sk'){
    // R57 弹簧劲度系数。R72：刚度无物理上限
    B.ks=clamp(val,0,1e6);
  }else if(key==='slen'){
    // R58：改 L₀ 要让弹簧**真的跟着变长/变短**（springSetLen），而不是只改一个数字 ——
    // 旧实现改完画面纹丝不动，还因为 cur≠L₀ 被染成红/蓝，用户两条反馈同源于此。
    // 两端都拴住时几何由宿主决定，springSetLen 退化为「只改 L₀」= 预紧力语义。
    if(B.kind==='S')springSetLen(B,val);
    else B.len=clamp(val,1,1e7);
  }else if(key==='rlen'){
    // R101⑦：改绳长走 springSetLen（同 slen 那条「改完要让绳**真的**变长」，不是只改一个数）。
    // 两端都拴住时几何由宿主决定，springSetLen 退化为「只改 L」= 松弛量变化的语义。
    if(B.rope)springSetLen(B,val);
    else B.len=clamp(val,1,1e7);
  }else if(key==='hfix'){
    // ★R105-6：铰链的「固定铰链」开关（0=关/1=开）。开启 = 角度被定死在**此刻**的构型上
    //   ⇒ 必须作废旧基准：否则会瞬跳回「两端刚连上那一刻」的旧折角（用户切换时看得见的跳变）。
    //   hingeFoldLimit 下一帧按当前几何重新捕获（B._hFold0==null 那条懒捕获分支）。
    if(val&&B.hinge){B._hFold0=null;}
  }else if(key==='sdamp'){
    // R71④：弹簧阻尼系数（0 = 无阻尼）。存专用字段 B.damp，stepSprings / springGuideForce
    // 都读它，缺省回落到 SPR_DAMP。R72：阻尼无物理上限（越大只是越快进入过阻尼）。
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
    // R64：质量乘数。JS 侧 B.mass（弹簧 Δv=f/m、手写 SAT 冲量份额）与 Matter 侧
    // setMass(自然质量×乘数) 同步；setMass 会按比例调惯量，重的方块更难被拧转。
    // 重力加速度与质量无关（两边都是 a=g），所以「重」只体现在碰撞与弹簧响应上。
    // fixed（static）体跳过 setMass：static 的质量是 Infinity 语义，不该被改写。
    var mv64=clamp(val,0.01,1e7);   // R72：质量无物理上限，>0 即可
    B.mMul=mv64;B.mass=mv64;
    if(B.mb&&B._natMass&&!B.mb.isStatic)Matter.Body.setMass(B.mb,B._natMass*mv64);
  }else if(key==='convspeed'){
    // R99：带面速度。**只写 B.conv 一个字段**（beltTract 每帧现读它），不需要同步任何
    // Matter 材质 —— 牵引是手写通道里加的，Matter 侧从来没参与（见 beltTract 的实测注释）。
    // 可正可负：负值 = 反向（渲染的人字纹也会跟着掉头）。
    if(B.belt)B.conv=clamp(val,-1e5,1e5);
  }else if(key==='beltangle'){
    // R101③：面板改角度。写入走 setBeltAngle（pts/hull/镜像板一次做全），绕**质心**转，
    // 带长与中心都不动。val 是弧度（面板已按 siK 换算），shortAng 归一化到 (−π,π]。
    // 这里**不做 45° 量化**：量化只属于旋转手柄那条路（理由见 PARAM_DEFS.beltangle）。
    if(B.belt)setBeltAngle(B,shortAng(val),null);
  }else if(key==='wfrict'){
    // R64：本体摩擦系数（动摩擦配对取 min、静摩擦取 max —— Matter 规则）。
    // 改完必须同步刷一遍**当前活动中的碰撞对**：pair.friction 只在 collisionStart 算一次，
    // 不刷新的话「贴着地面调 μ」要等重新接触才生效，用户看到的就是「滑块没反应」。
    B.wFrict=clamp(val,0,1e6);   // R72：μ>1 完全物理，不设上限
    applyWFrict(B);
  }else if(key==='wbounc'){
    // R65：W 体的碰撞恢复系数。Matter 取碰撞双方 restitution 的 max，地面/普通体保持 0，
    // 所以只改本体（含 parts）+ 刷活动对就够 —— 与 wfrict 同一套「运行时改材质」纪律。
    B.wBounc=clamp(val,0,1);     // 物理边界：e∈[0,1]
    applyWBounc(B);
  }else if(key==='wair'){
    // R72：空气阻力（独立于弹簧阻尼的耗散通道）。设 0 = 真·无空气阻力；上限 0.5 是物理
    // 边界（它是「每帧速度占比」，≥1 会把速度反向，违反物理）。存专用字段 B.wAir，
    // wAirDef/applyWAir/refreshAllPairs 都认它。
    /* ★R131：全局化 —— 一调全场上所有 W 体同步（含各自 parts），新出生体经 wAirDef
     *   回退到 WAIR_GLOBAL 也拿到同一值。clamp 边界不变（它是「每帧速度占比」，≥1 反物理）。 */
    WAIR_GLOBAL=clamp(val,0,0.5);
    for(var _iw=0;_iw<bodies.length;_iw++){
      var _bw=bodies[_iw];
      if(_bw.kind!=='W'||_bw.dead||!_bw.mb)continue;
      _bw.wAir=WAIR_GLOBAL;
      applyWAir(_bw);
    }
  }
  /* ★R115：`wroll` 的写入分支已删（连同 B.wRoll 字段、applyWRoll、wRollEff、
   *   ROLL_GRIP_SLIP 与逐物配对的 roll 通道一起移除）。 */
  return val;
}
// R60c：从 seed 出发沿「弹簧 ↔ 宿主」的锚定关系走到底，得到整个装配体的成员。
// 这是「复制整体」的唯一真相来源 —— 点弹簧要得到「弹簧+两端物体」，点其中一个物体也要
// 得到同一套成员，所以两边共用这个函数（用户：「不管哪里都是复制整体」）。
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
// R60c：复制一个画出来的线/图形（W 体）。
// **这个函数是「点装配体里的物体 -> 卡死」的修法本体**：旧代码只判 `if(src.kind)`，而 W 体的
// kind 是 'W'（真值），于是被当成场源走 spawnField('W') —— 造出一个 kind='W' 但**没有 B.pts**
// 的畸形体，drawBoundaries / nearInk / distToHost 每帧读 B.pts[0] 全部抛异常，rAF 链断掉，
// 页面彻底卡死（实测复制后每帧一条 "Cannot read properties of undefined (reading '0')"）。
function copyWBody(src,dx,dy,quiet){
  if(!src||src.kind!=='W'||!src.pts||src.pts.length<2)return null;
  // 直接把 src 的**本地** pts 平移过去（不把转角烘进点里）：mkBoundary 会按同样的点算出同样的
  // 质心，于是 B.pts / B.ell / B.notch 全落在与源完全一致的本地坐标系里，转角单独用 th 还原。
  var p=[],i;
  for(i=0;i<src.pts.length;i++)p.push([src.pts[i][0]+src.x+dx,src.pts[i][1]+src.y+dy]);
  var opt={shape:src.wshape||'poly',rad:src.rad||0,closed:!!src.closed,notch:src.notch||null};
  if(src.ell)opt.ell={cx:src.x+src.ell.lcx+dx,cy:src.y+src.ell.lcy+dy,
                      rx:src.ell.rx,ry:src.ell.ry,a0:src.ell.a0,a1:src.ell.a1};
  // R68：凹槽真弧元数据随副本平移（本地 -> 世界，mkBoundary 会再转回本地）
  if(src.arcs)opt.arcs=src.arcs.map(function(a){
    return {i0:a.i0,i1:a.i1,cx:src.x+a.lcx+dx,cy:src.y+a.lcy+dy,
            mx:src.x+a.lmx+dx,my:src.y+a.lmy+dy,r:a.r};});
  var B=mkBoundary(p,opt);
  if(!B)return null;
  if(src.th){B.th=src.th;if(B.mb)Matter.Body.setAngle(B.mb,src.th);}
  B.sc=src.sc||1;
  // R64：副本继承用户调过的质量乘数与摩擦系数（applyWMul 走 B.mb 已就位的路径）
  // R65：弹性也一并继承
  if(src.mMul)B.mMul=src.mMul;
  if(src.wFrict!=null)B.wFrict=src.wFrict;
  if(src.wBounc!=null)B.wBounc=src.wBounc;
  applyWMul(B);
  /* ★R110：**器件身份也要跟着复制**。旧版只拷 pts/th/质量/固定标志，
   *   于是「地面/墙面」的副本变成一块**普通木板**（没有 gnd、参数面板也不对）。
   *   ★同一类缺口在 `belt` 上也存在（传送带副本同样丢身份）—— 那是既有行为，
   *   本轮只补自己新加的这一个（不越权改旧器件的复制语义）。 */
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
  // R101⑦：复制也按标志分派（铰链的两端重合，用 sdx/sdy 造会退化成长度 1 的假弹簧）。
  var ns=src.hinge?makeHinge(src.x+dx,src.y+dy)
        :src.rope?makeRope(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy)
        :makeSpring(src.e0.x+dx,src.e0.y+dy,src.e0.x+dx+sdx,src.e0.y+dy+sdy);
  if(ns.rope)ns.len=src.len;
  else if(!ns.hinge){ns.len=src.len;ns.ks=src.ks;}
  if(src.dirLock)ns.dirLock={mx:src.dirLock.mx+dx,my:src.dirLock.my+dy,
                             ux:src.dirLock.ux,uy:src.dirLock.uy,
                             auto:!!src.dirLock.auto};   // R64：导轨随副本平移；R83：auto 标记一并继承
                             // （漏掉 auto 的后果：高中模式复制出来的弹簧会突然开始冻结宿主自转）
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
  // R60c（用户 #2/#3）：装配体必须**整体**复制 —— 点弹簧只复制弹簧、点物体又卡死，都是这里
  // 没把「弹簧 ↔ 宿主」当成一组。成员 >1 就走整体复制；单体才走各自的旧行为。
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
    // R57 弹簧：复制一条同长同角度的新弹簧（锚点不复制 —— 新弹簧从「没接上」开始）
    var ns=copySpringBody(src,56,44,false);
    sortPanel();
    return ns;
  }
  if(src.kind==='W'){
    // R60c：画出来的线/图形 —— 以前会掉进下面的 `if(src.kind)` 当成场源，造出没有 pts 的
    // 畸形体并每帧抛异常（页面卡死）。现在按几何原样复制一份。
    return copyWBody(src,56,44,false);
  }
  if(src.kind==='T'){
    // copy a vt-rod: a fresh rod of the same length + rotation
    var nr=makeRod(src.x+48+Math.random()*40-20,src.y+42+Math.random()*30-15,0,0);
    nr.th=src.th||0;nr.len=src.len||170;nr.hw=nr.len/2+2;
    /* ★R110：副本也要带上**反棘轮的目标长度**。
     *   `_rodL` 是 `rodSyncAnchors` 计算 `err` 的基准（见 R107-1）；
     *   不复制的话只能靠惰初始化 —— 那一帧的 `err` 会按旧值算，
     *   不该把这个细节留给「恰好下一帧会自己补上」。 */
    nr._rodL=src._rodL||nr.len;
    nr.pop=1;nr.orbPulse=1;nr.copied=true;
    refresh(nr);
    ringGo(nr.x,nr.y);
    return nr;
  }
  if(src.kind){
    // FIELD-SOURCE copy (B / q / I / E): right-clicking an electric field used to clone a
    // bare "m" because copyBody only knew formula bodies. Replicate the SAME kind of source
    // with its own direction / polarity kept (E keeps th, B keeps Bz, q/I keep their sign).
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
// R73-B：当前展开的配对行（'mu' = 摩擦系数、'e' = 弹性；null = 都没展开，接触区按摩擦口径）。
var pairOpenField=null;
function openParams(B,d){
  if(!B)return;
  var ids=(d)?paramDefForLetter(B,d):paramDef(B);
  if(!ids.length)return;
  closeMenu();
  paramBody=B;
  paramLetter=d||null;
  paramRows=[];
  pairOpenField=null;   // R73-B：换成另一个物体 = 配对展开状态重来（否则会带着上一体的口径）
  pbox.style.left=clamp(B.x-120,4,W-248)+'px';
  pbox.style.top=clamp(B.y+44,4,H-190)+'px';
  pbox.classList.add('on');
  renderParamPanel();
  // R65：同右键菜单 —— 面板行数（+接触区）变高后固定偏移会把底部顶出视口。
  // 先显示、再量**实际**尺寸、按视口收。接触区行数每帧还会变，逐帧复收见 clampParamPanel。
  clampParamPanel();
}
// R65：参数面板视口收位。以**当前 style 位置**为基准做夹紧（不追踪物体位置 —— 面板打开后
// 物体掉落/被拖走时面板不能跟着瞬移），只保证整块落在窗口内。接触区（updateParamContacts）
// 每帧增减行高后调用，行高变大也不会把底部顶出屏幕。
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
// R72（用户：「很多个框，怎么没有写哪个是对哪个物体的」）：整块物体一次暴露多行参数时
// （GMm/r² 有 M/m/r 三行、弹簧有 k/L₀/D 三行、vt 杆有长度/质量两行），每行标注归属 ——
// 符号参数归它自己的字母，弹簧三行归 kx，杆两行归 vt，W 体的四行是本体自己。
// 放在独立的 .pown span 里、不动 .plab 的文本（旧探针按 .plab 取标签）。
var PARAM_OWNER={mass:'m',massM:'M',grav:'g',acc:'a',bounc:'v',frict:'μ',scale:'r',
  bz:'B',eacc:'E',iacc:'I',rodlen:'vt 杆',rodmass:'vt 杆',
  sk:'kx 弹簧',slen:'kx 弹簧',sdamp:'kx 弹簧',
  wmass:'本体',wfrict:'本体',wbounc:'本体',wair:'本体',convspeed:'本体',beltangle:'本体',rlen:'本体'};   // R99 带速；R101⑦ 绳长；★R115 删 wroll
function renderParamPanel(){
  if(!paramBody)return;
  // R71⑪（用户：「菜单标题写物体的具体名称（圆1、弧1…）」）：标题直接用编号名，
  // 不再显示裸的 kind（'W' / 'S' / 'T' 这种对用户毫无意义的内部代号）。
  /* ★★R132-9m（用户：「在字符 t 的参数面板里为什么标题写的是物体1，而不是 t？还有没有其他字符
   *  也是这样的」）：**所有字符都是这样**，不只 t。原因是右键字符时传进来的 `paramBody` 是
   *  一个**临时参数宿主体**（`openMenu(...,mb,d)` 里的 `mb`，见 R131-49 的注释：
   *  「赋予型字符 promote 后**有宿主但不在 glyphs/mem 里**」），它没有字号/名称信息，
   *  `bodyName()` 只能按 kind 编出「物体1」。
   *  ⇒ 只要这次面板是**针对某个字符**打开的（`paramLetter` 非空），标题就用字符本身
   *    （`t · 参数`），而不是那个临时宿主体的编号。整块物体（`paramLetter` 为空）时保持原样。 */
  ptitleEl.textContent=(paramLetter?paramLetter.ch:bodyName(paramBody))+' · 参数';
  var sub=[];
  if(paramLetter)sub.push(paramLetter.ch+' → '+specIdForLetter(paramLetter,paramBody));
  else sub.push(paramBody.mem.length?paramBody.mem.map(function(g){return g.type;}).join(' '):(paramBody.kind||''));
  pvalEl.textContent=sub.join(' ');
  var ids=(paramLetter)?paramDefForLetter(paramBody,paramLetter):paramDef(paramBody);
  // rebuild rows
  prows.innerHTML='';
  paramRows=[];
  for(var i=0;i<ids.length;i++){
    var spec=PARAM_DEFS[ids[i]];
    // R71⑪：W 体的弹性/摩擦不再是「一条无差别的滑块」，而是下拉框 + 逐物配对表。
    if(paramBody.kind==='W'&&ids[i]==='wbounc'){appendPairRow(spec,'e');continue;}
    if(paramBody.kind==='W'&&ids[i]==='wfrict'){appendPairRow(spec,'mu');continue;}
    // ★R115：原先这里还有一条 `if(ids[i]==='wroll'){appendPairRow(spec,'roll');continue;}` ——
    //   滚动摩擦已移除，配对表只剩 弹性 e / 摩擦 μ 两条通道。
    // ★R105-6：布尔参数（「固定铰链」开关）—— 渲染成一个开/关按钮，不是滑块+数字框。
    //   复用设置面板那套 `.sbtn/.sbtn.act` 的选中视觉（同一门「看起来是同一类控件」的纪律）。
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
    /* ★★R131-35：**可视化的角度调节**——v 的方向行加一个可拖动的指向箭头（圆盘），
     *  拖动箭头即改角度（与数字框/滑块双向同步，0°=水平向右，屏幕坐标系向下为正）。 */
    if(spec.key==='vang'||spec.key==='aang'||spec.key==='waccang'){
      /* ★★R131-61（用户：「我明明改了角度再给物体融合，融合过后物体的角度还是 0」）：
       *  这个圆盘是 vang / aang / waccang **三行共用**的，但原来**把 vang 写死了**：
       *    · 初始箭头读 `paramV(paramBody,'vang')`；
       *    · 拖动写 `applyParam(paramBody,PARAM_DEFS.vang,deg)`；
       *    · 写回字符只写 `paramLetter.vAng`。
       *  ⇒ 在 a 的「加速度方向 θ」或物体的「加速度方向 θ」上拖圆盘，**改的一律是 v 的角度**，
       *     aAng / accAng 从未被写过 ⇒ 融合后 accAng 恒 0（用户看到的就是 0）。
       *  另外两处同类的脆写法：`rr=paramRows[paramRows.length-1]`（靠"角度行恰好在最后"才没炸）、
       *  以及直接引用循环变量 `sl/nu/val`（它们是**函数作用域**，与 R124「默认按钮」同一个坑）。
       *  修：整段包进 IIFE，逐行捕获**自己那一行**的 spec / sl / nu / val。 */
      (function(_spec,_sl,_nu,_val){
      var dial=document.createElement('div');
      dial.className='pdial';
      dial.style.cssText='width:44px;height:44px;flex:none;cursor:grab;touch-action:none;margin:2px 0 0 6px';
      /* ★R131-36c：轮盘重做——贴合周围的控件语言（半透明白底 + 细边框 + 柔和阴影 +
       *  四周刻度 + 圆头指针 + 中心小圆），与 .ttoggle / .sbtn 同一套观感。 */
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
      _setArrow(paramV(paramBody,_spec.key)||0);   // ★R131-61：读**本行**的角度（原来恒读 vang）
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
        /* 与滑块/数字框同一入口：写回参数（applyParam）⇒ 重渲染同步显示。
         * ★R131-61：写**本行**的 spec（原来恒写 vang），写回字符也按本行分派。 */
        applyParam(paramBody,_spec,deg);
        if(paramLetter){
          if(_spec.key==='vang')paramLetter.vAng=deg;
          else if(_spec.key==='aang')paramLetter.aAng=deg;
        }
        /* ★R131-61：同步**本行**的滑块/数字框/读数（原来取"最后一行"的控件） */
        _sl.value=deg;_nu.value=deg;
        if(_val)_val.textContent=fmtVal(deg,_spec);
      });
      dial.addEventListener('pointerup',function(e){_drag=false;dial.style.cursor='grab';});
      dial.title='拖动旋钮设定'+(paramLabel(_spec).replace('方向 θ','')||'')+'方向（0°=水平向右，向上为 −90°）';
      dial.addEventListener('pointerenter',function(){dial.style.filter='brightness(1.03)';});
      dial.addEventListener('pointerleave',function(){dial.style.filter='';});
      row.appendChild(dial);
      })(spec,sl,nu,val);   // ★R131-61：IIFE 收口 —— 每个圆盘只认自己那一行的 spec/控件
    }
    // R68：面板以 SI 单位显示/输入（SI = 内部/siK），内部仍是 px —— 滑块范围、步长一并换算。
    var kSI=spec.siK||1;
    var cur=paramV(paramBody,ids[i])/kSI;
    sl.min=spec.min/kSI;sl.max=spec.max/kSI;sl.step=spec.step/kSI;sl.value=cur;
    nu.value=Math.round(cur*1000)/1000;
    val.textContent=fmtVal(cur,spec);
    /* ★★R132 BOSS：光速态回显 —— 面板重渲染（换体/点默认/拖圆盘）后不能把「c = 光速」丢回数字。
     *  滑块顶到最右（max 临时放宽到光速），数字框留空 + placeholder='c'。 */
    if(spec.key==='vsize'&&bossLightState()){
      sl.max=C_LIGHT;sl.value=C_LIGHT;
      nu.value='';nu.placeholder='c';
      /* ★R132-9n（用户：「给 v 输入框输入 c 的时候，那个参数面板里面显示的不是 v=299… 什么的吗，
       *  把那个 = 改成 ≈」）：显示成 `v ≈ …`（`c` 是约定的精确值，但屏幕上给的是换算后的
       *  px/s 量级读数，写成等号过强）—— 与 `bossLightOn` 里那条保持同一份文案。 */
      val.textContent='c ≈ '+C_LIGHT+' m/s';
    }
    // single 默认 button: resets THIS row's param to its default value
    var dflt=document.createElement('button');
    dflt.textContent='默认';
    dflt.title='回到默认数值';
    // ★★R124 修（用户实测：「点默认也没变化」）：原来这里直接闭包引用**循环变量** `spec`。
    //   `var spec=PARAM_DEFS[ids[i]]` 是**函数作用域**，循环结束后它停在**最后一行**的 spec
    //   ⇒ 面板上**每一行**的「默认」都只会把**最后一行**的参数打回默认：
    //     弹簧面板（sk / slen / sdamp）⇒ 只有 sdamp 会动；
    //     W 体面板（wmass / wair） ⇒ 只有 wair 会动。
    //   实测（`_diag_r124a.py`，真实鼠标点击）：arm 成 ks=200 / slen=220 / sdamp=5.8 后，
    //   点 **sk 行**的「默认」⇒ **sdamp 回落 0.8**、ks 纹丝不动（仍 200）—— 实锤。
    //   ★同一段下方的 `sl.oninput` / `nu.onchange` 早就用了 IIFE 捕获 `spec2`，唯独这里漏了。
    //   修法：同款 IIFE 把**本行**的 spec 固定住。`paramBody` 仍取全局引用（面板显示的就是
    //   当前选中体；一换体 `openParams` 就整体重渲染，与滑块捕获 B2 在下述意义上等价）。
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
        /* ★★R132-9d：**光速态下输入框是空的**（placeholder='c' 是占位符）。
         *  此时 change/blur 再按“空 ⇒ 回默认值”处理会把刚设好的光速打回 1800，
         *  并且顺手清掉光速态 ⇒ 用户报的「改成 c 后怎么再修改都修改不了了」。
         *  ⇒ 这个分支直接跳过（保持光速态）；想改回数字就直接输一个数（那条路不受影响）。 */
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
        /* ★★R132-9d：**光速态下输入框是空的**（placeholder='c' 是占位符）。
         *  此时 change/blur 再按“空 ⇒ 回默认值”处理会把刚设好的光速打回 1800，
         *  并且顺手清掉光速态 ⇒ 用户报的「改成 c 后怎么再修改都修改不了了」。
         *  ⇒ 这个分支直接跳过（保持光速态）；想改回数字就直接输一个数（那条路不受影响）。 */
        if((isNaN(v)||nu2.value==='')&&typeof bossLightState==='function'&&bossLightState())return;
        if(isNaN(v)||v==='')v=paramDefVal(B2,spec2)/k2;
        applyParam(B2,spec2,v*k2);
        sl2.value=v;
        nu2.value=Math.round(v*1000)/1000;
        val2.textContent=fmtVal(v,spec2);
      };
    })(spec,paramBody,nu,sl,val,kSI));
    // R72（用户：「参数输入后回车即完成输入」）：number 框的 change 在回车时本就会触发应用，
    // 但焦点仍留在框里 —— 后续按键继续被当成编辑，画布的快捷键也回不来。回车 = 应用 + 交还焦点。
    nu.addEventListener('keydown',(function(nu2){
      return function(e){ if(e.key==='Enter'){e.stopPropagation();nu2.blur();} };
    })(nu));
    /* ★★R132 BOSS：**v 的大小参数框里输入字母 c ⇒ 数值变成光速**。
     *  `<input type=number>` 本身会把字母吞掉（keydown 之后 value 变空），所以只能在
     *  keydown 阶段捕获。只在 vsize 行生效，其余行不受影响。 */
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
// R71⑪（用户：「菜单标题写物体的具体名称（圆1、弧1…）」）：每个物体都有**稳定**的中文名。
// 名字只在第一次被请求时生成并缓存进 B._nm —— 之后即使前面同类的物体被删掉，名字也不变
// （否则用户按名字设好的配对系数会因为改名而「跑掉」，这比编号不连续糟得多）。
function nameBase(B){
  if(!B)return '物体';
  if(B.kind==='W'){
    if(B.wshape==='circle'&&B.rad)return '圆';
    // R102（用户：「改叫做圆轨」）：显示名 圆环 → **圆轨**。内部键仍是 'ring'（见形状按钮处注释）。
    if(B.wshape==='ring'&&B.rad)return '圆轨';   // R82 空心圆 / R102 改名
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
// 双方都显式设过同一条 → 取平均（两边都是用户的明确意图，平均是唯一不偏袒任一方的读法）。
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
  // ★R115：原 `roll:pick('roll')`（滚动摩擦的第三通道）已删。配对覆盖只剩 弹性 e / 摩擦 μ。
  return {e:pick('e'),mu:pick('mu')};
}
function setPairOv(B,key,field,val){
  if(!B||!key)return;
  if(!B.pOv)B.pOv={};
  if(!B.pOv[key])B.pOv[key]={e:null,mu:null};   // ★R115：删 roll
  B.pOv[key][field]=val;
  // R74-C（用户：「A 面板里把『相对于 B』的某参数调成 c ⇒ B 面板里『相对于 A』的那个参数同步为 c」）：
  // A↔B 双向镜像写入。只对能反查出**场上实体**的键联动（地面/墙没有面板，且 pairOvAB 里
  // B 自己那一侧已生效，镜像进去是行为惰性的死数据，不写）；本体默认行（key=null）走
  // applyParam 不经这里。镜像用同一 field 同值，last-write-wins，两侧状态恒一致。
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
      if(!peer.pOv[rev])peer.pOv[rev]={e:null,mu:null};   // ★R115：删 roll（A↔B 双向镜像）
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
// R64：Matter 体 -> 可读名字（接触区用）。ground/wall 是引擎常驻静态体，其余按 mb 反查实体。
// R71⑪：名字换成编号名（圆1/弧1/杆1…），与配对表里的标题同源。
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
// R71⑪：一行「下拉框 + 展开的配对表」。specId = 'wbounc'(弹性 e) 或 'wfrict'(摩擦 μ)。
// 结构刻意保留 .prow/.prhead/.plab/.prval/.presets —— 旧探针按这些类名数行/取标签，
// 只有中间的控件从 range 换成了「下拉 + 逐对输入」，行数与语义都不变。
function appendPairRow(spec,field){
  var B=paramBody;
  var row=document.createElement('div');
  row.className='prow';
  var head=document.createElement('div');
  head.className='prhead';
  var lab=document.createElement('span');
  lab.className='plab';lab.textContent=spec.label;
  // R72-D（用户：「怎么没有写哪个是对哪个物体的？」）：μ / e 走的是这条「下拉 + 逐物配对」
  // 的独立渲染分支，归属标注不能只在主参数行加 —— 否则最常调的两行反而没有标注。
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
  // ★R115：原第三态 'roll'（滚动摩擦 ω）已删，只剩 弹性 e / 摩擦 μ。
  pane.innerHTML='<div class="pph"><span>物体</span><span>'+
                 (field==='e'?'弹性 e':'摩擦 μ')+
                 '</span><span></span></div>';
  // R73-B：面板重建（改一个配对值 / 换默认都会走 renderParamPanel）时把展开状态还原 ——
  // pairOpenField 是模块级的，重建后 DOM 是新的，不还原的话用户输一个数展开就塌了。
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
      // R92：输入域的上限/步长取 **spec**（μ/e 都是 1 / 0.01）——写死会让参数能填到
      // 物理上无意义的区间。★R115：滚动摩擦那档（0.5 / 0.001）已随该参数一起删除。
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
      // R72：与主参数行同一条「回车即完成输入」纪律
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
    // R73-B（用户：「展开摩擦系数，就显示关于摩擦的接触，展开弹力系数，就显示关于弹力的接触情况」）：
    // 下方接触区跟着**最后展开的那一行**走（两个都展开时以最近点的为准，语义无歧义）。
    // 这里**不能**调 renderParamPanel() —— 它会重建整个面板，展开状态当场丢掉；
    // 接触区本来就是逐帧刷新的，直接调一次让它立刻换口径即可。
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
// R64（用户：「如果此时该物体还接触了其他的物体，则还会临时显示与该物体的摩擦系数大小」）：
// 参数面板开着且对象是 W 体时，列出配对摩擦的**实际生效**数值（动摩擦 = 双方 min、
// 静摩擦 = 双方 max —— 面板里调的 μ 只是本体的那一份）。
// R72（用户：「参数的下面怎么还显示的接触起效，我不是说了，不需要接触就能识别到吗，
// 是对全场存在的东西的」）：不再只列「正在接触」的对 —— 改为列**全场所有对象**
// （含地面/墙），接触中的显示 Matter pair 的实际生效值，未接触的显示按配对规则
// 「将要生效」的值（μ=min 双方）。识别对象从来不需要先接触。
function updateParamContacts(){
  if(!pcontacts)return;
  var show=paramBody&&paramBody.kind==='W'&&paramBody.mb&&MW&&pbox.classList.contains('on');
  if(!show){pcontacts.classList.remove('on');pcontacts.innerHTML='';return;}
  // R73-B（用户：「如果展开摩擦系数，就显示关于摩擦的接触，如果展开弹力系数，就显示关于弹力的
  // 接触情况」）：这一区显示的量跟着**展开的配对行**走 —— 展开 μ 行看摩擦、展开 e 行看弹性、
  // 两行都收起（或从没展开）时维持旧口径（摩擦）。pairOpenField 由 appendPairRow 的配对按钮维护。
  var isE=(pairOpenField==='e');   // ★R115：isRoll 已删（滚动摩擦移除）
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
    /* ★R115：原 `if(isRoll){…}else if(isE){…}` 里的滚动摩擦分支已删 ——
     *   那一支是「滚动摩擦没有 Matter pair 字段，生效值由 wRollEff 链条自己算」的读数
     *   （读的是「将要/正在生效」的数），随滚动摩擦一起移除。 */
    if(isE){
      if(pr)txt='e='+Math.round(pr.restitution*1000)/1000;   // ⑦ 显式配对覆盖已写进 pr，直接用实际值
      else if(restOther!=null){
        var effE=Math.max(wEffE(paramBody),restOther);       // 默认规则：取双方 max（R65/R70⑥）
        // R76：μ=0 极值 ⇒ rest=1 的**显示**也必须与物理同源 —— 只在显式声明 μ=0 时才算，
        // 否则高中模式的默认 μ=0 会让这里每一行都显示 e=1，而实际物理是 0（读数骗人）。
        if(muIdealOther||wMuIdeal(paramBody))effE=1;
        txt='max 规则 → '+Math.round(effE*1000)/1000;
      }else txt='—';
    }else{
      if(pr)txt='μ='+Math.round(pr.friction*1000)/1000+'（静 '+Math.round(pr.frictionStatic*1000)/1000+'）';
      else if(muOther!=null){
        var eff=Math.min(wEffMu(paramBody),muOther);         // 默认规则：取双方 min（R68）
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
  clampParamPanel();   // R65：接触行每帧增减，面板高度变了就重新夹紧（不追踪物体位置）
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
/* ★★R111：**把支撑体拖走时，压在它上面的东西必须被唤醒**。
 *   它们是**睡着**的（静止在平台上 ⇒ Matter 让它们睡了），而睡眠体不会因为
 *   「脚下的东西走了」自己醒过来 ⇒ 球悬在空中不动。
 *   （用户：「球静止在那个器件地面上，移开地面，球会悬浮在空中不动，**有概率**」
 *    ——「有概率」正是因为睡没睡是随机的）
 *   ★与 R109 的 `killBody` 唤醒是**同一条病、另一条路径**（那条修的是「删掉」，本条修的是「搬走」）。
 *   只唤醒**附近**的睡眠体：拖动是交互态，全场景唤醒会白费休眠。 */
function wakeSleepNear(x,y,rad){
  if(!MW||!MW.engine||typeof Matter==='undefined'||!Matter.Sleeping)return 0;
  var bs=Matter.Composite.allBodies(MW.engine.world),n=0;
  for(var i=0;i<bs.length;i++){var b=bs[i];
    if(!b||b.isStatic||!b.isSleeping)continue;
    if(Math.hypot(b.position.x-x,b.position.y-y)<=rad){Matter.Sleeping.set(b,false);n++;}}
  return n;
}

function clearAll(){
  /* ★★R131-42（用户：「黑洞出现后双击垃圾桶清屏，黑洞底下的粒子效果还残留」）：
   *  清屏必须把**黑洞特效状态**一并复位（粒子/光环/合并态/终局态），否则粒子继续飘。 */
  try{
    if(typeof particles!=='undefined'&&particles&&particles.length)particles.length=0;
    if(typeof rings!=='undefined'&&rings&&rings.length)rings.length=0;
    if(typeof sparks!=='undefined'&&sparks&&sparks.length)sparks.length=0;
    if(typeof BH_MERGE!=='undefined')BH_MERGE=null;
    if(typeof BH_FINALE!=='undefined')BH_FINALE=null;
    /* ★R131-43（用户：「清屏后字符回到初始排列，和下拉按钮又重合、a 又跑回原位」）：
     *  清屏会把 dock 字符重新 dockLetter ⇒ 布局回到默认 ⇒ 必须**重跑 fixPanelSlot**
     *  把第 4 格留空、a 换行的排布重新施加。 */
    if(typeof fixPanelSlot==='function')setTimeout(fixPanelSlot,0);
  }catch(e){}
  /* ★★R110：**清空必须连约束一起清**。clearAll 走的是它自己那条销毁路径
     （不是 killBody），所以 R109 挂在 killBody 上的约束清理**跑不到**
     ⇒ 铰链的真 Constraint 会残留并累积（_diag_r110 C3/C4 实测：建 1 → 清空后仍 1 → 再建一对变 2）。
     体都没了，约束就没有意义 ⇒ 直接把世界的 constraints 列表清空。 */
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
  // restore panel singletons: alive ones go back to dock; dead ones are rebuilt from scratch
  // so a black hole that consumed a panel letter does not leave the panel crippled.
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
        case 'kO':kO=nd;break;case 'xO':xO=nd;break;   // R57：新增 k / x
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
  // purge any duplicate docked clones left behind by earlier dock bugs — the palette holds
  // exactly the canonical singletons, one cell each.
  var canon=[mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO,kO,xO];
  [].slice.call(panel.querySelectorAll('.char')).forEach(function(e){
    var keep=false;
    for(var ci=0;ci<canon.length;ci++)if(canon[ci].el===e){keep=true;break;}
    if(!keep&&e.parentNode===panel)panel.removeChild(e);
  });
  sortPanel();
  /* ★★R132 BOSS：**清屏必须把 boss 也一起收掉**。
   *  `bossFinish` 走的就是 `clearAll()`，所以这里必须容忍「已经被 bossFinish 置成 null」；
   *  `bossAbort()` 自己开头 `if(!BOSS)return;`。反过来，用户手动双击垃圾桶清屏时
   *  （boss 正悬在空中）也必须把平台/遮罩/被冻结的原型体一并撤掉，否则清屏后天上还挂着一行公式。 */
  try{ if(typeof bossAbort==='function')bossAbort(); }catch(e){}
}
trash.addEventListener('dblclick',function(e){e.preventDefault();clearAll();});
/* ★★R131-32f（用户：「杆固定一端后双击无法解除」）：**原生 dblclick 通道**（捕获阶段）——
 *  双击锚定端/锚定点 ⇒ 断开该端锚定。不依赖 pointerdown 的 dblState 路径（实测手柄
 *  与各分支会把它吃掉）。 */
DD.addEventListener('dblclick',function(e){
  var x=e.clientX,y=e.clientY;
  if(typeof springDisconnectAtPoint==='function'&&springDisconnectAtPoint(x,y)){
    if(grab){grab.kind=null;grab.obj=null;}
    if(typeof dblState!=='undefined'&&dblState){dblState.t=0;dblState.body=null;}
    e.preventDefault();e.stopPropagation();
  }
},true);
/* ★R131-27b（触屏）：dblclick 在触屏不可靠 ⇒ 用两次 tap（<450ms）触发清屏；
 *  单指按住拖动 = 拖垃圾桶（trashDrag 由 pointerdown 启动，触屏同样走 pointer 事件）。 */
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
  var rcx=r.left+r.width/2, rcy=r.top+r.height/2;    // R61：弹簧/杆没有字形，要按线段判
  for(var i=freeL.length-1;i>=0;i--){
    var d=freeL[i];
    if(overlap(r,d.el.getBoundingClientRect()))killLetter(d);
  }
  for(var j=bodies.length-1;j>=0;j--){
    var B=bodies[j],hit=false;
    if(B.kind==='S'){
      // R61（用户：「将垃圾桶拖到弹簧上无法删除，拖到弹簧的整体上也无法删除」）：
      // 弹簧没有字形（B.glyphs 为空），旧代码落到 else 分支里空转一圈 -> hit 永远 false，
      // 于是垃圾桶怎么拖都删不掉它。用线圈线段（带 SPR_GRAB 容差）+ 两端点做判定。
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
  /* ★R107-5：铰链被删除时必须把那条真 Constraint 一起摘掉；
     否则它会继续把两个宿主永久钉在一起（而且是隐形的）。 */
  if(B&&B._hcon&&typeof hingeConstraintDrop==='function')hingeConstraintDrop(B);
  /* ★★R109：删体 ⇒ **世界里任何引用它的约束都要摘掉**（不管那条约束属于谁）。
     为什么放在这里而不是 hingeSolve / springSyncEnds：宿主被删后，`hingeSolve` 第一行 `if(!h0||!h1)return;` 就返回了，
     而 springSyncEnds 只在铰链仍被 stepSprings 走到时才会跑 —— 两条路u90fd可能跑不到（_diag_r109 H2 实测：删宿主后约束数 1 → 1）。
     → 改在**删除的源头**上做：一个体没了，引用它的约束就没有意义，留下来就是把另一个体隐形地钉住。 */
  if(B&&B.mb&&MW&&typeof Matter!=='undefined'&&Matter.Composite&&Matter.Composite.allConstraints){
    var _cs=Matter.Composite.allConstraints(MW.engine.world);
    for(var _ci=0;_ci<_cs.length;_ci++){
      var _c=_cs[_ci];
      if(_c&&(_c.bodyA===B.mb||_c.bodyB===B.mb))Matter.Composite.remove(MW.engine.world,_c);
    }
  }
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  removeMatterBody(B);    // boundaries & rod mirrors live in the Matter world as well
  /* ★★R109：**删掉一个支撑体后，压在它上面的东西可能正睡着**；
     没人唤醒它们 ⇒ 支撑消失了但它们仍然挂在空中。
     实测（_dbg_r109_sleep.py）：删平台后方块停在 y=561.36 且 `isSleeping=true`，
     强制 `Matter.Sleeping.set(false)` 后掉到 y=692.69（画布地面）。
     → 在**删除的源头**上做：把世界里所有睡眠的非静止体唤醒。
     开销可控：只在删体时做一次，不影响常规每帧开销（睡眠本身是为了省开销）。 */
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

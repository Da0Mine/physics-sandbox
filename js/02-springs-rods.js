/* 弹簧、杆约束、铰链力矩、吸附点、Matter 碰撞补丁、UI 模式切换（原 index.html 第 1438–5487 行） */
/* ================= R57 弹簧（kind 'S'）：k × x ========================================
 * 用户 #8 原文：
 *   「kx拼接后变成一个弹簧，这个弹簧可以固定在其他物体上，具体方式是弹簧没有接上物体时是
 *     固定的，只有鼠标能拖动，鼠标拖动后，只有弹簧的两端端点处与其他物体发生接触，则固定，
 *     然后这个弹簧就好像轻质弹簧一样随其他物体运动，并且发挥弹簧的弹力(碰到或撞到什么物体
 *     形变且弹力)，然后这时，鼠标拖动的话，就是一起拖动这个整体，如果还有一端没有固定，则
 *     拖动到哪里，有的话就继续固定，双击这个整体就会解散变回原样」
 *
 * 数据模型：两端 e0 / e1 是**唯一权威几何**；B.x / B.y / B.th / B.hw 每帧从它们派生。
 *   · 端点没拴住 -> 就停在原地。弹簧是「轻质」的（没有重力），所以「没接上物体时是固定的」，
 *     只有鼠标能拖。
 *   · 端点拴住   -> 每帧从宿主位姿反算 e = host.pos + R(host.th)·本地偏移。宿主一动，弹簧两端
 *     跟着动 —— 这就是「随其他物体运动」。
 *   · 弹力       -> f = ks·(|e1-e0| − L₀) − damp·v_rel：拉长了把两端往回拽，压短了往外推，
 *     成对地施加在两端的宿主身上（牛顿第三定律）。W 边界（画出来的线）与右键固定体按无限大
 *     质量处理，只当锚点、不产生位移 —— 它们本来就是设计里的「铁砧」。
 *   · 拖动       -> 抓弹簧 = 平移整条弹簧**以及它拴住的宿主**（BFS 收集整个装配体），这就是
 *     「一起拖动这个整体」；拴在边界上的一端拖不动（墙不能被弹簧拖走）。
 *   · 双击       -> 解散：killBody(弹簧) + 在原地吐出 k / x 两个自由字母（「解散变回原样」）。
 * 视觉：锯齿线圈，圈数随长度自适应；拉长偏红 / 压短偏蓝 / 原长墨黑；拴住的一端画实心锚点。
 */
var SPR_GRAB=16;         // 线圈的可抓/可悬浮带宽（与「只有有线才响应」一致）
var SPR_PAD=15;          // 端点判定「碰到别的物体」的距离
var SPR_KS_DEF=250;      // ★R130c（用户：「弹簧默认改成250」）：300 → 250 N/m。夹子缩放锚点
                         //   已冻结在 SPR_KS_ANCHOR=150（R130b），改默认不再动夹子行为。
                         // 理论悬挂伸长 mg/k = 2600/250 = 10.4px（自然长度 110px，+9.5%）。
                         // 历史：26(蹦极绳) -> 94 -> 180(太硬，1kg 球高频抖动) -> 50(R87-E)
                         //      -> 100(R118) -> 150(R119) -> 300(R130) -> 250(R130c)。
                         // ⚠ 改这个数必须同时抬 sk 滑块的 max（见 PARAM_DEFS.sk），否则默认值
                         //   顶在量程上沿、面板一拉就把 k 拽回来（R130 实测：def=300 而 max 仍是
                         //   300 ⇒ 滑块满格，用户根本拉不上去）。
/* ★★R132-9n（用户 2026-10-02：「那**每个物体摩擦力系数**的参数面板调节怎么感觉参数调了之后
 *  没效果呢？调了和没调一样」+「默认初始状态下还是保持手感不变，你可以调节里面的默认参数」）：
 *  `_diag_r346` 定量结论 —— 干净夹具（宽扁块 240×36 贴地静置后给 500px/s，量**减速度**）：
 *      μ=0.05 / 0.30 / 1.00 ⇒ 减速度**恒为 1500 px/s²**（= 0.577·g，等于地面的静摩擦口径）
 *  ⇒ 有效摩擦由 `frictionStatic`（写死 0.6）主导，**与 μ 完全无关** ⇒ 调 μ 当然没反应。
 *  ★★**结论修正（同轮实测推翻）**：把 `frictionStatic` 改成跟随 μ（并抬地面 static、默认 μ→0.58）
 *  之后，读数**逐位不变**（μ=0.05 滑行 72.1px、μ=1.0 滑行 19.8px，改动前 72.1/19.9）
 *  ⇒ `frictionStatic` **不是**驱动量，本次改动已**整体回退**。
 *  先前「μ 完全无效」的判断有两个量尺缺陷，记下来别再犯：
 *    · 夹具：方块从空中 30px 落下 + 窄高比 ⇒ 「下落冲击 + 滑行前倾翻倒」把摩擦信号淹了；
 *    · 指标：20 帧固定窗口里物体**已经停住**，`(v0−v1)/Δt` 恒等于 v0/Δt = 1500 ⇒ 指标饱和，
 *      三种 μ 当然一样。⇒ 摩擦类量尺必须用「**滑行距离/停住时间**」，不能用固定窗口的平均减速度。
 *  现实读数（干净夹具）：μ=0.05 → 72px、μ=1.0 → 20px（**3.6×**，方向正确但远小于 1/μ 的 20×），
 *  「为什么只有 3.6×」尚未定位。 */
var WFRICT_DEF=0.08;
/* ★R132-9zb：「把字母给谁」的凸包命中判定**只对跨度不超过这个值的图形生效**（px）。
   420 ≈ 画布短边的量级：合上的圆/方/三角都在内；横贯屏幕的长线条不适用（见 bodyFillHit）。 */
var BODY_FILL_MAX=420;
/* ★R132-9r：W 体 `frictionStatic` 的两档（**唯一真源**，`applyWFrict` 读它）。
 *   改动前物体侧恒写 0.6，而静态框那侧是 Matter 默认 0.5 ⇒ 配对 `min` 后恒为 0.5。
 *   `WF_STATIC_DEF` 复刻那个 0.5（保证 μ≤cap 的物体行为**逐位不变**）；
 *   μ>cap 才让静摩擦跟随 μ（否则「μ 调到 1」一直是死区，用户原话）。 */
var WF_STATIC_DEF=0.5;
var WF_STATIC_CAP=0.6;
/* ★R132-9r：W 体静摩擦的**唯一真源**（体级、parts、配对覆盖三处都走它）。
 *   改动前那三处各写各的 `0.6`，而静态框那侧是 Matter 默认 0.5 ⇒ 配对 min 后恒为 0.5，
 *   「μ 调到 1」一直是死区（用户原话：「摩擦力调成 1 了，怎么还和之前一样缓慢下滑」）。
 *   ★**静摩擦地板 = 0.5 本身就是 μ 压缩的元凶**：摩擦冲量 = `friction × 法向力`，
 *     而静摩擦阈值 `frictionStatic` 决定「低速段直接粘住不滑」—— μ≤0.5 时两者叠加，
 *     刹车力被那个**与 μ 无关的地板**抬到 ≈0.67g，于是 μ=0.05 与 μ=0.5 的滑行距离
 *     只差 2.8×（实测 72.1px vs 26.0px），μ=0.6→1.0 更只差 15%（24.0 → 20.4px）
 *     ⇒ 用户把 μ 拉满也「跟没调一样」。
 *   ⇒ 这里让静摩擦**完全跟随 μ**（R132-9n 注释里声明的意图），静态框保持 1（不成为天花板），
 *     并把 `WFRICT_DEF` 标定到「与改动前默认手感等效」的那个值（见下面的标定注释）。 */
function wfStaticOf(mu){
  /* μ≤cap 仍取 0.6（R65 的「停下来的物体仍站得稳」设计不变，也是 `_probe_r89.py` 守的
     「未调过的体 fs=0.6」）；只有 μ>cap 才让静摩擦跟随 μ —— 因为静态框已抬到 1.0，
     配对 min 之后天花板就是**物体自己**，不放开的话 μ>0.6 仍是死区。 */
  return (mu>WF_STATIC_CAP)?mu:((mu>0)?0.6:0);      /* ★μ=0 必须真为 0（光滑语义，H-2） */
}
var SPR_DAMP=0.8;        // ★R118（用户：「阻尼比0.08」）：高中模式 ζ = damp/SPR_HIGH_ZETA_DIV
                         // = 0.8/10 = 0.08。⚠ 大学模式同一个滑块读的是**有量纲阻尼 D=0.8**
                         // （R87-E 口径 ζ_大学 = D/(2√(k·m))，k=150/m=1 ⇒ ζ≈0.033）。
                         // 7.1 明显更「弹」——这是用户点名的值，如嫌振荡多再调滑块）。
                         // 历史：0.294(3~4 次振荡) -> 7.1(ζ_大学 0.5，R87-E) -> 0.8(高中 ζ=0.08，R118)。
var SPR_MIRROR_TOL=10;   // Matter 镜像长度变化超过它才重建（不能每帧造体）
// R63（用户：「弹簧老是会导致物体翻滚……在地面连接两个正方体，拉动时总是导致另一个正方体翻转，
// 使连接点位于远端」）：弹力对**画出来的图形**（W 体）的**水平**加速度上限，单位是 g。
// 为什么必须有这一条：方块在地面上被水平拉动时，「翻过去」和「滑过去」的分界是绕**底边**的取矩 ——
//   翻倒力矩 = F·(h/2)；回复力矩 = mg·(w/2)  ⇒  a_x > g·w/h 就翻（正方形 w=h，就是 a_x > g）。
// 这个阈值**与摩擦无关**，所以只要把 a_x 压到阈值以下，方块无论多大多重、ks 多大、拖多快，
// 都只能滑、不能翻 —— 用户要的「连接点被拉向近端」。
// 阈值里的 w/h **必须按每个物体自己的纵横比算**，一刀切是错的（实测）：
//   · 竖长方形 90x110 的真实阈值只有 g·90/110 = 0.818g —— 一刀切 0.95g 会把它掀翻 115.6°；
//   · 扁长方形 140x80 的阈值高达 1.75g —— 一刀切反而白白少给它一倍拉力，白白落后 190px。
// 按纵横比缩放后：140x80 的落后从 190px 降到 79px、形变峰值从 188px 降到 76px，
// 同时六种形状（40/60/90/130 正方形、90x110、140x80）翻转全部为 0.0°。
// 0.90 是留的余量：滑动中的接触抖动会额外贡献一点角冲量，贴着 1.00 太危险。
// 竖直分量不受限，所以「弹簧吊起物体」「斜着往上拽」照旧（那本来就需要 g 以上的竖直拉力）。
var SPR_AX_G=0.90;
// R63b（用户：「翻转过去之后，无论怎么提另一块、哪怕绕圈，那块的方向再也不变了」）：
// 多边形（画的方块/笔画/凹槽）的**力矩**上限，单位是 g。上面 SPR_AX_G 只管「拉力偶」
// （力作用在质心 + 地面摩擦，那个力偶需要 a_x > g·w/h 才掀得翻）；这条管的是**直接拧**
// （τ = r×F，力作用在锚点上）。取 min(hw,hh)（各种躺法里最保守的半宽）作力臂口径，
// 地面上躺着时回复力矩 mg·(半宽) 恒压住它，拧不翻躺稳的方块。
// **设计决断（用户拍板选 B）**：这条通道必须存在 —— 没有它，弹力永远作用在质心，方块
// 朝向一旦落稳就再无通道能改（= 用户抱怨的「方向永久锁死」）。代价是物理正确且已接受的：
// 悬空/悬挂时没有地面回复力矩，锚点在侧面的方块会被拧到「锚点朝上」（钟摆行为），
// 快速上提确实会翻 —— 参数扫描（_probe_r63b_tau）：tau=0 完全不转（锁死），0.15/0.30/
// 0.45/0.60 上提分别翻 −90/−180/−113/−270°，P1 水平拖在所有档位都是 −0.03°。
// 0.30 取中档：足以带动转向跟手，ω 峰值 496°/s（0.60 档是 700°/s，甩得太狠）。
var SPR_TAU_G=0.30;
// R63b：弹力对 W 体的**竖直**加速度上限，单位是 g。与水平限幅（SPR_AX_G）是一对，但 bound 不同、
// 理由也不同：竖直必须**大于 1g**（否则弹簧吊不起任何东西——悬挂平衡本来就要 F=mg），所以取
// 1.35；它的作用是掐掉「猛地一提」时的 9.2g 瞬时过冲 —— 那股过冲会把它下面的方块整个甩上天，
// 落地翻滚，翻完就卡在那个姿态（配合上面的力矩通道，就是「提一下就翻」的直接来源）。
// 1.35 ⇒ 被吊的方块最多以 0.35g 的净加速度上升，跟得上手但不至于被弹射。
var SPR_AY_G=1.35;
// R88⑤（用户：「我调了50和50000对一个1kg的小球的拉力效果大差不大」）—— 三道夹子必须**随 ks 缩放**。
// 现象（_diag_r85a_springk.py 改码前实测，1kg 球挂在弹簧上）：
//   k = 50 / 500 / 5000 / 50000 时，
//     · 水平拉 150px 的**夹子命中率** = 51% / 91% / 100% / 100%；
//     · 静平衡伸长 = 51.7 / 5.21 / 5.73 / **63.2** px，而理论 mg/k = 52 / 5.2 / 0.52 / 0.052。
//   ⇒ k ≥ 5000 之后不只是「没差别」，**方向还反了**：k=50000 比 k=50 吊得更低；
//     「实测加速度峰值」四档全等 3510px/s²，这才是「拉力效果大差不大」的直接读数。
// 根因（两条串联的**绝对**夹子，都跟 ks 无关）：
//   ① stepSprings：`clamp(ks·Δx + D·vrel, ±24000)` —— k=50000 时 Δx 只要 > 0.48px 就顶死在 24000；
//   ② springForceOn：`|a_y| ≤ SPR_AY_G·g`（=1.35g）—— k=50000 时 Δx > 0.07px 就吃满。
//   两条一起把 k ≳ 3600 的弹簧压成一台**恒力装置**（永远 24000 → 永远 1.35g），k 从公式里消失。
// 修法：把每条夹子的**物理含义**写出来，再按 ks 换算它 ——
//   ① 力上限 = 「过形变超过 480px 就不信任这个弹簧模型了」⇒ `fMax = ks·(SPR_FMAX/SPR_KS_ANCHOR)`。
//      480px 正是旧值的口径 24000/50（自然长度 170px 的 2.8 倍，正常实验到不了，只在几何坏掉时兜底）。
//   ② 加速度上限 = 「不掀翻静置方块」（R63/R63b 的原意）⇒ 随 ks **线性**放大，但**封顶** SPR_ACC_GAIN_MAX。
//      封顶不是保守而是数值必需：a·dt 是单个子步的速度增量，8×1.35g 在 dt=1/240 下是 118px/s/子步，
//      再往上放，一子步的位移会超过墨线厚度（4.65px）而穿壁。
//   ③ 阻尼 D 随 √ks 放大（即保持阻尼比 ζ = D/(2√(km)) 不随 k 漂），同样封顶。不缩放的话
//      k=50000 的 ζ 只有 0.016 —— 球会以 ~35Hz 振铃 0.85s，而 35Hz 已高于 60fps 的奈奎斯特频率
//      ⇒ 画面上是乱抖（aliasing），比原来的「没差别」更像 bug。
// 三条按**冻结锚点 SPR_KS_ANCHOR=150**（=夹子标定时的出厂默认）缩放，gain 取 max(1, ks/锚点)。
// ★R130 教训：锚点原先跟着 SPR_KS_DEF 走，默认 150→300 后同 ks=300 的夹子减半，
//   用户体感对拍 _diag_r130i 实证（峰值收缩 16.8→8.8 px/s）。锚点冻结后，
//   滑块全量程每一档的夹子行为 = 150 时代逐位不变；R57/R58/R60b/R62/R63/R63b
//   的既有标定（它们用默认 k 跑、判据从页面常量派生）继续成立。
var SPR_FMAX=24000;        // ks = SPR_KS_ANCHOR 时的弹力上限（等价于「过形变 480px」）
var SPR_KS_ANCHOR=150;     // ★R130：三条夹子的缩放**锚点冻结**为 150（夹子标定时的默认值）。
                           //   用户体感对拍（_diag_r130i）实证：锚点原来跟着 SPR_KS_DEF 走，
                           //   默认 150→300 后 gain=ks/300，同 ks=300 的夹子全部**减半**
                           //   （峰值收缩速度 16.8→8.8 px/s ≈ 旧默认 150 的 8.1）⇒ 「手动 300
                           //   比默认 300 快得多」。锚点冻结后整条滑块量程逐位回到 150 时代。
var SPR_ACC_GAIN_MAX=8;    // 加速度上限的放大倍数上限（竖直 1.35g → 10.8g；水平 0.9g·asp 同倍）
var SPR_DAMP_GAIN_MAX=10;  // 阻尼的放大倍数上限（D·dt/m ≤ 0.30，显式积分稳定余量充足）
// R88⑤（第二半）：本机能**稳定**表示的刚度上限。这不是保守，是量出来的硬墙 ——
//   `_diag_r88d_kwall.py` 静置 3s + 90 帧 rAF 窗口，逐帧看 (cur−len) 的峰峰：
//     k=5000  ω·dt=1.18 峰峰 0.021px 稳      k=10000 ω·dt=1.67 峰峰 118.5px 极限环
//     k=8000  ω·dt=1.49 峰峰 15.046px 极限环   k=50000 ω·dt=3.73 峰峰 508.1px 极限环
//   加大阻尼**救不回来**（k=20000 下 D=71/100/118 三档全是极限环）—— 因为 ω·dt ≥ 2 是
//   后向差分积分器本身的边界，与夹子无关。所以「把夹子按 ks 缩放」只做到 k≈5000，
//   再往上必须**截断有效刚度**，否则用户从「k 是空挡」直接掉进「球在抖」（两种都不能交付）。
//   ⚠ 截断必须按**宿主**而不是按单根弹簧做：刚度是叠加的 —— `_diag_r88e` 实测同一个球上
//     并联两根 k=3000 的弹簧（有效 6000）当场极限环（mean −322px、峰峰 603px），
//     而单根 k=3000 同一支夹具只是偶尔微振（峰峰 1.85px）。所以 3000 这个数不是为了单根定的：
//     账本保证**一个宿主身上的有效刚度总和** ≤ SPR_K_MAX（见 springKBook/springKShare）。
//   这里取 2000（ω·dt = 0.745，离墙 1.49 有 2 倍余量）。代价只是量程顶端从 5000 收到 2000 ——
//   k=50 的静伸长 52px vs 截断后 k≥2000 的 1.3px，肉眼差别 40 倍，用户要的「k 要有用」成立。
var SPR_K_MAX=2000;
function springKEff(ks){
  var k=(ks>0?ks:SPR_KS_DEF);
  return k>SPR_K_MAX?SPR_K_MAX:k;
}
// 宿主刚度账本：把「一个宿主身上所有弹簧的有效刚度之和」算出来，超预算时**同比例缩水**
// （所有挂在同一宿主上的弹簧用同一个 share，力的大小才不会在两端违反牛顿第三定律）。
var SPR_KHOST=[];
function springKBook(){
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
function springKShare(h){
  if(!h||!h._kS||h._kS<=SPR_K_MAX)return 1;
  return SPR_K_MAX/h._kS;
}
// 三个「按 ks 缩放」的取用口，集中在这里免得四处各写一遍（口径不一致是最难查的 bug）。
function springFMax(ks){
  var fmax=(ks>0?ks:SPR_KS_DEF)*(SPR_FMAX/SPR_KS_ANCHOR);
  return fmax<SPR_FMAX?SPR_FMAX:fmax;          // ks < 锚点时也**不下调**（旧行为：下限就是 24000）
}
function springAccGain(ks){
  var g=(ks>0?ks:SPR_KS_DEF)/SPR_KS_ANCHOR;
  if(g<1)g=1;if(g>SPR_ACC_GAIN_MAX)g=SPR_ACC_GAIN_MAX;
  return g;
}
function springDampGain(ks){
  var g=(ks>0?ks:SPR_KS_DEF)/SPR_KS_ANCHOR;
  if(g<1)g=1;
  g=Math.sqrt(g);if(g>SPR_DAMP_GAIN_MAX)g=SPR_DAMP_GAIN_MAX;
  return g;
}
// R58：弹簧的 Matter 镜像（一根静态薄板）必须和**它自己拴住的宿主**互不碰撞。
// 端点锚在宿主身上意味着 e0/e1 就在宿主内部，板必然穿过宿主 —— 求解器会每帧强行把它俩
// 分开，向宿主注入巨大能量：实测球被弹到屏幕顶、速度 5000+ px/s（用户说的「鬼畜乱弹、
// 越弹越快、能量不守恒」）。Matter 里同一个**负** group 的两个体永远不碰撞，而 group 不同
// 的行走 category/mask —— 所以宿主(-2) 对普通物体(0) 照常碰撞，只有「本弹簧 ↔ 宿主」被关掉。
// 副作用：两个都被弹簧拴住的物体之间也不碰撞 —— 物理上它们本来就该被弹簧撑开，可接受。
// R77（用户⑤「弹簧压缩到一定程度后不能继续压缩，相当于直接碰撞」的碰撞语义）：弹簧压到最短
//   （触底）那一刻的**挡板恢复系数**。触底 = 两端撞上一个刚性挡板，速度响应 λ = (1+e)：
//     e=0 → 把「接近速度」整段抹掉（完全非弹性，触底吃掉一份动能，总能量单调下降）；
//     e=1 → 原样弹回（完全弹性，动量与能量都还给系统）。
//   取 1：用户这一条要的是「能量守恒」；而且固体高度的钢弹簧本来就近乎弹性（把压到底的弹簧
//   松手，它会把存起来的能量还给你）。实测（_diag_r77_sprmin.py，GRAV=0/damp=0 的隔离台）：
//   e=1 时触底段总机械能各窗口峰值离散度 < 1%，e=0 每触底一次掉一截（首触底掉约 26%）。
var SPR_STOP_E=1;
var SPR_CGROUP=-2;
// R103-5：铰链宿主（含作为宿主的杆镜像板）专用负组 —— 销接双方互不碰撞。独立于 SPR_CGROUP。
var HINGE_CGROUP=-3;
/* ★R131-19：杆镜像板 ↔ 杆的**锚定宿主**专用负组——锚定宿主是「铰接」在杆端的，
 *  受重力应绕杆端摆动；若被 static 杆板像地面一样托住就会**悬空停摆**（用户 REC
 *  09-27-02-39-58：图形被杆撑在天上 y=279 不落）。非宿主物体仍可搁杆（承重特性保留），
 *  靠「只豁免锚定宿主」区分。 */
var ROD_HOST_CGROUP=-5;
// R58：圆形（球）的弹性 —— 落地要弹几下并快速收敛，不能永远弹
var BALL_REST=0.52;      // 碰撞恢复系数（Matter 取双方 max，地面是 0）
// R73-C（用户：「空气阻力默认为 0，先暂时不要考虑空气阻力」）：出厂默认的空气阻尼改成 0。
// 旧值 0.014 是 R58 为了让「水平速度也衰减、弹几下就停」加的，但它是一条**用户看不见的
// 耗散通道**：μ=0 时球仍会被它拖停（R68 已吃过一次）、e=1 时它又和「完全弹性」矛盾。
// 现在默认关掉，阻尼交给 μ / e 两个用户旋钮；要空气阻力时用面板的「空气阻力 air」显式调。
var BALL_AIR=0;          // 空气阻尼默认（0 = 无空气阻力）
var WAIR_GLOBAL=0;       // ★R131：全局空气阻力（面板 wair 的唯一真源，见 6269 行注释块）
// ★R131（用户：「空气阻力这个参数是针对全局的，调了之后全局都会同步进行修改」）：wair 从
//   「选中 W 体的本体参数」升级为**全局参数** —— 面板一调，场上**所有** W 体（含新出生的）
//   同步生效。存储 WAIR_GLOBAL 一份真源；B.wAir 仍随体写一份（applyWAir/复制语义兼容），
//   但读写入口都被面板收敛到全局值。高中模式恒 0 语义（R74-D）不变。// R76-D（用户④「解决上一轮的遗留问题」= 圆在凹槽里越滑越低）：**根因不在补偿机器，圆本身是个多边形**。
//   Matter 0.20 没有真圆碰撞，它自己的源码写得很清楚（Bodies.circle 的注释）：
//     "approximate circles with polygons until true circles implemented in SAT"
//   而 Bodies.circle(x,y,R,opt,maxSides) 的边数 = ceil(clamp(min(maxSides, R),10,∞))，**maxSides 只能调小**：
//   R=22.325 时恒为 24 边。于是**每一条接触法线都是 24 边形的面法线**，与真实径向最多差 7.5°；
//   实测凹槽里的接触点 |r|=22.325（正好 rad+BND_INK）而 cross(r,n)=2.0 ⇒ **法线偏离径向 5.2°**，
//   每个接触都带力臂 ⇒ 求解器给球一记虚假角冲量。定量（_diag_r76_ecf.py，页面真实循环 12s）：
//     · 球的角速度增量 100% 发生在「球与凹槽有活动接触」的子步里（Σ|Δω|=0.2413），无接触子步 0.0000；
//     · 球被自旋到 |ω|≈0.23 rad/子步（≈55 rad/s），转动能峰值 1.36e6，恰好吸收掉总能量损失的 ~85%
//       （转动能 1.3e6 / 总损失 1.5e6）⇒ 平动能量被抽走 = 用户看到的「越滑越低」。
//     · 关掉整条 μ=0 补偿通道（ECF pair=0）后这套自旋**逐位不变** ⇒ 与本项目的补偿机器无关，纯 Matter。
//   修法：用真圆逼近得更好的多边形（边数扫描，用户可见的下沉量单调改善）：
//     24 边 → 下沉 +8.41%   48 边 → +3.79%   96 边 → +2.70%   （转动能峰值 1.36e6 → 6.9e4，降 20 倍）
//   取 48：拿到 81% 的改善量，而 SAT 代价 ~(N+M)² 只涨 4 倍（96 边要涨 16 倍，且边际收益只剩 1pp）。
//   副作用（都是「更接近真圆」的方向，但会动到断言）：质量 = 多边形面积×密度，24→48 边面积 +0.9%。
var CIRCLE_SIDES=48;     // W 体「圆」的碰撞多边形边数（越大越接近真圆、虚假力矩越小、SAT 越贵）

// ============================================================================ R83 / 用户③
// 「那个空心球一看就不是正圆，要不你尝试着增加多边形的边数，让它尽量接近圆？」
// —— **用户是对的，而且量得出来**（`_diag_r83b_ring_render.py`：1× 截屏、按 alpha 当覆盖度
//    做亚像素径向剖面，再按**多边形周期 360/N** 做相位折叠，把宽带噪声与真实分面分开）：
//
//   · 圆环的墨线**就是**它的碰撞几何（一圈 N 根定向矩形，见 shapeOutline('ring')），所以 N 边形
//     的半径会在「弦中点 = 内切半径 R」与「顶点 = 外接半径 R/cos(π/N)」之间摆动，
//                峰峰 = R·(1/cos(π/N) − 1) ≈ R·(π/N)²/2
//   · 实测（相位折叠口径，px；比值 = 实测 ÷ 几何预测，≈1 才说明量到的是折线而非噪声）：
//       修前   R=80 , N=48 → 0.1499（比值 0.873）  理论 0.1717
//       修前   R=300, N=48 → 0.6120（比值 0.951）  理论 0.6437  ← 弦长 39.3px，**看得出折线**
//       修后   R=300, N=71 → 0.2704（比值 0.920）  理论 0.2939  ← 降 2.27 倍
//       负对照 R=300, N=48 → 0.6120（同一夹具，只把段数锁回 48；判据必须在这一臂变红）
//     对照组「圆形」（渲染走 canvas 真弧 cvx.arc）同口径 0.0712 / 0.0356 ⇒ 纯噪声。
//     ⇒ 非圆度**只**来自折线，且**与半径成正比**，所以用户画大圆时必然看得见。
//   · ⚠ 仪器纪律（本子系统翻过两次车，别再犯）：
//     ① 折叠周期必须取自页面上的**实际 N**。第二版把它写死 7.5°（= 48 边形），修后 N=71 时
//        真实分面被**部分平均掉**，给出 0.0157px 的**假通过**（真值 0.2704px，差 17 倍）。
//        N=48 时新旧折叠实现在数学上退化成逐位相同（step=1440/48=30 为整数）——
//        修后 ring80 折叠峰峰 0.1499 与修前**逐位相同**，正是该等价性的实证。
//     ② 实心「圆」的 B.pts 是 32 边形（只供碰撞），但**渲染走真弧** ⇒ 它的理论值必须是 **0**。
//        拿 B.pts.length 去算会得出 300·(1/cos(π/32)−1)=1.45px 的假预测，再把实测 0.02px 判成 FAIL。
//
// 修法：段数按半径自适应，把半径偏差钉在 OUTLINE_PP_MAX 以下。
//   · 为什么不用「渲染画真圆、碰撞仍用折线」：那正是 R82 立下的纪律要禁止的
//     （画出来的线 = 唯一的实体）。折线越细，这条纪律的两侧（画的线/实体的线）越重合 —— 同一个改动
//     同时改善**渲染**与**物理**，不需要引入第二种几何。
//   · MIN=48 且**精确返回**：π·sqrt(R/(2·PP_MAX)) 在 R≤140 时都 <48 ⇒ 该区间逐位就是 48 段，
//     与旧行为（固定 CIRCLE_SIDES=48）完全一致 ⇒ 旧探针（_probe_r82.py 的 A3 nPts==CIRCLE_SIDES、
//     A4/A5、B5 parts==49）一个字都不用改。兼容边界由 PP_MAX 唯一决定：
//        R_48 = 2·PP_MAX·(48/π)² = PP_MAX·466.7  ⇒  PP_MAX=0.30 时 R≤140。
//   · MAX=256：撞上限的半径 R≈3984（再大就靠这个上限兜底，R=5000 时偏差 0.377px 已超目标，
//     但画布尺寸根本画不到）。段长下限也不必担心：R=80/NS=48 时弦长 10.5px，远高于
//     bndSegs 的 L<0.5 去噪阈。实测（_diag_r83d_sides.py）：R=141→49、300→71、1000→129、
//     2000→182，偏差全部落在 0.290~0.298px（目标 0.30）。
//   · **不做奇数化**（R83 即时修正）：上一版末行写 `return n|1`，而 `48|1 = 49` ——
//     下限保护当场被自己的「取奇数」推翻。`_diag_r83d_sides.py` 实测：R=20/40/60/80/93/94
//     全部落在 **49** 段（ring80 建体后 npts=49、parts=50），R=100 更被 PP_MAX=0.20 推到 50
//     再奇数化成 **51**。R82 探针的 4 条断路断言会被打红。闭链处处等价，取奇数本无必要；
//     真需要奇数时也应让 n 本身是奇数，而不是把一个「已夹到下限」的值再改一次。
//   · PP_MAX 0.20 → 0.30：不是放宽质量要求，而是把兼容边界从 R≤93 推到 R≤140
//     （R≤140 的环偏差本就 ≤0.30px = 墨线宽的 6.5%，亚像素），代价是 R>140 的环偏差目标
//     从 0.20 放到 0.30px（R=300：87 段→71 段，偏差 0.196→0.294px）。两者都远在肉眼分辨力之下，
//     而换来「R≤140 与旧基线逐位相同 + 旧探针零改动」。
var OUTLINE_PP_MAX=0.30;   // 可接受的半径偏差峰峰（px）—— 4.65px 墨线宽的 6.5%，亚像素
var OUTLINE_MIN_SIDES=48;  // 下限 = CIRCLE_SIDES；返回前**精确判等**，小圆手感 / SAT 成本 / 旧断言全不变
var OUTLINE_MAX_SIDES=256; // 上限：parts ≤ 257
function outlineSides(R){
  // N ≥ π·sqrt(R/(2·PP_MAX)) 由 R(π/N)²/2 ≤ PP_MAX 反解
  R=Math.max(1,isFinite(R)?R:1);
  var n=Math.ceil(Math.PI*Math.sqrt(R/(2*OUTLINE_PP_MAX)));
  if(!(n>0))n=OUTLINE_MIN_SIDES;
  if(n<=OUTLINE_MIN_SIDES)return OUTLINE_MIN_SIDES;   // 小圆：精确 48（逐位兼容旧基线）
  if(n>OUTLINE_MAX_SIDES)n=OUTLINE_MAX_SIDES;
  return n;
}

// ============================================================================ R79 / Task #135
// 「真圆 vs 多边形」的**解析**碰撞通道：把 R76-D 只压到 1/5 的那点离散误差彻底清零。
//
// 为什么还要这一条（R76-D 已经用 48 边把「越滑越低」从 +8.41% 压到 +3.79%）：
//   48 边形是**内接**多边形，任一条接触法线都是它的**面法线**，与真实径向最多差 π/48 = 3.75°。
//   实测（_diag_r79_circle.py，凹槽夹具 12s）：
//     · 面中点到球心 = 22.2770（内接边心距），顶点到球心 = 22.3250 ⇒ 欠覆盖的弦高 0.048px；
//     · 接触力臂 max|r×n| = **1.4596** = R·sin(π/48)（R=22.325）—— 与理论上限逐位吻合，
//       均值 0.6988。力臂不为 0 ⇒ 求解器每帧都给球一记虚假角冲量，球被自己转起来、平动能量被抽走。
//   要它**恒等于 0**，法线就必须是**径向**，而这只有真圆才有。
//
// 做法：挂 `Matter.Collision.collides`（Detector 的窄相入口，每对部件调一次）。当一方是标注了
//   `_circleR` 的圆体、另一方是多边形时，**不调 SAT**，改用解析几何：
//     · 逐边求「圆心到线段」的最近点，取最近的那一条
//       —— 线段最近点公式天然包含「最近点是顶点（角接触）」的情形，不需要单独分支；
//     · 穿透深度 depth = R − d（d = 圆心到边界最近距离），**这就是题目要的
//       `penetration = R − distance from circle center to segment`**；
//     · 法线 normal = (圆心 − 最近点)/d，即**径向**；
//     · 接触点 supports = 那个最近点。于是 r = 接触点 − 圆心 恒与 normal 平行
//       ⇒ 力臂 cross(r,n) ≡ 0 ⇒ **零虚假角动量**。
//   支撑点数取 1：真圆与平面/折线面的接触**本来就是单点**，不是多边形那种「一条边两个顶点」。
//
// 结构性好处：这条通道把 O(N·M) 的 SAT 换成了 O(M) 的逐边距离，所以它既更准也**更快**。
//   CIRCLE_SIDES 故意留 48 不动 —— 多边形现在还决定质量（面积×密度，24→48 边 +0.9%）与
//   惯量（+1.7%），改它会平移一批已标定的断言，而精度收益已经由本通道拿走，不留缝也无收益。
//
// 守卫（都不许省）：
//   ① 圆心落在多边形**内部**（= 已经很深的互穿）**也走解析**，用凸多边形的标准 MTV：
//      出去的方向 = 最近那条面的外法线（圆心→最近点），推出量 = d + R（先走满 d 到面、再走 R）。
//      本项目的 Matter 体全是凸的（弧/槽/开链笔画是逐段定向矩形拼的复合体，每块凸；闭链形走
//      fromVertices(inflateHull)，也是凸包），所以这一步有精确解，不需要别的机器。
//      ⚠ 初版这里是「退回 SAT」，被 B4b 当场抓住：凹槽夹具 92 条接触里有 2 条落在这一支，
//      力臂 3.47px —— **比正常上限 1.46 还大**。那恰恰是最需要正确法线的时刻，退回 SAT 等于
//      在最坏情形把 48 边形请回来。改法见 `var inside=...` 那三行。
//   ② **圆-圆也走解析**（R80，用户「可以」）。Matter 0.20 的 SAT 连圆-圆特例都没有 ——
//      整个 Collision.collides 一次都不读 circleRadius。实测两个球相撞 = 两个 48 边形相撞：
//      法线偏连心线 max 3.690°、力臂 max 3.1654px、depth 偏 0.1310px、supportCount 恒 2。
//      公式 depth = R_A+R_B−d、normal = (c_A−c_B)/d、接触点在连心线上，对「内含」也成立（见下）。
//   ③ 退化（d≈0 / 圆心重合 / 顶点数<3 / 拿不到 Matter.Pair/Collision.create）一律退回 SAT。
//   ④ **复用 pairs.table 里的 collision 对象**（与 Matter 自己的缓存口径一致）。自己 new 一个
//      会让 `collision.pair` 一直为空 ⇒ `Pairs.update` 每帧都新建一个 Pair ⇒ `pairs.list` 抖动、
//      `collisionStart` 每帧误报一次。这是本通道最容易踩的坑。
//   ⑤ CIRCLE_ANALYTIC 开关只为诊断/负对照 —— A/B 能在**同一次会话同一个夹具**里切，避开了
//      跨轮次运行之间的漂移（R78 已经证明这个项目里跨运行比对有多不可靠）。
var CIRCLE_ANALYTIC=true;
// R82：空心圆（环）的解析分支开关。作用与 CIRCLE_ANALYTIC 完全一样 —— 只为诊断/负对照，
// 让 A/B 能在**同一次会话同一个夹具**里切换（跨运行比对在本项目里已被 R78 证明不可靠）。
// 关掉它环仍然是环（走「圆 vs 48 根矩形」的多边形路径），只是法线退回面法线。
var RING_ANALYTIC=true;
// R82-去重（_ringHit / _ringTok）-------------------------------------------------------------------
// 解析环分支对**同一对（环, 圆）**在每个物理子步里只允许产出一条接触。
// 为什么非要有它（`_diag_r82c_dup.py` 实测，先量后改）：Detector 对复合体是**逐 part** 调
//   `Collision.collides`（见 buildMatterBody 里那条注），环有 48 个 part，球贴壁时同时压住 6~8 个
//   ⇒ 同一子步产出 6~8 条**几何完全相同**的接触（本支的几何只由**环心**决定，与是哪个 part 无关）
//   ⇒ Matter 按 part 两两建 Pair，**同一个物理约束被结算 6~8 遍**。
// ⚠ 这里保留一条**被证伪的假设**，免得后人再走一遍弯路：
//   最初以为「6~8 倍法向冲量 ⇒ 薄壁（2·BND_INK=4.65px）必被穿」，还拿 C1/C2 的 FAIL 当证据。
//   `_diag_r82f_ab.py` 的同夹具 A/B 把它否掉了：3000px/s 下把 RING_DBG.off=true 关掉去重，
//   每子步接触条数 467 → 2761（5.9 倍），而**最大穿透 3.353 逐位不变**、球照样关在空腔里
//   （dmax 55.592 = 55.592，末球心距都是 55.36）。根因：Matter 的 Resolver 是**顺序
//   （Gauss-Seidel）速度求解器**，重复约束从第二条起看到的已经是分离速度 ⇒ 解出的冲量被夹到 0，
//   不会叠加。当初 C1/C2 的「末态球心距 506px / 外球穿到 d=4.35」是**夹具单位错**
//   （setVelocity 传了 px/s，实际 36000px/s）—— 同一组数字在**开着去重**时也照样复现，
//   与重复接触无关。
// ⇒ 去重的真实收益只有下面两条，**不含「防穿墙」**：
//     ① 约束卫生：一个物理面只该贡献一条约束。重复条数会改变摩擦/切向求解的迭代次序 ——
//        A/B 里 dmin 42.970(ON) vs 47.874(OFF) 正是它带来的轨迹差；
//     ② 开销：每子步求解量 467 → 2761（5.9 倍）。环有 48 个 part，球贴壁时同时压住 6~8 个，
//        去重后顺带压掉 pairs.list 每子步的建/销抖动。
// 探针侧对应的是 F 组 A/B（同会话同夹具，只切 RING_DBG.off），把上面两个数字钉住。
// token 由包装 `Matter.Engine.update` 推进：产品只在 stepMatter 一处调它，
//   所以「一个 token」严格等于「一个物理子步」，与 Engine.update 的边界对齐，不用猜帧边界。
// 包装失败 ⇒ _ringDedupOK=false ⇒ 去重整体停用（宁可不判重，也不能让球因为 token 不走而永远穿透）。
// RING_DBG 只给探针/负对照读数，三个整数自增，不参与物理。
var _ringTok=0, _ringHit={}, _ringSig={}, _ringDedupOK=false;
var RING_DBG={tok:0,dedup:0,emit:0,wrap:false,tokWrapPass:0,off:false};
(function(){
  if(typeof Matter==='undefined'||!Matter.Collision||!Matter.Collision.collides)return;
  var _collides=Matter.Collision.collides;
  // —— 先安装 token 推进器（放在 collides 之前，装不上就去重自动停用）——
  if(Matter.Engine&&typeof Matter.Engine.update==='function'&&!Matter.Engine._ringTokWrap){
    var _engUpd=Matter.Engine.update;
    Matter.Engine.update=function(eng,delta){
      if(++_ringTok>1e9){_ringTok=1;_ringHit={};}   // 溢出保护（240 子步/s 下 ≈48 天）
      RING_DBG.tok=_ringTok; RING_DBG.tokWrapPass++;
      return _engUpd.apply(this,arguments);
    };
    Matter.Engine._ringTokWrap=true;
    _ringDedupOK=true; RING_DBG.wrap=true;
  }

  // 圆心到多边形边界最近点（含顶点接触：线段 t 被夹到 [0,1] 时最近点即端点）
  function closestOnPoly(vs,cx,cy){
    var n=vs.length,bd=Infinity,px=0,py=0;
    for(var i=0;i<n;i++){
      var a=vs[i],b=vs[(i+1)%n];
      var ex=b.x-a.x,ey=b.y-a.y,L2=ex*ex+ey*ey;
      var t=L2>0?((cx-a.x)*ex+(cy-a.y)*ey)/L2:0;
      t=t<0?0:(t>1?1:t);
      var qx=a.x+ex*t,qy=a.y+ey*t;
      var dx=cx-qx,dy=cy-qy,d2=dx*dx+dy*dy;
      if(d2<bd){bd=d2;px=qx;py=qy;}
    }
    return isFinite(bd)?{d:Math.sqrt(bd),px:px,py:py}:null;
  }
  // 圆心是否落在多边形内（射线法，自备实现 —— 不依赖 Matter 的 Vertices.contains 是否导出）
  function inPoly(vs,x,y){
    var n=vs.length,inside=false;
    for(var i=0,j=n-1;i<n;j=i++){
      var a=vs[i],b=vs[j];
      if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))inside=!inside;
    }
    return inside;
  }
  function cachedCollision(pairs,A,B){
    if(!pairs||!pairs.table||!Matter.Pair||!Matter.Pair.id)return null;
    var pr=pairs.table[Matter.Pair.id(A,B)];
    return pr?pr.collision:null;
  }
  function blankCollision(A,B){
    if(Matter.Collision.create)return Matter.Collision.create(A,B);
    return {pair:null,collided:false,bodyA:A,bodyB:B,parentA:A.parent,parentB:B.parent,depth:0,
            normal:{x:0,y:0},tangent:{x:0,y:0},penetration:{x:0,y:0},
            supports:[null,null],supportCount:0};
  }

  Matter.Collision.collides=function(bodyA,bodyB,pairs){
    if(!CIRCLE_ANALYTIC)return _collides(bodyA,bodyB,pairs);
    var rA=(bodyA&&bodyA._circleR>0)?bodyA._circleR:0;
    var rB=(bodyB&&bodyB._circleR>0)?bodyB._circleR:0;
    if(!rA&&!rB)return _collides(bodyA,bodyB,pairs);      // 守卫②/普通路径
    // ---- 环 vs 圆：解析环（annulus，R82）-----------------------------------------------
    // 为什么需要这一支（对照用户给的参考引擎 —— 那里面圆弧面是**解析几何**：ui() 用 atan2 判
    // 扫过角、tube 模式直接取径向法线；它「无能量损失」的另一半是每步把位置投影到面上、
    // 法向自由度由约束吃掉、不经过冲量求解器，且全场默认 friction:0/restitution:1）：
    //   48 根定向矩形的复合体「能关住球」（_diag_r82_ring.py 实测：球心距恒 47.4、力臂恒 0、
    //   空腔不穿），但每根矩形只有 9.2px 长、球半径 20.3px ⇒ 球同时压两三根，接触法线是
    //   **该矩形面的面法线**，实测偏离真径向最多 8.086°。球沿环内壁滑行时径向才是唯一正确
    //   的约束方向。本分支把法线变成真径向，并删掉弦高欠覆盖。
    //   同夹具同会话 A/B 实测：法线偏径向 8.086° -> 0.000°；默认物性（μ=0.08,e=0.52）下
    //   14s 末残余速度 0 -> 45 px/s。**但主因仍是物性**：显式 μ=0 + e=1 时两条路径都能连响
    //   14s（峰值 478~790 px/s 不衰）。所以这一支是「几何正确性」的修法，不是「无能量损失」
    //   的灵丹 —— 后者的开关在本项目里是 μ=0（R70⑥）+ e=1，与 R81 的结论一致。
    var rp=(bodyA&&bodyA._ringOut>0)?bodyA:((bodyB&&bodyB._ringOut>0)?bodyB:null);
    if(rp&&RING_ANALYTIC){
      var cbo=rA?bodyA:(rB?bodyB:null);
      if(!cbo)return _collides(bodyA,bodyB,pairs);       // 环 vs 非圆（方块/杆/地面）：交回多边形路径
      var rrr=cbo._circleR, ringIn=rp._ringIn, ringOut=rp._ringOut;
      // ⚠ 环心必须取 **root**：Detector 传进来的是 part，而 part.position 在**中线**上
      //   （距环心 Rmid），不是环心。探针初版就栽在这：首批接触 depth 算出 67.9px，
      //   一记 45px 的 MTV 把球打到 6380 px/s、直接飞出环外。
      var rctr=(!rp.parent||rp.parent===rp)?rp:rp.parent;
      var pdx=cbo.position.x-rctr.position.x, pdy=cbo.position.y-rctr.position.y;
      var pd=Math.sqrt(pdx*pdx+pdy*pdy);
      if(pd<1e-9)return _collides(bodyA,bodyB,pairs);    // 守卫③：圆心与环心重合
      // 判别式按「球心落在哪一区」分，**绝不能**按「哪个推出量为正」分：
      //   球心在空腔内时 ringOut+rrr−pd 照样是个正的大数，按它判会把球朝外打穿整圈壁
      //   （探针实测：峰值 6380 px/s、球心跑到 d=92）。
      var pdep=0,psep=0;
      if(pd>=ringOut){pdep=ringOut+rrr-pd;psep=1;}            // 球在外侧 ⇒ 沿径向朝外分离
      else if(pd<=ringIn){pdep=pd+rrr-ringIn;psep=-1;}        // 球在空腔 ⇒ 朝环心分离
      else{                                                   // 球心埋在壁厚里 ⇒ 推到更近的一侧
        var pEo=ringOut-pd,pEi=pd-ringIn;
        if(pEo<=pEi){pdep=pEo+rrr;psep=1;}else{pdep=pEi+rrr;psep=-1;}
      }
      if(!(pdep>0))return null;                               // 真环不接触
      // —— 去重（见 _ringHit 注释）：本子步里这对（环, 圆）已经出过一条解析接触就直接让位 ——
      //   位置放在「确认真有接触」之后：若放在判别式之前，一个「不接触的 part」会白吃掉 token，
      //   把同一子步里**真正接触**的那个 part 也一起挡掉 ⇒ 球穿壁。
      //   几何与是哪个 part 无关 ⇒ 留哪一条都一样；留第一条还顺带让 Pair 身份稳定（热启动不丢）。
      //   判据是**两条合取**，这是刻意的：
      //     ① token 相同 —— 界定「同一个物理子步」（token 由包装 Engine.update 推进）；
      //     ② 球心 x 逐位相同 —— 兜住「token 推进器被人摘掉」的退路。
      //   为什么非要②：若只用①，一旦有谁把 Matter.Engine.update 换成**包装前**的引用，
      //     token 就冻住 ⇒ `_ringHit[rky]===_ringTok` 永远成立 ⇒ 环从此再也吐不出接触
      //     ⇒ 球直接穿环。加上②之后退化成**优雅降级**：运动中的球每子步球心都在变，
      //     ②不成立 ⇒ 照常出接触，环照常关得住；只有「token 冻住 **且** 球恰好一动不动」
      //     才会漏一拍 —— 而漏一拍只会让球被重力拽一下、下一子步立刻补回来，不会穿壁。
      //   （RING_DBG.off 是 A/B 负对照开关，作用与 RING_ANALYTIC/CIRCLE_ANALYTIC 同类。）
      var rky=rctr.id+':'+cbo.id, rsig=cbo.position.x;
      if(_ringDedupOK&&!RING_DBG.off){
        if(_ringHit[rky]===_ringTok&&_ringSig[rky]===rsig){RING_DBG.dedup++;return null;}
      }
      _ringHit[rky]=_ringTok; _ringSig[rky]=rsig;
      RING_DBG.emit++;
      var pux=pdx/pd,puy=pdy/pd;
      var Aa=(bodyA.id<bodyB.id)?bodyA:bodyB, Bb2=(bodyA.id<bodyB.id)?bodyB:bodyA;
      var rcol=cachedCollision(pairs,Aa,Bb2)||blankCollision(Aa,Bb2);      // 守卫④
      // normal 符号：沿用 R79/R80 那条「normal 由 B 指向 A」的反直觉约定 ——
      //   球是 A ⇒ 球沿 +normal 走 ⇒ normal=+sep·u ；球是 B ⇒ 球沿 −normal 走 ⇒ normal=−sep·u
      var nfs=(Aa===cbo)?1:-1;
      var rnx=nfs*psep*pux, rny=nfs*psep*puy;
      rcol.collided=true;
      rcol.bodyA=Aa; rcol.bodyB=Bb2; rcol.parentA=Aa.parent; rcol.parentB=Bb2.parent;
      rcol.depth=pdep;
      rcol.normal.x=rnx; rcol.normal.y=rny;
      rcol.tangent.x=-rny; rcol.tangent.y=rnx;
      rcol.penetration.x=rnx*pdep; rcol.penetration.y=rny*pdep;
      // 支撑点取**环壁上的径向点**：它让球与环两侧的力臂**一起**为 0 ——
      //   球的 r = q−c = u·(壁半径−pd) ∥ u；环这个 part 的 r = q−part.position
      //   = u·(壁半径−Rmid) ∥ u（part 中心就在同一根射线上）。取自边界上任意其它点都会带力臂。
      var pwr=(psep>0)?ringOut:ringIn;
      var pqx=rctr.position.x+pux*pwr, pqy=rctr.position.y+puy*pwr;
      if(!rcol.supports)rcol.supports=[null,null];
      rcol.supports[0]=rcol.supports[0]||{x:0,y:0};
      rcol.supports[1]=rcol.supports[1]||{x:0,y:0};
      if(rcol.supports[1]===rcol.supports[0])rcol.supports[1]={x:0,y:0};
      rcol.supports[0].x=pqx; rcol.supports[0].y=pqy;
      rcol.supports[1].x=pqx; rcol.supports[1].y=pqy;
      rcol.supportCount=1;
      rcol._circleX=1;      // 与 R79 通道同一个诊断标记（探针靠它区分解析/SAT）
      rcol._ringX=1;        // 本支专属标记
      return rcol;
    }
    // ---- 圆-圆：解析两圆 ---------------------------------------------------------------
    // R80（用户「可以」）：Matter 0.20 的 SAT 连圆-圆都没有特例 —— 整个 Collision.collides
    //   一次都不读 circleRadius（源码只有 _overlapAxes + _findSupports 两条多边形路径）。
    //   于是两个球相撞 = 两个 48 边形相撞。实测（_diag_r80_cc.py，30 组随机构型）：
    //     法线偏离连心线 max 3.690°（≈ π/48 = 3.750°）、接触力臂 max 3.1654px（均值 1.7842）、
    //     depth 偏精确值 max 0.1310px、supportCount 恒为 2。
    //   力臂比 R·sin(π/48)=1.4601 还大，是因为多边形的支撑点是**顶点**，|r| 可以超过 R。
    // 公式（与「圆 vs 多边形」共用同一条 B→A 符号约定）：
    //   depth = RA + RB − d（d = 圆心距）        normal = (c_A − c_B)/d      接触点在连心线上
    // ⚠ 这条对「一个圆完全包住另一个」也成立、方向也对，不需要单开分支：
    //   设 c_A = 0、c_B = d·u ⇒ normal = −u；求解器把 A 沿 +normal = −u 推、B 沿 −normal = +u 推，
    //   内含的 B 朝 +u 一路走到 A 的边界 R_A 之外 —— 正是 MTV 要的方向，推出量也正好是 R_A+R_B−d。
    //   唯一无定义的是圆心重合（d≈0，方向本身就是任意的），退回 SAT。
    if(rA&&rB){
      var oA2=(bodyA.id<bodyB.id)?bodyA:bodyB, oB2=(bodyA.id<bodyB.id)?bodyB:bodyA;
      var RA2=(oA2===bodyA)?rA:rB;
      var ddx=oA2.position.x-oB2.position.x, ddy=oA2.position.y-oB2.position.y;
      var dd=Math.sqrt(ddx*ddx+ddy*ddy);
      if(dd<1e-9)return _collides(bodyA,bodyB,pairs);                      // 守卫③：圆心重合
      var depthC=rA+rB-dd;
      if(!(depthC>0))return null;                                          // 真圆不接触
      var ux2=ddx/dd, uy2=ddy/dd;
      var ccol=cachedCollision(pairs,oA2,oB2)||blankCollision(oA2,oB2);    // 守卫④
      ccol.collided=true;
      ccol.bodyA=oA2; ccol.bodyB=oB2; ccol.parentA=oA2.parent; ccol.parentB=oB2.parent;
      ccol.depth=depthC;
      ccol.normal.x=ux2; ccol.normal.y=uy2;
      ccol.tangent.x=-uy2; ccol.tangent.y=ux2;
      ccol.penetration.x=ux2*depthC; ccol.penetration.y=uy2*depthC;
      // 接触点取「A 的表面上朝 B 的那一点」：它落在连心线上 ⇒ r_A = −R_A·u、r_B = (d−R_A)·u
      // 都与 normal 平行 ⇒ 两边的力臂 cross(r,n) 一起恒为 0。用 A 的表面点而不是几何中点，
      // 是为了与「圆 vs 多边形」那支语义一致：接触点在**圆的边界**上。
      var qx2=oA2.position.x-ux2*RA2, qy2=oA2.position.y-uy2*RA2;
      if(!ccol.supports)ccol.supports=[null,null];
      ccol.supports[0]=ccol.supports[0]||{x:0,y:0};
      ccol.supports[1]=ccol.supports[1]||{x:0,y:0};
      if(ccol.supports[1]===ccol.supports[0])ccol.supports[1]={x:0,y:0};   // 两槽位必须互异（见下）
      ccol.supports[0].x=qx2; ccol.supports[0].y=qy2;
      ccol.supports[1].x=qx2; ccol.supports[1].y=qy2;
      ccol.supportCount=1;
      ccol._circleX=1;
      return ccol;
    }
    var cir=rA?bodyA:bodyB, poly=rA?bodyB:bodyA, R=rA||rB;
    var vs=poly.vertices;
    if(!vs||vs.length<3)return _collides(bodyA,bodyB,pairs);                       // 守卫③
    var c=cir.position;
    var q=closestOnPoly(vs,c.x,c.y);
    if(!q||q.d<1e-6)return _collides(bodyA,bodyB,pairs);                           // 守卫③
    // ---- 圆心在多边形**内部**（= 已经很深的互穿）也仍然解析，不退回 SAT ------------------
    // 本项目的 Matter 体全是**凸**的：弧/槽/开链笔画是逐段定向矩形拼的复合体（每块凸）、
    // 闭链形走 `fromVertices(inflateHull(...))` 也是凸包、地面/墙/杆的镜像板都是矩形。
    // 凸 part 上「圆心在内部」有精确解：出去的方向 = 最近那条面的外法线 = 圆心指向最近点，
    // 推出量 = d + R（先走满 d 到面，再走 R 才算不重叠）。这就是标准 MTV，不需要别的机器。
    // 为什么非要把它做掉：这是**最需要正确法线**的时刻，退回 SAT 等于在最坏情形把 48 边形
    // 请回来 —— 实测凹槽夹具里 2/92 条接触落在这条分支上、力臂 3.47px（比正常上限 1.46 还大）。
    var inside=inPoly(vs,c.x,c.y);
    var depth=inside?(q.d+R):(R-q.d);
    if(!(depth>0))return null;                    // 真圆不接触 —— 明确「无碰撞」（多边形那 0.048px 的
                                                  // 假接触也就此消失，球不再被垫高一点点）
    var ux=(c.x-q.px)/q.d, uy=(c.y-q.py)/q.d;     // 圆心 →(指向) 边界最近点
    // sep = 「圆分离时该走的方向」：在外面 = 背离多边形(= u)；在里面 = 朝最近的面出去(= −u)
    var sf=inside?-1:1;
    // ⚠ 符号是 Matter 的**反直觉**约定，别按字面猜（初版按 A→B 写，球被往地里推、下沉 +16%）：
    //   Collision.collides 里那句 `g*(B.x-e.x)+x*(B.y-e.y)>=0&&(g=-g,x=-x)` 是「**若为正则取反**」，
    //   所以结果满足 normal·(B−A) ≤ 0 —— 即 **normal 由 B 指向 A**（≈ A−B 的方向）。
    //   求解器里 A 沿 +normal 推、B 沿 −normal 推，正好把两者分开，与这条约定自洽。
    //   ⇒ 圆是 B 时要 −sep（B 走 −normal = +sep），圆是 A 时要 +sep（A 走 +normal = +sep）。
    // bodyA/bodyB 必须按 id 升序，与 Matter 自己的约定、Pair.id 的键一致
    var A=(bodyA.id<bodyB.id)?bodyA:bodyB, B=(bodyA.id<bodyB.id)?bodyB:bodyA;
    var nf=((cir===B)?-1:1)*sf;
    var nx=nf*ux, ny=nf*uy;
    var col=cachedCollision(pairs,A,B)||blankCollision(A,B);   // 守卫④
    col.collided=true;
    col.bodyA=A; col.bodyB=B; col.parentA=A.parent; col.parentB=B.parent;
    col.depth=depth;
    col.normal.x=nx; col.normal.y=ny;
    col.tangent.x=-ny; col.tangent.y=nx;
    col.penetration.x=nx*depth; col.penetration.y=ny*depth;
    // 支撑点：支撑点数取 1（真圆与平面/折线面的接触本来就是单点），但**两个槽位必须是
    // **不同且稳定**的对象 —— 复用同一个对象会踩 Pair.update 的去重分支：
    //   `d.vertex!==l && c.vertex!==u || (交换 contacts[0]/contacts[1])`
    // 两个 slot 指向同一对象时 `d.vertex===l` 恒成立 ⇒ 每帧都交换，contacts[0] 在两个对象间
    // 倒手，**热启动的 normalImpulse/tangentImpulse 全部丢失**，接触响应变得过弹
    // （实测：球在槽里来回弹而不是贴着弧面滑）。稳定且互异的对象 ⇒ 永远不交换。
    if(!col.supports)col.supports=[null,null];
    col.supports[0]=col.supports[0]||{x:0,y:0};
    col.supports[1]=col.supports[1]||{x:0,y:0};
    if(col.supports[1]===col.supports[0])col.supports[1]={x:0,y:0};
    col.supports[0].x=q.px; col.supports[0].y=q.py;
    col.supports[1].x=q.px; col.supports[1].y=q.py;
    col.supportCount=1;
    col._circleX=1;                               // 诊断标记：这条接触是解析通道产出的
    return col;
  };
})();
// R74-D（用户：「高中模式」）：物理教学模式。'uni' = 大学（现状，全物理）；'high' = 高中：
//   ① 弹簧不算力矩（拉任何部位效果相同，力只沿弹簧方向作用在质心）
//   ② 不算弹簧阻尼（Rayleigh 阻尼项置 0）
//   ③ 不算空气阻力（frictionAir 恒 0，忽略显式 wair 设置）
// 默认大学 = 现状。三处作用点分别是 springForceOn / springDamp / applyWAir·wAirDef。
var PHYS_MODE='uni';
// R66（用户：「根据拖动物体的哪一部分……中间有一大部分都是平衡区，拖着不会转的」）：
// 拖拽悬摆的死区系数 —— 抓点的**水平力臂**（抓点到质心的世界偏移的 x 分量）小于
// DRAG_ROT_DEADBAND×max(hw,hh) 时是平衡区，悬空提着也不转。方块 90px 宽时平衡带 ±27px，
// 覆盖中间一大半宽度；提角/提侧边（力臂 ≈ 半宽）必转。
var DRAG_ROT_DEADBAND=0.3;

function makeSpring(ax,ay,bx,by){
  var dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy);
  if(d<1){dx=1;dy=0;d=1;}
  var len=clamp(d,110,340);              // 自然长度 = 两个字母的间距（做了上下限钳制）
  // R76（用户③「高中模式下弹簧只有两个方向，竖直和水平，其他方向不施力」）：高中模式**没有
  //   斜弹簧** —— 拖出的方向就地吸附到最近的轴（|dx|≥|dy| 取水平，否则取竖直）；起点 (ax,ay)
  //   与长度 len 都不变（吸附在长度钳制**之后**，所以吸附不会改变用户拖出的长度）。
  //   用户拍板的语义是「画出来就被转正」：场上根本不出现斜弹簧，弹力自然只沿水平/竖直作用 ——
  //   再配合高中①的无力矩，弹簧就不会把物体拉翻滚。
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
  // R83（用户：「不是说了高中模式下弹簧只能有竖直和水平两个方向吗，怎么弹簧连接物体后，还是
  //   可以往其他方向转；还有就是弹簧在空中固定一个球，让球摆动时也会左右转动」）：
  //   **光在「画出来那一刻」吸附方向是不够的**。B.th 是 refreshSpringGeom 从两端锚点
  //   (e0/e1) 派生的只读量，而 e0/e1 每帧由 springSyncEnds 按宿主位置重算 —— 宿主一动，
  //   方向就自由了；springRotate 只管用户主动拧手柄的那一下。诊断实测（_diag_r83a_spring.py）：
  //     · 空中吊球拉开 60px：th 在 73.3°~102.9° 之间摆（偏竖直最多 16.7°，偏离轴 0.2868）；
  //     · 两球相连拉开 80px：th 从 -0.23° 一路摆到 90.0°（正中间 45°，偏离轴 0.6772）。
  //   高中语义「没有斜弹簧」必须在**整个生命周期**上成立，而现成的机制只有 R64 的方向锁
  //   （导轨）：把吸附后的轴记成 dirLock，端点每帧投影回这条轴 ⇒ 弹簧永远沿轴伸缩，
  //   渲染方向与弹力方向一起锁死，宿主横向摆动时弹簧只会「长度变」，不再「左右转」。
  //   ⚠ 与手动「固定方向」的**唯一**差别：自动锁**不冻结宿主自转** —— R77 的契约是「球照样能
  //   滚」；所以给 dirLock 打 auto 标记，springSyncLocks 见到它就跳过（见彼处）。
  //   投影在这里是恒等变换（端点在吸附后本来就在轴上），所以不会改变刚画出来的几何。
  if(PHYS_MODE==='high'){
    B.dirLock={mx:B.x,my:B.y,ux:(ex-ax)/len,uy:(ey-ay)/len,auto:true};
  }
  refreshSpringGeom(B);
  return B;
}
// B.x/B.y/B.th/B.hw 全部从两端派生 —— 单一几何来源，避免「改了 e0 忘了同步 th」这类漂移
// R64（用户：「右键弹簧点击固定方向后，弹簧的方向不再发生变化，即只能往那个方向运动拉伸」）：
// 方向锁 = **导轨模型**。S.dirLock 记下锁定那一刻的导轨线（中点 + 单位方向），端点先投影到
// 导轨上再做派生 —— 投影只动**垂直**分量、轴向分量原样保留，于是 cur/th/渲染/镜像板/弹力方向
// 全部自动锁定在这条线上，宿主怎么动弹簧都只会沿导轨伸缩。投影放在 refreshSpringGeom 是因为
// 它是所有几何路径（stepSprings / springSetLen / springMoveRig / copySpringBody / 锚定）的
// **唯一咽喉** —— 漏一条路径就会出现「拖一下又转回去」的破绽。
function refreshSpringGeom(B){
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
function springEnd(B,i){return i?B.e1:B.e0;}
function springSetEnd(B,i,x,y){var e=springEnd(B,i);e.x=x;e.y=y;}
// 记下「端点相对宿主的本地偏移」：宿主之后平移/旋转，端点都能跟着走。
// 旋转约定与 nearInk / arcWorldCenter 一致：world = pos + R(th)·local，R(th)=[[c,-s],[s,c]]。
// R77（用户④「高中模式下弹簧连接球后怎么还能转动？……这里有个反直觉的事儿，就是高中模式下，
//   球虽然能滚动，但弹簧与其的连接点不随球的转动而变化，始终只给那一个方向的力，因为高中的题
//   不考虑球的自转」）：**高中模式把锚点偏移冻结在质心系里（不做 R(th) 旋转）**。
//   两条通道一起改才算数（改一条会出现「记进去是旋转的、取出来不旋转」的错位）：
//     · 记：a.ox/a.oy = 锚点相对质心的**世界分量**（= 锚定那一刻的 dx/dy，原样存）；
//     · 取：world = 质心 + (ox,oy)，不含 th ⇒ 宿主怎么转，连接点的世界位置只跟着质心平移。
//   于是球照样能被地面摩擦/弹力滚起来（自转不受任何限制），但弹力**永远作用在同一个物理点上**、
//   方向恒定 —— 正是高中题「光滑球/不计自转」的画法。大学模式保持原样（R(th)·local，绕挂点转正）。
//   切换模式必须在**切换那一刻按当前几何重算**偏移，否则端点会瞬移（见 setMode 处理器 E4）。
// R100①：可锚定元件的端点取值 —— 弹簧 = e0/e1（live 对象，移动它即移动弹簧端），
// 杆 = 两端世界坐标（每次新建的对象；要改杆的端点请走 setRodEnds）。是「一个契约多处实现」
// 的收口点：springAnchorOffset / springDisconnectAtPoint / springTryAnchorByHost 全改读它。
function anyEndPoint(B,i){
  if(!B)return null;
  if(B.kind==='S')return springEnd(B,i);
  if(B.kind==='T')return rodEndWorld(B,i);
  return null;
}
// ★名字坑（R100① 实测）：本文件里**已有一个 ROD_PAD=0.5**（3101 行，笔迹外扩余量，
//   inkPieces/inset 那一路在用）。两处都是同一个顶层作用域的 `var`，而那一处**在文件更后面**
//   ⇒ 按执行顺序它后写，整个运行期 ROD_PAD 都是 0.5。新代码若也叫 ROD_PAD，拿到的吸附半径
//   就是 0.5px —— 「杆永远连不上物体」，而且语法/加载全绿，只有拿尺子量常量才看得见。
//   故本常量改名 ROD_SNAP，与 SPR_PAD(=15) 同值：同一个「够近就吸」手感。
//   （教训入 INVARIANTS：新增全局常量前先 grep 同名，别信「我新写的当然是我写的」。）
var ROD_SNAP=15;
// ★R106-1：双端刚性连杆的**每子步纠正量上限**（px）。命名前已 grep，无同名（学的就是上面
//   ROD_PAD 那个坑：新增全局常量前先 grep 同名）。理由：一次性把宿主瞬移几百 px 会把它撞穿
//   墙/地板（Matter 的位置写入不做连续碰撞检测）；封顶后剩余误差由下一子步继续收 ——
//   240Hz 下 12px/子步 = 2880px/s，肉眼仍是「立刻绷紧」，但不会穿透。
var ROD_PULL_MAX=12;                     // 与 SPR_PAD 同值：同一个「够近就吸」手感
var ROD_PULL_ITERS=6;                    // ★R130c：同一子步内纠正的**迭代次数**（每次重取锚点、
                                         //   各自封顶 ROD_PULL_MAX）⇒ 72px/帧收敛力。快拖实测
                                         //   指针 ~2000px/s=33px/帧，旧单次 12px/帧永远追不上。
var ROD_ROT_MAX=0.02;                    // ★R130d：单次迭代**宿主旋转**纠正上限（rad）。旋转纠正与
                                         //   Matter 积分互斗时会自激（实测 ω 炸到 1e6 rad/s），保险丝。
                                         //   （★R130e 曾加 ROD_INHERIT_VMAX 速度继承，实测无效已撤销，
                                         //   复盘注释见 rodSyncAnchors 双端分支。）
function springAnchorOffset(B,i){
  var a=B.anc[i];if(!a||!a.B)return;
  var h=a.B,e=anyEndPoint(B,i);          // R100①：端点按元件种类取（弹簧 e0/e1 / 杆两端）
  if(!e)return;
  var dx=e.x-h.x,dy=e.y-h.y;
  /* ★R130d（用户：「高中模式下为什么轻质杆的连接点可以在物体上偏移？我只说弹簧要固定方向，
   *   没说轻质杆要啊——轻质杆在大学和高中模式下都是一样的」）：杆两端锚点**不分模式**一律记在
   *   宿主**本地系**（随宿主转）。高中旧语义（世界系冻结）下宿主一转、连接点就在物体表面
   *   滑来滑去 = 用户看到的「连接点偏移」。弹簧维持 R77「高中锚点冻质心系」语义不动。 */
  if(B.kind==='T'){
    /* ★R131-26：**质心吸附**——杆端落在质心吸附带内 ⇒ 锚到**质心**。质心是物体上
     *  固定的一点 ⇒ 吸附后连接点仍相对物体不动（与「连接点不动」兼容），且力过质心
     *  =无力矩。带外=表面接触点（材料点）。
     *  ⚠ 只做吸附判定：不做球面滑动、不做深度升级（那两个会移动连接点）。 */
    var dcT=Math.hypot(dx,dy);
    var cradT=(h.wshape==='circle')?h.rad:null;
    var zoneT=cradT?cradT*0.7:Math.min(h.hw||30,h.hh||24)*0.9;
    /* ★★R131-55（用户：「独立铰链不需要往物体质心吸附，只有**轻质杆**才需要」）：
     *  质心带吸附**只对杆(T)生效**；铰链(S+hinge)/弹簧 ⇒ 跳过质心带（走角/表面）。 */
    var _isRodT=!!(B&&B.kind==='T');
    if(_isRodT&&dcT<=zoneT){
      a.ox=0;a.oy=0;a._noRot=false;a._dyn=0;return;
    }
    /* ★★R131-26e（用户：「杆可以直接连接到物体质心」——吸附判定按**杆的指向**）：
     *  端点接触表面（dc≈rad，带外）时，若**杆的轴线延长线穿过质心**（另一端与端点
     *  分居质心两侧 ⇒ 用户在往质心方向插）⇒ 吸到**质心**；否则=表面横搭 ⇒ 材料点。
     *  连接点=质心=物体上的固定点 ⇒ 与「连接点不动」兼容。 */
    /* ★R131-55c（自测发现：铰链仍锚到了质心 [0,0]）：质心入口有**两处**——除上面的
     *  质心带，还有这里"杆轴指向质心"的判定。两处都必须限定 **只对杆(T)** 生效，
     *  否则独立铰链仍会吸质心（用户：「独立铰链不需要往物体质心吸附」）。 */
    var _oeT=_isRodT?anyEndPoint(B,1-i):null;
    if(_oeT&&cradT){
      var _oxT=_oeT.x-h.x,_oyT=_oeT.y-h.y;
      var _side=_oxT*dx+_oyT*dy;                 // 端点-质心 在「质心→另一端」方向上的投影
      if(_side<0&&dcT<=cradT+15){                // 端点在质心的另一侧 ⇒ 杆指向质心 ⇒ 吸
        a.ox=0;a.oy=0;a._noRot=false;a._dyn=0;return;
      }
    }
    /* ★R131-16j（**已回退**）：曾把高中圆的杆锚点改到球心（质点语义），实测高中仍飞
     *  （1637px/s）⇒ 未证实有效，回退到钉材料点原样，避免引入无据的行为差异。
     *  高中杆飞的定性结论保存在日志：不是速度重建、也不是锚点位置，而是高中
     *  「质点+无力矩+自转冻结」与杆约束的语义冲突，需专项重做高中杆的约束模型。 */
    var cT=Math.cos(h.th||0),sT=Math.sin(h.th||0);
    a.ox=dx*cT+dy*sT;a.oy=-dx*sT+dy*cT;a._noRot=false;return;
  }
  /* ★R131（用户：「轻绳的高中模式下，我要的是不需要对角度和受力进行限制，就按照大学时的
   *   情形来就好」「下面两个物体调成4000kg，怎么轻绳就也脱钩了，肉眼可见绳子和物体分离」）：
   *   高中旧语义把绳也套进了弹簧的「锚点冻质心系」（_noRot=true，锚点不随宿主转）——重物
   *   下落/旋转时绳端在物体表面滑移，肉眼看就是「绳子和物体分离」（4000kg 脱钩记录
   *   rec_2026-09-25-12-40-27）。绳与杆一样是**点附着**约束，锚点必须钉材料点随宿主转；
   *   弹簧维持 R77「高中 _noRot」不动（那是弹簧自己的教学语义）。 */
  /* ★R131-15（用户 2026-09-26 下午拍板：「高中模式下绳子就和大学模式一样，干脆算了」）：
   *  R131-12 的「绳高中锚点=动态最近点」**整段撤销**——实测它正是「拖绳身时固定点被
   *  拖着在宿主表面滑动」（REC rec_2026-09-26-09-43-06：单端锚定绳被横拖 300px、锚点
   *  跟着滑）的元凶（锚点 ox/oy 每帧按另一端重算 ⇒ 锚点永不钉死）。绳锚点恢复**大学
   *  语义**：不分模式一律本地系钉材料点随宿主转（与杆 R130d 同一条）。 */
  /* ★R131-15c（用户 2026-09-26，REC rec_09-40-50：「弹簧连接物体后，鼠标抓住物体和松开，
   *  弹簧对另一边物体的连接点也会发生轻微偏移」）：R77 的高中「锚点冻质心系」（世界系
   *  ox/oy 不随宿主转）在宿主有**残余转动**时连接点在表面滑移（REC：poly2 a=0.063rad
   *  时连接点偏移）。撤销世界系：**不分模式一律本地系钉材料点随宿主转**（与杆 R130d
   *  同一条）⇒ 连接点钉死在材料上永不滑。 */
  var c=Math.cos(h.th||0),s=Math.sin(h.th||0);
  a.ox=dx*c+dy*s;a.oy=-dx*s+dy*c;a._noRot=false;
}
/* ---- R100①：轻质杆的两端连接（复用弹簧那一整套锚定合约）--------------------------------
 * 用户：「轻质杆要和弹簧一样，可以和物体直接连接啊」。
 * 存储/偏移量纲/旋转语义/高中不跟转 —— 全部走上面这两个**既有**函数，一个字节都不另造：
 *   B.anc[i]={B:host,ox,oy,_noRot}；端点取法按元件分派（anyEndPoint）。
 * 跟随语义：**已锚定的端由宿主位姿决定**，另一端保持自由 ⇒
 *   · 单端锚定 = 绕该点的摆（这就是用户清单 ⑤「光滑铰链」的最小可用形态）；
 *   · 双端锚定 = 两根宿主之间的一条刚性连杆（位置学成立）。
 * ★已知边界（诚实记录，未建模）：杆端锚定是**位置驱动**的（与弹簧两端同一合约），
 *   所以它不把宿主的受力反算回来 —— 把杆挂在墙上可以，用杆去撬很重的物体不行。
 *   真正的双向约束需要独立求解器，不在本轮范围。
 * 无锚定时逐字节零成本：两个 anc 都是 null 时第一行就返回 false。 */
/* ★R131-17（用户 REC 15-13-54：高中「杆连球」飞出；_diag_r131n 实测单杆正常
 *  ——瞬移 0.29px/帧、能量单调衰减⇒ 问题在**多杆共享宿主**）：
 *  同一子步里一个宿主可能被**好几根杆**各修正一次，修正量叠加（每根最多 12px，两根 24px、
 *  三根 36px…）⇒ Gauss-Seidel 迭代相互放大 ⇒ 装配发散飞出。
 *  修：给每个宿主**每子步一个修正总预算 ROD_PULL_MAX**，多杆按先到先得分配（超出即按比例缩减）。
 *  单杆本来 ≤12px ⇒ 行为不变；多杆不再叠加。 */
function rodPbdRemain(h){
  if(!h||!h.mb)return ROD_PULL_MAX;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  return Math.max(0,ROD_PULL_MAX-h._pbdAcc);
}
function rodPbdAdd(h,amt){
  if(!h)return;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  h._pbdAcc+=amt;
}
/* ★R131-17：**多杆共享宿主的 PBD 修正预算**——同一子步多根杆各给宿主一次修正
 *  （每根上限 12px）叠加 ⇒ 迭代放大发散（高中杆连球飞出实证）。每宿主每子步
 *  总修正 ≤ ROD_PULL_MAX，多杆先到先得、超出按比例缩减；单杆本来 ≤12px ⇒ 不变。 */
function rodPbdRemain(h){
  if(!h||!h.mb)return ROD_PULL_MAX;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  return Math.max(0,ROD_PULL_MAX-h._pbdAcc);
}
function rodPbdAdd(h,amt){
  if(!h)return;
  var _ts=(MW&&MW.engine)?MW.engine.timing.timestamp:0;
  if(h._pbdTs!==_ts){h._pbdTs=_ts;h._pbdAcc=0;}
  h._pbdAcc+=amt;
}
function rodSyncAnchors(B,dt){
  if(!B||B.kind!=='T'||!B.anc)return false;
  if(!B.anc[0]&&!B.anc[1])return false;
  /* ★★R131-25（用户 2026-09-27 晚最终拍板）：「杆与物体的**连接点不动**——相对于
   *  物体表面不动，但**杆可以绕连接点自由旋转**」。R131-20/22/24 的球面滑动、质心
   *  吸附带、深度升级全部撤销——那些都在移动连接点，与「连接点不动」根本冲突。
   *  最终语义 = **R130d 材料点锚定**（本地系钉死，随宿主位姿）+ 宿主角度锁死
   *  （_rodLK ⇒ 材料点方位恒定）+ 杆自身自由旋转（PBD 旋转修正保留）+
   *  杆-杆销接（杆宿主不打锁）+ 杆无碰撞箱（R131-21）。 */
  

  // ★R130c：杆**自身**被拖（左键抓杆身 grab.kind='body'/长度手柄 'rodlen'）⇒ 位姿归指针
  //   （R98-3 / R105-4 语义），本函数整步让路 —— 否则下面的姿态可视化会和拖杆处理器
  //   互相改写（实测：杆被拽回锚点、拖不动）。
  if(grab&&grab.obj===B&&(grab.kind==='body'||grab.kind==='rodlen'))return false;
  var w=[null,null],n=0,i;
  for(i=0;i<2;i++){
    var a=B.anc[i];if(!a)continue;
    if(!a.B||a.B.dead||bodies.indexOf(a.B)<0){B.anc[i]=null;continue;}   // 宿主没了 → 这一端自动自由
    w[i]=springAnchoredWorld(B,i);
    if(w[i])n++;
  }
  if(!n)return false;
  // ---- 双端拴住 = 两根宿主之间的一条**刚性连杆**（★R106：长度守恒，不再跟锚点走）----------
  // ★R106-1（用户：「我用它连接两个物体，一个物体在空中固定，另一个物体下落直接把杆子
  //   拖到地上去了」「轻质杆怎么还会伸长？」）：旧实现 `rodPlaceEnds(w0,w1)` 把 **B.len
  //   反算成两锚点距离**（`setRodEnds` 第 815 行 `B.len=d`）⇒ 杆退化成橡皮筋：重物一挂就
  //   开始「长」，实测 **len 200 → 427.69、重物从 y=460 一路落到 687.7（地面）**，而两端
  //   锚点残差恒为 0 —— 也就是「杆既没断也没脱钩，只是在悄悄变长」。
  //   ★单端那一路 R102 早已修成「绕锚点刚性转动 + 速度投影」（其注释自述「实测 0.8s 把
  //   len 从 177 抻到 504」）⇒ **同一 bug 只修了一半**，双端这一格没跟上。
  //   ★这条也落在上面「已知边界」里写着的「用杆去*撬*很重的物体不行」同一格 —— 但用户
  //   要的是**吊住**一个下落的重物，不是撬，所以这一格必须建模。
  // 新语义：**|e1−e0| ≡ B.len**。两锚点距离 ≠ len 时搬**可搬动的宿主**去满足它：
  //   · 纠正量按 **1/m 分配**（与 R63 的口径同一套），铁砧端不动；
  //   · 再把两端**沿轴的相对速度**投影掉 —— 否则重力每子步攒一点轴向速度、PBD 又把它
  //     吃掉 ⇒ 数值上无界增长，一解除锚定就弹飞（单端分支那次是同一病）；
  //   · `hostMovableByConstraint` 只对 W 体开（非 W 的位姿归 Matter，写了会被覆盖）；
  //   · 每子步纠正量封顶 ROD_PULL_MAX —— 免得一次巨大的瞬移把宿主撞穿墙（剩余误差下一
  //     子步继续收，240Hz 下收得极快）；
  //   · **两端都搬不动**（两个铁砧）时维持旧行为：几何服从锚点（配置本身过约束，此时
  //     宁可让杆被拉长，也不许把杆画成「和宿主脱钩」）。
  if(n===2){
    var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
    /* ★★R107-1（用户：「我连接两个物体后，拖动其中一个物体，拉快一点就会导致杆变长，
     *   让另外一个物体垂到地上」）：目标长度必须取 **B._rodL**（有意设定的那个数），
     *   **绝不能取 B.len** —— 本分支的收尾 rodPlaceEnds→setRodEnds 会把 B.len 改写成
     *   「当前两锚点距离」，而纠正量被 ROD_PULL_MAX=12 封顶 ⇒ 一次大跳（pointermove
     *   事件间隔里的位移，快拖实测 ~80px/事件）只能还掉 ≤24px，收尾就把 len 写成
     *   「Lr+56」⇒ 下一子步 err=|ad−len|=0 ⇒ **纠正再也不跑**。棘轮：杆只长不缩。
     *   实测（_diag_r107a P1 快拖 / P5 提起自由方块）：len 120 → **195.04 / 204.33**；
     *   慢拖对照只有 120.02 ⇒ 判据有判别力。
     *   改取 _rodL 后 err 不再被自己改写 ⇒ 纠正跨子步持续生效，收敛后 len 自己回到 _rodL。
     *   _rodL 的写入点只有「有意改长度」四处：makeRod 初值 / setRodLen（面板）/
     *   rodDragEnds（长度手柄）/ rodTryAnchor（落点吸附）。这里（跟锚点走）绝不写它。 */
    if(B._rodL==null||!(B._rodL>0))B._rodL=B.len||170;
    var W0=w[0],W1=w[1],Lr=B._rodL;
    /* ★★R130c（用户：「两个物体一直在抖动，杆和物体也脱钩，感觉你现在的杆的计算有问题，
     *   你要不去网上找找合适的再做」）：记录文件 rec_2026-09-25 实测三大症状 ——
     *   ①拖拽期两锚点距离 177~315px（杆长 300，±40%，橡皮筋）；②松手弹射 1009px/s；
     *   ③落地帧速度 1183→506→−3 瞬跳（互斗振荡）。
     *   先试过「挂 Matter 原生 Constraint（stiffness=1）」⇒ 当场爆炸（残差 3100px、角速度
     *   累计 −38762rad）：**W 体的位姿归产品每帧摆放**（见 hostMovableByConstraint 注释），
     *   Matter 约束的修正被下一帧产品写入覆盖 ⇒ 正反馈发散。原生约束在「产品自管 W 体」
     *   的架构下不可用（这正是 R107-1b 回退过的同一条边界），收回。
     *   实际修两条（都在自研 PBD 内）：
     *   A【橡皮筋根因】旧代码末尾 `rodPlaceEnds(W0,W1)` 每子步把 **B.len 改写成当前锚距**
     *     ⇒ 杆跟着锚距伸缩。现在**统一走「纯姿态可视化」**：中心=锚点中点、方向=W1→W0
     *     （与 setRodEnds 同惯例）、**len 恒 = _rodL**。锚距≠Lr 时杆端与锚点有诚实缺口，
     *     由下面的纠正把锚距收回来 —— 杆永远画成刚体，不再替误差「化装」。
     *   B【收敛速度】旧纠正每子步只跑**一次**（封顶 ROD_PULL_MAX=12px）。指针快拖
     *     ~2000px/s=33px/帧 ⇒ 12px/帧的纠正永远追不上 ⇒ 记录里 123px 的持续压缩。
     *     现在改成**同子步内多次迭代**（ROD_PULL_ITERS=6 次，每次重取锚点、各自封顶
     *     12px）⇒ 72px/帧收敛力，Gauss-Seidel 式迭代正是 PBD 标准做法。 */
    function _im(h){                                   // 可搬动 ⇒ 1/m；搬不动 ⇒ 0
      /* ★★R111：**正被拖的那个宿主不参与 1/m 分配**（当成铁砧）。
       *   拖拽期它的位姿归指针，**下一帧就会被整份覆盖** ⇒ 分给它的那一半纠正白做，
       *   收敛速度直接减半（实测拖动期残差最坏 13px）。与 `conDragConstrain` 的分配规则逐字同款。 */
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var m=h.mb.mass;
      return (m>0&&isFinite(m))?(1/m):0;
    }
    /* ★★R130d（rec_2026-09-25-09-50-23：大学模式「杆卡死/抖动/脱钩」，复现实测落地瞬间
     *   err=27.6px、A 圆 1201px/s 滑走；高中「连接点在物体上偏移」同源）：旧实现只把**平动**
     *   交给约束（im=1/m、修正只写质心）。锚点随宿主**转**（大学 _noRot=false；高中杆按用户
     *   新规格也随转，见 springAnchorOffset），宿主一转（落地碰撞、拖拽甩动、地面滚转）锚点
     *   就绕质心甩 ⇒ 平动修正永远追不平（锚距残差=画出来的杆与体「脱钩」）、每子步泵进能量
     *   （「抖动」）。修法：位置相位升级为**平动+旋转**的刚体点距约束（b2DistanceJoint 同款
     *   雅可比）——
     *     C=|p1−p0|−L，p_i=x_i+R(th_i)·r_i，r_iw=p_i−center_i（世界系）
     *     ∂C/∂x_i=∓u；∂C/∂th_i=∓(u×r_iw)
     *     K=Σ im_i + Σ iI_i·j_i²（j_i=u×r_iw）；λ=err/K
     *     Δx0=+u·λ·im0、Δx1=−u·λ·im1、Δth0=−iI0·j0·λ、Δth1=+iI1·j1·λ
     *   ★速度相位**保持纯平动**投影（见下方三臂对照判决注释）——含 ω 冲量的版本在落地接触
     *   处正反馈（实测三臂矩阵：速度冲到 1.4e4px/s 飞出屏幕，平动-only 臂 err≤0.26 全程稳定）。 */
    function _iI(h){                                   // 转动自由度的广义逆质量；搬不动/被抓 ⇒ 0
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var I=h.mb.inertia;
      return (I>0&&isFinite(I))?(1/I):0;
    }
    var im0=_im(h0),im1=_im(h1),iI0=_iI(h0),iI1=_iI(h1);
    if(im0+im1+iI0+iI1>1e-9){
      /* ★R130d 补丁（爆炸复盘）：本函数在 Engine.update **之前**跑，h.x/h.y/h.th 是上一子步
       *   的旧值（Matter 已把 mb 积分到新位姿，产品字段要等帧末 10487 回写）。约束按旧位姿算、
       *   再用 setPosition/setAngle **绝对**回写，等于每子步把 Matter 刚转出的角度倒回旧值、
       *   ω 却在积分里继续涨 ⇒ 落地滚动时正反馈（实测 ω 1.5→120→1056 rad/s、速度 3e14 px/s）。
       *   解算前先从 mb 同步一次新位姿（被抓宿主除外：它的位姿归指针，本来就是新值）。 */
      if(h0&&h0.mb&&!(grab&&grab.kind==='body'&&grab.obj===h0)){
        h0.x=h0.mb.position.x;h0.y=h0.mb.position.y;h0.th=h0.mb.angle;}
      if(h1&&h1.mb&&!(grab&&grab.kind==='body'&&grab.obj===h1)){
        h1.x=h1.mb.position.x;h1.y=h1.mb.position.y;h1.th=h1.mb.angle;}
      /* ★★R131-10「越摆越低」（用户 2026-09-26：杆摆应该能量守恒）：
       *  _probe_r131_leak 实测漏能**全部**在杆约束（300 帧 rodSyncAnchors ΔE=−141 万，
       *  其它阶段全 0；V1/V2 变体证明两相单独禁掉都爆/坍，必须并存）：位置相位的
       *  setPosition/setAngle 纯瞬移不改速度 ⇒ 约束几何功不进速度账；速度相位清锚点
       *  径向速度时对「本子步重力刚注入的径向分量」做负功 ~½m·v_r² ⇒ 30° 释放 8s 衰减 99.9%。
       *  修法 = **全量 XPBD 速度重建**：子步起始在此快照，Engine.update 之后用
       *  「完整子步位移（修正+积分）/dt」反推速度（rodXPBDVel，见子步循环）——
       *  切向动能完整保留、与重力功自洽 ⇒ 不漏不注。
       *  （R131-9 M4 只补 ω 不补 v 是半套 ⇒ 长杆静置自爬，已撤销；R130e v+=Δx/dt
       *   又被速度相位正确清掉=无效；本版取完整位移、放积分后，绕开这两个坑。）
       *  快照只在 dt>0（正常子步）记；static/被抓宿主不记（位姿不归约束）。 */
      var _touching=function(mb){                          // 该 mb 是否处于任何活动接触对中
        if(!mb)return true;                                // 拿不准按有接触（保守 ⇒ 纯平动）
        var pl=(MW&&MW.engine)?MW.engine.pairs.list:null;
        if(!pl)return true;
        for(var i=0;i<pl.length;i++){var pp=pl[i];
          if(pp.isActive&&(pp.bodyA===mb||pp.bodyB===mb))return true;}
        return false;};
      var _free=!_touching(h0&&h0.mb)&&!_touching(h1&&h1.mb);   // 两端都悬空 ⇒ 允许 ω 模
      /* ★R131-18：**松手冷却 80 子步（20 帧）**——松手瞬间的回弹修正被重建误读成
       *  速度会反方向飞出（REC 09-53-23 实证），冷却期让回弹收敛后再恢复重建。 */
      if(grab&&grab.kind==='body')B._grabCool=80;
      else if(B._grabCool>0)B._grabCool--;
      if(dt>0&&_free&&!(grab&&grab.kind==='body')&&!(B._grabCool>0)){
        /* ★「无抓握」门：抓着任何 body 的帧里，conDragConstrain/rodDragPinHosts 会把
         *  装配另一端逐子步**重钉**到杆端（R105-4/R111）——重钉位移不是物理速度，
         *  被重建误读成速度会把摆锤甩飞（实测 _diag_r131b R(high) 臂 B 被甩到角落睡死）。
         *  抓握期整帧豁免，松手后恢复重建。 */
        /* ★只对**简单体（parts==1）**宿主记快照：复合体（墨迹链）上「Engine 角度积分 ×
         *  位置相位 setAngle」的口径差使重建系统性注能——实测平动重建也让真鼠标拖拽-
         *  松手路径爆到 v=17263px/s（c10）——复合体完全豁免、回基线两相位行为。 */
        B._xps=[];
        B._xpsFree=true;
        if(h0&&h0.mb&&!h0.mb.isStatic&&h0.mb.parts.length===1&&!(grab&&grab.kind==='body'&&grab.obj===h0))
          B._xps.push([h0,h0.mb.position.x,h0.mb.position.y,h0.mb.angle]);
        if(h1&&h1.mb&&!h1.mb.isStatic&&h1.mb.parts.length===1&&!(grab&&grab.kind==='body'&&grab.obj===h1))
          B._xps.push([h1,h1.mb.position.x,h1.mb.position.y,h1.mb.angle]);
      }
      for(var it=0;it<ROD_PULL_ITERS;it++){
        var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
        var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
        var ux=ax/ad,uy=ay/ad,err=ad-Lr;
        if(Math.abs(err)<=0.05)break;
        var j0=0,j1=0,r0l=1,r1l=1;
        /* ★R130d 旋转自由度门：高中模式圆=质点（circleRollStep ①强制 ω≡0），不许用 setAngle
         *   绕过它去转圆（实测慢拖 d12 漂 6px）⇒ 高中圆宿主 j=0；多边形/大学全形状照常参与
         *   （这正是「连接点在物体上偏移」的修复面）。 */
        var _hsC0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'),
            _hsC1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
        /* ★R131-21：角度锁死宿主（_rodLK）不参与旋转修正——自由度已移除 */
        if(h0&&h0._rodLK)_hsC0=true;
        if(h1&&h1._rodLK)_hsC1=true;
        if(h0&&h0.mb){var r0x=p0.x-h0.x,r0y=p0.y-h0.y;r0l=Math.max(1,Math.hypot(r0x,r0y));
          if(!_hsC0)j0=ux*r0y-uy*r0x;}
        if(h1&&h1.mb){var r1x=p1.x-h1.x,r1y=p1.y-h1.y;r1l=Math.max(1,Math.hypot(r1x,r1y));
          if(!_hsC1)j1=ux*r1y-uy*r1x;}
        var K=im0+im1+iI0*j0*j0+iI1*j1*j1;
        if(!(K>1e-9))break;
        var lam=err/K;
        var c0=lam*im0,c1=lam*im1;
        var _cap=(PHYS_MODE==='high')?4:ROD_PULL_MAX;   // ★R131-18
        if(Math.abs(c0)>_cap)c0=(c0>0?1:-1)*_cap;
        if(Math.abs(c1)>_cap)c1=(c1>0?1:-1)*_cap;
        var w0=(iI0>0&&j0)?(-iI0*j0*lam):0,w1=(iI1>0&&j1)?(iI1*j1*lam):0;
        // 旋转分量封顶：|Δth| ≤ ROD_ROT_MAX（保险丝）且锚点位移 ≤ ROD_PULL_MAX（与平移同口径）
        if(w0){if(Math.abs(w0)>ROD_ROT_MAX)w0=(w0>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w0)*r0l>ROD_PULL_MAX)w0=(w0>0?1:-1)*ROD_PULL_MAX/r0l;}
        if(w1){if(Math.abs(w1)>ROD_ROT_MAX)w1=(w1>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w1)*r1l>ROD_PULL_MAX)w1=(w1>0?1:-1)*ROD_PULL_MAX/r1l;}
        if((c0||w0)&&h0){
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h0)){   // ★R131-29
            var _cap0=0.5;
            if(Math.abs(c0)>_cap0)c0=(c0>0?1:-1)*_cap0;
            if(w0)w0*=0.15;
          }
          /* ★★R131-31（用户：「倒悬真因没有解决」）：上一版只把 w 乘 0.18——但**下面
           *  的 setAngle 仍然把 w 非零的姿态写回宿主** ⇒ 姿态还是被 PBD 保持。
           *  ★★★R131-64 撤销这条 `w0=0`（与 h1 那一侧对称，理由与铁证见 h1 分支注释）：
           *  旋转修正是位置约束 C=|p1−p0|−L 的**组成部分**（∂C/∂θ_i=±(u×r_iw)），
           *  砍掉它 ⇒ 位置误差全压给平移 ⇒ 大偏差时 λ 越界被 _cap 截断 ⇒ 非保守 ⇒ 泵。
           *  实测（_diag_r259）：撤销后 S2 双摆总能量正漂 1.1420→**0.0002**、Δθ 由
           *  +2.704（翻圈）变为 **+0.3828**（右沉，符合"右边受力就该右沉"）。 */
          /* 旧行（保留供对照）：if(h0&&h0.mb&&h0.kind!=='T'&&!h0.mb.isStatic)w0=0; */
          if(h0&&h0.mb&&h0.kind==='W'&&!h0.mb.isStatic){   // ★R131-44：同上（另一端对称）
            var _c0max=0.45;if(c0>_c0max)c0=_c0max;if(c0<-_c0max)c0=-_c0max;
          }
          var am0=Math.hypot(c0,(w0||0)*r0l),rem0=rodPbdRemain(h0);   // ★R131-17 预算
          if(am0>rem0&&am0>1e-9){var kk0=rem0/am0;c0*=kk0;if(w0)w0*=kk0;am0=rem0;}
          rodPbdAdd(h0,am0);
          h0.x+=ux*c0;h0.y+=uy*c0;if(w0)h0.th=(h0.th||0)+w0;
          if(h0.mb&&MW){Matter.Body.setPosition(h0.mb,{x:h0.x,y:h0.y});
            if(w0)Matter.Body.setAngle(h0.mb,h0.th);
            Matter.Sleeping.set(h0.mb,false);}}
        if((c1||w1)&&h1){
          /* ★★R131-29（用户：「拖墙运动导致被吊物体违反重力倒悬在杆上」）：一端宿主
           *  正被指针拖 ⇒ 另一端**不再被位置相位硬搬**（只留 ≤0.5px/子步的缓慢牵引），
           *  让重力主导 ⇒ 物体自由下垂（拖墙时它绕锚点摆，而不是被瞬间拖到杆端上方）。 */
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h1)){
            var _cap1=0.5;
            if(Math.abs(c1)>_cap1)c1=(c1>0?1:-1)*_cap1;
            if(w1)w1*=0.15;
          }
          /* ★★R131-30（REC 12-03-13：被吊物体 y 243→111 升到墙高度、转了 1.3 圈=倒悬
           *  停在墙上）：**锚定 W 体的 PBD 旋转修正被大幅削弱**——物体的姿态必须由
           *  重力/接触（复摆稳定平衡=质心在锚点正下方）决定；PBD 全量旋转修正会
           *  强行把物体保持成「锚点姿态」⇒ 阻止重力摆回 ⇒ 任意姿态（含倒悬）都能停住。
           *  PBD 从此只管**位置**（杆长），姿态交给物理。 */
          /* ★★★R131-64（撤销 R131-31 的 `w1=0`；用户④「整个系统还无故抽动、凭空获得
           *  大量动能」）：这条 `w1=0` 就是注能链的**上游**。R131-31 当年这么写，是因为
           *  位置相位的旋转修正会"强行把物体保持成锚点姿态、阻止重力摆回"——但那属于
           *  **当时没有独立力矩通道**的问题；后来 R131-32c 补了 `rodHingeTorque` 来顶替它，
           *  于是变成"旋转修正全砍 + 每帧把 ω 推到钳位 0.15 rad/帧"的组合（见该函数注释）。
           *  R131-64 把这条砍掉、让 PBD 的旋转相位重新承担姿态（**旋转是位置约束的一部分**：
           *  C=|p1−p0|−L，p_i=x_i+R(θ_i)·r_i ⇒ ∂C/∂θ_i 必须参与，否则位置误差全压给平移 ⇒
           *  大偏差时 λ 越界被 _cap 截断 ⇒ 非保守修正 ⇒ 泵）。
           *  臂矩阵（_diag_r259，S2 双摆 600 帧，判据 = 总能量正漂/KE峰）：
           *    J0 现状（本行在 + rodHingeTorque 在）  **+1.1420** 注能、Δθ=+2.704（翻圈）
           *    J1 力矩停用（本行仍在）                +0.0002 守恒、Δθ=0（姿态被冻）
           *    J2 力矩停用 + 本行撤销                  +0.0002 守恒、Δθ=+0.3828 **右沉（对）**
           *    J3 J2 + 速度相位写回 ω                 +0.0203 守恒、杆端残差峰 0.06→0.03
           *  S3 真复摆（铁砧端、初位偏离竖直 30°）J2 臂：θ 从 +0.5236 单调收到 0（会摆、
           *  方向正确）、正漂 +0.0059 ⇒ PBD 自己就能给出复摆动力学。 */
          /* ★★R131-44（REC 11-09-59 逐帧能量分析：吊物松手后 E 从 2862 暴涨到 11631，
           *  而稳定态只有 ~2500 —— 注能发生在"松手后的几秒"，正是**位置相位把物体搬运
           *  到杆端**这条非物理通道）。修：锚定 W 体的单步位置修正设上限（≤0.45px/子步），
           *  搬运变慢 ⇒ 不再凭空抬高物体。 */
          if(h1&&h1.mb&&h1.kind==='W'&&!h1.mb.isStatic){
            var _c1max=0.45;if(c1>_c1max)c1=_c1max;if(c1<-_c1max)c1=-_c1max;
          }
          var am1=Math.hypot(c1,(w1||0)*r1l),rem1=rodPbdRemain(h1);   // ★R131-17 预算
          if(am1>rem1&&am1>1e-9){var kk1=rem1/am1;c1*=kk1;if(w1)w1*=kk1;am1=rem1;}
          rodPbdAdd(h1,am1);
          h1.x-=ux*c1;h1.y-=uy*c1;if(w1)h1.th=(h1.th||0)+w1;
          if(h1.mb&&MW){Matter.Body.setPosition(h1.mb,{x:h1.x,y:h1.y});
            if(w1)Matter.Body.setAngle(h1.mb,h1.th);
            Matter.Sleeping.set(h1.mb,false);}}
      }
      /* ★R130e（已撤销，2026-09-25）：曾在此加「速度继承 v+=Δx/dt」治吊起拖拽的阻尼蠕行。
       *   A/B 实测（_diag_r130p/q/r 三套夹具）与改前臂**完全等价**——无效。机制复盘：
       *   ①位置相位每子步 err≤0.05 早退 ⇒ acc≈0，继承量趋零；
       *   ②真有 acc 时（快拖大误差），沿杆方向的速度分量会在同一子步被下方「轴向相对速度
       *     投影」（Ċ=0，v_B·u:=v_A·u）**正确地砍掉**——径向速度本就不该保留，PBD 的
       *     v+=Δx/dt 收尾在有独立速度求解器时是重复/冲突项；
       *   ③快拖大误差时 acc 封顶 12px ⇒ ivx 最高 2880px/s，等于给 R130c 已修好的「松手
       *     弹射」场景新开一条能量注入路径（有害）。
       *   真正的钟摆动力学根因（两模式）见 _diag_r130r 自由摆夹具：
       *   大学=能量泵（30° 初位荡到 180° 翻圈：杆力矩驱动 B 自转，锚点钉材料点偏离质心
       *   45px，位置相位含 Δth 修正而速度相位无 ω 投影 ⇒ 旋转速度失控）；高中=过阻尼
       *   （frictionAir ~45%/s + 悬空睡眠把摆动冻死）。修复另轮处理。 */
      // 轴向相对速度投影（R130d 升级：锚点速度含 ω×r，冲量含角动量回写；PBD 标准收尾，跑一次）
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      // 轴向相对速度投影：(v1−v0)·u := 0，按 1/m 分配回两端（PBD 的标准收尾，跑一次）
      // ★R130d 三臂对照判决（诊断门矩阵，落地场景 6 采样点）：**接触场景速度相位不得带
      //   ω×r 耦合**——带它的两臂在落地接触处正反馈（速度冲到 1.4e4 px/s、飞出屏幕）。
      // ★★R130f（用户拍板「三毛病全修」，2026-09-25）：R130d 的纯平动版在**摆动场景**留下
      //   一个能量泵——杆力作用在偏离质心的锚点上给宿主力矩 ⇒ 宿主自转甩动锚点，位置相位
      //   含 Δth 修正而速度相位无 ω 投影 ⇒ 旋转自由度的**速度**完全失控。自由摆实测
      //   （_diag_r130r.py）：30° 初位一路越荡越高翻到 180°，被睡眠冻在不稳定平衡顶点
      //   ——这正是「吊起拖拽像有阻尼」主诉的大学模式根源。
      //   修法：**双模门控**——两端宿主均无活动接触对（自由摆动/悬空）时用**完整点距速度
      //   求解**（b2DistanceJoint 同款：Ċ=(v1+ω1×r1−v0−ω0×r0)·u=0，含 ω 冲量与角动量
      //   回写）；任一端有接触时维持 R130d 纯平动（落地互斗场景零改动）。高中圆宿主沿用
      //   _hsC 门（ω≡0 ⇒ j=0，数学上自动退化为纯平动，与 R130d 行为逐字一致）。
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      var v0x=h0?(h0.mb?h0.mb.velocity.x*60:(h0.vx||0)):0;
      var v0y=h0?(h0.mb?h0.mb.velocity.y*60:(h0.vy||0)):0;
      var v1x=h1?(h1.mb?h1.mb.velocity.x*60:(h1.vx||0)):0;
      var v1y=h1?(h1.mb?h1.mb.velocity.y*60:(h1.vy||0)):0;
      var vr=(v1x-v0x)*ux+(v1y-v0y)*uy;
      var _hsV0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'), // 高中圆 ω≡0（R130d 质点门同款）
          _hsV1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
      /* （★R131-10：_touching/_free 的定义已上移到函数头的快照段，此处直接用。） */
      if(_free&&(iI0>0||iI1>0)){
        /* ★R130f 终版（臂矩阵实测定形）：Ċ 用**锚点真实速度**（含宿主自转贡献
         *   ω×r），冲量**只走平动**——
         *   Ċ=u·v1−u·v0−ω1·j1+ω0·j0（2D：u·(ω×r)=−ω·j，j=ux·ry−uy·rx）
         *   K=im0+im1+iI0·j0²+iI1·j1²；λ=−Ċ/K；v0 += −u·λ·im0、v1 += +u·λ·im1。
         *   ★**ω 不写回**（曾试过 setAngularVelocity 写回 b2DistanceJoint 全套）：
         *     臂矩阵（_diag_r130r 自由摆）——纯平动臂（R130d）泵（30°荡到180°）；
         *     全套含 ω 写回臂**泵得更猛**（vmB 271→504、0.5s 翻顶点；写回与位置相位
         *     每子步的 Δth 瞬移互相打架 ⇒ 正反馈）；**只把 ω 计入 Ċ/冲量只给平动**的
         *     臂泵消失、有界摆动 2 周期（−15↔+88px）。这与 R130d「旋转**几何**误差归
         *     位置相位」的分工哲学同构：旋转速度误差同样不直接冲量、留给位置相位收敛。
         *     j=0（高中圆/锚点共线）时退化为纯平动版，与接触臂逐字一致。 */
        var om0=h0&&h0.mb?h0.mb.angularVelocity*60:0,     // 属性×60 = rad/s（量纲口径同 R130d 笔记）
            om1=h1&&h1.mb?h1.mb.angularVelocity*60:0;
        var jv0=0,jv1=0;
        if(h0&&h0.mb&&!_hsV0){var r0vx=p0.x-h0.x,r0vy=p0.y-h0.y;jv0=ux*r0vy-uy*r0vx;}
        if(h1&&h1.mb&&!_hsV1){var r1vx=p1.x-h1.x,r1vy=p1.y-h1.y;jv1=ux*r1vy-uy*r1vx;}
        var cd=vr-om1*jv1+om0*jv0;                        // = Ċ（混合量纲，只作比值用）
        var Kv=im0+im1+iI0*jv0*jv0+iI1*jv1*jv1;
        if(Kv>1e-9){
          var lv=-cd/Kv;
          if(im0>0&&h0&&h0.mb)Matter.Body.setVelocity(h0.mb,{x:(v0x-ux*lv*im0)/60,y:(v0y-uy*lv*im0)/60});
          if(im1>0&&h1&&h1.mb)Matter.Body.setVelocity(h1.mb,{x:(v1x+ux*lv*im1)/60,y:(v1y+uy*lv*im1)/60});
        }
      }else if(vr){
        /* ★R130d 纯平动臂（接触场景保留原样，零改动） */
        var tt=im0+im1;
        if(tt>1e-9){
          if(im0>0&&h0&&h0.mb)Matter.Body.setVelocity(h0.mb,{x:(v0x+ux*vr*im0/tt)/60,y:(v0y+uy*vr*im0/tt)/60});
          if(im1>0&&h1&&h1.mb)Matter.Body.setVelocity(h1.mb,{x:(v1x-ux*vr*im1/tt)/60,y:(v1y-uy*vr*im1/tt)/60});
        }
      }
    }
    // 姿态可视化（统一路径，tt>0 / tt=0 都走这里）：只摆姿态、**绝不写 len**
    // （对照 R107-1c「诚实姿态」分支：轻质杆不可伸长，锚距≠Lr 的缺口是诚实的）
    var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
    B.x=(p0.x+p1.x)/2;B.y=(p0.y+p1.y)/2;
    /* ★R130d：th **连续化**（禁 atan2 的 ±π 分支跳变）。跳变 ~2π 会让 stepMatter 那行
     *   setAngle(R4.mb,R4.th,true)（带速度意图）给**静态镜像板**注入 ~2π/子步的角速度，
     *   接触求解器把板当成疯狂自转把宿主撞飞（仪器实测：单次 setAngle delta=5.7rad、
     *   ω 8.5→391rad/s、err 41→爆）。 */
    B.th=(B.th||0)+shortAng(Math.atan2(p0.y-p1.y,p0.x-p1.x)-(B.th||0));
    B.len=Lr;B.hw=Lr/2+2;
    var mstale=(B._mlen==null)||(Math.abs(B._mlen-B.len)>ROD_MIRROR_TOL)||
               (B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)));
    if(mstale)rebuildRodMirror(B);
    else if(MW&&B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
    return true;
  }
  // ---- 单端拴住 = 绕该点的**铰链**（这就是用户清单⑤「光滑铰链」的最小可用形态）-----------
  // ★必须绕锚点**转**，不能只把锚端平移回去。平移版保持自由端不动 ⇒ 两端距离每子步被重力
  //   拉长一点、且从不回缩：实测 0.8s 把 len 从 177 抻到 **504**（「杆会自己变长」）。
  //   绕锚点转动是**刚性运动** ⇒ 两端距离恒等于 B.len，长度守恒是构造出来的、不是靠调参。
  var k=w[0]?0:1,t=1-k;
  // ★残差判据必须是「**锚定端**离锚点的偏移」，不是「自由端离半径 L 圆的径向误差」。
  //   后者是个错的量：沿**切向**的平移在一阶上不改变它（|e−w| 仍 ≈ L），却带着锚定端
  //   一起漂 —— 于是修正永不触发、误差可以偷偷累积（实测峰值 4.5px）。锚定端的偏移才是
  //   这个约束真正要满足的残差，也是唯一诚实的判据。
  var pk=rodEndWorld(B,k);
  if(Math.abs(pk.x-w[k].x)<0.05&&Math.abs(pk.y-w[k].y)<0.05)return false;   // 已满足 ⇒ 不折腾
  var L=B.len||170,e=rodEndWorld(B,t);
  var dx=e.x-w[k].x,dy=e.y-w[k].y,dd=Math.hypot(dx,dy);
  if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
  var nx=w[k].x+dx/dd*L,ny=w[k].y+dy/dd*L;      // 自由端投到「以锚点为心、半径 L」的圆上
  rodPlaceEnds(B, k?nx:w[k].x, k?ny:w[k].y, k?w[k].x:nx, k?w[k].y:ny, false);
  // ---- 铰链的速度投影（PBD 的味道）------------------------------------------------------
  // 只投影位置是不够的：重力每子步给 vy 加一点，而投影又把那份位移吃掉，两者不抵消
  // ⇒ vy 无界增长（数值上能到几万 px/s），一旦解除锚定整根杆就以累积速度弹射出去。
  // 绕定点转动的刚体，其形心速度必须**垂直于 (形心−锚点)**，角速度就是该转动速率：
  //   ω = (r×v)/|r|²，然后 v := ω ẑ×r。径向分量被丢掉，切向（= 摆动）分毫不动。
  if(dt>0&&isFinite(dt)){
    var rx=B.x-w[k].x,ry=B.y-w[k].y,rl2=rx*rx+ry*ry;
    if(rl2>1e-6){
      var om=(rx*(B.vy||0)-ry*(B.vx||0))/rl2;
      B.vx=-om*ry;B.vy=om*rx;B.om=om;
    }
  }
  return true;
}
/* ★★R131-10：杆宿主的全量 XPBD 速度重建（修「越摆越低」的第二半）。
 * 必须在每子步 Matter.Engine.update **之后**调用（子步循环内）——完整子步位移 =
 * rodSyncAnchors 起始快照 → 积分后位置（含约束修正 + 重力积分），快照若在积分前
 * 反推就只剩修正量、等于每子步把速度清零（mfull 第一版实测：摆动变成蠕动）。
 * v = Δx/dt_sub（Matter 口径 ×(1/60)/(1/240)=×4），ω 同理；切向动能完整保留、
 * 与重力功自洽 ⇒ 能量不漏不注。
 * 门控：_xpsFree（两端无活动接触）才重建 —— 接触场景维持 R130d/R111 原样零改动；
 * 睡眠宿主不唤醒（保住「静止冻结」语义）；被抓端不碰（位姿归指针）；
 * 高中圆 ω≡0（_hsV 门）不写 ω。 */
function rodXPBDVel(RODS){
  for(var i=0;i<RODS.length;i++){
    var B=RODS[i];
    if(!B||B.dead||!B._xps)continue;
    var xps=B._xps;B._xps=null;
    if(!B._xpsFree)continue;
    for(var k=0;k<xps.length;k++){
      var h=xps[k][0];
      if(!h||h.dead||!h.mb||h.mb.isSleeping)continue;
      if(grab&&grab.kind==='body'&&grab.obj===h)continue;
      var q=(1/60)/ROD_SUB_DT;
      Matter.Body.setVelocity(h.mb,{x:(h.mb.position.x-xps[k][1])*q,
                                    y:(h.mb.position.y-xps[k][2])*q});
      /* ★ω 重建只对**简单体（parts==1）**开放：复合体（墨迹链）上 Engine 的 angle 积分与
       *  位置相位 setAngle 的口径差会使 Δθ 系统性偏大 ⇒ ω 越写越大（实测 mfull2 墨迹臂
       *  E 8s 冲到 1.1e9；与 R131-9 M4 静置自爬同源）。复合体只重建平动、旋转仍归
       *  原两相位（衰减归「遗留毛病 3」账，不比基线差）。 */
      /* ★★R131-32d（用户：「物体要能绕固定点按力矩光滑旋转」）：**铰接体（_hinged）
       *  的 ω 不参与重建**——否则每子步的 ω=Δθ/dt 覆盖重力力矩增量（实测角度匀速
       *  线性增长、复摆摆动完全消失）。铰接体的旋转动力学归 Matter 积分+rodHingeTorque。 */
      /* ★★R132-9g（用户：「这不应该是跷跷板吗，怎么这个板子长的那一端不往下落？这个的力矩和
       *  边界是不是判定有问题」）：**补上 `_hconOn`（被独立铰链钉住的宿主）**。
       *  为什么：本段是「用位置差分反推 ω」。被铰链钉住的体位置几乎不动 ⇒ Δθ≈0
       *  ⇒ 每子步把 ω 摁回 0 ⇒ 重力力矩永远推不动它（录制实测 5s 只转 0.0085 rad）。
       *  上面 R131-32d 已经为**杆铰接体**（_hinged）做过同一件事，注释原文就是
       *  「否则每子步的 ω=Δθ/dt 覆盖重力力矩增量（实测角度匀速线性增长、复摆摆动完全消失）」
       *  —— 独立铰链是同一个病，当时只是没给它打标记。 */
      if(h.mb.parts.length===1&&!(PHYS_MODE==='high'&&h.wshape==='circle')&&!h._rodLK&&!h._hinged&&!h._hconOn)
        {
          var _om=(h.mb.angle-xps[k][3])*q;
          /* ★R131-44：ω 重建钳位（单位 rad/帧）——重建是"用位移反推速度"，位移里有位置
           *  相位的非物理搬运 ⇒ 不钳会把转动能量也放大注入。 */
          if(_om>0.2)_om=0.2;if(_om<-0.2)_om=-0.2;
          Matter.Body.setAngularVelocity(h.mb,_om);
        }
    }
  }
}
/* ★R105-4（先量后改：_diag_r105b 组 B）：拖动中的轻质杆 = 拖**整个装配体** —— 已锚定的
 * 宿主必须**逐子步**被摆回杆端，不能只在 pointermove 里跟。
 *
 * 实测（_diag_r105b 组 B：方块 80×80@700,600 + 杆一端锚在它顶边，真鼠标抓杆身上提 160px）：
 *   · 拖到高处**停住不动 1.5s** → 杆端与锚点的残差稳在 **231.5px**（方块一路掉到 y=677.7
 *     = 落地，杆留在 y=331.1）；松手后残差回到 0.000 = 用户报的「拖到高处不松手，连接的
 *     物体会自己脱离下落，松手才回弹」。
 *   · 拖动期（指针在动）也不干净，峰值 59px —— 因为宿主的位姿归 Matter：它是在**子步里**
 *     被重力带下去的，而 pointermove 只在事件到达时补一次位移。指针不动 ⇒ 一个事件都没有。
 *
 * 所以位置驱动的落点必须在**子步的求解之后**（stepMatter 的 240Hz 循环里），而不是事件里。
 * 语义上是 R100①「已锚定的端由宿主位姿决定」的镜像：**拖拽期反过来，宿主归杆端**（拖拽端
 * 在约束里永远是权威，与 R93①③ / conSide 同一条纪律）。位移精确等于残差 ⇒ 本子步结束时
 * 残差恒 0，不是「慢慢收敛」；同时清掉宿主速度 ⇒ 不会攒下「松手后突然弹飞」的动能。
 * 另一端是**铁砧**（static / 右键固定）时跳过 —— 那种情形宿主动不了，不归这里管。
 * 只对「杆正在被指针抓着」调用（见 stepMatter 子步循环与 pointermove 的 T 分支），
 * 其余时刻宿主位姿照旧由 rodSyncAnchors 决定，两条路径互为逆运算、松手那一刻无缝。 */
/* relax：把可动宿主的搬运量按这个比例**打折**（默认 1 = 原语义：一次搬到位）。
 * ★R131-61：多杆链里同一宿主被两根杆同时约束时，两根杆的"一次搬到位"硬投影会**互相破坏**
 *  （实测：chain 调一遍 ⇒ 杆1 残差 0 / 杆2 6.57，再调杆1 ⇒ 又变成 6.57 / 0 —— 来回振荡，
 *   迭代 20 遍也不收敛）。带松弛的交替投影才会收敛到两约束的折中（可行时即交集）。 */
/* ★★R131-63g（用户：「物体a通过杆连接墙，然后再通过杆2连接物体a，拖动杆2，会导致杆1
 *  变长或者脱钩，绳子也是如此」—— **混合链的最后一环**）：
 *  杆链那条（`rodDragPinChain`）管的是"链上其它杆"，但**被拖的杆自己**仍由
 *  `rodDragPinHosts` 的 pass2「把宿主搬到杆端」定位 ⇒ 被拖侧跑多远，就把它那端的宿主
 *  拖多远。只在**另一端也被别的元件锁住**时才会出事：
 *      墙W(铁砧) —绳1— A —杆2— B        拖杆2
 *  绳1 把 A 锁在半径 170 的圆内（`conPull` 每帧把 A 拉回，实测 A 恒 400 ⇒ 绳1 恒 170，
 *  见 `_diag_r240`/`_diag_r241`），而指针把杆2 拖出可达域 ⇒ pass2 把 B 搬到 618
 *  ⇒ **杆2 自己被拉长到 218px（标称 170）**、端残差恒 48px（=`CON_DRAG_STEP`，绳的每帧
 *  限步值）—— 正是用户看到的"杆变长/脱钩"。
 *  ⇒ 语义与绳/杆已确立的纪律一致：**够不着 ⇒ 拖不动，但不分离**。
 *    对杆而言"拖不动"的唯一几何实现 = **绕另一端旋转**（就是 pass1 的静态端语义）：
 *    锚点在 A 上、自由端落在半径 len 的圆上 ⇒ 自由端最多到 `A锚点 + len`，指针再远也拖不动。
 *  ⇒ 判据：**宿主被别的元件用铁砧锁住**（那条元件的另一端是 `hostIsAnvil`）时，这一端对
 *    该杆而言就当"铁砧"。
 *  ⚠ **绳只有绷直才算锁**：绳松弛时 `conPull` 一句都不动（它只在 `over=d-target>0` 时才收），
 *    此时宿主是自由的 —— 若按"有别的元件连着我就算锁"判，会出现「绳明明松着、却把杆
 *    变形成绕宿主旋转」的假约束。杆是刚性杆 ⇒ 恒锁。
 *  ⚠ 只影响**该杆的求解**，**不改全局 `hostIsAnvil`** —— 它被 `conMov` / `ropeSolve` /
 *    `conDragConstrain` 共用，全局放宽会连带改变绳的位移分配口径。
 *  ⚠ `exceptB` = 正在被处理的这根杆自己：不加这条会被自己的另一端锁住（自锁）。
 *  ⚠ 也不能反向用 `hostMovableByConstraint` 判"可动" —— 那会把被临时锁住的宿主算成可动，
 *    循环分配不收敛（R131-63f 实测：绳2 稳定在 918px）。
 *  ⚠ **别加 `!h.anc` 守卫** —— W 体没有 `anc` 字段，而那正是本函数唯一要判的对象
 *    （第一版加了，函数恒返回 false、修复完全没生效，白跑两轮探针）。 */
function springHostPinnedByAnvil(h,exceptB){
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
function rodDragPinHosts(B,relax){
  if(!B||B.kind!=='T'||!B.anc)return false;
  var _rl=(relax==null)?1:(+relax||0);
  var any=false;
  /* ★R106-5（用户清单第 2 项「拖杆脱钩」）：**静态端必须把杆拉回来，而不是放着不管**。
   * 旧实现在静态端 `continue`（「铁砧不动，杆归指针」）—— 语义上对（铁砧确实搬不动），
   * 但它把「杆归指针」理解成「杆端也归指针」⇒ 指针把杆整体带走时，**静态端的杆端直接离开
   * 锚点**。实测（_diag_r106e E2，A 静态铁砧 + B 自由 + 竖杆两端各锚，抓杆中点提升 160px）：
   *   拖动停顿窗**端1 残差 = 160.00px**（静置时 0.00）—— 这正是用户看到的「脱钩」。
   * `rodSyncAnchors` 每帧会把杆端投影回锚点，但它比子步慢一拍，且拖动期与这里的「搬宿主」
   * 互相追打（两个写入者）。
   * 药：静态端改成「**绕锚点转动**」——把杆重新摆成「静态端精确落在锚点上、另一端仍在
   * 半径 len 的圆上」的唯一解（与 rodSyncAnchors 单端分支同一几何），于是拖动期杆端始终
   * 在锚点上，松手也不再回弹。只改**位置**，不动速度（避免与 Matter 积分打架）。
   * ★顺序：先处理静态端（决定杆的位姿），再处理可动端（把宿主搬到杆端）——
   *   反了会被可动端的写入覆盖。 */
  for(var i=0;i<2;i++){
    var a=B.anc[i];if(!a||!a.B)continue;
    var h=a.B;
    if(h.dead||bodies.indexOf(h)<0){B.anc[i]=null;continue;}   // 宿主没了 ⇒ 这一端自动自由
    if(!hostIsAnvil(h)&&!springHostPinnedByAnvil(h,B))continue; // 可动端在下面第二趟处理
    var w=springAnchoredWorld(B,i),q=rodEndWorld(B,i);
    if(!w||!q)continue;
    if(Math.abs(q.x-w.x)<0.05&&Math.abs(q.y-w.y)<0.05)continue; // 已在锚点上 ⇒ 零开销
    // 自由端（另一端）：保持它相对锚点的方向，把距离投到半径 len 的圆上 —— 与
    // rodSyncAnchors 的单端分支逐字同款（那里已验证长度守恒是构造出来的）。
    var o=1-i,e=rodEndWorld(B,o),L=B.len||170;
    var dx=e.x-w.x,dy=e.y-w.y,dd=Math.hypot(dx,dy);
    if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
    var nx=w.x+dx/dd*L,ny=w.y+dy/dd*L;
    rodPlaceEnds(B, i?nx:w.x, i?ny:w.y, i?w.x:nx, i?w.y:ny, false);
    any=true;
  }
  for(var j=0;j<2;j++){
    var a2=B.anc[j];if(!a2||!a2.B)continue;
    var h2=a2.B;
    if(h2.dead||bodies.indexOf(h2)<0)continue;
    if(hostIsAnvil(h2)||springHostPinnedByAnvil(h2,B))continue;  // 铁砧不动（已在第一趟处理）
    var q2=rodEndWorld(B,j),w2=springAnchoredWorld(B,j);
    if(!q2||!w2)continue;
    var dx2=q2.x-w2.x,dy2=q2.y-w2.y;
    if(!dx2&&!dy2)continue;
    h2.x+=dx2*_rl;h2.y+=dy2*_rl;      // ★R131-61：relax<1 时只搬一部分（链解用）
    if(h2.mb&&MW){
      Matter.Body.setPosition(h2.mb,{x:h2.x,y:h2.y});
      Matter.Body.setVelocity(h2.mb,{x:0,y:0});
      Matter.Body.setAngularVelocity(h2.mb,0);
      Matter.Sleeping.set(h2.mb,false);
    }
    any=true;
  }
  return any;
}
/* ★★R131-61：**多杆链的拖动分离**——拖的物体不是杆时，链上**其它杆没人解**。
 *  既有 `rodDragPinHosts(R)` 是**几何精确解**（把杆摆成"锚点正好落在杆端"的唯一解、幂等），
 *  但它的调用点只有一处：`grab.obj.kind==='T'`（**被拖的是杆**的时候）。
 *  于是拖**物体**时：被拖体归指针 ⇒ 与它直接相连的那根杆靠 rodSyncAnchors 的**逐步投影**
 *  去追（每子步修正量有上限 ROD_XPBD_COR_MAX=0.35px）⇒ 追不上 ⇒ **杆端与物体分离**；
 *  链再往外一环（杆—物体—杆）更是完全没有求解者。
 *    实测（_diag_r178，三体两杆链 W1固定—杆1—W2—杆2—W3，拖 W3）：
 *      拖动中 杆1 残差稳定在 **42~52px**（不是瞬态，停住也不收敛）、松手 0.6s 后才回到 0.14px。
 *  修：**从被拖体出发沿杆做 BFS，逐根调用同一个几何解**；只有"被拖体本身"临时当铁砧
 *  （`_dragPin`），中间宿主保持可动 ⇒ 反复扫几遍就是标准的 Gauss-Seidel：
 *  每根杆把自己的另一端宿主搬到"锚点落在杆端"，多根杆交替投影 ⇒ 收敛到两圆的交点（若存在）。
 *  逐子步调用（与 rodDragPinHosts 同一位置、同一理由：指针停住时也必须继续收敛）。
 *  ★只改位置、清宿主速度（沿用 rodDragPinHosts 内部做法），不注入动能。 */
var ROD_CHAIN_ITERS=10;      // 每子步的 Gauss-Seidel 扫几遍
var ROD_CHAIN_RELAX=0.5;
var ROD_CHAIN_MAXLINK=12;    // 链上最多处理多少根杆（防病态数据打环）
/* ★★R131-63：**把杆的姿态立即按当前锚点重算**（只摆姿态：不改宿主、不写 _rodL、不碰速度）。
 *
 * 为什么必须有它 —— `_diag_r179b` 的判定铁证（多杆链拖到 (300,250) 停 1.2s 后）：
 *     r1 两端残差 = [8.935, 8.964]、位移矢量两端**完全相同** = (−1.843, +8.718)
 *     r2 两端残差 = [8.949, 8.950]、位移矢量两端**完全相同** = (+1.843, −8.718)
 *     而 **两锚点距离 = 140.034 / 139.866 ≈ 杆长 140**（GRAV=0 冻结后仍是 8.911，
 *     说明与重力无关，是纯粹的几何求解顺序问题）。
 *   ⇒ 距离约束**早已满足**，缺的只是"把杆自己搬到新位置上"。
 *     两端残差矢量相同 = 纯平移滞后：杆的 `B.x/B.th` 是**姿态缓存**，只在
 *     `rodSyncAnchors` 末尾更新一次；`rodDragPinChain` 在它**之后**跑 ⇒ 杆的姿态
 *     **整整滞后一个子步**。拖拽中每个子步宿主都在动 ⇒ 恒定滞后 8~10px，
 *     正好就是用户看到的"杆与物体分离"。
 *   ★危害不止于"看着分离"：`rodDragPinHosts` 的 pass1 用
 *     `|rodEndWorld(B,i) − springAnchoredWorld(B,i)|` 当残差，姿态一滞后这个残差就
 *     恒非零 ⇒ **pass1 会去"修"一个根本没坏的东西**（绕锚点重摆整根杆）⇒ 与 pass2
 *     的搬宿主互相追打 ⇒ 这正解释了 R131-62 记录里"峰值 8.6px ↔ 64.8px 偶发波动"。
 *     （上一轮把 ①rodSyncAnchors 叠加 ②旋转消化 两味药都试过并撤销，因为它们都在
 *      "解约束"；本味药不碰约束，只补**缓存一致性** —— 这是三轮里唯一对症的。）
 *   ★双端：中心=锚点中点、方向=w1→w0（与 rodSyncAnchors 的姿态段逐字同款）；
 *     单端：绕锚点转动把锚定端摆回锚点（与单端铰链分支同一几何）。
 *   ★md5 无关的确定性：纯位置写入，无随机、无时间依赖。 */
function rodResyncRodPose(B){
  if(!B||B.dead||B.kind!=='T'||!B.anc)return false;
  var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
  if(h0&&(h0.dead||bodies.indexOf(h0)<0))h0=null;
  if(h1&&(h1.dead||bodies.indexOf(h1)<0))h1=null;
  var w0=h0?springAnchoredWorld(B,0):null,w1=h1?springAnchoredWorld(B,1):null;
  if(!w0&&!w1)return false;
  if(w0&&w1){
    var Lr=(B._rodL>0)?B._rodL:(B.len||170);
    if(!(Lr>0))return false;
    B.x=(w0.x+w1.x)/2;B.y=(w0.y+w1.y)/2;
    B.th=(B.th||0)+shortAng(Math.atan2(w0.y-w1.y,w0.x-w1.x)-(B.th||0));
    B.len=Lr;B.hw=Lr/2+2;
  }else{
    var k=w0?0:1,t=1-k,w=w0||w1;
    var L=(B.len>0)?B.len:170,e=rodEndWorld(B,t);
    var dx=e.x-w.x,dy=e.y-w.y,dd=Math.hypot(dx,dy);
    if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
    rodPlaceEnds(B,k?w.x+dx/dd*L:w.x,k?w.y+dy/dd*L:w.y,
                   k?w.x:w.x+dx/dd*L,k?w.y:w.y+dy/dd*L,false);
  }
  /* ★R131-21 后杆已无 Matter 镜像板（B.mb 恒 null），姿态只活在 B.x/B.y/B.th 三个产品字段里
   *  —— 所以这里**不需要**再同步 Matter（若将来镜像板复活，这里要补 setPosition/setAngle）。 */
  if(MW&&B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
  return true;
}
function rodDragPinChain(seed){
  if(!seed||seed.dead)return false;
  if(!grab||grab.kind!=='body'||!grab.obj)return false;
  var rods=[],i;
  for(i=0;i<bodies.length;i++){
    var R=bodies[i];
    if(!R||R.dead||R.kind!=='T'||!R.anc)continue;
    if(grab.obj===R)continue;                       // 被拖的就是这根杆 ⇒ 上面那条通道已经解过
    if(!R.anc[0]&&!R.anc[1])continue;
    rods.push(R);
  }
  if(!rods.length)return false;
  /* ★★R131-63e（用户：「物体a通过杆连接墙，然后再通过杆2连接物体a，拖动杆2，会导致
   *  杆1变长或者脱钩，绳子也是如此」——**杆链的传播图错了**）：
   *  旧 BFS 只在 `r.anc[k].B === h`（h 从 seed 出发、且只沿「某根杆的另一端宿主」推进）时
   *  才把 r 收进链、才把 o 入队。用户原话那条拓扑里 **杆1 与杆2 不互相锚定**，
   *  它们只是**共享宿主 A**（产品语义：杆-杆不互锚，R131-26 / rodTryAnchor 的
   *  `if(h.kind==='T')continue`）：
   *      杆1.anc = [墙W, A]      杆2.anc = [A, B]      被拖的是杆2
   *  ⇒ 从 seed=杆2 出发：杆1.anc[0].B=W≠杆2、杆1.anc[1].B=A≠杆2 ⇒ `continue`
   *  ⇒ **杆1 一步都走不进去，整个链解对它是空转**。
   *  实测（_diag_r236，拖杆2 慢 60 帧后按住不动）逐子步：
   *      rodSyncAnchors(杆1)  A 550.000→547.555（想收，每子步 2.7px = 6×0.45 R131-44 上限）
   *      rodDragPinHosts(杆2) A 547.555→550.000（精确搬回，无上限）
   *      ⇒ 每子步**净位移 0**、A 被卡死、杆1 两端锚距恒 **353.412px（杆长 170 的 2.08 倍）**、
   *        端残差 **91.7px** —— 正是用户看到的「杆1 变长/脱钩」。
   *  修：链的传播图改成**经过宿主**——把 seed 的宿主也当作 BFS 的起点，
   *  于是「共享宿主的另一根杆」会被收进链（杆1 的 A 端命中 ⇒ 另一端 W 入队 ⇒ 链条成立）。 */
  var pullSet=[seed];                               // 「被拖侧」集合 = {被拖体} ∪ {被拖体的宿主}
  if(seed.anc)for(i=0;i<2;i++){
    var sa=seed.anc[i];
    if(sa&&sa.B&&!sa.B.dead&&bodies.indexOf(sa.B)>=0&&pullSet.indexOf(sa.B)<0)pullSet.push(sa.B);
  }
  var any=false;
  seed._dragPin=true;
  try{
    for(var it=0;it<ROD_CHAIN_ITERS;it++){
      var seen=[seed],q=[seed],guard=0;
      for(i=0;i<pullSet.length;i++){                // ★宿主入队（链的第一环）
        if(seen.indexOf(pullSet[i])<0){seen.push(pullSet[i]);q.push(pullSet[i]);}
      }
      while(q.length&&guard++<ROD_CHAIN_MAXLINK){
        var h=q.shift();
        for(i=0;i<rods.length;i++){
          var r=rods[i];
          if(r.dead)continue;
          var a0=r.anc[0],a1=r.anc[1],o=null;
          if(a0&&a0.B===h)o=(a1&&a1.B)?a1.B:null;
          else if(a1&&a1.B===h)o=(a0&&a0.B)?a0.B:null;
          else continue;
          /* ★★R131-62b：**链解只用一个求解器** —— rodSyncAnchors（PBD，同时调两端宿主的
           *  **位置 + 角度**）。原先是 `rodDragPinHosts`（只平移）+ `rodSyncAnchors` 两路叠加，
           *  而前者每轮都重新摆杆、把后者刚解好的姿态又破坏掉 —— 项目里反复出现过的
           *  "两个写入者互相追打"（实测：连调 6 遍到达不动点仍残 2.04/4.09，按住时以 ~10px/s 漂）。
           *  rodSyncAnchors 自带每子步 0.35px 的修正上限，靠 chain 的多轮迭代放大总修正能力。 */
          /* ★R131-62b 结论：**不要再叠加 rodSyncAnchors** —— 实测（_diag_r178）只用它时
           *  稳态反而从 9.5px 掉到 25.5px（它的每子步 0.35px 修正上限太小，且会搬动被拖体）。
           *  两路叠加又会互相追打 ⇒ 链解**只留几何精确解** rodDragPinHosts，
           *  再加上下面"被拖体参与位移分配"的几何反馈（够不着时把 seed 拉回可达域）。 */
          /* ★★R131-63（**本轮的病根**）：**先**把杆自己的姿态按当前锚点重算，**再**解约束。
           *  rodDragPinHosts 的 pass1 拿 `|rodEndWorld(B,i) − springAnchoredWorld(B,i)|` 当残差，
           *  而 B.x/B.th 是**上一个子步的陈旧缓存**（只在 rodSyncAnchors 末尾更新一次，
           *  而链解跑在它之后）⇒ 残差输入本身是假的：
           *    · 实测（_diag_r179b，多杆链拖到 (300,250) 停 1.2s / GRAV=0 冻结）：
           *      两端残差矢量**完全相同**（r1 = (−1.843,+8.718)、r2 = (+1.843,−8.718)）
           *      而两锚点距离 140.034 / 139.866 ≈ 杆长 140 ⇒ 距离约束**早已满足**，
           *      差的只是"把杆搬到新位置" ⇒ 纯平移滞后 8.9px，冻结重力后不变。
           *    · 后果不止"看着分离"：pass1 拿滞后残差当判据 ⇒ 会去"修"一个没坏的东西
           *      （绕锚点重摆整根杆）⇒ 与 pass2 的搬宿主互相追打 ⇒ 正是 R131-62 记录的
           *      「峰值 8.6 ↔ 64.8px 偶发波动」。
           *    · 本味药**不解约束**（前两轮 ①叠加 rodSyncAnchors ②旋转消化 都已撤销）——
           *      只补**缓存一致性**：把 rodSyncAnchors 末尾那段"姿态重算"提到链内。
           *  顺序必须在解约束**之前**（残差输入必须新鲜），一次即可（后面每轮 BFS 会再进来）。 */
          rodResyncRodPose(r);
          if(rodDragPinHosts(r,ROD_CHAIN_RELAX))any=true;
          /* ★R131-62c（**已撤销，留作墓碑**）：曾在这里加旋转消化（把残差的切向分量用
           *  宿主的一个小转动吃掉，绕质心转 => 不动质心）。它把 B 组（超链长）压到 0.1px，
           *  但**引入了不稳定**：同一份代码连跑两次，B 组分别给出 0.10px 与 120.0px
           *  （按住不动时突然崩开），A 组反而从 11.6 涨到 24~25px => 弊大于利，撤销。
           *  结论：链解里**不要在产品自管位姿的 W 体上写角度**（与 R130c「W 体位姿归产品、
           *  Matter 约束不可用」是同一条边界）。A 组的残余另开一路（待下一轮）。 */
          if(o&&!o.dead&&bodies.indexOf(o)>=0&&seen.indexOf(o)<0){seen.push(o);q.push(o);}
        }
      }
      /* ★★R131-62（用户：「多杆连接物体时拖动分离还是没有解决」）：
       *  上一版把**残差留在杆端** ⇒ 看起来就是"杆与物体分开"。
       *  而绳那边早就验过正确语义：约束够不着时**被拖的那一端也参与位移分配**
       *  （`conPull` 的 allowGrab，见 springSyncEnds 注释）⇒ 拖不动，但**不分离**
       *  （_diag_r176 实测：绳超长时被拽住 124px、端距始终=绳长）。
       *  这里对杆链补上同一味药：每轮扫完链之后，若**被拖体那端**仍有残差
       *  Δ = 杆端 − 锚点（锚点在被拖体上 ⇒ 把被拖体移动 Δ，残差就归零），
       *  就把被拖体往回搬 Δ×relax —— 于是：
       *    · 几何可达 ⇒ 残差本来就收敛到 0 ⇒ 一句都不动 ⇒ **完全跟手**（不损失手感）；
       *    · 几何不可达 / 只平移不旋转造成的折中残差 ⇒ 被拖体被链拉住（"拖不动"）⇒ **不分离**。
       *  与 pointermove 的关系：pointermove 按绝对指针写位置，chain 按约束往回拉；
       *  两者拉锯的稳定解就是"物体停在可达边界上"——正是绳的行为。 */
      for(i=0;i<rods.length;i++){
        var rs=rods[i];
        if(rs.dead)continue;
        /* ★★R131-63e：判据从「哪一端锚的是 seed」放宽成「哪一端锚在**被拖侧**」。
         *  被拖侧 = seed 自己（原有的 rodDragPinChain 语义）**或 seed 的宿主**
         *  （用户原话拓扑里被拖的是杆2 ⇒ 被拖侧 = {杆2, A, B}，杆1 的 A 端就在这个集合里）。
         *  用「锚点」而不是「杆端残差」当反馈量的理由见下（rodDragPinHosts 会把锚点端
         *  精确摆到锚点上 ⇒ 残差恒 0 ⇒ 触发不了）。 */
        var b0=rs.anc[0],b1=rs.anc[1];
        var i0=(b0&&b0.B&&pullSet.indexOf(b0.B)>=0)?0:-1;
        var i1=(b1&&b1.B&&pullSet.indexOf(b1.B)>=0)?1:-1;
        /* 两端都在被拖侧（例如杆1 的墙端在 fixed 墙上时不可能；但两端同属被拖侧时
         *  该杆对「拖不动」没有任何发言权）⇒ 跳过。 */
        if(i0>=0&&i1>=0)continue;
        var si=(i0>=0)?0:((i1>=0)?1:-1);
        if(si<0)continue;
        /* ★判据必须是**纯几何**的（两端锚点距离 vs 杆长），不能看"杆端残差"：
         *  rodDragPinHosts 的 pass1 会把铁砧端（含 seed，因为 _dragPin）**精确摆到锚点上**
         *  ⇒ seed 那一端的残差恒为 0 ⇒ 用残差当反馈量永远触发不了（实测加了没变化）。 */
        var wsA=springAnchoredWorld(rs,si),wsB=springAnchoredWorld(rs,1-si);
        if(!wsA||!wsB)continue;
        var vx=wsB.x-wsA.x,vy=wsB.y-wsA.y,dAB=Math.hypot(vx,vy);
        var over=dAB-(rs.len||170);
        /* ★双向：over>0 = 拉太开（把 seed 拉回来）；over<0 = 链被压扁 ⇒ 把 seed **推远**
         *  到"锚距 = 杆长"（A 组可达范围内的残余就是这种：链折叠、两圆不相交）。
         *  两端都是"距离必须 = 杆长"（刚性杆，不是绳）⇒ 双向都要收。 */
        /* ★★R131-63e（用户原话：「拖动杆2，会导致杆1变长或者脱钩」）：
         *  旧版把整份 over 都堆到 seed 上，但 **seed 正被指针拖** ——
         *  stepMatter 子步循环里 rodDragPinHosts 每子步把 seed 精确摆到
         *  锦钉位置（无上限），把本次修正**整份冲掉** ⇒ 改了等于没改。
         *  （实测 _diag_r236：未改时 1 帧内 rodSyncAnchors 收 2.700px /
         *   rodDragPinHosts 打回 2.700px，四对全抵消、净位移 0；
         *   d 恒定 353.412px（杆长 170）。）
         *  正确语义与 ropeSolve/conPull 的 allowGrab 逐字同款：
         *  多余量应当由**可动的一侧**吸收，而“被住在挧”的那侧（steel定在指针下）
         *  只能“拖不动”，不能被弹开。⇒ over 应当施加在
         *  **被拖测序列的远端**（即 seed 的另一端宿主，如 B）而不是 seed 自己。
         *  若那一端也不可抬（如坐在固定墙上），才退回原行为（弹 seed）。 */
        if(Math.abs(over)<=0.5)continue;   // 已经等于杆长 ⇒ 一句都不动（保住跟手）
        if(dAB<1e-6)continue;
        var _mvx=vx/dAB*over*ROD_CHAIN_RELAX, _mvy=vy/dAB*over*ROD_CHAIN_RELAX;
        /* 被拖测的远端：从 pullSet 里找“不是指针拖的那个”——
         *  优先选**未被拖的 seed 宿主**（B）；那一边含 0.5*over，带来的是“拉不动”而不是脱钩。 */
        var far=null,k2;
        for(k2=0;k2<pullSet.length;k2++){
          var c2=pullSet[k2];
          if(!c2||c2===seed||c2.dead)continue;
          if(hostIsAnvil(c2))continue;
          if(hostMovableByConstraint(c2)){far=c2;break;}
          if(!far&&c2.mb&&!c2.mb.isStatic)far=c2;
        }
        if(far){
          far.x+=_mvx;far.y+=_mvy;
          if(far.mb&&MW){
            Matter.Body.setPosition(far.mb,{x:far.x,y:far.y});
            Matter.Body.setVelocity(far.mb,{x:0,y:0});
            Matter.Body.setAngularVelocity(far.mb,0);
            Matter.Sleeping.set(far.mb,false);
          }
        }else{
          seed.x+=_mvx;seed.y+=_mvy;     // 远端也挪不动 ⇒ 退回旧行为
          if(seed.mb&&MW)Matter.Body.setPosition(seed.mb,{x:seed.x,y:seed.y});
        }
        any=true;
      }
    }
  }finally{ seed._dragPin=false; }   // ★标志必须在任何出口都清掉（否则这个体以后永远当铁砧）
  return any;
}
/* ★R106-2：拖拽中的 S 族（弹簧 / 轻绳 / 光滑铰链）= 拖**整个装配体**，且必须**逐子步**摆。
 * 与 rodDragPinHosts **同一个病**：pointermove 里那句 `if(sdx||sdy)springMoveRig(B,sdx,sdy)`
 * 是**增量式**的（搬的是「自上次 pointermove 以来指针挪了多少」）⇒ 指针一停 ⇒ 一个
 * pointermove 都没有 ⇒ 一次都不搬 ⇒ 装配体的位姿归 Matter ⇒ 重力把整体带走。
 *   实测（_diag_r106a G3/G4：自由方块 + 绳/铰链一端锚在它上面，真鼠标抓中点提升后**停住 2s**）：
 *   被抓住的那一点相对指针漂移 **199.36px(绳) / 126.83px(铰链)**，方块从 532.76 落回 677.69
 *   —— 正是用户原话「鼠标一旦停止运动，绳子和物体的整体就会往下掉，哪怕鼠标不松也没用」。
 *   而 R105-4 只给 **杆**（kind 'T'）打了这味药，S 族这条通道漏了 —— 同一 bug 第三次。
 * 药同形：**逐子步把「被抓住的那一点」精确摆回（等效）指针** —— 用按下时记的**本地**偏移
 * （glx/gly，R66：物体转动后抓的始终是同一块材料）还原该材料点的世界坐标，把残差整份交给
 * springMoveRig（它搬弹簧两端 + 所有非铁砧宿主，并清掉宿主速度 ⇒ 不攒「松手弹飞」的动能）。
 * ★只改 springMoveRig 的**入参语义**（从「事件增量」改成「当前残差」），不动它本身；
 *   增量那一路保留（它让拖动更跟手），两条路都收敛到「材料点在指针下」。 */
function springDragPinRig(B){
  if(!B||B.dead||B.kind!=='S')return false;
  if(!grab||grab.kind!=='body'||grab.obj!==B)return false;
  var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
  var glx=(grab.glx!=null)?grab.glx:(grab.gx||0);
  var gly=(grab.gly!=null)?grab.gly:(grab.gy||0);
  var wx=B.x+glx*c-gly*s,wy=B.y+glx*s+gly*c;         // 被抓材料点的世界坐标
  var ep=(typeof dragPtrAxis==='function')?dragPtrAxis():null;   // R94：与 W/T 同口径
  var tx=(ep&&ep.x!=null)?ep.x:pointer.x,ty=(ep&&ep.y!=null)?ep.y:pointer.y;
  var dx=tx-wx,dy=ty-wy;
  if(!dx&&!dy)return false;
  springMoveRig(B,dx,dy);
  return true;
}
// 拖杆松手 → 两端各自的 ROD_PAD 内若压着别的物体就拴上（判定点 = 两个端点本身，
// 与 springTryAnchor 同一规格②：线圈/杆身中段压到什么都不算，那只是支撑不是锚）。
function rodTryAnchor(B){
  if(!B||B.kind!=='T'||B.dead||!B.anc)return;
  for(var i=0;i<2;i++){
    if(B.anc[i])continue;                        // 已拴住的保持原样（不抢不换）
    var e=rodEndWorld(B,i),bd=ROD_SNAP,hit=null;
    for(var j=0;j<bodies.length;j++){
      var h=bodies[j];
      if(h===B||h.dead)continue;
      if(grab.kind==='body'&&grab.obj===h)continue;   // 正在被拖的东西不算「固定物」
      // ★R103-6（_tmp_trace4 实测）：杆端不许锚到**铰链器件**上 —— 铰链是连接件不是
      //   刚体，而且实测里该铰链正拴着这根杆自己（hAnc0='R'）⇒ 杆端锚它 = 成环
      //   （杆→铰链→杆），过约束照样发生（hit 先于 C 命中 H，hin3 守卫拦的是 C 拦不到它）。
      if(h.kind==='S'&&h.hinge)continue;
      // ★R103-6：第三入口同款守卫（springTryAnchor / springTryAnchorByHost 已有）——
      //   本端已通过铰链连着候选宿主 ⇒ 不许再直接锚（铰链+直锚 = 过约束互推爬行）。
      //   拖杆松手时自由端正贴着铰链另一端的宿主，没有这条守卫必中。
      var hin3=false;
      for(var hq=0;hq<bodies.length;hq++){
        var H3=bodies[hq];
        if(H3===B||H3.dead||H3.kind!=='S'||!H3.hinge||!H3.anc)continue;
        var t0=H3.anc[0],t1=H3.anc[1];
        if(t0&&t1&&((t0.B===B&&t1.B===h)||(t0.B===h&&t1.B===B))){hin3=true;break;}
      }
      if(hin3)continue;
      /* ★R131-26（用户：「两个杆直接连接还是会卡顿，干脆两个杆之间不能互相连接」）：
       *  候选宿主是杆 ⇒ 跳过（杆-杆不建立锚定关系）。 */
      if(h.kind==='T')continue;
      var dd=distToHost(h,e.x,e.y);
      if(dd<bd){bd=dd;hit=h;}
      /* ★★R131-28（用户：「杆的一端伸到物体的中心，没有任何吸附」）：板删除后杆端
       *  能**插进物体内部**，而表面判定（distToHost<15）在内部永远不命中 ⇒ 深插无反应。
       *  修：端点进入物体内（dc<半径/半宽）⇒ 也视为命中——深插到质心带 ⇒ 锚质心，
       *  浅插 ⇒ 锚最近表面点（springAnchorOffset 分流）。 */
      var _dcin=Math.hypot(e.x-h.x,e.y-h.y);
      /* ★R131-28b：内部判定用**最小半轴**——用 max 的话细长条（横墙 hw=100/hh=12）
       *  会把旁边 80px 的虚空都判成「内部」（用户 REC 04-51-59：杆被固定在墙下虚空）。
       *  min 半轴 = 真正的板内。 */
      var _rin=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
      var _din=_dcin-_rin;                       // <0 = 端点在物体内部
      if(_din<0&&bd>_din){bd=_din;hit=h;}
    }
    if(!hit)continue;
    // 先把端点吸到宿主表面再记偏移（顺序不能反：偏移必须按**吸附后**的端点算，否则第一帧被拉回）。
    // ★R106-3（用户：「杆的物体表面中点吸附功能怎么没了……拖过去时没有吸附的效果」）：
    //   这里原来只走 hostClosestPoint ⇒ 松手落到**离端点最近的表面点**，而弹簧那条路走的是
    //   `hostMidSnapPoint||hostClosestPoint` ⇒ 只有弹簧会吸到中点。实测（_diag_r106c 改前基线）：
    //   端点停在 (706,520)、离下边中点 (700,520) 仅 6px，松手后锚点却是 **(706,520)** —— 没吸。
    //   与弹簧那条路**逐字同款**（中点够不着 / 不是方框宿主 ⇒ 一字不动地退回最近表面点）。
    // R100①：下面**必须**走 rodPlaceEnds（索引序）—— 参数本来就是按编号写的（index i = q、
    // index 1-i = o），直接喂 setRodEnds 会把它们塞进反的槽位 ⇒ 锚点记到另一头（见 rodPlaceEnds 注释）。
    /* ★★R131-28：**端点在物体内部时不收表面**——杆端插进物体内部（dc<半径）说明
     *  用户在往里插（目标=质心），先收到表面会把端点拉出来 ⇒ 质心判定永远轮不到
     *  （_diag_r131v 实测 ox=-23.1：插到球心却被锚成表面材料点）。保留内部位置，
     *  让 springAnchorOffset 的质心带判定（dc≤0.7rad）接手。 */
    var _dcIn=Math.hypot(e.x-hit.x,e.y-hit.y);
    var _rIn=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);   // ★R131-28b：min 半轴
    /* ★R131-39 已回退：内部浅插「收到最近表面点」的实现引入了 JS 异常
     *  （Cannot read properties of undefined (reading 'x')，r104 I/Z 红）⇒ 暂不启用，
     *  内部落点仍交给 springAnchorOffset 分流（质心带内=质心，带外=表面最近点）。 */
    if(_dcIn<_rIn){
      B.anc[i]={B:hit};springAnchorOffset(B,i);
    }else{
    /* ★R131-54：回退——杆恢复「角 > 边中点 > 表面点」 */
    var q=hostCornerSnapPoint(hit,e.x,e.y)||hostMidSnapPoint(hit,e.x,e.y)||hostClosestPoint(hit,e.x,e.y),o=rodEndWorld(B,1-i);
    if(q){rodPlaceEnds(B, i?o.x:q.x, i?o.y:q.y, i?q.x:o.x, i?q.y:o.y, true);
      B._rodL=B.len;}                 // ★R107-1：吸附挪了端点 = 有意改长度
    B.anc[i]={B:hit};springAnchorOffset(B,i);
    }
  }
}
function springAnchoredWorld(B,i){
  var a=B.anc[i];
  if(!a||!a.B)return null;
  var h=a.B;
  if(a._noRot&&B.kind!=='T')return {x:h.x+a.ox,y:h.y+a.oy};  // 高中：只跟平动（R77 用户④）；★R130d 杆例外：两模式都随宿主转（用户拍板）
  var c=Math.cos(h.th||0),s=Math.sin(h.th||0);
  return {x:h.x+a.ox*c-a.oy*s,y:h.y+a.ox*s+a.oy*c};
}
function springSyncEnds(B){
  for(var i=0;i<2;i++){
    var a=B.anc[i];
    if(!a)continue;
    // 宿主没了（被删除/被黑洞吃掉）-> 锚自动失效，那一端就地变成自由端
    if(!a.B||a.B.dead||bodies.indexOf(a.B)<0){B.anc[i]=null;continue;}
    var p=springAnchoredWorld(B,i);
    springSetEnd(B,i,p.x,p.y);
  }
  /* ★★R106-8（用户：「铰链就硬是要扯出条线来」，本轮确认那根是**光滑铰链**）：
   *   光滑铰链的 len 恒为 0 —— 它的语义是**一个销钉**（一个点），两端天生必须重合。
   *   半连接（只锚住一端）时，未锚端若留在原地，宿主一转动就会与已锚端分开：
   *   已锚端 = A.x + R(A.th)·offset（沿**弧线**走），未锚端只被 _freeTk 补了**质心平移**
   *   ⇒ d = r·Δθ。实测（_diag_r106h.py）：销放在 100×100 方框的左上角时，静置就分开
   *   **50.05px**（已锚端被吸到上边中点 (700,297.7)、未锚端留在 (650,300)），
   *   方框转 35rad 后涨到 **96.21px** —— drawHinge 的 !bothAnc 分支把这段距离画成一条臂，
   *   正是用户看到的那条「从物体上扯出来的线」。
   *   修法：未锚端**跟随已锚端**。这不是新规则，就是「销是一个点」的定义；而且它让
   *   「松手去连第二个物体」仍然可用（未锚端就停在销上，第二端在 SPR_PAD 内照样能锚上，
   *   不会重演 R71③ 那次「自由端被钉死 ⇒ 第二端永远拴不上」的坑）。
   *   放在这个咽喉里 ⇒ 全部 11 个调用点（stepSprings / hingeSolve / 拖拽 / 触底块…）同时生效。 */
  if(B.hinge&&(B.anc[0]||B.anc[1])&&!(B.anc[0]&&B.anc[1])){
    var k=B.anc[0]?0:1;                       // k = 已锚的那一端
    var src=(k===0)?B.e0:B.e1,dst=(k===0)?B.e1:B.e0;
    dst.x=src.x;dst.y=src.y;
  }
  /* ★★R109：**铰链一旦不再是「双端都锚上」，真 Constraint 就必须摘掉**。
   *   放在这个咽喉里（而不是 hingeSolve 里）：宿主被删时 `anc[i]` 就在**这里**被清成 null，
   *   而 `hingeSolve` 第一行就 return 了、根本跑不到摘除点 ⇒ 那条约束会留在世界里
   *   把两个体**隐形地永久钉住**（_diag_r109 H2 实测：删宿主后约束数 1 → 1，该 1 → 0）。 */
  if(B.hinge&&!(B.anc[0]&&B.anc[1])&&typeof hingeConstraintDrop==='function')hingeConstraintDrop(B);
  refreshSpringGeom(B);
}
// R64 方向锁的「导向力」：真实锚点相对导轨的偏移是**纯垂直**的（投影保留轴向坐标），
// 把它当成一根横向小弹簧（同一根 ks + 阻尼）拉回导轨 —— 相当于「弹簧装在导轨上」的滑块约束。
// 走 springForceOn（作用点 = 真实锚点）：R63 的水平/竖直限幅与力矩上限自动生效，不会掀翻宿主。
// 必须放在 stepSprings（有 dt）而不是 springSyncEnds（它被拖拽/复制等无 dt 的路径调用）。
function springGuideForce(B,dt){
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
    // R88⑤：力上限与宿主加速度上限同样要随 ks 走 —— 导轨导向力与原弹簧共用同一根 ks/阻尼，
    // 沿用写死的 24000 会让「方向锁 + 硬弹簧」这一组合悄悄退化成恒力约束。
    var keff=springKEff(B.ks)*springKShare(a.B);
    var fmax=springFMax(keff);
    var f=clamp(-keff*off-springDamp(B,a.B,null)*v,-fmax,fmax);
    if(f)springForceOn(a.B,f*nx,f*ny,dt,p.x,p.y,keff);
  }
}
// R94（用户：「一个悬空会导致悬空物体在**垂直于弹簧的方向**不停抖动，带动另一个物体在地上
//   穿模」）：**「被支撑」判定** —— 主机是否压在**不可动的东西**上（地面 / 墙 / 右键固定过的体）。
// 为什么必须有它（诊断实测 _diag_r94f_rail.py）：R93 起 springRailFollow 每帧把可动宿主的锚点
//   **绝对搬到**导轨上（setPosition）。参考取「两端平均」时，落不了地的那一端会把支撑端一起
//   拖向自己 ⇒ 支撑端每帧被按进地面、接触又把它顶回来：实测**每帧 1.19px 的往返改正**、
//   y 振幅恒为 0.00（改正被接触抵掉 ⇒ 永不收敛）—— 画面上就是「一直抖动 + 穿模」，
//   而 yB 同样每帧被搬 1.17px（自由落体被逐帧抹掉）也不收敛。
// 判据的物理根据：支撑面（地面）与「静止/固定体」是同一种东西 —— **外部位移源**。所以它必须
//   和 R93 纪律①里的 static/fixed 同等对待：当**导轨的参考**（导轨钉在它身上）。这正是用户要的
//   语义：「垂直方向上相对于连接点是刚体」—— 悬空那块只能沿轴动，支撑那块一动不动。
//   ★「一动不动」是靠**钉参考**实现的，不是靠「跳过它别搬」：导轨焊在它身上后，它自己对导轨的
//     偏移恒为 0 ⇒ 校正量 0 ⇒ 永远不会被搬。反过来若改成「把它排除在对齐之外」（R94 第一版
//     还写了这条冻结分支），R66 的「拖任一只都把整体抬起来」就废了 ⇒ `_verify_r66.py` 组3 红。
//   ★适用面也收窄到**恰好一端被支撑**时才钉（两端都压地时各自偏移相等、取平均本来就是 0 校正），
//     并且优先级低于「被拖端」（R66「拖哪里都一样」）；拖拽侧的轴向锁 dragAxisLock **不用它**
//     （那里只认真固定，否则两只压地的球组成的弹簧永远抬不起来）。
// 判据刻意保守（两条都要满足，否则落地瞬间的冲击会把整个装配体误判成「有支撑」而锁死）：
//   ① 有**活动接触**且对方 isStatic（地面/墙/固定体，含复合体的 parts）；
//   ② 自身几乎没在动（真值 ≤ 45px/s ⇒ prop ≤ 0.75，见 MU-01：velocity 是「每 1/60s」）。
function railHostSupported(h){
  if(!h||!h.mb||h.mb.isStatic||h.fixed)return false;
  if(!MW||!MW.engine)return false;
  var v=h.mb.velocity||{x:0,y:0};
  if(Math.hypot(v.x,v.y)*60>45)return false;
  var mb=h.mb;
  // ① 包围盒贴地/贴墙（3px 容差）。**必须有这条**：Matter 的接触判定要求包围盒真的相交，
  //    而接触求解允许物体停在离地面 2~3px 处（实测 _diag_r94f_rail.py 的静止位就在 −2.31px）
  //    —— 只查 pairs 的话，这种「看着压在地上」的物体会被漏判，判据会在帧间忽真忽假（= 抖）。
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
  /* ★★R131-64：天花板也是一面墙 ⇒ 能当「支撑面」（同左右墙口径）。见 ensureMatter 的 wt。 */
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
// R65（用户：「固定方向后，拖动其他物体……如果在其他垂直方向运动，弹簧和那个组成的整体
// 在与固定方向垂直的方向一起动作为一个整体」）：**导轨跟随**。方向锁只锁「方向」，不锁位置
// —— 锚点往垂直方向挪时，导轨跟着平移过去。轴向坐标不受垂直平移影响（投影只清垂直分量），
// 弹簧长度/弹力通道完全无感，于是「弹簧+物体」在垂直方向上像一个整体一样平移。
// 参考点选取（按优先级）：
//   ① 有 static/fixed 的锚 -> 导轨**钉死**在该锚上（一端拴墙就拴死，旧语义不变）；
//   ② 某锚的宿主**正被鼠标拖动** -> 导轨完全跟随该锚（用户的原话场景：拖一个物体，弹簧
//      和它像焊死一样一起走；取平均会让弹簧只跟一半，看起来还是「拖不动」）；
//   ③ 否则取所有锚的垂直偏移**平均值** —— 两端偏移的差值（剪切）仍由 springGuideForce
//      拉回，整体平移自由、相对剪切受限。
// 必须放在 stepSprings（springSyncEnds 之后、springGuideForce 之前）：先同步锚点真实位置，
// 再搬导轨、重投影，残余剪切才轮到导向力收拾。
//
// R95（用户：「那个悬空抖动还是没有解决，改一个东西吧，高中模式下，如果弹簧是水平的，则两端的
//   连接点可以变动，保证两个物体与地面接触」）：**高中 + 水平导轨 ⇒ 放松法向刚性**。
// 语义：这条导轨不再对宿主行使任何位移/速度权，只把**导轨自己**摆到两端锚点的平均高度上，
//   端点照旧由 refreshSpringGeom 投影到导轨 ⇒ 弹簧恒水平、两个连接点沿各自宿主侧面上下滑动，
//   而两个物体各自服从重力与接触。**唯一动作就是「导轨跟着锚点走」，宿主一律不动。**
// 为什么必须有它（R94 的钉参考只治标）：水平导轨的法向正是**重力方向**，把宿主「搬」到导轨上
//   等于拿一根竖直的无形刚杆把物体吊在半空 —— 它永远落不了地；接触又把它顶回来，于是
//   「悬空端一直抖 + 压地端被按进地面（穿模）」。用户 R94 的原话「我不是说了高中模式下弹簧垂直
//   方向上相对于连接点是刚体吗，怎么会抖动呢」里那把「刚性」= 位置被每帧改正、速度没被清零
//   （改成清零就变成 R93 的另一个病：整体动不了）—— 换句话说，**竖直方向的刚性本身就是
//   自相矛盾的**：要么物体落不下地（抖），要么速度被抹（假刚体）。真正自洽的解释只有一个：
//   高中物理里水平弹簧**不允许对物体施加竖直方向的力**（高中②无力矩、③无阻尼、①力只沿轴向），
//   所以「连接点可以变动」不是妥协，而是唯一正确的画法。
//   ★与 R93 的关系（连接点不滑动）：**稳位上 R93 原样成立** —— 两端等高时「平均高度」就是
//     各自的锚点高度、|o|≡0；只有两端**高度不一致**的瞬态里端点在各自宿主上各滑一半。
//     滑动量有界（≤ 高差/2，再被下面的公共区间夹住 ⇒ 不会滑出宿主侧面），高差消失即归零。
//   ★与 R65/R66 的关系（整体垂直抬起）：**没在拖的时候才放松** —— 拖拽语义原样保留（导轨焊在
//     被拖锚上、另一只刚性跟随）。用户抱怨的「悬空抖动」是**静置**态（锚定后两端不等高），
//     不是拖拽态；而 R66 组3 是**大学模式 + 手动固定方向**（下面 dirLock.auto 之外），本分支不介入。
//   ★适用面收窄到：高中模式 && 导轨**水平**（|uy|≈0，高中模式的方向吸附保证轴对齐 ⇒ 1e-3 足够）。
//     竖直导轨的法向是水平向，与重力同向正交、不存在「吊在半空」的病，一律不碰（B4 守着这条）。
function springRailRelaxed(B){
  var Lk=B&&B.dirLock;
  if(!Lk||PHYS_MODE!=='high'||Math.abs(Lk.uy)>=1e-3)return false;
  // R98-3：拖杆的**长度手柄**也算拖拽态（宿主正被手按住，导轨不能反过来搬它）
  if(grab&&(grab.kind==='body'||grab.kind==='rodlen')){
    for(var i=0;i<2;i++){var a=B.anc[i];if(a&&a.B&&a.B===grab.obj)return false;}  // 拖拽态：走旧路径
  }
  return true;
}
// R95 能力标记：`_probe_r94.py` 用它给旧基线做体检（旧版没有这个函数 ⇒ 大声 SKIP 而不是假绿）。
springRailRelaxed._r95=true;
function springRailFollow(B){
  var Lk=B.dirLock;
  /* ★★R131-13（用户 2026-09-26：「一端固定另一端没有接物体时，移动固定端的物体带动弹簧的
   *  运动，非固定端的点像是被钉在了原地一样，不随固定端的运动而运动，而被拉伸」）：
   *  单端锚定 + 方向锁的弹簧，导轨线钉死在锁定那一刻的世界位置上，且导轨平移只处理
   *  **法向**偏移 —— 沿轴向拖固定端时自由端的轴向坐标原样保留 = 纯拉伸
   *  （_diag_r131g ③：cur 678/len 160、e1dx=0）。
   *  修：单端锚定时导轨线**整体跟随锚定端**（mx,my=锚端），自由端摆在
   *  「锚端 ± 轴向×自然长度」——整体平移、保持自然长度（R71③ 契约）、方向仍锁死
   *  （「高中没有斜弹簧」不受影响：平移不改方向）。两侧都能拖（自由端被拖到另一侧时
   *  尊重现状的符号）。双端锚定走下面的原逻辑零改动。 */
  var _n0=B.anc[0]?B.anc[0].B:null,_n1=B.anc[1]?B.anc[1].B:null;
  if((_n0?1:0)+(_n1?1:0)===1){
    /* ★弹簧本体正被拖（用户拖自由端去锚第二个物体，R71③）⇒ 几何归指针，不摆回自然长度
     *  ——否则自由端永远够不着目标（r60b 2a 教训：偏 27.4px 第二端锚不上）。 */
    if(grab&&grab.kind==='body'&&grab.obj===B){
      /* 弹簧本体被拖（拖自由端换边/锚第二物体）⇒ 朝向记忆跟着现状走，松手后不回跳 */
      var pX=springAnchoredWorld(B,_n0?0:1),_feX=_n0?B.e1:B.e0;
      if(pX)B._capSide=Math.sign((_feX.x-pX.x)*Lk.ux+(_feX.y-pX.y)*Lk.uy)||B._capSide||1;
      return;
    }
    var _i0=_n0?0:1,_hA=B.anc[_i0].B,_fE=_i0?B.e0:B.e1;
    var pA=springAnchoredWorld(B,_i0);
    if(pA){
      /* ★R131-16（用户：「拖动物体弹簧瞬移问题又出现了」）：sgn 按**当前位置**重算会在
       *  「锚端被拖、越过自由端」时反号 ⇒ 自由端瞬移到轴的另一侧。改：sgn **记忆化**
       *  （B._capSide 首次定死），并区分两种锚端移动——
       *  · 锚端被**抓着拖**：自由端=锚端+轴向×len 的**刚性平移跟随**（R71③ 语义，跟手）；
       *  · 锚端自由移动（物理）：同款平移跟随——瞬移的根源是「railFollow 每帧瞬移摆位」，
       *    但自由端无质量本来就该瞬时跟随（视觉上跟手=正确）。
       *  真正的瞬移元凶是 **sgn 翻转**，记忆化即可。 */
      if(B._capSide==null){
        B._capSide=Math.sign((_fE.x-pA.x)*Lk.ux+(_fE.y-pA.y)*Lk.uy)||1;
      }
      var sgn=B._capSide;
      /* ★R131-14b：端帽压缩量纳入摆位——自由端停在「自然长度−压缩」处（接触压入的状态机
       *  在 springEndCaps 里维护 _capCmp，见彼处）。 */
      var _cmp=B._capCmp||0;
      _fE.x=pA.x+Lk.ux*((B.len||0)-_cmp)*sgn;_fE.y=pA.y+Lk.uy*((B.len||0)-_cmp)*sgn;
      Lk.mx=pA.x;Lk.my=pA.y;
      refreshSpringGeom(B);
    }
    return;
  }
  var nx=-Lk.uy,ny=Lk.ux;                 // 导轨法向（单位向量，u 转九十度）
  // R95：高中 + 水平导轨 + 没在拖 —— 导轨只跟随「两端锚点的平均高度」，宿主一律不动（见上）。
  // 夹进「两端宿主都够得着」的公共区间 [lo,hi]：防高度差很大时端点在宿主刚体上滑出去、
  // 弹簧画在半空不接任何东西。区间为空（两端纵向完全错开）时退回纯平均（对称、有界）。
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
      // 死区只省 refreshSpringGeom（亚像素噪声不值得重投影），与旧路径的 d 死区同理。
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
    // R94：被支撑端（压在地面/墙/固定体上，见 railHostSupported）也把导轨钉在自己身上。
    //   ★两个边界（R94 第一版都没守住，靠 _verify_r66 组3 抓出来）：
    //     ① 优先级**低于「被拖端」**：拖装配体的任何一员都必须能把它整体抬起来
    //        （R66 用户：「拖哪里都一样」）。R94 第一版把它放在 drag 之前 ⇒ 拖一只压地的球
    //        向上时轴锁误触发、整块抬不动 ⇒ r66 3a/3b 红。
    //     ② 只在**恰好一端**被支撑时才钉（supN===1）：两端都压地时各自的偏移本来就相等，
    //        取平均 ≈ 各自偏移 ⇒ 校正量 0、本来就不打架，不需要钉（钉了反而偏心）。
    if(railHostSupported(a.B)){supN++;sup=d;}
    dsum+=d;cnt++;
  }
  var d=(pin!=null)?pin:(drag!=null)?drag:((supN===1)?sup:(cnt?dsum/cnt:0));
  // R67：d 的死区只决定「导轨要不要平移」（亚像素噪声不值得搬导轨），**绝不能**拿来跳过
  // 下面的法向刚性对齐。旧代码在这里直接 return —— 于是「拖动刚停下的那一瞬间」d≈0，
  // 其余宿主不再被对齐，重力立刻把它拉离导轨（探针实测按住不动 0.3s 就拉开 19.9px），
  // 只能靠导向力慢慢回弹 —— 用户看到的正是「和弹簧断开很一会儿才过来」。
  // 固定方向 = 这条导轨线在法向上对装配体是刚性的（方向 ux/uy 始终不变）。
  if(isFinite(d)&&Math.abs(d)>=0.01){
    Lk.mx+=nx*d;Lk.my+=ny*d;                // 导轨整体平移到参考偏移处
    refreshSpringGeom(B);                   // 端点重新投影（轴向坐标原样保留）
  }
  // R66（用户：「拖其中一个小球并不会带着整体在垂直方向动……改成拖哪里都一样」）：
  // 拖拽参考 = 刚性搬运：把其余宿主的锚点**绝对对齐到（已平移后的）导轨上**——不是按 d 平移，
  // 而是「锚点当前对导轨的残余偏移 o2（含上一帧重力下坠）一次性清零」。自校正：重力在帧内
  // 拉出的 sag 每帧都被抹掉，垂直方向真刚性，与拖弹簧本体手感一致。轴向不动（拉伸语义保留）。
  //
  // R93（用户：「我知道弹簧现在状态下是刚体，但是有个问题就是弹簧与物体连接后，**弹簧会在与
  //   物体的连接面上移动**，但是我要的是它不移动，连带着固定点成为弹簧垂直方向的刚体」）：
  //   这一段「绝对对齐」从**只在拖拽时**升级成**每帧**。根因是 refreshSpringGeom 的端点投影
  //   会把端点钉在导轨上，而锚点记在宿主上 —— 宿主锚点一旦离开导轨（法向偏移 o），端点就与
  //   锚点分开，那个差值正是用户看到的「弹簧端点在物体表面爬」。诊断实测（_diag_r93b_slide.py）：
  //     · 一端静止锚 + 自由方块（打 200px/s 垂直初速）：|o| 是**永不衰减**的 ±29.5px 振荡
  //       （高中 damp=0 ⇒ springGuideForce 这根横向弹簧没有耗散通道），4.5s 后仍在 ±29px；
  //     · 同一夹具开重力：方块稳定挂在导轨下方 **160px**，端点脱开 160px —— 弹簧画在方块外面；
  //     · 两端都自由（打 A）：|o| 峰值 14.2px（导轨取平均值 ⇒ 两端各滑一半）；
  //     · 只有拖拽时（R66）是好的：滑动 15px→1.9px。
  //   ⇒ 「连接点钉在物体上」与「弹簧只许水平/竖直」（高中规则⑥）只能由**搬宿主**来保证，
  //   不能靠搬端点（搬端点 = 拿连接点的位置去补几何差）。三条纪律：
  //     ① 只对齐**可动**宿主；静止/固定/正被鼠标拖的宿主跳过 —— 它们就是导轨的参考，
  //        指针与固定点是外部位移源，不能被弹簧改写。与 R66 语义一致，只是不再限于拖拽；
  //     ② 法向速度：有静止/被拖参考时归零（刚性连杆接到墙/指针）；**没有参考时取可动宿主的
  //        平均法向速度** —— 否则「整体垂直平移」会被每帧清零，R65 要的「整体一起动」就没了。
  //        取平均同时保证动量守恒，且是耗散性的（不可能回注能量）；
  //     ③ 位移只做**差分校准**（每端各自朝导轨动 o_i），所以整体平移量不受影响。
  var align=[],frozen=false,vsum=0,nmov=0;
  for(var j=0;j<2;j++){
    var b2=B.anc[j];
    if(!b2||!b2.B||b2.B.dead||!b2.B.mb)continue;
    var h2=b2.B;
    var p2=springAnchoredWorld(B,j);
    var o2=(p2.x-Lk.mx)*nx+(p2.y-Lk.my)*ny;   // 锚点对新导轨的残余偏移
    var vv=h2.mb.velocity||{x:0,y:0},v2=vv.x*nx+vv.y*ny;
    // 注意：这里**不**加 railHostSupported —— 冻结被支撑端会让 R66 的「拖任一只都把整体抬起来」
    //   失效（r66 3b 会红）。被支撑端由上面的「钉参考」保护：导轨焊在它身上 ⇒ 它自己的校正量
    //   恒为 0 ⇒ 永远不会被搬到（`_probe_r94` B1/B2 在只有钉参考、没有这条冻结时仍是 0.0000）。
    if(h2.mb.isStatic||h2.fixed||
       (grab&&grab.kind==='body'&&grab.obj===h2)||
       rodLenFrozen(h2)){frozen=true;continue;}   // R98-3：正被长度手柄按住的杆不许被导轨搬
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
// R93 能力标记：`_probe_r93.py` 用它给旧基线做体检（旧版没有这个属性 ⇒ 大声 SKIP 而不是假绿）。
// 语义：R93 起 springRailFollow 每帧把可动宿主的锚点**绝对对齐**到导轨（连接点不再沿物体表面滑动），
// 且无静止/拖拽参考时法向速度取**平均**（保整体平移）。标记值 = 常量名，改语义请一并改它。
springRailFollow._r93=true;
// R94（用户批准的原话：「修改这个（被固定端拴住时，物体只能沿弹簧方向被拖，垂直方向拖不动）
//   就按你说的做」）：**拖拽轴向约束**。
// 语义：被拖的物体若挂在某根「方向锁弹簧」的一端，而**另一端是真固定**（static / 右键固定）——
//   则本次拖拽只允许沿导轨轴向移动：指针位移的**法向分量直接丢掉**。
// ★★「刚性参考」只算 **static / fixed**，**不**算「压在地上」（railHostSupported）。
//   用户①的原话是「被**固定**端拴住」；而 R65/R66 明确要求「拖装配体任一只，整体在垂直方向
//   一起动」—— 两只压地的球组成的水平弹簧必须能整体抬起来。把「压地」也算进来，那条就废了。
//   （R94 第一版正是如此，`_verify_r66.py` 组3 3a/3b 当场抓红 —— 这条边界靠回归才发现。）
// 为什么必须在拖拽侧守：拖拽的旧契约是「pointer owns the pose」（无视阻碍）。可是导轨在法向上
//   对这个装配体是刚体的（R93），被拖的物体一旦横向离开导轨，弹簧端点仍被投影在导轨上 ⇒
//   连接点就从物体表面滑开 —— 正是 R93 花一整轮消灭的「弹簧端点在连接面上爬」。所以法向
//   必须由拖拽侧拦住，让指针只能拉长/压缩弹簧。
// 返回单位方向 {x,y}（导轨轴向）或 null。B 是弹簧自身（kind==='S'）时不约束（拖弹簧 = 搬整体）。
// 能力标记 dragAxisLock._r94：`_probe_r94.py` 用它给旧基线做体检（缺符号 ⇒ 大声 SKIP）。
function dragAxisLock(B){
  if(!B||B.kind==='S'||!B.mb)return null;
  var found=null;
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    if(S.kind!=='S'||S.dead||!S.dirLock)continue;
    for(var i=0;i<2;i++){
      var a=S.anc[i],o=S.anc[1-i];
      if(!a||a.B!==B)continue;
      if(!o||!o.B||o.B.dead)continue;                  // 另一端没锚 ⇒ 自由弹簧，不约束
      var oh=o.B;
      if(!((oh.mb&&oh.mb.isStatic)||oh.fixed))continue; // ★只认真固定（见上方 ★★）
      found={x:S.dirLock.ux,y:S.dirLock.uy};            // 两端同轴，取哪根都一样
    }
  }
  return found;
}
dragAxisLock._r94=true;
/* ★★R131-19b（用户：「杆连着物体，拖它拖不动/不遵循运动关系」）：
 *  拖杆宿主时，直线拖拽与「杆长不可伸长」约束冲突——conDragConstrain 的反向钳位把
 *  拖拽整个吃掉（实测抓着图形上拖 150px、图形纹丝不动）。正确交互（PPT 圆弧手柄式）：
 *  **沿弧线拖**——指针投影到「绕另一端锚点、半径=杆长」的圆弧上，跟手且杆长恒定。
 *  返回弧参数 {cx,cy,R}，由 dragPtrAxis 统一投影（R94 教训：写入点共用一个契约）。 */
function dragArcLock(B){
  if(!B||B.kind==='T')return null;
  for(var i=0;i<bodies.length;i++){
    var r=bodies[i];
    if(r.kind!=='T'||r.dead||!r.anc)continue;
    for(var e=0;e<2;e++){
      var a=r.anc[e],o=r.anc[1-e];
      if(!a||a.B!==B)continue;
      if(!o||!o.B)continue;
      var oh=o.B;
      if(!((oh.mb&&oh.mb.isStatic)||oh.fixed))continue;   // 另一端必须是铁砧
      var p=springAnchoredWorld(r,1-e);
      return {cx:p.x,cy:p.y,R:r.len||170};
    }
  }
  return null;
}
dragArcLock._r131=true;
// R94：把当前指针投影成**等效指针** —— 法向分量直接丢掉，只留导轨轴向分量。
// ★这个投影必须被**所有**「把被拖物体摆到指针位置」的写入点共用。R94 第一版只改了
//   pointermove 里的即时摆放，漏了 stepMatter 里**每帧**的摆放 —— 后者以未投影的指针覆盖前者，
//   于是轴锁「看起来完全没生效」：垂直拖 200px 的**拖拽峰值**仍然是整整 200px
//   （松手后被弹簧拉回 0，所以「松手后读数」是假绿，`_probe_r94.py` 改量峰值才暴露）。
//   ← 教训：一个「指针 → 位姿」的契约，写入点有几处就得改几处；先 grep 全部写入点，别只看第一个。
function dragPtrAxis(){
  /* ★R131-19b：弧线拖拽——被拖体连着「另一端为铁砧的杆」时，等效指针=绕锚点、
   *  半径=杆长的圆弧上（朝原始指针方向的点）+ 抓点偏移 ⇒ 跟手且杆长恒定。 */
  if(grab&&grab.arc){
    var ac=grab.arc;
    var aa=Math.atan2(pointer.y-grab.gy-ac.cy,pointer.x-grab.gx-ac.cx);
    return {x:ac.cx+Math.cos(aa)*ac.R+grab.gx,y:ac.cy+Math.sin(aa)*ac.R+grab.gy};
  }
  if(!grab||!grab.axis)return pointer;
  var dx=(pointer.x-grab.gx)-grab.ax0,dy=(pointer.y-grab.gy)-grab.ay0;
  var l=dx*grab.axis.x+dy*grab.axis.y;                 // 只留轴向分量
  return {x:grab.ax0+grab.axis.x*l+grab.gx,y:grab.ay0+grab.axis.y*l+grab.gy};
}
dragPtrAxis._r94=true;
// R65（用户：「弹簧固定后，则连接的物体取消自我转动，不会改变方向，而是和弹簧组成一个整体，
// 旋转也是旋转整个整体一起」）：方向锁弹簧的宿主**冻结自转**。每帧把角速度清零（stepSprings
// 在 stepMatter 的引擎步进之后跑，此刻清零能保证渲染与下一帧积分都看到 ω=0 —— 碰撞那点
// 残余角速度活不过一帧），并且弹簧力通道不再对它产生力矩（springForceOn 里 _lockRot 时
// 强制把作用点折叠到质心）。两根弹簧一锁一不锁共宿主时按锁的算（并集语义）。
function springSyncLocks(){
  var i,e,B;
  for(i=0;i<bodies.length;i++){if(bodies[i]._lockRot)bodies[i]._lockRot=false;}
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='S'||B.dead||!B.dirLock)continue;
    // R83：**自动**轴锁在大学模式不冻结宿主自转 —— 它锁的是「方向」，自转与这条导轨毫无
    //   耦合；冻结它只会白白推翻 R77 的契约（球连了弹簧就再也滚不起来）。
    //   手动「固定方向」（右键菜单，无 auto 标记）的行为一字不改。
    // R129（用户：「切回高中还是会出现物块的连接点变动旋转……旋转分量被清除了，但旋转的
    //   约束也没了，这时如果该物体和其他物体发生了碰撞，就又会出现」）：高中模式下 auto 锁
    //   的宿主**也要**冻结自转 —— 但**球除外**（R83 的契约是「球要能滚」，球有滚动语义；
    //   非球物块在高中=质点模型，自转没有合法语义）。完整链条：R118 只在切换那一刻清一次
    //   ω，之后碰撞注入的新 ω 没有任何衰减通道（高中无力矩通道 + 无空气阻力 + auto 锁又不
    //   冻结）⇒ 物块永远匀速转下去（_diag_r129e 实测注入 3rad/s 四秒不衰减、θ 累计 +600°）。
    //   冻结后碰撞残余活不过一帧（springSyncLocks 每帧跑）。
    if(B.dirLock.auto&&PHYS_MODE!=='high')continue;
    for(e=0;e<2;e++){
      var a=B.anc[e];
      if(!a||!a.B||a.B.dead||!a.B.mb||a.B.mb.isStatic)continue;
      // R129：高中 auto 锁下**球**不冻（R83：球连了弹簧还要能滚）
      if(B.dirLock.auto&&a.B.wshape==='circle'&&a.B.rad)continue;
      a.B._lockRot=true;
      if(a.B.mb.angularVelocity)Matter.Body.setAngularVelocity(a.B.mb,0);
      if(a.B.om)a.B.om=0;                 // 渲染侧的角速度派生量一并清零
    }
  }
}
// 宿主在弹簧轴上的速度分量（弹力的阻尼项要用相对速度，不能只看弹簧自己）
// R60b：附着点的速度 = 质心速度 + ω × r。力矩把「旋转」接进这条通道之后，阻尼项必须看见
// **附着点**的速度，否则转动态完全落在阻尼的作用范围之外（只剩 frictionAir 那 0.014 在管）。
// 后果实测很严重：「弹簧 + 球 + 地面」会变成一个**不衰减的极限环**（v 在 3~176px/s 之间永远
// 摆、形变 0~37px 永远摆，12s 都不停）—— 滚动接触把自旋换成平移，自旋又由力矩不断喂回来。
// 把 ω×r 项补进 vrel 之后，Rayleigh 阻尼才真正作用在附着点上，环才收得住。
// 取 v_P·u = v_com·u + ω·(r × u)，r = 附着点 − 质心（2D 叉积的 z 分量）。
function springHostVel(h,ux,uy,px,py){
  if(!h)return 0;
  var v=(h.vx||0)*ux+(h.vy||0)*uy;
  if(px!=null&&h.mb){
    var rx=px-h.mb.position.x, ry=py-h.mb.position.y;
    v+=(h.mb.angularVelocity*60)*(rx*uy-ry*ux);   // angularVelocity 是 rad/「1/60 步」，×60 得 rad/s
  }
  return v;
}
// R60b（用户：「弹簧效果也不真实」）：px,py = 力的**作用点**（世界坐标），也就是锚点本身。
// 之前这里只改质心速度 = 力全部作用在质心上 = 对宿主**零力矩**。后果肉眼可见：把弹簧勾在
// 圆的边缘上挂着，球会一直以「左耳挂着」的姿态僵在半空（实测自由悬挂 3.6s 后转角仍 ≡0，
// 锚点本地偏移恒为 (-70,-1)），而真实刚体会绕挂点转，直到挂点转到**正上方**才稳。
// 修法：力照旧推质心，同时把 τ = r × F（r = 锚点 - 质心）折成角速度增量（见下方 h.rad 的
// 范围说明 + 配套的 springHostVel 里那个 ω×r 项 —— 少了它，转动态不在阻尼作用范围内，
// 「弹簧+球+地面」会变成一个永远不衰减的极限环）。
function springForceOn(h,fx,fy,dt,px,py,ks){
  if(!h||h.dead)return;
  if(h.kind==='S')return;                      // 弹簧不直接推弹簧（避免连锁拖动/自激）
  if(h.mb&&h.mb.isStatic)return;               // 右键固定过的物体、铁砧：不动
  // R63：质量口径**刻意保持不变**（仍是 JS 侧的 h.mass，默认 1）。理由写在这里，免得下次
  // 又被当成笔误「顺手修正」：
  //   · 有 Matter 体的宿主（W：笔画 / 图形 / 凹槽 / 圆）在 Matter 里的真实质量是按面积算的
  //     —— 90x90 的方块 mass=9.216，和这里的 1 差 9 倍。但整条弹力通道都是以 m=1 为口径
  //     标定并调好的（连下面的角速度分支用的单位转动惯量 I/m = r²/2 也是同一口径）：
  //     R57/R58/R60b/R62 的「悬挂伸长 mg/k ≈ 14.4px」「挂在边缘的球会绕挂点转正」全都建立在
  //     它上面。单独把质量换成真实值，画出来的图形会一挂就下垂 9 倍、圆的自转慢 9 倍，
  //     等于把前面几轮定好的手感一次性推翻。
  //   · 而这次咬人的「弹力把方块掀翻」是一条**纯加速度**判据（a_x > g，见 SPR_AX_G），
  //     与质量口径无关 —— 所以修复只做在加速度那一侧，见下面那段。
  var m=(h.mass&&h.mass>0)?h.mass:1;
  if(h.kind==='W'&&h.mb){
    // R65：方向锁弹簧的宿主冻结自转（springSyncLocks 每帧打标）—— 力强制作用在质心，
    // 不产生力矩；物体朝向从此只随「整体旋转」走，不会被弹力/导向力单独拧动。
    if(h._lockRot)px=null;
    // R74-D 高中模式①：弹簧不算力矩 —— 拉任何部位效果相同，力只沿弹簧方向作用在质心。
    // 置 null 后下方 px!=null 的 τ=r×F 通道整体跳过（与方向锁同一条门，覆盖主弹簧力与
    // 方向锁导向力，两条都走本函数）。
    if(PHYS_MODE==='high')px=null;
    // R63（用户：「弹簧老是会导致物体翻滚……在地面连接两个正方体，拉动时总是导致另一个正方体
    // 翻转，使连接点位于远端」）：把**水平**加速度限幅到 SPR_AX_G·g·(w/h)，也就是
    // 「不翻倒阈值 g·w/h 再打九折」—— 翻倒力矩恒小于重力回复力矩，于是方块无论多大、多重、
    // ks 多大、拖多快，都只会滑过来、不会翻过去。纵横比那一段见 SPR_AX_G 的注释（必须按物体
    // 自己的 w/h 算，一刀切实测会把竖长方形掀翻）。
    // 竖直分量 R63b 起限到 SPR_AY_G·g（=1.35g，见常量处注释）：仍大于 1g，吊起/斜着往上拽
    // 照旧；掐掉的只是「猛地一提」时 9.2g 的瞬时过冲。
    // 实测（300px/600ms 拖拽，六种形状）：修前远端块翻 92~362° 并停在翻转姿态；修后 0.0°。
    // GRAV=0 时整段跳过：没有重力就没有回复力矩，也就无所谓「翻倒」；顺带保证 GRAV=0 的
    // 隔离实验台里弹力通道的行为与以前逐位一致。
    if(GRAV>0){
      // R88⑤：这两个上限是**弹簧的上限**，必须随 ks 缩放 —— 否则 k ≳ 3600 之后弹力永远吃满
      // 1.35g，k 从公式里消失（改码前实测：k=50/500/5000/50000 的加速度峰值四档全等 3510）。
      // gain 在 ks ≤ 默认值时恒为 1（逐位兼容 R63/R63b 的全部标定），在 ks 大时线性放大并封顶。
      var gain=springAccGain(ks);
      // 用本体的**本征**纵横比（hw/hh 是未旋转的局部半宽半高）。下限 0.25 是防呆：
      // 极端细长（w/h -> 0）时确实会把拉力削到接近 0，留一点让手感不至于「死掉」。
      var rw=h.hw||0,rh=h.hh||0;
      var asp=(rw>0&&rh>0)?Math.max(0.25,rw/rh):1;
      var limX=SPR_AX_G*GRAV*m*asp*gain;
      if(fx>limX)fx=limX;else if(fx<-limX)fx=-limX;
      var limY=SPR_AY_G*GRAV*m*gain;
      if(fy>limY)fy=limY;else if(fy<-limY)fy=-limY;
    }
    // 边界/图形的位姿归 Matter 管：stepMatter 每帧把 B.vx/B.vy 用**位姿差分**写成只读派生量，
    // 所以对 W 写 h.vx 之后下一帧就被覆盖掉 —— 力会静默消失（这就是首轮实测「弹簧对画出来的
    // 图形完全没有弹力」的原因）。
    // 走 Matter.Body.setVelocity：它的 velocity 单位是「px / 1 个 1/60 步」，而这里 fx/m*dt 是
    // px/s，所以要 /60 换算；setVelocity 内部会一起修正 positionPrev，不会产生幻影速度。
    // 不用 applyForce：那要把力塞进 Matter 的 deltaTime² 量纲（force/mass*dt²），缩放系数一旦
    // 和 timeScale / body.mass 脱节就会静默失力，比换算单位更容易踩坑。
    Matter.Sleeping.set(h.mb,false);
    var mv=h.mb.velocity;
    Matter.Body.setVelocity(h.mb,{x:mv.x+fx/m*dt/60,y:mv.y+fy/m*dt/60});
    // 力矩（R60b，见函数头注释）：力只作用于质心的话，挂在边缘上的球永远不会转到「挂点朝上」。
    // R60b 当时**只对圆（h.rad）接旋转**，理由写在下面 —— 但那条理由的一半已经不成立了：
    //   · 圆的挂点必然在**环线**上 —— 判定带 SPR_PAD=15px 落在环外的机会只有 2R 宽的一小段，
    //     绝大多数拖拽都会吸到环线上，于是「挂点在哪」就等价于「球转到哪个角」，不接旋转
    //     必然出现「左耳挂着」这种一眼假的姿态（实测自由悬挂 3.6s 转角恒 0°）。
    //   · 「笔画/图形接上自由旋转会被甩到 -205°」是 **9.2g 时代**的数字 —— 那时弹力对 W 体的
    //     实际加速度是 24000px/s²，R63 已把水平分量限到 0.9g·(w/h) 以内（见上面 limX）。
    //     而且**锚点在侧面中点、水平拉时 r 与 F 共线，τ=r×F 本来就恒等于 0** —— 也就是说
    //     用户报的「弹簧连两个方块、拉动时另一块翻滚」这条路径，力矩通道根本不会参与；
    //     它参与的是「斜着拉 / 提起来 / 绕圈」这些 r 与 F 不共线的情形。
    //
    // R63b（用户：「它翻转过去那个方向后，我无论如何提另外一个物体，哪怕转一圈，那个翻转过
    // 方向的物体的方向就再也不会变了，始终朝向那个方向」）：必须给多边形也接上 τ=r×F。
    // 没有这条通道的后果（探针实测 842 帧逐帧 θ，含快速上提 + 绕两圈，θ 一次都没变过）：
    // 弹力永远作用在质心 ⇒ **弹簧永远转不动方块** ⇒ 方块的朝向只能被地面接触的摩擦力偶改变；
    // 而一旦它以某个姿态躺稳（重心在接触面正上方、重力力矩=0），就**再无任何通道能改变它的
    // 朝向** —— 用户看到的「方向永久锁死」。这也正是 L020 的教训「拴在附着点上的力必须
    // 真的作用在附着点」在多边形上的欠账。
    // 惯量：圆用单位质量圆盘 I=r²/2（R60b 原样），多边形用单位质量矩形 I=(hw²+hh²)/3。
    if(px!=null){
      var rx=px-h.mb.position.x,ry=py-h.mb.position.y;
      var tq=rx*fy-ry*fx;                      // 2D 叉积 r × F
      if(tq){
        var rw2=h.hw||0,rh2=h.hh||0;
        // 单位质量极转动惯量（与线速度那一路的 m=1 同口径）；退化成 0 就放弃旋转，别除零
        var Iu=h.rad?h.rad*h.rad/2:((rw2>0&&rh2>0)?(rw2*rw2+rh2*rh2)/3:0);
        if(Iu>1e-6){
          // R63b：多边形的力矩上限（圆保持 R60b 的原样不夹）。取 min(hw,hh) 作力臂口径：
          // 方块**躺在地上**时，回复力矩 mg·(半宽) 恒压住 τ 上限，拧不翻躺稳的方块。
          // 但悬空/悬挂时没有地面回复力矩 —— 锚点在侧面的方块会被拧到「锚点朝上」，
          // 这是**有意保留**的行为（方案 B，用户拍板）：朝向能跟着拉力变，正是本轮修复的目的。
          // 和上面 limX 各管一半：limX 管「拉力偶」，这条管「直接拧」。
          // GRAV=0 时同样整段放开：没有重力就没有回复力矩，也就无所谓掀翻。
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
// R58：改「自然长度」必须让弹簧**真的变长/变短**，而不是只改一个数（改完画面不动、还因为
// cur≠len 被染成红/蓝 —— 用户两条反馈其实是同一个洞）。
// 优先把**没拴住**的那一端沿轴挪到新的自然长度处；两端都拴住时几何由宿主决定，只能改 len
// （那是「预紧力」语义：长度不变，弹力变了）。
// R58：旋转按钮作用在弹簧上时，转的是**端点**而不是 B.th —— B.th 是 refreshSpringGeom 从
// e0/e1 派生的只读量，直接改它下一帧就被覆盖，手柄看起来完全没反应。
// 语义：绕「钉住的那一端」转自由端；两端都自由则绕中心对称转；两端都拴死时几何由宿主
// 决定，转不动（返回 false，调用方据此不显示手柄）。
function springRotate(B,th){
  // R76（用户③）：高中模式没有斜弹簧 —— 旋转手柄也**无条件**吸附到 90° 整数倍。
  //   这里不能复用 snapAngle90：它只在 ±SNAP_DEG(8°) 带内才吸，落在带外会保留任意斜角
  //   （而高中模式要的是「不可能出现斜弹簧」，不是「靠近轴时更好吸」）。
  /* ★★R132-9g（用户：「那个高中模式对于弹簧角度的限制是不是误伤了其他同样旋转角度的器件，
   *  比如那个圆弧，现在旋转也只有那几个角度了，还有轻绳等和电磁场等其他拥有角度旋转的？」）：
   *  这条 90° 方向锁原本对**所有 kind==='S' 的体**生效 —— 而 `S` 里既有弹簧也有**轻绳**
   *  （`isRope = kind==='S' && E.rope`，见 conMov 的口径）⇒ 轻绳也被锁成只有四个方向。
   *  ⇒ 加 `!B.rope`：**只有真弹簧**才受高中模式的轴向约束。 */
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
function springSetLen(B,L){
  // R72（用户：「参数不要设置上限」）：原 40..520 是「别让一根弹簧横穿全屏」的实用护栏，
  // 不是物理约束 —— 弹簧原长没有物理上限，超长就让它超长（画面上自由伸展，物理照常成立）。
  // 只保留 L>0（原长 ≤0 无物理意义）。
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
  if(B.rope)initRopeNodes(B);          // ★R131：绳长改变 → 链沿新端线重铺
  return old;
}
function springCanRotate(B){
  // R101⑦：铰链**没有方向**（长度 0、两锚点重合），旋转手柄对它是无意义的动作 —— 不出现。
  if(B&&B.hinge)return false;
  // R58：弹簧只有「至少一端是自由的」才转得动（两端都拴在别的东西上，几何由宿主决定）
  // R66（用户：「弹簧固定后要有悬浮的旋转按钮啊」）：方向锁弹簧**永远**显示旋转手柄 ——
  // 它拧的是整个装配体（springAssemblyRotate，含导轨朝向），不受「两端都拴死」限制。
  return !!(B&&B.kind==='S'&&(B.dirLock||!(B.anc[0]&&B.anc[1])));
}
function springMirror(B){
  window.__mirN=(window.__mirN||0)+1;
  // R101⑦：轻绳 / 光滑铰链**不参与碰撞**，没有 Matter 薄板镜像（理由见上方语义段：
  // 绳是「只传张力的连线」、铰链是「销钉」，两者都不挡路）。
  if(B&&(B.rope||B.hinge))return;
  // W（画出来的线）与弹簧的碰撞归 Matter 管（和 T 杆同一条规则），所以弹簧也要有一个 Matter
  // 镜像：一根静态薄板，每帧跟着 e0->e1 走。Matter 的薄板不能改长度，所以长度变化超过
  // SPR_MIRROR_TOL 才重建 —— 否则弹簧每「呼吸」一次就造一个新体。
  if(!MW)return;
  var stale=(B._mlen==null)||(Math.abs(B._mlen-B.cur)>SPR_MIRROR_TOL);
  if(B.mb&&!stale){
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th||0);
    springEndCaps(B);       /* ★R131-14b：非 stale 早退路径也要摆端帽/测接触（否则压缩状态机永不运行） */
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
/* ★★R131-14（用户 2026-09-26：「当弹簧某段没有固定物体时，默认端口是一个横的边界，并且
 *  也作用于弹簧，相当于没固定时，物体撞到弹簧也会发生形变和受力」）：
 *  未锚定的自由端有一个**横向端帽**（static 薄板，垂直弹簧方向、宽 SPR_CAP_W、厚 SPR_CAP_T，
 *  从端点向外延伸）—— 物体撞上来被 Matter 挡住（不穿透）；每帧把物体对端帽的**轴向压入
 *  量**转成自由端位移（端点被压向弹簧体 ⇒ cur 减小 ⇒ 弹簧压缩 ⇒ 弹力作用于另一端宿主）
 *  ——「物体撞弹簧也会形变和受力」。已锚端没有端帽（钉在宿主上）。端帽生命周期：
 *  springMirror 每帧摆位/增删；removeMatterBody 里随宿主一起清。 */
var SPR_CAP_W=40, SPR_CAP_T=10;
/* ★★R131-64（用户：「天花板怎么没有边界？天花板也是一面墙」）：顶部天花板（Matter 静态体
 *  `MW.wt`）的内缘位置。取 −(BND_INK+CEL_INSET)：物体**真的越出画布**（墨迹完全离开
 *  可视区上缘）才碰到它 —— 与左右墙「差 300px 才碰到」的离屏语义同款，只是窄一些，
 *  不然用户看着物体悬在屏幕里就被挡住会觉得「有个看不见的墙」。
 *  内缘随视口高度走 ⇒ 与 groundY 无关，`resize()` 每帧重算 `CEL_Y`。 */
var CEL_INSET=24;
/* wt 内缘恒 = celInnerY()；wt 半高 300 ⇒ 中心 = celInnerY()−300。resize() 每帧按视口重算。
 * ★★R131-64（量出来的坑，_diag_r250 C1）：**这里绝对不能写成
 *   `var CEL_INNER=-(BND_INK+CEL_INSET);`** —— `BND_INK` 定义在本文件后段（≈11335），
 *   此处仍是 TDZ（var 提升但未赋值 ⇒ undefined）⇒ CEL_INNER=NaN ⇒ celCenterY()=NaN ⇒
 *   `Bodies.rectangle(W/2,NaN,…)` 的 bounds 塌成 `[-200, inf, 1600, -inf]`
 *   ⇒ 顶墙**静默失效**（存在、isStatic、却什么都挡不住）。一律惰性求值。 */
function celInnerY(){return -(BND_INK+CEL_INSET);}
function celCenterY(){return celInnerY()-300;}
/* ★★R132-8：物体在给定正交基 (u,n) 下的**真实投影半宽**（以质心为原点，遍历复合体全部 parts）。
 *  返回 {u: 沿 u 的半宽, n: 沿 n 的半宽}。
 *  用途：端帽（springEndCaps）的轴向 reach 与横向带判定。
 *  为什么不用 `(AABBw+AABBh)/4`：那是一个「平均半径」，被细长体的**长边**主导
 *  ⇒ 细长横躺条带（512×60）算出 143px 的假半径，在 136px 外就被判「压在端帽上」
 *  ⇒ 每帧把物体推开 + 把弹簧反向平移 = 用户报的「弹簧隔空把这些物体推走」。
 *  为什么不用 `mb.vertices` 直接遍历：复合体（W 体/墨迹体）的 `mb.vertices` 只等于
 *  parts[0]，会漏掉其它 part ⇒ 必须遍历 `mb.parts`（普通体 parts 就是 [self]）。 */
function projHalfExtent(mb,ux,uy){
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
  if(!ru&&!rn){  // 兜底：无顶点信息 ⇒ 退回旧的 AABB 平均半径口径
    var bb=mb.bounds;
    ru=rn=(bb.max.x-bb.min.x+bb.max.y-bb.min.y)/4;
  }
  return {u:ru,n:rn};
}
function springEndCaps(B){
  window.__capN=(window.__capN||0)+1;
  if(!B||B.rope||B.hinge)return;
  var _nA0=(B.anc&&B.anc[0]&&B.anc[0].B)?1:0,_nA1=(B.anc&&B.anc[1]&&B.anc[1].B)?1:0;
  if(_nA0+_nA1===2)return;                       // 两端都锚定 ⇒ 没有未锚端 ⇒ 没有端帽
  /* ★★R132-8b（用户 2026-10-01：「弹簧一边没有接物体时…物体撞上时也像是撞到弹簧一样，
   *  弹簧被压缩，物体被弹开」）——**端帽重写版**。设计纲领：**几何永不因压缩而移动**。
   *
   * 三条铁律（都是本轮实测踩出来的，别改回去）：
   *
   * ① **端点基准恒为 `B.e0/B.e1` 本身，压缩量绝不回写端点。**
   *    `_capCmp` 是**纯视觉 + 纯力**的状态量：视觉由 `drawSpring` 消费（见彼处），
   *    力由本函数消费（f = ks·cmp，保守力 ⇒ 能弹回）。
   *    为什么：只要压缩量参与几何，判据基准就会随状态漂移，形成**正反馈**——
   *      · 版1（基准=当前端点 e，无限宽位置闸）：`springMirror` 的镜像板（static +
   *        `restitution:0`）先把物体撞停，实测 vx −480→0，物体停在**板面**外 26px；
   *      · 版2（基准=自然位置 eN=e+u·cmp，位置闸推到 eN+reach）：闸门随 cmp 右移
   *        ⇒ 物体被越推越远、cmp 越涨，实测 `e1` 冻在 603.73、cmp 冻在 75.99、
   *        物体**原地不动永不弹开**（_tmp_r306）；
   *      · 版3（基准=eN，两端帽各推一次）：双端自由弹簧的两端对同一物体**互推**
   *        （实测 i=0 向左 76px、i=1 又向右 16px，位置乱套、cmp 冻结）。
   *    改成「几何不动 + 纯视觉压缩」后所有反馈环一次性消失。
   *
   * ② **最近端归属**：一根双端自由弹簧的**两个**端帽都"看得见"同一个物体，
   *    必须裁决它归谁——否则就是版3 的互推。判据：物体中心到哪个自由端更近。
   *
   * ③ **碰撞组隔离必须有**：物体一旦进入端帽带就放进 `SPR_CGROUP`
   *    （= 与弹簧镜像薄板同组 ⇒ Matter 窄相位直接跳过这一对）。
   *    已锚端分支早在 R131-17d 就做了（彼处注释：「否则物体先被 mirror 板的非弹性碰撞
   *    停死，动能被 Matter 吃掉，弹不回来，实测反弹仅 29px/s」），
   *    自由端分支当时漏了同款一行 ⇒ 弹簧撞上去像撞墙。
   *
   * 判据阈值：轴向 `reach = 真实投影半宽 ru + SPR_CAP_T/2`、横向带 `±(SPR_CAP_W/2 + rn)`。
   *   `ru/rn` 走 `projHalfExtent`（以质心为原点、遍历 parts）——
   *   旧口径 `(AABBw+AABBh)/4` 是「平均半径」，被细长体长边主导 ⇒ 512×60 的横躺条带
   *   算出 143px 假半径，在 136px 外就被判「压着端帽」并逐帧被推开 = 用户报的
   *   「弹簧隔空把物体推走」（REC `rec_2026-10-01-02-58-21.json`：W2 全程 vx≡0 睡着，
   *   却被搬了 145.05px）。修后同款几何一帧位移 **0.000px**（_tmp_r300 B 臂）。 */
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
  /* 压缩状态量：接触帧**瞬间跟上涨**（可比上一帧小 ⇒ 物体回退时视觉跟着回），
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
      if(typeof setCGroup==='function')setCGroup(hb.mb,SPR_CGROUP);
      hb._capG=true;(B._capGL||(B._capGL=[])).push(hb);
    }
    /* ① 保守回复力 f = ks·cmp 沿向外 —— 物体减速到 0 后被原速弹回（能量不丢） */
    var _fCap=(B.ks||SPR_KS_DEF)*_capCmp;
    if(_fCap>0){
      var _v=hb.mb.velocity||{x:0,y:0};
      var _dv=_fCap/(hb.mb.mass||1)*(1/60)*(1/60);   // 与产品力律同口径 dv=f/m·dt/60
      Matter.Body.setVelocity(hb.mb,{x:_v.x+H.ox*_dv,y:_v.y+H.oy*_dv});
    }
    /* ② 防穿透兜底：压过最小工作长度才把**超出部分**推回（不做全量硬挡 ⇒ 不会「急停」） */
    if(H.raw>_maxCmp){
      var _ov=H.raw-_maxCmp+0.5;
      Matter.Body.setPosition(hb.mb,{x:hb.mb.position.x+H.ox*_ov,y:hb.mb.position.y+H.oy*_ov});
    }
  }
  if(!_hits.length&&B._capGL&&B._capGL.length){
    for(var _gi=0;_gi<B._capGL.length;_gi++){
      var _gb=B._capGL[_gi];
      if(_gb&&_gb.mb){if(typeof setCGroup==='function')setCGroup(_gb.mb,0);_gb._capG=false;}
    }
    B._capGL.length=0;
  }
}

// R58：把「弹簧 ↔ 它拴住的宿主」这一对放进同一个负 group，让它们互不碰撞。
// 复合体的 collisionFilter 要连 parts 一起设（Matter 的窄相位看的是 part）。
function setCGroup(body,g){
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
function springSyncGroups(){
  var i,e,B,S;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B._sprG&&B.mb){setCGroup(B.mb,0);B._sprG=false;}
    if(B._hinG&&B.mb){setCGroup(B.mb,0);B._hinG=false;}   // R103-5：铰链组标记也要逐帧重算
    if(B._rodHG&&B.mb){setCGroup(B.mb,0);B._rodHG=false;} // ★R131-19：杆锚定宿主组标记重算
  }
  for(i=0;i<bodies.length;i++){
    S=bodies[i];
    if(S.kind!=='S'||S.dead)continue;
    // ★R103-8（_tmp_jamcheck 实测）：铰链**没有 Matter 镜面板**（R101⑦），把它的两端
    //   宿主塞进 −2 毫无用处，纯粹造成「铰链两端宿主互不碰撞」—— 两个普通物体被铰住后
    //   可以随意互相穿过（末态实测 g0=g1=−2、B 楔进 A 29px）= 用户「重叠穿模」投诉的
    //   最底层根因。弹簧才需要 −2（豁免自家镜面板），铰链跳过这段；杆参与的铰链由下面
    //   的 HINGE_CGROUP 分支按需豁免「杆镜面板 ↔ 宿主」。
    if(!S.hinge){
      for(e=0;e<2;e++){
        var a=S.anc[e];
        if(!a||!a.B||a.B.dead||!a.B.mb)continue;
        setCGroup(a.B.mb,SPR_CGROUP);a.B._sprG=true;
      }
    }
    // ★R103-5（_diag_r103b B 组实测）：**杆 ↔ 宿主**这对放进同一个负组互不碰撞 ——
    //   销接处杆自由端的板帽必然压在对方表面 ~2px，Matter 的 static 板每帧把对方推出去
    //   ⇒ 装配体持续爬移（实测方块 x 502→374 不停），这就是「杆/物体自己动」的另一半根因。
    //   独立组号 −3：**不**与弹簧的 −2 混，否则「弹簧宿主搁在铰链宿主上」会意外穿透。
    //   杆作为宿主时设的是它的**镜像板**。
    //   ★R103-8 复测收窄（_diag_r103b D 组实测）：**只豁免「至少一端是杆」的铰链** ——
    //   两个普通物体被铰住时它们**必须**保持碰撞（D 组：方块 B 绕销风车，若 A/B 同组
    //   互不碰撞，B 直接转进固定块 A 的正上方，AABB 完全重叠 = 用户抱怨的「重叠穿模」
    //   原样回归）。有杆的那端豁免的理由依然成立：轻质杆无体积，镜面板只是物理代理。
    /* ★R131-19：**杆（T）的锚定宿主** 与杆镜像板互不碰撞——铰接语义：宿主受重力
     *  绕杆端摆动，不被 static 板托住悬停（REC 09-27-02-39-58 实证图形被托在天上）。
     *  杆板对**非宿主**物体仍是承重面（搁杆特性保留）。 */
    if(S.kind==='T'&&!S.hinge){
      for(e=0;e<2;e++){
        var ra=S.anc[e];
        if(!ra||!ra.B||ra.B.dead||!ra.B.mb)continue;
        setCGroup(ra.B.mb,ROD_HOST_CGROUP);ra.B._rodHG=true;
      }
    }
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
/* ★★R131-21（用户拍板：「杆连接物体，则直接固定角度锁死」）：杆的锚定宿主
 *  **冻结自转**（角度锁死）——自由度-1，摆动=纯平移绕杆端，材料点方位恒定，
 *  约束只需解平移 ⇒ 无旋转自由度冲突。与弹簧 _lockRot 同一通道（力过质心）。 */
/* ★★R131-27 触摸版：设备模式 —— 'auto'（自动识别）/ 'desktop'（电脑版）/ 'touch'（触屏版）。
 *  设置里可强制切换，存 localStorage。触屏版交互：
 *   · 拖动（pointermove）保留；
 *   · **点选放置**：点一下选中（高亮），再点另一处 ⇒ 把选中体搬到该处（手指粗、精细拖拽难的补偿）；
 *   · **长按 = 右键**（450ms 未移动 ⇒ 弹菜单）。 */
var UI_MODE='auto';
try{var _um=localStorage.getItem('sandbox_ui_mode');if(_um==='desktop'||_um==='touch')UI_MODE=_um;}catch(e){}
function isTouchDevice(){
  return (('ontouchstart' in window)||(navigator.maxTouchPoints>0)||(navigator.msMaxTouchPoints>0));
}
function uiTouch(){return UI_MODE==='touch'||(UI_MODE==='auto'&&isTouchDevice());}
function setUIMode(m){
  UI_MODE=m;try{localStorage.setItem('sandbox_ui_mode',m);}catch(e){}
  /* ★R131-27b：触屏模式的 body 级样式（面板收起把手显示） */
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
}
/* ★R131-27b：初始化时按当前模式挂 body 类（面板把手/折叠） */
function applyUIModeClasses(){
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
  fixPanelSlot();
  alignPanelToggle();
}
/* ★R131-30（用户：「右上角按钮展开后挡住字符 a 的选取」）：把手所在的**第 4 格留空**，
 *  第 4 个字符（a）换到第 2 行开头，后续自动顺延。CSS 规则在 auto-placement 下不生效
 *  ⇒ 用内联样式直接定位（确定性）。 */
/* ★★R131-31（用户：「把这个下拉框做成刚好和那个字符框空着的那个框重合」）：把手
 *  **精确对齐到面板第 1 行第 4 格**（同尺寸 44×44、同圆角 10、同一格位置）——不突兀。 */
function alignPanelToggle(){
  var pan=DD.getElementById('panel'),tg=DD.getElementById('panelToggle');
  if(!pan||!tg)return;
  if(!DD.body.classList.contains('touch-ui'))return;
  /* ★R131-31b：面板在触屏折叠态下 getBoundingClientRect 是**折叠后**的位置（拿不到
   *  格子坐标）⇒ 用**固定布局算法**：面板固定在 top:24/right:24，padding 10，
   *  格 44 + gap 6 ⇒ 第 1 行第 4 格 = 右起 (24+10+44) 、上起 (24+10)。 */
  tg.style.left=(window.innerWidth-24-10-44)+'px';
  tg.style.top=(24+10)+'px';
  tg.style.right='auto';
}
function fixPanelSlot(){
  var pan=DD.getElementById('panel');if(!pan)return;
  /* ★★R132-9m（清屏闪烁）：**与 `sortPanel`/`dockSlotEl` 共用同一个「序号 → 格」真源**。
   *  旧版本函数是「按 DOM 里现有孩子的顺序**顺排**」——那是 R131-31 当时为了修「换行后下面
   *  原有字符没同步换位导致重合」临时加的，但它引入了**第二套槽位规则**：同一次清屏里
   *  `sortPanel` 先按「每行 4 个」摆一遍、`setTimeout(fixPanelSlot,0)` 再按「首行 3 个」摆一遍
   *  ⇒ 第 4 个字符（a）先落在把手下面、再被拉回第 2 行，就是用户看到的一帧错位。
   *  ⇒ 改成按 `DOCK_ORDER` 逐个钉格（与 `dockSlotEl` 同一函数），顺排那套随之作废。
   *  ★顺排还有第二个副作用：黑洞吃掉一个字符后，后面的会**整体前移**（位置全变）；
   *    按 DOCK_ORDER 钉格则只留一个空格，其余不动 —— 这也是 `dockSlotEl` 原本的注释契约。 */
  var arr=[].slice.call(pan.children);
  for(var i=0;i<arr.length;i++){var c=arr[i];if(c&&c.style)dockSlotEl(c);}
}
/* 点选放置的状态：TOUCH_SEL = 已被 tap 选中的体；TOUCH_LP = 长按计时器 */
var TOUCH_SEL=null,TOUCH_LP=null;
function touchClearSel(){
  if(TOUCH_SEL&&!TOUCH_SEL.dead&&TOUCH_SEL.el)TOUCH_SEL.el.classList&&TOUCH_SEL.el.classList.remove('touch-sel');
  TOUCH_SEL=null;
}
function touchMoveSelTo(x,y){
  if(!TOUCH_SEL||TOUCH_SEL.dead||!TOUCH_SEL.mb)return;
  Matter.Body.setPosition(TOUCH_SEL.mb,{x:x,y:y});
  Matter.Body.setVelocity(TOUCH_SEL.mb,{x:0,y:0});
  TOUCH_SEL.x=x;TOUCH_SEL.y=y;
  if(TOUCH_SEL.mb)Matter.Sleeping.set(TOUCH_SEL.mb,false);
  touchClearSel();
}
var ROD_LOCK_HOST=false;   // 杆宿主冻结自转开关（false=可绕连接点摆动）
var TIME_SCALE=1;          // ★R131-34：世界时间倍率（Δt）——1 正常、0 静止（右键字符 t 调）
var ROD_HINGE_DAMP=0.985;  // ★R131-33：铰接摩擦（0.985 ⇒ 摆动 2~3 次后停下；1=永不衰减）   // ★R131-26：杆宿主冻结自转开关（false=物体可绕连接点摆动=复摆物理）
/* ★★★R131-64b（用户 2026-10-01：「现在的杆连接物体后…铰链是不是摩擦力太大了，你看这
 *  半天不旋转回复最低势能点，是不是要搞光滑点？**之前不是这样啊**」）：
 *
 *  【先把上一轮的结论改准】R131-64 把 `rodHingeTorque` **整体停用**是**过度修复**：
 *   · 该函数内部本来就已按「另一端是不是枢轴」分流（`_oAnvil` / `_oDyn`）：
 *       另一端**自由**      ⇒ `continue`（不施）—— 这是 bug③ 的正确修法 ✔
 *       另一端**动态体**    ⇒ 施"对端载荷重量"的力矩 —— 这是 bug④ 的正确修法 ✔
 *       另一端**静态/铁砧**  ⇒ 施 τ = r×m·g —— **这才是真枢轴（悬在墙上的复摆）** ✔
 *     三段里唯独第三段是对的、且**必须保留**：它就是用户要的"重力把物体拉回最低势能点"。
 *   · 整体停用 ⇒ 连铁砧端也丢掉唯一的重力回复力矩 ⇒ 物体姿态只剩 PBD 位置相位的旋转
 *     修正（被 `ROD_ROT_MAX=0.02` rad/次封顶）在爬 ⇒ 实测 60° 释放要 **609 帧(10.15s)**
 *     才回到最低点（`_diag_r272` O0），大角度时更长 ⇒ 用户看到的"半天不旋转回复"。
 *
 *  【三态开关】（默认 1）
 *    `ROD_HINGE_TORQUE=1`  ★默认：**只对铁砧端（真枢轴）施力矩** —— 复摆动力学回来，
 *                          姿态按 |r|·m·g/I 的时间尺度摆回最低点；自由端/动态端仍不施
 *                          （bug③④ 的修法原样保留，不回归）。
 *    `=0`  全停（R131-64 的行为；姿态完全交给 PBD ⇒ 慢但守恒，作为保守回退位）。
 *    `=2`  全开（含动态端"对端载荷力矩"，= R131-64 之前的行为：注能 +1.1420×KE峰，仅供对照）。
 *
 *  ★为什么"只加铁砧端"不会把 bug④ 的注能带回来：注能链条是「对**动态/自由端**施力矩 ⇒
 *    ω 被推到钳位 9 rad/s ⇒ 锚点绕质心飞 ⇒ 位置相位大搬运 ⇒ rodXPBDVel 把瞬移当速度」。
 *    铁砧端那一支**不经过**这条链：宿主是**被约束方**（不是铁砧自己），施力矩只是给 W 体一个
 *    绕悬点的重力回复驱动，位移量级 = |r|·θ̇·dt 远小于 ROD_PULL_MAX ⇒ 不触发大搬运。
 *    实测（`_diag_r272`）：只加铁砧端 ⇒ 回复到位、正漂 ≤0.05（守恒）。 */
var ROD_HINGE_TORQUE=1;
/* ★★R131-32c（用户：「杆固定在物体表面后，物体要能相对于固定点**光滑旋转**，根据
 *  其质量分布——和力矩有关」）：**复摆重力力矩**——Matter 的重力只作用于质心
 *  （不产生力矩）⇒ 锚定物体永远不会因重力绕锚点摆动（实测：只保持初始自转）。
 *  显式补 τ = r×F（r=锚点→质心，F=(0, m·g)）⇒ 物体像复摆一样绕固定点摆到稳定姿态。 */
function rodHingeTorque(dt){
  if(!MW||!MW.engine)return;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* ★★R131-52（用户：「器件铰链松手能吸，但我要的是**没松手时靠近就有红点并吸附过去**」）：
     *  预览扫描原来只处理**杆(T)** ⇒ 铰链器件(S+hinge)拖动时没有任何反馈。这里纳入铰链，
     *  并用它与弹簧一致的端点取值（springEnd）。 */
    var _isHingeRod=(R.kind==='S'&&R.hinge);
    if((R.kind!=='T'&&!_isHingeRod)||R.dead||!R.anc)continue;
    for(var e=0;e<2;e++){
      var a=R.anc[e];if(!a||!a.B||a.B.dead)continue;
      var h=a.B;
      if(h.kind==='T'||!h.mb||h.mb.isStatic)continue;
      if(R._rodAngleLock)continue;      // ★R131-33：固定角度 ⇒ 不施加力矩（姿态跟着杆）
      /* ★★R131-40（用户：「两物体通过铰链连接还是不断抽搐」）：实测「互不碰撞」已完全生效
       *  （_rcg/组=同负值、重叠时距离稳定不互推）⇒ 抽搐另有来源：**两端都锚在动态体**时，
       *  两个宿主各自被施加重力力矩、方向相反 ⇒ 互相打架振荡。
       *  修：**只有当"杆的另一端是静态体或未锚定"时才施加力矩**（真正的悬挂/复摆场景）；
       *  两端都是动态物体时完全不施力矩，姿态交给 PBD 约束（它们互相锁定）。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* ★★★R131-64（用户 2026-09-30，两条原话）：
       *  ③「我在挂在墙上的物体，用杆在其**侧面**连了一下，为什么物体像是受到力矩一样，
       *     连的那一边反作用**往上扭**？这个不应该是轻质杆吗，不应该是跟着物体运动，
       *     在**另一端没有连接时应该是不能影响物体运动**啊」
       *  ④「在上一问杆的另一端挂上物体后，第一个物体明明右边受力，但却右边往上翘，
       *     这不符合受力矩」
       *
       *  【本函数的物理前提被用错了】τ=rx·m·g 描述的是「物体绕一个**固定枢轴**摆动」——
       *  但这根杆的另一端**不是枢轴**时，锚点只是"杆与物体的连接点"：
       *    · 另一端**自由**：杆是轻质连杆，对物体的唯一影响是"杆自身的惯性"（≈0），
       *      施力矩 = 凭空把杆端当成枢轴 ⇒ 用户看到的"连着的那一边往上扭"。**必须不施**。
       *    · 另一端**是动态体**：整条链是"刚性连杆 + 两端载荷"的多体系统，动力学由
       *      rodSyncAnchors 的 PBD/XPBD 约束（位置+速度相位）负责。两端各施一次
       *      "绕自己锚点的重力力矩"是**重复计入**（每个体的重力已在 Matter 积分里），
       *      而且两侧 τ 方向相反 ⇒ 互相打架、能量泵。
       *    · 另一端**是静态/铁砧**（墙、地面、fixed 体）：**这才是真枢轴** ⇒ 照旧施力矩
       *      （复摆/单摆的正确动力学，R131-32c 的本来目的）。
       *
       *  【臂矩阵铁证】夹具「横梁 + 吊物A（**竖直平衡**，锚点在质心正上方 ⇒ 重力矩恒 0）
       *   + A 右侧面单端杆2」，GRAV=2600，400 帧（_diag_r251/_diag_r254）：
       *     A0 不加杆2（基线）        A 跨度 0.00/0.00  |ω|峰 0.00000  KE 恒 420.5
       *     A1 加单端杆2（现状）       A 跨度 42.73/35.25 |ω|峰 **0.12622**  KE 峰 464196.6
       *     A2 屏蔽整个 rodHingeTorque → 与 A0 **逐位相同**
       *     A3 `if(!_oB)continue`      → 与 A0 **逐位相同**
       *   ⇒ 单端杆的抽搐 **100%** 来自本函数把自由端当枢轴。
       *   记账钩子（_diag_r253）抓到 S1 首帧 A 的 ω 被本函数写成 −0.00941，与解析式
       *   τ = rx·m·g/I·dt²（rx = 400−440 = **−40**）逐位吻合 ⇒ 符号自洽，**语义用错**。
       *
       *  ★★★R131-64 终局（用户④「这整个系统还无故抽动，凭空获得大量动能」）：
       *  把「自由端/动态端」这两条堵住之后，**最后一层病根**露出来了 ——
       *  `rodSyncAnchors` 的位置相位对锚定 W 宿主把**旋转修正整个归零**
       *  （R131-31 / R131-44 的 `wN=0`，减肥原因见那里的注释），于是**姿态完全由本函数
       *  驱动**：每帧 Δω=(τ/I)·dt² 累加，被钳位卡在 **0.15 rad/帧 = 9 rad/s**
       *  （_diag_r258 S2 全臂 `|ω|峰=0.15000` 恒定 ⇒ 铁证）⇒ **锚点绕质心高速飞** ⇒
       *  rodSyncAnchors 位置相位每子步被迫把宿主搬 100+px ⇒ `rodXPBDVel` 用
       *  「完整子步位移 / dt」反推速度 ⇒ **瞬移被当成真实速度** ⇒ KE 爆炸。
       *  能量判据（正漂 max(E_tot−E_ref)/KE峰，标杆 A0 基线 = 0.0000；_diag_r256/r257/r259）：
       *     J0 现状（本函数在 + wN=0）              **+1.1420**  ← 注能
       *     J1 停用本函数（wN=0 仍在）              +0.0002  ← 守恒，但 Δθ=0（姿态被冻）
       *     J2 停用本函数 + 旋转相位全开              +0.0002  ← 守恒，且 A 自然**右沉** θ=+0.3828 ✔
       *     J3 J2 + 速度相位写回 ω                   +0.0203  ← 守恒，杆端残差峰 0.06→0.03 ✔
       *  S3 真复摆（铁砧端、初位偏离竖直 30°）J2 臂：θ 从 +0.5236 单调收到 0，方向正确、
       *  能量正漂 +0.0059 ⇒ **PBD 的位置+旋转相位自己就能给出复摆动力学**。
       *
       *  ⇒ **本函数是为补偿 `wN=0` 而加的补丁，撤销 `wN=0` 之后它就是纯粹的注能源。**
       *    按 R131-64 停用（保留函数体与 `ROD_HINGE_TORQUE` 开关，便于出问题时一键回退）。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* ★★★R131-64b：三态开关分派（默认 1 = 只对铁砧端施力矩，见常量处长注释）。
       *   0 ⇒ 全停（R131-64 的保守行为：姿态归 PBD，慢但守恒）
       *   1 ⇒ 只铁砧端（★默认，复摆动力学）
       *   2 ⇒ 全开（含动态端，R131-64 之前的行为；注能，仅对照用） */
      var _tqMode=(ROD_HINGE_TORQUE===true)?2:(+ROD_HINGE_TORQUE||0);
      if(!_tqMode)continue;
      var _oAnvil=(_oB&&((_oB.mb&&_oB.mb.isStatic)||_oB.fixed));
      var _oDyn=(_oB&&_oB.mb&&!_oB.mb.isStatic&&_oB.kind==='W');
      if(!_oAnvil&&!_oDyn)continue;      // ★另一端自由（或已死）⇒ 不是枢轴，不施力矩
      if(_tqMode<2&&_oDyn)continue;      // ★★R131-64b：默认模式**只走铁砧端**（真枢轴）
      /* ★★★R132（用户 bug⑤续查，`_tmp_r265_guard.py` 量证）—— **多杆链守卫**：
       *  τ=(C−M)×m·g 的物理出发点是「**一个**连杆接到固定枢轴」（单摆/复摆）。
       *  宿主 h 同时被**≥2 根连杆**锚住时，单摆模型不成立 —— 真正的约束是"多个锚点
       *  必须同时满足各杆长"，动力学由 PBD 约束层负责；此时再补一份单摆重力力矩
       *  会**压掉** bug④ 修好的「多杆链自然右沉」。
       *
       *  实测量（`_tmp_r265_guard.py`，r265 场景 墙—杆1—A—杆2—B，1200 帧）：
       *    A 无守卫 τ=1（本轮之前）  链锚A=2  ΔθA=**+0.0053**（右沉被压平） drift +0.0035
       *    B 加守卫 τ=1（本修法）    链锚A=2  ΔθA=**+0.5048**（右沉恢复）   drift +0.0035
       *    C 加守卫 τ=0（对照）      链锚A=2  ΔθA=**+0.5048**（与 B 逐位一致）
       *  ⇒ B≡C 证明「链锚=2 时本函数本来就不该出手」，且守住了 bug④ 的修正。
       *
       *  链锚数定义：满足 `R.anc[e].B===h` **且** `R.anc[1−e].B` 是在场活体的 (R,e) 个数。
       *    =1 ⇒ 单摆/复摆（另一端是枢轴或载荷）⇒ 照旧施力矩 ✔
       *    ≥2 ⇒ 多杆链 ⇒ 交回 PBD（不施）✔
       *  只作用于**铁砧端**分支；mode 2 的动态端分支原样不动。 */
      if(_oAnvil&&!_oDyn){
        var _nL=0;
        for(var _ri=0;_ri<bodies.length;_ri++){
          var _RR=bodies[_ri];
          if(_RR.kind!=='T'||_RR.dead||!_RR.anc)continue;
          for(var _re=0;_re<2;_re++){
            var _ra=_RR.anc[_re];if(!_ra||_ra.B!==h)continue;
            var _rb=_RR.anc[1-_re];
            if(_rb&&_rb.B&&!_rb.B.dead)_nL++;
          }
        }
        if(_nL>1)continue;
      }
      var _tw=1.0;
      if(_oDyn){
        /* 两端都动态（刚性连杆）：见下「继电器载荷力矩」，不再用本体的 m·g。 */
        var _rel=Math.abs((h.mb.angularVelocity||0)-(_oB.mb.angularVelocity||0));
        _tw/=(1+6*_rel);
      }
      var p=springAnchoredWorld(R,e);
      var rx=h.x-p.x, ry=h.y-p.y;                  // 质心 → 锚点
      var m=h.mb.mass||1;
      /* ★★R131-64（用户④「第一个物体明明右边受力，但却右边往上翘，这不符合受力矩」）：
       *  另一端**动态**时，物体受到的力矩来自**对端载荷的重量**（杆传力，两端严格等大
       *  反向）——这才是「绳/杆传力」的物理，也把"两边力矩互相打架"变成"一对作用反作用"。
       *  转矩：τ = r' × F，r' = 锚点 − 质心 = (−rx, −ry)（上方 rx 是**反号**的旧定义），
       *  F = (0, m_对端·g) ⇒ τ_z = r'_x·F_y = (−rx)·(m_对端·g)。
       *  ⚠ 用户④的另一半「系统无故抽动、凭空获大量动能」是**另一个**缺陷（PBD 约束层），
       *    不在本函数里 —— 见 _diag_r254 E4/E5 臂：加本项后 A 的 θ 由 −0.36（右翘，错）
       *    变为 **+0.2543（右沉，对）**，而 KE 峰只从 1.7428e6 降到 1.8650e6（同量级）。 */
      var tau, _mA=(h.mb.mass||1);
      /* ★★★R131-64c（用户 2026-10-01：「杆连接物体后铰链摩擦太大了，**半天不旋转回复最低势能点**，
       *  之前不是这样啊」）—— **真根因 = 上一轮把两段的 r 一起反号，只对了一半。**
       *
       * 【推导（Matter：y 向下、θ 顺时针为正 ⇒ τ_z = r_x·F_y − r_y·F_x，F=(0, m·g)）】
       *   ① 铁砧端（真枢轴）= **复摆**：重力的作用点是**宿主自己的质心**，力臂
       *      r = C − M（C=质心、M=锚点）⇒ **τ = +rx·m·g**。
       *      符号自检：C 在 M 右侧（rx>0）⇒ 重力把 C 往下拉 ⇒ 绕 M **顺时针** ⇒ τ>0 ⇒ 与 +rx 一致 ✔
       *   ② 动态端（另一端是动态体）= **杆传力**：宿主受的是"对端载荷重量"沿杆传来的力，
       *      作用点在**锚点**，力臂 r = M − C = −rx ⇒ **τ = −rx·m_对端·g**。
       *      ⚠ 两者的 r **本来就反向**（重力作用于质心 vs 张力作用于锚点），
       *      旧代码用一个 `-rx` 套两段 ⇒ 铁砧端被反号 ⇒ τ<0 ⇒ **把物体推离最低势能点**。
       *
       * 【为什么症状正好是"半天不转正"】反号的力矩把锚定物体驱向 **θ=π（质心在锚点正上方
       *  = 最高势能点）**，那是一个**非稳定平衡** ⇒ 物体在 60° 释放后**单调冲到 180° 并卡住**，
       *   同时每帧把 ω 推到钳位 0.15 rad/帧 ⇒ 看起来"有力矩在推着它、不往最低点回"。
       *   实测（`_diag_r277` 逐帧）：θ 1.047 → 1.110 → 1.360 → 1.919 → 2.651 → 3.863（冲过 π），
       *   ω 1.256 → 3.771 → 7.680 → **9.000(钳位)** rad/s。
       *
       * 【R131-64 为什么当年会这么改】用户③的原话（「在挂在墙上的物体**侧面**连了一下，
       *   为什么像是受到力矩、连的那一边反作用**往上扭**」）考的是**另一端自由**的场景 ——
       *   那一段 R131-64 已用 `continue` 正确堵住。而 `-rx` 那个反号是**顺手一起改的**，
       *   对铁砧端（真枢轴）恰恰是改错了 ⇒ 只剩副作用。
       *
       * 【臂矩阵（`_diag_r278`，60° 释放，洁净夹具 145mm 杆 + 40×40 吊物，|r|=40，I_cm=8557.7）】
       *   判据：首达 |θ|<0.15 帧号 / 末态 θ / |θ|峰 / 杆端残差峰 / θ 极值数
       *     G0 τ=0（R131-64 停用）   首达 **609 帧(10.15s)**  末 +0.011  |θ|峰 1.047  残差 0.00  极值 25
       *     G1 τ=+rx·I_cm ★         首达 **10 帧(0.17s)**   末 +0.007  |θ|峰 1.047  残差 0.00  极值 69
       *     G2 τ=+rx·I_pivot        首达 16 帧、残差 0.14、末 −0.004（更"物理"但慢一档）
       *     G4 τ=−rx（改动前现状）   首达 **609 帧**（与 G0 相同 —— 因为 τ<0 只会把它推向 π）
       *   ⇒ 取 **G1**：只改符号、不碰惯量口径、不叠 w1=0（角动能项 I_cm·ω 会让能量账在
       *     "位置相位瞬移"的夹具上虚高，与视觉无关；用户要的是"转得动、停得住"）。
       *
       * ⚠ 关于"能量正漂"判据的**失效声明**（诚实记录）：`rodSyncAnchors` 的位置相位是
       *   **纯瞬移**（`setAngle/setPosition`，r277 实测：30 帧内 θ 变 0.066 rad、A.y 变 66px
       *   而打印的 ω 恒 0.0000）⇒ PE 每帧在变、KE 不变 ⇒ `ET` 必然漂移，**与物理对不对无关**。
       *   故本 bug 的判据改为上表六条几何/行为判据，不再用 ET 漂移。 */
      var tau, _mA=(h.mb.mass||1);
      if(_oDyn){
        var _mo=(_oB.mb.mass||1);
        tau=(-rx)*(_mo*GRAV)*_tw;                  // ★R131-64c：杆传力，r = M − C（保持 −rx 不变）
      }else{
        tau=(rx)*(m*GRAV)*_tw;                     // ★★★R131-64c：复摆重力力矩 τ=(C−M)×m·g（由 −rx 改正）
      }
      /* ---- 锚点/质量自由端的兜底：另一端**自由**时上面已 continue，不会走到这 ---- */
      /* ★不用 mb.torque（Matter 内部口径与 px/s² 不匹配，实测爆炸 1e9 度）——
       *  按实测标定直接改角速度：ω 单位=rad/帧，Δω=(τ/I)·dt²（dt=1/60s）。 */
      var I=h.mb.inertia||1;
      var dw=(tau/I)*(1/60)*(1/60);
      if(isFinite(dw)){
        /* ★★R131-39：钳位原来是 ±8 —— 单位是 **rad/帧**（≈ 每秒 480 弧度），
         *  实际上等于没钳位 ⇒ 铰链物体被力矩抽得疯狂抖动。实测合理量级是 ±0.15 rad/帧。 */
        var _w=(h.mb.angularVelocity||0)+dw;
        if(_w>0.15)_w=0.15;if(_w<-0.15)_w=-0.15;
        Matter.Body.setAngularVelocity(h.mb,_w);
      }
    }
  }
}
/* ★★R131-38（用户：「铰链连接的两物体相互间不用边界判定，可以相互重叠」）：
 *  杆（铰链）相连的两个宿主 ⇒ 同一**负碰撞组**（Matter group<0 = 同组永不碰撞），
 *  边界判定把它们当成一个整体 ⇒ 消除「接触-分离」的边界抖动/抽搐。
 *  每帧先清零再按当前连接设置 ⇒ 解除连接后自动恢复可碰撞。 */
function rodSyncNoCollide(){
  var i;
  for(i=0;i<bodies.length;i++)if(bodies[i]._rcg){bodies[i]._rcg=0;
    if(bodies[i].mb)bodies[i].mb.collisionFilter.group=0;}
  for(i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* ★R131-41（用户澄清：「我指的是单独的**铰链器件**，不是杆」）：铰链在实现上是
     *  **S 体 + hinge 标记**（不是 T）⇒ 上一版只处理杆 ⇒ 铰链连接的物体仍在互撞。
     *  这里把 T（杆）与 S+hinge（铰链器件）一并纳入。 */
    if((R.kind!=='T'&&!(R.kind==='S'&&R.hinge))||R.dead||!R.anc)continue;
    var h0=(R.anc[0])?R.anc[0].B:null, h1=(R.anc[1])?R.anc[1].B:null;
    if(!h0||!h1||h0===h1||h0.dead||h1.dead)continue;
    if(h0.kind!=='W'||h1.kind!=='W')continue;        // 只处理物体-物体（墙/地面等静态体本来就不动）
    /* ★★★R131-63（**r106g G2 穿过地面 23.6px 的真因**，二分定位到 R131-41）：
     *  原来这里无条件把「铰链两端宿主」设成同一负组 ⇒ **连着的动态体也穿得过静态宿主**。
     *  而"静态宿主"恰恰就是**用户画的**地面/墙/挡板（kind 'W' + fixed）——它们是场景边界，
     *  不是"两个互相挤压的物体"。用户那句「两物体通过铰链连接不断抽搐」指的是
     *  **两个动态物体**互埋；把边界也纳入，代价是方块被压进地面（实测 23.6px）。
     *
     *  A/B 铁证（`_diag_r188.py` / `_diag_r189.py`，r106g G2 夹具：地面 A + 右墙 W，
     *  铰链把自由方块 B 拴在 A 上，A 与 W 都是 fixed 静态体，把 B 推到墙角按住 2s）：
     *    · 现状（两端都设负组）    A.g=B.g=−22042 ⇒ **A↔B 完全不碰撞**
     *                             静置 B 底 684.01（穿地 4.0px）→ 按住 2s **703.61（穿地 23.6px）**、
     *                             穿透 penmax=36.2px、位置跨度 dxy=6.9px（= 用户看到的"抖"）
     *    · 禁掉本函数（②组）      dxy 6.9→**1.16**、B 底回到 668（**站在地面上方**）
     *    · 只跳静态宿主（本修法） dxy 6.9→**1.15**、B 底 668 ⇒ 与②等价 ⇒ **静态体才是病根**
     *    · 且②与③在「两端都是动态体」时行为**逐位相同**（负组照设）⇒ 用户要的
     *      「相连不抽搐」语义**一点不损失**。
     *
     *  ★与 Matter 的静态体语义一致：静态体质量无穷大，真物理里它本来就推不动；
     *   把"不许穿透"让给碰撞求解器、只把"互不挤压"留给动态对，才是这套约束的本来面目。 */
    if((h0.mb&&h0.mb.isStatic)||(h1.mb&&h1.mb.isStatic))continue;
    var g=-(1000+((R._rid||(R._rid=Math.floor(Math.random()*50000)))%50000));
    h0._rcg=g;h1._rcg=g;
    if(h0.mb&&MW)h0.mb.collisionFilter.group=g;
    if(h1.mb&&MW)h1.mb.collisionFilter.group=g;
  }
}
function rodSyncLocks(){
  var i,e,B;
  for(i=0;i<bodies.length;i++){if(bodies[i]._rodLK)bodies[i]._rodLK=false;if(bodies[i]._hinged)bodies[i]._hinged=false;}
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='T'||B.dead||!B.anc)continue;
    for(e=0;e<2;e++){
      var a=B.anc[e];
      if(!a||!a.B||a.B.dead||!a.B.mb||a.B.mb.isStatic)continue;
      /* ★R131-24（用户：「两个杆直接连接则只在连接点生成一个转动的点，只算那一个
       *  自由度」）：**杆宿主不打锁**——杆是约束体不是刚体，杆-杆销接时每根杆都要
       *  能绕连接点自由转动（锁死杆1=混沌摆第一段不能摆=抽搐根源）。只有 W 体宿主
       *  锁角度（用户「直接固定角度锁死」语义）。 */
      if(a.B.kind==='T')continue;
      /* ★★R131-26（用户：「物体也应该绕连接点转动——静止时会到最低点，运动时由于
       *  向心力而摆动」）：**撤销宿主角度锁死**——铰接物体按质量分布绕连接点摆动
       *  才是正确的复摆物理（质心-连接点力臂产生力矩，静止平衡=质心在连接点正下方）。
       *  R131-21 的锁死是为了压抽搐，但抽搐真源是杆板（已删除）；锁死反而让
       *  「静止到最低点」的自然行为消失。保留开关 ROD_LOCK_HOST 便于回退。 */
      /* ★R131-33：杆开启「固定角度」⇒ 宿主**锁死自转**（姿态跟着杆走，连接点仍不动）。 */
      if(B._rodAngleLock)a.B._rodLK=true;
      a.B._hinged=(!B._rodAngleLock);   // ★R131-33：固定角度时恢复 ω 重建（随杆同步）
      if(ROD_LOCK_HOST){
        a.B._rodLK=true;
        if(a.B.mb.angularVelocity)Matter.Body.setAngularVelocity(a.B.mb,0);
        if(a.B.om)a.B.om=0;
        continue;
      }
      /* ★★R131-32（用户：「杆固定在物体表面后，物体要能相对于固定点**光滑旋转**，
       *  根据其质量分布、和力矩有关」）：**撤销铰接角速度阻尼**（R131-26b 的 0.97）
       *  ——阻尼会阻碍重力力矩驱动的复摆转动（实测转动被压死）。姿态完全交给物理。 */
      /* （保留开关便于回退：ROD_HINGE_DAMP<1 时启用阻尼） */
      if(ROD_HINGE_DAMP<1&&a.B.mb&&a.B.mb.angularVelocity){
        Matter.Body.setAngularVelocity(a.B.mb,a.B.mb.angularVelocity*ROD_HINGE_DAMP);
      }
      if(ROD_HINGE_DAMP<1&&a.B.om)a.B.om*=ROD_HINGE_DAMP;
    }
  }
}
// R71④：弹簧阻尼系数（可在参数面板调到 0 = 无阻尼）。缺省回落到 SPR_DAMP（旧手感不变）。
// R88⑤：阻尼随 √ks 放大（见上面三个常量的注释）—— 目的是让**阻尼比** ζ = D/(2√(km)) 不随 k 漂。
// 旋钮语义因此保持一致：「k 越大越干脆」，而不是「k 越大越像乱抖」。ks ≤ 默认值时 gain=1，逐位不变。
//
// ★★R104-7（用户：「高中模式下的阻尼参数怎么调节的只是像在调节弹簧的劲度系数一样？
//    不应该是调节弹簧的能量耗散速率吗？」）—— 旧实现在高中模式**直接 return 0**，
//    于是面板上那个阻尼滑块在高中模式下**完全没有作用**。此时唯一还能让「拉长后停下来」
//    变快的旋钮就只剩 ks（劲度越大 ⇒ 振荡频率越高 ⇒ 一个周期里耗散掉的份额也越大），
//    用户的感知正好就是「阻尼在调劲度」。这不是调参问题，是**语义缺失**。
//
// 现在高中模式把面板值解释成**阻尼比 ζ**（无量纲的能量耗散速率）：
//     ζ = damp / SPR_HIGH_ZETA_DIV      （面板 0..30 的常用段 → ζ 0..3，默认 7.1 → ζ=0.71）
//     D = 2·ζ·√(keff·μ)                 （μ = 两宿主的**折合质量** m0·m1/(m0+m1)）
// 为什么这样写才叫「耗散速率」：Rayleigh 阻尼的力是 F = −D·v_rel，单位时间耗散的能量
// 就是 P = D·v_rel² —— D 本身就是耗散速率系数；而 ζ = D/(2√(kμ)) 是它相对临界值的**比值**，
// 所以「滑块 = 耗散速率（相对临界）」是**字面**成立的，而不是换了个说法。
// 默认 ζ=0.71 的效果恰好是用户要的两条：
//   · 竖直弹簧拉伸后**迅速回到平衡位置**（ζ≈0.7 只有约 4% 过冲，一个来回就停住）；
//   · 水平弹簧被撞后两端**快速达到共速**（同一根 D 作用在 v_rel 上，相对速度指数衰减）。
// ζ→0（滑块拉到 0）= 完全无耗散，理想简谐振荡照旧保留（负对照见探针 A7）。
// μ 取两端**真实可动体**的折合质量；两端都没有质量（铁砧+自由端）时归一到 1kg，
// 保证滑块仍然单调可感（不会因为 μ=0 让整个阻尼消失）。
var SPR_HIGH_ZETA_DIV=10;
function springRedMass(h0,h1){
  var m0=(h0&&h0.mb&&!h0.mb.isStatic)?(h0.mb.mass||0):0;
  var m1=(h1&&h1.mb&&!h1.mb.isStatic)?(h1.mb.mass||0):0;
  if(m0>0&&m1>0)return m0*m1/(m0+m1);
  if(m0>0)return m0;
  if(m1>0)return m1;
  return 1;
}
function springDamp(B,h0,h1){
  var d=(B&&B.damp!=null)?B.damp:SPR_DAMP;
  if(PHYS_MODE!=='high')return d*springDampGain(springKEff(B?B.ks:SPR_KS_DEF));
  var z=d/SPR_HIGH_ZETA_DIV;
  var k=springKEff(B?B.ks:SPR_KS_DEF);
  return 2*z*Math.sqrt(k*springRedMass(h0,h1));
}
function stepSprings(dt){
  springKBook();         // R88⑤：宿主刚度账本（超预算时同比例缩水，见该函数注释）
  springSyncLocks();     // R65：方向锁宿主冻结自转（清角速度 + 打 _lockRot 标志，供 springForceOn 用）
  rodSyncLocks();        // ★R131-21：杆锚定宿主角度锁死（同 _lockRot 通道）
  rodHingeTorque();      // ★R131-32c：复摆重力力矩（锚定物体绕固定点摆动）
  rodSyncNoCollide();    // ★R131-38：铰链两物体互不碰撞（消除边界抖动）
  springSyncGroups();
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='S'||B.dead)continue;
    springSyncEnds(B);
    var freeEndOnly=false;               // R71③：只有一端拴住 = 自由端无载荷 → 内力恒为 0
    if(B.dirLock)springRailFollow(B);    // R65：垂直方向导轨跟随（整体一起平移）
    // R95：放松态（高中 + 水平导轨 + 非拖拽）里**只能**跳过导向力 —— springGuideForce 的作用
    //   是把「偏离导轨的锚点」用一根横向小弹簧拽回导轨，而水平导轨的法向就是竖直方向：
    //   跑它 = 拿 keff*off 的竖直力继续把物体吊在半空（与放松的语义直接对冲）。
    //   跳过它之后锚点与端点的偏移（|o|）才允许长期存在 —— 那正是「连接点可以变动」。
    if(B.dirLock&&!springRailRelaxed(B))springGuideForce(B,dt); // R64：方向锁的垂直导向力（轴向力在下面统一算）
    var dx=B.e1.x-B.e0.x,dy=B.e1.y-B.e0.y,d=Math.hypot(dx,dy)||1e-6;
    var ux=dx/d,uy=dy/d;
    var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
    // R71③：两端都拴住时没有「自由端」，跟踪基准立刻作废 —— 否则「两端拴住 -> 放开一端」时
    // 会拿一份隔了很久的过期基准去补位移，自由端会瞬移一大截。
    if(h0&&h1)B._freeTk=null;
    // R71③（用户：「当弹簧连接一端有物体时，为什么另一端会虚空固定？不是说了是轻质弹簧吗，
    // 应该随着固定的物体而动啊」）：只有**一端**拴住时，自由端此前是一个永远不动的世界坐标
    // —— 等于把弹簧的另一头钉在虚空里，宿主走到哪，弹簧就被拉长到哪里，还持续对宿主施加
    // 恒定虚假拉力。轻质（无质量）弹簧的自由端没有质量可被加速，其内力必须为 0，弹簧只能
    // 整体跟着宿主走、并保持在自然长度上。做法见下（按宿主位移跟随，而不是按原长重算位置）。
    // R71③ 修正（回归 r60b 2a / r60c 1d / r62 1h-2 暴露）：第一版把自由端**每帧按方向+原长
    // 重算**，结果是自由端被钉在「沿当前方向、恰好原长」的位置上 —— 它只能转、不能挪。
    // 而「把弹簧另一头拖到别的物体上」正是靠拖这个自由端完成的，于是**第二端再也拴不上任何
    // 东西**（实测 anc 从 ['W','W'] 退化成 [None,'W']，弹簧永远只有一端受载）。这是比原 bug
    // 更严重的功能损失。
    // 正确做法：不改自由端的位置，只让它在**宿主平移时跟着走** —— 用户 ③ 的原话是
    // 「应该随着固定的物体而动」，要的是「不被钉在世界坐标里」，不是「按原长钉在轴上」。
    // 实现：记下上一帧的「宿主位置 + 自由端位置」；只有当自由端**没有被外力移动过**时才把
    // 宿主的位移量补给自由端。用户（或手柄）动了自由端 -> 本帧不补，直接重记基准，
    // 于是拖拽永远赢，而宿主自己走的时候自由端跟着走。方向、长度都不再被改写。
    /* ★R106-8：光滑铰链**不走**这条自由端跟随 —— 它由 springSyncEnds 的「未锚端 = 已锚端」
     *   直接对齐（销是一个点）。若在这里再补一次质心平移，就会与那条对齐互相追打：
     *   本块每帧把未锚端搬走、下一帧 syncEnds 又拉回来 ⇒ 每帧一次的往返抖动。 */
    if(!B.dirLock&&(h0||h1)&&!(h0&&h1)&&!B.hinge){
      var hostF=h0||h1,fEnd=h0?B.e1:B.e0,tk=B._freeTk;
      // 正在被拖的弹簧：几何归指针管，这一块一律不碰位置。否则会撞上「拖弹簧 = 平移整个
      // 装配体」这条规格（springMoveRig 会把宿主也搬走）：宿主被搬到半空后按重力下落，而
      // 自由端在指针停住的那几帧里被判为「用户没动它」-> 跟着宿主一起下坠，于是松手时
      // 刚对准目标的端点已经飘出 SPR_PAD(15px)，**第二端永远锚不上**（r60b 2a 实测偏 27.4px）。
      // 拖动期间只刷新基准，让松手后的第一帧从正确的位置起算。
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
    // R101⑦：轻绳 / 光滑铰链走**各自的约束求解**（位置 + 冲量投影），与弹簧力律完全分开。
    // continue 同时跳过本函数尾部的 springMirror(B) —— 两者都不该有 Matter 镜像（见上方语义段）。
    if(B.rope){
      if(!B.nodes)initRopeNodes(B);    // ★R131：旧绳/加载恢复自动链化
      /* ★R131-15：绳锚点逐帧刷新已撤销（见 springAnchorOffset 的 R131-15 段）——
       *  锚点钉材料点随宿主转，固定点永不滑动（用户拍板高中绳=大学绳）。 */
      ropeVerletStep(B,dt);
      ropeSolve(B,dt,h0,h1);continue;
    }
    if(B.hinge){hingeSolve(B,dt,h0,h1);continue;}
    // G（用户：「弹簧压缩到一定程度后不能继续压缩，相当于直接碰撞」）：弹簧有最小工作长度
    // （线圈不可重叠 = 物理弹簧压到底）。两道保险防止"反向压缩"：
    // ① 稳定轴 B._ax/_ay：端点近重合时 (dx,dy)≈0，u 漂移；端点一旦交叉，u 反向，斥力变成
    //    把两端往错误方向推。用上一帧稳定方向代替，斥力始终沿正确方向把两端推开。
    // ② 交叉检测（有向投影 proj<0 = 端点已越过对方）：一旦越过，力按 minLen 算（最大斥力），
    //    不让 d 继续涨回去使 ks*(d-len) 翻正成吸引力 —— 否则交叉后两端分开到 d>len 时，
    //    力变拉力把两端往错误方向越拉越远 = 反向压缩的根因。
    // ③ dEff=max(d,minLen)：压到底后力不再随 d→0 发散，固定在"触底"斥力，相当于刚性挡板。
    var minLen=Math.max(8,B.len*0.12);
    if(B._ax==null){B._ax=ux;B._ay=uy;}
    var projG=dx*B._ax+dy*B._ay;          // 有向投影：>0 正常，<0 已交叉
    var crossedG=projG<0;
    if(!crossedG&&d>=minLen){B._ax=ux;B._ay=uy;}  // 正常时更新稳定轴
    if(crossedG||d<minLen){ux=B._ax;uy=B._ay;}    // 触底/交叉时用稳定轴
    var dEff=crossedG?minLen:Math.max(d,minLen);
    // v_rel > 0 表示两端在互相远离：拉长的过程要被阻尼压住，否则永远荡不停。
    // R59（用户「越弹越快，能量不守恒」）：阻尼项符号原来是负的 —— f=ks*(d-len)-DAMP*vrel
    // 意味着「分离越快，回复力越小，甚至反号把两端往外推」，这是**反阻尼**（振幅指数增长）。
    // 之前没炸是因为 Matter 自带 frictionAir≈0.01 在替它泄能，把负阻尼盖住了；一旦场景里
    // 泄能通道弱（球在地上弹、弹簧长、ks 大），振幅就肉眼可见地越弹越大。 Rayleigh 阻尼的
    // 正确写法：F_damp = -D*(dd/dt) 沿 ∂d/∂e —— h1 受 -D*vrel*u，折进 f 就是 +DAMP*vrel。
    var vrel=springHostVel(h1,ux,uy, h1?B.e1.x:null,h1?B.e1.y:null)
            -springHostVel(h0,ux,uy, h0?B.e0.x:null,h0?B.e0.y:null);
    // R88⑤：力上限随 ks 换算（见 SPR_FMAX 注释）。旧代码把 24000 写死 —— 那是「ks = 默认值」
    // 那一档的数字，写死它等于宣告「k ≳ 3600 的弹簧就是一台 24000 的恒力机」。
    // keff 是**被稳定墙截断后**的刚度（见 SPR_K_MAX）：截断后 k 越大越硬这条语义仍然成立，
    // 只是超过上限之后按「本机最硬的可稳定弹簧」执行。share 是宿主预算的分摊比例 ——
    // 同一个宿主上挂 n 根弹簧时，它们分 SPR_K_MAX 这一份，刚度从「叠加到爆」变成「封顶」。
    var keff=springKEff(B.ks)*Math.min(springKShare(h0),springKShare(h1));
    var fmax=springFMax(keff);
    var f=clamp(keff*(dEff-B.len)+springDamp(B,h0,h1)*vrel,-fmax,fmax);
    // R71③：自由端无载荷（见上）→ 内力必须为 0。否则「一端拴住」的弹簧会靠阻尼项
    // D·v_rel 对宿主施加一个沿轴向的恒定虚假阻力（宿主下落时 v_rel≠0，f 就非零），
    // 用户看到的就是「弹簧拖住了物体」。
    if(freeEndOnly)f=0;
    // 力的方向：u 是 e0->e1。拉长（f>0）时 e1 这一端要被拽向 e0，也就是沿 -u；e0 那端沿 +u。
    // 首轮把这两个符号写反了 —— 拉长反而把两端推得更远，形变量指数发散（实测 0.5s 里宿主
    // 从 500 冲到 796）。
    // R78（用户⑤「弹簧压缩到最小后碰撞吸能」）：触底反射必须作用在**本帧弹力施加之前**的
    //   轴向速度上。完整推导见下方触底块的长注释；这里只是把两个宿主的「施力前轴向速度」
    //   存下来（此刻 ux,uy 已经替换成触底/交叉时用的稳定轴 B._ax/_ay，与随后施力的方向一致）。
    B._sv0=(h0&&h0.mb&&!h0.mb.isStatic&&h0.kind!=='S'&&!h0.dead)?(h0.mb.velocity.x*ux+h0.mb.velocity.y*uy):null;
    B._sv1=(h1&&h1.mb&&!h1.mb.isStatic&&h1.kind!=='S'&&!h1.dead)?(h1.mb.velocity.x*ux+h1.mb.velocity.y*uy):null;
    if(f){
      // 力作用在**锚点**上（e0/e1 就是锚的世界坐标），宿主才会绕挂点转 —— R60b
      springForceOn(h0, f*ux, f*uy,dt, h0?B.e0.x:null, h0?B.e0.y:null,keff);
      springForceOn(h1,-f*ux,-f*uy,dt, h1?B.e1.x:null, h1?B.e1.y:null,keff);
    }
    // G-collision（位置+速度约束）：力通道有 ±24000 限幅，重物/高速冲击时一帧刹不住——
    // m=5、v=5000px/s 时一帧位移 83px，远超 minLen(20px)，stepSprings 检测到触底时
    // 端点早已穿透。必须像物理引擎处理穿透一样做**位置修正 + 速度清零**：
    // ① 位置修正：沿稳定轴把两端推回到 d=minLen（穿透量 = minLen - projG，projG<0 交叉时
    //    穿透更大），质量加权分配（重的少动）。
    //    ⚠ R77（用户⑤「弹簧连接两个物体碰撞时，一旦弹簧被压缩到最小后，碰撞就会产生大于之前
    //    的动能，导致一直叠加」）的关键：**第三参必须省略**。本工程内嵌的 Matter 0.20 里
    //    setPosition(e,t,n) 的 n 是「把位移当速度」的传送语义 ——
    //        n 真 : velocity = delta（且 positionPrev = 旧位置）
    //        n 缺省: positionPrev += delta（速度原样保留）
    //    旧代码传 true，于是每次触底都凭空把两端速度**赋值**成 penG，与碰撞前的动能毫无关系；
    //    弹回去再来一次就再加一次 ⇒ 越弹越快。实测（_diag_r77_sprmin.py，GRAV=0/damp=0 的
    //    隔离台，总机械能必须守恒）：注入 50+ 次、单次最大 142.6px/步，触底相对速度
    //    1699→1746→2022→2284→3888→9825 px/s，末窗能量 94 倍。缺省值 = 位置修正而速度不变，
    //    再配合下面的速度清零 = 触底当「完全非弹性挡板」，能量单调不增。
    //    （全工程另外 6 处 setPosition 调用本来就没给第三参，这一处是唯一的例外。）
    // ② 速度清零：清掉接近方向的线速度分量 = 非弹性碰撞响应。角速度分量由力通道后续帧处理。
    // R77（用户⑤ 第二条通道）：触底的**判据与响应必须同源** —— 都用 Matter 本体的速度（px/步）。
    //   `vrel` 是 JS 侧派生量（stepMatter 每帧用「位置差分 × 校正系数」写回），会被**本块自己
    //   上一帧的位置修正**（setPosition 传送）污染。_diag_r77_bot.py 在真实连续触底里实测：
    //     · 深触那次 vAjs=+480px/s 而 vAm*60=+332（幅值差 1.446 倍）⇒ 削掉 8.0px/步而实际只有
    //       5.53 ⇒ 把物体**反向推**出去；
    //     · 后续几次 vAjs=+94.5 而 vAm*60=-52.3（**符号相反**）⇒ 判据说「还在接近」其实已经在分离。
    //   拿这种值当接近速度，等于把「该刹停」算成「该反推」，每弹一次多给一点能量 —— 这正是
    //   用户报的「动能变大、一直叠加」的第二条通道（第一条是 setPosition 第三参，见上面注释）。
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
      // R77：速度响应也走 Matter 口径（同一帧、同一来源、同一单位，不再跨通道换算）。
      //   顺带把「只有 v0g>0 才处理」的符号判据也钉在 Matter 上 —— 反射过一次之后本体的轴向
      //   速度已经变号，下一帧不会重复反射（用 JS 派生量就会重复施加）。
      // R78（用户⑤ 的第二条通道：触底「吸能」）：反射的目标速度必须取**本帧弹力施加之前**的
      //   轴向速度（B._sv0 在施力前存下的那个），而不是施力之后的本体速度。
      //   推导（1D 复刻 `_replica_r77_scheme.py` 与页面 `_diag_r77_ab.py` 双向验证）：
      //     frame() 的次序是「Matter 推进位置 → stepSprings 施力 → 触底块」，所以触底判据是在
      //     位置**已经推进过整整一帧**之后才成立的。这一帧里物体其实只有一小段（≈ minLen/|v| 帧）
      //     真的贴住挡板，但弹力却按「整帧都压在挡板上」结算了一份方向恒定、幅值固定的冲量
      //     f=ks(minLen−len)（本例 −2600 ⇒ Δv=+1.4444px/帧）。把这份虚假冲量也算进反射，等于
      //     **每弹一次就多扣一份整帧触底冲量**。实测（ks=50/len=60/minLen=8/起始振幅 140px、
      //     GRAV=0/damp=0）：旧写法每次触底 ΔH̃=−47001，振荡能量 49 万在 ~10 个周期内塌到
      //     6.8 万 —— 而 6.8 万恰好 = ½ks(minLen−len)²，也就是「刚好够碰到挡板」的振幅：
      //     能量一直被吃到再也碰不到挡板为止（A/B 实测 P2 比值 0.304，同参数的 P3 不碰挡板 0.993）。
      //   改为反射「施力前速度」= 这份虚假冲量不参与反射；1D 复刻里塌缩立刻停止（稳定在 38.6 万，
      //     且是**不动点**而不是缓降），页面 A/B 的 P2 比值 0.304 → 0.960。
      //   注意这**不是** L018 反阻尼族式的能量维护：没有目标能量、没有增益系数，只是把反射时刻
      //     从「施力后」挪回「施力前」，即撤掉一份本就不该参与碰撞响应的冲量；冲击速度越大扣得
      //     越多这一点也不变（E<1 时仍按 SPR_STOP_E 衰减）。
      // ★R117 回退 R105-7（用户：「高中模式弹簧被大初速撞击后像完全非弹性＋整体反方向运动，
      //   这个也回退回去，弹簧改成之前的模式」）：撤掉「两端之间 1D 碰撞」（原 if(h0f&&h1f)
      //   保 Px 的碰撞块整段删除），恢复 R78 时代的「两端各自反号绝对轴向速度（撞墙反射）」。
      //   代价如实登记：两端都是自由体时 Px' = −E·Px（整体动量反号）——这正是 R105-7 当初
      //   要修的（_diag_r105v.py 实测 U-2 撞前 Px=+5732.50 → 撞后 −5454.16），用户拍板要旧手感。
      //   一端是铁砧/静止体时走撞墙反射（R78 的两条推导照旧成立）。
      if(h0f){
        var mv0g=h0.mb.velocity||{x:0,y:0}, v0g=mv0g.x*ux+mv0g.y*uy;
        var v0p=(B._sv0==null)?v0g:B._sv0;              // R78：施力前的轴向速度
        if(v0g>0){
          var dvg=-SPR_STOP_E*v0p-v0g;                  // 目标轴向速度 = −E·(施力前速度)
          Matter.Body.setVelocity(h0.mb,{x:mv0g.x+dvg*ux,y:mv0g.y+dvg*uy});
          Matter.Sleeping.set(h0.mb,false);
        }
      }
      if(h1f){
        var mv1g=h1.mb.velocity||{x:0,y:0}, v1g=mv1g.x*ux+mv1g.y*uy;
        var v1p=(B._sv1==null)?v1g:B._sv1;              // R78：施力前的轴向速度（同 h0，见上）
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
  /* ★★R131-63f-2（用户原话：「绳子也是如此，一起修」）——**全场收口，必须是本函数最后一句**。
   *  `frame()` 的顺序是 `stepPhysics → stepMatter → stepSprings`，而 stepSprings 里
   *  **每条绳按 bodies 顺序各解一次**。拖「绳2」时逐子步实测（_diag_r237，绳长 170）：
   *      springPinHostsToOtherAnchors（收在 springMoveRig 末尾）出口 d1 = 170
   *      conPull ← ropeSolve(绳1)   写出 A=420.278  d1 = 170
   *      springMoveRig（拖绳2搬宿主A）写出 A=421.845  d1 = 195.594   ← 绳2 把 A 拉出去
   *    ⇒ 绳1 先解（收到 170），**绳2 后解**（把 A 沿 B 方向拉出 23.6px）⇒ 后写者赢，
   *      帧末 d1 恒 **193.78~194.0** = 用户看到的「绳1 变长/脱钩」残留。
   *  收口放在这里 ⇒ 「全部绳解完之后」最后一句永远是「被铁砧端钉住的宿主 = 绳长」
   *  （纯径向、无上限、幂等）；绳只拉不推 ⇒ 松弛态一句都不碰，与上面的 ropeSolve 同语义。 */
  springPinHostsToOtherAnchors(null,null);
}
// 端点与「别的物体」的距离（点不在端点附近就不算接触）——锚定判定就靠它
function segPointDist(ax,ay,bx,by,px,py){
  var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
  var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
  if(t<0)t=0;else if(t>1)t=1;
  return Math.hypot(px-(ax+ex*t),py-(ay+ey*t));
}
function segClosest(ax,ay,bx,by,px,py){
  var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
  var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
  if(t<0)t=0;else if(t>1)t=1;
  return {x:ax+ex*t,y:ay+ey*t};
}
// R61（用户：「弹簧和物体没有接触时就已经锚定了」）：把端点**吸附到宿主的表面上**。
// 判定带 SPR_PAD=15px 是为了手感（不用像素级对齐），但落点必须收到面上 ——
// 否则「已经锚定」却挂着 10~15px 的可见空隙，看起来就是没接触却粘住了。
// 与 distToHost 一一对应：笔画/图形 -> 墨迹折线，杆/弹簧 -> 线段，字母刚体 -> 转正后的方框。
function inkClosestPoint(B,px,py){
  if(!B.pts||B.pts.length<2)return null;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1,bd=1e9,best=null;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s,ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s,by=B.y+b[0]*s+b[1]*c;
    var q=segClosest(ax,ay,bx,by,px,py);
    var dd=Math.hypot(px-q.x,py-q.y);
    if(dd<bd){bd=dd;best=q;}
  }
  return best;
}
var SPR_MID_ZONE=30;   // ★R106-8：边中点吸附的作用半径（px）—— 从 80 收到 30，见下方死区注释
/*
 * ★★R104-8（用户：「增加一个弹簧吸附的效果，拖动弹簧靠近某一个物体的一个边时，在那里显示
 *   其这一边的相当于质心的连接点，并且靠近有吸附的效果，目的是为了方便将弹簧连上物体后，
 *   物体不发生侧翻」）。
 *
 * 物理依据（为什么这个点就是「相当于质心」的那个点）：对一块匀质矩形板，把质心**垂直投影**
 * 到某一条边上，落点恰好是那条边的**中点** —— 这正是「这一边的相当于质心的连接点」。
 * 为什么它能防侧翻：装在中点的拉力，连线过边的中心，相对质心的**力臂方向**与边的法线重合，
 * 于是拉力只会把物体沿法线方向拉/推，不会产生绕另一轴的倾覆力矩；而挂在**角点**上时，
 * 拉力对质心有一根长长的力臂（正是用户看到的「一接上就翻」）。
 *
 * 只对**方框类**宿主生效 —— 字母刚体（无 kind、有 hw/hh）与**闭合四边形 W 体**（手绘/形状工具
 * 画的方框，★R105-2 扩展）：杆/笔画/图形是细长或任意折线，「边」的语义不成立（杆的中点锚定会
 * 让杆端无法受力），它们继续走 hostClosestPoint。
 *
 * ★R105-2（用户：「我把弹簧移到物体的边旁边，没有显示那个中点啊，也没有靠近吸附的功能啊」）：
 *   原来这里写死 `if(host.kind)return null` —— **只认字母方框**。用户日常用的「物体」是
 *   画笔/形状工具**画出来的方框**（W 体），于是靠近它的边时既没有标记、松手也吸不到中点
 *   （实测 _diag_r105c 组 C：拖出虚影时砖红像素 **0**；松手锚点落在最近墨线点 x=733，
 *   而不是下边中点 x=700）。物理依据对 W 方框**逐字成立**（匀质矩形板、质心在边上的垂直
 *   投影 = 边中点 ⇒ 拉力无力臂、不侧翻），所以把同一判定推广过去，不是新开一套规则。
 *   边界：只认**闭合且恰好 4 个角**的 W 体（矩形/平行四边形）；三角形、圆弧、凹槽、折线
 *   一律返回 null（「边中点 = 质心投影」对它们不成立）。
 *
 * 死区（SPR_MID_ZONE，★R106-8 起 =30，原 80）：中点离端点太远时不抢（否则在一条 240px 长的边上，用户明明
 * 拖到最右端，锚点却被吸到 120px 外的正中央 = 瞬移）。超出这个半径就退回 R65 的
 * 「离端点最近的表面点」，R66b 那条用户明确定过的规则在**近角点**处原样保留。
 * 返回 {x,y,mid:true} 或 null（不是方框宿主 / 够不着）。
 */
// ★R105-2：W 体（闭合四边形）的四条边中点。本地坐标 pts → 世界系（与 inkClosestPoint 同约定）。
function wQuadMidSnapPoint(host,px,py){
  if(!host.closed||!host.pts||host.pts.length!==4)return null;   // 只认四边形（见上）
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0);
  var best=null,bd=1e9;
  for(var i=0;i<4;i++){
    var a=host.pts[i],b=host.pts[(i+1)%4];
    var ax=host.x+a[0]*c-a[1]*s,ay=host.y+a[0]*s+a[1]*c;
    var bx=host.x+b[0]*c-b[1]*s,by=host.y+b[0]*s+b[1]*c;
    var mx=(ax+bx)/2,my=(ay+by)/2,dd=Math.hypot(px-mx,py-my);
    if(dd<bd){bd=dd;best={x:mx,y:my,mid:true};}
  }
  return (best&&bd<=SPR_MID_ZONE)?best:null;
}
/* ★★R131-50（用户新增功能：「铰链器件拖动时会自动吸附到物体的**角**处，和杆吸附在
 *  物体边中点一样有红点和吸附效果」）：返回离指针最近的**多边形顶点（角）**，
 *  在 CORNER_ZONE 内才命中。与 hostMidSnapPoint 同构、同一族（吸附优先级：角 > 边中点 > 表面点）。 */
var CORNER_ZONE=26;
function hostCornerSnapPoint(host,px,py){
  if(!host||host.dead)return null;
  var th=host.th||0,c=Math.cos(th),s=Math.sin(th);
  var best=null,bd=CORNER_ZONE;
  var pts=null;
  if(host.pts&&host.pts.length)pts=host.pts;                       // 画的多边形（本地系）
  else if(host.mb&&host.mb.vertices&&host.mb.vertices.length>2)pts=host.mb.vertices;  // 物理体顶点（世界系）
  if(!pts)return null;
  var isWorld=!(host.pts&&host.pts.length);
  for(var i=0;i<pts.length;i++){
    var p=pts[i],wx,wy;
    if(isWorld){wx=p.x;wy=p.y;}
    else{wx=host.x+p[0]*c-p[1]*s;wy=host.y+p[0]*s+p[1]*c;}
    var d=Math.hypot(px-wx,py-wy);
    if(d<bd){bd=d;best={x:wx,y:wy};}
  }
  return best;
}
function hostMidSnapPoint(host,px,py){
  if(!host||host.dead)return null;
  if(host.kind==='W')return wQuadMidSnapPoint(host,px,py);   // ★R105-2：画的方框也参与
  if(host.kind)return null;                                  // 杆/线/场源一律退出
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0);
  var dx=px-host.x,dy=py-host.y;
  var lx=dx*c+dy*s,ly=-dx*s+dy*c;
  var hw=host.hw||30,hh=host.hh||24;
  // 四条边各自的**中点**（本地坐标）—— 顺带算出端点到该边所在直线的距离选最近的一条
  var ex=1e9,ey=1e9,exx=0,eyy=0;
  var dR=hw-lx,dL=lx+hw,dB=hh-ly,dT=ly+hh;
  var mid=null,mind=1e9;
  if(dR<mind){mind=dR;mid=[hw,0];}
  if(dL<mind){mind=dL;mid=[-hw,0];}
  if(dB<mind){mind=dB;mid=[0,hh];}
  if(dT<mind){mind=dT;mid=[0,-hh];}
  if(!mid)return null;
  var wx=host.x+mid[0]*c-mid[1]*s,wy=host.y+mid[0]*s+mid[1]*c;
  if(Math.hypot(px-wx,py-wy)>SPR_MID_ZONE)return null;   // 太远不抢（见死区说明）
  return {x:wx,y:wy,mid:true};
}
/* ★★R105-1（用户：「那个铰链连接两个物体后，还是不断抖动，而且还穿模了」）----------------
 * 铰链端点的落点必须落在宿主的**碰撞面**上，不能落在墨迹中线上。
 *
 * 为什么（_diag_r105e / _diag_r105f 实测，先量后改）：
 *   · W 体的**碰撞几何** = 墨迹中线外扩 BND_INK（闭链走 inflateHull(...,BND_INK)，开链/弧走
 *     bndSegs 的 hh=BND_INK 定向矩形 —— buildMatterBody 里两处同值）。而吸附落点
 *     （hostMidSnapPoint / hostClosestPoint）给的是**中线**上的点 ⇒ 落点天生在碰撞体内部 2.325px。
 *   · 铰链两端**必须重合**（len=0 的销）。两个锚点各自在中线里 2.325px ⇒ 两端一重合，两个
 *     宿主的碰撞体就被迫互埋 2·BND_INK = 4.65px，这是一个**无解构型**：Matter 的位置求解器
 *     每步把可动宿主顶出去，hingeSolve 的 conPull 立刻把它拖回销上。
 *   · 实测（大方框 140×140 固定 + 小方框 70×70 铰在其右边缘中点，出生时两墨迹留 1.35px 空隙）：
 *     小方框绕着销摆进大方框，稳态穿透 **33~34px** 永不收敛；同一时刻 f 的 Matter 配对表里
 *     存着的碰撞深度只有 **0.139px**，而直接调 Collision.collides 是 **28.58px** ⇒ 帧内
 *     28px 振幅的 60Hz 振荡（rAF 采样落点同相位，逐帧净位移看着只有 0.09px 的假象）。
 *     负对照（同样两块方框、不装铰链、自然静置接触）：穿透 **0.000px**、逐帧位移 0.000px
 *     ⇒ 尺子没问题，是产品。
 *
 * 修法：把锚点从「中线」推到「碰撞面」上。外法向取**最近那条边的外法线** —— 与 inflateHull
 * 的边平移口径逐字一致，于是外扩 pad 后正好落在碰撞面上（角点处 inflateHull 走相邻边求交，
 * 比本式多 pad·(√2−1)≈0.96px，亚像素）。两个锚点在碰撞面上重合 ⇒ 两个碰撞体正好**相切**
 * （零重叠），销与接触解算器不再互斗；「小方框挂着时沿大方框侧面垂下」这种构型也第一次有了
 * 合法解（旧式要求它挂着时与大方框互埋 4.65px）。
 *
 * 只对**铰链**生效：弹簧/轻绳的锚定是单点附着，没有「两锚点必须重合」这条约束，落点一挪
 * 就会平移一批已标定的手感数值（r57 / R104-8 / R105-2），不动。轻绳的限制在**最大**间距
 * （不可伸长），与接触「不许更近」方向一致，本来就不互斗。字母刚体的碰撞体就是它自己的方框
 * （hostSurfacePad 返回 0）⇒ 那一支一字不变。
 */
function hostSurfacePad(host){
  if(!host)return 0;
  return host.kind==='W'?BND_INK:0;    // W 体：中线外扩 BND_INK 就是碰撞面；字母刚体/杆：0
}
function hingeSurfacePoint(host,q){
  if(!host||!q||!host.pts||host.pts.length<2)return q;
  var pad=hostSurfacePad(host);
  if(!(pad>0))return q;
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0),n=host.pts.length;
  /* ★★R132-9j（2026-10-02 两次尝试都失败，**回退到原实现**，留档防止再走一遍）：
   *  用户：「铰链对这个角的吸附…有点偏移」。`_diag_r323_snap.py` 实测：
   *    · 吸附**计算**是精确的 —— `hostCornerSnapPoint`/`snapPickCandidate` 与真实角点
   *      距离 0.000px（0°/30°/60°×三角三角）；端到端 `springTryAnchor()` 后锚点偏离角点
   *      **2.325px = 宿主表面 pad** ⇒ 偏移来自这一句外推，不是吸附。
   *  两次尝试都被 `_diag_r107b.py` Q3（「销锚在静态宿主表面时不抖」，R107-5 已修）打红：
   *    ① 角点**跳过**外推 ⇒ 两碰撞体互埋 ⇒ 抖（v=(0.0,49.1)px/s、dPos 0.186px）；
   *    ② 改用**角平分线**方向外推 ⇒ 同样互埋（平分线可能正对着另一个宿主）。
   *  ⇒ 这一句外推是 R105-1「铰链两锚点重合必须让两体相切而非互埋」的**必要手段**，
   *    幅度就是 pad；在角点上的"偏"是它的代价。**要真正消除，得让外推方向取
   *    「把两个宿主分开」的方向（要拿到另一端宿主的位置），而不是按单侧边的法线 ——
   *    留作专项，不要再用上面两种简化。 */
  var lim=host.closed?n:n-1,bd=1e9,ne=null,bi=-1,bq=null;
  for(var i=0;i<lim;i++){
    var a=host.pts[i],b=host.pts[(i+1)%n];
    var ax=host.x+a[0]*c-a[1]*s,ay=host.y+a[0]*s+a[1]*c;
    var bx=host.x+b[0]*c-b[1]*s,by=host.y+b[0]*s+b[1]*c;
    var qq=segClosest(ax,ay,bx,by,q.x,q.y);
    var dd=Math.hypot(q.x-qq.x,q.y-qq.y);
    if(dd<bd){bd=dd;ne=[ax,ay,bx,by];bi=i;bq=qq;}
  }
  if(!ne)return q;
  /* ★★R132-9o（用户：「跷跷板…把那个三角形固定后整体会抽搐…**切为高中模式后更加严重**」）：
   *  **顶点（角）上必须推到「斜接角」，不能是"沿单条边的法线推 pad"。**
   *
   *  为什么（解析 + 实测，先量后改）：
   *   · 碰撞壳 = `inflateHull(pts, BND_INK)`：每条边**平行外移** pad，每个壳顶点 = **相邻两条外偏线的交点**
   *     （斜接/miter）⇒ 壳角点离墨迹顶点 `pad/sinψ`（ψ = 顶角的一半），而单边法线只推 `pad`。
   *   · 于是"两锚点重合 ⇒ 两碰撞体相切"（R105-1 的立论）在**顶点上不成立**：本宿主的壳角点会朝着
   *     另一个宿主多戳出去 `pad(1/sinψ − 1)` —— 直角 0.96px、ψ=36.25° 1.61px、**顶角 40° 4.47px**。
   *   · `hingeContactUnfold` 的进入门是 `hingePairDepth > HINGE_UF_EPS(2.0)`。顶上那点余量一旦越过 2.0
   *     （顶角尖于 ≈65°，或两个宿主各戳一份），铰链就进入 R105-1 说过的**无解构型**：接触解算每帧把
   *     可动宿主顶出去、`conPull` 立刻把它拖回销上 ⇒ `d0 > dPre+0.5` 每帧成立 ⇒ unfold 每帧
   *     `Matter.Body.rotate` 宿主（**只改 angle/position、不改 angularVelocity**）⇒ 位姿写在速度通道
   *     之外 ⇒ **自维持极限环**。大学模式有空气阻力/摩擦压着（band 小），高中 `air=μ=e=0` ⇒ 全幅抽搐。
   *   · 实测（`_tmp_r354_miter_ab.py`，走产品真实吸附链，顶角 40/60/72.5/90°）：
   *     现行规则稳态互埋 **3.16 / 3.55 / 58.18 / 5.63 px**（> 2.0 ⇒ 门常开）；
   *     本规则互埋 **0.00 / 0.00 / 0.00 / 0.00 px**，高中段 θ 极差 34.3°/87.0° → **0.000°**。
   *   · 与 R132-9j 两次失败尝试的区别：①「跳过外推」把锚点放回**墨迹中线**（壳内 2.325px）⇒ 必红；
   *     ②「角平分线」用的方向是 `u1+u2`（**指向宿主内部**）且幅度仍是 pad ⇒ 往体内推，更糟。
   *     本支方向取**两条边的外法线之和**（外法向由"背离质心"选定，与 inflateHull 逐字同一条），
   *     幅度 `pad/cos(θ/2) = pad/sin(半顶角)` ⇒ 落点**恰好**是壳的斜接角。
   *   · 直线段上两外法线相等 ⇒ cosHalf=1 ⇒ 幅度回落为 pad、方向仍是外法向
   *     ⇒ **与改动前逐字节等价**（只有顶点分支是新的）。
   *   · 开链（笔画）的两个**端点**没有相邻边（壳走方帽），照旧退回单边法线；尖刺（cosHalf≤0.2，
   *     即内角 ≤23°）也退回，避免幅度爆掉。 */
  if(bi>=0&&bq){
    var dA=Math.hypot(bq.x-ne[0],bq.y-ne[1]);
    var dB=Math.hypot(bq.x-ne[2],bq.y-ne[3]);
    var k=-1;
    if(dA<pad)k=bi; else if(dB<pad)k=(bi+1)%n;
    if(k>=0&&(host.closed||(k>0&&k<n-1))){
      var pL=host.pts[(k-1+n)%n],vL=host.pts[k],nL=host.pts[(k+1)%n];
      var e1x=vL[0]-pL[0],e1y=vL[1]-pL[1],e2x=nL[0]-vL[0],e2y=nL[1]-vL[1];
      var L1=Math.hypot(e1x,e1y)||1,L2=Math.hypot(e2x,e2y)||1;
      var n1x=e1y/L1,n1y=-e1x/L1,n2x=e2y/L2,n2y=-e2x/L2;
      var m1x=(pL[0]+vL[0])/2,m1y=(pL[1]+vL[1])/2;        // 本地系里质心就是原点
      var m2x=(vL[0]+nL[0])/2,m2y=(vL[1]+nL[1])/2;
      if(n1x*m1x+n1y*m1y<0){n1x=-n1x;n1y=-n1y;}
      if(n2x*m2x+n2y*m2y<0){n2x=-n2x;n2y=-n2y;}
      var bsx=n1x+n2x,bsy=n1y+n2y,bl=Math.hypot(bsx,bsy);
      if(bl>1e-6){
        bsx/=bl;bsy/=bl;
        var cosHalf=n1x*bsx+n1y*bsy;                     // = cos(θ/2)，θ = 两外法线夹角
        if(cosHalf>0.2){
          var mag=pad/cosHalf;
          var lx=vL[0]+bsx*mag,ly=vL[1]+bsy*mag;
          return {x:host.x+lx*c-ly*s,y:host.y+lx*s+ly*c};
        }
      }
    }
  }
  var ex=ne[2]-ne[0],ey=ne[3]-ne[1],L=Math.hypot(ex,ey)||1;
  var nx=ey/L,ny=-ex/L;                                  // 边的法线（方向待定）
  var mx=(ne[0]+ne[2])/2-host.x,my=(ne[1]+ne[3])/2-host.y;
  if(nx*mx+ny*my<0){nx=-nx;ny=-ny;}                      // 取背离宿主质心那一侧 = 外法向
  return {x:q.x+nx*pad,y:q.y+ny*pad};
}
function hostClosestPoint(host,px,py){
  if(!host||host.dead)return null;
  if(host.kind==='T'){
    var hl=(host.len||170)/2,c=Math.cos(host.th||0),s=Math.sin(host.th||0);
    return segClosest(host.x-c*hl,host.y-s*hl,host.x+c*hl,host.y+s*hl,px,py);
  }
  if(host.kind==='S')return segClosest(host.e0.x,host.e0.y,host.e1.x,host.e1.y,px,py);
  if(host.kind==='W')return inkClosestPoint(host,px,py);
  if(host.kind)return null;                       // 场源不是可锚定的实体
  // 字母刚体：转到本地坐标，夹到 ±hw/±hh 的框上（已在框内时推到最近的那条边）
  var dx=px-host.x,dy=py-host.y,c2=Math.cos(host.th||0),s2=Math.sin(host.th||0);
  var lx=dx*c2+dy*s2,ly=-dx*s2+dy*c2;
  var hw=host.hw||30,hh=host.hh||24;
  var qx=clamp(lx,-hw,hw),qy=clamp(ly,-hh,hh);
  if(qx===lx&&qy===ly){                           // 点在框内：推到最近的边
    var ex=hw-Math.abs(lx),ey=hh-Math.abs(ly);
    if(ex<=ey)qx=(lx<0?-hw:hw);else qy=(ly<0?-hh:hh);
  }
  return {x:host.x+qx*c2-qy*s2,y:host.y+qx*s2+qy*c2};
}
// R66b 回退（用户：「锚点=最短连接改回上一版本」）：锚点恢复 R65 语义 = hostClosestPoint
// （离**端点**最近的表面点）。R66 的 hostClosestPointToLine（离导轨线最近的垂足落点）
// 已整段移除。
function inkPointDist(B,px,py){
  // 与 nearInk 同一套「贴线」几何，但返回距离而不是布尔
  if(!B.pts||B.pts.length<2)return 1e9;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1,bd=1e9;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s,ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s,by=B.y+b[0]*s+b[1]*c;
    var dd=segPointDist(ax,ay,bx,by,px,py);
    if(dd<bd)bd=dd;
  }
  return bd;
}
function distToHost(host,px,py){
  if(!host||host.dead)return 1e9;
  if(host.kind==='T'){
    var hl=(host.len||170)/2,c=Math.cos(host.th||0),s=Math.sin(host.th||0);
    return segPointDist(host.x-c*hl,host.y-s*hl,host.x+c*hl,host.y+s*hl,px,py);
  }
  if(host.kind==='S')return segPointDist(host.e0.x,host.e0.y,host.e1.x,host.e1.y,px,py);
  if(host.kind==='W')return inkPointDist(host,px,py);
  if(host.kind)return 1e9;                       // E/B/q/I 场源不是可锚定的实体
  // 字母刚体：转到本地坐标，算点到矩形框的距离（框内为 0）
  var dx=px-host.x,dy=py-host.y,c2=Math.cos(host.th||0),s2=Math.sin(host.th||0);
  var lx=dx*c2+dy*s2,ly=-dx*s2+dy*c2;
  var ox=Math.max(0,Math.abs(lx)-(host.hw||30)),oy=Math.max(0,Math.abs(ly)-(host.hh||24));
  return Math.hypot(ox,oy);
}
function springTryAnchor(B){
  // 用户规格②：只有**两端端点处**与其他物体发生接触才固定。所以判定点就是两个端点本身。
  for(var i=0;i<2;i++){
    if(B.anc[i])continue;                        // 已经拴住的保持原样（不抢不换）
    var e=springEnd(B,i),bd=SPR_PAD,hit=null;
    // ★R102：一根连接件的**两头不许拴在同一个宿主上**。
    //   根因（_diag_r102a_behavior.py 组 C 实测）：铰链构造时 e0≡e1（len 恒 0，两端重合），
    //   springTryAnchor 逐端扫描时**两端都落在同一根宿主上、且都满足 SPR_PAD** ⇒ 一次调用就把
    //   anc[0] 与 anc[1] 全部记成 A。后果正是用户报的「吸附到其他物体上后怎么吸不上其他物体了」
    //   —— 两端早已被 A 占满，B 永远轮不上（实测 anc0='A' anc1='A'，再吸 B 只能得到
    //   「两端都已拴住」）。铰链是要**连接两个物体**的，这个 bug 等于把它的唯一用途删掉了。
    //   修法就在筛选里加一条：候选宿主 == 另一端已经拴住的那个 ⇒ 跳过。
    //   对弹簧/绳同样成立：两端拴在同一块刚体上，内力自成闭环、对外恒为零，没有任何意义。
    var other=((i===0)?B.anc[1]:B.anc[0]);
    for(var j=0;j<bodies.length;j++){
      var h=bodies[j];
      if(h===B||h.dead)continue;
      if(grab.kind==='body'&&grab.obj===h)continue;   // 正在被拖的东西不算「固定物」
      if(other&&other.B===h)continue;                 // R102：另一头已拴在它身上 ⇒ 不能重复占
      // R102（用户：「那个铰链修改一下，不能吸到传送带上」）：铰链是把**两个物体**铰接起来的
      // 转动副；传送带是一条**自己会跑的地面机器**（钉死、带面带摩擦、有牵引），既不是「物体」
      // 也不该被铰住 —— 铰上去的后果是：约束去推一个 static 体（conSide 眼里 inverseMass=0，
      // 只准搬另一端）⇒ 铰链退化成一根把物体钉在带面上的桩，用户看到的是「铰链吸上去没反应
      // 或者把东西拽飞」。从候选里直接剔除比事后解绑干净（事后解绑会留下「吸上去又弹开」的抖动）。
      if(B.hinge&&h.belt)continue;
      // ★R131（用户：「那个铰链为什么能吸附在绳子上？不应该能吸附上啊」）：铰链是连接**两个
      //   物体**的转动副；轻绳是无质量幽灵（conSide 里 kind==='S' 直接 null，约束推不动它），
      //   铰上去之后销钉钉在一条可以被随便拽走的线上 —— 语义荒谬且行为坏。与 belt 同款，
      //   从候选里剔除。绳子自己（B.rope）落点吸附时也不许吸到绳/铰链上（同为幽灵互吸）。
      if(B.hinge&&h.rope)continue;
      if(B.rope&&(h.rope||h.hinge))continue;
      // ★R103-6：与 springTryAnchorByHost 里那条**逐字同款**（同一份语义的两个入口）——
      //   本端已通过铰链连着候选宿主 ⇒ 不许再直接锚（过约束互推，见那边注释）。
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
      /* ★★R131-57c（用户：「独立铰链现在还是能吸附在物体质心」——**真因**）：杆有"内部命中"
       *  分支（rodTryAnchor，R131-28 加的），而**弹簧/铰链这一族没有** ⇒ 把铰链端拖进物体
       *  **内部**时它**不吸附、就停在那里**（视觉上＝停在质心）。
       *  修：铰链端**进入物体内部也视为命中**，且落点一律收到**表面**（下面 B.hinge 分支
       *  已强制收到角/表面点）⇒ 拖到中心会被吸到**表面**，不会停在内部。 */
      if(B.hinge&&dd>=bd){
        var _dcIn2=Math.hypot(e.x-h.x,e.y-h.y);
        var _rIn2=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
        if(_dcIn2<_rIn2){bd=-1;hit=h;}          // 内部 ⇒ 命中（落点由 B.hinge 分支收到表面）
      }
    }
    if(hit){
      // R61（用户：「弹簧和物体没有接触时就已经锚定了」）：SPR_PAD=15 是为了手感（不必像素级
      // 对齐），但**落点必须收到宿主表面上**。旧实现直接把「离表面还有 10~15px 的落点」记成
      // 锚点，画面上就是「明明没碰到却已经粘住了」。这里先把端点吸到最近的表面点，再记偏移。
      // （R66b：恢复 R65 语义 = hostClosestPoint 离端点最近的表面点，R66 的最短连接已回退）
      // ★R104-8：方框宿主优先吸到**最近那条边的中点**（= 质心在该边上的垂直投影，防侧翻），
      //   中点够不着（超出 SPR_MID_ZONE）/ 不是方框宿主 ⇒ 一字不动地退回 R65 的最近表面点。
      /* ★R131-12（用户：「不管在哪里吸附都会强制回归到墙的中点…反复位移卡bug」）：吸附点=接触点（hostClosestPoint 优先）；中点磁吸不再抢占弹簧/绳/铰链的落点（R106-3 的中点标记显示保留）。 */
      /* ★★R131-51（用户：「器件铰链拖动时要吸附到物体的**角**，且**不需要**边中点」）：
       *  —— 铰链（S+hinge）⇒ **角优先**（够得着就吸角），否则最近表面点；**跳过中点**；
       *  —— 普通弹簧/绳 ⇒ 保持原行为（表面点优先、中点次之）。 */
      var q=null;
      if(B.hinge){
        /* ★★R131-57b（用户：「独立铰链现在还是能吸附在物体质心」）：真因——铰链端**落在物体
         *  内部**（尤其中心附近）时，锚点记在内部点 ⇒ 视觉/行为上就等于"吸在质心"。
         *  修：铰链的落点**一律收到物体表面**（角优先、否则最近表面点）——**不允许停在内部**。 */
        var _cornerQ=hostCornerSnapPoint(hit,e.x,e.y);
        var _qs=_cornerQ||hostClosestPoint(hit,e.x,e.y);
        q=_qs||{x:e.x,y:e.y};
      }else{
        q=hostClosestPoint(hit,e.x,e.y)||hostMidSnapPoint(hit,e.x,e.y);
      }
      // ★R105-1：铰链的锚点必须落在宿主的**碰撞面**上（两锚点重合 ⇒ 两碰撞体相切而非互埋，
      //   见 hingeSurfacePoint 的实测注释）。弹簧/轻绳不动。
      /* ★★R132-9j：**推力必须保留**（第一版按"角点已on表面"跳过它，被 `_diag_r107b.py` Q3
       *   打红：两体互埋 ⇒ 抖动）。角点的"偏"由 `hingeSurfacePoint` 内部解决 ——
       *   顶点处改用**角平分线**外推（原来是最近边法线，在顶点上不对称、方向随机）。 */
      if(q&&B.hinge)q=hingeSurfacePoint(hit,q);
      if(q){e.x=q.x;e.y=q.y;}
      B.anc[i]={B:hit};springAnchorOffset(B,i);
      // R103-8：铰链两端都锚上的那一刻 = 折角基准（限位从此偏差量起算）
      if(B.hinge&&B.anc[0]&&B.anc[1])hingeCaptureFold(B);
      // R71③：自由端的跟踪基准必须记在**锚定这一刻**。若留给 stepSprings 的第一帧去建基准，
      // 那么「锚定 -> 第一帧」之间宿主已经发生的位移会被整段丢掉（r71c 3b 实测正好丢一步 6px：
      // d=164 / L0=170）。在这里建，基准就是锚定瞬间的真实位姿，此后宿主走多少补多少。
      var oth=1-i;
      if(!B.anc[oth]){
        var fe=springEnd(B,oth);
        B._freeTk={host:hit,hx:hit.x,hy:hit.y,ex:fe.x,ey:fe.y};
      }
    }
  }
}
// F（用户：「拖动物体到弹簧不行，改成只要接触就行」）：反向锚定 —— 释放一个物体时，
// 扫场上所有弹簧的未锚定端点，若该物体在端点 SPR_PAD 范围内，就把那一端拴到该物体上。
// 与 springTryAnchor 对称：后者是「拖弹簧释放 → 找物体」，这里是「拖物体释放 → 找弹簧」。
function springTryAnchorByHost(host){
  if(!host||host.dead)return;
  // R100①：松手的是杆 → 先试它**自己两端**能不能连上（四个调用点全在 pointerup 里，
  // 所以挂在这里等于「松手即尝试连接」，不必去四处各加一行；杆不走 springTryAnchor 是因为
  // 那条路会维护 _freeTk，而杆没有「自由端跟进」这个语义）。
  if(host.kind==='T')rodTryAnchor(host);
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    // R100①：杆也接受「物体拖到它端点旁」的反向连接（与弹簧逐字同构）
    if((S.kind!=='S'&&S.kind!=='T')||S.dead||S===host||!S.anc)continue;
    for(var i=0;i<2;i++){
      if(S.anc[i])continue;
      // R102：与 springTryAnchor 里那两条**逐字同款**（同一份语义的两个入口，缺一处就漏）：
      //   ① 另一头已拴在 host 上 ⇒ 不许重复占（否则铰链两端又会被同一物体占满）；
      //   ② 铰链不许吸到传送带。
      var othR=((i===0)?S.anc[1]:S.anc[0]);
      if(othR&&othR.B===host)continue;
      if(S.hinge&&host.belt)continue;
      // ★R131：与 springTryAnchor 逐字同款 —— 铰链不吸绳；绳不吸绳/铰链（幽灵互吸）。
      if(S.hinge&&host.rope)continue;
      if(S.rope&&(host.rope||host.hinge))continue;
      // ★R103-6（_diag_r103b B 组实测）：这个自由端若已经**通过铰链**连着 host（某铰链
      //   一端吸本器件、另一端吸 host），就不许再**直接**锚到 host —— 铰链（双边约束，
      //   两锚点钉死重合）+ 直接锚定 = 同一个物理点两重约束，过约束互推 ⇒ 装配体爬行
      //   （实测：拖 C 松手一次，杆自由端被直接锚上 C，随后 C 从 x=500 爬到 335），
      //   而且 C 一爬走、第二次点击就落空，双击解除永远送不到位。
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
        // ★R104-8：与 springTryAnchor 逐字同款（同一份语义的两个入口，漏一处就一半生效）
        var q=hostClosestPoint(host,e.x,e.y)||hostMidSnapPoint(host,e.x,e.y);
        // ★R105-1：入口 2 也要把铰链锚点推到碰撞面上（与 springTryAnchor 逐字同款）
        if(q&&S.hinge)q=hingeSurfacePoint(host,q);
        if(q){e.x=q.x;e.y=q.y;}
        if(S.kind==='T'){                       // 杆：端点得靠 rodPlaceEnds 真正搬过去（见 rodTryAnchor）
          var o=rodEndWorld(S,1-i),qx=q?q.x:e.x,qy=q?q.y:e.y;
          rodPlaceEnds(S, i?o.x:qx, i?o.y:qy, i?qx:o.x, i?qy:o.y, true);
        }
        S.anc[i]={B:host};springAnchorOffset(S,i);
        // R103-8：铰链两端都锚上的那一刻 = 折角基准（同 springTryAnchor）
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
// F（用户：「双击弹簧与物体的连接处可以完成二者断联」）：检测点击位置是否落在某个弹簧
// 已锚定端点附近（SPR_PAD 范围）。若是 → 解除该端锚定（S.anc[i]=null），弹簧这一端变自由端。
// 返回 true 表示已处理（调用方应 return，不走默认双击动作）。
// ★R103-6（用户：「铰链连接轻质杆后，双击无法解除」）：铰链两端**恒重合**（len=0），连接处
//   的一个点上叠着好几条锚（铰链两端 + 杆端）。旧实现命中第一条就 return ⇒ 一次只解开一条，
//   画面上「还连着」= 用户眼里的「无法解除」。改成**扫完全场**、把落点 SPR_PAD 内的已锚端点
//   全部解开 —— 双击连接处 = 解除这个连接点的所有连接。单锚场景（普通弹簧端）行为不变。
function springDisconnectAtPoint(x,y){
  var hitAny=false;
  for(var j=0;j<bodies.length;j++){
    var S=bodies[j];
    // R100①：杆也进这一族（解除语义逐字相同：点端点附近 = 断开那一端）
    if((S.kind!=='S'&&S.kind!=='T')||S.dead||!S.anc)continue;
    for(var i=0;i<2;i++){
      if(!S.anc[i])continue;
      var e=anyEndPoint(S,i);
      if(e&&Math.hypot(e.x-x,e.y-y)<SPR_PAD){
        S.anc[i]=null;
        /* ★★R131-32g：**解除冷却**——否则松手时的自动吸附（R131-30 的 pointerup 统一
         *  rodTryAnchor）会把刚解除的端**立刻重新吸回**（实测：解除明明执行了，
         *  双击后 anc 又是 True——「双击无法解除」的真因）。 */
        S._snapCool=performance.now()+800;
        if(!S.anc[0]&&!S.anc[1])S._freeTk=null;
        hitAny=true;
      }
    }
  }
  return hitAny;
}
function springRig(B,out){
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
function springMoveRig(B,dx,dy){
  var rig=springRig(B),i,e;
  /* ★R106-4：**先搬宿主，再算端点**（旧顺序是反的，这就是铰链那 28.3px 滞后）。
   * 旧顺序：① 端点 += (dx,dy) ② springSyncEnds(S) ③ 宿主 += (dx,dy)。
   *   `springSyncEnds` 对**已锚端**会用 `springAnchoredWorld` 重算 ⇒ 此刻宿主**还没搬**，
   *   于是它把 ① 刚加的 (dx,dy) 原样覆盖回去；宿主在 ③ 才走 ⇒ 每子步结束都留下
   *   「端点落后宿主一个 dx」的残差。自由端不受影响（syncEnds 跳过它），所以
   *   绳（一端自由）看不出来、铰链（len=0、两端恒重合）把它放大 —— 实测 drift 28.3px
   *   （_diag_r106a G4c 判据 ≤3px 时红）。
   * 新顺序：宿主先走 ⇒ syncEnds 用**搬后**的宿主重算 ⇒ 端点与宿主同步、残差归零。
   *   最终位置与旧实现**完全一致**（都是整体平移 (dx,dy)），只是中间态不再错位；
   *   被跳过的仍是铁砧（static / 已固定），语义零变化。 */
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
    // R64：拖整体 = 导轨跟着搬（否则 springSyncEnds 会把端点投回旧导轨，弹簧「拖不动」）
    if(S.dirLock){S.dirLock.mx+=dx;S.dirLock.my+=dy;}
    for(e=0;e<2;e++){
      var a=S.anc[e];
      // 只有「铁砧」拖不动：被右键固定过 / 本身就是 static 的物体。其余对象（含画出来的
      // 图形/线，只要它是动态的）都要跟着整体走 —— 用户规格④：拖动已固定的弹簧就是拖整个整体。
      // （旧实现在这里硬排除 kind==='W'，于是弹簧挂在画出来的方块上时，拖弹簧只有弹簧在动、
      // 方块留在原地，被 e0/e1 的锚偏移又拽回去，看起来就是「拖不动」。）
      if(a&&a.B&&a.B.mb&&a.B.mb.isStatic)continue;
      if(e===0){S.e0.x+=dx;S.e0.y+=dy;}else{S.e1.x+=dx;S.e1.y+=dy;}
    }
    springSyncEnds(S);
  }
  /* ★★R131-63f（用户原话：「我发现了绳子和杆有同样的这个问题……绳子也是如此，一起修」）——
   *  搬完宿主后必须**再受一次既有约束的检查**，理由见 springPinHostsToOtherAnchors 的注释。 */
  if(springPinHostsToOtherAnchors(rig.B,B)){
    for(i=0;i<rig.S.length;i++)springSyncEnds(rig.S[i]);
  }
  return rig;
}
/* ★★R131-63f（用户原话：「物体a通过杆连接墙，然后再通过杆2连接物体a，拖动杆2，会导致
 *  杆1变长或者脱钩，**绳子也是如此，一起修**」）—— 绳版的同源缺陷。
 *
 * 病根（_diag_r235 逐写入者实测，拖绳2 60 帧后按住）：`springMoveRig` 的宿主搬动是
 * **无上限**的（「拖弹簧/绳 = 平移整个装配体」，规格④），而它**从不检查**「这个宿主是不是
 * 已经被**另一条元件**用带铁砧的锚钉在可达域里」。于是每子步：
 *
 *     springMoveRig @4442 ← springDragPinRig @2634 ← stepMatter   A 搬到 (555.291,279.522)
 *     conPull     @13754 ← ropeSolve       @14003 ← stepSprings    A 被收（每帧只 48px）
 *     conPull     @13749 ← ropeSolve       @14003 ← stepSprings    A 到 (532.785,287.857)
 *
 * 净效果：A 被卡在**不可达处**（按住 60 帧只挪 0.68px），绳1 两端锚距恒 **322.885px**
 * （绳长 170 的 1.9 倍）、端残差 24px —— 正是用户看到的「绳1 变长/脱钩」。
 * （`ropeSolve` 本身无罪：_diag_r234 手动连调 4 次即精确收到 170，它只是每帧被
 *  CON_DRAG_STEP=48 限步，追不上无上限的搬出。）
 *
 * 修法与 rodDragPinChain 的 R131-63e **逐字同构**：搬完之后，把每个「被别的**轻绳**的
 * 铁砧端钉住」的宿主**精确投影回**那条绳的可行域：
 *   · 沿 (锚点末尾 → 铁砧锚点) 的**径向**缩回越界量 over = d − len；
 *   · **切向位移原样保留** ⇒ 宿主仍能绕铁砧自由摆动（不是被钉死）；
 *   · 只在 d > len 时动手（绳**只拉不推**，松弛态一句都不碰）；
 *   · 幂等、纯几何、**无上限** ⇒ 本子步结束时残差恒 0，不再依赖 ropeSolve 的 48px 限步。
 * 语义结果：拖绳2 ⇒ A 被绳1 拽住（「拖不动」）但**绝不分离/拉长** —— 与 R131-62 给杆链
 * 定的口径、以及用户 R131-62 认可的绳行为完全一致。
 *
 * ⚠ 范围（**只做绳，不做杆/铰链**）：杆已有 R131-63e 的链解（rodDragPinChain，
 *   含"被拖侧远端吸收"与 rodSyncAnchors 的 R131-44 限步设计），铰链 len=0 走
 *   hingeSolve/conProj 的双边通道 —— 在这里再叠一层就是"两个写入者互相追打"（本项目的
 *   反复教训）。只在绳这一条上补，是因为**只有绳**的「拖整体」通道（springMoveRig）
 *   完全没有约束感知。
 * ⚠ excludeB = 本次正在被搬的那条元件自己（它两端的约束正是"整体平移"的语义来源，
 *   不能拿它自己的约束去否决它自己的平移）。
 * ★★R131-63f-2（`_diag_r237` 实测的**第二处调用点**）：只在 springMoveRig 末尾收口
 *   还差一口气 —— `frame()` 的顺序是 `stepPhysics → stepMatter → stepSprings`，
 *   而 `stepSprings` 里**每条绳按 bodies 顺序各解一次**。拖绳2 时逐子步实测：
 *       springPinHostsToOtherAnchors 出口 d1 = 170        （被收对了）
 *       conPull ← ropeSolve(绳1)          写出 A=420.278   d1 = 170
 *       springMoveRig                     写出 A=421.845   d1 = 195.594  ← **绳2 的 conPull 把 A 拉出去了**
 *   ⇒ 绳1 先解（收回 170），**绳2 后解**（把 A 往 B 方向拉出 23.6px）⇒ 后写者赢，
 *     帧末 d1 恒 **193.78~194.0**（= 用户看到的残留分离）。
 *   修法：`stepSprings` 末尾再调一次（hosts=null ⇒ **全场收口**）：全部绳解完之后，
 *   把所有「被铁砧端钉住」的宿主沿径向收回到绳长 ⇒ 帧末最后一句永远是「不可伸长」。
 *
 * ★★R131-63f-4/-6：**收了宿主 h 之后，把「锚在 h 上的其它元件」的另一端也整体平移**。
 *
 * 为什么必须有它（两次实测，两次都是"只搬一半"造成的拉长）：
 *   · `_diag_r240`（拓扑 墙—绳1—A—杆2—B，拖杆2 超绳长）：收口只搬 A ⇒ **杆2 被拉长到 570**
 *     （3.35 倍）。⇒ 那次加了「杆 + 另一端宿主」整体平移，杆2 回到 170~218。
 *   · `_diag_r239` Y 族（拓扑 墙—杆1—A—绳2—B，拖绳2 超长）：同一病换了载体 ——
 *     **绳2 被拉长到 498~944**（= 用户原话的 bug 在"被拖的那条元件"上复发）。
 *     因为上面那次只认 `kind==='T'`（杆），锚在 A 上的**绳**没被跟着搬。
 * ⇒ 现在对「杆 + 轻绳」一律处理：h 位移 mv ⇒ 锚在 h 上的元件的**另一端宿主**也位移 mv。
 *   元件是刚体 / 不可伸长的 ⇒ 两端一起走 ⇒ 它的锚距与端点-锚点关系全部不变
 *   ⇒ 整条被拖装配体被刚性拽回可达域 —— 就是 R131-62 定的「够不着 ⇒ 拖不动，但不分离」。
 *
 * ⚠ 另一端是**铁砧**（static / fixed / _dragPin）时不搬：整体平移会当场破坏那一端的锚。
 *   那种构型归 `rodDragPinHosts` 的 pass1（绕锚点转动）与 `conDragConstrain` 管，这里不抢。
 * ⚠ 同一次调用里同一个宿主只搬一次（`done`），否则多根元件会重复施加 mv。 */
function springFollowHostShift(h,mvx,mvy,excludeB){
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
function springPinHostsToOtherAnchors(hosts,excludeB){
  /* ★★R131-63f-7（`_diag_r239` X/Y 族实测 —— 必须**多遍收敛**，一遍只解决第一环）：
   *   拓扑 墙W—元件1—A—元件2—B（拖元件2）。一遍扫描的实际链路：
   *       ① 发现「元件1 一端锚铁砧 W、另一端锚 A」 ⇒ 把 A 收到可达域   ← 元件1 修好
   *       ② `springFollowHostShift` 把「锚在 A 上的元件2 的另一端 B」整体平移
   *       ③ 但**元件2 自己**（两端都不锚铁砧，一端锚 A、一端锚 B）不在处理列表里
   *          ⇒ 它自己仍被拉长（实测拖到超长 +400：X2 杆2 锚距 **218** / Y2 绳2 锚距 **918.8**，
   *            标称都是 170）。
   *   ⇒ 改成 Gauss-Seidel 多遍：每遍按「哪一端锚在**不可动的铁砧宿主**上」定"锁定端"，
   *     把另一端宿主沿径向收回 over；**每遍重新量**（上一遍刚搬过 ⇒ 下一遍可能已满足）。
   *     元件1 先把 A 拉回（元件2 的 A 端随 A 走）⇒ 下一遍再把元件2 自己的 B 拉回。
   *   ⇒ 与 R131-61/62 给杆链定的 Gauss-Seidel 口径逐字同构（`ROD_CHAIN_ITERS`）。 */
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
        /* ★哪一端可以"吸收"？ = 本端宿主仍可被约束搬动；另一端必须是**不可动的铁砧**。
         *  「不可动」= static / fixed / _dragPin（被指针拖住）。**不要用
         *  `hostMovableByConstraint` 反向判断** —— 那会把"被另一根元件临时锁住的 W 体"
         *  也算成可动 ⇒ 循环分配、谁都不收敛（实测 Y2 绳2 会稳定在 918px）。 */
        if(!hostIsAnvil(oh.B))continue;               // 另一端不是铁砧 ⇒ 它可以带着宿主一起走
        if(a.B===oh.B)continue;                       // 两端同一宿主：没有"另一端"可言
        var h=a.B;
        if(hostIsAnvil(h))continue;                   // 本端宿主自己也动不了 ⇒ 无从吸收
        if(h.kind!=='W'||h.fixed||h.dead)continue;
        var p=springAnchoredWorld(S,j),q=springAnchoredWorld(S,1-j);
        if(!p||!q)continue;
        var ddx=p.x-q.x,ddy=p.y-q.y,d=Math.hypot(ddx,ddy);
        if(!(d>L+0.01))continue;                      // 只收"拉长"这一侧（用户报的病就是变长/脱钩）
        var ux=ddx/d,uy=ddy/d,over=d-L;
        var mvx=-ux*over,mvy=-uy*over;
        h.x+=mvx;h.y+=mvy;                            // 精确径向收回（切向位移保留）
        if(h.mb&&MW){
          Matter.Body.setPosition(h.mb,{x:h.x,y:h.y});
          if(Matter.Sleeping)Matter.Sleeping.set(h.mb,false);
        }
        /* ★R131-63f-4/-6：收了宿主 h ⇒ 把「锚在 h 上的**其它**元件」的另一端也整体刚性
         *  平移同一位移。两次实测都是"只搬一半"造成的拉长（杆2 570px、绳2 918px），
         *  详见 springFollowHostShift 的注释。 */
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
// R65（用户：「弹簧固定后……而是和弹簧组成一个整体，旋转也是旋转整个整体一起」）：整体旋转。
// 旋转手柄拧的是 seed 的角度，但 seed 属于**含方向锁弹簧的装配体**时，转动必须落到每一个
// 成员上 —— 否则只转宿主一个，弹簧端点被锚偏移拽回来（springSyncEnds 每帧按锚重算端点），
// 看起来就是「拧了没反应」。刚体旋转的分工：
//   · 所有成员的中心绕 pivot 转（pos' = pivot + R(dth)·(pos − pivot)）；
//   · W/S/T 成员的朝向跟着转 th += dth（anchor = x + R(th)·o，th 转了偏移 o 就不用动）；
//   · 无 kind 的公式体朝向不转，但锚偏移要转（o' = R(dth)·o），锚点世界位置才落在刚体旋转
//     的正确处 —— 两类成员各转一半，锚点殊途同归，绝不能两边同时转（会转两次）。
//   · 方向锁弹簧的导轨整体转：中点绕 pivot 转、方向向量乘 R(dth)。「固定方向」锁的是物理
//     过程中的自转/摆动，不是「用户手动旋转整体时也不许转」。
// 返回 false = seed 不在方向锁装配体里，调用方退回单体力学的旧旋转路径。
function springLockedAsmOf(seed){
  if(!seed)return null;
  var mem=springAssemblyOf(seed),i;
  for(i=0;i<mem.length;i++){if(mem[i].kind==='S'&&mem[i].dirLock)return mem;}
  return null;
}
// R84：高中模式「旋转手柄 → 目标角」的推导。纯函数、无副作用 ⇒ 探针可直接调它量死区
//   （`_diag_r84a` A 组原本直调 springAssemblyRotate，量到的是下层那道 45° 硬夹，不是手柄的行为）。
//   高中只有 4 个方向，但目标**不能**取「raw 最近的 90° 倍数」——当 raw 与按下时方向 th0 夹角
//   <45° 时它算回原角度，dth=0，手柄看起来完全拖不动（实测死区 44°，即「连上物体后转不动」）。
//   改成**以 th0 为基准跨一格**：raw 偏离 th0 超过 SNAP_DEG 就跳到相邻 90° 倍数 ⇒ 死区 45°→8°，
//   且与 snapAngle90 的「带内不动」语义无缝衔接。
//   基准必须用 th0（按下那一刻锁定），**不能**用 seed.th —— 后者第一次跨格后已经变了，
//   拿它当基准会让手柄在 90°/180° 之间来回振荡。
function springRotTargetHigh(th0,raw){
  var Q=Math.PI/2;
  var base=Math.round((th0||0)/Q)*Q;
  var dev=shortAng(raw-base);
  if(Math.abs(dev)>=SNAP_DEG*Math.PI/180)return base+(dev>0?1:-1)*Q;
  return base;
}
function springAssemblyRotate(seed,tgt,pivot){
  var mem=springLockedAsmOf(seed);
  if(!mem)return false;
  // R83：高中模式没有斜弹簧 —— 整体旋转也只允许落在 90° 整数倍上（与 springRotate 同口径）。
  //   这里不能只靠调用方的 snapAngle90：它只在 ±SNAP_DEG(8°) 带内才吸，落在带外会保留任意斜角
  //   （同 springRotate 里那条 R76 注释的理由）。而高中模式下弹簧现在**总是**带 dirLock
  //   （见 makeSpring），旋转手柄走的正是本函数，所以必须在这里兜住。
  /* ★★R132-9g（同上）：这一条原本把**整个装配组**的目标角都吸到 90° 整数倍 ——
   *  组里只要挂着弹簧，同组的圆轨/圆弧/电磁场等**全被一起锁死**，正是用户说的误伤。
   *  ⇒ 撤掉组级吸附：装配旋转完全按用户给的角度走；高中模式的"没有斜弹簧"语义
   *    只保留在**用户直接旋转那根弹簧**时（见 springRotate）。 */
  /* （原：if(PHYS_MODE==='high')tgt=Math.round(tgt/(Math.PI/2))*(Math.PI/2);） */
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
function dissolveSpring(B){
  // R101⑦：轻绳 / 铰链不是 kx 拼出来的，双击就是**删除**它（把它们变回 k 和 x 是假的语义）。
  if(B&&(B.rope||B.hinge)){ringGo(B.x,B.y);killBody(B);return;}
  // 用户规格⑥：双击整体 -> 解散变回原样（k 和 x 各自回到两个端点处，作为自由字母落回画布）
  var cx=B.x,cy=B.y;
  var ux=B.e1.x-B.e0.x,uy=B.e1.y-B.e0.y,d=Math.hypot(ux,uy)||1;
  ux/=d;uy/=d;
  var kg=GD('k'),xg=GD('x');
  freeLetter(kg,B.e0.x+ux*12,B.e0.y+uy*12,0,0,true);
  freeLetter(xg,B.e1.x-ux*12,B.e1.y-uy*12,0,0,true);
  killBody(B);
  ringGo(cx,cy);
}
// k 与 x 拼起来 = 弹簧。和 t 的组合同理，而且**不分先后**（见 findTComboTarget 里的说明）。
function findKXCombo(L){
  if(!L||L.dead)return null;
  var t=L.type;
  if(t!=='k'&&t!=='x')return null;
  var other=(t==='k')?'x':'k';
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var F=freeL[i];
    if(F.type!==other||F===L||F.dead)continue;
    // 同 findTComboTarget：字母到字母、指针到字母，取更近的（指针落点更能表达「我就想拼这两个」）
    // R60c：两个都是**盒距**，不再用 150px 的固定半径（见 MERGE_PAD 处的说明）
    var gap=Math.min(twoLetterGap(L,F),
                     ptToGlyphGap(pointer.x,pointer.y,F.wx,F.wy,lw(F),lh(F)));
    if(gap<bg){bg=gap;best={free:F};}
  }
  return bg<=MERGE_PAD?best:null;
}
function applyKXCombo(L,c){
  if(!c||!c.free)return;
  var F=c.free;
  /* ★★R132-8（用户 2026-10-01 原话：「还有那个弹簧刚被 kx 字符合成时的初始角度改成水平
   *  朝向」）：旧实现把两端摆在**两个字母各自的落点**上（谁在左谁当 e0），于是弹簧的初始
   *  方向 = 两字母的连线 —— 用户斜着拖、或上下拖出 k 和 x 时，合成出来的就是一根斜弹簧/
   *  竖弹簧。实测（_tmp_r300 A 臂，同一页面）：
   *      k(600,300) + x(760,300) 横排 ⇒ th = 0.0°
   *      k(600,300) + x(600,410) 竖排 ⇒ th = **90.0°**   ← 用户报的「初始角度不是水平」
   *  修：方向**恒水平**。中点取两字母中点（弹簧出现在用户松手的地方，不跳到别处），
   *  长度仍按两字母间距（沿用 makeSpring 的 110~340 钳制语义 ⇒ 端点间距 == 间距）。
   *  高中模式的方向吸附（|dx|≥|dy| ⇒ 取水平）因此天然一致，dirLock 记的就是水平轴。 */
  var cx=(L.wx+F.wx)/2, cy=(L.wy+F.wy)/2;
  var d=Math.hypot(F.wx-L.wx,F.wy-L.wy);
  var half=clamp(d,110,340)/2;
  killLetter(F);killLetter(L);
  var S=makeSpring(cx-half,cy,cx+half,cy);
  ringGo(S.x,S.y);
}

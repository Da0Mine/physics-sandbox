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
var SPR_GRAB=16;         // 线圈的可抓/可悬浮带宽（与「只有有线才响应」一致）
var SPR_PAD=15;          // 端点判定「碰到别的物体」的距离
var SPR_KS_DEF=250;      // 默认刚度 N/m。夹子缩放锚点已冻结在 SPR_KS_ANCHOR，改默认值不影响夹子行为。
                         //   理论悬挂伸长 mg/k = 2600/250 = 10.4px（自然长度 110px，+9.5%）；180 已太硬（1kg 球高频抖动）。
                         // ⚠ 改这个数必须同时抬 sk 滑块的 max（见 PARAM_DEFS.sk），否则默认值顶在量程上沿、滑块满格拉不上去。
/* W 体默认摩擦系数。
 * 测量摩擦效果要用「滑行距离 / 停住时间」，不要用固定窗口的平均减速度：物体在窗口内已停住时
 * (v0−v1)/Δt 恒等于 v0/Δt，指标饱和。夹具要用贴地静置的宽扁块（240×36，给 500px/s）；
 * 从空中落下或窄高块会被下落冲击和前倾翻倒淹没摩擦信号。
 * 实测（干净夹具）：μ=0.05 滑行 72px、μ=1.0 滑行 20px，只差 3.6×（远小于 1/μ 的 20×），原因未定位。 */
var WFRICT_DEF=0.08;
/* 「把字母给谁」的凸包命中判定只对跨度不超过此值（px）的图形生效。
 420 ≈ 画布短边量级：合上的圆/方/三角都在内；横贯屏幕的长线条不适用（见 bodyFillHit）。 */
var BODY_FILL_MAX=420;
var WF_STATIC_CAP=0.6;
/* W 体静摩擦的唯一真源（体级、parts、配对覆盖三处都走它，不要各写各的常数）。
 * 摩擦冲量 = friction × 法向力，而 frictionStatic 决定低速段直接粘住不滑；与 μ 无关的静摩擦地板会把
 * 刹车力抬到 ≈0.67g，压缩 μ 的效果（实测 μ=0.05 vs 0.5 滑行 72.1 vs 26.0px，μ=0.6→1.0 仅差 15%）。
 * 因此静态框静摩擦设为 1（不成为天花板），μ>cap 时让物体静摩擦跟随 μ。 */
function wfStaticOf(mu){
  /* μ≤cap 仍取 0.6：保证停下来的物体站得稳（未调过的体 fs=0.6）。μ>cap 才跟随 μ ——
   静态框已是 1.0，配对 min 后天花板就是物体自己，不放开则 μ>0.6 仍是死区。 */
  return (mu>WF_STATIC_CAP)?mu:((mu>0)?0.6:0);      /* μ=0 必须真为 0（光滑语义） */
}
var SPR_DAMP=0.8;        // 高中模式阻尼比 ζ = damp/SPR_HIGH_ZETA_DIV
                         // = 0.8/10 = 0.08。⚠ 大学模式同一个滑块读的是有量纲阻尼 D=0.8
                         // （ζ_大学 = D/(2√(k·m))，k=150/m=1 ⇒ ζ≈0.033）。
var SPR_MIRROR_TOL=10;   // Matter 镜像长度变化超过它才重建（不能每帧造体）
// 弹力对 W 体的水平加速度上限（单位 g），防止弹簧水平拉动时把地面上的方块拉翻。
// 方块被水平拉动时「翻」与「滑」的分界是绕底边取矩：
//   翻倒力矩 = F·(h/2)；回复力矩 = mg·(w/2)  ⇒  a_x > g·w/h 就翻（正方形即 a_x > g）。
// 该阈值与摩擦无关：把 a_x 压到阈值以下，无论方块大小、ks、拖速都只能滑、不能翻。
// w/h 必须按每个物体自己的纵横比算，不能一刀切：竖长方形 90x110 阈值只有 0.818g（一刀切 0.95g
//   会把它掀翻 115.6°）；扁长方形 140x80 阈值 1.75g（一刀切会白白少给一倍拉力）。
// 按纵横比缩放后六种形状（40/60/90/130 正方形、90x110、140x80）翻转全部为 0°。
// 0.90 是余量：滑动中的接触抖动会额外贡献角冲量，贴着 1.00 太危险。
// 竖直分量不受此限（见 SPR_AY_G），弹簧吊起物体、斜向上拽照旧。
var SPR_AX_G=0.90;
// 多边形（画的方块/笔画/凹槽）受弹力的力矩上限（单位 g）。SPR_AX_G 只管「拉力偶」
// （力作用在质心 + 地面摩擦）；这条管直接拧（τ = r×F，力作用在锚点上）。力臂口径取 min(hw,hh)
// （各种躺法里最保守的半宽），地面上躺稳时回复力矩 mg·半宽 恒能压住，拧不翻。
// 这条通道必须存在：没有它弹力永远作用在质心，方块朝向落稳后就再也无法改变。
// 已接受的代价：悬空时没有地面回复力矩，侧面锚点的方块会被拧到「锚点朝上」（钟摆行为），快速上提会翻。
// 参数扫描：tau=0 完全不转；0.15/0.30/0.45/0.60 上提分别翻 −90/−180/−113/−270°，水平拖各档均 ≈0°。
// 取 0.30：足以带动转向跟手，ω 峰值 496°/s（0.60 档 700°/s，甩得太狠）。
var SPR_TAU_G=0.30;
// 弹力对 W 体的竖直加速度上限（单位 g），与 SPR_AX_G 成对。必须大于 1g，否则弹簧吊不起任何东西
// （悬挂平衡需要 F=mg）。作用是掐掉「猛地一提」时的瞬时过冲（实测 9.2g）—— 过冲会把下方方块甩上天、
// 落地翻滚。1.35 ⇒ 被吊方块最多以 0.35g 净加速度上升，跟得上手又不会被弹射。
var SPR_AY_G=1.35;
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
var SPR_FMAX=24000;        // ks = SPR_KS_ANCHOR 时的弹力上限（等价于「过形变 480px」）
var SPR_KS_ANCHOR=150;     // 三条夹子的缩放锚点，冻结为 150（夹子标定时的默认值）
var SPR_ACC_GAIN_MAX=8;    // 加速度上限的放大倍数上限（竖直 1.35g → 10.8g；水平 0.9g·asp 同倍）
var SPR_DAMP_GAIN_MAX=10;  // 阻尼的放大倍数上限（D·dt/m ≤ 0.30，显式积分稳定余量充足）
// 本机能稳定表示的刚度上限（实测硬墙，不是保守取值）。静置后逐帧看 (cur−len) 峰峰：
//   k=5000  ω·dt=1.18 峰峰 0.021px 稳      k=10000 ω·dt=1.67 峰峰 118.5px 极限环
//   k=8000  ω·dt=1.49 峰峰 15.046px 极限环   k=50000 ω·dt=3.73 峰峰 508.1px 极限环
// 加大阻尼救不回来（k=20000 下 D=71/100/118 全是极限环）：这是积分器本身的稳定边界，与夹子无关。
// 所以夹子按 ks 缩放只做到 k≈5000，再往上必须截断有效刚度。
// ⚠ 截断必须按宿主而不是按单根弹簧做：刚度是叠加的 —— 同一个球上并联两根 k=3000（有效 6000）当场极限环，
//   单根 k=3000 只是偶尔微振。账本保证一个宿主身上的有效刚度总和 ≤ SPR_K_MAX（见 springKBook/springKShare）。
// 取 2000（ω·dt = 0.745，离墙 1.49 有 2 倍余量）；k=50 静伸长 52px vs k≥2000 的 1.3px，量程仍有意义。
var SPR_K_MAX=2000;
function springKEff(ks){
  var k=(ks>0?ks:SPR_KS_DEF);
  return k>SPR_K_MAX?SPR_K_MAX:k;
}
// 宿主刚度账本：把「一个宿主身上所有弹簧的有效刚度之和」算出来，超预算时同比例缩水
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
  return fmax<SPR_FMAX?SPR_FMAX:fmax;          // ks < 锚点时不下调（下限就是 SPR_FMAX）
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
// 弹簧的 Matter 镜像（一根静态薄板）必须和它自己拴住的宿主互不碰撞：端点在宿主内部，板必然穿过宿主，
// 求解器每帧强行分开会向宿主注入巨大能量（实测球被弹到 5000+ px/s）。
// Matter 里同一个负 group 的两个体永远不碰撞，不同 group 走 category/mask —— 所以宿主(-2) 对普通物体(0)
// 照常碰撞，只关掉「弹簧 ↔ 宿主」。副作用：两个都被弹簧拴住的物体之间也不碰撞（可接受）。
// SPR_STOP_E：弹簧压到最短（触底）时的挡板恢复系数，速度响应 λ = (1+e)：
//   e=0 → 抹掉接近速度（完全非弹性，每次触底掉一截能量，首次约 26%）；e=1 → 原样弹回（能量守恒）。
//   取 1：触底段总机械能峰值离散度 < 1%；固体高度的钢弹簧本来也近乎弹性。
var SPR_STOP_E=1;
var SPR_CGROUP=-2;
// 铰链宿主专用负组：销接双方互不碰撞。独立于 SPR_CGROUP。
var HINGE_CGROUP=-3;
// 圆形（球）的弹性：落地弹几下并快速收敛，不能永远弹
var BALL_REST=0.52;      // 碰撞恢复系数（Matter 取双方 max，地面是 0）
// 出厂默认空气阻尼为 0。非零默认值是一条用户看不见的耗散通道：μ=0 时球仍会被拖停、
// e=1 时又与「完全弹性」矛盾。阻尼交给 μ / e 两个旋钮；需要时用面板「空气阻力 air」显式调。
var BALL_AIR=0;          // 空气阻尼默认（0 = 无空气阻力）
var WAIR_GLOBAL=0;       // 全局空气阻力（面板 wair 的唯一真源）
// wair 是全局参数：面板一调，场上所有 W 体（含新生成的）同步生效。WAIR_GLOBAL 为唯一真源；
//   B.wAir 仍随体写一份（applyWAir/复制语义兼容），但读写入口都收敛到全局值。高中模式恒为 0。
// CIRCLE_SIDES：Matter 0.20 没有真圆碰撞，Bodies.circle 是多边形，边数 = ceil(clamp(min(maxSides,R),10,∞))，
//   maxSides 只能调小（R≈22 时恒为 24 边）。接触法线是面法线、偏离径向 ⇒ 每个接触带力臂 ⇒ 虚假角冲量，
//   球被自旋、平动能被抽走（凹槽里表现为越滑越低；实测转动能吸收了 ~85% 的能量损失，与本项目补偿机器无关）。
//   边数扫描（下沉量）：24 边 +8.41%、48 边 +3.79%、96 边 +2.70%。取 48：拿到 81% 的改善，SAT 代价 ~(N+M)² 只涨 4 倍。
//   边数也影响质量（面积×密度，24→48 边 +0.9%）。圆 vs 多边形的精确接触见下面的解析碰撞通道。
var CIRCLE_SIDES=48;     // W 体「圆」的碰撞多边形边数（越大越接近真圆、虚假力矩越小、SAT 越贵）

// ============================================================================ 圆环折线段数
// 圆环的墨线就是它的碰撞几何（一圈 N 根定向矩形，见 shapeOutline('ring')），N 边形半径在内切 R 与
// 外接 R/cos(π/N) 之间摆动，峰峰 = R·(1/cos(π/N) − 1) ≈ R·(π/N)²/2，与半径成正比，大圆环会看出折线
// （R=300、N=48 时实测 0.61px，弦长 39px）。实心「圆」渲染走真弧，不受影响。
// 不用「渲染画真圆、碰撞仍用折线」：画出来的线必须就是实体；加细折线同时改善渲染与物理。
// 做法：段数按半径自适应，把半径偏差钉在 OUTLINE_PP_MAX 以下。
//   · MIN=48 且精确返回：R ≤ 2·PP_MAX·(48/π)² = PP_MAX·466.7（PP_MAX=0.30 时 R≤140）时就是 48 段，
//     与固定 CIRCLE_SIDES=48 完全一致。
//   · MAX=256：R≈3984 撞上限（画布画不到）。实测 R=141→49、300→71、1000→129、2000→182，偏差 0.290~0.298px。
//   · 不要对结果取奇数（n|1）：48|1=49，会推翻下限保护。闭链处处等价，奇偶无关紧要。
// 测量注意：用相位折叠测非圆度时，折叠周期必须取页面上的实际 N（写死 48 边会把 N=71 的分面平均掉，
//   给出假通过）；实心圆的 B.pts 只供碰撞、渲染走真弧，理论偏差为 0。
var OUTLINE_PP_MAX=0.30;   // 可接受的半径偏差峰峰（px）—— 4.65px 墨线宽的 6.5%，亚像素
var OUTLINE_MIN_SIDES=48;  // 下限 = CIRCLE_SIDES；精确判等返回，小圆行为与固定 48 边一致
var OUTLINE_MAX_SIDES=256; // 上限：parts ≤ 257
function outlineSides(R){
  // N ≥ π·sqrt(R/(2·PP_MAX)) 由 R(π/N)²/2 ≤ PP_MAX 反解
  R=Math.max(1,isFinite(R)?R:1);
  var n=Math.ceil(Math.PI*Math.sqrt(R/(2*OUTLINE_PP_MAX)));
  if(!(n>0))n=OUTLINE_MIN_SIDES;
  if(n<=OUTLINE_MIN_SIDES)return OUTLINE_MIN_SIDES;   // 小圆：精确 48
  if(n>OUTLINE_MAX_SIDES)n=OUTLINE_MAX_SIDES;
  return n;
}

// ============================================================================ 圆的解析碰撞
// 「真圆 vs 多边形」的解析碰撞通道。48 边内接多边形的接触法线是面法线，与真实径向最多差 π/48；
// 接触力臂 max|r×n| = R·sin(π/48)（实测吻合）≠ 0 ⇒ 每帧给球虚假角冲量。要力臂恒为 0，法线必须是径向。
//
// 做法：挂 Matter.Collision.collides（Detector 的窄相入口，每对部件调一次）。一方是标注了 _circleR 的圆体、
//   另一方是多边形时不调 SAT，改用解析几何：
//     · 逐边求圆心到线段的最近点取最近者（线段最近点公式天然包含顶点接触）；
//     · 穿透深度 depth = R − d（d = 圆心到边界最近距离）；
//     · 法线 normal = (圆心 − 最近点)/d，即径向；
//     · 接触点 supports = 最近点 ⇒ r ∥ normal ⇒ 力臂恒为 0。支撑点数取 1（真圆与面的接触本来就是单点）。
//   O(N·M) 的 SAT 换成 O(M) 的逐边距离，更准也更快。
//   CIRCLE_SIDES 故意保持 48：多边形仍决定质量与惯量，改它会平移已标定的断言，而精度收益已由本通道拿走。
//
// 守卫（都不许省）：
//   ① 圆心落在多边形内部（深度互穿）也走解析，用凸多边形的标准 MTV：方向 = 最近面的外法线（圆心→最近点），
//      推出量 = d + R。本项目 Matter 体全是凸的，有精确解。不要退回 SAT：那正是最需要正确法线的时刻。
//   ② 圆-圆也走解析：Matter 0.20 的 SAT 没有圆-圆特例（不读 circleRadius）。
//   ③ 退化（d≈0 / 圆心重合 / 顶点数<3 / 拿不到 Matter.Pair/Collision.create）一律退回 SAT。
//   ④ 复用 pairs.table 里的 collision 对象（与 Matter 缓存口径一致）。自己 new 会让 collision.pair 一直为空
//      ⇒ Pairs.update 每帧新建 Pair ⇒ pairs.list 抖动、collisionStart 每帧误报。这是本通道最容易踩的坑。
// 空心圆（环）同样走解析分支；不走的话环仍是「圆 vs 48 根矩形」的多边形路径，只是法线退回面法线。
// 环分支去重（_ringHit / _ringTok）：同一对（环, 圆）每个物理子步只产出一条解析接触。
// Detector 对复合体逐 part 调 Collision.collides，环有 48 个 part，球贴壁时同时压住 6~8 个 ⇒ 同一子步产出
//   6~8 条几何完全相同的接触（几何只由环心决定），同一约束被结算多遍。
// 去重不是为了防穿墙：Resolver 是顺序（Gauss-Seidel）速度求解器，重复约束从第二条起看到的已是分离速度，
//   冲量被夹到 0，不会叠加（关掉去重后最大穿透不变）。真实收益：
//     ① 约束卫生：重复条数会改变摩擦/切向求解的迭代次序，影响轨迹；
//     ② 开销：每子步接触条数约降为 1/6，并减少 pairs.list 的建/销抖动。
// token 由包装 Matter.Engine.update 推进：产品只在 stepMatter 一处调它，所以一个 token = 一个物理子步。
// 包装失败 ⇒ _ringDedupOK=false ⇒ 去重整体停用（宁可不判重，也不能因 token 不走而让球永远穿透）。
// RING_DBG 只给探针/负对照读数，不参与物理。
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
    var rA=(bodyA&&bodyA._circleR>0)?bodyA._circleR:0;
    var rB=(bodyB&&bodyB._circleR>0)?bodyB._circleR:0;
    if(!rA&&!rB)return _collides(bodyA,bodyB,pairs);      // 无圆：普通 SAT 路径
    // ---- 环 vs 圆：解析环（annulus）-----------------------------------------------
    // 48 根定向矩形的复合体能关住球，但每根矩形只有约 9px 长、球同时压两三根，接触法线是矩形的面法线，
    // 偏离真径向最多约 8°。本分支把法线变成真径向，并消除弦高欠覆盖。
    // 这是几何正确性修正，不是「无能量损失」的开关：默认物性（μ=0.08, e=0.52）下仍会衰减；
    // 要无损需 μ=0 + e=1（两条路径都能持续不衰）。
    var rp=(bodyA&&bodyA._ringOut>0)?bodyA:((bodyB&&bodyB._ringOut>0)?bodyB:null);
    if(rp){
      var cbo=rA?bodyA:(rB?bodyB:null);
      if(!cbo)return _collides(bodyA,bodyB,pairs);       // 环 vs 非圆（方块/杆/地面）：交回多边形路径
      var rrr=cbo._circleR, ringIn=rp._ringIn, ringOut=rp._ringOut;
      // ⚠ 环心必须取 root：Detector 传进来的是 part，part.position 在中线上（距环心 Rmid），
      //   用它会算出巨大的 depth，一记 MTV 把球打飞出环外。
      var rctr=(!rp.parent||rp.parent===rp)?rp:rp.parent;
      var pdx=cbo.position.x-rctr.position.x, pdy=cbo.position.y-rctr.position.y;
      var pd=Math.sqrt(pdx*pdx+pdy*pdy);
      if(pd<1e-9)return _collides(bodyA,bodyB,pairs);    // 守卫③：圆心与环心重合
      // 判别式按「球心落在哪一区」分，绝不能按「哪个推出量为正」分：
      //   球心在空腔内时 ringOut+rrr−pd 照样是正的大数，按它判会把球朝外打穿整圈壁。
      var pdep=0,psep=0;
      if(pd>=ringOut){pdep=ringOut+rrr-pd;psep=1;}            // 球在外侧 ⇒ 沿径向朝外分离
      else if(pd<=ringIn){pdep=pd+rrr-ringIn;psep=-1;}        // 球在空腔 ⇒ 朝环心分离
      else{                                                   // 球心埋在壁厚里 ⇒ 推到更近的一侧
        var pEo=ringOut-pd,pEi=pd-ringIn;
        if(pEo<=pEi){pdep=pEo+rrr;psep=1;}else{pdep=pEi+rrr;psep=-1;}
      }
      if(!(pdep>0))return null;                               // 真环不接触
      // 去重（见 _ringHit 注释）：本子步里这对（环, 圆）已出过一条解析接触就直接让位。
      //   必须放在「确认真有接触」之后：放在判别式之前，不接触的 part 会白吃掉 token，
      //   把同一子步里真正接触的 part 挡掉 ⇒ 球穿壁。
      //   几何与 part 无关 ⇒ 留第一条，顺带让 Pair 身份稳定（热启动不丢）。
      //   判据是两条合取：① token 相同（同一物理子步）；② 球心 x 逐位相同。
      //   ② 兜底 token 推进器被摘掉的情况：只用 ① 时 token 冻住会让环再也吐不出接触 ⇒ 球穿环；
      //   加上 ② 后运动中的球照常出接触，只有「token 冻住且球一动不动」才漏一拍，下一子步即补回。
      //   （RING_DBG.off 是 A/B 负对照开关。）
      var rky=rctr.id+':'+cbo.id, rsig=cbo.position.x;
      if(_ringDedupOK&&!RING_DBG.off){
        if(_ringHit[rky]===_ringTok&&_ringSig[rky]===rsig){RING_DBG.dedup++;return null;}
      }
      _ringHit[rky]=_ringTok; _ringSig[rky]=rsig;
      RING_DBG.emit++;
      var pux=pdx/pd,puy=pdy/pd;
      var Aa=(bodyA.id<bodyB.id)?bodyA:bodyB, Bb2=(bodyA.id<bodyB.id)?bodyB:bodyA;
      var rcol=cachedCollision(pairs,Aa,Bb2)||blankCollision(Aa,Bb2);      // 守卫④
      // normal 符号沿用「normal 由 B 指向 A」的约定（见圆 vs 多边形分支）：
      //   球是 A ⇒ 球沿 +normal 走 ⇒ normal=+sep·u ；球是 B ⇒ 球沿 −normal 走 ⇒ normal=−sep·u
      var nfs=(Aa===cbo)?1:-1;
      var rnx=nfs*psep*pux, rny=nfs*psep*puy;
      rcol.collided=true;
      rcol.bodyA=Aa; rcol.bodyB=Bb2; rcol.parentA=Aa.parent; rcol.parentB=Bb2.parent;
      rcol.depth=pdep;
      rcol.normal.x=rnx; rcol.normal.y=rny;
      rcol.tangent.x=-rny; rcol.tangent.y=rnx;
      rcol.penetration.x=rnx*pdep; rcol.penetration.y=rny*pdep;
      // 支撑点取环壁上的径向点：它让球与环两侧的力臂一起为 0 ——
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
      rcol._circleX=1;      // 与圆通道同一个诊断标记（探针靠它区分解析/SAT）
      rcol._ringX=1;        // 本支专属标记
      return rcol;
    }
    // ---- 圆-圆：解析两圆 ---------------------------------------------------------------
    // Matter 0.20 的 SAT 没有圆-圆特例（Collision.collides 不读 circleRadius），两球相撞 = 两个 48 边形相撞：
    //   实测法线偏离连心线最多 ≈π/48、力臂最大 3.17px（多边形支撑点是顶点，|r| 可超过 R）、supportCount 恒为 2。
    // 公式（与「圆 vs 多边形」共用同一条 B→A 符号约定）：
    //   depth = RA + RB − d（d = 圆心距）        normal = (c_A − c_B)/d      接触点在连心线上
    // ⚠ 对「一个圆完全包住另一个」也成立、方向也对，不需要单开分支：
    //   设 c_A = 0、c_B = d·u ⇒ normal = −u；求解器把 A 沿 −u、B 沿 +u 推，内含的 B 一路走到 A 的边界之外，
    //   推出量正好是 R_A+R_B−d。唯一无定义的是圆心重合（d≈0），退回 SAT。
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
      // 是为了与「圆 vs 多边形」那支语义一致：接触点在圆的边界上。
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
    // ---- 圆心在多边形内部（深度互穿）也走解析，不退回 SAT ------------------
    // 本项目 Matter 体全是凸的：弧/槽/开链笔画是逐段定向矩形的复合体（每块凸）、闭链形走
    // fromVertices(inflateHull(...)) 也是凸包、地面/墙/弹簧镜像板是矩形。凸 part 上圆心在内部有精确解：
    // 出去方向 = 最近面的外法线（圆心指向最近点），推出量 = d + R（标准 MTV）。
    // 这是最需要正确法线的时刻，退回 SAT 会在最坏情形把 48 边形请回来（实测力臂 3.47px，大于正常上限 1.46）。
    var inside=inPoly(vs,c.x,c.y);
    var depth=inside?(q.d+R):(R-q.d);
    if(!(depth>0))return null;                    // 真圆不接触 ⇒ 明确无碰撞（多边形弦高造成的假接触也随之消失）
    var ux=(c.x-q.px)/q.d, uy=(c.y-q.py)/q.d;     // 圆心 →(指向) 边界最近点
    // sep = 「圆分离时该走的方向」：在外面 = 背离多边形(= u)；在里面 = 朝最近的面出去(= −u)
    var sf=inside?-1:1;
    // ⚠ 符号是 Matter 的反直觉约定，别按字面猜（按 A→B 写会把球往地里推）：
    //   Collision.collides 里 `g*(B.x-e.x)+x*(B.y-e.y)>=0&&(g=-g,x=-x)` 是「若为正则取反」，
    //   结果满足 normal·(B−A) ≤ 0，即 normal 由 B 指向 A。求解器里 A 沿 +normal、B 沿 −normal 推开。
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
    // 支撑点数取 1（真圆与面的接触本来就是单点），但两个槽位必须是不同且稳定的对象 ——
    // 复用同一对象会踩 Pair.update 的去重分支 `d.vertex!==l && c.vertex!==u || (交换 contacts[0]/contacts[1])`：
    // 每帧都交换，热启动的 normalImpulse/tangentImpulse 全部丢失，接触变得过弹（球在槽里来回弹而不是贴弧面滑）。
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
// 物理教学模式：'uni' = 大学（全物理，默认）；'high' = 高中：
//   ① 弹簧不算力矩（力只沿弹簧方向作用在质心）
//   ② 不算弹簧阻尼（Rayleigh 阻尼项置 0）
//   ③ 不算空气阻力（frictionAir 恒 0，忽略显式 wair 设置）
// 作用点分别是 springForceOn / springDamp / applyWAir·wAirDef。
var PHYS_MODE='uni';
// 拖拽悬摆的死区系数：抓点的水平力臂（抓点到质心世界偏移的 x 分量）小于
// DRAG_ROT_DEADBAND×max(hw,hh) 时为平衡区，悬空提着也不转。90px 宽方块平衡带 ±27px；提角/提侧边必转。
var DRAG_ROT_DEADBAND=0.3;

function makeSpring(ax,ay,bx,by){
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
// （高中模式曾把弹簧锚点偏移冻结在质心系（_noRot=true，不随宿主转），已撤销：宿主有残余转动时连接点会在
//   表面滑移；现在各元件一律记在本地系，见 springAnchorOffset。）
// anyEndPoint：可锚定元件的端点取值 —— 弹簧 = e0/e1（live 对象，移动它即移动弹簧端），
// 杆 = 两端世界坐标（每次新建的对象；改杆端点请走 setRodEnds）。
// springAnchorOffset / springDisconnectAtPoint / springTryAnchorByHost 都读它。
function anyEndPoint(B,i){
  if(!B)return null;
  if(B.kind==='S')return springEnd(B,i);
  if(B.kind==='T')return rodEndWorld(B,i);
  return null;
}
// 杆端吸附半径，与 SPR_PAD(=15) 同值。⚠ 不要命名为 ROD_PAD：文件后面已有全局 var ROD_PAD=0.5
//   （笔迹外扩余量，inkPieces/inset 在用），同作用域后写者生效 ⇒ 吸附半径变成 0.5px、杆永远连不上，且不报错。
//   新增全局常量前先 grep 同名。
var ROD_SNAP=15;
// 双端刚性连杆每子步纠正量上限（px）。一次性把宿主瞬移几百 px 会撞穿墙/地板（Matter 的位置写入
//   不做连续碰撞检测）；封顶后剩余误差下一子步继续收 —— 240Hz 下 12px/子步 = 2880px/s，仍是「立刻绷紧」。
var ROD_PULL_MAX=12;
var ROD_PULL_ITERS=6;                    // 同一子步内纠正的迭代次数（每次重取锚点、各自封顶 ROD_PULL_MAX）⇒ 72px/帧收敛力。
                                         //   快拖时指针约 2000px/s=33px/帧，单次 12px/帧追不上。
var ROD_ROT_MAX=0.02;                    // 单次迭代宿主旋转纠正上限（rad）。旋转纠正与
                                         //   Matter 积分互斗时会自激（实测 ω 炸到 1e6 rad/s），这是保险丝。
function springAnchorOffset(B,i){
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
/* 每个宿主每子步的杆修正总预算 ROD_PULL_MAX：同一子步里一个宿主可能被好几根杆各修正一次，
 *  修正量叠加（每根最多 12px）⇒ Gauss-Seidel 迭代相互放大 ⇒ 装配发散飞出。
 *  多杆按先到先得分配，超出即按比例缩减；单杆行为不变。 */
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
/* ---- 轻质杆的两端连接（复用弹簧的锚定合约）--------------------------------
 * 存储/偏移量纲/旋转语义全部走上面两个既有函数：B.anc[i]={B:host,ox,oy,_noRot}；端点取法按元件分派（anyEndPoint）。
 * 已锚定的端由宿主位姿决定，另一端自由 ⇒
 *   · 单端锚定 = 绕该点的摆（光滑铰链的最小形态）；
 *   · 双端锚定 = 两宿主之间的刚性连杆。
 * 已知限制：杆端锚定是位置驱动的，不把宿主的受力反算回来 —— 把杆挂在墙上可以，用杆去撬很重的物体不行；
 *   真正的双向约束需要独立求解器。
 * 两个 anc 都是 null 时第一行就返回 false。 */
function rodSyncAnchors(B,dt){
  if(!B||B.kind!=='T'||!B.anc)return false;
  if(!B.anc[0]&&!B.anc[1])return false;
  /* 杆的连接语义：连接点相对物体表面不动，杆可绕连接点自由旋转。
   *  = 材料点锚定（本地系钉死，随宿主位姿）+ 宿主角度锁死（_rodLK ⇒ 材料点方位恒定）+ 杆自身自由旋转
   *  （PBD 旋转修正）+ 杆-杆销接（杆宿主不打锁）+ 杆无碰撞箱。 */

  // 杆自身被拖（左键抓杆身 grab.kind='body' / 长度手柄 'rodlen'）⇒ 位姿归指针，本函数整步让路，
  //   否则下面的姿态更新会和拖杆处理器互相改写（杆被拽回锚点、拖不动）。
  if(grab&&grab.obj===B&&(grab.kind==='body'||grab.kind==='rodlen'))return false;
  var w=[null,null],n=0,i;
  for(i=0;i<2;i++){
    var a=B.anc[i];if(!a)continue;
    if(!a.B||a.B.dead||bodies.indexOf(a.B)<0){B.anc[i]=null;continue;}   // 宿主没了 → 这一端自动自由
    w[i]=springAnchoredWorld(B,i);
    if(w[i])n++;
  }
  if(!n)return false;
  // ---- 双端拴住 = 两宿主之间的刚性连杆（长度守恒，不跟锚点走）----------
  // 不要把杆长反算成两锚点距离（rodPlaceEnds/setRodEnds 会写 B.len=d）：杆会退化成橡皮筋，
  //   重物一挂就悄悄变长（锚点残差恒为 0，看不出脱钩）。
  // 语义：|e1−e0| ≡ 杆长。两锚点距离 ≠ 杆长时搬可搬动的宿主去满足它：
  //   · 纠正量按 1/m 分配，铁砧端不动；
  //   · 再把两端沿轴的相对速度投影掉 —— 否则重力每子步攒一点轴向速度、PBD 又吃掉位移 ⇒ 速度无界增长，
  //     一解除锚定就弹飞；
  //   · hostMovableByConstraint 只对 W 体开（非 W 的位姿归 Matter，写了会被覆盖）；
  //   · 每子步纠正量封顶 ROD_PULL_MAX，免得瞬移把宿主撞穿墙；
  //   · 两端都搬不动（两个铁砧）时配置本身过约束，几何服从锚点。
  if(n===2){
    var h0=B.anc[0]?B.anc[0].B:null,h1=B.anc[1]?B.anc[1].B:null;
    /* 目标长度必须取 B._rodL（有意设定的长度），不能取 B.len：B.len 会被改写成当前锚距，而纠正量有封顶，
     *   快拖一次大跳只能还掉一部分，len 被写成「Lr+剩余」后下一子步 err=0、纠正不再运行 ⇒ 杆只长不缩（棘轮）。
     *   _rodL 只在「有意改长度」四处写入：makeRod 初值 / setRodLen（面板）/ rodDragEnds（长度手柄）/
     *   rodTryAnchor（落点吸附）。这里（跟锚点走）绝不写它。 */
    if(B._rodL==null||!(B._rodL>0))B._rodL=B.len||170;
    var W0=w[0],W1=w[1],Lr=B._rodL;
    /* 不要挂 Matter 原生 Constraint：W 体位姿由产品每帧摆放（见 hostMovableByConstraint），Matter 约束的修正
     *   会被下一帧覆盖 ⇒ 正反馈发散。因此用自研 PBD：
     *   A 姿态：杆统一走纯姿态可视化 —— 中心=锚点中点、方向=W1→W0（与 setRodEnds 同惯例）、len 恒 = _rodL。
     *     锚距≠Lr 时杆端与锚点之间如实留缺口，由下面的纠正收回，杆永远画成刚体。
     *   B 收敛：同子步内迭代 ROD_PULL_ITERS 次（每次重取锚点、各自封顶 12px）⇒ 72px/帧收敛力，
     *     单次 12px/帧追不上快拖（约 33px/帧）。 */
    function _im(h){                                   // 可搬动 ⇒ 1/m；搬不动 ⇒ 0
      /* 正被拖的宿主不参与 1/m 分配（当铁砧）：它的位姿归指针，下一帧会被整份覆盖，分给它的纠正白做、
       *   收敛速度减半。与 conDragConstrain 的分配规则一致。 */
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var m=h.mb.mass;
      return (m>0&&isFinite(m))?(1/m):0;
    }
    /* 位置相位是平动+旋转的刚体点距约束（b2DistanceJoint 同款雅可比）。锚点随宿主转，若只做平动修正，
     *   宿主一转（落地、甩动、滚转）锚点就绕质心甩，残差永远追不平（杆与体脱钩）且每子步泵进能量（抖动）。
     *     C=|p1−p0|−L，p_i=x_i+R(th_i)·r_i，r_iw=p_i−center_i（世界系）
     *     ∂C/∂x_i=∓u；∂C/∂th_i=∓(u×r_iw)
     *     K=Σ im_i + Σ iI_i·j_i²（j_i=u×r_iw）；λ=err/K
     *     Δx0=+u·λ·im0、Δx1=−u·λ·im1、Δth0=−iI0·j0·λ、Δth1=+iI1·j1·λ
     *   速度相位在接触场景保持纯平动投影：含 ω 冲量的版本在落地接触处正反馈（速度冲到 1.4e4px/s）。 */
    function _iI(h){                                   // 转动自由度的广义逆质量；搬不动/被抓 ⇒ 0
      if(grab&&grab.kind==='body'&&grab.obj===h)return 0;
      if(!hostMovableByConstraint(h)||!h.mb)return 0;
      var I=h.mb.inertia;
      return (I>0&&isFinite(I))?(1/I):0;
    }
    var im0=_im(h0),im1=_im(h1),iI0=_iI(h0),iI1=_iI(h1);
    if(im0+im1+iI0+iI1>1e-9){
      /* 本函数在 Engine.update 之前跑，h.x/h.y/h.th 还是上一子步的旧值（Matter 已积分到新位姿，产品字段帧末才回写）。
       *   按旧位姿算再用 setPosition/setAngle 绝对回写，等于每子步把角度倒回旧值而 ω 继续涨 ⇒ 落地滚动时正反馈爆炸。
       *   所以解算前先从 mb 同步一次新位姿（被抓宿主除外：它的位姿归指针，本来就是新值）。 */
      if(h0&&h0.mb&&!(grab&&grab.kind==='body'&&grab.obj===h0)){
        h0.x=h0.mb.position.x;h0.y=h0.mb.position.y;h0.th=h0.mb.angle;}
      if(h1&&h1.mb&&!(grab&&grab.kind==='body'&&grab.obj===h1)){
        h1.x=h1.mb.position.x;h1.y=h1.mb.position.y;h1.th=h1.mb.angle;}
      /* XPBD 速度重建的快照（防止杆摆越摆越低）：位置相位的 setPosition/setAngle 是纯瞬移，约束功不进速度账；
       *  速度相位清锚点径向速度时会对本子步重力刚注入的径向分量做负功 ⇒ 30° 释放 8s 衰减 99.9%。
       *  两相位都不能单独禁掉（会爆/坍）。做法：子步起始在此快照，Engine.update 之后用
       *  「完整子步位移（修正+积分）/dt」反推速度（rodXPBDVel），切向动能完整保留、与重力功自洽。
       *  不要只补 ω 不补 v（长杆静置自爬），也不要用 v+=修正量/dt（会被速度相位清掉，无效）。
       *  快照只在 dt>0（正常子步）记；static/被抓宿主不记（位姿不归约束）。 */
      var _touching=function(mb){                          // 该 mb 是否处于任何活动接触对中
        if(!mb)return true;                                // 拿不准按有接触（保守 ⇒ 纯平动）
        var pl=(MW&&MW.engine)?MW.engine.pairs.list:null;
        if(!pl)return true;
        for(var i=0;i<pl.length;i++){var pp=pl[i];
          if(pp.isActive&&(pp.bodyA===mb||pp.bodyB===mb))return true;}
        return false;};
      var _free=!_touching(h0&&h0.mb)&&!_touching(h1&&h1.mb);   // 两端都悬空 ⇒ 允许 ω 模
      /* 松手冷却 80 子步（20 帧）：松手瞬间的回弹修正会被速度重建误读成速度而反向飞出，冷却期内不重建。 */
      if(grab&&grab.kind==='body')B._grabCool=80;
      else if(B._grabCool>0)B._grabCool--;
      if(dt>0&&_free&&!(grab&&grab.kind==='body')&&!(B._grabCool>0)){
        /* 抓着任何 body 时整帧不重建：conDragConstrain/rodDragPinHosts 会把装配另一端逐子步重钉到杆端，
         *  重钉位移不是物理速度，被误读会把摆锤甩飞。 */
        /* 只对简单体（parts==1）宿主记快照：复合体（墨迹链）上 Engine 角度积分与位置相位 setAngle 的口径差
         *  会让重建系统性注能（实测拖拽松手爆到 17263px/s），复合体完全豁免。 */
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
        /* 高中模式圆 = 质点（circleRollStep 强制 ω≡0），不许用 setAngle 绕过它去转圆 ⇒ 高中圆宿主 j=0；
         *   多边形和大学模式全形状照常参与旋转修正。 */
        var _hsC0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'),
            _hsC1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
        /* 角度锁死的宿主（_rodLK）不参与旋转修正 */
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
        var _cap=(PHYS_MODE==='high')?4:ROD_PULL_MAX;
        if(Math.abs(c0)>_cap)c0=(c0>0?1:-1)*_cap;
        if(Math.abs(c1)>_cap)c1=(c1>0?1:-1)*_cap;
        var w0=(iI0>0&&j0)?(-iI0*j0*lam):0,w1=(iI1>0&&j1)?(iI1*j1*lam):0;
        // 旋转分量封顶：|Δth| ≤ ROD_ROT_MAX（保险丝）且锚点位移 ≤ ROD_PULL_MAX（与平移同口径）
        if(w0){if(Math.abs(w0)>ROD_ROT_MAX)w0=(w0>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w0)*r0l>ROD_PULL_MAX)w0=(w0>0?1:-1)*ROD_PULL_MAX/r0l;}
        if(w1){if(Math.abs(w1)>ROD_ROT_MAX)w1=(w1>0?1:-1)*ROD_ROT_MAX;
          if(Math.abs(w1)*r1l>ROD_PULL_MAX)w1=(w1>0?1:-1)*ROD_PULL_MAX/r1l;}
        if((c0||w0)&&h0){
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h0)){   // h1 正被拖 ⇒ h0 只留缓慢牵引（理由见 h1 分支）
            var _cap0=0.5;
            if(Math.abs(c0)>_cap0)c0=(c0>0?1:-1)*_cap0;
            if(w0)w0*=0.15;
          }
          /* 不要把 w0 清零（与 h1 侧对称）：旋转修正是位置约束 C=|p1−p0|−L 的组成部分（∂C/∂θ_i=±(u×r_iw)），
           *  砍掉它 ⇒ 位置误差全压给平移 ⇒ 大偏差时 λ 被 _cap 截断 ⇒ 非保守修正 ⇒ 泵能。 */
          if(h0&&h0.mb&&h0.kind==='W'&&!h0.mb.isStatic){   // 锚定 W 体单步位置修正上限 0.45px/子步（理由见 h1 分支）
            var _c0max=0.45;if(c0>_c0max)c0=_c0max;if(c0<-_c0max)c0=-_c0max;
          }
          var am0=Math.hypot(c0,(w0||0)*r0l),rem0=rodPbdRemain(h0);   // 每宿主每子步修正总预算（rodPbdRemain）
          if(am0>rem0&&am0>1e-9){var kk0=rem0/am0;c0*=kk0;if(w0)w0*=kk0;am0=rem0;}
          rodPbdAdd(h0,am0);
          h0.x+=ux*c0;h0.y+=uy*c0;if(w0)h0.th=(h0.th||0)+w0;
          if(h0.mb&&MW){Matter.Body.setPosition(h0.mb,{x:h0.x,y:h0.y});
            if(w0)Matter.Body.setAngle(h0.mb,h0.th);
            Matter.Sleeping.set(h0.mb,false);}}
        if((c1||w1)&&h1){
          /* 一端宿主正被指针拖 ⇒ 另一端不再被位置相位硬搬（只留 ≤0.5px/子步的缓慢牵引），让重力主导：
           *  拖墙时被吊物体绕锚点摆，而不是被瞬间拖到杆端上方倒悬。 */
          if(grab&&grab.kind==='body'&&(grab.obj===h0||grab.obj===h1)&&!(grab.obj===h1)){
            var _cap1=0.5;
            if(Math.abs(c1)>_cap1)c1=(c1>0?1:-1)*_cap1;
            if(w1)w1*=0.15;
          }
          /* 不要把 w1 清零：旋转是位置约束的一部分（p_i=x_i+R(θ_i)·r_i ⇒ ∂C/∂θ_i 必须参与），否则位置误差全压给平移
           *  ⇒ 大偏差时 λ 被 _cap 截断 ⇒ 非保守修正 ⇒ 系统凭空获得动能。PBD 旋转相位本身就能给出正确的复摆动力学。
           *  双摆 600 帧实测（总能量正漂）：w1=0 + rodHingeTorque 为 +1.14 且翻圈；不清零、停用力矩为 +0.0002，
           *  姿态正确（受力侧下沉）；真复摆 30° 释放单调收敛到竖直。 */
          /* 锚定 W 体的单步位置修正上限 0.45px/子步：位置相位把物体搬运到杆端是非物理通道，搬太快会凭空抬高物体、
           *  注入能量（松手后能量暴涨数倍）。 */
          if(h1&&h1.mb&&h1.kind==='W'&&!h1.mb.isStatic){
            var _c1max=0.45;if(c1>_c1max)c1=_c1max;if(c1<-_c1max)c1=-_c1max;
          }
          var am1=Math.hypot(c1,(w1||0)*r1l),rem1=rodPbdRemain(h1);   // 每宿主每子步修正总预算（rodPbdRemain）
          if(am1>rem1&&am1>1e-9){var kk1=rem1/am1;c1*=kk1;if(w1)w1*=kk1;am1=rem1;}
          rodPbdAdd(h1,am1);
          h1.x-=ux*c1;h1.y-=uy*c1;if(w1)h1.th=(h1.th||0)+w1;
          if(h1.mb&&MW){Matter.Body.setPosition(h1.mb,{x:h1.x,y:h1.y});
            if(w1)Matter.Body.setAngle(h1.mb,h1.th);
            Matter.Sleeping.set(h1.mb,false);}}
      }
      /* 不要在这里加「速度继承 v+=Δx/dt」：实测无效且有害 ——
       *   ① 位置相位 err≤0.05 早退时继承量趋零；② 真有修正量时，沿杆方向的速度分量会被下方轴向相对速度投影正确砍掉；
       *   ③ 快拖时修正封顶 12px ⇒ 继承速度可达 2880px/s，给松手弹射新开一条注能路径。 */
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      // 轴向相对速度投影：Ċ=0，按 1/m 分配回两端（PBD 的标准收尾，跑一次）。双模门控：
      //   · 两端宿主均无活动接触（自由摆动/悬空）⇒ Ċ 计入锚点的 ω×r（见下）。只用纯平动时，杆力作用在偏离质心
      //     的锚点上使宿主自转、而速度相位不管 ω ⇒ 自由摆越荡越高直到翻顶（能量泵）。
      //   · 任一端有接触 ⇒ 纯平动投影：接触场景带 ω×r 耦合会在落地处正反馈（速度冲到 1.4e4 px/s）。
      //   高中圆宿主 ω≡0 ⇒ j=0，自动退化为纯平动。
      var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
      var ax=p1.x-p0.x,ay=p1.y-p0.y,ad=Math.hypot(ax,ay)||1e-6;
      var ux=ax/ad,uy=ay/ad;
      var v0x=h0?(h0.mb?h0.mb.velocity.x*60:(h0.vx||0)):0;
      var v0y=h0?(h0.mb?h0.mb.velocity.y*60:(h0.vy||0)):0;
      var v1x=h1?(h1.mb?h1.mb.velocity.x*60:(h1.vx||0)):0;
      var v1y=h1?(h1.mb?h1.mb.velocity.y*60:(h1.vy||0)):0;
      var vr=(v1x-v0x)*ux+(v1y-v0y)*uy;
      var _hsV0=(PHYS_MODE==='high'&&h0&&h0.wshape==='circle'), // 高中圆 ω≡0（同位置相位的质点门）
          _hsV1=(PHYS_MODE==='high'&&h1&&h1.wshape==='circle');
      if(_free&&(iI0>0||iI1>0)){
        /* 自由摆分支：Ċ 用锚点真实速度（含宿主自转贡献 ω×r），冲量只走平动 ——
         *   Ċ=u·v1−u·v0−ω1·j1+ω0·j0（2D：u·(ω×r)=−ω·j，j=ux·ry−uy·rx）
         *   K=im0+im1+iI0·j0²+iI1·j1²；λ=−Ċ/K；v0 += −u·λ·im0、v1 += +u·λ·im1。
         *   不要把 ω 写回（setAngularVelocity，b2DistanceJoint 全套）：它与位置相位每子步的 Δth 瞬移打架，泵得更猛；
         *   只把 ω 计入 Ċ、冲量只给平动时摆动有界。旋转速度误差留给位置相位收敛。
         *   j=0（高中圆/锚点共线）时退化为纯平动版。 */
        var om0=h0&&h0.mb?h0.mb.angularVelocity*60:0,     // 属性×60 = rad/s
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
        /* 有接触：纯平动投影 */
        var tt=im0+im1;
        if(tt>1e-9){
          if(im0>0&&h0&&h0.mb)Matter.Body.setVelocity(h0.mb,{x:(v0x+ux*vr*im0/tt)/60,y:(v0y+uy*vr*im0/tt)/60});
          if(im1>0&&h1&&h1.mb)Matter.Body.setVelocity(h1.mb,{x:(v1x-ux*vr*im1/tt)/60,y:(v1y-uy*vr*im1/tt)/60});
        }
      }
    }
    // 姿态可视化（统一路径，tt>0 / tt=0 都走这里）：只摆姿态、绝不写 len
    // （轻质杆不可伸长，锚距≠Lr 的缺口如实保留）
    var p0=springAnchoredWorld(B,0),p1=springAnchoredWorld(B,1);
    B.x=(p0.x+p1.x)/2;B.y=(p0.y+p1.y)/2;
    /* th 连续化（禁止 atan2 的 ±π 跳变）：th 是累积角，跳变 ~2π 会被当成一次真实转动。 */
    B.th=(B.th||0)+shortAng(Math.atan2(p0.y-p1.y,p0.x-p1.x)-(B.th||0));
    B.len=Lr;B.hw=Lr/2+2;
    return true;
  }
  // ---- 单端拴住 = 绕该点的铰链（光滑铰链的最小形态）-----------
  // 必须绕锚点转，不能只把锚端平移回去：平移版保持自由端不动，两端距离每子步被重力拉长且从不回缩（杆自己变长）。
  // 绕锚点转动是刚性运动 ⇒ 两端距离恒等于 B.len，长度守恒由构造保证。
  var k=w[0]?0:1,t=1-k;
  // 残差判据必须是「锚定端离锚点的偏移」，不是「自由端离半径 L 圆的径向误差」：
  //   后者对切向平移在一阶上不变，却会带着锚定端一起漂 ⇒ 修正永不触发、误差偷偷累积。
  var pk=rodEndWorld(B,k);
  if(Math.abs(pk.x-w[k].x)<0.05&&Math.abs(pk.y-w[k].y)<0.05)return false;   // 已满足 ⇒ 不折腾
  var L=B.len||170,e=rodEndWorld(B,t);
  var dx=e.x-w[k].x,dy=e.y-w[k].y,dd=Math.hypot(dx,dy);
  if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
  var nx=w[k].x+dx/dd*L,ny=w[k].y+dy/dd*L;      // 自由端投到「以锚点为心、半径 L」的圆上
  rodPlaceEnds(B, k?nx:w[k].x, k?ny:w[k].y, k?w[k].x:nx, k?w[k].y:ny);
  // ---- 铰链的速度投影 ------------------------------------------------------
  // 只投影位置不够：重力每子步给 vy 加一点，投影又吃掉位移 ⇒ vy 无界增长，解除锚定时整根杆以累积速度弹射。
  // 绕定点转动的刚体，形心速度必须垂直于 (形心−锚点)：
  //   ω = (r×v)/|r|²，然后 v := ω ẑ×r。径向分量丢掉，切向（摆动）不动。
  if(dt>0&&isFinite(dt)){
    var rx=B.x-w[k].x,ry=B.y-w[k].y,rl2=rx*rx+ry*ry;
    if(rl2>1e-6){
      var om=(rx*(B.vy||0)-ry*(B.vx||0))/rl2;
      B.vx=-om*ry;B.vy=om*rx;B.om=om;
    }
  }
  return true;
}
/* 杆宿主的 XPBD 速度重建（配合 rodSyncAnchors 里的快照，防止摆动漏能）。
 * 必须在每子步 Matter.Engine.update 之后调用：完整子步位移 = 快照 → 积分后位置（含约束修正 + 重力积分）；
 * 若在积分前反推就只剩修正量，等于每子步把速度清零（摆动变成蠕动）。
 * v = Δx/dt_sub（Matter 口径 ×(1/60)/(1/240)=×4），ω 同理；切向动能完整保留、与重力功自洽。
 * 门控：_xpsFree（两端无活动接触）才重建，接触场景不变；睡眠宿主不唤醒（保住静止冻结）；
 * 被抓端不碰（位姿归指针）；高中圆 ω≡0（_hsV 门）不写 ω。 */
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
      /* ω 重建只对简单体（parts==1）开放：复合体（墨迹链）上 Engine 的 angle 积分与位置相位 setAngle 的口径差
       *  会使 Δθ 系统性偏大 ⇒ ω 越写越大。复合体只重建平动。 */
      /* 铰接体（_hinged）与被独立铰链钉住的宿主（_hconOn）的 ω 不参与重建：这类体位置几乎不动、Δθ≈0，
       *  每子步用 ω=Δθ/dt 覆盖会抹掉重力力矩的增量，物体无法绕固定点按力矩旋转（复摆/跷跷板不动）。
       *  它们的旋转动力学归 Matter 积分 + rodHingeTorque。 */
      if(h.mb.parts.length===1&&!(PHYS_MODE==='high'&&h.wshape==='circle')&&!h._rodLK&&!h._hinged&&!h._hconOn)
        {
          var _om=(h.mb.angle-xps[k][3])*q;
          /* ω 重建钳位（rad/帧）：位移里含位置相位的非物理搬运，不钳会把转动能量放大注入。 */
          if(_om>0.2)_om=0.2;if(_om<-0.2)_om=-0.2;
          Matter.Body.setAngularVelocity(h.mb,_om);
        }
    }
  }
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
  /* 静态端（铁砧）必须把杆拉回来，而不是 continue 放着不管：否则指针把杆整体带走时，静态端的杆端直接离开锚点（脱钩）。
   * 做法：静态端绕锚点转动 —— 把杆摆成「静态端精确落在锚点上、另一端仍在半径 len 的圆上」的唯一解
   * （与 rodSyncAnchors 单端分支同一几何），拖动期杆端始终在锚点上。只改位置，不动速度（避免与 Matter 积分打架）。
   * 顺序：先处理静态端（决定杆的位姿），再处理可动端（把宿主搬到杆端），反了会被可动端的写入覆盖。 */
  for(var i=0;i<2;i++){
    var a=B.anc[i];if(!a||!a.B)continue;
    var h=a.B;
    if(h.dead||bodies.indexOf(h)<0){B.anc[i]=null;continue;}   // 宿主没了 ⇒ 这一端自动自由
    if(!hostIsAnvil(h)&&!springHostPinnedByAnvil(h,B))continue; // 可动端在下面第二趟处理
    var w=springAnchoredWorld(B,i),q=rodEndWorld(B,i);
    if(!w||!q)continue;
    if(Math.abs(q.x-w.x)<0.05&&Math.abs(q.y-w.y)<0.05)continue; // 已在锚点上 ⇒ 零开销
    // 自由端（另一端）：保持它相对锚点的方向，把距离投到半径 len 的圆上（与 rodSyncAnchors 单端分支同一几何）。
    var o=1-i,e=rodEndWorld(B,o),L=B.len||170;
    var dx=e.x-w.x,dy=e.y-w.y,dd=Math.hypot(dx,dy);
    if(!dd||dd<1e-6){dx=Math.cos(B.th||0)*L;dy=Math.sin(B.th||0)*L;dd=L||1;}
    var nx=w.x+dx/dd*L,ny=w.y+dy/dd*L;
    rodPlaceEnds(B, i?nx:w.x, i?ny:w.y, i?w.x:nx, i?w.y:ny);
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
    h2.x+=dx2*_rl;h2.y+=dy2*_rl;      // relax<1 时只搬一部分（链解用）
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
/* 多杆链的拖动：拖的不是杆时，链上其它杆没有求解者。rodDragPinHosts(R) 是几何精确解（幂等），但只在
 *  被拖的是杆时调用；拖物体时相邻杆只靠 rodSyncAnchors 的逐步投影（每子步修正有上限）去追，追不上 ⇒ 杆端与
 *  物体分离，再往外一环更没人解。
 *  做法：从被拖体出发沿杆 BFS，逐根调用同一个几何解；只有被拖体本身临时当铁砧（_dragPin），中间宿主保持可动
 *  ⇒ 反复扫几遍即 Gauss-Seidel，多根杆交替投影收敛到两圆交点（若存在）。
 *  逐子步调用（指针停住时也必须继续收敛）。只改位置、清宿主速度，不注入动能。 */
var ROD_CHAIN_ITERS=10;      // 每子步的 Gauss-Seidel 扫几遍
var ROD_CHAIN_RELAX=0.5;
var ROD_CHAIN_MAXLINK=12;    // 链上最多处理多少根杆（防病态数据打环）
/* 把杆的姿态立即按当前锚点重算（只摆姿态：不改宿主、不写 _rodL、不碰速度）。
 * 杆的 B.x/B.th 是姿态缓存，只在 rodSyncAnchors 末尾更新；rodDragPinChain 在它之后跑 ⇒ 杆姿态滞后一个子步，
 * 拖拽中表现为杆与物体恒定分离 8~10px（此时两锚点距离其实已等于杆长）。
 * 而且 rodDragPinHosts 的 pass1 用 |rodEndWorld − springAnchoredWorld| 当残差，姿态滞后会让它去「修」没坏的
 * 东西（绕锚点重摆整根杆），与 pass2 搬宿主互相追打。本函数只补缓存一致性，不解约束。
 *   双端：中心=锚点中点、方向=w1→w0（与 rodSyncAnchors 的姿态段一致）；
 *   单端：绕锚点转动把锚定端摆回锚点（与单端铰链分支同一几何）。
 * 纯位置写入，无随机、无时间依赖。 */
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
                   k?w.x:w.x+dx/dd*L,k?w.y:w.y+dy/dd*L);
  }
  /* 杆当前无 Matter 镜像板（B.mb 恒 null），姿态只在 B.x/B.y/B.th 里；下面的同步仅在镜像板存在时生效。 */
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
  /* 链的传播图必须经过宿主：杆-杆不互锚（rodTryAnchor 里 `if(h.kind==='T')continue`），两根杆只会共享宿主。
   *      杆1.anc = [墙W, A]      杆2.anc = [A, B]      被拖的是杆2
   *  只沿「某根杆的另一端宿主」推进的话，从杆2 出发永远走不到杆1，链解对它空转；而 rodSyncAnchors(杆1) 每子步
   *  收回的量又被 rodDragPinHosts(杆2) 精确搬回，A 被卡死、杆1 被拉长到两倍。
   *  所以把 seed 的宿主也当作 BFS 起点，共享宿主的另一根杆就会被收进链。 */
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
      for(i=0;i<pullSet.length;i++){                // 宿主入队（链的第一环）
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
          /* 链解只用几何精确解 rodDragPinHosts，不要再叠加 rodSyncAnchors：单用它时稳态残差更大（每子步修正上限太小，
           *  且会搬动被拖体），两路叠加又会互相追打。够不着时由下面「被拖体参与位移分配」把 seed 拉回可达域。 */
          /* 先按当前锚点重算杆姿态，再解约束：rodDragPinHosts 的 pass1 以杆端残差为输入，而 B.x/B.th 是上一子步的
           *  陈旧缓存（见 rodResyncRodPose）。必须在解约束之前，一次即可（后面每轮 BFS 会再进来）。 */
          rodResyncRodPose(r);
          if(rodDragPinHosts(r,ROD_CHAIN_RELAX))any=true;
          /* 不要在链解里给产品自管位姿的 W 体写角度（例如用宿主小转动吃掉残差的切向分量）：实测不稳定，
           *  同一代码两次运行给出 0.1px 与 120px，按住不动时会突然崩开。 */
          if(o&&!o.dead&&bodies.indexOf(o)>=0&&seen.indexOf(o)<0){seen.push(o);q.push(o);}
        }
      }
      /* 约束够不着时被拖的那一端也参与位移分配（与绳 conPull 的 allowGrab 同一语义）⇒ 拖不动，但不分离。
       *  每轮扫完链后，若被拖侧仍有残差，就把相应宿主往回搬（×relax）：
       *    · 几何可达 ⇒ 残差收敛到 0 ⇒ 一句都不动 ⇒ 完全跟手；
       *    · 几何不可达 / 只平移不旋转造成的折中残差 ⇒ 被拖体被链拉住 ⇒ 不分离。
       *  pointermove 按绝对指针写位置，chain 按约束往回拉，两者拉锯的稳定解就是「物体停在可达边界上」。 */
      for(i=0;i<rods.length;i++){
        var rs=rods[i];
        if(rs.dead)continue;
        /* 判据：哪一端锚在被拖侧。被拖侧 = seed 自己或 seed 的宿主（拖杆2 时被拖侧 = {杆2, A, B}，杆1 的 A 端在其中）。 */
        var b0=rs.anc[0],b1=rs.anc[1];
        var i0=(b0&&b0.B&&pullSet.indexOf(b0.B)>=0)?0:-1;
        var i1=(b1&&b1.B&&pullSet.indexOf(b1.B)>=0)?1:-1;
        /* 两端都在被拖侧 ⇒ 该杆对「拖不动」没有发言权，跳过。 */
        if(i0>=0&&i1>=0)continue;
        var si=(i0>=0)?0:((i1>=0)?1:-1);
        if(si<0)continue;
        /* 判据必须是纯几何的（两端锚点距离 vs 杆长），不能看杆端残差：rodDragPinHosts 的 pass1 会把铁砧端
         *  （含 seed，因 _dragPin）精确摆到锚点上 ⇒ seed 那一端残差恒为 0，永远触发不了。 */
        var wsA=springAnchoredWorld(rs,si),wsB=springAnchoredWorld(rs,1-si);
        if(!wsA||!wsB)continue;
        var vx=wsB.x-wsA.x,vy=wsB.y-wsA.y,dAB=Math.hypot(vx,vy);
        var over=dAB-(rs.len||170);
        /* 双向：over>0 = 拉太开（拉回）；over<0 = 链被压扁（两圆不相交）⇒ 推远到「锚距 = 杆长」。刚性杆两向都要收。 */
        /* over 不能堆到 seed 上：seed 正被指针拖，rodDragPinHosts 每子步把 seed 精确摆回钉位，会把修正整份冲掉。
         *  与 ropeSolve/conPull 的 allowGrab 同一语义：多余量由可动的一侧吸收，钉在指针下的一侧只能「拖不动」。
         *  ⇒ over 施加在被拖侧的远端（seed 的另一端宿主，如 B）；那一端也不可动时才退回移动 seed。 */
        if(Math.abs(over)<=0.5)continue;   // 已经等于杆长 ⇒ 一句都不动（保住跟手）
        if(dAB<1e-6)continue;
        var _mvx=vx/dAB*over*ROD_CHAIN_RELAX, _mvy=vy/dAB*over*ROD_CHAIN_RELAX;
        /* 被拖侧的远端：从 pullSet 里找不是指针拖着的那个，优先选未被拖的 seed 宿主（B）。 */
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
          seed.x+=_mvx;seed.y+=_mvy;     // 远端也挪不动 ⇒ 退回移动 seed
          if(seed.mb&&MW)Matter.Body.setPosition(seed.mb,{x:seed.x,y:seed.y});
        }
        any=true;
      }
    }
  }finally{ seed._dragPin=false; }   // 标志必须在任何出口都清掉（否则这个体以后永远当铁砧）
  return any;
}
/* 拖拽中的 S 族（弹簧 / 轻绳 / 光滑铰链）= 拖整个装配体，且必须逐子步摆（与 rodDragPinHosts 同理）。
 * pointermove 里的 springMoveRig(B,sdx,sdy) 是增量式的，指针一停就没有事件 ⇒ 装配体位姿归 Matter ⇒ 重力把整体带走。
 * 做法：逐子步把被抓住的那一点精确摆回指针 —— 用按下时记的本地偏移（glx/gly，物体转动后抓的始终是同一块材料）
 * 还原该材料点的世界坐标，把残差整份交给 springMoveRig（搬弹簧两端 + 所有非铁砧宿主，并清宿主速度
 * ⇒ 不攒松手弹飞的动能）。增量那一路保留（更跟手），两条路都收敛到「材料点在指针下」。 */
function springDragPinRig(B){
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
// 拖杆松手 → 两端各自的 ROD_SNAP 内若压着别的物体就拴上（判定点 = 两个端点本身，
// 与 springTryAnchor 同一规格：杆身中段压到什么都不算，那只是支撑不是锚）。
function rodTryAnchor(B){
  if(!B||B.kind!=='T'||B.dead||!B.anc)return;
  for(var i=0;i<2;i++){
    if(B.anc[i])continue;                        // 已拴住的保持原样（不抢不换）
    var e=rodEndWorld(B,i),bd=ROD_SNAP,hit=null;
    for(var j=0;j<bodies.length;j++){
      var h=bodies[j];
      if(h===B||h.dead)continue;
      if(grab.kind==='body'&&grab.obj===h)continue;   // 正在被拖的东西不算「固定物」
      // 杆端不许锚到铰链器件上：铰链是连接件不是刚体，且它可能正拴着这根杆自己
      //   ⇒ 成环（杆→铰链→杆）、过约束。
      if(h.kind==='S'&&h.hinge)continue;
      // 与 springTryAnchor / springTryAnchorByHost 同款守卫：本端已通过铰链连着候选宿主 ⇒ 不许再直接锚
      //   （铰链+直锚 = 过约束互推爬行）。拖杆松手时自由端正贴着铰链另一端的宿主，没有这条必中。
      var hin3=false;
      for(var hq=0;hq<bodies.length;hq++){
        var H3=bodies[hq];
        if(H3===B||H3.dead||H3.kind!=='S'||!H3.hinge||!H3.anc)continue;
        var t0=H3.anc[0],t1=H3.anc[1];
        if(t0&&t1&&((t0.B===B&&t1.B===h)||(t0.B===h&&t1.B===B))){hin3=true;break;}
      }
      if(hin3)continue;
      /* 候选宿主是杆 ⇒ 跳过（杆-杆不建立锚定关系，直接连接会卡顿）。 */
      if(h.kind==='T')continue;
      var dd=distToHost(h,e.x,e.y);
      if(dd<bd){bd=dd;hit=h;}
      /* 杆端可以插进物体内部，而表面判定（distToHost<15）在内部永远不命中 ⇒ 端点进入物体内也视为命中：
       *  深插到质心带 ⇒ 锚质心，浅插 ⇒ 锚最近表面点（由 springAnchorOffset 分流）。 */
      var _dcin=Math.hypot(e.x-h.x,e.y-h.y);
      /* 内部判定用最小半轴：用 max 的话细长条（横墙 hw=100/hh=12）会把旁边大片虚空判成内部（杆被固定在墙下虚空）。 */
      var _rin=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
      var _din=_dcin-_rin;                       // <0 = 端点在物体内部
      if(_din<0&&bd>_din){bd=_din;hit=h;}
    }
    if(!hit)continue;
    // 先把端点吸到宿主表面再记偏移（顺序不能反：偏移必须按吸附后的端点算，否则第一帧被拉回）。
    // 下面必须走 rodPlaceEnds（索引序）：参数按编号写（index i = q、index 1-i = o），直接喂 setRodEnds
    // 会塞进反的槽位 ⇒ 锚点记到另一头（见 rodPlaceEnds 注释）。
    /* 端点在物体内部时不收到表面：杆端插进内部说明用户在往质心插，先收到表面会把端点拉出来，质心判定永远轮不到。
     *  保留内部位置，交给 springAnchorOffset 的质心带判定（dc≤0.7rad）。 */
    var _dcIn=Math.hypot(e.x-hit.x,e.y-hit.y);
    var _rIn=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);   // min 半轴（同上）
    /* 内部浅插暂不收到最近表面点（之前的实现引发过 JS 异常）：内部落点交给 springAnchorOffset 分流
     *  （质心带内 = 质心，带外 = 表面最近点）。 */
    if(_dcIn<_rIn){
      B.anc[i]={B:hit};springAnchorOffset(B,i);
    }else{
    /* 杆的吸附优先级：角 > 边中点 > 表面点 */
    var q=hostCornerSnapPoint(hit,e.x,e.y)||hostMidSnapPoint(hit,e.x,e.y)||hostClosestPoint(hit,e.x,e.y),o=rodEndWorld(B,1-i);
    if(q){rodPlaceEnds(B, i?o.x:q.x, i?o.y:q.y, i?q.x:o.x, i?q.y:o.y);
      B._rodL=B.len;}                 // 吸附挪了端点 = 有意改长度
    B.anc[i]={B:hit};springAnchorOffset(B,i);
    }
  }
}
function springAnchoredWorld(B,i){
  var a=B.anc[i];
  if(!a||!a.B)return null;
  var h=a.B;
  if(a._noRot&&B.kind!=='T')return {x:h.x+a.ox,y:h.y+a.oy};  // _noRot：只跟平动（高中弹簧旧语义，springAnchorOffset 已不再写入）；杆两模式都随宿主转
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
function railHostSupported(h){
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
function springRailRelaxed(B){
  var Lk=B&&B.dirLock;
  if(!Lk||PHYS_MODE!=='high'||Math.abs(Lk.uy)>=1e-3)return false;
  // 拖杆的长度手柄也算拖拽态（宿主正被手按住，导轨不能反过来搬它）
  if(grab&&(grab.kind==='body'||grab.kind==='rodlen')){
    for(var i=0;i<2;i++){var a=B.anc[i];if(a&&a.B&&a.B===grab.obj)return false;}  // 拖拽态：不放松，走常规导轨跟随
  }
  return true;
}
// 能力标记：供外部探针脚本识别该行为是否存在（缺失时 SKIP）。
springRailRelaxed._r95=true;
function springRailFollow(B){
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
// 能力标记（供外部探针脚本识别）：springRailFollow 每帧把可动宿主锚点绝对对齐到导轨，
// 且无静止/拖拽参考时法向速度取平均。改语义请一并改它。
springRailFollow._r93=true;
// 拖拽轴向约束：被拖物体若挂在某根方向锁弹簧的一端，而另一端是真固定（static / 右键固定），
//   则本次拖拽只允许沿导轨轴向移动：指针位移的法向分量直接丢掉。
// 刚性参考只算 static / fixed，不算压在地上（railHostSupported）：两只压地的球组成的水平弹簧
//   必须能被拖动整体抬起来，把压地算进来就废了。
// 为什么在拖拽侧守：拖拽默认是「指针决定位姿」，但导轨在法向上对装配体是刚性的，被拖物体横向离开
//   导轨后弹簧端点仍投影在导轨上 ⇒ 连接点从物体表面滑开。所以法向必须由拖拽侧拦住，指针只能拉长/压缩弹簧。
// 返回单位方向 {x,y}（导轨轴向）或 null。B 是弹簧自身（kind==='S'）时不约束（拖弹簧 = 搬整体）。
// dragAxisLock._r94 是能力标记，供外部探针脚本识别。
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
      if(!((oh.mb&&oh.mb.isStatic)||oh.fixed))continue; // 只认真固定（见函数头注释）
      found={x:S.dirLock.ux,y:S.dirLock.uy};            // 两端同轴，取哪根都一样
    }
  }
  return found;
}
dragAxisLock._r94=true;
/* 拖连着杆的宿主（杆另一端是固定体）时，直线拖拽与杆长不可伸长冲突 —— conDragConstrain 的反向钳位
 * 会把拖拽整个吃掉。改为沿弧线拖：指针投影到绕另一端锚点、半径=杆长的圆弧上，跟手且杆长恒定。
 * 返回弧参数 {cx,cy,R}，由 dragPtrAxis 统一投影。 */
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
// 把当前指针投影成等效指针：法向分量丢掉，只留导轨轴向分量（弧线锁时投影到圆弧上）。
// 这个投影必须被所有「把被拖物体摆到指针位置」的写入点共用（pointermove 的即时摆放和 stepMatter
//   的每帧摆放）：漏掉任一处，另一处会以未投影的指针覆盖，轴锁看起来完全没生效。
function dragPtrAxis(){
  /* 弧线拖拽：被拖体连着另一端为铁砧的杆时，等效指针 = 绕锚点、半径=杆长的圆弧上朝原始指针方向的点 + 抓点偏移。 */
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
// 方向锁弹簧的宿主冻结自转（与弹簧组成整体，只随整体旋转）。每帧把角速度清零（stepSprings 在
// stepMatter 的引擎步进之后跑，此刻清零保证渲染与下一帧积分都看到 ω=0，碰撞残余角速度活不过一帧），
// 且弹簧力通道不再对它产生力矩（springForceOn 里 _lockRot 时把作用点折叠到质心）。
// 两根弹簧一锁一不锁共宿主时按锁的算（并集语义）。
function springSyncLocks(){
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
function springHostVel(h,ux,uy,px,py){
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
function springForceOn(h,fx,fy,dt,px,py,ks){
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
function springRotate(B,th){
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
function springSetLen(B,L){
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
function springCanRotate(B){
  // 铰链没有方向（长度 0、两锚点重合），不出现旋转手柄。
  if(B&&B.hinge)return false;
  // 弹簧只有至少一端自由才转得动（两端都拴住时几何由宿主决定）；
  // 方向锁弹簧永远显示旋转手柄：它拧的是整个装配体（springAssemblyRotate，含导轨朝向），不受此限制。
  return !!(B&&B.kind==='S'&&(B.dirLock||!(B.anc[0]&&B.anc[1])));
}
function springMirror(B){
  window.__mirN=(window.__mirN||0)+1;
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
var SPR_CAP_W=40, SPR_CAP_T=10;
/* 顶部天花板（Matter 静态体 MW.wt）内缘的内缩量。内缘取 −(BND_INK+CEL_INSET)：物体真的越出画布
 * （墨迹完全离开可视区上缘）才碰到它 —— 与左右墙的离屏语义同款，只是窄一些，避免物体在屏幕里
 * 被看不见的墙挡住。内缘随视口走、与 groundY 无关。 */
var CEL_INSET=24;
/* wt 内缘恒 = celInnerY()；wt 半高 300 ⇒ 中心 = celInnerY()−300。resize() 每帧按视口重算。
 * 必须惰性求值，不要写成 var CEL_INNER=-(BND_INK+CEL_INSET)：BND_INK 在后面才赋值，此处取到 undefined
 * ⇒ NaN ⇒ Bodies.rectangle 的 bounds 塌掉 ⇒ 顶墙存在、isStatic，却什么都挡不住。 */
function celInnerY(){return -(BND_INK+CEL_INSET);}
function celCenterY(){return celInnerY()-300;}
/* 物体在正交基 (u,n) 下的真实投影半宽（以质心为原点，遍历复合体全部 parts），返回 {u, n}。
 * 用于端帽（springEndCaps）的轴向 reach 与横向带判定。
 * 不用 (AABBw+AABBh)/4：那是被长边主导的平均半径，512×60 的横躺条带会算出 143px 假半径，
 * 在 136px 外就被判压在端帽上，弹簧隔空把物体推走。
 * 不用 mb.vertices：复合体的 mb.vertices 只等于 parts[0]，会漏掉其它 part。 */
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
  if(!ru&&!rn){  // 兜底：无顶点信息 ⇒ 退回 AABB 平均半径口径
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
/* 设备模式：'auto'（自动识别）/ 'desktop'（电脑版）/ 'touch'（触屏版），设置里可强制切换，存 localStorage。
 * 触屏版交互：
 *  · 拖动（pointermove）保留；
 *  · 点选放置：点一下选中（高亮），再点另一处 ⇒ 把选中体搬到该处（补偿手指粗、精细拖拽难）；
 *  · 长按 = 右键（450ms 未移动 ⇒ 弹菜单）。 */
var UI_MODE='auto';
try{var _um=localStorage.getItem('sandbox_ui_mode');if(_um==='desktop'||_um==='touch')UI_MODE=_um;}catch(e){}
function isTouchDevice(){
  return (('ontouchstart' in window)||(navigator.maxTouchPoints>0)||(navigator.msMaxTouchPoints>0));
}
function uiTouch(){return UI_MODE==='touch'||(UI_MODE==='auto'&&isTouchDevice());}
function setUIMode(m){
  UI_MODE=m;try{localStorage.setItem('sandbox_ui_mode',m);}catch(e){}
  /* 触屏模式的 body 级样式（显示面板收起把手） */
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
}
/* 初始化时按当前模式挂 body 类（面板把手/折叠） */
function applyUIModeClasses(){
  if(uiTouch()){DD.body.classList.add('touch-ui');DD.body.classList.add('touch-panel-folded');}
  else{DD.body.classList.remove('touch-ui');DD.body.classList.remove('touch-panel-folded');}
  fixPanelSlot();
  alignPanelToggle();
}
/* 面板第 1 行第 4 格留给把手（否则展开后挡住字符 a），第 4 个字符换到第 2 行开头，后续顺延。
 * CSS 规则在 auto-placement 下不生效 ⇒ 用内联样式直接定位（见 fixPanelSlot）。 */
/* 把手精确对齐到面板第 1 行第 4 格（同尺寸 44×44、同圆角 10、同一格位置）。 */
function alignPanelToggle(){
  var pan=DD.getElementById('panel'),tg=DD.getElementById('panelToggle');
  if(!pan||!tg)return;
  if(!DD.body.classList.contains('touch-ui'))return;
  /* 触屏折叠态下面板的 getBoundingClientRect 是折叠后的位置，拿不到格子坐标 ⇒ 用固定布局计算：
   * 面板固定在 top:24/right:24，padding 10，格 44 + gap 6 ⇒ 第 1 行第 4 格 = 右起 (24+10+44)、上起 (24+10)。 */
  tg.style.left=(window.innerWidth-24-10-44)+'px';
  tg.style.top=(24+10)+'px';
  tg.style.right='auto';
}
function fixPanelSlot(){
  var pan=DD.getElementById('panel');if(!pan)return;
  /* 与 sortPanel / dockSlotEl 共用同一个「序号 → 格」规则：按 DOCK_ORDER 逐个钉格。
   * 不要按 DOM 现有孩子顺序顺排：那是第二套槽位规则，清屏时 sortPanel 与 setTimeout(fixPanelSlot,0)
   * 先后各摆一遍，第 4 个字符会闪一帧错位；顺排还会让黑洞吃掉一个字符后，后面的整体前移。
   * 钉格则只留一个空格、其余不动。 */
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
var TIME_SCALE=1;          // 世界时间倍率（Δt）：1 正常、0 静止（右键字符 t 调）
var ROD_HINGE_DAMP=0.985;  // 铰接摩擦（0.985 ⇒ 摆动 2~3 次后停下；1=永不衰减）
/* 杆铰接重力力矩开关（三态，默认 1）。rodHingeTorque 按另一端类型分流：
 *   另一端自由      ⇒ 不施力矩；
 *   另一端动态体    ⇒ 施「对端载荷重量」的力矩；
 *   另一端静态/铁砧 ⇒ 施 τ = r×m·g —— 真枢轴（悬在墙上的复摆），重力把物体拉回最低势能点。
 *   =1 默认：只对铁砧端施力矩，姿态按 |r|·m·g/I 的时间尺度摆回最低点；自由端/动态端不施。
 *   =0 全停：姿态只剩 PBD 位置相位的旋转修正（被 ROD_ROT_MAX=0.02 rad/次封顶），慢但守恒；
 *      实测 60° 释放要约 10s 才回到最低点。作为保守回退位。
 *   =2 全开（含动态端力矩）：会注能（+1.14×KE峰），仅供对照。
 * 只加铁砧端不会注能：注能链条是「对动态/自由端施力矩 ⇒ ω 被推到钳位 9 rad/s ⇒ 锚点绕质心飞 ⇒
 * 位置相位大搬运 ⇒ rodXPBDVel 把瞬移当速度」。铁砧端宿主是被约束方，位移量级 |r|·θ̇·dt 远小于
 * ROD_PULL_MAX，不触发大搬运（实测正漂 ≤0.05）。 */
var ROD_HINGE_TORQUE=1;
/* 复摆重力力矩：Matter 的重力只作用于质心、不产生力矩 ⇒ 锚定物体永远不会因重力绕锚点摆动。
 * 显式补 τ = r×F（r=锚点→质心，F=(0, m·g)），物体像复摆一样绕固定点摆到稳定姿态。
 * 对哪些端施加由 ROD_HINGE_TORQUE 控制（见常量处）。 */
function rodHingeTorque(dt){
  if(!MW||!MW.engine)return;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* 杆(T)与铰链器件(S+hinge)都纳入处理。 */
    var _isHingeRod=(R.kind==='S'&&R.hinge);
    if((R.kind!=='T'&&!_isHingeRod)||R.dead||!R.anc)continue;
    for(var e=0;e<2;e++){
      var a=R.anc[e];if(!a||!a.B||a.B.dead)continue;
      var h=a.B;
      if(h.kind==='T'||!h.mb||h.mb.isStatic)continue;
      if(R._rodAngleLock)continue;      // 固定角度 ⇒ 不施加力矩（姿态跟着杆）
      /* 两端都锚在动态体时不施力矩：两个宿主各自被施加方向相反的重力力矩，会互相打架振荡（抽搐），
       * 此时姿态交给 PBD 约束。只有杆的另一端是静态体时才是真正的悬挂/复摆场景。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* 物理前提：τ = rx·m·g 描述的是物体绕固定枢轴摆动，只有另一端是静态/铁砧（墙、地面、fixed 体）时成立。
       *  · 另一端自由：杆是轻质连杆，对物体几乎没有影响；施力矩等于凭空把杆端当枢轴，表现为连接的那一侧
       *    被扭起来。必须不施。
       *  · 另一端是动态体：整条链的动力学由 rodSyncAnchors 的 PBD/XPBD 约束负责；两端各施一次绕自己锚点的
       *    重力力矩是重复计入（重力已在 Matter 积分里），且两侧方向相反 ⇒ 互相打架、成为能量泵。
       * 注能机制：rodSyncAnchors 位置相位对 W 宿主的旋转修正归零（wN=0）时，姿态完全由本函数驱动，
       * ω 被推到钳位 0.15 rad/帧 ⇒ 锚点绕质心高速飞 ⇒ 位置相位每子步把宿主搬 100+px ⇒ rodXPBDVel 用
       * 「子步位移 / dt」反推速度，瞬移被当成真实速度 ⇒ 动能爆炸。PBD 的位置+旋转相位本身就能给出复摆动力学。 */
      var _other=(e===0)?R.anc[1]:R.anc[0];
      var _oB=_other?_other.B:null;
      /* ROD_HINGE_TORQUE 三态分派（见常量处注释）：
       *   0 ⇒ 全停（姿态归 PBD，慢但守恒）
       *   1 ⇒ 只对铁砧端（默认，复摆动力学）
       *   2 ⇒ 全开（含动态端；会注能，仅对照用） */
      var _tqMode=(ROD_HINGE_TORQUE===true)?2:(+ROD_HINGE_TORQUE||0);
      if(!_tqMode)continue;
      var _oAnvil=(_oB&&((_oB.mb&&_oB.mb.isStatic)||_oB.fixed));
      var _oDyn=(_oB&&_oB.mb&&!_oB.mb.isStatic&&_oB.kind==='W');
      if(!_oAnvil&&!_oDyn)continue;      // 另一端自由（或已死）⇒ 不是枢轴，不施力矩
      if(_tqMode<2&&_oDyn)continue;      // 默认模式只对铁砧端（真枢轴）施力矩
      /* 多杆链守卫：τ=(C−M)×m·g 的前提是「一个连杆接到固定枢轴」（单摆/复摆）。宿主同时被 ≥2 根连杆锚住时，
       * 约束是多个锚点同时满足各杆长，动力学由 PBD 负责；再补单摆重力力矩会压掉多杆链的自然下沉
       * （实测 墙—杆1—A—杆2—B：无守卫时 A 转角 +0.005，加守卫 +0.505，与 τ=0 对照逐位一致）。
       * 链锚数 = 满足 R.anc[e].B===h 且 R.anc[1−e].B 是在场活体的 (R,e) 个数：=1 照旧施力矩，≥2 不施。
       * 只作用于铁砧端分支；mode 2 的动态端分支不变。 */
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
      var rx=h.x-p.x, ry=h.y-p.y;                  // rx,ry = C − M（锚点 → 质心）
      var m=h.mb.mass||1;
      /* 另一端动态时，物体受到的力矩来自对端载荷的重量（杆传力，两端严格等大反向），
       * 两边力矩成为一对作用反作用。τ = r' × F，r' = 锚点 − 质心 = (−rx, −ry)，F = (0, m_对端·g)
       * ⇒ τ_z = (−rx)·(m_对端·g)。 */
      var tau, _mA=(h.mb.mass||1);
      /* 两段力矩的力臂方向相反，不要共用一个符号（Matter：y 向下、θ 顺时针为正 ⇒ τ_z = r_x·F_y − r_y·F_x）：
       *  ① 铁砧端（真枢轴）= 复摆：重力作用于宿主质心，力臂 r = C − M ⇒ τ = +rx·m·g。
       *     自检：C 在 M 右侧（rx>0）⇒ 重力绕 M 顺时针 ⇒ τ>0。
       *  ② 动态端 = 杆传力：对端载荷重量沿杆传来，作用点在锚点，力臂 r = M − C ⇒ τ = −rx·m_对端·g。
       * 若铁砧端误用 −rx，力矩会把物体推向 θ=π（质心在锚点正上方，非稳定平衡），60° 释放后冲到 180° 附近
       * 卡住、ω 顶在钳位，看起来像铰链摩擦极大、半天不回最低点。
       * 标定（60° 释放，|r|=40，I_cm=8557.7）：τ=+rx 用 I_cm 首达 |θ|<0.15 只需 10 帧；用 I_pivot 16 帧且
       * 杆端残差更大；τ=0 或反号需 609 帧。取 I_cm 口径。
       * 注意：rodSyncAnchors 的位置相位是纯瞬移（setAngle/setPosition），PE 变而 KE 不变，
       * 总能量漂移不能作为这里物理正确性的判据。 */
      var tau, _mA=(h.mb.mass||1);
      if(_oDyn){
        var _mo=(_oB.mb.mass||1);
        tau=(-rx)*(_mo*GRAV)*_tw;                  // 杆传力：r = M − C ⇒ τ = −rx·m_对端·g
      }else{
        tau=rx*(m*GRAV)*_tw;                     // 复摆重力力矩：τ = (C−M)×m·g = +rx·m·g
      }
      /* ---- 锚点/质量自由端的兜底：另一端自由时上面已 continue，不会走到这 ---- */
      /* 不用 mb.torque（Matter 内部口径与 px/s² 不匹配，实测会爆到 1e9 度）。按实测标定直接改角速度：
       * ω 单位 = rad/帧，Δω = (τ/I)·dt²（dt=1/60s）。 */
      var I=h.mb.inertia||1;
      var dw=(tau/I)*(1/60)*(1/60);
      if(isFinite(dw)){
        /* 角速度钳位 ±0.15 rad/帧（≈9 rad/s）。注意单位是 rad/帧：±8 这种量级（≈480 rad/s）等于没钳，
         * 铰链物体会被力矩抽得疯狂抖动。 */
        var _w=(h.mb.angularVelocity||0)+dw;
        if(_w>0.15)_w=0.15;if(_w<-0.15)_w=-0.15;
        Matter.Body.setAngularVelocity(h.mb,_w);
      }
    }
  }
}
/* 杆/铰链相连的两个宿主放进同一负碰撞组（Matter group<0 同组永不碰撞），可以互相重叠，
 * 消除接触-分离的边界抖动。每帧先清零再按当前连接设置 ⇒ 解除连接后自动恢复可碰撞。 */
function rodSyncNoCollide(){
  var i;
  for(i=0;i<bodies.length;i++)if(bodies[i]._rcg){bodies[i]._rcg=0;
    if(bodies[i].mb)bodies[i].mb.collisionFilter.group=0;}
  for(i=0;i<bodies.length;i++){
    var R=bodies[i];
    /* 铰链器件在实现上是 S 体 + hinge 标记（不是 T），这里把 T（杆）与 S+hinge 一并纳入。 */
    if((R.kind!=='T'&&!(R.kind==='S'&&R.hinge))||R.dead||!R.anc)continue;
    var h0=R.anc[0]?R.anc[0].B:null, h1=R.anc[1]?R.anc[1].B:null;
    if(!h0||!h1||h0===h1||h0.dead||h1.dead)continue;
    if(h0.kind!=='W'||h1.kind!=='W')continue;        // 只处理物体-物体（墙/地面等静态体本来就不动）
    /* 静态宿主（用户画的地面/墙/挡板，kind 'W' + fixed）不进负组：它们是场景边界。把边界也设成同组，
     * 连着的动态体就能穿过它（实测方块被按进地面 23.6px 并抖动）。互不碰撞只留给两个动态体；
     * 不许穿透交给碰撞求解器（静态体质量无穷大，本来就推不动）。 */
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
      /* 杆宿主不打锁：杆是约束体不是刚体，杆-杆销接时每根杆都要能绕连接点自由转动
       * （锁死第一段会让混沌摆抽搐）。只有 W 体宿主才可能锁角度。 */
      if(a.B.kind==='T')continue;
      /* 不锁宿主角度：铰接物体按质量分布绕连接点摆动才是正确的复摆物理，
       * 静止平衡 = 质心在连接点正下方；锁死会让「静止到最低点」的自然行为消失。 */
      /* 杆开启「固定角度」⇒ 宿主锁死自转（姿态跟着杆走，连接点仍不动）。 */
      if(B._rodAngleLock)a.B._rodLK=true;
      a.B._hinged=!B._rodAngleLock;   // 固定角度时恢复 ω 重建（随杆同步）
      /* 铰接角速度阻尼：ROD_HINGE_DAMP<1 时每帧按比例衰减 ω（铰接摩擦），=1 时无阻尼、姿态完全交给物理。
       * 阻尼过强会压死重力力矩驱动的复摆转动。 */
      if(ROD_HINGE_DAMP<1&&a.B.mb&&a.B.mb.angularVelocity){
        Matter.Body.setAngularVelocity(a.B.mb,a.B.mb.angularVelocity*ROD_HINGE_DAMP);
      }
      if(ROD_HINGE_DAMP<1&&a.B.om)a.B.om*=ROD_HINGE_DAMP;
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
// 把端点吸附到宿主的表面上：判定带 SPR_PAD=15px 是为了手感（不用像素级对齐），但落点必须收到面上，
// 否则已经锚定却挂着 10~15px 的可见空隙。
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
var SPR_MID_ZONE=30;   // 边中点吸附的作用半径（px），见下方死区说明
/*
 * 边中点吸附：拖动弹簧靠近方框宿主的某条边时，显示并吸附到该边的中点，方便连上后物体不侧翻。
 *
 * 物理依据：匀质矩形板的质心垂直投影到某条边上，落点恰好是该边中点。装在中点的拉力相对质心的力臂方向
 * 与边法线重合，只会沿法线拉/推，不产生倾覆力矩；挂在角点上则有长力臂，一接上就翻。
 *
 * 只对方框类宿主生效：字母刚体（无 kind、有 hw/hh）与闭合且恰好 4 个角的 W 体（手绘/形状工具画的
 * 矩形/平行四边形）。杆/笔画/图形/三角形/圆弧/凹槽/折线的「边中点 = 质心投影」不成立（杆的中点锚定
 * 会让杆端无法受力），继续走 hostClosestPoint。
 *
 * 死区 SPR_MID_ZONE（30px）：中点离端点太远时不抢，否则在 240px 长的边上拖到最右端，锚点却被吸到
 * 120px 外的中央（瞬移）。超出半径就退回「离端点最近的表面点」。
 * 返回 {x,y,mid:true} 或 null（不是方框宿主 / 够不着）。
 */
// W 体（闭合四边形）的四条边中点。本地坐标 pts → 世界系（与 inkClosestPoint 同约定）。
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
/* 铰链器件吸附到物体的角：返回离指针最近的多边形顶点，在 CORNER_ZONE 内才命中。
 * 与 hostMidSnapPoint 同构（吸附优先级：角 > 边中点 > 表面点）。 */
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
  if(host.kind==='W')return wQuadMidSnapPoint(host,px,py);   // 画的方框也参与
  if(host.kind)return null;                                  // 杆/线/场源一律退出
  var c=Math.cos(host.th||0),s=Math.sin(host.th||0);
  var dx=px-host.x,dy=py-host.y;
  var lx=dx*c+dy*s,ly=-dx*s+dy*c;
  var hw=host.hw||30,hh=host.hh||24;
  // 四条边各自的中点（本地坐标），顺带算出端点到该边所在直线的距离，选最近的一条
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
/*
 * 铰链端点的落点必须落在宿主的碰撞面上，不能落在墨迹中线上。
 *
 * 原因：W 体的碰撞几何 = 墨迹中线外扩 BND_INK（闭链走 inflateHull(...,BND_INK)，开链/弧走 bndSegs 的
 * hh=BND_INK 定向矩形，buildMatterBody 里两处同值），而吸附落点（hostMidSnapPoint / hostClosestPoint）
 * 在中线上 ⇒ 落点在碰撞体内部 2.325px。铰链两端必须重合（len=0 的销），两个宿主的碰撞体就被迫互埋
 * 2·BND_INK = 4.65px —— 无解构型：Matter 位置求解器每步把可动宿主顶出去，hingeSolve 的 conPull 立刻
 * 拖回销上，表现为持续抖动 + 稳态穿透（实测 33~34px）。这种 60Hz 振荡在 rAF 采样下逐帧净位移看着很小，
 * Matter 配对表里存的深度也很小，要直接调 Collision.collides 才量得到。
 *
 * 做法（hingeSurfacePoint）：把锚点从中线推到碰撞面上，外法向取最近那条边的外法线（与 inflateHull 的
 * 边平移口径一致），两锚点在碰撞面上重合 ⇒ 两碰撞体正好相切（零重叠），销与接触解算器不再互斗。
 * 顶点处的处理见 hingeSurfacePoint 内注释。
 *
 * 只对铰链生效：弹簧/轻绳是单点附着，没有两锚点必须重合的约束，落点一挪会平移一批已标定的手感数值；
 * 轻绳限制的是最大间距，与接触方向一致，本来就不互斗。字母刚体的碰撞体就是它自己的方框（pad=0）。
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
  /* 外推到碰撞面（幅度 pad）是铰链两体相切而非互埋的必要手段，不能省。角点不要用以下简化处理，都会互埋抖动：
   * ① 角点跳过外推（落点回到墨迹中线，壳内 2.325px）；② 沿角平分线 u1+u2 外推（指向宿主内部）。
   * 顶点的正确处理见下。 */
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
  /* 顶点（角）上要推到碰撞壳的斜接角，不能沿单条边法线推 pad：
   *  · 碰撞壳 = inflateHull(pts, BND_INK)，每条边平行外移 pad，壳顶点 = 相邻两条外偏线的交点 ⇒ 壳角点离墨迹
   *    顶点 pad/sinψ（ψ = 半顶角）。只推 pad 时本宿主壳角会朝另一宿主多戳 pad(1/sinψ − 1)：直角 0.96px、
   *    顶角 40° 4.47px。
   *  · 超过 hingeContactUnfold 的进入门（hingePairDepth > HINGE_UF_EPS = 2.0）后进入无解构型：接触解算把可动
   *    宿主顶出去、conPull 拖回销上，unfold 每帧 Matter.Body.rotate 宿主（只改 angle/position、不改
   *    angularVelocity），位姿写在速度通道之外 ⇒ 自维持极限环。大学模式有空气阻力/摩擦压着，
   *    高中 air=μ=e=0 ⇒ 全幅抽搐。实测改为斜接后互埋从 3~58px 降到 0。
   *  · 方向取两条边外法线之和（外法向按背离质心选定，与 inflateHull 一致），幅度 pad/cos(θ/2) = pad/sin(半顶角)，
   *    落点恰好是壳的斜接角。直线段上两外法线相等 ⇒ cosHalf=1，退化为单边法线推 pad。
   *  · 开链（笔画）的两个端点没有相邻边（壳走方帽），退回单边法线；尖刺（cosHalf≤0.2，即内角 ≤23°）也退回，
   *    避免幅度爆掉。 */
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
// 锚点语义：hostClosestPoint 取离端点最近的表面点（不取离导轨线最近的垂足）。
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
function springTryAnchorByHost(host){
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
function springDisconnectAtPoint(x,y){
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
function springLockedAsmOf(seed){
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
function dissolveSpring(B){
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
// k 与 x 拼起来 = 弹簧。和 t 的组合同理，不分先后（见 findTComboTarget 里的说明）。
function findKXCombo(L){
  if(!L||L.dead)return null;
  var t=L.type;
  if(t!=='k'&&t!=='x')return null;
  var other=(t==='k')?'x':'k';
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var F=freeL[i];
    if(F.type!==other||F===L||F.dead)continue;
    // 同 findTComboTarget：字母到字母、指针到字母，取更近的（指针落点更能表达「我就想拼这两个」）。
    // 两个都是盒距，不用固定半径（见 MERGE_PAD 处的说明）。
    var gap=Math.min(twoLetterGap(L,F),
                     ptToGlyphGap(pointer.x,pointer.y,F.wx,F.wy,lw(F),lh(F)));
    if(gap<bg){bg=gap;best={free:F};}
  }
  return bg<=MERGE_PAD?best:null;
}
function applyKXCombo(L,c){
  if(!c||!c.free)return;
  var F=c.free;
  /* kx 合成的弹簧初始方向恒水平（不取两字母连线，否则斜着/上下拖出 k 和 x 会合成斜弹簧/竖弹簧）。
   * 中点取两字母中点（弹簧出现在松手处），长度仍按两字母间距（makeSpring 的 110~340 钳制）。
   * 高中模式的方向吸附因此天然一致，dirLock 记的就是水平轴。 */
  var cx=(L.wx+F.wx)/2, cy=(L.wy+F.wy)/2;
  var d=Math.hypot(F.wx-L.wx,F.wy-L.wy);
  var half=clamp(d,110,340)/2;
  killLetter(F);killLetter(L);
  var S=makeSpring(cx-half,cy,cx+half,cy);
  ringGo(S.x,S.y);
}

/* 终局 BOSS 动画（原 index.html 第 17787–18892 行） */
var lastT=0;
var lastDt=1/60;   // the frame's integration step, reused by the swept rod contact in collideBodies
/* =========================================================================================
 * ★★R132 —— BOSS 召唤（用户 2026-09-30 规格，逐条落地）
 * -----------------------------------------------------------------------------------------
 * 用户原文（逐句对码）：
 *   「当场上存在一个 mv²/2 时（或者多个，多个就先融合为一个），这时用户把 v 给召唤出来，
 *    然后在参数面板里面关于 v 的大小参数框里输入字母 c 时，上面的数值变成光速，然后把 v
 *    放到这个 Ek 公式上赋予，此时第一次放 Ek 表示排斥，把 v 给排斥飞出去（这里的动画要
 *    丝滑流畅自然），第二次也是，但第三次成功融合，此时这个 mv²/2 慢慢飘起来，并且不断有
 *    能量粒子汇聚过来，升到空中后，爆发一股能量，然后旁边字符不断出现，汇聚补充这个公式，
 *    最终形式：（泰勒展开，共 20 项）…（注意渲染为 latex 格式，式子延伸到窗口右边界后换行
 *    从左边界再出来，以此类推，根据窗口边界大小自动调节展开的项的数量，大概搞个三行就可以了）
 *    召唤完后，这个式子就像一个漂浮在空中的飞行平台一样，不断左右晃动，上下晃动，但是每行
 *    上下晃动的相位不等（相位随机），但是上行即使晃动到最低点也比下行晃动到最高点要高一点
 *    但是左右的话三行的相位都是一样的，上行往右边界消失多少，下行左边界就要出现多少
 *    整个 boss 出现后持续 3 秒后整个屏幕闪黑两次后整个黑屏几秒，然后屏幕再出现，回到网页
 *    初始加载的状态（相当于是一个 boss 的预告，下次再做打怪环节）」
 *
 * ---- 数学（★不是硬编码 20 项，按 n 现算，项数由窗口宽度定）--------------------------
 *   相对论动能  E_k = mc²(γ−1),  γ = (1−β²)^(−1/2) = Σ_{n≥0} C(2n,n)/4^n · β^{2n}
 *   ⇒ E_k = Σ_{n≥1} C(2n,n)/4^n · m v^{2n} / c^{2n−2}
 *     n=1: 2/4=1/2      ⇒ mv²/2
 *     n=2: 6/16=3/8     ⇒ 3mv⁴/(8c²)
 *     n=3: 20/64=5/16   ⇒ 5mv⁶/(16c⁴)
 *     n=4: 70/256=35/128⇒ 35mv⁸/(128c⁶)
 *   ⇒ `bossTermTex(n)` 现算二项式系数并**约分**，`\frac{分子}{分母}` 交给既有 `mthHTML`
 *     （手写 LaTeX 子集：\frac / ^{} / {} / \mu / \cdot）渲染 —— 全页仍是单文件、零 CDN。
 *
 * ---- 为什么用「同一个 off 循环 + 两遍内容」实现左右无缝 ---------------------------------
 *   用户要「三行左右相位一样」且「上行往右边界消失多少，下行左边界就要出现多少」。
 *   唯一同时满足两条的做法 = **三行共用同一个滚动量 off**，且每行内容**重复两遍**、
 *   off 以**统一行宽 WROW**（= 切行用的窗口宽）循环 ⇒ off=WROW 时与 off=0 逐像素相同。
 *   行与行宽度差靠 grp 的固定宽度 WROW 补齐（不是各滚各的）。
 *
 * ---- 为什么上下晃动不会压到下一行 -------------------------------------------------------
 *   行距 BOSS_LH=58 > 2×振幅 BOSS_AMP=11×2=22 ⇒ 上行最低点仍比下行最高点高 36px ✔
 *   轨迹取 sin() ⇒ 自然上下晃动；每行相位 `ph=Math.random()*2π` 独立随机 ✔
 *
 * ---- 接入点（只有 7 处，全部最小侵入）--------------------------------------------------
 *   ① frame() 的 TIME_SCALE>0 块末尾   ⇒ stepBoss(dt)
 *   ② 画布 pointerup 的 letter 分支    ⇒ 光速 v 落在 ½mv² 上 ⇒ bossPlace
 *   ③ attach() 开头                    ⇒ 同上的兜底分流（别的路径把 v 送进来时）
 *   ④ renderParamPanel 的 vsize 行     ⇒ 数字框 keydown 输入字母 c ⇒ 光速态
 *   ⑤ renderParamPanel 渲染末尾        ⇒ 光速态回显（重渲染后不丢）
 *   ⑥ gdDown 的 dock 分支              ⇒ 把面板 v 的光速态传给拖出的克隆
 *   ⑦ clearAll() 末尾                  ⇒ bossAbort() 复位
 * ========================================================================================= */
var C_LIGHT=299792458;      // 光速 m/s（用户：「上面的数值变成光速」）
var BOSS=null;              // boss 状态机（null = 没有 boss 进行中）
var BOSS_WANT_LINES=3;      // （已停用，保留给旧判据检索）见 BOSS_ROWS
/* ★★R132-9c（用户 2026-10-01：「那个公式完整不就是这样的吗？」并贴了整条式子的 LaTeX，
 *   含 20 项）：**行数不再是固定 2**，而是按**纵向可用高度自适应**、上限 BOSS_ROWS_MAX=4。
 *  · 为什么必须自适应：条带周期 P 必须**恰等于 行数 × 视口宽**（推导见下），
 *    行数写死 2 时周期只有 2W ⇒ 1400 宽上只排得下 9 项，而用户要的是 20 项。
 *  · 纵向可用高度 = 从「Ek 墨迹底 + 余量」到「视口底 − 余量」，再按行距折算行数
 *    （判据与 `bossBuildPlat` 里那段求 baseY 的可行带完全同一把尺）。
 *  · 实测 1400×900 ⇒ 4 行、P=5600px，恰好排完用户贴的 20 项。
 *  ★用户上一轮说的「下面一行，再加上半行左右就够了」不再作为硬性行数 —— 那一轮他看到的
 *    是「三行内容完全一样的重复」，现在的行是**同一条式子的连续段落**，语义不同。 */
var BOSS_ROWS_MAX=4;        // 平台最多几行（1470 行 × W 的条带周期上限）
var BOSS_ROWS=2;            // （已停用，保留给旧判据检索）见 BOSS_ROWS_MAX
/* ★★R132-9（用户：「这个屏幕左右两边边界的传送好像不太对…我要的是**右边出去就立马从
 *  下面的左面边界出来**」）：**条带周期 = 行数 × 视口宽**。
 *  为什么必须是 W 的整数倍（可复推）：
 *    · 屏幕上是 R 行、每行一屏宽 ⇒ 可见相位窗口长 R·W；
 *    · 行 k 的相位偏移取 `k·W`（上下对齐，屏幕 x 相同就是同一列）⇒
 *      行 k 显示相位 [off+kW, off+(k+1)W)；
 *    · 要「行 k 右缘 → 行 k+1 左缘」**无缝接续**，只需偏移取 k·W —— 这条恒成立；
 *    · 要「最后一行右缘 → 第 0 行左缘」也不跳字，必须有 R·W ≡ 0 (mod P)，
 *      而 P 又是可见窗口长（否则同一相位会出现两次）⇒ **P = R·W 是唯一解**。
 *  ⇒ P=2W（两行模型）是 R=2 时的特例；本轮 R 自适应到 4 ⇒ P=4W。 */
var BOSS_CYCLE=2;           // （已停用）旧口径：条带周期 = BOSS_CYCLE × 视口宽
var BOSS_INK_CAP=1.75;      // 条带里项的总墨迹宽上限（× 视口宽）⇒ 决定项数（"项太多"的解）
var BOSS_ANCHOR=0;          // ★「以 mv²/2 为基准」：第 0 项（=½mv²）的条带偏移
/* ★★R132-9：逐字符汇聚的**总时长**（s），不再用「每字符固定间隔」。
 *  为什么必须改成按总时长：字符数随窗口宽度变（双行 × 双拷贝 ⇒ 实测 880 个），
 *  固定 0.006 s/字 ⇒ 5.3 s 的 build（旧版单行 311 字只要 1.9 s）。
 *  ★同时把每帧增量压住：nch/(60·BOSS_BUILD_SEC) 必须 ≤8（旧判据 A26 的上限）。
 *  实测 nch=880、2.2 s ⇒ 6.67 字/帧 ✔ */
var BOSS_BUILD_SEC=2.2;
var BOSS_CHAR_DT=0.006;     // （保留：旧判据检索用；实际用 BOSS_BUILD_SEC/nch 现算）
/* ★★R132-3：行距必须 > 2×BOSS_AMP + **项高**。
 *  实测（`_tmp_r282_measure.py`，48px 下）：每一项的 element 高 = **97.81px**（常数，
 *  与 n 无关 —— 由 \frac 的两行 + 分数线决定）⇒ 下限 = 2×11 + 97.81 = 119.81 ⇒ 取 122。
 *  19px 时代只有 41.4px 高，58 够用；字号改成 48 之后 58 会**行行相压**。 */
/* ★★R132-9f（用户：「这个表达式在上下晃动时，上下行可以有稍微的重叠，也就是整体可以
 *  稍微收紧和上移一些，现在还是离地面太近了」）：行距 122 → **104**。
 *  ⇒ 项盒(100)之间只留 4px，叠上 ±11 的竖向晃动后**最坏重叠 18px**（用户明确允许
 *    「稍微重叠」）。判据 A14 也从「间隙 > 2×振幅」改成「行序严格 + 最坏重叠 ≤20px」。 */
/* ★★R132-9g（用户：「这个行距还是太大，还可以进一步缩紧，还有每行上下浮动幅度可以更大，
 *  每行随机相位，不必相同」）：行距 104 → **98**、振幅 11 → **15**。
 *  ⇒ 项盒(100)重叠 2px，叠上 ±15 晃动后最坏重叠 32px（用户明确要求「可以稍微重叠」）。
 *  ★分层：大项缩字号后墨迹多在 74px 上下，真正的重叠观感远小于盒重叠。 */
var BOSS_LH=98;             // 行距 px（用户要求进一步收紧）
var BOSS_ROW_H=100;         // .bossline 的行高（须 ≥ 项高 97.81，否则 overflow:hidden 裁字）
var BOSS_REPS=2;            // 条带在轨内的拷贝份数（周期 2W、轨左移 P ⇒ 2 份刚好覆盖 [−P,P)）
var BOSS_AMP=15;            // ★R132-9g 上下晃动振幅 px（11 → 15，用户要求「幅度更大」）
var BOSS_AMPX=26;           // ★R132-9e 左右晃动振幅 px（用户：「左右…幅度更大、频率更低」）
var BOSS_PAD_X=60;         // ★R132-9f 行盒两侧外扩量（必须 > BOSS_AMPX，否则晃动会露出边缘）
/* ★★R132-9t（用户 2026-10-02 晚：「这个 boss 左右的振幅还是太小，你告诉我现在他的随机振幅
 *   范围是多少，然后**给我输入框**，我来输入我要的范围」）。
 *   回答（当前口径）：**左右 = ±`BOSS_AMPX` = ±26px**（整块共同的低频正弦，频率 0.41），
 *   **上下 = ±`BOSS_AMP` = ±15px**（逐行，频率 1.05）；`shake` 相位按 `shakeK` 从 1 衰减。
 *   下面把这两个值改成「默认值 + localStorage 覆盖」，并在设置里给两个输入框。
 *   ★`BOSS_PAD_X` 必须 > 左右振幅（否则晃动会让行盒露边，R132-9f 的原注释）⇒
 *   用户把幅度调大时**自动**跟着抬，避免调完露缝。 */
/* R132-9t 的「网页内输入框」方案已被用户否掉（「我的意思不是说你在网页里给我加一个输入框」）
   ⇒ 振幅/频率改到独立调参页 `boss_tune.html` 里调，调好再回填下面这几个常量。 */
/* ★★R132-9f（用户：「大型式子（数字多的分数项）可以稍微缩小字体，以确保每项整体大小
 *  都处于和 1/2 mv² 这个项大小基本差不多的情况」）：
 *  项宽 w > BOSS_WT 的按 48·BOSS_WT/w 缩字号（只缩不放），下限 BOSS_FSMIN。
 *  实测：系数位数随 n 增长（n=20 的分子分母 22 位）⇒ 不缩的话最宽项可达 500px+，
 *  与基准项 ½mv²(≈124px) 相差四倍，视觉上「一大一小」很乱。 */
var BOSS_FS=48;             // 平台正文字号（必须与 CSS .bossterm 一致）
var BOSS_WT=185;            // 每一项的目标墨迹宽（超出即按比例缩）
/* ★R132-9f 标定：基准项 ½mv² ≈ 124px；项宽随系数位数单调增长
 *  （n=2:135 / n=6:216 / n=10:248 / n=20 会到 500+）。
 *  取 185 ⇒ 最宽的那些缩到 ≈185px（48→36px 左右），与基准项比 ≤1.5 倍，
 *  也就是用户要的「基本差不多大」；项变窄后又多挤进几项（自适应）。 */
var BOSS_FSMIN=30;          // 缩字号的下限
var BOSS_SEP=18;            // 项间距下限 px（等间隙铺满条带时不会低于它，只作保险丝）
var BOSS_SCROLL=44;         // 左右滚动速度 px/s（正 = 内容向右流，与"右边出去"一致）
var BOSS_RISE_MS=1.35;      // 「mv²/2 慢慢飘起来」的时长 s
/* ★★R132-9h（用户：「boss 所有字符显示完之后，再隔久一点，多显示 5 秒，然后屏幕才开始闪烁」）：
 *  平台停留 3.0 → **8.0 s**（= 原来 3 s + 追加 5 s）。A15 判据同步改成 8.000s。 */
var BOSS_HOLD=8.0;          // 平台出现后持续 s
var BOSS_DARK=2.6;          // 黑屏时长 s —— 用户：「整个黑屏几秒」
var BOSS_DROP_PAD=80;       // 光速 v 松手时命中 ½mv² 的容差 px（比 MERGE_PAD 宽，好放）
/* ★★R132-3：用户「那些字符要**逐个或几个快速汇聚**，而不是一个一个大的表达式完整的显示」
 *  ⇒ 汇聚粒度从「整项」改成「**单个字符**」。速率为 2.8 字/帧（≈168 字/s）
 *    —— 240 个字符约 1.4s 补完，符合「快速汇聚」。 */
var BOSS_CHAR_DT=0.006;     // 逐**字符**飞入的间隔 s（2.8 字/帧）
var BOSS_HALF={n:'½'};      // （占位：BOSS 判定读的是 hasHalf/vCount，常量放这里便于检索）
var BOSS_WAIT_GRACE=600;    // 「等用户放 v」的兜底窗口（产品秒）——见 bossLive() 的长注释
var BOSS_SHAKE=0.55;        // 「爆发一股能量」的余波时长 s
var BOSS_FADE_IN=0.46;      // 闪黑两次的时长 s（0.06/0.17/0.28/0.38/0.46 五个台阶）
function bossGcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b>0){var t=a%b;a=b;b=t;}return a||1;}
function bossGcdB(a,b){if(a<0n)a=-a;if(b<0n)b=-b;while(b>0n){var t=a%b;a=b;b=t;}return a||1n;}
/* ★★R132：**必须用 BigInt**。第 n 项的系数是 C(2n,n)/4ⁿ，而 `bossBinom(2n,n)` 在 n≥27 时
 *  就超过双精度精确整数上限 2^53（C(54,27)=1.9e15；C(60,30)=1.18e17）⇒ 递推
 *  `r=r*(n-k+i)/i` 的中间结果一旦失真，**系数就全错**，而项数是由窗口宽度决定的
 *  （宽窗口能收进 10+ 项/行 × 3 行）⇒ 这不是理论边角，是常规路径。
 *  BigInt 在 Chromium/现代浏览器上原生可用；万一不可用则退回 Number（此时会失真的
 *  只有 n≥27 的项，但至少画得出来 —— 宁可系数不准也不能整块不显示）。 */
function bossBinom(n,k){
  k=Math.min(k,n-k);
  if(typeof BigInt!=='function'){
    var rn=1;
    for(var j=1;j<=k;j++)rn=rn*(n-k+j)/j;
    return Math.round(rn);
  }
  var r=1n,N=BigInt(n),K=BigInt(k);
  for(var i=1n;i<=K;i++)r=r*(N-K+i)/i;
  return r;
}
/* 第 n 项（n≥1）：`\frac{系数分子}{系数分母} m \frac{v^{2n}}{c^{2n-2}}`
 *  ★★R132-9c（用户 2026-10-01 贴了整条式子的 LaTeX 原文）：
 *     E_k=\frac12 mv^2+\frac38 m\frac{v^4}{c^2}+\frac5{16}m\frac{v^6}{c^4}+\cdots
 *  ⇒ 每一项是**两段分式相乘**（系数分式 × v/c 分式），**不是**把 `m·v^{2n}` 整个塞进分子的
 *    大分式。原来的 `\frac{num·m·v^{2n}}{den·c^{2n-2}}` 与用户给的写法**不是同一个东西**
 *     （分子分母的内容完全不同），必须按用户贴的形态重写。
 *  ⇒ 另外 `\frac12 mv^2` **不能再内联成 `½mv²`**：用户明确「我这里的 mv²/2 是简写，你要渲染成
 *     latex 格式啊，就像手写的那样」—— 分子 1、分母 2 要**上下分开**。
 *     （R132-3 当初内联是为了与飞行中的 Ek 逐像素同貌；R132-9c 起 Ek 本体被表达式**吸收**，
 *      平台上不再有"与飞行体对齐"的需求，所以按用户要的手写形态渲染。） */
function bossTermTex(n){
  var num=bossBinom(2*n,n),den=Math.pow(4,n);
  if(typeof BigInt==='function'){
    var nb=BigInt(num);
    var db=1n;for(var q=0;q<2*n;q++)db*=2n;      // 4^n = 2^(2n)
    var g=bossGcdB(nb,db);
    nb/=g;db/=g;
    num=nb.toString();den=db.toString();
  }else{
    var g2=bossGcd(num,den);num/=g2;den/=g2;
    num=''+num;den=''+den;
  }
  if(n===1)return '\\frac{1}{2}mv^{2}';          // c^0 不存在 ⇒ 分母整段不写
  var cp=2*n-2;
  return '\\frac{'+num+'}{'+den+'}m\\frac{v^{'+2*n+'}}{c^{'+cp+'}}';
}
/* 「一个 mv²/2」= 含 ½ + 至少两个 v + 质量字母的普通公式体（不是 W/T/S、不是黑洞/轨道） */
function bossIsEk(B){
  if(!B||B.dead||B.kind)return false;
  if(B.bh||B.go||B.goB||B._bossFrozen)return false;
  if(!B.hasHalf||!B.massG)return false;
  if((B.vCount||0)<2)return false;
  if(B.hasG||B.hasA||B.hasR||B.hasC||B.hasGrav||B.hasMu)return false;
  return true;
}
/* 松手点附近有没有 ½mv²（容差 BOSS_DROP_PAD） */
function bossFindEkNear(x,y){
  var pick=null,bd=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!bossIsEk(B))continue;
    /* ★★R132（`_tmp_r280_probe.py` 实测）：命中判据要**同时**看质心距离与墨迹包围盒。
     *  只按质心判：½mv² 被排斥后一旦漂出 80px，用户"拖回原处"照样落空；
     *  只按包围盒判：旁边一个不相干的公式会被优先抢走。
     *  ⇒ 取两者中较近的那个作为有效距离（包围盒 = 矩形外扩 BOSS_DROP_PAD），
     *    再与容差比 —— 「拖到公式上」和「拖到它附近」都成立。 */
    var d;
    if(B.hw!=null&&B.hh!=null){
      var dx=Math.max(0,Math.abs(x-B.x)-B.hw);
      var dy=Math.max(0,Math.abs(y-B.y)-B.hh);
      d=Math.min(Math.hypot(B.x-x,B.y-y),Math.hypot(dx,dy));
    }else{
      d=Math.hypot(B.x-x,B.y-y);
    }
    if(d<bd){bd=d;pick=B;}
  }
  return (pick&&bd<=BOSS_DROP_PAD)?pick:null;
}
/* 把一个多余的 ½mv² 溶解掉（用户：「或者多个，多个就先融合为一个」） */
function bossDissolveEk(O){
  burstParticles(O.x,O.y,26,1.2);
  ringGo(O.x,O.y);
  /* ★★R132-9c（实测抓到的真缺陷）：**必须按 `d.body===O` 扫全表，不能只扫 `O.glyphs`**。
   *  为什么：组装期 `refresh()` / `ensureSt()` 会把一部分字形**移出 `B.glyphs`**
   *  （它们仍留在 DOM 里，只是 `display:none`），而 `d.body` 依旧指着 O。
   *  ⇒ 只遍历 `O.glyphs` 会**漏掉它们**：实测 `glyphs` 只剩 5 个（`m v ² 2 -`），
   *    却有 **9 个** `.char` 的 `body` 指着 O ⇒ 收完还剩一整套，屏幕正中残留一个
   *    `\frac{mv²}{2}`（用户截图里那个"凭空多出来的 mv²/2"就是它）。
   *  ★判据 `d.body===O` 而不是 `O.glyphs.indexOf(d)>=0` —— 前者才是"这个字形属于这个体"。 */
  var list=[];
  for(var k=0;k<ALL.length;k++){
    var a=ALL[k];
    if(a&&!a.dead&&a.body===O&&list.indexOf(a)<0)list.push(a);
  }
  for(var j=0;j<O.glyphs.length;j++)if(list.indexOf(O.glyphs[j])<0)list.push(O.glyphs[j]);
  for(var i=0;i<list.length;i++){
    var g=list[i];
    if(!g||g.dead)continue;
    var sx=O.x,sy=O.y;
    try{var s=slot(O,g);sx=s.x;sy=s.y;}catch(e){}
    burstParticles(sx,sy,3,0.45);
    g.body=null;g.inBody=false;
    killLetter(g);
  }
  O.glyphs=[];O.mem=[];
  killBody(O);
}
/* ---- 闪黑 / 黑屏遮罩 ------------------------------------------------------------------- */
function bossMaskEl(){
  var m=document.getElementById('bossfade');
  if(m)return m;
  m=document.createElement('div');
  m.id='bossfade';
  DD.body.appendChild(m);
  return m;
}
function bossSetMask(a){
  var m=bossMaskEl();
  m.style.opacity=(''+a);
}
/* ---- ① 面板：v 的大小参数框输入字母 c ⇒ 光速 ------------------------------------------ */
function bossLightOn(nu,val){
  var L=paramLetter;
  if(!L)return false;
  L.vLight=true;L.vGive=C_LIGHT*PX_PER_M;
  if(paramBody){paramBody.vLight=true;paramBody.vGive=C_LIGHT*PX_PER_M;}
  /* ★★R132：**面板本体的 v 也要置成光速态**。
   *  用户规格「第二次也是，但第三次成功融合」⇒ 同一个动作要重复三次。若光速态只挂在
   *  「这一次被右键的那个 v」身上，第二次从面板拖出来的就是一个**普通 v**（3 m/s），
   *  落下去只会把它当普通"赋予速度"融进公式 —— 用户得每次重新右键+输入 c。
   *  挂到 vO（面板单例）上后：往后拖出的每个克隆都自动是光速 v（gdDown 的接入点⑥负责传递），
   *  三次操作的手感完全一致。`bossLightReset` 负责在 boss 收尾时把它复原。 */
  /* ★★R132-9n（用户 2026-10-02：「怎么我把**一个 v** 的速度调成 c 后，其他所有的从面板里面
   *  新拖出来的 v 也都变成 c 了」）：上面那条「挂到面板单例」**不分来源**地执行 ——
   *  连「改的是世界里那个 v」也被算进去，于是单例被污染、之后每个克隆都是光速 v。
   *  ⇒ 与 `vsize/vang/qcharge` 那几行同口径：**只有「面板里那个 v」被改时才回写单例**
   *    （`vO.state==='dock'`），改世界里的 v 只影响它自己（这正是用户这次的要求）。
   *  ★R132 的 boss 三次连放不受影响：那条流程本来就是**在面板的 v 上**输入 c。 */
  if(typeof vO!=='undefined'&&vO&&L.state==='dock'){vO.vLight=true;vO.vGive=C_LIGHT*PX_PER_M;}
  if(nu){nu.value='';nu.placeholder='c';}
  if(val)val.textContent='c ≈ '+C_LIGHT+' m/s';
  /* 滑块顶到最右（max 临时放宽到光速），让「数值变成光速」在两种控件上都看得见 */
  if(paramRows){
    for(var i=0;i<paramRows.length;i++){
      var R=paramRows[i];
      if(R&&R.spec&&R.spec.key==='vsize'){R.sl.max=C_LIGHT;R.sl.value=C_LIGHT;}
    }
  }
  /* ★R132-9g（用户：「把那个赋予 v 的参数 c 后，下面提示说把 v 放到什么什么上的那个提示窗
   *  给删了，我之前也没说要加说明啊」）⇒ 光速态**不弹任何文字**。
   *  ★并记一条纪律：**没被要求的说明性文案一律不加**（本轮已清 4 条，见当日日志审计表）。 */
  return true;
}
/* ★★R132：把「光速态」整个复原（boss 收尾/清屏/手动取消都要调）。
 *  ★必须与 `if(!BOSS)return;` **解耦** —— `bossFinish()` 是先把 BOSS 置 null 再调 clearAll()，
 *  而 clearAll() 末尾才调 bossAbort()；若复位写在 bossAbort 的早退之后，那条路上永远跑不到
 *  ⇒ 清屏后 v 的框里还写着「c = 299792458 m/s」、而它其实只是个普通 v。 */
function bossLightReset(skipRender){
  var any=false;
  if(paramLetter&&paramLetter.vLight){paramLetter.vLight=false;paramLetter.vGive=null;any=true;}
  if(paramBody&&paramBody.vLight){paramBody.vLight=false;paramBody.vGive=null;any=true;}
  if(typeof vO!=='undefined'&&vO&&vO.vLight){vO.vLight=false;vO.vGive=null;any=true;}
  /* ★R132-9d：`skipRender=true` 供 applyParam 用 —— 用户正在输入框里改数值，
   *  这里若重渲染面板会把输入框重建、焦点与刚敲的字符一起丢。 */
  if(any&&!skipRender&&typeof renderParamPanel==='function'&&paramBody)renderParamPanel();
}
/* 当前参数面板是否处于「v = 光速」态（vsize 行渲染用） */
function bossLightState(){
  if(paramBody&&paramBody.vLight)return true;
  if(paramLetter&&paramLetter.vLight)return true;
  if(typeof vO!=='undefined'&&vO&&vO.vLight)return true;
  return false;
}
/* ---- ② 放置：前两次排斥、第三次融合 ---------------------------------------------------- */
function bossRepel(Ek,d){
  var vx=(d.wx!=null)?d.wx:((d.el?d.el.offsetLeft+14:Ek.x));
  var vy=(d.wy!=null)?d.wy:((d.el?d.el.offsetTop+14:Ek.y));
  var ux=vx-Ek.x,uy=vy-Ek.y,L=Math.hypot(ux,uy);
  if(!(L>1)){ux=0;uy=-1;L=1;}
  ux/=L;uy/=L;
  var n=BOSS.n;                       // 1 / 2
  var sp=1500+900*n;                  // 第二次弹得更快（「排斥」逐次加强）
  d.state='free';d.cat=1;d.pop=1;d.massless=false;
  d.wx=vx;d.wy=vy;
  d.vx=ux*sp;d.vy=uy*sp-380;          // 略微上抛 ⇒ 弧线更自然（用户：「动画要丝滑流畅自然」）
  if(freeL.indexOf(d)<0)freeL.push(d);
  placeLetter(d);
  burstParticles(vx,vy,16,0.7);
  burstParticles(Ek.x,Ek.y,20,1.0);
  ringGo(Ek.x,Ek.y);
  /* ★★R132-9u（用户 2026-10-02 晚：「那个调成光速的 v 放到 mv²/2 上不是也会被弹开两次吗，
   *   **前两次弹开时也要冒出 error**」）—— 这条**取代** R132-9e 的「排斥时不弹任何文字」：
   *   第一次/第二次放光速 v 被弹开时，在**落点**冒一行红字 error。
   *   ★文案**只有 `Error` 三个字母**（沿用 R132-9b 对 `vLightReject` 的口径：
   *   不加前缀竖条、不加原因、不加任何补充说明，也不要自作主张加文案）。 */
  errTip(vx,vy,'Error');
  /* ★★R132（`_tmp_r280_probe.py` 实测）：**绝不能给 Ek 加位移反冲**。
   *  第一版这里是 `Ek.vx-=ux*120;Ek.vy-=uy*120;`（牛顿第三定律的"反作用"），
   *  实测第 1 次排斥后 Ek 从 y=425 飘到 503，**第 2/3 次照样拖到原坐标就全部落空**
   *  （`bossFindEkNear` 容差 80px）—— 三次融合永远做不完，整条 boss 出不来了。
   *  用户规格原文是「把 **v** 给排斥飞出去」——飞的是 v，不是公式。
   *  ⇒ 反冲改用**纯视觉**表现（Ek 原地回弹一下 + 粒子/光环），位置一动不动。
   *  这样「拖到同一个地方放三次」这条最自然的手势才成立。 */
  Ek.pop=Math.max(Ek.pop||0,0.6);     // 渲染层 popScale ⇒ 看得见"被撞了一下"再弹回
  shake(4,0.22);
  /* ★R132-9e（用户：「调成光速的 v 放到 mv²/2 上排斥的同时下面还有提示？把这个提示删了，
   *  我没要你加的你就别老加」）⇒ 排斥时**不弹任何文字**，只留视觉（粒子 + 光环 + 抖屏）。 */
}
function bossStartRise(Ek,d){
  BOSS.ph='rise';BOSS.t=0;BOSS.ek=Ek;BOSS._frozenEk=Ek;
  /* ★R132-9e：召唤开始 ⇒ 压淡符号面板（CSS `body.bossing .panel`） */
  if(DD&&DD.body)DD.body.classList.add('bossing');
  bossBump();                       // ★R132：融合成功 ⇒ 操作窗口重新计时（见 bossLive）
  /* ★★R132-2（`_tmp_r280_stray.py` 实测）：把**前两次被排斥出去的那些 v 收回来**。
   *  现象：第 1/2 次放置各自把那个 v 弹飞（`d.vx/d.vy` 带 ~2400/3900 px/s），
   *  它们落地后**就永久留在画面上**了 —— 第 3 次融合成功、平台升起来之后，
   *  截图里还能看到画面上方飘着一个孤立的 `v`（实测：platform+1.0s 时
   *  `freeL = [v(y=209), v(y=350)]`，两个都是前两次弹飞的）。
   *  这跟用户规格「此时这个 mv²/2 慢慢飘起来，并且不断有能量粒子汇聚过来，
   *  升到空中后，爆发一股能量」的画面完全不符 —— 融合的那一刻，散的应该**只有这个公式**。
   *  ⇒ 融合时把场上所有**还不是 Ek 成员**的游离 v 收进爆发（粒子 + 销毁），
   *    正好也是「能量汇聚」的语义：散出去的 v 被 Ek 吸收了。
   *  ★只收 `ch==='v'` 且 `state==='free'` 且不在任何 body 里的 —— 不误伤用户
   *    自己摆在别处的其它字母、也不动面板 dock 里的那些。 */
  var absorbed=0;
  for(var i=freeL.length-1;i>=0;i--){
    var f=freeL[i];
    if(!f||f.dead||f===d)continue;
    if(f.ch!=='v')continue;
    if(f.inBody)continue;
    if(f.body)continue;
    if(f.state&&f.state!=='free')continue;
    burstParticles(f.wx!=null?f.wx:(Ek.x),f.wy!=null?f.wy:(Ek.y),10,0.75);
    killLetter(f);
    absorbed++;
  }
  /* ★R132-9e：同理 —— 融合时也不弹文字提示。 */
  burstParticles(Ek.x,Ek.y,34,1.25);
  ringGo(Ek.x,Ek.y);
  if(d&&!d.dead){
    burstParticles(d.wx,d.wy,24,1.1);
    ringGo(d.wx,d.wy);
    killLetter(d);
  }
  shake(9,0.5);
  Ek._bossFrozen=true;
  Ek.vx=0;Ek.vy=0;
  removeMatterBody(Ek);              // 不再与任何东西碰撞；留在 bodies 里让 render/syncGlyphs 照旧画它（含分数线）
  /* ★★R132-3：用户「融合后**飞到屏幕中央**」。
   *  x0/y0 = 起飞点（用户摆放处）；x1 = 屏幕水平中央；
   *  y1 = 升空高度。rise 相位让 (x,y) 同时向 (x1,y1) 缓动。 */
  BOSS.x0=Ek.x;
  BOSS.y0=Ek.y;
  BOSS.x1=Math.round(W/2);
  /* ★R132-9f：升空目标从 0.22H 抬到 **0.16H**（H=900 ⇒ 144）——
   *  平台是锚在这个 y 上的（原位召唤），所以抬高 y1 就是**整块上移**。
   *  用户：「整体可以稍微收紧和上移一些，现在还是离地面太近了」。 */
  BOSS.y1=Math.max(110,Math.round(H*0.16));
}
function bossPlace(Ek,d){
  if(!BOSS){
    /* 「或者多个，多个就先融合为一个」：把其余 ½mv² 溶解掉 */
    var others=[];
    for(var i=0;i<bodies.length;i++){
      var O=bodies[i];
      if(O!==Ek&&bossIsEk(O))others.push(O);
    }
    for(var j=0;j<others.length;j++)bossDissolveEk(others[j]);
    BOSS={n:0,ek:Ek,ph:'repel',t:0,live:BOSS_WAIT_GRACE};
  }
  BOSS.n++;
  bossBump();                       // 还要接着放 ⇒ 窗口重新计时
  if(BOSS.n>=3){bossStartRise(BOSS.ek,d);return;}
  bossRepel(BOSS.ek,d);
}
/* ---- ③ 升空爆发 + 造平台 --------------------------------------------------------------- */
/* ★★R132-9p（**已按用户要求整体回退，2026-10-02 晚**：用户「那个黑洞动画回退回上一版，
 *   这样做的还是不好看」——「吸过来」观感不被接受。
 *   **下面两个函数已无调用点**（`bossBuildPlat` 恢复 R132-9d/e 的「四周随机、半径 55~150px」
 *   + 基准项出生即亮），保留仅作留档；要再做请先问用户要哪种观感。
 *   原实现说明：起始点的真源 = 右侧符号面板（此前是"四周随机"）。
 *   起始点的真源 = **右侧符号面板**（此前是"四周随机、半径 55~150px"，R132-9d/e）。
 *   面板的字符格就是 `#panel > .char`（`sortPanel` 按 `DOCK_ORDER` 把它们钉在固定格位上），
 *   字符 = `textContent`。面板里**没有**的（数字、`+`、`=`、`⋯` …）⇒ 取面板矩形内的随机点。
 *   返回 {map:{字符→面板坐标}, rect:{x,y,w,h}}；面板不可用时 map/rect 皆空（调用方原地退化）。 */
function bossPanelSrc(){
  var out={map:{},rect:null};
  var pan=(typeof DD!=='undefined'&&DD.getElementById)?DD.getElementById('panel'):null;
  if(!pan)return out;
  var pr=pan.getBoundingClientRect();
  if(!(pr.width>1&&pr.height>1))return out;
  out.rect={x:pr.left,y:pr.top,w:pr.width,h:pr.height};
  var cs=pan.querySelectorAll('.char');
  for(var i=0;i<cs.length;i++){
    var ch=(cs[i].textContent||'').replace(/\s/g,'');
    if(!ch||out.map[ch])continue;
    var r=cs[i].getBoundingClientRect();
    if(!(r.width>0.5&&r.height>0.5))continue;
    out.map[ch]={x:r.left+r.width/2,y:r.top+r.height/2};
  }
  return out;
}
/* 逐字符把「面板起点 − 槽位」写进 `--dx/--dy`（CSS 过渡负责飞入）。
 *   ★为什么必须在 `bossPlatLayout()` **之后**调用：行轨平移（`translate3d`）在那之前还没落位，
 *     量到的槽位会整体偏掉一整行 ⇒ 字符从错误的地方飞进来。
 *   ★为什么先归零再量：`.bcharg` 的 `left/top` 就是 `--dx/--dy`，带着旧值量到的圆心是**起点**
 *     而不是槽位。归零后强制一次重排（读一次 `offsetWidth`），再逐个量。
 *   ★行盒只做 `translate3d`（无 scale）⇒ 相对定位的 px 偏移与屏幕 px 1:1，不需要换算。 */
function bossCharSrcFromPanel(list){
  if(!list||!list.length)return [];
  var S=bossPanelSrc(),i,ce,r,sx,sy,ch,p,out=[];
  BOSS.srcRect=S.rect;                 /* build 时刻的面板矩形（给判据/调试对齐用） */
  /* ★★写起始值之前必须先把过渡关掉。
   *   `.bcharg` 的 left/top 带 **0.62s 过渡**，而**在写偏移之前 `bossPlatLayout()` 已经
   *   强制过一次布局**（浏览器已解析过样式、`left` 的当前值 = 0）⇒ 此时写 `--dx/--dy`
   *   会被当成「**从 0 过渡到面板位置**」：字符先从槽位**向外飘 0.62s**，等 `.on` 点亮时
   *   再被拉回来 —— 看起来就是「先散开再聚拢」，正好是用户不想要的。
   *   （`_diag_r360_bossfly.py` 自测抓到的：build 后第一帧量到的圆心 = 槽位本身。）
   *   正确写法：`transition:none` 写完 → 强制一次重排（让起始值成为过渡起点）→ 还原。 */
  for(i=0;i<list.length;i++)list[i].style.transition='none';
  for(i=0;i<list.length;i++){
    list[i].style.setProperty('--dx','0px');
    list[i].style.setProperty('--dy','0px');
  }
  if(list[0]&&list[0].offsetWidth===undefined)return [];   /* 强制一次重排（读属性即可） */
  for(i=0;i<list.length;i++){
    ce=list[i];
    r=ce.getBoundingClientRect();
    sx=r.left+r.width/2; sy=r.top+r.height/2;
    ch=(ce.textContent||'').replace(/\s/g,'');
    var hit=S.map[ch]?1:0;                     /* ★必须**先**判命中再做随机兜底（否则 hit 恒 1） */
    p=S.map[ch]?S.map[ch]:null;
    if(!p&&S.rect)p={x:S.rect.x+Math.random()*S.rect.w,
                     y:S.rect.y+Math.random()*S.rect.h};
    if(!p)p={x:sx,y:sy};
    out.push({ch:ch,dx:+(p.x-sx).toFixed(1),dy:+(p.y-sy).toFixed(1),hit:hit,
              sx:+p.x.toFixed(1),sy:+p.y.toFixed(1),slotX:+sx.toFixed(1),slotY:+sy.toFixed(1)});
    ce.style.setProperty('--dx',(p.x-sx).toFixed(1)+'px');
    ce.style.setProperty('--dy',(p.y-sy).toFixed(1)+'px');
  }
  /* 起始值已成为当前值 ⇒ 强制一次重排后再把过渡还回去，之后 `.on` 的位移才会平滑过渡 */
  if(list[0])list[0].offsetWidth;
  for(i=0;i<list.length;i++)list[i].style.transition='';
  return out;
}
function bossBuildPlat(){
  /* =======================================================================================
   * ★★R132-3 重写。用户三条要求 + 实测三处缺陷见本节标题注释。
   *   ① 量测：`.bossmeas` 必须与平台**同字号**（CSS 已声明 48px）——否则量到的是 19px
   *      的宽度 ⇒ 每行塞进过多项 ⇒ 上屏就溢出（旧版两边都 19 所以看不出来）。
   *   ② 切行：贪心，项数由窗口宽度**自适应**（用户：「根据窗口边界大小自动调节」）。
   *   ③ 铺满：**等间隙** g=(W−Σw)/(m−1) ⇒ 首项贴左、末项贴右、间隙均分、内容宽恒 == W。
   *   ④ 逐字符包裹：每字符一个 `.bcharg`，飞入以**字符**为单位。
   *   ⑤ 三副本：off 取模 W、三份首尾相接 ⇒ 「传送门」。
   * ======================================================================================= */
  var meas=document.getElementById('bossmeas');
  if(!meas){
    meas=document.createElement('div');
    meas.id='bossmeas';meas.className='bossmeas';
    DD.body.appendChild(meas);
  }
  meas.innerHTML='';
  /* ★★R132-4：**量"上屏后的真实盒子"**，不要靠 `tw+PW+BOSS_SEP` 拼凑。
   *  旧版记录 `w=tw`（项本体，不含 `+`），而平台上 ` + ` 是**包在项内部**的
   *  ⇒ 第 2 项起每一项都比记录宽 `PW+letter-spacing`（实测 48px 下 **31.29px**）
   *  ⇒ Σw 少算 (m−1)×31.29、`g` 虚高、**末项右缘溢出并压到下一副本首项**
   *  （用户：「都没有触及到右边界」+ 左侧堆叠）。
   *  现在：在离屏域里**照着平台的真实结构**建 `[ + ][项]` 量整盒宽 `aw`，
   *  直接把它当作该项在行内的占位宽 —— 切行与铺满**共用同一把尺**（`aw`）。 */
  var probeT=document.createElement('span');
  probeT.className='bossterm';
  var probeP=document.createElement('span');
  probeP.className='bossterm';
  probeP.innerHTML='<span class="mth"> + </span>';
  var probeA=document.createElement('span');
  probeA.className='bossterm';                       // [ + ][项] 合成盒
  meas.appendChild(probeT);meas.appendChild(probeP);meas.appendChild(probeA);
  var PW=probeP.getBoundingClientRect().width||22;
  /* ★★R132-4：**每一项都带自己的 ` + `，含行首项**。
   *  用户要的是「传送门」——式子无限向右循环。行首项若无 `+`，视觉上
   *  「…末项 …[跨副本的 W−末项盒右缘]… + 首项…」的接缝间隙就与行内均匀间隙不等
   *  （实测：行内视觉间隙 61px，接缝只有 13.66px ⇒ 一眼看出是「换行」不是「传送」）。
   *  每项都带 `+` ⇒ 行内与接缝的**视觉结构完全一致**，接缝自然隐形。
   *  ★代价：行首会先出现一个孤零零的 `+`（数学上读作「上一行接过来的加号」），
   *    这正是「无限长表达式从左往右滚」该有的样子。 */
  var head='<span class="mth"> + </span>';
  var EQ='E_{k}=';
  /* =========================================================================================
   * ★★R132-9d（用户 2026-10-01 第二轮）：
   *  「怎么这个 boss 的表达式怎么有那么多，我不是说了，只要搞三行就行，分别是 mv²/2 的那半行，
   *    然后下面一行，再下面半行，多余的表达式以省略号代替，所以这里要自主识别屏幕的宽度，
   *    自适应后面表达式的长度，还有就是要逐项显示，要按照顺序一个一个来，
   *    不能是先下面一行，再上面一行」
   *  ⇒ ①**有限**式子：`E_k = ½mv² + t2 + … + tn + ⋯`（末尾省略号收尾，不再无限循环）；
   *     ②行数 = 3（纵向装不下时往下退），墨迹总长 = **2 个视口宽**（半行 + 一行 + 半行）；
   *     ③首行从 x0 = W/2 − w(E_k=) − g − w₁/2 起 ⇒ **第 1 项（½mv²）的中心落在屏幕正中**，
   *       它左边只有 `E_k=`、再往左是**空白**；
   *     ④不再滚动 ⇒ 项不会再跨行搬家，「按顺序从上到下逐项出现」从结构上成立。
   *  ★旧版（R132-9/9c）是**无限循环条带**：尾段会绕回第一行左边 ⇒ 用户看到「E_k= 左边还有东西」
   *    与「先下面一行、再上面一行」；而且项数由 4 行铺满 ⇒ 20 项"太多"。两条都从结构上消除。
   * ========================================================================================= */
  var ROWSN=1, rrr;
  {
    var ekB0=(BOSS.y1!=null?BOSS.y1:H*0.22)+26;
    for(rrr=Math.min(3,BOSS_ROWS_MAX);rrr>=1;rrr--){
      var hL0=(rrr-1)/2*BOSS_LH;
      if(Math.round(H-30-BOSS_ROW_H-BOSS_AMP-hL0) > Math.round(ekB0+30+BOSS_AMP+hL0)){ROWSN=rrr;break;}
    }
  }
  /* 量 `E_k=` / 第 1 项 / 省略号 / 带 `+` 的项的盒宽（离屏量测域，与平台同字号） */
  probeT.innerHTML=mthHTML(EQ);
  var wEq=probeT.getBoundingClientRect().width;
  probeT.innerHTML=mthHTML('⋯');
  var wDots=probeT.getBoundingClientRect().width;
  probeA.innerHTML=head+mthHTML('⋯');
  var wDotsUse=probeA.getBoundingClientRect().width;
  var tex1=bossTermTex(1);
  probeT.innerHTML=mthHTML(tex1);
  var w1=probeT.getBoundingClientRect().width;

  var target=2*W;                       // 墨迹总长目标 = 2 个视口宽（半行 + 一行 + 半行）
  var terms=[];
  /* ★R132-9f：按目标宽给每一项定字号（只缩不放）——
   *  ① `E_k=` 与基准项 ½mv² **不缩**（它们就是基准）；
   *  ② 其余项 fs = clamp(48·BOSS_WT/项宽, BOSS_FSMIN, 48)，占位宽同步乘 fs/48。 */
  var fsFor=function(w){var f=BOSS_FS*BOSS_WT/Math.max(1,w);
    return f>BOSS_FS?BOSS_FS:(f<BOSS_FSMIN?BOSS_FSMIN:f);};
  terms.push({tex:EQ,w:wEq,wUse:wEq,pre:false,kind:'eq',fs:BOSS_FS});
  terms.push({tex:tex1,w:w1,wUse:w1,pre:false,kind:'ek',fs:BOSS_FS});
  var n=2,tw,aw,sumNow,z;
  for(;;){
    var tex=bossTermTex(n);
    probeT.innerHTML=mthHTML(tex);
    tw=probeT.getBoundingClientRect().width;
    probeA.innerHTML=head+mthHTML(tex);
    aw=probeA.getBoundingClientRect().width;
    sumNow=0;for(z=0;z<terms.length;z++)sumNow+=terms[z].wUse;
    /* 已放下的 + 这一项 + 末尾省略号 + 每一项的最小间隙 ⇒ 超目标就停（"自适应屏幕宽度"） */
    var fs2=fsFor(tw);                       // ★R132-9f 该项字号
    aw=aw*fs2/BOSS_FS; tw=tw*fs2/BOSS_FS;    // 占位宽/墨迹宽按字号等比换算
    if(sumNow+aw+wDotsUse+(terms.length+2)*BOSS_SEP>target)break;
    terms.push({tex:tex,w:tw,wUse:aw,pre:true,kind:'t',fs:fs2});
    n++;
    if(n>80)break;
  }
  /* 末尾省略号：`+ ⋯`（读作"还有很多项"）。它是最后一项、最后被点亮。 */
  terms.push({tex:'⋯',w:wDots,wUse:wDotsUse,pre:true,kind:'dots',fs:BOSS_FS});
  meas.innerHTML='';
  if(terms.length<3)return;
  var m=terms.length,q;
  var sumW=0;for(q=0;q<m;q++)sumW+=terms[q].wUse;
  var g=(target-sumW)/m;                     // 等间隙铺满目标长（A25 守的就是这条）
  if(g<BOSS_SEP)g=BOSS_SEP;
  var lefts=[],acc=0;
  for(q=0;q<m;q++){lefts.push(acc);acc+=terms[q].wUse+g;}
  var totW=acc;                              // 式子总墨迹长（≈ 2W）
  /* 首行起点：让**第 1 项（½mv²）的中心正好在屏幕水平中央** */
  var x0=W/2-lefts[1]-terms[1].w/2;

  /* ---- ② 平台 + R 行：每行铺**同一条条带**，相位差 k·W ----------------------
   *  「右缘出去从下面左缘出来」的机制（一行算式）：行 k 的平移量 = mod(off + k·W, P)。
   *  两行上下对齐 ⇒ 行 k 在屏幕 x 处显示的相位 = off + k·W + x
   *  ⇒ 行 0 的 x=W 与行 1 的 x=0 是**同一个相位** ⇒ 项跨过右缘时在下一行左缘继续出现。
   *  ★P=2W 时反向也成立（行 1 右缘相位 off+2W ≡ off = 行 0 左缘），不会跳字。 */
  var plat=document.createElement('div');
  plat.className='bossplat';
  DD.body.appendChild(plat);
  var baseY=0;
  {
    /* ★★R132-9e（用户：「那个表达式要在屏幕中上方，现在的太偏下了，这个 boss 是飞到空中的，
     *   现在都快接地了」＋「先飞到上面，然后你又突然把它放到下面进行那些式子的召唤？
     *   干嘛要突然移到下面，你就飞到上面后，无缝在原位进行召唤补全」）：
     *   平台**不再另算纵向位置**，而是**锚在 Ek 升空后的落点上** ——
     *   第 0 行的项心 == `BOSS.y1`（Ek 停住的那个 y）⇒ ½mv² 就在**原地**长出来，零跳变；
     *   其余各行依次向下排（整块都落在屏幕中上方）。
     *   ★旧版用「Ek 底 + 30」到「视口底 − 30」的可行带取偏上 35%，算出来 y≈490，
     *    第一行比 Ek 整整低 290px ⇒ 用户看到的就是「突然掉下去」。 */
    var halfL=(ROWSN-1)/2*BOSS_LH;
    var y1=(BOSS.y1!=null)?BOSS.y1:Math.max(150,Math.round(H*0.22));
    baseY=Math.round(y1+halfL-BOSS_ROW_H/2);
  }
  var rows=[],byTerm=[];
  for(q=0;q<m;q++)byTerm.push([]);
  for(var ri=0;ri<ROWSN;ri++){
    var rowEl=document.createElement('div');
    rowEl.className='bossline';
    rowEl.style.height=BOSS_ROW_H+'px';
    var track=document.createElement('div');
    track.className='bosstrack';
    /* ★★R132-9d：**把同一条完整式子放进每一行的轨**，行 ri 的轨平移 = x0 − ri·W
     *  ⇒ 第 ti 项在行 ri 显示于 x = (x0 + lefts[ti]) − ri·W。
     *    · 它"自己那一行" r = floor((x0+s)/W) 里，x 正好落进 [0,W) ⇒ 完整可见；
     *    · 跨行界的那一项在 r 行显示左半、在 r+1 行显示右半（**同一个绝对位置被两行切开**）
     *      ⇒ 视觉上就是"墨迹在行界处接住"，不会有半截凭空消失。
     *  ★行数 ROWSN=3、式子总长 ≈ 2W < 3W ⇒ **第 3 行之后没有内容绕回来**（不再是传送门）。
     *  ★轨不用 `left:-P` 那套了（那是无限条带为了覆盖负半轴的补位）；静态布局直接从 0 起走。 */
    var grp=document.createElement('span');
    grp.style.cssText='position:relative;display:block;flex:none;width:'+totW.toFixed(2)+'px;'
                     +'height:'+BOSS_ROW_H+'px';
    var items=[],col=[];
    for(var ti=0;ti<m;ti++){
      var tm=terms[ti];
      var sp=document.createElement('span');
      sp.className='bossterm';
      var _fs=(tm.fs!=null?tm.fs:BOSS_FS);
      sp.style.cssText='position:absolute;left:'+lefts[ti].toFixed(2)+'px;top:50%;'
                      +'font-size:'+_fs+'px;'
                      +'transform:translateY(-50%)';
      if(tm.pre)sp.insertAdjacentHTML('beforeend',head);   // `E_k=` 与第 1 项都不带 `+`
      sp.insertAdjacentHTML('beforeend',mthHTML(tm.tex));
      grp.appendChild(sp);
      /* ★★R132-9f：字号不一的项都按「盒中心」对齐 ⇒ 分数线会高低不齐
       *  （正是用户最反感的那句「数字高低不平」）。
       *  ⇒ 改成按**第一根分数线**对齐：量出它相对盒心的偏移，反向补掉，
       *    所有项的共同基准线 = 行中线 ⇒ 极差回到 0（A32 守的就是这条）。 */
      (function(spx){
        var bEl=spx.querySelector('.fracbar');
        if(!bEl)return;
        var rb=bEl.getBoundingClientRect(),rs=spx.getBoundingClientRect();
        var off=((rb.top+rb.bottom)/2)-((rs.top+rs.bottom)/2);
        if(isFinite(off)&&Math.abs(off)>0.05)
          spx.style.top='calc(50% - '+off.toFixed(2)+'px)';
      })(sp);
      col.push(sp);
      items.push({el:sp,w:tm.w,wUse:tm.wUse});
    }
    track.appendChild(grp);
    rowEl.appendChild(track);
    plat.appendChild(rowEl);
    /* 逐字符包裹：**每一行都要包**（每一行都可能显示这些项；静态布局下每项只在
     * 「自己那一行」与「−1 那一行」出现，但逐行统一处理最省心）。 */
    for(var tt=0;tt<m;tt++){
      var spx=col[tt];
      var kids=[],chs=[];
      for(var ci=0;ci<spx.childNodes.length;ci++)chs.push(spx.childNodes[ci]);
      for(var cj=0;cj<chs.length;cj++)wrapTextNodes(chs[cj],kids);
      byTerm[tt].push(kids);
      if(ri===0)items[tt].chars=kids;
    }
    rows.push({el:rowEl,track:track,items:items,reps:[grp],lefts:lefts,gap:g,
               itemsW:sumW,
               /* ★R132-9g（用户：「每行随机相位，不必相同」）：
                *  相位 = **按行等分 + 随机扰动**，而不是纯随机 —— 纯随机偶尔会抽出两个
                *  很接近的相位，看起来就像「整块一起动」。等分保证三行相位至少差 2π/3。 */
               ph:(ri*2.0944+Math.random()*1.2),row:ri});
  }

  /* ---- ③ 揭示顺序：**以第 1 项（½mv²）为基准，按式子读序向外补全** -------------------
   *  ★★R132-9c（用户：「以最开始召唤的那个 mv²/2 为中心进行补全啊两边分别」）：
   *  式子读作 `E_k = ½mv² + 3/8 m v⁴/c² + …` ⇒「两边」= 左边是 `E_k=`、右边是后面各项。
   *  所以顺序 = **第 1 项（基准）→ `E_k=` → t2 → t3 → … → 条带末尾**。
   *  条带末尾那几项在屏幕上是"基准的左边"（传送门绕回来的那一段），所以它们**最后**出现——
   *  视觉上正是「以 ½mv² 为基准、向左右两边长开」。
   *  ★基准项**出生即亮**（见下面的 `classList.add('on')`）：Ek 刚被吸收、它就长在同一处，
   *    不能等 build 相位再来淡入，否则 shake 那 0.55s 会在正中留一块空白。
   *  ★`order` 里每一项**只出现一次**：写成 `for(d=0;d<m;d++)` 会把每项推两次
   *    （`BOSS.chars` 长度翻倍）—— 那是 `_diag_r280` 的 `chars == bossTotalChars` 抓出来的。 */
  var order=[1,0];
  for(var oi=2;oi<m;oi++)order.push(oi);
  var allChars=[];
  for(var o2=0;o2<order.length;o2++){
    var grpC=byTerm[order[o2]];
    for(var gi=0;gi<grpC.length;gi++)
      for(var ci2=0;ci2<grpC[gi].length;ci2++){
        var _ce=grpC[gi][ci2];
        allChars.push(_ce);
        /* ★R132-9d：“从四周渐显汇聚”的起始偏移（全方位随机、半径 30~76px）。
         *  写成 CSS 变量而不是 inline left/top：`.bcharg.on{left:0;top:0}` 是**类选择器**，
         *  而 inline 样式会压过类选择器 ⇒ 必须让基础规则去读变量、`.on` 去覆盖它。 */
        /* ★R132-9e：半径从 30~76px 加到 **55~150px**（用户：「要精细一些，
         *  一个一个从四周汇聚」—— 幅度太小会看成「直接出现」）。 */
        var _th=Math.random()*6.2832,_rr=55+Math.random()*95;
        _ce.style.setProperty('--dx',(Math.cos(_th)*_rr).toFixed(1)+'px');
        _ce.style.setProperty('--dy',(Math.sin(_th)*_rr*0.7).toFixed(1)+'px');
        if(order[o2]===1)_ce.classList.add('on');      // ★R132-9c：基准项出生即亮（正中不留空）
      }
  }

  BOSS.charDt=BOSS_BUILD_SEC/Math.max(1,allChars.length);
  BOSS.plat=plat;
  BOSS.rows=rows;
  BOSS.rowW=W;             // 单行可视宽（判据/解析量用）
  BOSS.cycleW=totW;        // ★R132-9d：**式子总墨迹长**（≈2W）—— 判据用它
  BOSS.x0=x0;              // ★首行起点（让第 1 项居中）
  BOSS.totW=totW;
  BOSS.rowsN=ROWSN;        // 实际行数（3 行，纵向装不下时往下退）
  BOSS.terms=terms;
  BOSS.lefts=lefts;
  BOSS.gap=g;
  BOSS.baseY=baseY;
  /* ★★R132-9d：**不再滚动** —— 式子有限、整条都在屏幕上（三行铺满）。
   *  第 1 项居中的要求已经内建在 `x0` 里（见上面的 ① 段），`off` 只作历史字段保留。 */
  BOSS.off=0;
  BOSS.platT=0;
  BOSS.reveal=0;
  BOSS.revealT=0;
  BOSS.chars=allChars;
  bossPlatLayout();
}
/* 把 e 底下的**文本节点**逐个换成 <span class="bcharg">（保留已有元素结构与原顺序） */
function wrapTextNodes(e,out){
  if(!e)return;
  if(e.nodeType===3){
    var s=String(e.nodeValue||'');
    if(!s.replace(/\s/g,''))return;               // 纯空白（如 ` + ` 的两侧空格）不包
    var frag=DD.createDocumentFragment();
    for(var i=0;i<s.length;i++){
      var sp=DD.createElement('span');
      sp.className='bcharg';
      sp.textContent=s.charAt(i);
      frag.appendChild(sp);
      out.push(sp);
    }
    e.parentNode.replaceChild(frag,e);
    return;
  }
  if(e.nodeType!==1)return;
  if(e.classList&&e.classList.contains('bcharg')){out.push(e);return;}
  fracInsertBars(e);
  var kids=[];
  for(var k=0;k<e.childNodes.length;k++)kids.push(e.childNodes[k]);
  for(var j=0;j<kids.length;j++)wrapTextNodes(kids[j],out);
}
/* ★★R132-4：`bossBuildPlat` 用。`mthHTML` 现在**自带** `.fracbar`，
 *  所以这里只做**幂等兜底**：给（理论上不会出现的）老结构补一根线，
 *  并把 `.fracbar` 转成 `.bcharg.fracbar` 纳入逐字符序列。
 *  ★必须加 `bcharg` 类：`bossBuildPlat` 的 `.bcharg` 出生即 opacity=0、
 *    由 `BOSS.reveal` 逐个点亮；不加的话横线会**一开场就全亮**。
 *  ★非 boss 路径（公式菜单 / 面板）不加 `bcharg` ⇒ `opacity` 默认 1、照常显线。 */
function fracInsertBars(root){
  if(!root||!root.querySelectorAll)return;
  var fs=root.querySelectorAll('.mfrac');
  for(var i=0;i<fs.length;i++){
    var fr=fs[i];
    var bar=null,has=false;
    for(var c=0;c<fr.childNodes.length;c++){
      var nd=fr.childNodes[c];
      if(nd.nodeType!==1)continue;
      if(nd.classList&&nd.classList.contains('fracbar')){bar=nd;has=true;}
    }
    if(!has){                              // 老结构兜底：分子之后补一根
      var num=null;
      for(var c2=0;c2<fr.childNodes.length;c2++){
        var n2=fr.childNodes[c2];
        if(n2.nodeType===1&&n2.classList&&n2.classList.contains('mnum'))num=n2;
      }
      if(!num)continue;
      bar=DD.createElement('span');
      bar.className='fracbar';
      if(num.nextSibling)fr.insertBefore(bar,num.nextSibling);
      else fr.appendChild(bar);
    }
    if(bar&&bar.classList&&!bar.classList.contains('bcharg'))
      bar.classList.add('bcharg');
  }
}
function bossTotalChars(){
  /* ★R132-9：字符袋现在**一条线性序列**（按"离 Ek 的项序距离"排，见 bossBuildPlat ③），
   *  不再按行拼接 ⇒ 直接返回长度即可（旧版要遍历每行的 items 求和）。 */
  return (BOSS&&BOSS.chars)?BOSS.chars.length:0;
}
function bossNthChar(k){
  var B=BOSS;
  if(!B||!B.chars)return null;
  return (k>=0&&k<B.chars.length)?B.chars[k]:null;
}
function bossPlatLayout(){
  var rows=BOSS&&BOSS.rows;
  if(!rows)return;
  var amp=BOSS_AMP*(BOSS.ph==='shake'?BOSS.shakeK:1);
  var ampX=BOSS_AMPX*(BOSS.ph==='shake'?BOSS.shakeK:1);
  /* ★★R132-9d：布局是**静态**的 —— 行的轨平移 = x0 − 行号×W（常量，与时间无关）。
   *  第 ti 项在行 ri 的屏幕 x = (x0 + lefts[ti]) − ri·W；它只在自己那一行（与跨行界的
   *  相邻行）落进 [0,W) ⇒ 别处被 `overflow:hidden` 裁掉。
   *  为什么改成静态（用户原话）：「要逐项显示，要按照顺序一个一个来，**不能是先下面一行、
   *  再上面一行**」—— 只要还在滚动，项就会跨行搬家，"按顺序"就无从谈起。
   *  整条式子只有 2 个视口宽、三行铺得下，本来也不需要滚动。 */
  /* ★★R132-9e：左右晃动**整块共同**（不是每行各自一个相位）。
   *  为什么（A30 实测抓到）：静态布局靠「行 ri 的轨平移 = x0 − ri·W」保证**跨行界那一项
   *  的两半**落在同一水平位置；如果每行再叠各自的 dx，两半就会错开（实测 11.89px ⇒
   *  A30 的 |Δx|−W 爆掉），行界上会出现可见接缝。整块一起摆则既满足「左右随机晃动」
   *  又不破坏接续。竖向晃动仍逐行独立（那是另一条要求，且不跨行）。 */
  var dxAll=Math.sin(BOSS.platT*0.41)*ampX;
  for(var i=0;i<rows.length;i++){
    var R=rows[i];
    var dy=Math.sin(BOSS.platT*1.05+R.ph)*amp;
    /* ★★R132-9e（用户：「怎么没有左右晃动，怎么现在只有上下晃动？左右也要随机晃动，
     *   但是位移幅度更大一些，频率更低一些」）：
     *   同一个 platT 上再叠一条**低频、大幅度**的水平正弦（频率 0.41 vs 1.05、
     *   振幅 BOSS_AMPX=26 vs BOSS_AMP=11）；相位用 R.ph*1.7 与竖向解耦，
     *   免得所有行斜着走同一条直线。平移作用在**整行**上 ⇒ 不扰动行内排版。 */
    var dx=dxAll;
    var y=BOSS.baseY+(i-(rows.length-1)/2)*BOSS_LH+dy;
    R.el.style.transform='translate3d('+dx.toFixed(2)+'px,'+y.toFixed(2)+'px,0)';
    /* ★R132-9f：行盒左边从 −BOSS_PAD_X 起 ⇒ 轨平移要加回 BOSS_PAD_X，
     *  项才会正好落在它该在的屏幕 x 上（行盒外扩只影响「能画到哪里」，不影响布局原点）。 */
    R.track.style.transform='translate3d('+(((BOSS.x0||0)-i*W+BOSS_PAD_X)).toFixed(2)+'px,0,0)';
  }
}
/* ★★R132-9e：式子**补完**的收束爆发 —— 沿已铺开的三行撒粒子 + 一次抖屏。
 *  用户原话：「全部显现后，整个式子也要再爆发粒子一样，伴随着屏幕震动」。
 *  ★与 `bossBurst()` 的分工：那次是「Ek 被吸收、式子开始长」的起点爆发；
 *    这次是「整条式子长完」的收束。两次都在，叙事才完整。 */
function bossFinale(){
  var B=BOSS;
  if(!B||!B.rows)return;
  var i,j,n;
  for(i=0;i<B.rows.length;i++){
    var R=B.rows[i];
    n=0;
    for(j=0;j<R.items.length;j++){
      var el=R.items[j].el;
      if(!el)continue;
      var r=el.getBoundingClientRect();
      if(r.width<2||r.right<4||r.left>W-4)continue;
      burstParticles(Math.max(10,Math.min(W-10,(r.left+r.right)/2)),(r.top+r.bottom)/2,9,0.9);
      if(++n>=5)break;
    }
  }
  shake(15,0.55);
}

function bossTotalItems(){
  var n=0,rows=BOSS&&BOSS.rows;
  if(!rows)return 0;
  for(var i=0;i<rows.length;i++)n+=rows[i].items.length;
  return n;
}
function bossNthItem(k){
  var rows=BOSS&&BOSS.rows;
  if(!rows)return null;
  var c=0;
  for(var i=0;i<rows.length;i++){
    for(var j=0;j<rows[i].items.length;j++){
      if(c===k)return rows[i].items[j];
      c++;
    }
  }
  return null;
}
function bossBurst(){
  var cx=W/2,cy=BOSS.y||BOSS.y1||(H*0.25);
  spawnExplosion(cx,cy);
  for(var w=0;w<160;w++){
    var wa=Math.random()*6.2832,ws=180+Math.random()*980;
    particles.push({x:cx,y:cy,vx:Math.cos(wa)*ws,vy:Math.sin(wa)*ws,age:0,
                    life:0.6+Math.random()*0.9,r:1+Math.random()*2.3,alpha:1,hot:true});
  }
  shake(22,0.9);
  /* ★★R132-9c（用户 2026-10-01：「这怎么就 mv²/2 单独在上面，其他表达式都在下面？
   *   不应该是 E=mv²/2+... 什么的吗」）：
   *  Ek 本体在这一刻被**表达式吸收** —— 它不再是场上一个独立公式体，而是条带的第 1 项。
   *  · 旧行为（R132-3）：保留 Ek 并 `_bossKept`，于是平台上长出一整条式子、
   *    而它**独自挂在平台上方**，正是用户抱怨的那一幕。
   *  · 现在：`bossDissolveEk` 把它的 5 个字形连分数线一起收掉（同时撒一层粒子），
   *    紧接着 `bossBuildPlat()` 在**同一处**长出条带的第 1 项 ⇒ 爆发帧完成交接，
   *    被粒子和抖动完全盖住，视觉上是「它长进了式子里」。
   *  ★R132-3 那句「mv²/2 应该一直不消失」仍然成立：它以**式子第 1 项**的身份继续存在
   *    （判据 A21 已按这个口径改写）。 */
  var Ek=BOSS.ek;
  if(Ek&&!Ek.dead){
    Ek.pop=Math.max(Ek.pop||0,0.9);
    bossDissolveEk(Ek);
  }
  BOSS.ek=null;
  BOSS._frozenEk=null;
  /* ★★R132：**先把 BOSS.ph 切到 'shake'（脱离 rise），再 bossBuildPlat()**。
   *  不能维持原顺序（buildPlat 之后再置 ph）——`bossBuildPlat` 的离屏量测里夹着
   *  「满三行就 break」的早退与 `meas.innerHTML=''`，而**它内部 `bossPlatLayout()` 也已跑过一次**；
   *  只要 BOSS.ph 还是 'rise'，同一次 stepBoss 的后继帧就会**再次**触发 `if(p>=1)bossBurst()`
   *  ⇒ 无限爆发（实测：粒子数二次幂增长、平台被反复重建）。先切相位 = 一次爆发只发一次。 */
  BOSS.ph='shake';BOSS.t=0;BOSS.shakeK=1;
  bossBuildPlat();
  BOSS.reveal=0;BOSS.revealT=0;
}
/* ---- ④ 主状态机 ------------------------------------------------------------------------ */
/* ★★R132：**活跃窗口用假时钟，不用 `performance.now()`**。
 *  为什么不用墙钟：`stepBoss(dt)` 的 dt 是帧步长（**可能被 TIME_SCALE 缩放**），而
 *  `performance.now()` 是真实时间 ⇒ 两者在「时间停止(t)」「慢放」下会**背离**：
 *  时间倍率 0.1 时动画要跑 10 倍真实时间，墙钟超时会把用户还没看完的 boss 提前掐掉；
 *  反之（夹具手泵把 700 帧压缩进 200ms 真实时间）会在动画刚开始就把 `bossLive()` 判死。
 *  改用与 `BOSS.t/BOSS.platT` 同一族的 `BOSS.live`（每帧减 dt）——它就是「产品时间」，
 *  与帧循环各相位共用同一把尺子。
 *  `bossLive()` 的**唯一职责**是「兜底收尾」：正常路径永远不会用到它（各相位都有明确的
 *  转场条件），它只在「用户拖了太久 / 时间倍率极端 / 帧循环被打断」时保证 boss 一定会结束。 */
function bossBump(){BOSS.live=BOSS_WAIT_GRACE;}     // 用户又放了一次 ⇒ 操作窗口重新计时
function bossLive(){return BOSS.live>0;}
function stepBoss(dt){
  if(!BOSS)return;
  BOSS.live-=dt;
  if(BOSS.ph==='repel'){
    BOSS.t+=dt;
    /* 兜底：用户放着不管太久 ⇒ 悄悄取消（否则 BOSS 会永久抓着一个公式体不放）。
     * ★不放到 'fade'（黑屏）——用户还没看到任何东西，黑屏只会让人莫名其妙。 */
    if(!bossLive())bossAbort();
    return;
  }
  var i,k;
  if(BOSS.ph==='rise'){
    BOSS.t+=dt;
    var p=clamp(BOSS.t/BOSS_RISE_MS,0,1);
    var e=1-Math.pow(1-p,3);                     // 缓出 ⇒ 「慢慢飘起来」
    var y=BOSS.y0+(BOSS.y1-BOSS.y0)*e;
    /* ★★R132-3：x 同步向屏幕中央缓动（用户「融合后**飞到屏幕中央**」）。
     *  用同一条缓出曲线 ⇒ 斜向上飘，落点在正中。 */
    var xx=BOSS.x0+((BOSS.x1!=null?BOSS.x1:W/2)-BOSS.x0)*e;
    var Ek=BOSS.ek;
    if(Ek&&!Ek.dead){
      Ek.x=xx;Ek.y=y;Ek.vx=0;Ek.vy=0;            // 位置由本模块接管（渲染仍走 render/syncGlyphs）
    }
    BOSS.x=xx;
    BOSS.y=y;
    /* 「不断有能量粒子汇聚过来」：从四周生成 seek 粒子 */
    var nsp=Math.max(1,Math.round(96*dt));
    for(k=0;k<nsp;k++){
      var a=Math.random()*6.2832,R=Math.max(W,H)*0.58;
      particles.push({x:W/2+Math.cos(a)*R,y:y+Math.sin(a)*R*0.72,
                      vx:0,vy:0,age:0,life:0.45+Math.random()*0.5,
                      r:1.3+Math.random()*2.1,alpha:1,hot:true,
                      seek:{x:xx,y:y},seekK:3.2});
    }
    /* seek 粒子的向心推进（stepParticles 只做阻尼，不认 seek） */
    for(i=particles.length-1;i>=0;i--){
      var pp=particles[i];
      if(!pp.seek)continue;
      var ddx=pp.seek.x-pp.x,ddy=pp.seek.y-pp.y,dd=Math.hypot(ddx,ddy)||1;
      var ac=2600*pp.seekK;
      pp.vx+=ddx/dd*ac*dt;pp.vy+=ddy/dd*ac*dt;
      if(dd<24){particles.splice(i,1);}
    }
    if(p>=1&&bossLive())bossBurst();
    return;
  }
  if(BOSS.ph==='shake'){
    /* ★★R132：爆发后的**余波** —— 平台已在 bossBurst 里建好（只做抖动，不重建）。
     *  抖动衰减到 0 就进 build（逐项飞入）；没走完窗口也强制进 build。 */
    BOSS.t+=dt;
    BOSS.shakeK=Math.max(0,BOSS.shakeK-dt*1.8);
    BOSS.platT+=dt;
    /* ★R132-9d：静态布局，**不再滚动**（这条递增已取消；off 恒 0） */
    bossPlatLayout();
    if(BOSS.t>=BOSS_SHAKE||!bossLive()){BOSS.ph='build';BOSS.t=0;BOSS.reveal=0;BOSS.revealT=0;}
    return;
  }
  if(BOSS.ph==='build'||BOSS.ph==='platform'){
    BOSS.platT+=dt;
    /* ★R132-9d：静态布局，**不再滚动**（这条递增已取消；off 恒 0） */
    bossPlatLayout();
    if(BOSS.ph==='build'){
      /* ★★R132-3：用户「那些字符要**逐个或几个快速汇聚**，而不是一个一个**大的表达式完整**
       *  的显示」⇒ 汇聚粒度从「整项」改成「**单个字符**」（`.bcharg`）。
       *  速率 = BOSS_CHAR_DT（2.8 字/帧 ≈ 168 字/s）——240 字约 1.4s 补完。
       *  ★项容器 `.bossterm` 保持 opacity=0、可见性交给内部 `.bcharg`：
       *    否则整项会先整块亮起，就退回成用户抱怨的「大的表达式完整的显示」了。 */
      BOSS.revealT+=dt;
      var nch=bossTotalChars();
      /* ★R132-9：间隔按**总时长**现算（见 BOSS_BUILD_SEC 注释）——字符数随窗口变，
       *  固定"每字 0.006s"会让宽窗口的 build 拖到 5s 以上。 */
      var cdt=(BOSS.charDt!=null&&BOSS.charDt>0)?BOSS.charDt:BOSS_CHAR_DT;
      var want=Math.min(nch,Math.floor(BOSS.revealT/cdt)+1);
      while(BOSS.reveal<want){
        var ce=bossNthChar(BOSS.reveal);
        BOSS.reveal++;
        if(!ce)continue;
        /* ★★R132-9e（用户：「那个出现还是怎么直接出现的？我不是说了要精细一些，         *  一个一个从四周汇聚吗？」）：逐字符汇聚 = **加一个 `.on` 类**，位移由 build 期
         *  写好的 `--dx/--dy` + CSS transition 完成，这里**不做任何强制重排**。
         *  ★为什么用「相对定位 left/top」而不是 transform（R132-9 踩过的坑）：
         *    transform 对**非替换行内元素无效**，全平台唯一例外是分数线 `.fracbar`
         *    ⇒ 旧版「飞入」只有分数线在飞、数字纹丝不动（实测同一条线上分数线 y 极差
         *      行0=1.91 / 行1=8.46 / **行2=24.26 px** —— 就是用户说的「数字高低不平」）。
         *    相对定位对行内元素**有效且不参与布局** ⇒ 基线/行高/分数线全部不动。
         *  ★过渡写在 CSS（`.bcharg` / `.bcharg.on`）。 */
        ce.classList.add('on');
      }
      /* ★★R132-9e（用户：「全部显现后，整个式子也要再爆发粒子一样，伴随着屏幕震动」）：
       *  补完的那一刻来一次**收束爆发**（沿整条式子撒粒子 + 抖屏），
       *  与 `bossBurst()` 那次（吸收 Ek、式子从这里开始长）区分开。 */
      if(BOSS.reveal>=nch&&nch>0){bossFinale();BOSS.ph='platform';BOSS.t=0;}
    }else{
      BOSS.t+=dt;
      if(BOSS.t>=BOSS_HOLD){BOSS.ph='fade';BOSS.t=0;}   // 「持续 3 秒」
    }
    return;
  }
  if(BOSS.ph==='fade'){
    /* 「整个屏幕闪黑两次后整个黑屏几秒，然后屏幕再出现」 */
    BOSS.t+=dt;
    var T=BOSS.t;
    if(T<BOSS_FADE_IN){
      var a=(T<0.06)?0:((T<0.17)?1:((T<0.28)?0:((T<0.38)?1:0)));
      bossSetMask(a);
    }else if(T<BOSS_FADE_IN+BOSS_DARK){
      bossSetMask(1);
    }else{
      bossSetMask(0);
      bossFinish();
    }
    return;
  }
}
/* ---- ⑤ 收尾：回到网页初始加载的状态 ---------------------------------------------------- */
function bossFinish(){
  var pl=BOSS&&BOSS.plat;
  if(pl&&pl.parentNode)pl.parentNode.removeChild(pl);
  /* ★★R132-3：Ek 现在**不再被爆发销毁**（用户：「mv²/2 应该一直不消失」）⇒
   *  收尾必须**显式**把它清掉，否则「回到网页初始加载的状态」会多一个冻结的幽灵公式。
   *  ★不依赖后面的 `clearAll()`：`clearAll` 是交互清屏路径，语义上可能变；
   *    这里是被销毁前最后一刻，逐件清干净最稳。 */
  var Ek=bossKillKept();
  void Ek;
  BOSS=null;
  if(DD&&DD.body)DD.body.classList.remove('bossing');   // ★R132-9e：复位面板透明度
  bossSetMask(0);
  TIME_SCALE=1;
  if(typeof setToolMode==='function')setToolMode(null);
  try{clearAll();}catch(e){}
  /* ★R132-9g：同理 —— 收尾也不弹文字。 */
}
/* 清掉 boss 保留的 Ek（字形 + 分数线 + bodies 记录），返回被清的件数 */
function bossKillKept(){
  var n=0;
  for(var i=bodies.length-1;i>=0;i--){
    var B=bodies[i];
    if(!B||!B._bossKept)continue;
    if(B.glyphs)for(var j=0;j<B.glyphs.length;j++){
      var g=B.glyphs[j];
      if(g&&g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
      if(g)g.dead=true;
    }
    B.glyphs=[];B.mem=[];
    B._bossFrozen=false;B._bossKept=false;
    if(B.st&&B.st.bar&&B.st.bar.el&&B.st.bar.el.parentNode)
      B.st.bar.el.parentNode.removeChild(B.st.bar.el);
    bodies.splice(i,1);
    n++;
  }
  return n;
}
function bossAbort(){
  bossLightReset();
  if(!BOSS)return;
  if(BOSS.plat&&BOSS.plat.parentNode)BOSS.plat.parentNode.removeChild(BOSS.plat);
  if(BOSS.rows)BOSS.rows=null;
  if(BOSS.ek)BOSS.ek._bossFrozen=false;
  /* ★★R132-3：中途取消同样要清掉被保留的 Ek（否则取消后留个幽灵公式） */
  bossKillKept();
  var Ek=BOSS._frozenEk;
  if(Ek){
    for(var i=0;i<Ek.glyphs.length;i++){
      var g=Ek.glyphs[i];
      if(g&&g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
      if(g)g.dead=true;
    }
    Ek.glyphs=[];Ek.mem=[];
    var bi=bodies.indexOf(Ek);
    if(bi>=0)bodies.splice(bi,1);
    Ek._bossFrozen=false;
  }
  BOSS=null;
  if(DD&&DD.body)DD.body.classList.remove('bossing');   // ★R132-9e：复位面板透明度
  bossSetMask(0);
}
/* ★★R132 BOSS：**光速 v 无论从哪条路送进 attach()，一律归 boss 管**。
 *  抛错时返回 false = 「这次不归我，按原语义继续赋予速度」。 */
function bossTryPlace(B,d){
  if(!d||d.ch!=='v'||!d.vLight)return false;
  if(typeof bossIsEk!=='function'||!bossIsEk(B))return false;
  bossPlace(B,d);
  return true;
}

/* 器件：传送带 / 绳 / 铰链 / 地面、吸附提示（原 index.html 第 15068–16554 行） */
/* ================= R96 器件（DEVICES）：从面板直接拖出 ==================================
 * 用户原文：「再在左上角下拉框增加一个类别按钮，叫做器件，里面是可以拉出各种器件的，首先第一个
 *   叫做弹簧，也就是那个 kx 组成的弹簧可以从这里面直接拖出」。
 *
 * 要点：这里**不新造任何物理**。弹簧就是 makeSpring —— 与「把 k 和 x 拖到一起」拼出来的那个
 * 逐字段相同（同一函数、同一默认 ks/阻尼/长度钳制，高中模式下同样拿到 auto 导轨）。本次只是给
 * 它加了**第二个入口**：从器件面板直接拖出来放下。所以器件表里每一项只需回答一件事 ——
 * 「给我一个落点，在那儿造一个默认尺寸的你」。
 *
 * 默认尺寸的取舍（R97，用户：「那个弹簧拖出来的应该要和那个拼出来的参数一致」）：
 * 自然长度取 SPR_SPAWN_LEN=110 —— 就是 `makeSpring` 长度钳制 `clamp(d,110,340)` 的**下限**，
 * 也就是「把 k 和 x 拖到一起拼出来」时实际拿到的那一个（两字母贴着放，间距必被夹到 110）。
 * 诊断实证（_diag_r97_sprparam.py 逐字段对比两条路径）：物理参数 ks/bounc/mass/anc 本来就
 * **逐字段相同**，唯一不同的独立参数只有 `len`（kx=110 vs 面板=170），其余差异（cur/hw/th/
 * _ax/_ay/x/y）全是 len 与落点的派生量。⇒ 把默认改成 110，两条入口的**默认参数就完全一致**。
 * （R96 旧值 170 的出处是 R87-E 注释里「理论悬挂伸长 mg/k=2600/50=52px（自然长度 170px）」，
 *  那是「用 170 举例」的推导，不是契约；改成 110 后同一条推导给出 52/110 = +47% 的伸长率，
 *  仍然在合理范围，且弹力系数 ks 未动 ⇒ 悬挂行为本身不变。）
 * 方向恒为**水平**：一条平放的弹簧是最常见的挂法，而且水平是唯一在大学/高中两种模式下
 * 语义都合法的方向（高中只允许水平/竖直，makeSpring 会自动补 auto 导轨）。
 * 放下之后长度和方向都能改（拖端点 / 参数面板里的自然长度），默认值不需要太聪明。
 */
// ★R126：`SPR_SPAWN_LEN` 的**声明**已前移到「出生尺寸常量区」（紧邻 GROUND_SPAWN_LEN，
//   在 PARAM_DEFS 之前）—— 因为参数表 `slen.def` 要在字面量求值那一刻就抓到它的值
//   （`var` 提升只提升声明）。这里**刻意不再重复声明**：全文件只此一处，本行只是指针。
/* R98（用户：「然后开始做剩下三个器件」——④ 轻质杆）：
 * 轻质杆 = makeRod 造的那条 vt 木板，走**同一个** makeRod，与「把 v 和 t 拖到一起拼出来」
 * 的杆逐字段相同（len=170、hasG=true、php=F*0.55、refresh 后 hw=len/2+2）。
 * ROD_SPAWN_LEN 取 170 —— 就是 makeRod 的默认，也是 vt 拼接实际拿到的那一个（R97 的
 * 「拖出来 == 拼出来」纪律在这里同样成立：两条入口的默认参数完全一致）。
 * 悬浮旋转手柄：makeRod 造的杆 kind==='T'，已在旋转手柄白名单里（refreshHover 4616/4626），
 * 无需新增。两端**长度手柄**见 R98-3（rodlen 手柄，走 setRodLen 咽喉）。 */
// ★R126：`ROD_SPAWN_LEN` 的声明已前移到「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。本行只是指针。
/* R99（用户：「并且再增加器件，传送带」）：
 * 传送带 = 一条**画出来的闭合矩形**（mkBoundary closed poly）+ 两个专属字段：
 *   B.belt=true   —— 渲染/参数面板认它；
 *   B.conv (px/s) —— 带面速度，沿本体 +x（随 th 旋转），可为负（反向）。
 * 之所以复用 W 体而不是新造一种 kind：拖动、固定、旋转、右键参数、解散、悬浮高亮……
 * 这一整套既有机器全都能直接吃它（新 kind 意味着每一处都要补一遍，且必然漏）。
 * ★默认带速 CONV_DEF 已连同 R102 的说明一并前移到 PX_PER_M 旁边（留在 makeBelt 这一带的后果
 *   是：参数表 convspeed 的 def 在对象字面量求值时抓到 undefined）。本产品线不再重复声明它。
 * 物理走 beltTract（见 collideBodies 上方那段实测注释：公式体没有 Matter 镜像，
 * 唯一有效的写入点是那条手写 SAT 通道）。 */
// ★R126：`BELT_SPAWN_LEN` 的声明已前移到「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。
//   注意它原来是和 `BELT_TH` 挤在同一行 `var` 里的 —— 拆分时只搬出生**尺寸**那一个，
//   `BELT_TH`（带子厚度）留在原地：它不是「出生尺寸」家族的成员，也不进参数表。
var BELT_TH=20;
function makeBelt(cx,cy){
  var hl=BELT_SPAWN_LEN/2,ht=BELT_TH/2;
  var B=mkBoundary([[cx-hl,cy-ht],[cx+hl,cy-ht],[cx+hl,cy+ht],[cx-hl,cy+ht]],
                   {shape:'poly',closed:true});
  if(!B)return null;
  B.belt=true;
  B.conv=CONV_DEF;
  B.fixed=true;                                   // 传送带是钉在地上的机器，不是会掉的东西
  if(B.mb){Matter.Body.setStatic(B.mb,true);Matter.Sleeping.set(B.mb,false);}
  // 带面**自带**摩擦（μ=0.6）：这是传送带这个器件本身的属性，不是世界默认。
  // 不写这一条的话，高中模式的「默认 μ 全 0」会让传送带一放下去就完全打滑（物理上没错，
  // 但用户只会以为器件坏了）。显式写进 B.wFrict ⇒ 参数面板读到的就是物理上生效的那个值
  // （「读数 = 物理」纪律），想让它打滑就把 μ 拖到 0。
  B.wFrict=0.6;applyWFrict(B);
  return B;
}
/* ================= R101⑦ 器件：光滑铰链 / 轻绳 ==========================================
 * 用户原文：「这一轮你也开始做剩下的 ⑤光滑铰链、⑥轻绳」。
 *
 * ★两个器件都**复用 kind==='S'** + 一个布尔标志（B.rope / B.hinge），不新造 kind。
 *   理由与 R99 传送带复用 W 体逐字相同：`kind` 在本文件里被 39 处 `kind==='S'` 用来分派 ——
 *   「两端锚定（anc/ox/oy）、端点拖拽、悬浮高亮、拖整体（springMoveRig）、整体复制、
 *   双击解散、碰撞幽灵化、垃圾桶判定、参数面板收口」这一整套机器全都认它。新造一个 kind
 *   意味着这 39 处每一处都要补一遍，且**必然漏**（漏一处 = 「拖不动 / 删不掉 / 面板写不进物理」）。
 *   所以只在**必须分派**的五处加标志判断：力律（stepSprings）、渲染（render 的 'S' 分支）、
 *   参数行（paramDef/paramV/applyParam）、名称（bodyName）、以及「不参与碰撞」（springMirror）。
 *
 * ---- 光滑铰链（无摩擦转动副）------------------------------------------------------------
 * 物理：两个锚点必须**重合**（双边约束，拉也管、推也管），但**完全不约束相对转动** ——
 *   这正是「光滑」的含义：铰链只传力、不传力矩，两体可以绕铰链自由地相对转。
 * 为什么它值得单独做一个器件（与 R100① 杆的单端锚定的区别）：
 *   杆的锚定是**位置驱动**的（把杆摆到锚点上，不反算宿主受力）——「把杆挂在墙上可以，
 *   用杆去撬很重的物体不行」（那是 R100① 里诚实记录下来的已知边界）。铰链是**真正的
 *   双边约束**：冲量按 1/m 与 1/I 分配后**同时**作用在两个宿主上，所以「双摆」「曲柄」
 *   这类两端都是动力学体的装配才成立，而不是只有一端能动。
 * 求解 = 位置投影（限幅 CON_MAXSTEP，防初始大偏差瞬移）+ 二维点约束冲量投影（含转动项）。
 *
 * ---- 轻绳（不可伸长、只能拉不能压）------------------------------------------------------
 * 物理：**单边**约束 —— d ≤ len 时完全不受力（绳松弛；轻绳没有抗压能力）；d > len 才绷直。
 *   绷直是**非弹性**的（位置拉回 + 只消掉**分离**方向的相对速度，接近方向分毫不动 ——
 *   绳不能被推），这正是真实绳被拽直那一下的行为，也是「只能拉」的实现。
 * 与弹簧的本质区别（探针的判据就架在这上面）：同样 len 下弹簧会推会拉、d 在 len 两侧振荡；
 *   轻绳**只拉不推**，且 d 永远 ≤ len + 容差。
 * 无 Matter 镜像（不挡路）：弹簧的线圈是**实物**（所以有薄板镜像，东西撞得上去），
 *   轻绳的理想化模型是**只传张力的连线** —— 给它一块刚性薄板反而与「绳是软的」自相矛盾。
 *   ★诚实记录的边界：轻绳不会因为压上东西而下垂/弯曲（没有柔性绳动力学），也不与任何物体
 *   碰撞 —— 它是一个**连接件**，不是一个可站立的表面。
 * 参数只有「绳长」（理想轻绳无内耗；绷直时的非弹性响应本身就在耗散）。
 *
 * ---- 量纲（★别在这里踩 MU-01 的坑）-----------------------------------------------------
 * 求解器全部在 **Matter 本体口径**里算：mb.velocity / mb.angularVelocity 都是「每 1/60 步」
 * 的值（属性值与 setter 入参同构，真值 = ×60），冲量 J 也按同一口径 —— 而位置修正是 px。
 * 式子是 Δv(每步) = J·(1/m) 与 J = −v_rel(每步)/k，两边自洽，**不需要任何 60 倍换算**。
 * （JS 侧的派生量 h.vx/h.vy 一律不在这里改写：那是 stepMatter 每帧用位置差分重建的，
 *   在这里插一手只会制造「同一帧里两套速度」的错位。冲量纯粹留在 Matter 域内。）
 */
// ★R126：`ROPE_SPAWN_LEN` 的声明已前移到「出生尺寸常量区」（理由同 SPR_SPAWN_LEN）。本行只是指针。
var ROPE_MIN_LEN=20, ROPE_MAX_LEN=2000;
// ★R104-2（用户：「绳子刚拖出来的时候也要是像图标那样弯曲的」）：**落点虚影**的视觉垂度（px）。
// 只喂给 drawRope 的第二个（可选）实参，**不改 B.len、不改 makeRope** ——
// A3 契约要求放下后的 B.len 严格等于跨度（ROPE_SPAWN_LEN），绳在静置时是绷直的，
// 按 J2 契约必须画成直线。虚影不一样：它是「你正要放下的是一根绳」的图示，
// 所以额外给它 26px 垂度，让它落进 drawRope **同一条**下垂弧分支（J1 那一支），
// 与 chip 的波浪单线读起来是同一件东西。26px 对应 110px 跨度 ≈ 13px 垂深，肉眼清晰。
// ★R104-2b（B1 红判据的诚实修正，记下来别再踩）：第一版取 26 是**换算错了一倍** ——
//   drawRope 用的是 quadraticCurveTo，控制点偏移 sag 对应的**实际**最大垂深只有 sag/2
//   （二次贝塞尔在中点处恰好过半），而 sag=min(slack·0.55,90) ⇒ 可见垂深 = slack·0.275。
//   26 ⇒ 7.15px，落在 110px 弦上只有 6.5%（≈看不出是条绳）。取 50 ⇒ 可见 13.75px（12.5%），
//   与 chip 那条波浪单线的观感一致。纯渲染参数，长度/落点/锚点口径一概不动。
var ROPE_GHOST_SAG=50;
var CON_MAXSTEP=12;              // 约束每帧位置修正的限幅（px）：初始大偏差平滑收敛而不是瞬移
// ★R104-4/5/9：轻绳/铰链的每帧步长。它们比弹簧多一件事 —— 拖动端也参与位移分配
//   （conPull 的 allowGrab，见 conMov 注释），所以一帧的修正能力必须盖得住「指针一帧的位移」。
//   实测（_probe_r104.py 组 D/E）：stepSprings 每帧只跑一次，取 CON_MAXSTEP=12 时
//   30px/帧 的拖速直接把 d 顶到 415px；取 48 时 d 全程 ≤ len+1.5 / ≤1px。
var CON_DRAG_STEP=48;
function makeRope(ax,ay,bx,by){
  var dx=bx-ax,dy=by-ay,d=Math.hypot(dx,dy);
  if(d<1){dx=1;dy=0;d=1;}
  var len=clamp(d,ROPE_MIN_LEN,ROPE_MAX_LEN);
  var ex=ax+dx/d*len,ey=ay+dy/d*len;
  var B=BODY((ax+ex)/2,(ay+ey)/2);
  B.kind='S';
  B.rope=true;
  B.e0={x:ax,y:ay};B.e1={x:ex,y:ey};
  B.anc=[null,null];
  B.len=len;
  B.bounc=0;
  refreshSpringGeom(B);
  initRopeNodes(B);          // ★R131：链化 —— 柔性绳的离散节点（见下）
  return B;
}
/* ================= ★R131 柔性绳（verlet 链）：阻断 + 耷拉 ==============================
 * 用户：「轻绳有一个bug，它应该是不能穿过其他物体的，也就是如果空中有一个固定的物体，
 *   它运动到这里，应该是会被阻断且耷拉在这里」。
 * 旧实现 = 两个端点 + 一条松弛抛物线（纯视觉垂度），绳与一切物体互不碰撞（11340 行
 * 「诚实记录的边界」）。现在把这条边界推翻：绳 = **离散质点链**（verlet）——
 *   · 中间节点：B.nodes（不含两端；两端 = e0/e1，由宿主锚定/ropeSolve 收口管辖，链不篡改）；
 *   · 每帧 ropeVerletStep：节点重力 verlet 积分 → 段长约束迭代（两端钉死，来回各一遍）→
 *     节点-物体碰撞（Matter.Query.point 内部判定 + hostClosestPoint 推到最近表面点外 1px）；
 *   · 绷直拉拽语义**原封不动**留给 ropeSolve（e0/e1 距离 > len 时的 conPull/conProj）——
 *     链几何保证「端距 ≤ 链总长」，链被拉直时自然绷成直线，两套机制不打架；
 *   · 绳长改变（springSetLen）→ initRopeNodes 沿新 e0/e1 重铺；加载/旧数据 → 调用点兜底链化；
 *   · 渲染：有 nodes 走折线（真实的阻断/耷拉形状），无 nodes（ghost/兼容）走旧抛物线。
 * 已知边界（诚实记录）：节点无质量分配回宿主（链对宿主只有 e0/e1 两点的既有约束），
 *   绳自身重量不压弯宿主；节点碰撞是「推出」不是「冲量」（不把物体撞动）——轻绳无质量，
 *   这正是理想轻绳的语义。 */
var ROPE_NODE_GAP=26;        // 节点平均间距（px）：链的空间分辨率（3~36 段自动适配绳长）
var ROPE_VERLET_DAMP=0.95;   // 节点速度保留率：★R131-8c 0.995→0.95（用户：「绳子还在自己运动」
                             // ——实测松弛链晃动要 2.5s 才安定；轻绳无质量、准静态语义，
                             //  快安定更真实。0.95 ⇒ 晃动 ~1s 内进冻结门）
var ROPE_COLLIDE_ITER=3;     // 段长约束+碰撞的迭代轮数
/* ★R131-8（用户：「绳子好像比他的约束还长，明明物体已经不动了绳子还在自己运动，
 *   且从刚召唤出来就没有被拉直过，一直松松垮垮」）：
 *   · ROPE_TAUT_EPS 绷直判据：端距 de ≥ len−0.5 时，满足「链总长=len、两端钉死」的构型
 *     **只有直线一条** ⇒ 直接等分铺点 + 清 verlet 速度（px=x/py=y），本帧跳过整条
 *     积分/约束/碰撞链。没有这条，verlet 重力每帧把节点往下坠、只拉不推的段约束再把
 *     它拉回来，中途的位移全部变成节点速度 ⇒ 放下即弯、还要晃好几秒（实测
 *     _diag_r131d A 案：放下 0.25s 内 sag 0→7.95px、晃动 8.08px）。
 *   · ROPE_SETTLE 静止冻结门：松弛链收敛后（本帧最大节点位移 < 0.03px）把 px/py 对齐
 *     x/y ⇒ verlet 速度清零，链彻底停住。 verlet 的 0.995 阻尼要几十帧才耗得完，
 *     冻结门让它一到静区就停（真实绳子松手后 1s 内静止）。 */
var ROPE_TAUT_EPS=0.5;       // 绷直判据（px）：端距距 len 不足此值视为绷直
var ROPE_SETTLE=0.03;        // 静止冻结门（px/帧）：最大节点位移低于此值即冻结
function ropeSegCount(len){return clamp(Math.round((len||100)/ROPE_NODE_GAP),3,36);}
function initRopeNodes(B){
  if(!B||!B.rope)return;
  var n=ropeSegCount(B.len);
  B._segLen=(B.len||100)/n;
  var ns=[];
  for(var i=1;i<n;i++){
    var t=i/n;
    var x=B.e0.x+(B.e1.x-B.e0.x)*t, y=B.e0.y+(B.e1.y-B.e0.y)*t;
    ns.push({x:x,y:y,px:x,py:y});
  }
  B.nodes=ns;
}
var _ropeHitBuf=[];
function ropeCollidables(B){           // 可碰撞实体：一切有 Matter 体的非 S 族（W/杆镜像/带子/字母刚体）
  /* ★R131-6：排除绳**自己的锚宿主** —— 绳端钉在宿主表面（hostClosestPoint），端旁节点
   * 落进宿主内部属正常几何；推出与段约束（钉死端）打架 = 端部锯齿跳动。 */
  _ropeHitBuf.length=0;
  var ex0=(B&&B.anc[0]&&B.anc[0].B&&!B.anc[0].B.dead)?B.anc[0].B:null,
      ex1=(B&&B.anc[1]&&B.anc[1].B&&!B.anc[1].B.dead)?B.anc[1].B:null;
  for(var i=0;i<bodies.length;i++){
    var b=bodies[i];
    if(b.dead||!b.mb||b.kind==='S')continue;
    if(b===ex0||b===ex1)continue;
    _ropeHitBuf.push(b.mb);
  }
  return _ropeHitBuf;
}
function ropeVerletStep(B,dt){
  var ns=B.nodes;
  if(!ns||!ns.length)return;
  /* ★R131-8 绷直态直线精确解：端距 ≥ len−eps 时唯一满足约束的构型就是直线，
   *  直接铺点并清速度、整帧跳过积分/碰撞 —— 出生即直、绷直期间零晃动。 */
  var dxe=B.e1.x-B.e0.x,dye=B.e1.y-B.e0.y,de=Math.hypot(dxe,dye)||1e-6;
  if(de>=(B.len||0)-ROPE_TAUT_EPS){
    var uxe=dxe/de,uye=dye/de,nn=ns.length+1;
    for(var i0=0;i0<ns.length;i0++){var tt=(i0+1)/nn,nd0=ns[i0];
      nd0.x=B.e0.x+dxe*tt;nd0.y=B.e0.y+dye*tt;nd0.px=nd0.x;nd0.py=nd0.y;}
    /* ★★R131-11（用户：「绳子还是会穿透空中的物体」）：绷直 ≠ 免碰撞 —— 绷直分支原来
     *  铺完直线就 return，障碍压在绳线上时节点全部在物体内、**永远**不推出（实测
     *  _diag_r131f C 案：绷直绳+方块压线 nodeIn=4 恒 3s 不收敛，绳从方块正中切过）。
     *  修法：铺点后做一次推出——障碍上的节点贴到最近表面外 1px，绳沿障碍表面凸出。
     *  物理上「无余量还硬弯」对无质量绳没有严格解（轻绳不推物体），取视觉正确。
     *  无障碍时 AABB 不相交 ⇒ 一趟 bounds 粗筛后零成本，绷直快路径不受影响。 */
    if(Matter.Query&&Matter.Query.point){
      var mbs0=ropeCollidables(B);
      if(mbs0.length){
        var bx0=Math.min(B.e0.x,B.e1.x),by0=Math.min(B.e0.y,B.e1.y),
            bx1=Math.max(B.e0.x,B.e1.x),by1=Math.max(B.e0.y,B.e1.y);
        for(var q3=0;q3<mbs0.length;q3++){
          var b3=mbs0[q3],bd3=b3.bounds;
          if(bd3.max.x<bx0||bd3.min.x>bx1||bd3.max.y<by0||bd3.min.y>by1)continue;
          for(var j3=0;j3<ns.length;j3++){
            var nd3=ns[j3];
            if(nd3.x<bx0||nd3.x>bx1||nd3.y<by0||nd3.y>by1)continue;
            var h3=Matter.Query.point([b3],nd3);
            if(h3&&h3.length){
              var hB3=null;
              for(var k3=0;k3<bodies.length;k3++)if(bodies[k3].mb===b3){hB3=bodies[k3];break;}
              if(!hB3)continue;
              var qq=(typeof hostClosestPoint==='function')?hostClosestPoint(hB3,nd3.x,nd3.y):null;
              if(qq){
                var ox3=qq.x-b3.position.x,oy3=qq.y-b3.position.y,ol3=Math.hypot(ox3,oy3)||1;
                nd3.x=qq.x+ox3/ol3;nd3.y=qq.y+oy3/ol3;nd3.px=nd3.x;nd3.py=nd3.y;
              }
            }
          }
        }
      }
    }
    return;
  }
  var g=GRAV*dt*dt;
  var mbs=ropeCollidables(B);
  var i,k,nd;
  // ① verlet 积分
  for(i=0;i<ns.length;i++){
    nd=ns[i];
    var vx=(nd.x-nd.px)*ROPE_VERLET_DAMP, vy=(nd.y-nd.py)*ROPE_VERLET_DAMP;
    nd.px=nd.x;nd.py=nd.y;
    nd.x+=vx;nd.y+=vy+g;
  }
  // ②③ 段长约束（e0/e1 两端钉死、来回各一遍）+ 碰撞阻断（每轮末以碰撞为准）
  // ★R131-6（用户截图：绷直绳画成一段一段锯齿且持续跳动）：段约束原版**双向**（受压也
  //   硬推开）——绳是柔索**只抗拉不抗压**；两钉死端之间受压的链像细杆柱一样屈曲成锯齿，
  //   加上每帧重力注入与碰撞推出的打架 = 锯齿形态 + 永不收敛的跳动（实测 _diag_r131b P 案：
  //   垂距偏差 0.58→3.66px 持续增长、逐帧跳动 0.16→0.78px 不收敛）。改成**只拉不推**
  //   （d>segLen 才收）：松弛段自由下垂，绷直段拉成直线，锯齿与跳动同源消失。
  for(var it=0;it<ROPE_COLLIDE_ITER;it++){
    var px_=B.e0.x,py_=B.e0.y;
    for(i=0;i<ns.length;i++){          // 正向：e0 端钉死
      nd=ns[i];
      var dx1=nd.x-px_,dy1=nd.y-py_,d1=Math.hypot(dx1,dy1)||1e-6;
      if(d1>B._segLen){
        var f1=(d1-B._segLen)/d1;
        nd.x-=dx1*f1;nd.y-=dy1*f1;
      }
      px_=nd.x;py_=nd.y;
    }
    px_=B.e1.x;py_=B.e1.y;
    for(i=ns.length-1;i>=0;i--){       // 反向：e1 端钉死
      nd=ns[i];
      var dx2=nd.x-px_,dy2=nd.y-py_,d2=Math.hypot(dx2,dy2)||1e-6;
      if(d2>B._segLen){
        var f2=(d2-B._segLen)/d2;
        nd.x-=dx2*f2;nd.y-=dy2*f2;
      }
      px_=nd.x;py_=nd.y;
    }
    if(Matter.Query&&Matter.Query.point&&mbs.length){
      for(i=0;i<ns.length;i++){
        nd=ns[i];
        var hits=Matter.Query.point(mbs,{x:nd.x,y:nd.y});
        if(hits&&hits.length){
          var hitMb=hits[0],hB=null;
          for(k=0;k<bodies.length;k++)if(bodies[k].mb===hitMb){hB=bodies[k];break;}
          if(!hB)continue;
          /* ★R131-11（用户：「绳子还是会穿透空中的物体」）：最近表面点取**本帧起始位置**
           *  （px/py=积分前位置，verlet 语义天然保留）而不是切进体内后的当前位置——
           *  后者会让相邻节点被推到障碍的**不同侧面**（上面的贴顶、下面的贴底），
           *  段直接横穿物体=视觉穿透（_diag_r131f A 案：nodeIn=7 恒定、绳从板中间过）。
           *  用起始位置选面 ⇒ 绳从哪侧来就贴哪侧表面，实现真正的「绕行」。 */
          var q=(typeof hostClosestPoint==='function')?hostClosestPoint(hB,nd.px,nd.py):null;
          if(!q)q=(typeof hostClosestPoint==='function')?hostClosestPoint(hB,nd.x,nd.y):null;
          if(q){
            var oxq=q.x-hitMb.position.x,oyq=q.y-hitMb.position.y,ol=Math.hypot(oxq,oyq)||1;
            nd.x=q.x+oxq/ol;nd.y=q.y+oyq/ol;    // 推出表面 1px（防 Query 边界抖动）
            nd.px=nd.x;nd.py=nd.y;              // 推出不攒速度（轻绳无质量，位置修正不注能）
          }
        }
      }
    }
  }
  /* ★R131-8 静止冻结：本帧最大节点位移低于 ROPE_SETTLE ⇒ px/py 对齐 x/y（verlet 速度
   *  清零），链彻底停住 —— 否则 0.995 的阻尼要几十帧才耗干净，肉眼就是「绳子还在自己动」。 */
  var _mv=0;
  for(var i2=0;i2<ns.length;i2++){var nd2=ns[i2];
    var mvi=Math.abs(nd2.x-nd2.px)+Math.abs(nd2.y-nd2.py);if(mvi>_mv)_mv=mvi;}
  if(_mv<ROPE_SETTLE){
    for(i2=0;i2<ns.length;i2++){ns[i2].px=ns[i2].x;ns[i2].py=ns[i2].y;}
  }
}
// 光滑铰链：长度恒 0（两锚点重合）。不设 ks/damp —— 它是**约束**不是弹簧。
function makeHinge(cx,cy){
  var B=BODY(cx,cy);
  B.kind='S';
  B.hinge=true;
  B.e0={x:cx,y:cy};B.e1={x:cx,y:cy};
  B.anc=[null,null];
  B.len=0;
  B.bounc=0;
  refreshSpringGeom(B);
  return B;
}
// ---- 统一的两点约束求解器（轻绳 / 铰链共用）--------------------------------------------
// 单位冲量在某点沿 n 产生的法向速度：k = 1/m + (r×n)²/I。
// 这一项就是「冲量作用在偏心点上会顺带把物体转起来」的那部分 —— 少了它，绳/铰链挂在球的
// 边缘上时球不会像真实刚体那样被拽正（R60b 在弹簧上踩过同一个坑：力只作用在质心，
// 球就以「左耳挂着」的姿态僵在半空）。
function conVel(h,px,py,nx,ny){
  if(!h||!h.mb)return 0;
  var v=h.mb.velocity||{x:0,y:0};
  var s=v.x*nx+v.y*ny;
  if(h.mb.angularVelocity){
    var rx=px-h.mb.position.x,ry=py-h.mb.position.y;
    s+=h.mb.angularVelocity*(rx*ny-ry*nx);
  }
  return s;
}
// 「这一侧吃不吃冲量、吃多少」。null = 完全动不了：static / fixed / 正被鼠标拖的 /
// 正被长度手柄按住的杆 / 弹簧这种无质量幽灵 —— 与 R93①③「指针与外部位移源不能被约束改写」
// 是同一条纪律（拖拽端在约束里等于**无穷大质量**，于是约束只会搬另一端）。
function conSide(h,nx,ny,px,py){
  if(!h||!h.mb||h.dead)return null;
  if(h.kind==='S')return null;
  if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj===h)return null;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return null;
  var mb=h.mb,im=(mb.inverseMass!=null)?mb.inverseMass:0;
  if(!(im>0))return null;                        // isStatic / 被 setStatic 过：inverseMass = 0
  var ii=(mb.inverseInertia!=null)?mb.inverseInertia:0;
  var rx=px-mb.position.x,ry=py-mb.position.y,cr=rx*ny-ry*nx;
  return {k:im+cr*cr*ii,im:im,ii:ii,cr:cr};
}
function conPush(h,s,nx,ny,J){
  if(!s||!h||!h.mb)return;
  var mb=h.mb,v=mb.velocity||{x:0,y:0};
  Matter.Body.setVelocity(mb,{x:v.x+nx*J*s.im,y:v.y+ny*J*s.im});
  if(s.ii&&s.cr)Matter.Body.setAngularVelocity(mb,(mb.angularVelocity||0)+s.cr*J*s.ii);
  if(Matter.Sleeping)Matter.Sleeping.set(mb,false);
}
// 沿 n 把两个物质点的**相对速度**投影成 0。onlySep=true 时只在「正在分离」时才动手
// —— 这就是轻绳的单边语义：会拉，绝不推。
function conProj(h0,px0,py0,h1,px1,py1,nx,ny,onlySep){
  var s0=conSide(h0,nx,ny,px0,py0),s1=conSide(h1,nx,ny,px1,py1);
  var kk=(s0?s0.k:0)+(s1?s1.k:0);
  if(!(kk>1e-12))return 0;
  var vr=conVel(h1,px1,py1,nx,ny)-conVel(h0,px0,py0,nx,ny);
  if(onlySep&&!(vr>0))return 0;
  // ★符号（R101⑦ 落地后第一遍尺子抓到的错，别改回去）：投影的目标是把 vr **消成 0**。
  //   约定：n 由 e0 指向 e1，vr = (v1−v0)·n（>0 = 两端在互相远离）；J = 施加在 h0 上、
  //   沿 **+n** 的冲量大小 ⇒ Δv0·n = +J/m0、Δv1·n = −J/m1
  //   ⇒ vr' = vr − J·(1/m0+1/m1) = vr − J·kk，令 vr'=0 得 **J = +vr/kk**。
  //   第一版写成 J = −vr/kk，效果是 vr' = 2·vr —— **每帧把分离速度翻倍**：绳/铰链不但不
  //   约束，还主动把两端越推越远。实测（_diag_r101h_devices.py 第一遍）：竖直悬挂的载荷
  //   1.5s 掉 287px、d 从 80 冲到 367.5（同夹具的弹簧只下垂 52px）；两端自由时 max d 冲到
  //   1323px（len=140）；偏心销钉 max d=339.7px。改成 +vr/kk 后四组全部转绿。
  //   这正是「先量后改 + 负对照」要抓的那类东西：符号错了代码照样跑、语法全绿。
  var J=vr/kk;
  conPush(h0,s0,nx,ny,J);
  conPush(h1,s1,nx,ny,-J);
  return J;
}
// 位置修正用的「动得了的程度」（只要 1/m，与转动无关）。
// ★R104-5/9 收尾（_diag_r104o 实测后定案）：`allowGrab` 只给**轻绳/铰链的位置修正**开口。
//   理由：拖拽端在约束里当无穷大质量（conSide/conMov 归零）本意是「不跟指针抢」，对**冲量**
//   通道（conSide）完全正确、保持不动；但对**位置**通道，它意味着「没有任何一条通道能把它
//   拉回来」——指针每帧把锚点往外搬一点，d 就一路长到 368px（用户⑤ 的「脱离物体还拖一根线」）。
//   实测过两条补救路线，都不如让拖动端**按 1/m 参与 conPull 的位移分配**：
//     · 在求解器末端另加一个「否决越界位移」的夹子（第一版做法）：它绕过了 conPull 的
//       CON_MAXSTEP 平滑收敛，与 Matter 的位置/速度自走形成正反馈 —— _diag_r104o 实测帧内
//       修正量 20.8→45.7→…→219.7px **单调增长**，且会把被拖物体顶进铁砧里。
//   参与分配之后，越界量每帧被**同一套已验证的机制**按质量比分掉：两端都可动 ⇒ 一起走
//   （拖一个另一个同步跟走），另一端是铁砧 ⇒ 全由拖拽端吸收（拖不动就是拖不动）。
function conMov(h,allowGrab){
  if(!h||!h.mb||h.dead)return 0;
  if(h.kind==='S')return 0;
  if(!allowGrab&&typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj===h)return 0;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return 0;
  var im=(h.mb.inverseMass!=null)?h.mb.inverseMass:0;
  return im>0?im:0;
}
// 把两锚点沿连线拉近（按 1/m 分配位移，限幅 maxStep）。
// ★setPosition 必须只给两参（R77 的坑：第三参 = 「把位移当速度传送」，会凭空注能）。
function conPull(h0,px0,py0,h1,px1,py1,target,maxStep,allowGrab){
  var dx=px1-px0,dy=py1-py0,d=Math.hypot(dx,dy);
  if(!(d>1e-4))return 0;
  var w0=conMov(h0,allowGrab),w1=conMov(h1,allowGrab),sw=w0+w1;
  if(!(sw>0))return 0;
  var ux=dx/d,uy=dy/d;
  // ★★target 是**必须**的参数，别省也别写死：轻绳的目标是 len（不可伸长 ⇒ 绷直后停在 len），
  //   铰链的目标是 0（两锚点重合）。第一版写死成 0（`pen=Math.min(d,maxStep)`），于是轻绳
  //   一绷直就被当成铰链往「两点重合」拉 —— 实测竖直悬挂 1.5s 后 d 从 80 被拉到 75.44、
  //   载荷反而被**往上提**了 4.56px（同一条尺子的 D1/D2 抓到）；两端靠近到交叉后 d 又超过
  //   len ⇒ 同样被往重合处拉，另一端被推飞 31px（G1）。这一步只做「超出多少就收回多少」。
  var over=d-target;
  if(!(over>0))return 0;
  var pen=Math.min(over,maxStep);
  var m0=pen*(w0/sw),m1=pen*(w1/sw);
  if(m0>1e-9){
    Matter.Body.setPosition(h0.mb,{x:h0.mb.position.x+ux*m0,y:h0.mb.position.y+uy*m0});
    h0.x=h0.mb.position.x;h0.y=h0.mb.position.y;
    if(Matter.Sleeping)Matter.Sleeping.set(h0.mb,false);
  }
  if(m1>1e-9){
    Matter.Body.setPosition(h1.mb,{x:h1.mb.position.x-ux*m1,y:h1.mb.position.y-uy*m1});
    h1.x=h1.mb.position.x;h1.y=h1.mb.position.y;
    if(Matter.Sleeping)Matter.Sleeping.set(h1.mb,false);
  }
  return pen;
}
/*
 * ★R104-5 / R104-9 的下半段：松手那一刻的**速度**也要落在可行域里。
 *
 * 为什么（_diag_r104p 帧 70-88 实测）：位置收口（conDragConstrain）只跑在拖拽期，
 *   松手后没人再摆位，而 pointerup 会把手写通道的指针速度原样抛出去（3200px/s 量级
 *   ⇒ 注入 Matter 是 53px/帧）。约束随后每帧最多拉回 CON_DRAG_STEP=48px —— 位置修正
 *   与速度对拉，用户看到的就是松手后那一下「绳子拉出一根线 + 抖」：
 *   实测 d 126.7→78.7→37.7→24.0（峰值**全部**落在松手之后，拖拽期 d 全程 ≤1.2）。
 *
 * 做法：把速度**先投影到约束的可行方向**，而不是事后再拽回来。
 *   · 铰链（锚点必须停在销上）⇒ 只留绕销的转动分量：v := ω ẑ×r，ω=(r×v)/|r|²。
 *     丢掉的是径向分量 —— 那正是「锚点被拖离销」的那部分（与 R100① 杆端投影同一个式子）。
 *   · 轻绳（锚点到挂点距离必须 ≤ len）⇒ 只在**绷直且正在往外跑**时丢掉向外的径向分量；
 *     绳内松弛、向内收、切向摆，一概不碰（松弛态绳不管速度）。
 * 另一端可动时不介入：那种情形交给 conPull/conProj 的通道内机制。
 */
function releaseConstrainVel(B){
  if(!B||!B.mb||B.kind==='T')return false;
  var touched=false;
  for(var i=0;i<bodies.length;i++){
    var S=bodies[i];
    if(S.dead||S.kind!=='S'||(!S.rope&&!S.hinge)||!S.anc)continue;
    for(var j=0;j<2;j++){
      var a=S.anc[j],oh=S.anc[1-j];
      if(!a||a.B!==B)continue;
      if(!oh||!oh.B||oh.B===B)continue;
      if(!hostIsAnvil(oh.B))continue;
      var p=springAnchoredWorld(S,j),q=springAnchoredWorld(S,1-j);
      if(!p||!q)continue;
      var rx=p.x-q.x,ry=p.y-q.y,rl=Math.hypot(rx,ry);
      var O=oh.B;
      if(hostMovableByConstraint(O)){
        // ★另一端可动 ⇒ 速度也要「传过去」（与 conDragConstrain 的位置规则同一条纪律）。
        //   为什么不能指望 hingeSolve 的冲量投影（conProj）：它对**偏心**锚点算的
        //   k = 1/m + (r×n)²/I，销钉在 80px 方块的边中点上时 (r×n)²/I = 40²·0.0067 = 10.7，
        //   而 1/m 只有 0.14 —— 冲量 98% 都变成了自转，线性速度几乎没被改到，于是松手后
        //   拖拽端自己飞走、另一端原地不动（实测 F 组：ΔA=562 vs ΔB=292、d 冲到 46.3px）。
        //   铰链 = 刚性连杆 ⇒ 直接给另一端同速度（两端 ω 均为 0 时，销点速度自然相等）；
        //   绷直的绳 ⇒ 只把「正在分离」的径向相对速度补给它（切向不管，绳不该管切向）。
        if(S.hinge){
          O.vx=B.vx;O.vy=B.vy;
        }else{
          if(!(rl>(S.len||0)-0.5))continue;    // 松弛：绳不传速度
          if(!(rl>1e-6))continue;
          var ux2=rx/rl,uy2=ry/rl;
          var vrel=(B.vx||0)*ux2+(B.vy||0)*uy2-(((O.vx||0)*ux2+(O.vy||0)*uy2));
          if(!(vrel>0))continue;               // 没在分离 ⇒ 不动
          O.vx=(O.vx||0)+ux2*vrel;O.vy=(O.vy||0)+uy2*vrel;
        }
        if(O.mb&&MW){
          Matter.Body.setVelocity(O.mb,{x:(O.vx||0)/60,y:(O.vy||0)/60});
          Matter.Sleeping.set(O.mb,false);
        }
        touched=true;
        continue;
      }
      if(S.hinge){
        var rl2=rx*rx+ry*ry;
        if(rl2<1e-6)continue;
        var om=(rx*(B.vy||0)-ry*(B.vx||0))/rl2;
        B.vx=-om*ry;B.vy=om*rx;          // 只留绕销的切向速度
        touched=true;
      }else{
        var L=rl,len=S.len||0;
        if(!(L>len-0.5))continue;        // 松弛：绳不约束速度
        var ux=rx/L,uy=ry/L,vn=(B.vx||0)*ux+(B.vy||0)*uy;
        if(!(vn>0))continue;             // 不是在往外跑 ⇒ 不动
        B.vx-=ux*vn;B.vy-=uy*vn;
        touched=true;
      }
    }
  }
  if(touched&&B.mb&&MW){
    Matter.Body.setVelocity(B.mb,{x:B.vx/60,y:B.vy/60});
    Matter.Sleeping.set(B.mb,false);
  }
  return touched;
}
// 「另一端动不了」= 铁砧：静态 Matter 体 / 右键固定过 / 长度手柄正冻结。只有这种另一端
// 才让约束**唯一决定**拖拽端的位姿（见 conDragConstrain 的推导）。
function hostIsAnvil(h){
  if(!h||!h.mb)return true;
  /* ★R131-61：**正在被拖拽、位置归指针的那个体**在杆链求解里也要当"铁砧"
   *  （不许被约束搬走，否则指针权威被破坏）。由 rodDragPinChain 临时打标。 */
  if(h._dragPin)return true;
  if(h.mb.isStatic||h.fixed)return true;
  if(typeof rodLenFrozen==='function'&&rodLenFrozen(h))return true;
  return false;
}
// 「还能被约束搬动」= W 体（位姿归产品每帧摆放的**位置驱动**体，见 stepMatter 里 W 的分工），
// 且不是铁砧。只对 W 开这条路：非 W 的动体位置归 Matter 自己积分，产品直接写字段会被
// 下一帧的物理覆盖，等于制造第二个「互相追打」的写入者（就是 _diag_r104p 抓到的那个病）。
function hostMovableByConstraint(h){
  if(!h||!h.mb)return false;
  if(h.kind!=='W')return false;
  return !hostIsAnvil(h);
}
/*
 * ★★R104-4 / R104-5 / R104-9 的收口：拖拽期的权威摆放**先满足轻绳/铰链约束**。
 *
 * 为什么必须在这里、而且必须是「唯一解」而不是「分配」（_diag_r104p 把前两版都否掉了）：
 *   夹具 E（A 固定 80×80@240,300 + B 80×80@320,300，铰链销@280,300，重力关，拖 B 右移 360px）
 *   逐帧实测（本函数打点）：nS=1 hit=1 im=0.140 —— 它**每帧都在跑**、conPull 也拿到了
 *   全量修正（ret = 越界量），可是 dpost 恒 **大于** dpre（0→10.4、4.8→77.5、240.7→375.4），
 *   B.th 一路从 0° 转到 −72.6°，B.x 在 ±100px 之间来回跳，整段 dmax = 11681。
 *
 *   根因是**过约束**，不是「谁没吸收」：
 *     · 指针把「抓取 material 点」钉在世界某点（2 个方程）；
 *     · 销钉把「锚点 material 点」钉在另一个世界点（2 个方程）；
 *     · 刚体只有 3 个自由度（x,y,th）⇒ 4 个方程一般无解。
 *   无解时两个写入者只能互相追打：stepMatter 按指针摆一次、conPull 按销钉拉回来、
 *   下一帧指针又摆回去 —— 这就是极限环。**任何按质量分配的「平滑收敛」都不可能收敛**
 *   （分配只改变每步走多远，不改变方程组无解这件事）。
 *
 *   解法：删掉一个方程。另一端是铁砧时，销钉/挂点在世界系里**根本不动**，
 *   于是「锚点落在销上」这一条对 (x,y) 有**唯一解**（th 仍自由 ⇒ 被拖物体照样能绕销转，
 *   这正是铰链该有的样子）。所以这里做**精确投影**（不是限步收敛）：
 *     · 铰链：B.pos += (q − p)          ⇒ 锚点精确落到销上（d ≡ 0，drawHinge 再也不会画那两条臂）
 *     · 轻绳：越界时 B.pos −= v·(L−len)/L ⇒ 锚点精确落在半径 len 的圆上（绳不可伸长）；
 *              L ≤ len 时**一步都不碰** ⇒ 绳长以内指针完全说了算（松弛态自由拖）。
 *   投影只动 (x,y)，不动 th —— 与「全场比赛只有一个写者」兼容：改完就完，没有人来追打。
 *
 *   另一端可动（自由物体）时**不走这里**：那种情形方程组有解（两个物体共 4 个位置自由度
 *   ≥ 4 个方程），交给 conPull 按 1/m 分配 —— 拖一个，另一个同步跟着走（用户⑥ 的期望）。
 *
 * 调用点：stepMatter 里 W 体的每帧权威摆放（以及 pointermove 的同款分支）。
 * 返回 null = 没有约束需要投影；否则返回投影后的 {x,y}。
 */
function conDragConstrain(B){
  if(!B||!B.mb||B.kind==='T')return null;
  var moved=false;
  for(var i=0;i<bodies.length;i++){
    var S=bodies[i];
    if(S.dead||!S.anc)continue;
    // ★R107-1/2：**轻质杆（kind 'T'）也走同一条拖拽纪律** —— 它两端锚定时就是一根
    //   刚体连杆，漏了它就是用户看到的「拖快一点杆就变长 / 异常抖动」。
    var isS=(S.kind==='S'&&(S.rope||S.hinge));
    var isT=(S.kind==='T');
    if(!isS&&!isT)continue;
    for(var j=0;j<2;j++){
      var a=S.anc[j],oh=S.anc[1-j];
      if(!a||a.B!==B)continue;
      if(!oh||!oh.B)continue;                  // 只有一端锚定 ⇒ 自由端无载荷，不约束拖拽摆位
      if(oh.B===B)continue;                    // 两端都在被拖的物体上：没有「另一端」可言
      var p=springAnchoredWorld(S,j);          // 本端锚点（按**指针摆出来的**位姿算）
      var q=springAnchoredWorld(S,1-j);        // 另一端锚点
      if(!p||!q)continue;
      var dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);
      if(!(d>1e-6))continue;                   // 两端重合：方向未定，无从投影
      var need;
      if(isT){
        /* ★★R107-1/2（用户：「拖动其中一个物体，拉快一点就会导致杆变长，让另外
         *   一个物体垂到地上」）：轻质杆是**刚体连杆** ⇒ 与绳/铰链同一条拖拽纪律
         *   必须覆盖它，而且是**双向**的（拉长与压短都算越界）；目标长度取 `_rodL`
         *   （**有意设定**的那个数，见 rodSyncAnchors 双端分支的注释）。
         *   漏了这条的实测后果（_diag_r107a P5：A 固定 + 真鼠标抓自由方块上提 180px）：
         *   指针每帧把被抓方块的位姿**整份覆盖**，而杆的纠正每子步只还 24px
         *   且被覆盖 ⇒ 拖动期杆长在 120↔204 之间来回写（len 被写入 286 次）
         *   ＝用户看到的「异常抖动」。
         *   修法与下面既有的分配规则逐字同构：另一端可动 ⇒ 把它拉过来；
         *   另一端是铁砧 ⇒ 反向钳位拖拽端。位移量精确等于越界量
         *   ⇒ 本帧结束时 d 恒等于目标（不是「慢慢收敛」）。 */
        //   ★杆没有 e0/e1（它的几何真值是 x/th/len）⇒ **不能调 springSyncEnds**（会在
        //   springSetEnd 里读 undefined.e0）；杆的位姿由同一帧的子步 rodSyncAnchors 摆正。
        var tl=(S._rodL!=null&&S._rodL>0)?S._rodL:(S.len||170);
        need=d-tl;
        if(!(Math.abs(need)>1e-4))continue;    // 已满足（±1e-4）⇒ 指针说了算
      }else{
        need=S.hinge?d:(d-(S.len||0));         // 要缩短多少：铰链 ⇒ 全量；绳 ⇒ 只收越界量
        if(!(need>1e-4))continue;              // 铰链 d≈0 / 绳在长度以内 ⇒ 指针说了算
      }
      var ux=dx/d,uy=dy/d,mvx=ux*need,mvy=uy*need;
      // ★「谁能动，谁吸收」——两条分支其实是同一个位移量，只是施加在哪一侧：
      //   · 另一端可动 ⇒ 把它沿 p→q 拉过来 need ⇒ 拖一个、另一个**同步跟走**（用户⑥/R104-9）。
      //     位移量精确等于越界量 ⇒ 本帧结束时 d **恒等于** target，不是「慢慢收敛」。
      //   · 另一端是铁砧 ⇒ 反向施加在拖拽端上（钳位）⇒ 绳不可伸长 / 销钉刚性。
      //   为什么不能交给 conPull 分（_diag_r104p 帧 5-23 实测）：拖拽端的位姿下一帧会被
      //   指针整份覆盖，于是「分给拖拽端」的那一半等于白做，d 每帧残留一个越界量，
      //   实测拖拽期 dmax=46.6px（= CON_DRAG_STEP 的饱和值）——正是用户看到的「拉出一条线」。
      if(hostMovableByConstraint(oh.B)){
        var O=oh.B;
        O.x+=mvx;O.y+=mvy;
        if(O.mb){
          Matter.Body.setPosition(O.mb,{x:O.x,y:O.y});
          Matter.Sleeping.set(O.mb,false);
          /* ★★R111（用户：「杆连两个物体，提起一个，杆脱钩、整套系统不断抖动乱窜」）：
           *   曾在此把另一端的速度一并清掉（防「帧级瞬移+旧速度失配」的拉锯抖动）。
           *   ★★R131-7（用户：「抓住上面的物体，下面的杆和物体应该自由运动」）——**清速度退役**：
           *   实测（_probe_r131_who 栈定位 + _diag_r131b）：这每帧一次的 setVelocity(0,0)
           *   把可动端的**切向钟摆速度**也一并杀掉——B 的速度被钳在 ~25px/s 锯齿
           *   （rodSyncAnchors 每子步从 0 重建 −3→−29px/s，下一帧又被本处清零），
           *   6s 单调蠕行无一次过零；同场景 fixed 对照臂是真钟摆（327px/s、485↔664 震荡）。
           *   径向一致性现在由**每子步**的速度相位（R130f Ċ 投影）+ 位置相位守住，
           *   不再需要帧级清速度这种把摆动一起杀掉的手段。 */
        }
        if(!isT)springSyncEnds(S);
      }else if(hostIsAnvil(oh.B)){
        B.x-=mvx;B.y-=mvy;
        if(!isT)springSyncEnds(S);
      }else{
        continue;                              // 另一端是可动的非 W 体：位置归它自己的物理管，
      }                                        // 交给 hingeSolve/ropeSolve 的通道内机制
      moved=true;
    }
  }
  return moved?{x:B.x,y:B.y}:null;
}
// 轻绳：单边约束（见上方语义段）。ux/uy 由 d>len 那一刻的连线定；d≈0 时用上一帧稳定轴。
function ropeSolve(B,dt,h0,h1){
  // ★R105-5（先量后改：_diag_r105b 组 C）：**只有一端锚定**时也要守住「绳不可拉长」。
  //   用户：「轻绳也是如此，拖到高处不动，绳子会随着物体的下落而被拉长，不是说绳子不可
  //   被拉长吗」。实测（绳 len=200、一端锚在自由方块上、真鼠标抓绳身上提 140px 后停住 1.5s）：
  //   绳长稳在 **404.1px**（松手后仍是 404 —— 自由端再也没人管），正好是 len 的两倍。
  //   根因：本条早退把「一端锚定」整段让给了下面 stepSprings 的 R71③ 自由端跟随，
  //   而那套跟随只补**宿主位移的增量**，从不把已经拉长的部分收回来；拖拽期更是完全不跟。
  //   修法（与 R71③ 的分工一致）：不动宿主、不做冲量分配 —— **内力恒 0** 这条物理结论原样
  //   保留（自由端无质量、没有载荷可以反算），只做**纯几何**收口：d>len 时把自由端投影回
  //   「以锚定端为心、半径 len」的圆上。动的是无载荷的自由端 ⇒ 不可能给系统注入能量，
  //   也就不会碰 hostIsAnvil / conSide 那一整套「谁不能被约束改写」的纪律。
  if(!h0||!h1){
    var hA=h0||h1;
    if(hA&&B.rope){
      var kA=h0?0:1, fI=1-kA;                       // 锚定端索引 kA / 自由端索引 fI
      var pk=springAnchoredWorld(B,kA), fE=springEnd(B,fI), Lh=B.len||0;
      if(pk&&fE){
        var ddx=fE.x-pk.x,ddy=fE.y-pk.y,dl=Math.hypot(ddx,ddy);
        if(dl>Lh+0.01){                             // 只在**越界**时动手（松弛态自由端完全自由）
          springSetEnd(B,fI,pk.x+ddx/dl*Lh,pk.y+ddy/dl*Lh);
          refreshSpringGeom(B);
        }
      }
    }
    return;                          // 只有一端锚定 = 自由端无载荷 ⇒ 内力恒为 0（轻质元件通则）
  }
  var e0=B.e0,e1=B.e1;
  var dx=e1.x-e0.x,dy=e1.y-e0.y,d=Math.hypot(dx,dy);
  if(!(d>B.len+0.01))return;       // 松弛：轻绳零力，也不会把两端推开
  var ux,uy;
  if(d>1e-6){ux=dx/d;uy=dy/d;B._ax=ux;B._ay=uy;}
  else if(B._ax!=null){ux=B._ax;uy=B._ay;}
  else{ux=1;uy=0;}
  // ★R104-4：拖拽端也参与位移分配（allowGrab）+ 放开每帧步长 —— 见 conMov 的注释。
  //   只写作移动端（conSide 那条冲量纪律不动），所以「不跟指针抢速度」原样保留。
  conPull(h0,e0.x,e0.y,h1,e1.x,e1.y,B.len,CON_DRAG_STEP,true);   // 目标 = 绳长（不可伸长）
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,ux,uy,true);
  springSyncEnds(B);               // 宿主已移动 ⇒ 端点/几何重算（与弹簧触底块同一手法）
}
// 光滑铰链：双边约束 —— 两锚点必须重合；相对转动**不再完全放任**（R103-8 加折角限位）。
// 二维投影用**世界轴** x̂/ŷ 各做一遍：d≈0 时「分离方向」本身是退化的，世界轴不退化。
// ★★R105-1 机制②（用户：「那个铰链连接两个物体后，还是不断抖动，而且还穿模了（小框旋转时嵌进大框）」）
// ---- 绕销展开：把互埋的两个宿主**绕销转开**（纯旋转 ⇒ 销一丝不动）--------------------------------
// 为什么必须是「绕销旋转」这把工具（三把尺子依次钉出来的，别用「平移」再试一次）：
//   ① _tmp_r105m 帧内埋点（同夹具同会话，基线，读数=帧边界/渲染口径）把帧循环读死了：
//        帧末（**用户所见**）      dep = 26.657px   d = 0.000px
//        Matter 4 个子步之后       dep =  0.006px   B 被顶出去 26.6px   ← 接触解算一直是有效的
//        下一帧 conPull 之前        d   = 26.795px
//        conPull 之后             dep = 26.657px   d = 0.000px        ← 平移回销 26.6px，把角**重新插进**大框
//      即：Matter 每帧把 B 顶出去（有效），conPull 每帧又把它平移回销上（销恒精确 d=0），
//      代价是把角重新插进大框。渲染取的是后者 ⇒ 用户看到 26.6px 穿模。
//   ② _diag_r105k 证明「平移」只能二选一：平移回销 ⇒ 穿透 31.5px **且 d=0**；
//      让 Matter 顶出去（销修正搬到子步前）⇒ 穿透 0.9px **但 d=30.4px**。两者不可兼得。
//   ③ 同时满足两者的**唯一**几何动作是绕销的纯旋转：销就是旋转中心，旋转天然不破坏销；
//      而它恰好能把「插进去的那个角」转出来。_diag_r105o C 组实测（同一夹具）：
//      穿透 31.47 → **0.288px**、销误差仍 **0**、帧边界抖动 |Δx|=|Δθ|=**0**、
//      B 停在 0.0152rad —— 正是「光滑铰链被对方挡住」该有的样子。
// 算法（三步，缺一不可）：
//   ① 方向：一次 0.004rad 小步探测，只有「使深度变小」的那个方向才是解；两个方向都不改善 ⇒ 直接放弃
//      （这一条同时挡住了「面贴面静置」这类不该管的接触）。
//   ② 步长：牛顿式 **Δθ = depth / R**，其中 R 取「可动宿主的**最远顶点**到销的距离」（不是接触点！）。
//      为什么不能用接触点距离 r_support（第一版就是它，被 _tmp_r105r 当场打红）：绕销转过 Δθ 时，
//      最深那一点沿 MTV 法线移动的弧长 ≤ R·Δθ ⇒ 要消掉 depth 至少需要 Δθ ≥ depth/R。
//      用 R ⇒ **欠转**（永远不到界外），用 r_support ⇒ 可能**过转**：一旦转过头，那个角就离开 A 了，
//      深度照样是 0、「已收敛」判成立，于是这一笔过转被永久留下 —— 逐帧累积就是**凭空自转**
//      （实测：拐角锚定构型 157 帧累积到 −π/2 rad；给 B 注入 ±90rad/s 自转时被整份吃掉）。
//      欠转则单调收敛（每步剩 (1−r_true/R)·depth，实测 5~6 步进 0.15px），绝不会留下过转量。
//      另一条不能瞎走的理由：本类构型（销在宿主的碰撞面上、被铰件的边与对方的面近共线）
//      **可行角窗极窄** —— 两个旋转方向各会把一个角插进去，只有 |θ| ≤ atan(BND_INK/半边长)
//      那一小段（本夹具 ≈2°）可行。_diag_r105n 用「倍增大步长」搜索，158 次里 **151 次跨过了
//      这条 2° 的缝**（stuck），读数全错。
//   ③ 非弹性挡块：展开方向定下后，掐掉「继续往互埋方向转」的角速度（与 hingeFoldLimit 的
//      hingeKillOutwardTangential 同一语义），否则下一帧又转进去。
// 守卫（三条，都不许省）：
//   · 只对**两个 W 宿主**做：字母刚体没有 Matter 体、杆是运动学镜像、弹簧/绳另有语义；
//   · 只在两者**真的会互相碰撞**时做（同组豁免 —— 弹簧宿主组 / 含杆端的铰链组，见 springSyncGroups）；
//   · `hfix`（固定铰链=刚接）开着时跳过：那时两宿主的相对姿态归 hingeFoldLimit 管，
//     再叠一层展开就是两个写者互相追打。
// ★★阈值必须是「屏幕上看得见」的尺度，不能拍脑袋取小值（R105-1 回归事故，_diag_r105t 实测）——
//   本函数的宿主是 **W 体**，而 W 体的碰撞几何 = 墨迹中线**外扩 BND_INK=2.325px**。于是
//   **两个 W 体的墨线刚好相切**时，Matter 量到的深度恰好是 **2·BND_INK = 4.65px**——
//   这 4.65px 是纯粹的量尺口径，屏幕上一点重叠都看不见。
//   第一版取了 0.15px（为了让 pair1 的稳态残留压到 0.09px，读数好看），结果把「任何两个
//   近贴着的 W 宿主」都当成了要展开的穿透：core 回归三套红（_probe_r101 I7 载荷自由转动
//   171° → **2.6°**、_probe_r102 D1 双击解不开铰链、_probe_r104 F2 拖一个另一个不跟走）。
//   实测（I3 夹具，A 墨线底 278 / B 墨线顶 282，留 4px 空隙）：碰撞体**天生重叠 0.650px**、
//   全程入口深度 0.65~0.95px，152/152 帧进入循环、95 帧真的绕销转了 —— 绕销方向恰好与
//   B 的自然摆动相反 ⇒ 展开变成一根每帧反向 0.93° 的角弹簧，把铰链**焊死**（跨度 2.6°）。
//   阈值抬到 5px 之后：同一夹具 over=0、跨度恢复 173.4°（与「展开整体关掉」的 173.4° 一致），
//   而用户报的真穿透（26.6~36.6px）仍然照修。
//   ⇒ 阈值的取法（两轮实测夹出来的，别只按「可见性」拍）：
//     **下端** = 合法接触构型的天然残差上界。两个 W 宿主「墨线留 4px 空隙」地邻接时，
//              碰撞多边形天生重叠 0.65px；_diag_r105t 的 I3 夹具全程入口深度 0.65~**0.97px**。
//     **上端** = 真互埋的规模。用户报的构型是 **26.6~36.6px**；而铰链把两端**强制对压**时
//              Matter 自己也能顶到 **4.4px**（pair1，_diag_r105q）——那已经是需要动手的量，
//              因为不动手时帧边界 θ 会抖 6.6°/帧、并缓慢「边转边嵌」（漂移 0.19rad）。
//     取 **2.0px**：对下端的 0.97px 留 2.06× 余量（不进 = 不误伤自由转动），
//                 对上端的 4.4px 留 2.2× 余量（进来 = 每帧都把账还掉）。
//   ⚠ 别按「2·BND_INK=4.65px 才是墨线相切」去取 5px（试过，_diag_r105q 当场面红）：
//     残差会停在 Matter 的挤压平衡 4.417px —— **恰好坐在门口**，展开于是时进时出，
//     帧边界 |Δθ| 从 0.0016rad 劣化到 **0.1147rad（6.6°/帧）**，正是用户报的「不断抖动」。
var HINGE_UF_EPS=2.0;        // **该不该管**（px）：见上面的两端夹逼
// 退出阈值（**修到什么程度**）—— 这两个问题必须分开，第一版把它们混成一个常量，于是为了把残差
// 压到 0.09px 就把「进入门」也压到 0.15px，直接撞上「合法邻接构型的天然残差 0.65~0.97px」而
// 误伤自由转动（_diag_r105t：I3 夹具 152/152 帧进入、95 帧真的绕销转 0.93°/帧，与载荷的自然
// 摆动方向相反 ⇒ 铰链被焊死，转角跨度 172.1°→2.6°）。分开之后：合法接触**进不来**，
// 一旦真的进来（4.4~36.6px），牛顿步仍然把残差收到亚像素（≈0.18px）。
var HINGE_UF_DONE=0.2;       // 迭代停止阈值（px）
var HINGE_UF_PROBE=0.004;    // 方向探测步长（rad）
var HINGE_UF_MAXDTH=0.35;    // 牛顿单步限幅（rad）
var HINGE_UF_IT=14;          // 牛顿迭代上限（欠转 ⇒ 需要多几步；实测 5~6 步收敛）
function hingePairCollision(a,b){
  if(!a||!b)return null;
  if(typeof Matter==='undefined'||!Matter.Collision||!Matter.Collision.collides)return null;
  try{var c=Matter.Collision.collides(a,b);return (c&&c.collided&&c.depth>0)?c:null;}catch(e){return null;}
}
function hingePairDepth(a,b){var c=hingePairCollision(a,b);return c?c.depth:0;}
function hingeHostsCanCollide(h0,h1){
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b)return false;
  try{
    if(Matter.Detector&&Matter.Detector.canCollide)
      return !!Matter.Detector.canCollide(a.collisionFilter,b.collisionFilter);
  }catch(e){}
  return true;
}
// 宿主顶点里离销最远的那一个的距离（= 上面 ② 里 R 的取法：取**上界**才能保证欠转）
function hingeMaxVertexRadius(mb,px,py){
  if(!mb||!mb.vertices||!mb.vertices.length)return 0;
  var r=0,i,v,dd;
  for(i=0;i<mb.vertices.length;i++){
    v=mb.vertices[i];
    dd=Math.hypot(v.x-px,v.y-py);
    if(dd>r)r=dd;
  }
  return r;
}
function hingeContactUnfold(B,h0,h1,dPre){
  if(!B||!h0||!h1)return 0;
  if(h0.kind!=='W'||h1.kind!=='W')return 0;                 // 守卫：只认两个 W 宿主
  if(B.param&&B.param.hfix)return 0;                        // 守卫：固定铰链开着时归 hingeFoldLimit 管
  var a=h0.mb,b=h1.mb;
  if(!a||!b)return 0;
  if(a.isStatic&&b.isStatic)return 0;
  if(!hingeHostsCanCollide(h0,h1))return 0;
  var d0=hingePairDepth(a,b);
  if(!(d0>HINGE_UF_EPS))return 0;
  /* ★★R107-4（用户：「这两个方块就会不断在接触面卡，不断抖动 … 到了边界卡住的
   *   角度不应该就是卡在那里不动吗，怎么还会不断回退卡」）：本函数的契约是
   *   「把 conPull 这一笔**平移回销**插进去的那个角还掉」（见上方 R105-1 机制②：
   *   conPull 平移 26.6px 回销的同时把互埋的角又插了回去，穿透 0.006→26.657）。
   *   但它之前**只问绝对深度**、不问这份深度是谁造成的 ⇒ 两个宿主**重力下静置压合**时
   *   （深度天生 > HINGE_UF_EPS，那是支撑而不是干涉）它也每帧把对方转开 ⇒ 重力又压回来
   *   ⇒ **两者互推 = 极限环**（用户看到的「不断回退卡」）。
   *   实测（_diag_r107b）：Q4 真手势把两方块对折到 90° 面贴面后，稳态位置峰峰
   *   **0.63px**、角度峰峰 0.0012rad；Q3（销锚在地面上，方块自然压在地面）
   *   更是 **10.8° / 13.4px / 42.9px·s⁻¹** 持续晃。
   *   修法：把本帧 conPull **之前**的深度 dPre 传进来，**只在深度确实被这一笔平移增大了**时才展开
   *   —— 静置压合时 conPull 不平移 ⇒ d0≈dPre ⇒ 不展开 ⇒ 极限环消失；
   *   真存在互埋（拖拽/初始构型）时 conPull 每帧都在平移 ⇒ d0>dPre ⇒ 照旧每帧还账。
   *   阈值 0.5px：留给求解器的帧间噪声（实测的合法邻接残差是 0.65~0.97px，
   *   而它们本来就进不了上面那道 2.0px 的门）。 */
  if(dPre!=null&&!(d0>dPre+0.5))return 0;
  var i0=a.isStatic?0:(a.inverseMass||0),i1=b.isStatic?0:(b.inverseMass||0);
  var Wm=i0+i1;
  if(!(Wm>0))return 0;
  // ★宿主位姿回写：springAnchoredWorld 读的是**产品字段 h.th**，而 Matter.Body.rotate 只改 mb.angle。
  //   漏掉这条 ⇒ 随后的 springSyncEnds 会拿**过期角度**重算锚点（_diag_r105n 的发散就是它）。
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;             // 销（conPull 之后两端已重合）
  var rot=function(s){
    if(i0)Matter.Body.rotate(a,-s*i0/Wm,{x:px,y:py});
    if(i1)Matter.Body.rotate(b, s*i1/Wm,{x:px,y:py});
  };
  // ① 方向探测
  rot(HINGE_UF_PROBE);  var dp=hingePairDepth(a,b); rot(-HINGE_UF_PROBE);
  rot(-HINGE_UF_PROBE); var dm=hingePairDepth(a,b); rot(HINGE_UF_PROBE);
  var sgn=0;
  if(dp<d0)sgn=1; else if(dm<d0)sgn=-1; else return 0;
  // ② 欠转牛顿步：Δθ = depth / R（R = 可动宿主最远顶点到销的距离，按 1/m 加权）
  var Rsum=(i0?hingeMaxVertexRadius(a,px,py)*i0:0)+(i1?hingeMaxVertexRadius(b,px,py)*i1:0);
  var R=Rsum/Wm;
  if(!(R>1))R=Math.max(1,Wm>0?(1/Wm):1);
  var applied=0,last=d0,ok=false;
  for(var it=0;it<HINGE_UF_IT;it++){
    var c=hingePairCollision(a,b);
    if(!c||!(c.depth>HINGE_UF_DONE)){ok=true;break;}         // 退出阈值（≠ 进入阈值，见常量注释）
    var dth=c.depth/R; if(dth>HINGE_UF_MAXDTH)dth=HINGE_UF_MAXDTH;
    var before=c.depth;
    rot(sgn*dth); applied+=dth;
    var nd=hingePairDepth(a,b);
    if(!(nd>HINGE_UF_DONE)){ok=true;break;}
    if(!(nd<before-1e-9))break;                              // 不再改善 ⇒ 这条方向解不出来
    last=nd;
  }
  if(applied>0&&!(ok||last<d0-1e-9)){                         // 净效果没变好 ⇒ 整笔撤销，不留半吊子姿态
    rot(-sgn*applied); applied=0;
    if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
    if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
    return 0;
  }
  if(h0.mb){h0.x=a.position.x;h0.y=a.position.y;h0.th=a.angle;}
  if(h1.mb){h1.x=b.position.x;h1.y=b.position.y;h1.th=b.angle;}
  // ③ 非弹性挡块（a 被转 −s·i0/W、b 被转 +s·i1/W ⇒ 两者的「互埋方向」符号相反）
  if(i1&&(b.angularVelocity||0)*sgn<0)Matter.Body.setAngularVelocity(b,0);
  if(i0&&(a.angularVelocity||0)*sgn>0)Matter.Body.setAngularVelocity(a,0);
  return applied;
}
/* ★★★R107-5（M1）：用**真正的 Matter.Constraint 来当铰链销**。
 * Matter 官方文档（Matter.Constraint）原文：
 *   to simulate a revolute constraint (or pin joint) set length: 0 and a high stiffness
 *   value (e.g. 0.7 or above). If the constraint is unstable, try lowering the stiffness
 *   value and/or increasing engine.constraintIterations.
 * 关键不在参数，而在**求解器跑在哪里**：Matter 的 Constraint 跑在它自己的求解循环里
 * （Gauss-Seidel、constraintIterations 次迭代、用 body.constraintImpulse 记账、直接改
 * position/positionPrev）⇒ **与碰撞解算器同一轮迭代，天然不打架**。
 * 而本项目原先把铰链重新发明成产品级的 hingeSolve
 * （conPull 平移 + hingeContactUnfold 绕销转），**跑在 Matter 求解循环之外**、每帧才补一次
 * ⇒ 与碰撞/重力互相追打 ⇒ **自维持极限环** —— 这就是「铰链老是出问题」的
 * 架构性根因；入口类守卫（dPre / 销孔门 / 退出阈值 / 跳 conPull）全部试过并被否。
 * ★只在**双端都锚上、且至少一端可动**时挂；这种情形下才把 conPull/unfold 让位。 */
/* ★R107-5 M2：实测 0.7 会留下 0.0064rad（0.37°）的残偷抖（_diag_r107b Q1b）。
 *   Nature of Code 对 length:0 的原话：「With a length of 0, it needs a **stiffness of 1**;」
 *   ★并且只在真挂上时把 `constraintIterations` 提到 6（官方文档给的
 *   第一手段：「If the constraint is unstable, try ... increasing engine.constraintIterations」）。 */
var HINGE_CON_STIFF=1;
var HINGE_CON_ITER=2;   // (b) 二分法：回到默认迭代数
function hingeConstraintDrop(B){
  /* ★R132-9g：解绑时把宿主标记一起清掉（否则那个体会永远豁免 ω 重建）。 */
  if(B&&B._hconH){for(var qi=0;qi<B._hconH.length;qi++){if(B._hconH[qi])B._hconH[qi]._hconOn=false;}B._hconH=null;}
  if(B&&B._hcon){
    try{Matter.Composite.remove(MW.engine.world,B._hcon);}catch(e){}
    B._hcon=null;
  }
}
function hingeConstraintSync(B,h0,h1){
  if(MW&&MW.engine&&MW.engine.constraintIterations!==HINGE_CON_ITER)
    MW.engine.constraintIterations=HINGE_CON_ITER;
  if(!B){return null;}
  var a=h0&&h0.mb,b=h1&&h1.mb;
  if(!a||!b||(a.isStatic&&b.isStatic)){hingeConstraintDrop(B);return null;}
  /* ★R107-5（修正 r104 的低频 flaky）：**拖拽期让 Constraint 退场**。
   *   拖拽期的位姿权威在 `conDragConstrain`（R104 定下的纪律：「拖拽端在约束里
   *   永远是权威」）。拖一端时再挂上 Constraint，等于给同一个位姿安了**第三个演员**
   *   ⇒ 实测（_diag：r104 的 `F|F2 另一个物体同步跟走`）会抽风式翻车（~1/3）。
   *   ★这不影响静态（用户图 D1 那类构型）—— 那里没人在拖。 */
  if(grab&&grab.kind==='body'&&grab.obj&&(grab.obj===h0||grab.obj===h1)){hingeConstraintDrop(B);return null;}
  var w0=springAnchoredWorld(B,0),w1=springAnchoredWorld(B,1);
  if(!w0||!w1){hingeConstraintDrop(B);return null;}
  var pa={x:w0.x-h0.x,y:w0.y-h0.y},pb={x:w1.x-h1.x,y:w1.y-h1.y};
  var C=B._hcon;
  if(!C){
    /* ★★R132-9g：给两个宿主打上「被独立铰链钉住」的标记 —— 供下面 velocity 重建豁免用。
     *  录制证据（rec_2026-10-01-15-02-20.json）：被铰链钉住的板 5s 只转了 0.0085 rad。 */
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];
    C=Matter.Constraint.create({bodyA:a,pointA:pa,bodyB:b,pointB:pb,
                                length:0,stiffness:HINGE_CON_STIFF,damping:0.1});
    Matter.Composite.add(MW.engine.world,C);
    B._hcon=C;
  }else{
    C.bodyA=a;C.bodyB=b;C.pointA=pa;C.pointB=pb;C.length=0;C.stiffness=HINGE_CON_STIFF;
    h0._hconOn=true;h1._hconOn=true;B._hconH=[h0,h1];   // ★R132-9g
  }
  return C;
}
function hingeSolve(B,dt,h0,h1){
  /* ★★R109（边界排查抓到的泄漏）：**只要铰链不再是「双端都锚上」，就必须把真 Constraint 摘掉**。
   *   原因：一个宿主被删掉 / 失效时，`springSyncEnds` 会把 `anc[i]` 清成 null，
   *   于是本函数在第一行就 return 了 ⇒ `hingeConstraintSync`（唯一摘除点）**永远跑不到**，
   *   那条 Matter.Constraint 就留在世界里把两个体**隐形地永久钉住**。
   *   实测（_diag_r109 H2）：删掉一个宿主后世界约束数 1 → 1（该回落到 0）。 */
  if(!h0||!h1){hingeConstraintDrop(B);return;}
  var e0=B.e0,e1=B.e1;
  // ★R104-5 / R104-9：铰链是**销钉**，两锚点必须重合 —— 硬约束。
  //   原先 conPull 对「拖拽端 + 铁砧」是无解（w0=w1=0）⇒ d 涨到 368px ⇒ drawHinge 画出
  //   368px 的两条细臂 = 用户⑤ 看到的「脱离了还拖一根线」。修法见 conMov：让拖拽端也按 1/m
  //   参与位移分配（只开**位置**通道，冲量通道照旧不动）。
  var _hingeDPre=hingePairDepth(h0&&h0.mb,h1&&h1.mb);   // ★R107-4：这笔平移**之前**的深度
  /* ★R107-5 M1：真 Constraint 已把销持住 ⇒ **产品级 conPull 必须让位**
   *   （两个解算器抢同一个位姿 = 回到过去那个互相追打的病）；
   *   挂不了 Constraint（只锚一端 / 两端都是铁砧）时保留原行为。 */
  var _hCon=hingeConstraintSync(B,h0,h1);
  /* ★R107-5：**conPull 照常跑**。实测（三套回归 + _diag_r107c）：真 Constraint 与",
   *   conPull 的**目标是同一个**（两锚点重合）⇒ 它们不打架；",
   *   把 conPull 关掉反而会打红 r101/r103/r104（它们依赖 conPull 的旧契约）。 */
  conPull(h0,e0.x,e0.y,h1,e1.x,e1.y,0,CON_DRAG_STEP,true);      // 目标 = 0（两锚点重合）
  // ★R105-1 机制②：上面这一笔「平移回销」的代价，是把互埋的那个角**重新插进**对方
  //   （_tmp_r105m 帧内实测：conPull 把 B 平移 26.6px 回去，穿透同时从 0.006px 回到 26.657px）。
  //   立刻用「绕销旋转」把这笔账还掉 —— 旋转不破坏销（销就是旋转中心），却正好把角转出来。
  springSyncEnds(B);                 // 让 e0/e1 落在平移后的真实锚点上（= 销），展开要绕它转
  /* ★R107-5：**unfold 也照常跑**。这是本轮最反直觉的一条：原以为「销被真 Constraint 托住了",
   *   ⇒ unfold 应该让位」，但实测（r104 跑三次）：让它让位反而把 r104 变成 **flaky**（PASS/FAILS:21），",
   *   而**让它照常跑 ⇒ r104 3/3 稳定 PASS、D1 仍然 0.735px**（改前 272px）。",
   *   原因：原来的极限环是 unfold 在与**产品级 conPull**抢位姿；现在销由 Matter 自己的",
   *   求解循环托住 ⇒ unfold 不再自激。★**改动因此缩到最小：只多挂一条 Constraint**。 */
  hingeContactUnfold(B,h0,h1,_hingeDPre);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,1,0,false);
  conProj(h0,e0.x,e0.y,h1,e1.x,e1.y,0,1,false);
  hingeFoldLimit(B,h0,h1);                                // R103-8：折角限位
  springSyncEnds(B);
}
// ★R103-8 复盘：曾经加过「卡死门」（两宿主几何互埋 >1.5px 时铰链让位给 Matter 接触），
//   但变异测试证明它是**冗余的**（M8 关掉后探针全绿）—— 楔死的真正根因是
//   springSyncGroups 把铰链两宿主塞进了同一个 −2 组（互不碰撞），根修之后接触解算
//   自己就能顶住折叠穿透。按「抓不住的判据 = 噪声」纪律整段删除（INVARIANTS §30.2）。
// ---- R103-8 折角限位 --------------------------------------------------------------------
// 折角 fold = atan2(销→宿主1中心) − atan2(销→宿主0中心)。捕获时机 = 两端都锚上那一刻
// （springTryAnchor / springTryAnchorByHost），限位判「相对连接那一刻的偏差 |Δfold|」。
// 越限时把两个宿主**绕销**转回去（绕销旋转不动销本身 ⇒ 位置约束不被破坏）：
//   a0 = −exc·i0/W、a1 = +exc·i1/W（i = 可动体的反质量，static 反质量 0）
//   ⇒ Δfold = a1 − a0 = exc·(i0+i1)/W = exc 精确归位，且重的一侧转得少、铁砧不转。
function hingeCaptureFold(B){
  if(!B.anc[0]||!B.anc[1]||!B.anc[0].B||!B.anc[1].B){B._hFold0=null;return;}
  var h0=B.anc[0].B,h1=B.anc[1].B;
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  B._hFold0=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
}
function hingeRotateAboutPin(h,ang,px,py){
  if(!ang||!h.mb||h.mb.isStatic)return;
  Matter.Body.rotate(h.mb,ang,{x:px,y:py});
  h.x=h.mb.position.x;h.y=h.mb.position.y;      // 同帧后续求解/渲染读的是字段
  h.th=(h.th||0)+ang;
}
// ★非弹性挡块（_probe_r103 G6 边界实测）：限位只回转位置、不处理速度的话，宿主带着
//   残余切向速度（实测 ~110px/s）下一帧又冲出限位 —— 位置修正与速度互斗，把锚点
//   拽滑（销→心距 26→10.1）。把「继续往超限方向转」的切向分量消掉 = 挡块语义
//   （像碰到止动销：法向速度清零、切向保留）。sign=+1 管 fold 增方向（h1 侧），
//   −1 管 fold 减方向（h0 侧，fold=ang1−ang0）。
function hingeKillOutwardTangential(h,px,py,sign){
  if(!h||!h.mb||h.mb.isStatic)return;
  var rx=h.x-px,ry=h.y-py,r=Math.hypot(rx,ry);
  if(!(r>1e-3))return;
  var tx=-ry/r,ty=rx/r;                          // ang 增大方向的切向单位向量
  var v=h.mb.velocity||{x:0,y:0};
  var vt=v.x*tx+v.y*ty;
  if(!(vt*sign>0))return;                        // 不是往超限方向 ⇒ 不动
  Matter.Body.setVelocity(h.mb,{x:v.x-tx*vt,y:v.y-ty*vt});
}
function hingeFoldLimit(B,h0,h1){
  // ★R105-6：本函数现在由**固定铰链开关**驱动，不再是「限位角」这个可调角度。
  //   关闭（默认）= 完全光滑：相对转动不受限 ⇒ 一步都不做（这正是旧语义里 lim=180° 那条早退）。
  //   开启 = 刚接：lim 取 0 ⇒ 折角被冻结在基准构型上，两侧绕销转回来 + 掐掉继续超限的切向速度。
  var fixed=!!(B.param&&B.param.hfix);
  if(!fixed)return;
  var hl=0;
  var lim=hl*Math.PI/180;
  if(lim>=Math.PI*0.999)return;                 // 180° = 不限位（旧「完全光滑」语义）
  // ★R103-8 闭合门（_probe_r101 I1 回归根因）：铰链**没钉合成销**（两端还分开着）时
  //   「销→两宿主中心的折角」没有物理意义 —— 基准折角是按「拉伸构型」捕的，conPull 一边
  //   往回收、限位一边按拉伸期的基准转回去，两边打架的稳态就是**不收敛**
  //   （实测 I1：初态 40px 的两端卡在 d=28.6 不再靠近）。所以：d>HINGE_FOLD_DMAX 时
  //   限位整体跳过，并作废基准 —— 等第一帧真正闭合时按**闭合构型**重新捕获。
  var d0=Math.hypot(B.e1.x-B.e0.x,B.e1.y-B.e0.y);
  if(d0>HINGE_FOLD_DMAX){B._hFold0=null;return;}
  if(B._hFold0==null)hingeCaptureFold(B);
  if(B._hFold0==null)return;                    // 退化解（宿主中心压在销上）⇒ 放弃限位
  var px=(B.e0.x+B.e1.x)/2,py=(B.e0.y+B.e1.y)/2;
  var f=Math.atan2(h1.y-py,h1.x-px)-Math.atan2(h0.y-py,h0.x-px);
  var d=shortAng(f-B._hFold0);
  var over=Math.abs(d)-lim;
  if(!(over>0.001))return;
  var exc=-((d>0)?1:-1)*over;
  // ★R103-6 复测（_probe_r103 G6 倒挂摆放实测）：一次性大角度回转 = **传送** —— 大偏差
  //   一步转回时锚点瞬滑（实测销→心距从 26 掉到 14.8）。按子步限步渐进（与 conPull 的
  //   CON_MAXSTEP 同哲学）：每步最多转 HINGE_FOLD_STEP，大偏差在几帧内收敛，锚点不失守。
  var step=HINGE_FOLD_STEP;
  if(exc>step)exc=step;else if(exc<-step)exc=-step;
  var i0=(h0.mb&&!h0.mb.isStatic)?1/(h0.mass||1):0;
  var i1=(h1.mb&&!h1.mb.isStatic)?1/(h1.mass||1):0;
  var W=i0+i1;
  if(!(W>0))return;                             // 两端都是铁砧：限位没意义
  hingeRotateAboutPin(h0,-exc*i0/W,px,py);
  hingeRotateAboutPin(h1, exc*i1/W,px,py);
  // 非弹性挡块：消掉「继续超限」的切向速度（见 hingeKillOutwardTangential 注释）
  hingeKillOutwardTangential(h1,px,py,1);
  hingeKillOutwardTangential(h0,px,py,-1);
}
// ---- 渲染（外观没有诚实的机器判据，交给 1× 截图 + 人眼，见 §30.2）----------------------
// 轻绳：一条比杆更细的墨线；**松弛时下垂**（松弛量越大垂得越深）。
// 为什么可以这样画：轻绳无质量 ⇒ 松弛时绳形在静力学上是**不定的**（没有自重就没有悬链线），
// 下垂只是「绳是软的」这一条的惯用画法；绷直（d ≥ len）时画直线。
// ★R104-2：第二个实参 extraSlack 是**纯渲染**的附加垂度（px，默认 0），只给落点虚影用 ——
//   同一份画线代码、同一条下垂弧分支，所以「虚影所见 = 松手所得」仍是结构性成立的
//   （虚影要的是「这是一根绳」的图示；产品绳在静置时绷直、按 J2 必须画直线）。
function drawRope(B,extraSlack){
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var dx=x1-x0,dy=y1-y0,L=Math.hypot(dx,dy)||1;
  var slack=Math.max(0,B.len-L)+(extraSlack>0?extraSlack:0);
  var col='rgba(38,34,28,0.85)';
  cvx.strokeStyle=col;cvx.lineWidth=1.7;cvx.lineJoin='round';cvx.lineCap='round';
  cvx.beginPath();
  cvx.moveTo(x0,y0);
  if(B.nodes&&B.nodes.length){
    // ★R131：柔性绳 —— 真实链形状（含阻断/耷拉/搭在物体上），不再用抛物线化装
    // ★R131-8b（用户：「还是一段一段的，并不是以前那样像真实的绳子」）：节点直连 lineTo
    //   在 110px 绳只有 4 段时，任何垂度都读成「几段折线」。改成**过相邻中点的二次曲线**
    //   （经典折线平滑）：每个节点只当控制点、曲线过所有段中点 ⇒ 直绳时控制点共线、画的
    //   仍是直线；松弛时是光滑垂弧；遮挡/搭在物体上的形状仍忠实于链（只平滑、不改点）。
    var rp=[[x0,y0]];
    for(var rn=0;rn<B.nodes.length;rn++)rp.push([B.nodes[rn].x,B.nodes[rn].y]);
    rp.push([x1,y1]);
    cvx.moveTo(rp[0][0],rp[0][1]);
    for(var rs=1;rs<rp.length-1;rs++){
      var rmx=(rp[rs][0]+rp[rs+1][0])/2,rmy=(rp[rs][1]+rp[rs+1][1])/2;
      cvx.quadraticCurveTo(rp[rs][0],rp[rs][1],rmx,rmy);
    }
    cvx.lineTo(x1,y1);
  }else if(slack>0.5){
    var sag=Math.min(slack*0.55,90);        // 垂度上限：太长的绳不画成一口深井
    cvx.quadraticCurveTo((x0+x1)/2,(y0+y1)/2+sag,x1,y1);
  }else{
    cvx.lineTo(x1,y1);
  }
  cvx.stroke();
  cvx.fillStyle=col;
  for(var a=0;a<2;a++){
    if(!B.anc[a])continue;                  // 只有拴住的一端才画锚点（与弹簧同一口径）
    cvx.beginPath();cvx.arc(a?x1:x0,a?y1:y0,3.6,0,6.2832);cvx.fill();
  }
}
// 光滑铰链：一个**销钉**（实心小圆 + 外圈）；两锚点还没重合时（拖拽中/瞬态）用两条细臂
// 连到各自的锚点，让「谁连在哪儿」看得见。
// ★R103-7（用户：「铰链脱离物体还用一根线与物体连接」）：细臂只在**两端都有锚**时画
//   —— 双锚期间 d>1.5 是拖拽/收敛瞬态，画臂是诚实的；有一端没锚时，自由端的 e 是
//   上一帧的陈迹（没人再同步它），画到陈迹上就是用户看到的「脱离了还拖一根线」。
//   单锚/无锚时销心取**有锚端**的位置（e0 同步自宿主，是唯一诚实的坐标）。
function drawHinge(B){
  // ★R103-6 复盘：曾把「双臂」收紧成双锚才画（E8），回归证明它破坏了 R101 的
  //   渲染契约（_diag_r101h J4 用桩对象 anc=[null,null] 验证「分开画臂」—— 桩没有锚），
  //   而且 R103-7「脱开还拖一根线」的真正修复是**刚性收敛**（conPull/conProj，C/C2 组），
  //   不在这里。回退 E8：d>1.5 画双臂，销画在中点 —— 与 R101 语义一致。
  var x0=B.e0.x,y0=B.e0.y,x1=B.e1.x,y1=B.e1.y;
  var cx=(x0+x1)/2,cy=(y0+y1)/2;
  var col='rgba(38,34,28,0.85)';
  // ★R104-5（用户：「铰链连接物体后…怎么铰链脱离物体还用一根线与物体连接？」）：
  //   细臂只在**至少有一端还没锚上**时画。理由：两端都锚住的铰链，它的语义就是
  //   「两锚点重合」（hingeSolve 的硬约束），此刻画面上量到的 d>1.5 只可能是求解滞后
  //   或宿主被别的东西顶开 —— 那是**瞬态**，把它画成一条横贯屏幕的长臂，用户读到的就是
  //   「铰链脱开了还拖着一根线」。半连接状态（只有一端锚上）才需要这条臂来交代
  //   「这根销钉现在还挂在哪个点上」，那才是它真正要传达的信息。
  //   ★与 R103-6 回退的 E8 的区别（别搞混）：E8 把条件收紧成「**双锚**才画」——方向正好反了，
  //   于是 _diag_r101h J4 的桩对象（anc=[null,null]）反而画不出臂。这里保持
  //   「anc 不是双锚 ⇒ 画」，J4 原样通过；被砍掉的只有「双锚 + 瞬态分离」这一种假象。
  var bothAnc=!!(B.anc&&B.anc[0]&&B.anc[1]);
  if(!bothAnc&&Math.hypot(x1-x0,y1-y0)>1.5){
    cvx.strokeStyle=col;cvx.lineWidth=1.4;cvx.lineCap='round';
    cvx.beginPath();cvx.moveTo(x0,y0);cvx.lineTo(cx,cy);cvx.lineTo(x1,y1);cvx.stroke();
  }
  cvx.beginPath();cvx.arc(cx,cy,4.6,0,6.2832);cvx.fillStyle=col;cvx.fill();
  cvx.beginPath();cvx.arc(cx,cy,7.2,0,6.2832);
  cvx.strokeStyle=col;cvx.lineWidth=1.5;cvx.stroke();
}
/* ================= R108 新器件「地面 / 墙面」 ===========================================
 * 用户原话：「再在器件中增加一个"地面"，当然旋转角度也可以叫做墙面，就是和地面和边界性质一样，
 *   不过可以拖动，且可以鼠标悬浮的旋转功能，那些 45 度角度吸附也要加上，默认保持固定，
 *   这个一面是横线，另一面是一排排斜杠代表地面（碰撞箱相当于矩形，刚好罩住那些斜杠），
 *   拖动两端可以改变两边长度，参数里可以调节其长度，角度」
 *
 * 为什么是**一个**器件而不是两个：用户自己说了「旋转角度也可以叫做墙面」⇒ 它就是一块可以任意
 * 摆角的静态板，转 90° 自然读作墙面。做两个只会让器件栏变长、语义重复。
 * 性质与地面/边界一致：`fixed=true` + Matter static ⇒ 它是**外部支撑源**（与 railHostSupported /
 * hostIsAnvil 的口径一致，物件可以被它挡住、站上去、被弹簧顶住），默认就是「保持固定」。
 * 外观不是随便画的：**上边 = 一条实线（受力面）**，**下方 = 一排斜杠（工程制图的地面符号）**，
 * 两者都落在 mkBoundary 建出来的那个矩形**内部** ⇒ 「看到的」逐点等于「能挡能站的」。 */
// ★R125：`GROUND_SPAWN_LEN` 的**声明**已前移到 `PX_PER_M` / `CONV_DEF` 那一区（紧邻 PX_PER_M），
//   因为参数表 `gndlen` 的 `def` 要在字面量求值那一刻就抓到它的值（`var` 提升只提升声明）。
//   这里刻意**不再重复声明** —— 全文件只有一处（唯一真源），本行只是指针，别在这里加回去。
var GROUND_TH=18;              // 厚度（px）：碰撞箱就是这个矩形，刚好罩住斜杠
var GROUND_MIN_LEN=60, GROUND_MAX_LEN=1600;   // 与带子同量级（太短则两端手柄重叠没法拖）
function makeGround(cx,cy,len){
  len=clamp(len||GROUND_SPAWN_LEN,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var hw=len/2,hh=GROUND_TH/2;
  var B=mkBoundary([[cx-hw,cy-hh],[cx+hw,cy-hh],[cx+hw,cy+hh],[cx-hw,cy+hh]],
                   {shape:'poly',closed:true});
  if(!B)return null;
  B.gnd=1;                                  // ★器件身份（paramDef / 渲染 / 手柄白名单都认它）
  B.fixed=true;                             // ★「默认保持固定」
  if(B.mb)Matter.Body.setStatic(B.mb,true); // 与 __box(fixed) 同款：裸写 isStatic 会被搬
  B.len=len;B.hw=hw;B.hh=hh;
  B._mlen=len;B._mth=B.th||0;
  return B;
}
/* 改两端 = 改长度的**唯一咽喉**（照 setBeltEnds 的三件事：pts 重写 → hull 作废 → 重建 W 体）。
 * ★为什么必须作废 B.hull：bndHullLocal 只在 hull 为空时才由 pts 重算，而这里是**整数组替换**
 *   （新数组、新点对象），旧 hull 存的是上一批点对象 ⇒ 会永久停在出生那一刻的矩形
 *   （R100⑤ 在带子上实测过：几何变成 200 长、碰撞还是 264.65 宽）。 */
function setGroundEnds(B,x0,y0,x1,y1,force){
  if(!B||!B.gnd)return;
  var dx=x1-x0,dy=y1-y0,raw=Math.hypot(dx,dy)||1;
  var d=clamp(raw,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var ux=dx/raw,uy=dy/raw;
  B.x=(x0+x1)/2;B.y=(y0+y1)/2;B.th=Math.atan2(uy,ux);
  var hw=d/2,hh=GROUND_TH/2;
  B.len=d;B.hw=hw;B.hh=hh;
  B.pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  B.hull=null;                              // ★见上：几何真值被改写 ⇒ 凸包缓存必须作废
  if(!MW||!B.mb)return;
  var stale=(B._mlen==null)||(Math.abs(B._mlen-d)>2)||(Math.abs(B._mth-(B.th||0))>0.01);
  if(force||stale){B._mlen=d;B._mth=B.th;rebuildWBody(B,B.th);}
  else{Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th);}
}
/* 长度手柄拖拽（与 setBeltEnds 的调用形状逐字同款：远端锁存 fx/fy、本端跟指针）
 * ★★R131-15e（用户两连报：「地面器件改变角度后，再当我拖动两边更改长度后，它的旋转
 *  角度就复位」）：setGroundEnds 原语义 = 两端点决定**位置+角度+长度**——用户旋转
 *  45°（旋转手柄吸附）后再拖端手柄，手不可避免偏离轴 ⇒ atan2 跟着变 = 角度被拖回
 *  0/90°（用户视角 =「角度复位」）。修：指针位置**投影到当前轴**，只取轴向分量
 *  （= 只改长度），角度锁死不变。角度变更走旋转手柄（45° 吸附）/参数面板，语义分工。 */
function groundDragEnds(B,g,px,py,force){
  if(!B||!B.gnd||!g)return;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0);
  /* ★★R131-16d（用户 REC 13-41：「一拖动两边就越变越小，根本拖不了一点，还发生偏移」）：
   *  R131-15e 的投影用了固定 +u 方向——但**抓 end=1 手柄时 outward=−u** ⇒ tAlong 恒负
   *  ⇒ clamp 到 MIN=60 ⇒ 板缩到最小+瞬移到 far 的 +u 侧（「越变越小+拖不动+偏移」三连）。
   *  修：outward 方向按抓的端定（end=0→+u、end=1→−u）；sgn=−1 时**交换 setGroundEnds
   *  两参**保持 th 不翻转。 */
  var sgn2=(g.end===1)?-1:1;
  var ax=c*sgn2, ay=s*sgn2;                    // far→被抓端的 outward 方向
  var dxp=px-g.fx,dyp=py-g.fy;
  var tAlong=dxp*ax+dyp*ay;                    // 指针在轴上的投影参数
  /* tAlong 必须 ≥MIN：负值（指针越过远端）会让等效端点落到反向射线 ⇒ atan2 翻转 180° */
  tAlong=clamp(tAlong,GROUND_MIN_LEN,GROUND_MAX_LEN);
  var nx2=g.fx+ax*tAlong, ny2=g.fy+ay*tAlong;  // 投影后的等效端点（角度不变）
  if(sgn2===1)setGroundEnds(B,g.fx,g.fy,nx2,ny2,force);
  else setGroundEnds(B,nx2,ny2,g.fx,g.fy,force);  // 交换两参：th 保持原值不翻转
  B.vx=0;B.vy=0;B.om=0;
}
/* 参数面板改角度：绕**质心**转（与 beltangle 的 setBeltAngle 同一语义，只是没有两端要同步）。
 * 几何真值在 pts（本地坐标）⇒ 只改 B.th + 摆 Matter 镜像即可，不需要重建。 */
function setGroundAngle(B,th){
  if(!B||!B.gnd)return;
  B.th=shortAng(th);
  if(MW&&B.mb){Matter.Body.setAngle(B.mb,B.th);Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});}
}
/* 外观（见文件头那段：上边实线 + 下方斜杠）——与 drawBoundaries 的通用描线**互斥**，
 * 调用处直接 continue（与传送带同一个做法，否则矩形框会被画两遍、盖掉符号）。 */
var GROUND_HATCH_STEP=18;
function drawGroundBody(B,hov){
  if(!B||!B.gnd)return;
  var hw=B.hw||GROUND_SPAWN_LEN/2,hh=B.hh||GROUND_TH/2;
  var ink=hov?'rgba(28,58,92,1)':'rgba(38,34,28,1)';
  cvx.save();
  cvx.translate(B.x,B.y);cvx.rotate(B.th||0);
  cvx.beginPath();cvx.rect(-hw,-hh,hw*2,hh*2);
  /* ★R111（用户：「地面下面斜线部分怎么有一层**阴影叠加**？不要那个」）：
   *   静置态**不铺底**（只留上边实线 + 斜杠）。悬浮时保留淡蓝提示，
   *   与传送带/其他器件的选中反馈一致。 */
  if(hov){cvx.fillStyle='rgba(96,182,255,0.16)';cvx.fill();}
  /* ① 受力面：上边一条**实线**（= 用户说的「一面是横线」） */
  cvx.beginPath();
  cvx.moveTo(-hw,-hh);cvx.lineTo(hw,-hh);
  cvx.lineWidth=BND_HH*2.2;cvx.strokeStyle=ink;cvx.lineCap='round';cvx.stroke();
  /* ② 斜杠：从受力面向下斜铺（= 「另一面是一排排斜杠」），全部落在矩形内部 */
  var y0=-hh+BND_HH*1.7,y1=hh-BND_HH*0.7,drop=y1-y0;
  cvx.beginPath();
  for(var x=-hw+2;x<=hw-2;x+=GROUND_HATCH_STEP){
    var xa=x+drop*0.75;
    if(xa>hw-1)xa=hw-1;
    cvx.moveTo(x,y0);cvx.lineTo(xa,y1);
  }
  cvx.lineWidth=BND_HH*0.85;cvx.strokeStyle=ink;cvx.stroke();
  cvx.restore();
}
var DEVICES=[
  {id:'spring',name:'弹簧',len:SPR_SPAWN_LEN},
  {id:'rod',name:'轻质杆',len:ROD_SPAWN_LEN},
  {id:'belt',name:'传送带',len:BELT_SPAWN_LEN},
  {id:'ground',name:'地面/墙面',len:GROUND_SPAWN_LEN},
  {id:'hinge',name:'光滑铰链',len:0},
  {id:'rope',name:'轻绳',len:ROPE_SPAWN_LEN}
];
function deviceById(id){
  for(var i=0;i<DEVICES.length;i++)if(DEVICES[i].id===id)return DEVICES[i];
  return null;
}
// 唯一创建咽喉：面板拖出、器件模式点画布、以后的其它入口全走这里，
// 保证「拖出来的」与「点出来的」逐字段相同（不会两条路各造一个略有差别的弹簧）。
function placeDevice(id,cx,cy){
  var d=deviceById(id);
  if(!d)return null;
  var B=null;
  if(d.id==='spring'){
    var half=d.len/2;
    B=makeSpring(cx-half,cy,cx+half,cy);
  }else if(d.id==='rod'){
    // R98-2：轻质杆走**同一个** makeRod（与 vt 拼接逐字段相同）。长度以 DEVICES 表为唯一真源
    // —— 若将来改 ROD_SPAWN_LEN，这里跟着变（setRodLen 是改长度的唯一咽喉，MW 未就绪时它
    // 只写 B.len/B.hw+refresh，镜像板留给 stepMatter 懒建，不会提前造体）。
    B=makeRod(cx,cy,0,0);
    if(B.len!==d.len)setRodLen(B,d.len,false);
  }else if(d.id==='belt'){
    // R99：传送带走**同一个** makeBelt（唯一创建咽喉）。落点 = 质心（矩形以 cx,cy 为中心）。
    B=makeBelt(cx,cy);
  }else if(d.id==='ground'){
    // R108：落点 = 质心（矩形以 cx,cy 为中心），默认固定、默认水平
    B=makeGround(cx,cy,d.len);
  }else if(d.id==='hinge'){
    // R101⑦：铰链的落点 = **销钉位置**（两锚点都在这里，还没接任何东西）。
    B=makeHinge(cx,cy);
  }else if(d.id==='rope'){
    // R101⑦：轻绳与弹簧同款 —— 以落点为中心水平摆开，长度取表（拖出来 == 参数面板里的值）。
    var rl=d.len/2;
    B=makeRope(cx-rl,cy,cx+rl,cy);
  }
  if(B){
    // ★R104-6（用户：「轻质杆连接物体后，两个根本连不上，拖动杆，那个物体只是在后面追着」）：
    //   落点**立刻尝试连到附近物体**，而且必须放在这个**唯一创建咽喉**里 —— 面板拖出
    //   （endDeviceOut）与器件模式点画布（toolTap→这里）两条入口才会同时生效。
    //   根因：rodTryAnchor 在本轮之前**只有一个调用点**（springTryAnchorByHost 里那句
    //   `if(host.kind==='T')rodTryAnchor(host)`）—— 那是「把物体拖到杆上」；用户走的是相反
    //   方向「把杆拖到物体上」，那条路没有任何代码去扫杆自己的两个端点，于是永远连不上，
    //   拖动时物体只被杆的**镜像板碰撞**推着走 = 用户看到的「在后面追着」。
    //   弹簧/绳/铰链不需要这一句：它们的落点锚定挂在 pointerup 的 'S' 分支上
    //   （springTryAnchor(B)），只有杆漏了。
    if(d.id==='rod'&&typeof rodTryAnchor==='function')rodTryAnchor(B);
    B.pop=1;B.orbPulse=1;ringGo(B.x,B.y);
  }   // 与 spawnWhole / copyBody 一致的落体动画
  return B;
}
// R96：面板拖出时跟随指针的落点虚影。**不复制线圈几何** —— 直接把 drawSpring 当纯函数调用：
// 它只读 B.e0 / B.e1 / B.len / B.anc 四样，喂一个桩对象就能画出一条逐段相同的线圈；anc=[null,null]
// ⇒ 两端都不画锚点，正好就是「还没接上任何东西」的模样。于是「虚影所见 = 松手所得」是结构上保证的
// （同一份渲染代码），不是靠两处代码看起来像。
function drawDeviceGhost(id,cx,cy){
  var d=deviceById(id);
  if(!d)return;
  if(d.id==='spring'){
    var half=d.len/2;
    drawSpring({e0:{x:cx-half,y:cy},e1:{x:cx+half,y:cy},len:d.len,anc:[null,null]});
  }else if(d.id==='rod'){
    // R98-2：落点虚影 = drawRodPlank 喂桩对象（th=0 平放、len 取表）—— 与松手后 makeRod 造的杆
    // 走**同一份**画线代码，「虚影所见 = 松手所得」结构性成立。
    drawRodPlank({x:cx,y:cy,th:0,len:d.len});
  }else if(d.id==='belt'){
    // R99：虚影 = drawBeltBody 喂桩对象（同一份画线代码）—— 矩形框 + 会走的纹路，
    // 与松手后 makeBelt 造出来的带子**同一套渲染**，所以「看见什么就是放下什么」。
    drawBeltBody({x:cx,y:cy,th:0,hw:d.len/2,hh:BELT_TH/2,conv:CONV_DEF,belt:true},false);
  }else if(d.id==='hinge'){
    // R101⑦：虚影 = drawHinge 喂桩对象（同一份画线代码）⇒「虚影所见 = 松手所得」结构性成立。
    drawHinge({e0:{x:cx,y:cy},e1:{x:cx,y:cy},anc:[null,null]});
  }else if(d.id==='rope'){
    var rl2=d.len/2;
    // ★R104-2：虚影额外喂 ROPE_GHOST_SAG 垂度 ⇒ 画出**弯曲的绳**（与 chip 的波浪单线同一个语义），
    //   而不是一条直线（那看起来像一根杆）。落点、长度、锚点口径一字未改（A3 契约不受影响）。
    drawRope({e0:{x:cx-rl2,y:cy},e1:{x:cx+rl2,y:cy},len:d.len,anc:[null,null]},ROPE_GHOST_SAG);
  }
}
// ★R104-8：吸附点标记（一个圈 + 一个圆心点）。只在**正在拖器件**时出现 ——
// 松手后这个点就变成真正的锚点，标记自然消失，不会在画面上留垃圾。
// 配色用与墨色明显区分的砖红（#CE4A2C ≈ rgba(206,74,44)），一眼能看出是「提示」而不是实体。
function drawSnapMarker(x,y){
  cvx.beginPath();cvx.arc(x,y,6,0,6.2832);
  cvx.strokeStyle='rgba(206,74,44,0.92)';cvx.lineWidth=1.6;cvx.stroke();
  cvx.beginPath();cvx.arc(x,y,1.9,0,6.2832);
  cvx.fillStyle='rgba(206,74,44,0.95)';cvx.fill();
}
// 器件落点虚影的两个端点（与 drawDeviceGhost 的几何**同源**：同一张 DEVICES 表、同一个水平摆开规则）
function devEndsLocal(id,cx,cy,len){
  if(id!=='spring'&&id!=='rope'&&id!=='rod')return null;   // 传送带/铰链没有可吸附的端点
  var h=(len||110)/2;
  return [{x:cx-h,y:cy},{x:cx+h,y:cy}];
}
/*
 * R104-8 的**显示**那半边：把「将要连到哪里」提前画出来。
 * 两条入口覆盖「器件正在被拖」的全部情形：
 *   ① TOOL.devDrag（从面板拖出、还没放下）—— 用虚影端点；
 *   ② grab.kind==='body' 且抓的是一个器件（拖动已存在的弹簧/杆）—— 用它真实的 e0/e1。
 * 只有**方框宿主**的「边中点」会给标记（hostMidSnapPoint 的门），与真正落锚时同一份判定，
 * 所以「看见哪儿、就吸到哪儿」是结构性成立的，不是两处代码看起来像。
 */
/* ★R106-3（用户：「杆的物体表面中点吸附功能怎么没了，现在只是出现那个中点，但是拖过去时
 * 没有吸附的效果，我要的是拖到那个点周围时就有吸附过去的效果」+「轻绳靠近的时候怎么连中点
 * 都不显示」）：把「哪两端参与吸附提示」收成**一份判定**，标记与磁吸共用 —— 原来标记的入口
 * 写死 `B.kind==='S'&&!B.hinge&&!B.rope`，**轻绳被排除**（永远不出标记）；杆虽然出标记，
 * 但拖动期只画不动、松手又走 hostClosestPoint ⇒ 「看见却不吸」。三处口径不一，正是本条 bug。
 * 返回 {ends, anc, skip} 或 null。hinge 仍排除（两锚点恒重合、且落锚要过 hingeSurfacePoint
 * 挪到碰撞面上，标记点与最终锚点会差一个 BND_INK，宁可先不提示 —— 与 R105-1 同一条边界）。 */
function devSnapEnds(B){
  if(!B||B.dead)return null;
  if(B.kind==='S'&&!B.hinge&&B.e0&&B.e1)
    return {ends:[{x:B.e0.x,y:B.e0.y},{x:B.e1.x,y:B.e1.y}],anc:B.anc,skip:B,owner:B};
  if(B.kind==='T'&&typeof rodEndWorld==='function')
    return {ends:[rodEndWorld(B,0),rodEndWorld(B,1)],anc:B.anc,skip:B,owner:B};
  return null;
}
/* ★R106-3：**边中点候选的唯一判定**（标记 / 磁吸 / 以后的任何入口都走这里）。
 * 口径 = 原 drawDeviceSnapHints 内联循环的逐字等价：
 *   ① 在 bodies 里找离端点最近的宿主，且距离 ≤ SPR_PAD（端点得贴着它才谈得上「靠近」）；
 *   ② 该宿主用 hostMidSnapPoint 给出最近的那条边中点，且中点距离 ≤ SPR_MID_ZONE。
 * 返回 {q:{x,y}, hit:宿主, d:端点到中点的距离} 或 null。 */
function midSnapCandidate(ex,ey,skip){
  var hit=null,bd=SPR_PAD;
  for(var i=0;i<bodies.length;i++){
    var h=bodies[i];
    if(h.dead||h===skip)continue;
    var dd=distToHost(h,ex,ey);
    if(dd<bd){bd=dd;hit=h;}
  }
  if(!hit)return null;
  var q=hostMidSnapPoint(hit,ex,ey);
  if(!q)return null;
  return {q:q,hit:hit,d:Math.hypot(ex-q.x,ey-q.y)};
}
/* ★R106-3：拖动期的**边中点磁吸**位移。渐进拉法：位移 = 残差 × (1 − d/SPR_MID_ZONE)。
 *   d→0 时系数→1 ⇒ 收敛锁死（不需要另设「吸住」状态，纯位置投影、幂等）；
 *   d=SPR_MID_ZONE 时系数=0 ⇒ 进入作用圈的瞬间**连续**、不瞬移（硬阈值会在边界跳 80px，
 *   正是「不靠近也吸」的观感来源）。返回 {dx,dy,d} 或 null。 */
/* ★★★R131-58（用户：「杆在物体表面中点能完成拖拽时就吸附过去，但在**物体的角和质心**还是
 *  没有这个效果——请先完整阅读中点吸附代码，再**一比一复刻**过去」）：
 *  中点吸附的三段机制已完整复用，这里只把「候选点」扩展成**统一的优先级**：
 *    ① **质心**（仅轻质杆 T；端点在质心带内 dc ≤ 0.7×半径）
 *    ② **角**（独立铰链与杆都参与；hostCornerSnapPoint）
 *    ③ **边中点**（杆参与；独立铰链**不参与**——用户明确要求）
 *  其余（渐进拉法 k=1−d/ZONE、应用到未锚定端、红点提示）与中点吸附**逐字相同**。
 *
 * ★★★R131-63 修正（**R131-58 引入的真回归**，`_diag_r106c.py` 二分定位）：
 *  上面那套「优先级」被写成了**短路**（`if(qc)return`）⇒ 角一律吃掉边中点。
 *  但宿主是 60×40 时，右下角 (730,520) 与下边中点 (700,520) **只相距 30px**，
 *  而 CORNER_ZONE=26、SPR_MID_ZONE=30 两个作用圈**必然重叠**（半宽 < 两半径之和），
 *  于是「用户明明把端点拖到下边中点旁 6px」也会被判成角候选（端点到角 24px < 26）：
 *      A/B 铁证（`_diag_r106c.py`，宿主 60×40 @(700,500) 固定夹具）：
 *        R131-57_post（改动前）  3/3 **True**  —— 端点吸到 (700,520)、dmin≈0
 *        R131-58_post（改动后）  3/3 **False** —— 端点停在 (710.8,520)、dmin=10.80px
 *      三种元件同病：spring 10.80px / rod 29.98px / rope 10.80px，全是「本该吸中点却吸到角」。
 *      R131-58 的记忆把「跑改动前备份」的标签写错了（它把**自己这一版**的 post 当成了 pre），
 *      所以当时误判成「无新回归」——`_diag_r106c` 从 48→47 pass 就是这么掉下去的。
 *  修法 = **候选之间按「离端点更近」胜出**，优先级只当**同距时的打破规则**：
 *  三个候选各自算距离，取最近的那个；距离相同时才按「质心 > 角 > 中点」定序
 *  （质心带判定本来就是个更强的语义：插到中心就是要锚中心，所以它仍优先——
 *   但只在它也够得着的前提下）。
 *  这样「拖到中点旁」= 中点最近 ⇒ 吸中点（恢复 R106-3 用户要求的行为）；
 *  「拖到角旁」= 角最近 ⇒ 吸角（R131-58 用户新要求的角吸附，不受影响）。
 *  ★ 判据不变：杆仍可吸质心/角/中点三路，独立铰链仍只吸角（`isHinge` 那条门原样保留）。 */
function snapPickCandidate(ex,ey,skip,B){
  var hit=null,bd=SPR_PAD,i,h,dd;
  for(i=0;i<bodies.length;i++){
    h=bodies[i];
    if(h.dead||h===skip||h.kind!=='W')continue;
    dd=distToHost(h,ex,ey);
    var _dc=Math.hypot(ex-h.x,ey-h.y);
    var _rad=(h.wshape==='circle'&&h.rad)?h.rad:Math.min(h.hw||30,h.hh||24);
    var inside=(_dc<_rad);
    if(dd<bd||inside){bd=inside?0:dd;hit=h;}
  }
  if(!hit)return null;
  var isRod=!!(B&&B.kind==='T');
  var isHinge=!!(B&&B.kind==='S'&&B.hinge);
  /* ① 质心（仅杆）——与 springAnchorOffset 的质心带同口径（0.7×半径）。
   *   ★R131-63：质心带**保留短路**（它是最强语义：端点插到物体内部/中心就是要锚质心），
   *   它与角/中点在几何上互斥（带内点离角必然 > 0.3×半径，短边宿主也不会重叠），
   *   所以不会重现下面那个「角抢中点」的问题。 */
  if(isRod){
    var _cr=(hit.wshape==='circle'&&hit.rad)?hit.rad:Math.min(hit.hw||30,hit.hh||24);
    if(Math.hypot(ex-hit.x,ey-hit.y)<=_cr*0.7)
      return {q:{x:hit.x,y:hit.y},hit:hit,d:Math.hypot(ex-hit.x,ey-hit.y)};
  }
  /* ② 角 与 ③ 边中点：**各自算距离，最近的胜**（★R131-63：原来是角短路，
   *  在短边宿主上会把「拖到中点旁」也判成角）。独立铰链仍不参与边中点。 */
  var qc=hostCornerSnapPoint(hit,ex,ey);
  var qm=isHinge?null:hostMidSnapPoint(hit,ex,ey);
  if(qc&&qm){
    var dc=Math.hypot(ex-qc.x,ey-qc.y),dm=Math.hypot(ex-qm.x,ey-qm.y);
    /* 同距（含浮点几乎相等）时才让角优先 —— 保持 R131-58「角 > 边中点」的定序语义，
     * 但不再无条件抢占。 */
    return (dc<=dm)?{q:qc,hit:hit,d:dc}:{q:qm,hit:hit,d:dm};
  }
  if(qc)return {q:qc,hit:hit,d:Math.hypot(ex-qc.x,ey-qc.y)};
  if(qm)return {q:qm,hit:hit,d:Math.hypot(ex-qm.x,ey-qm.y)};
  return null;
}
function midMagnetDelta(ex,ey,skip,owner){
  var _ow=(owner!==undefined)?owner:((typeof grab!=='undefined'&&grab)?grab.obj:null);
  var c=snapPickCandidate(ex,ey,skip,_ow);
  if(!c)return null;
  var dx=c.q.x-ex,dy=c.q.y-ey,d=Math.hypot(dx,dy);
  if(d<0.05)return null;
  var k=1-Math.min(1,d/SPR_MID_ZONE);
  if(k<=0)return null;
  return {dx:dx*k,dy:dy*k,d:d};
}
/* ★R106-3：对**正被抓着的元件**做磁吸（逐子步调用，见 stepMatter 子步循环）。
 * 杆：搬杆自己 → 再 rodDragPinHosts 把已锚宿主重新钉到杆端（顺序不能反）；
 * S 族：交给 springMoveRig（搬两端 + 所有非铁砧宿主，并清速度 ⇒ 不攒松手弹飞的动能）。
 * 只搬**自由端**（已锚端的位置由宿主决定，抢它就是过约束）。 */
function midMagnetPullRig(B){
  if(!B||B.dead)return false;
  var ep=devSnapEnds(B);
  if(!ep)return false;
  for(var j=0;j<2;j++){
    if(ep.anc&&ep.anc[j])continue;
    var e=ep.ends[j];if(!e)continue;
    var m=midMagnetDelta(e.x,e.y,B,B);
    if(!m)continue;
    if(B.kind==='T'){
      B.x+=m.dx;B.y+=m.dy;
      rodDragPinHosts(B);
      if(B.mb){Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});Matter.Body.setAngle(B.mb,B.th||0);}
    }else{
      springMoveRig(B,m.dx,m.dy);
    }
    return true;
  }
  return false;
}
/* ★R106-3：对**从面板拖出、还没放下的虚影**做磁吸（同款判定、同款拉法）。
 * 虚影不是 body，位置在 TOOL.devDrag.x/y —— 搬它，落点（placeDevice 用的就是这个坐标）
 * 自然跟着吸到中点，与松手后的锚点一致。 */
function midMagnetPullGhost(){
  if(typeof TOOL==='undefined'||!TOOL||!TOOL.devDrag||!TOOL.devDrag.moved||!TOOL.devDrag.id)
    return false;
  var d=deviceById(TOOL.devDrag.id);
  var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
  if(!ends)return false;
  /* ★R131-58b：给候选一个"器件身份"（杆= T、铰链= S+hinge）——否则统一候选拿不到
   *  类型信息、虚影磁吸会失效。 */
  var _ghostOwner=(TOOL.devDrag.id==='rod')?{kind:'T'}:((TOOL.devDrag.id==='hinge')?{kind:'S',hinge:true}:null);
  for(var j=0;j<2;j++){
    var m=midMagnetDelta(ends[j].x,ends[j].y,null,_ghostOwner);
    if(!m)continue;
    TOOL.devDrag.x+=m.dx;TOOL.devDrag.y+=m.dy;
    return true;
  }
  return false;
}
function drawDeviceSnapHints(){
  var pairs=[];
  if(typeof TOOL!=='undefined'&&TOOL&&TOOL.devDrag&&TOOL.devDrag.moved&&TOOL.devDrag.id){
    var d=deviceById(TOOL.devDrag.id);
    var ends=devEndsLocal(TOOL.devDrag.id,TOOL.devDrag.x,TOOL.devDrag.y,d?d.len:110);
    if(ends)pairs.push({ends:ends,anc:null});
  }else if(typeof grab!=='undefined'&&grab&&grab.kind==='body'&&grab.obj){
    // ★R106-3：改用 devSnapEnds（与磁吸/落锚同一份判定）—— 原来这里写死
    //   `B.kind==='S'&&!B.hinge&&!B.rope`，**轻绳被排除** ⇒ 用户「轻绳靠近的时候
    //   怎么连中点都不显示」。现在绳与弹簧同款参与（绳的两端 e0/e1 与弹簧同构）。
    var pe=devSnapEnds(grab.obj);
    if(pe)pairs.push(pe);
  }
  for(var k=0;k<pairs.length;k++){
    var P=pairs[k];
    for(var j=0;j<2;j++){
      if(P.anc&&P.anc[j])continue;              // 这一端已经拴住了 ⇒ 不再提示
      var e=P.ends[j];if(!e)continue;
      /* ★R131-58：红点也走**同一个统一候选**（红点＝将要吸附的位置，二者永不再分叉） */
      var c=snapPickCandidate(e.x,e.y,P.skip,(P&&P.owner)?P.owner:((typeof grab!=='undefined'&&grab)?grab.obj:null));
      if(c)drawSnapMarker(c.q.x,c.q.y);
    }
  }
}

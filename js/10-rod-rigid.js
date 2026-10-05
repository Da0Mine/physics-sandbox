/* 杆刚体、stepMatter、边界与形状（原 index.html 第 13840–15067 行） */
/* ============================ R73-G：杆是真刚体（冲量 ⇄ 力矩） ============================
   用户（「左边是 1kg 的物体，右边 2000kg 的物体从高处释放，却弹不动左边的？不应该左边的会飞
   起来吗」）——实测复现（_diag_r73_lever.py，MODE=T）：轻块只抬 12px，而**杆的 th 恒为 0、
   om 恒为 0**。同场景把「杠杆」换成 W 画出来的细长矩形（MODE=W），轻块直接被抛出屏幕
   （上升 3892px）。差别只在杠杆的**类型**，所以断点定位得很干脆：两条独立缺口。

   ① 冲量通道：W-vs-杆 在 collideBodies 里被 `continue`（见那边的注释：「W-vs-W, W-vs-rod and
      W-vs-spring are owned by the Matter world」）。杆的 Matter 镜像是 **isStatic 的位置驱动
      薄板**（见下），求解器把压上来的 W 体弹开，却永远不会把反作用力还给杆 —— 杆在这条路上
      是一块焊死的铁砧。W 体得到的动量，物理上必须有一份反向的给杆。
   ② 角度积分：全文件搜不到任何一处把 `om` 积分进 `th`（`rodT.om += …` 只在 collideBodies 里
      写过，写完就没人读）。R71⑧ 补的角冲量因此只参与 vn 收敛、从不真的把杆转起来。

   修法 = ①+②：
     ① 在 240Hz 子步前后各量一次「W 体的求解器速度」，那份动量变化就是杆给它的冲量，
        反作用 = 施加在杆的接触点上 → 换算成杆的 vx/vy/om（标准刚体冲量：Δω = r×J / I）。
     ② stepMatter 的子步循环里按 1/240 积分杆的 x/y/th，然后同步镜像板 —— 同步必须放进子步，
        不能留在一帧一次（杆端速度可达 2500px/s，一帧就是 41px，没有 CCD 的求解器会直接
        把 48px 的方块穿过去；和「落地 440px 的笔画要分子步」是同一条理由）。
   三条护栏（缺一条就退化，逐条说明见代码）：
     · 只认冲击不认静置压力（WROD_VN_MIN）
     · 接触点速度增量封顶 = K×入射速度（WROD_TIP_K）—— 没有它 2000:1 的质量比会把 ω 算到
       1e4 rad/s 量级（实测 14943），数值上等于瞬移
     · 耗散通道（ROD_VKEEP）—— 杆没有重力也没有支撑约束，不耗散就一次撞击永远转下去 */
var WROD_VN_MIN=25;      // px/s：接触点法向入射速度低于此 = 静置压力，不反馈
var WROD_TIP_K=2.0;      // 接触点速度增量上限 = K × 入射速度（弹性对撞的极限）
var WROD_VMAX=4000;      // px/s：杆的线速度硬上限（数值安全网）
var WROD_WMAX=25;        // rad/s：杆的角速度硬上限（R71G 8d 已锁 |ω|<30 的上游语义）
var ROD_VKEEP=0.25;      // 每秒保留比例（指数耗散）：0.25 ⇒ 1s 后剩 25%。
                         // 标定见 _diag_r73_keep.py：0.12（1s 剩 12%）太快 —— 杠杆刚被砸起来
                         // 就自己泄掉，轻块只被「顶」起来；0.5 以上则杆像陀螺一样转个不停。
                         // 0.25 是实测里轻块上升最多的一档（257px），也在「能被当场按停」的范围内。
var ROD_SUB_DT=1/240;    // 杆的积分/约束步长（秒）——与 stepMatter 的 240Hz 子步一致
function rodMirrorOf(mb){return (mb&&mb._rodRef)?mb._rodRef:null;}
// 子步前的「求解器视角」速度：与 snapVelocities 同一口径（position − positionPrev），
// 因为 Matter 的 solveVelocity 全程只读写 positionPrev/anglePrev，velocity 字段是步末同步出来的。
function snapRodWPrev(pre){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind!=='W'||!B.mb||B.dead||B.mb.isStatic)continue;
    var b=B.mb,e=pre[b.id];
    if(!e)e=pre[b.id]=[0,0,0];
    e[0]=b.position.x-b.positionPrev.x;
    e[1]=b.position.y-b.positionPrev.y;
    e[2]=b.angle-b.anglePrev;
  }
}
// 子步后：把每一对「杆镜像板 ↔ W 体」的动量变化折算成杆的冲量。
function rodImpactFeedback(pre){
  var list=MW.engine.pairs.list,i;
  for(i=0;i<list.length;i++){
    var pr=list[i];
    if(!pr.isActive||pr.isSensor)continue;
    var col=pr.collision;
    if(!col)continue;
    var A=col.parentA,Bb=col.parentB;
    var rod=rodMirrorOf(A)||rodMirrorOf(Bb);
    if(!rod||rod.dead)continue;
    // R98-3：拖长度手柄时不吃冲击反馈。冻结期间 rodResolve 被跳过 ⇒ `_hinge` 是**上一次**的
    // 残值，门形同虚设；而冲量是加在 rod.vx/vy 上的，攒到松手那一刻就是「一松手整根杆飞出去」。
    if(rodLenFrozen(rod))continue;
    // ---- 护栏④（R73-G 收尾，「搁板」与「杠杆」的分界）--------------------------------
    // 只有**铰接在静态支点上**的杆才吃冲击动量。这条不是保险丝，是回归 R51 #5 逼出来的：
    // 一条 6px 的笔画从 240px 高处落到**悬空**的杆上时，按动量守恒真的会把杆敲下去
    // （实测 _diag_r73_r51.py：杆 y 500→578.6、th 0→0.49、横向漂 43px），杆一沉，笔画就以
    // ~4px/子步穿过 4px 厚的镜像板（Matter 没有 CCD），最后落到地面 —— 「画出来的搁板」
    // 这条用了五十多轮的老契约就没了。
    // 物理上也说得通：悬空的杆背后没有任何东西能把反作用力接住，动量灌进去只能让它整根漂走；
    // 而杆在本页的角色**首先是用户画的地形**（画一块板 = 造一个面），其次才是杠杆。
    // 铰接（支点托在杆中段，见 ROD_PIVOT_BAND）才是「杠杆」的成立条件，所以门就设在这里。
    // 注意：这条必须与上面「支撑循环只认静态对方」一起存在 —— 少了那一条，压上来的笔画
    // 自己就会被当成中段支点（它正好落在杆中央），于是「悬空」被判成「铰接」，门形同虚设。
    if(!rod._hinge)continue;
    var D=rodMirrorOf(A)?Bb:A;                 // D = 撞在杆上的那个 W 体
    var p=pre[D.id];
    if(!p||D.isStatic)continue;
    var cts=pr.contacts||pr.activeContacts;
    var ct=cts&&cts.length?cts[0]:null;
    if(!ct)continue;
    var v=ct.vertex;
    // ---- 护栏①：静置压力不反馈 ------------------------------------------------------
    // 压着的重物每子步都会把「支持力 × Δt」的动量交给杆。物理上没错，但杆没有重力也没有
    // 支撑约束 —— 反馈了它就每子步被压一次、永远往下沉。判据用**接触点入射速度**：静置接触
    // 的接触点法向速度恒为 0（重力那一份已被求解器抵平），真砸下来的才有量级。
    var rDx=v.x-D.position.x,rDy=v.y-D.position.y;
    var vpx=p[0]-rDy*p[2],vpy=p[1]+rDx*p[2];    // D 的接触点速度（含 ω×r，约定见 springHostVel）
    var vn=Math.abs(col.normal.x*vpx+col.normal.y*vpy)*60;   // px/s
    if(vn<WROD_VN_MIN)continue;
    var dvx=(D.position.x-D.positionPrev.x-p[0])*60,dvy=(D.position.y-D.positionPrev.y-p[1])*60;
    if(!dvx&&!dvy)continue;
    var mD=D.mass||1;                            // Matter 质量 = 自然质量 × wmass 乘数（见 applyParam）
    var Jx=-mD*dvx,Jy=-mD*dvy;                   // 杆受到的冲量 = −(W 体的动量变化)
    var mR=rodMassOf(rod);if(!(mR>1e-9))mR=1;
    var LT=rod.len||170,I=(mR*LT*LT)/12;if(!(I>1e-9))I=16000;
    var rRx=v.x-rod.x,rRy=v.y-rod.y;
    var dvRx=Jx/mR,dvRy=Jy/mR,dwR=(rRx*Jy-rRy*Jx)/I;
    // ---- 护栏②：接触点速度增量封顶 = K×入射速度 --------------------------------------
    // 2000kg 砸在 1.88kg 的杆上，按质量比老老实实算是 Δω≈1.5e4 rad/s —— 数值上就是瞬移。
    // 封顶取「弹性对撞的极限」2v：物理上是「极重撞击方 + 无约束轻杆」的接触点速度上限，
    // 而且**自标定** —— 轻轻碰（vn 小）就只给一点点，砸得越狠给得越多，不会变成开关。
    var tipx=dvRx-dwR*rRy,tipy=dvRy+dwR*rRx;
    var tip=Math.hypot(tipx,tipy),cap=WROD_TIP_K*vn;
    if(tip>cap&&tip>1e-9){var f=cap/tip;dvRx*=f;dvRy*=f;dwR*=f;}
    rod.vx=(rod.vx||0)+dvRx;rod.vy=(rod.vy||0)+dvRy;rod.om=(rod.om||0)+dwR;
    if(rod.vx>WROD_VMAX)rod.vx=WROD_VMAX;else if(rod.vx<-WROD_VMAX)rod.vx=-WROD_VMAX;
    if(rod.vy>WROD_VMAX)rod.vy=WROD_VMAX;else if(rod.vy<-WROD_VMAX)rod.vy=-WROD_VMAX;
    if(rod.om>WROD_WMAX)rod.om=WROD_WMAX;else if(rod.om<-WROD_WMAX)rod.om=-WROD_WMAX;
  }
}
// 杆的**运动学积分**（阶段①）：纯 vx/vy/om → x/y/th + 耗散。dt 恒为子步 1/240（见 stepMatter）。
// 这里只表达「杆想去哪」，不含任何约束 —— 约束全在 rodResolve 里，两者必须分开，因为
// **镜像板写入 Matter 时分两种口径**：
//   · 意图运动 → setPosition(...,true)：求解器看到的板速度 = 杆的真实运动（碰撞靠它把物块推起来）
//   · 穿透修正 → setPosition(...,false)：只挪位置、positionPrev 不动（速度读数不变）
// 把修正混进带速度的那一次调用，等于「每子步凭空给板一个 depth/dt 的速度」——实测（本轮的
// 第一次实现）1kg 与 2000kg 两个方块都被抛出屏幕（y 冲到 −3e4），整根杆的能量无限注入。
/* ★R131-30（用户：「端点处于吸附状态则抑制该端的拖端点拉伸长度功能，不然会干扰
 *  双击解除」）：已锚定端不响应「拖端点改长度」——长度手柄/端点拖拽在锚定端上失效。 */
function rodEndLenDragAllowed(B,i){
  if(!B||B.kind!=='T'||!B.anc)return true;
  return !B.anc[i];           // 该端已锚定 ⇒ 不允许拖端点改长度
}
function rodIntegrate(B,dt){
  /* ★R131-21：`!B.mb` 早退**撤销**——杆镜像板删除后 B.mb 恒 null，原早退把整条
   *  约束链（rodSyncAnchors 的 PBD/回位/重建）一起带死（_diag_r105b B5 实测
   *  resid=237px：松手后杆端永远回不到锚点）。杆位姿积分走产品字段（x/y/th），
   *  与 mb 无关；睡眠问题随板删除自动消失（无 mb ⇒ 无 Matter 睡眠）。 */
  if(B.dead)return false;
  if(grab&&grab.kind==='body'&&grab.obj===B)return false;   // 被抓住时姿态归指针，别抢
  if(rodLenFrozen(B))return false;                    // R98-3：拖长度手柄，同上
  // R100①：锚点约束（位置投影 + 铰链速度投影）——★放在**积分之后**，顺序本身就是契约：
  //   · 放之前：本子步末尾若轮到「只积分不投影」的那一步，锚定端就被带走 v·dt（实测 1.7px
  //     抖动），而帧边界正好可能落在这一步上 ⇒ 画面上是锚点轻微跳动；
  //   · 放之后：**每个子步结束时锚定端都精确落在锚点上**，误差不再被采样时序放大。
  //   代价：无锚定的杆每子步多一次函数调用（首行即早退，逐字节零成本）。
  // 另外这里**不再**用「sync 成功就 return false」跳过积分 —— 先积分再投影（PBD 的标准顺序）
  // 才能让「宿主在动、杆速度为 0」的帧照样被投影搬走（原来的需求由「投影总会被调用」满足）。
  if(B._lockRot)B.om=0;                              // 方向锁宿主：角速度保持 0（与 springSyncLocks 一致）
  var vx=B.vx||0,vy=B.vy||0,om=B.om||0;
  if(!vx&&!vy&&!om){rodSyncAnchors(B,dt);return false;}   // 静止的杆零开销（大多数帧都是这条）
  B.th=(B.th||0)+om*dt;
  B.x+=vx*dt;B.y+=vy*dt;
  // ---- 护栏③：耗散 ----------------------------------------------------------------
  // ⚠ 更正（R80 → R102）：本行最早写「杆没有重力」，R80 实测**证伪**（杆确实吃重力）：
  //   stepPhysics 那条重力语句是 `if(B.hasG&&!isGravityLetterOnly(B))B.vy+=((B.grav!=null)?B.grav:GRAV)*dt`，
  //   它上面的筛子只跳过 kind 'B'/'E' 与 'W' —— 杆（'T'）不在排除之列，且 makeRod 置了 `hasG=true`。
  //   R80 的实测证据：一条 24px 笔画被 mkBoundary 拒成 null 之后，杆一路自由落体 430 → 716（Δy=286）。
  // ⚠ 再更正（R102，用户规格）：**杆本来就是「轻质杆」= 无质量 ⇒ 不受重力**。
  //   那条语句已加 `B.kind!=='T'` 把杆排除（见 stepPhysics 注释）；本函数也就不再有重力来源。
  //   ⇒ 「杆掉不下来」现在是正确的、不是 bug；谁要是看见杆悬在空中别再当成重力失效去修。
  //   杆与 W 体的真正区别仍然只在**谁积分**：W 的位姿归 Matter（stepMatter 回写），
  //   杆的位姿归下面的 rodIntegrate。
  // 除了杆端锚点（rodSyncAnchors 的铰链投影）之外杆没有持续的支撑约束，
  // 冲量一旦进来就只能靠这里耗散。
  // 指数衰减（与 dt 无关）而不是逐帧乘常数 —— 子步是 240Hz，逐帧乘会把「1 秒」写成 1/240 秒。
  var kd=Math.pow(ROD_VKEEP,dt);
  B.vx*=kd;B.vy*=kd;B.om*=kd;
  if(Math.abs(B.vx)<0.5)B.vx=0;
  if(Math.abs(B.vy)<0.5)B.vy=0;
  if(Math.abs(B.om)<0.002)B.om=0;
  // R100①：积分完成后再解锚点约束（顺序见 rodIntegrate 顶部注释）
  rodSyncAnchors(B,dt);
  return true;
}
// 杆的**约束求解**（阶段②）：地面 / 左右墙 / 别的物体的支撑。只改速度，位置由速度推进
// （外加一个很小的穿透偏置速度），返回值告诉调用方位置是否被改过。
//
// 这里是整条链路上最容易写错的一环，两种朴素写法都试过、都被实测否掉：
//   ① 「每子步把杆平移到不再穿透」—— 位置对了，但**转动没被表达**：旋转把端点压进地面
//      多少就整根抬高多少，下一子步再转再抬。实测杆沿地面「爬」上去，150 帧爬了 143px，
//      最后悬在半空；换成「带速度的 setPosition」更糟，每子步凭空注入 depth/dt，双方
//      直接被抛出屏幕（y 冲到 −3e4）。
//   ② 「只清质心的法向速度」—— 杆还在转，端点照样越压越深。
// 正解是标准刚体接触冲量：在**接触点**上解 j = −(1+e)·vn / (1/m + (r×n)²/I)，平动与转动
// 一起分摊。r×n 那一项就是「撬」的数学形式，也正是 collideBodies 里 T 杆那段用的同一个公式
// （那边是杆被别人撞，这里是杆被支撑物顶住）。e=0：支撑不反弹。
// 穿透用**有界的位置推出**处理，而不是偏置速度 —— 偏置速度是真实速度，深穿透时
// （旋转把端点压进地面 → 偏置封顶 300px/s）每子步都在给杆注入真实动能，实测杆一路向上飘
// （2.9s 爬了 418px、最后悬在半空）。位置推出只改位置、不进能量；因为冲量已经把「继续压入」
// 的速度掐掉了，穿透不会持续增长，推出量自然收敛到 0（不存在旧版那种「转-推-转-推」的循环）。
var ROD_PUSH_FRAC=0.5;     // 每子步最多推出剩余穿透的多少
var ROD_PUSH_MAX=1.5;      // px/子步：单次位置推出的硬上限
// 支点带：接触点落在杆的**中段**（沿轴偏移 < 这个比例 × 半长）时，把这条接触当成**铰链**。
// 这是「跷跷板」与「一根滑动的板」的唯一区别，也是本轮实测出来的最后一块拼图：
// 没有它，杆虽然会被重物撬得转起来，但它是**绕自己的质心**转，左端一边升一边往内缩，
// 压在左端的轻块直接被「让」出去（实测只抬 22px 就滑掉了），而杆本身还会沿支点漂走。
// 铰接的物理含义：质心被支点拴住 ⇒ 质心速度归零、只保留转动。
// 数学上很便宜：接触点在杆轴上时 r×n ≡ 0（r 平行轴、n 垂直轴），所以「铰链」这一支
// 不影响角速度，直接清掉质心速度即可 —— 力臂全在杆的另一端，转动全部由那一端的冲量给。
var ROD_PIVOT_BAND=0.5;
// R102②（杆无重力的连锁修复）：「静置接触」的间隙容差（px）。杆没有重力后不再**压**在支点上
// —— 被支撑解算推到零穿透后就地停住（实测 _diag_r102b_lever.py：前 11 帧吃初始互穿的
// 接触、`_hinge` 11/254 帧，第 12 帧起间隙恒 0、`_hinge` 永远为 false），而
// Matter.Collision.collides 只认**穿透** ⇒ 杠杆的铰接丢失（R80 C4 实测 Δθ 0.0000）。
// 修法在 rodResolve 支撑循环里：慢速杆（静置的判据）与合法支撑物间隙 ≤ 本值时，
// 把镜像板朝对方虚压本值再测一次，测到就以 pen=0 记接触 —— 不产生位置推出
// （「贴着」不是「穿透」），铰接锁/冲击通道照常成立。快杆不许做补测：飞过支点旁
// 2px 就被铰住（vx=vy=0）是 bug，不是静置。
var ROD_REST_GAP=2;
/* R100①：这个接触点是不是落在「某个**已锚定**的端点」附近？
 * 锚点是通过 hostClosestPoint 吸到宿主**表面**上的，所以锚定端的碰撞镜像必然与宿主重叠
 * 几像素 —— 那是**铰链本身**，不是需要顶开的干涉。
 * 不豁免会怎样（实测 _tmp_probe_rod4.py）：rodResolve 每子步把杆顶出去，推出量恰好卡在
 *   ROD_PUSH_MAX=1.5px 上限 ⇒ 锚点稳定偏置 **1.5px**（与常数逐位吻合），摆动中峰值达 15px；
 *   而 rodSyncAnchors 每子步又把它拉回来 ⇒ 两者永久拉锯。 */
function rodEndAnchoredNear(B,x,y,tol){
  if(!B||!B.anc)return false;
  for(var i=0;i<2;i++){
    if(!B.anc[i])continue;
    var e=rodEndWorld(B,i);
    if(Math.hypot(e.x-x,e.y-y)<tol)return true;
  }
  return false;
}
// R100①：h 是不是本杆某个端点的锚定宿主？——「铰链的销就穿在这个宿主上」。
// 只按「接触点到销的距离」豁免是不够的：杆贴着宿主表面垂下来时，接触点在宿主的下缘，
// 离销 38px 远，照样被顶开（实测残留恰好 = ROD_PUSH_MAX = 1.5px）。所以除了那个小豁免圈，
// **锚定宿主整体退出支撑解算**：杆与它之间那点重叠是销孔，不是干涉。（没有这条时，
// 一根「铰接在方块侧面上、自然垂下」的杆永远在 1.5px 拉锯，锚点读数恒偏。） */
function rodAnchorHostOf(B,h){
  if(!B||!B.anc||!h)return false;
  for(var i=0;i<2;i++){var a=B.anc[i];if(a&&a.B===h)return true;}
  return false;
}
function rodResolve(B){
  if(B.dead||!B.mb)return;  // R98-3：拖长度手柄时不解算 —— 杆此刻是「指针手里的东西」，不该被接触推出去
  // （穿透修正会与 setRodEnds 打架：一个往指针摆、一个往接触外推 ⇒ 端点抖）。
  if(rodLenFrozen(B))return;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),hl=Math.max(4,(B.len||170)/2),hh=ROD_HH;
  var LT=B.len||170;
  var mR=rodMassOf(B);if(!(mR>1e-9))mR=1;
  var I=(mR*LT*LT)/12;if(!(I>1e-9))I=16000;
  var dX=0,dY=0;                          // 本子步累计的位置推出量
  var pivotLock=false;                    // 本子步是否吃到过铰链接触
  // n = 把杆推离接触物的单位法向；p = 接触点（世界坐标）。pen = 该方向上的穿透。
  // 接触点速度含 ω×r：v_p = (vx − ω·r_y, vy + ω·r_x)，与 springHostVel / collideBodies 同约定。
  function impact(nx,ny,px,py,pen){
    var rx=px-B.x,ry=py-B.y;
    var sAlong=rx*c+ry*s;
    if(Math.abs(sAlong)<ROD_PIVOT_BAND*hl){
      B.vx=0;B.vy=0;                      // 铰链：质心被支点拴住（见 ROD_PIVOT_BAND 注释）
      pivotLock=true;
    }else{
      var vpx=(B.vx||0)-(B.om||0)*ry, vpy=(B.vy||0)+(B.om||0)*rx;
      var vn=vpx*nx+vpy*ny;
      if(vn<0){
        var rr=rx*ny-ry*nx;
        var K=1/mR+(rr*rr)/I;
        if(K>0){
          var j=-vn/K;                    // e=0：支撑不反弹，只把接触点的压入速度清零
          B.vx+=j*nx/mR;B.vy+=j*ny/mR;B.om+=(rx*(j*ny)-ry*(j*nx))/I;
        }
      }
    }
    if(pen>0){
      // R100①：锚定端的接触**只吸收冲量、不许再搬杆** —— 那一端的位置归 rodSyncAnchors。
      // 判据用「接触点到某个已锚定端点的距离」，所以地面/左右墙/任何宿主一视同仁。
      if(!rodEndAnchoredNear(B,px,py,ROD_SNAP)){
        var push=pen*ROD_PUSH_FRAC;
        if(push>ROD_PUSH_MAX)push=ROD_PUSH_MAX;
        dX+=nx*push;dY+=ny*push;
      }
    }
  }
  // ---- 地面 / 左右墙：杆的墨迹是一条薄板（半厚 2，与 bndSegs 对杆的口径一致），两端点分别判
  for(var e=0;e<2;e++){
    var sx=(e?hl:-hl);
    var px=B.x+c*sx,py=B.y+s*sx;
    var ovG=py+hh-groundY;                                  // 墨迹下缘扎进地面多少
    if(ovG>0)impact(0,-1,px,py+hh,ovG);
    var ovL=-8-(px-hh);
    if(ovL>0)impact(1,0,px-hh,py,ovL);
    var ovR=(px+hh)-(W+8);
    if(ovR>0)impact(-1,0,px+hh,py,ovR);
  }
  // ---- 支撑：杆压在**别的物体**上时不许沉进去 ------------------------------------------
  // 最反直觉的一条：杆的 Matter 镜像是 isStatic，当支点也是静的东西（用户右键固定过的方块）
  // 时，**两个静态体之间在 Matter 里根本不产生碰撞** —— 杆会毫无阻拦地整根沉进支点里。
  // 实测（_diag_r73_lever2.py）：压在支点上的杆被 2000kg 一砸就沉下去，重物穿过去落到地面线，
  // 另一端的 1kg 纹丝不动。这条接触的几何在 Matter 里是现成的（板 ↔ 方块），这里借它取几何，
  // 把杆按接触冲量顶出去 —— 对方按不可推动处理，与 collideBodies 里 W 体恒为 imm 的口径一致。
  // 出口方向**必须自己算**：Matter 的 collision.normal 在「一方完全落在另一方内部」（4px 的板
  // 插在 60px 的方块里，正是这种）时给的是「最小单向重叠」的投影方向，符号随 bodyA/bodyB 的
  // id 排序翻面 —— 实测它把杆朝支点更深处推（depth 21.2、方向朝下），杆几帧就穿过去落到地面。
  // 用「两个候选平移谁小取谁」自己定方向，与 SAT 的最小平移矢量同义，不依赖任何符号约定。
  // 包围盒用 Matter.Bounds.create(vertices) 现算：body.bounds 被 velocity 膨胀过（Bounds.update
  // 的第三参），这里要的是纯几何。
  // R73-G 收尾（回归 R51 #5）：这条约束原本**只对静态对方**成立。
  // 动态 W 体压在杆上时，Matter 自己会解（镜像板是 isStatic，静态↔动态是它会处理的组合），
  // 这里再插一手反而错：把一个薄薄的笔画当成「支撑物」去顶杆，方向还只能靠最小平移猜，
  // 猜出来的是「把杆往下推出笔画」——杆每子步被推下去一点，最后沉到地面下，笔画跟着落到地上。
  // R88③（用户：「右边有500kg从高处释放，左边只有1kg，竟然搞不动左边」）：上面那条「只认静态」
  // 走过头了 —— 用户用**形状工具画出来的支点**是动态 W 体，于是它永远成不了支点
  // ⇒ `pivotLock` 恒 false ⇒ `B._hinge` 恒 false ⇒ rodImpactFeedback 的护栏④
  // `if(!rod._hinge)continue;` 把**整条冲击通道**掐断（杆是静态镜像板，重物砸上去被弹开，
  // 杆一点反作用都收不到）。实测（_diag_r88f_lever_pivot.py，同一支夹具、同一个 500kg 从 242px 落下）：
  //     支点已固定：rod._hinge 393/420 帧，杆转角 55.3°，左边 1kg 上升    22.9px
  //     支点未固定：rod._hinge   0/420 帧，杆转角  0.0°，左边 1kg 上升     0.0px   ← 用户看到的
  // 放宽成：**动态**对方只有在它位于杆心**下方**（`O2.y > B.y+hh`）时才认。
  // 「支撑物」在杆下面才叫支撑；而 R51 #5 要保护的那个场景（一条 6px 的笔画从 240px 高处落到
  // **悬空**的杆上）里，落体的中心必然在杆心**上方**（它正压在杆上），于是被这条方向判据排除，
  // 老契约（悬空的杆 = 用户画的地形，不许被压穿）不受影响。静态对方照旧一律认出。
  for(var k2=0;k2<bodies.length;k2++){
    var O2=bodies[k2];
    if(O2===B||O2.dead||O2.kind!=='W'||!O2.mb)continue;
    // R100①：铰链的宿主不参与支撑解算（销孔 ≠ 干涉，见 rodAnchorHostOf 注释）
    if(rodAnchorHostOf(B,O2))continue;
    if(!O2.mb.isStatic&&!(O2.y>B.y+hh))continue;
    var c2=Matter.Collision.collides(B.mb,O2.mb);
    // R102②：静置补测。零穿透（间隙 ≤ ROD_REST_GAP）时 Matter 不给接触，而无重力的杆
    // 恰恰停在零穿透上（量测见 ROD_REST_GAP 注释）⇒ 杠杆的 _hinge 丢失。慢速杆把镜像板
    // 朝对方虚压 ROD_REST_GAP 再测一次；测到就带着这份**虚压**走完下面的几何与 impact
    // （pen 按 0 记，restNudge 在本循环体末尾回退平移）——贴着 ≠ 穿透，不许把杆推走。
    var restNudge=null;
    if((!c2||!c2.collided)
       &&Math.abs(B.vx||0)<40&&Math.abs(B.vy||0)<40&&Math.abs(B.om||0)<0.5){
      var rdx=O2.x-B.x,rdy=O2.y-B.y,rdl=Math.hypot(rdx,rdy)||1;
      restNudge={x:rdx/rdl*ROD_REST_GAP,y:rdy/rdl*ROD_REST_GAP};
      Matter.Body.translate(B.mb,restNudge);
      var c2r=Matter.Collision.collides(B.mb,O2.mb);
      if(c2r&&c2r.collided){c2=c2r;}
      else{Matter.Body.translate(B.mb,{x:-restNudge.x,y:-restNudge.y});restNudge=null;}
    }
    if(!c2||!c2.collided)continue;
    var bb=Matter.Bounds.create(B.mb.vertices),ob2=Matter.Bounds.create(O2.mb.vertices);
    var nx2,ny2,d2;
    if(Math.abs(c2.normal.x)>=Math.abs(c2.normal.y)){
      var mNegX=bb.max.x-ob2.min.x,mPosX=ob2.max.x-bb.min.x;
      nx2=(mNegX<mPosX)?-1:1;ny2=0;d2=(mNegX<mPosX)?mNegX:mPosX;
    }else{
      var mNegY=bb.max.y-ob2.min.y,mPosY=ob2.max.y-bb.min.y;
      nx2=0;ny2=(mNegY<mPosY)?-1:1;d2=(mNegY<mPosY)?mNegY:mPosY;
    }
    if(!(d2>0)&&!restNudge)continue;
    // 接触点：Matter 的 supports 是这条接触的两个支撑顶点（一个来自杆、一个来自对方），
    // 取中点即接触位置。只取到 1 个时就用那一个。
    var sp=c2.supports||[],s0=sp[0],s1=sp[1],cpx,cpy;
    if(s0&&s1){cpx=(s0.x+s1.x)/2;cpy=(s0.y+s1.y)/2;}
    else if(s0){cpx=s0.x;cpy=s0.y;}
    else{cpx=(B.x+O2.x)/2;cpy=(B.y+O2.y)/2;}
    // R102②：静置补测命中的接触按 **pen=0** 记 —— 贴着不是穿透，不许把杆推走
    // （d2 在虚压状态下量出来的是虚压本身那 ~2px，不是真实的干涉量）。
    impact(nx2,ny2,cpx,cpy,restNudge?0:d2);
    // 销钉的横向约束：铰链落在哪个支点上，就把质心横向钉在该支点的中心线上。
    // 只作废「推出量」是不够的 —— 接触点速度虽然被清零，但非铰链那一端的冲量可以带水平分量
    // （重物砸到杆端时是「方块角 ↔ 杆端面」，最小平移方向本来就是水平的），杆会被整根推离
    // 支点（实测质心横向漂到 1244px，支点在 560）。真实杠杆的销是刚性的，这里就照刚性写。
    if(pivotLock){B.x+=(O2.x-B.x)*0.35;B.vx=0;}
    // ★回退虚压平移（必须放在本循环体末尾：上面的 supports/impact 都要用虚压后的几何）
    if(restNudge){Matter.Body.translate(B.mb,{x:-restNudge.x,y:-restNudge.y});restNudge=null;}
  }
  // 销钉：这一子步吃到过铰链接触 ⇒ 水平方向的位置修正全部作废。
  // 铰链是「销接」：质心被支点钉住，只有转动这一个自由度。不做这一条时，被 2000kg 砸中
  // 的杆会被冲量的水平分量整根推离支点（实测质心横向漂到 405..822px，支点在 560）——
  // 那不是杠杆，那是「被砸飞的板」。竖直方向仍然照常推出（那是「不沉进支点」的唯一保障）。
  // R73-G 收尾：把「本子步是否铰接」暴露给 rodImpactFeedback（pivotLock 原本只是这里的局部量）。
  B._hinge=pivotLock;
  if(pivotLock)dX=0;
  if(dX||dY){B.x+=dX;B.y+=dY;}
}
function stepMatter(dt){
  if(!MW)return;
  var i,B,anyW=false;
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='T'&&!B.mb&&!B.dead){
      // mirror the t-rod as a kinematic static plank: a line can land on it and stay there
      // R98-1：建板参数抽到 rebuildRodMirror（与 setRodLen / 长度手柄共用同一份实现）。
      rebuildRodMirror(B);
    }
    if(B.kind==='T'&&B.mb&&!B.dead){
      B.mb._rodRef=B;    // 兜住「先建板、后补引用」的旧状态
      // R103-5：锚定签名变了（吸附/双击解除）⇒ 板端缩进重算（唯一懒建点的补充判定）
      if(B._manc!==((B.anc[0]?1:0)|(B.anc[1]?2:0)))rebuildRodMirror(B);
    }
    if(B.kind==='W'&&!B.dead&&B.mb)anyW=true;
  }
  // R73-G：本帧的杆清单（无杆时后面整套零开销）。早退条件带上 RODS —— 杆现在会真的
  // 被积分（rodStep），场上一个 W 都没有时它照样要能滑/能转（被字母撞、被黑洞推）。
  var RODS=[];
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind==='T'&&!B.dead)RODS.push(B);   // ★R131-21：板已删除，B.mb 恒 null——条件去掉
  }
  // R130：本帧的「圆」清单（模式化摩擦：高中=质点不自转 / 大学=纯滚动+滚阻）。
  var CB=(typeof circleRollBodies==='function')?circleRollBodies():null;
  if(!anyW&&!RODS.length){MW.acc=0;return;}
  // gravity is read EVERY frame, not baked in at engine creation: tests (and anything else)
  // may set GRAV=0 to freeze the world after the engine already exists (R51 probe lesson:
  // ensureMatter captured a then-zero GRAV and the boundary never fell again).
  MW.engine.gravity.y=GRAV/1000;
  // R73-G：杆的镜像同步**不在这里**了 —— 必须逐 240Hz 子步做（与杆的积分同步，理由见
  // rodStep 上方注释：一帧一同步 = 41px 的位移台阶，48px 的方块会被没有 CCD 的求解器穿过去）。
  // a boundary being dragged: the pointer owns the pose, matter only records zero velocity
  // R66（用户：「根据拖动物体的哪一部分，物体也会根据质量分布进行旋转，也就是如果提着一个角，
  // 就会那个角在最上面，根据质量分布下沉，不过中间有一大部分都是平衡区，也就是拖着不会转的，
  // 方便普通拖动」）：拖拽悬摆。三重门全过才转——
  //   ① 悬空：贴地拖永不转（G.y+半宽 < groundY-8）；
  //   ② 力臂：抓点世界 x 偏移 |glx·c-gly·s| > DRAG_ROT_DEADBAND×max(hw,hh) —— 抓点在质心
  //      正上方的竖直中带里力臂不足，是「平衡区」，普通拖动手感不变；
  //   ③ 非方向锁装配宿主 / 非 fixed：装配体的姿态归弹簧管，悬摆不抢。
  // 平衡角：质心垂在抓点正下方 = 本地偏移的世界方向朝正上，thEq = -π/2 - atan2(gly,glx)。
  // 用临界阻尼式逼近（不真模拟摆动，到位即停不过头），越远离质心抓（r 大）转得越干脆。
  // 抓点始终钉在指针上：转完用当前 th 反解质心位置（世界偏移 = R(th)·(glx,gly)）。
  if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var G=grab.obj;
    var hw66=G.hw||30,hh66=G.hh||24,half66=Math.max(hw66,hh66);
    var glx66=grab.glx||0,gly66=grab.gly||0;
    var c66=Math.cos(G.th||0),s66=Math.sin(G.th||0);
    var air66=(G.y+half66)<groundY-8;
    var lever66=Math.abs(glx66*c66-gly66*s66);
    var canRot66=air66&&lever66>DRAG_ROT_DEADBAND*half66&&!G.fixed&&!G._lockRot&&!springLockedAsmOf(G);
    if(canRot66){
      var rl66=Math.sqrt(glx66*glx66+gly66*gly66);
      var thEq66=-Math.PI/2-Math.atan2(gly66,glx66);
      var k66=Math.min(10,Math.max(4,4+6*rl66/half66));
      G.th=(G.th||0)+shortAng(thEq66-(G.th||0))*Math.min(1,k66*dt);
      c66=Math.cos(G.th);s66=Math.sin(G.th);
    }
    var ox66=glx66*c66-gly66*s66,oy66=glx66*s66+gly66*c66;
    // R94：被导轨拴住的装配体只能沿轴拖 —— 与 pointermove 共用 dragPtrAxis()。
    // ★这是**每帧**执行的权威摆放（跑在 pointermove 之后），漏改它 ⇒ 轴锁完全失效。
    var p66=dragPtrAxis();
    G.x=clamp(p66.x-ox66,-hw66*0.6,W+hw66*0.6);
    G.y=clamp(p66.y-oy66,-hh66*0.6,groundY+hh66*0.9);
    // ★★R104-4 / R104-5 / R104-9 的收口就在这一行：这里是**每帧的权威摆放**，
    //   所以轻绳/铰链的约束也必须按在这里。漏了它的实测后果（_diag_r104o，E 组）：
    //   指针目标把上一帧 conPull 的修正整份覆盖 ⇒ d 在 **y 方向**一路长到 143px，
    //   而 Δx 恒为 0 —— 因为箱子正绕销轴自转（oxy 随 G.th 转），抓点却被钉死在指针上，
    //   销轴那一端的锚点就被甩出去了。见 conDragConstrain 的分配规则。
    var pj66=conDragConstrain(G);
    if(pj66){G.x=pj66.x;G.y=pj66.y;}
    /* ★★R111：被拖体上连着**杆**时，再跑一遍投影（Gauss-Seidel 第二趟）。
     *   原因：投影是「沿锚点连线方向搬另一端」，而搬动会改变连线方向与两端的**本地偏移**
     *   ⇒ 单趟是一次近似，快拖时收不干净（实测拖动期残差最坏 13~18px）。
     *   加一趟即可收敛到亚像素（与约束求解器的多次迭代同理）。
     *   ★只在「确实连着杆」时才加第二趟 —— 绳/铰链的行为一字不改。 */
    if(typeof rodSyncAnchors==='function'){
      var _hasRod=false;
      for(var _k=0;_k<bodies.length;_k++){var _b2=bodies[_k];
        if(_b2&&!_b2.dead&&_b2.kind==='T'&&_b2.anc&&
           ((_b2.anc[0]&&_b2.anc[0].B===G)||(_b2.anc[1]&&_b2.anc[1].B===G))){_hasRod=true;break;}}
      if(_hasRod){var pj2=conDragConstrain(G);if(pj2){G.x=pj2.x;G.y=pj2.y;}}
    }
    G.om=0;
    Matter.Body.setPosition(G.mb,{x:G.x,y:G.y});
    Matter.Body.setAngle(G.mb,G.th||0);
    Matter.Body.setVelocity(G.mb,{x:0,y:0});
    Matter.Body.setAngularVelocity(G.mb,0);
    Matter.Sleeping.set(G.mb,false);
    /* ★R111：被拖的是**支撑体**时，把压在它上面的睡眠体一起唤醒。
     *   否则「把地面拖走」后球会悬在空中（它还睡着，没人告诉它支撑没了）。 */
    if(G.mb&&(G.mb.isStatic||G.fixed))
      wakeSleepNear(G.x,G.y,(G.hw||0)+(G.hh||0)+80);
    /* ★★R111：拖拽摆放之后**立刻把连在被拖体上的杆摆正**。
     *   否则杆的位姿要等到**下一子步**的 rodSyncAnchors 才更新 ⇒
     *   拖动期看到的是「锚点已经走了、杆还在原地」的**一帧滞后**。
     *   实测（_diag_r111 时间线）：拖动期残差最坏 **18px**（改前 59px）。
     *   ★只补「连在被拖体上的那几根杆」，不全场扫。 */
    if(typeof rodSyncAnchors==='function'){
      for(var _ri=0;_ri<bodies.length;_ri++){
        var _rb=bodies[_ri];
        if(!_rb||_rb.dead||_rb.kind!=='T'||!_rb.anc)continue;
        var _hA=_rb.anc[0]?_rb.anc[0].B:null,_hB=_rb.anc[1]?_rb.anc[1].B:null;
        if(_hA!==G&&_hB!==G)continue;
        try{rodSyncAnchors(_rb,0);}catch(e){}
        if(_rb.mb){Matter.Body.setPosition(_rb.mb,{x:_rb.x,y:_rb.y});Matter.Body.setAngle(_rb.mb,_rb.th||0);}
      }
    }
  }
  // R56：固定的边界正被旋转手柄拖动——角度由指针决定，Matter 只跟着转（静止体 setAngle 合法）
  if(grab.kind==='rot'&&grab.obj&&grab.obj.kind==='W'&&grab.obj.mb){
    var RB56=grab.obj;
    Matter.Body.setAngle(RB56.mb,RB56.th||0);
    Matter.Body.setAngularVelocity(RB56.mb,0);
    Matter.Sleeping.set(RB56.mb,false);
  }
  // fixed 1/60 steps on an accumulator, so matter runs in real time on any refresh rate.
  // Each 1/60 step is internally 4 sub-steps of 240 Hz: matter has NO continuous collision
  // detection, and a stroke that has fallen 440px moves 25px per 1/60 step — clean through
  // a 4px rod mirror. Sub-stepping brings the fastest fall down to 6.4px/substep, inside the
  // ~9px contact band (stroke half-thickness 7 + rod half-thickness 2).
  // R65：方向锁宿主的角速度必须在**积分前**清零 —— 只在 stepSprings（引擎步进之后）清的话，
  // 碰撞/外部在两次清零之间注入的角速度会在子步里真的转过一大截（实测设 av=2 一帧就转 1.9rad）。
  // 步进前清零 = 积分看到的恒是 ω=0；步进内碰撞注入的残余由下一次清零兜住（一帧内微扭，可接受）。
  springSyncLocks();
  MW.acc+=dt;
  var n=0;
  // R71-B：本帧「声明 e≥1」的体（无则整套守卫零开销 —— 不进快照、不进修正）
  var EL=perfectElasticMB(),PRE={};
  // R73-G：有杆时再建一份 W 体的子步前速度快照（与 PRE 同口径，但只装 W 体）
  var PREW=RODS.length?{}:null;
  while(MW.acc>=1/60&&n<4){
    for(var s4=0;s4<4;s4++){
      // 子步前存「求解器视角」速度 → 子步 → 把 e≥1 接触的接触点法向相对速度精确还原成
      // 入射镜像。逐子步做（而不是整帧做一次）：每个子步都是一次独立的接触求解，逐子步
      // 纠正才能让误差不累积。R74-B：μ=0 极值体（EL_Z）同样开门。
      if(EL.length||EL_Z.length)snapVelocities(PRE);
      // R73-G：杆先按 1/240 积分，再把镜像板推到新位置/新姿态。第三个实参 true 让 Matter
      // 把这次位移记成板的**速度**（positionPrev 一起走）—— 求解器算接触点相对速度时读的
      // 就是这个口径。只 setPosition 不带速度的话求解器只做位置修正（把方块顶出去但不给
      // 它速度）＝「撬起来但不飞」，正是用户抱怨的另一半。
      if(RODS.length){
        for(var r4=0;r4<RODS.length;r4++){
          var R4=RODS[r4];
          R4._xps=null;   // ★R131-10：杆被抓住时 rodIntegrate 早退不产快照 ⇒ 先清上子步陈迹
          // 参考：dt 的口径是**秒**（vx/vy 是 px/s、om 是 rad/s），不是 Matter 的毫秒。
          // 传成 1000/240 会让积分放大 1000 倍、耗散项瞬间归零（实测 th 一帧跳 4 rad、om 恒读 0）。
          rodIntegrate(R4,ROD_SUB_DT);
          /* ★R131-21：杆镜像板已删除（无碰撞箱语义）⇒ 板的 setPosition/setAngle 跳过。
           *  （R4.mb 恒 null，保留会 TypeError。） */
          if(R4.mb){
            Matter.Body.setPosition(R4.mb,{x:R4.x,y:R4.y},true);
            Matter.Body.setAngle(R4.mb,R4.th||0,true);
          }
        }
        snapRodWPrev(PREW);
      }
      if(CB)circleRollSnap(CB);        // R130：必须在 update 之前（量的是接近速度）
      /* ★★R131-60：a 赋予的持续加速度**逐子步**施力（必须紧挨 Engine.update 之前：
       *  Matter 每次 update 结束清 force ⇒ 每帧只施一次会只剩 1/4，见 applyGivenAccel 的注释）。 */
      applyGivenAccel(ROD_SUB_DT);
      Matter.Engine.update(MW.engine,1000/240);
      /* ★★R131-10：杆宿主全量 XPBD 速度重建——必须在积分**之后**（完整子步位移 =
       *  rodSyncAnchors 快照 → 现位置），修「轻杆摆动越摆越低」，见 rodXPBDVel。 */
      if(RODS.length)rodXPBDVel(RODS);
      // ★R105-4：拖动中的轻质杆 = 拖**整个装配体**（位置驱动的落点就在这一行之后）。
      //   必须逐子步、且必须在求解**之后**：宿主是在子步里被重力带下去的，只在 pointermove
      //   里跟 = 指针停住就断（实测停顿 1.5s 残差 231px，见 rodDragPinHosts 注释）。
      //   只对「正被指针抓着的杆」调用 —— 其余时刻宿主位姿归 rodSyncAnchors，零开销。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='T'&&!grab.obj.dead)
        rodDragPinHosts(grab.obj);
      /* ★★R131-61：拖的是**物体**时，沿杆链把整条装配体一起解（否则多杆链会"分离"，
       *  见 rodDragPinChain 的注释与 _diag_r178 的 42~52px 残差）。 */
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)rodDragPinChain(grab.obj);
      // ★R106-2：S 族（弹簧/绳/铰链）同一个病、同一味药 —— 见 springDragPinRig 的注释。
      //   位置同样在**求解之后**（宿主是在子步里被重力带下去的），逐子步、只对正被抓着的体。
      if(grab.kind==='body'&&grab.obj&&grab.obj.kind==='S'&&!grab.obj.dead)
        springDragPinRig(grab.obj);
      // ★R106-3：**边中点磁吸**（用户：「拖到那个点周围时就有吸附过去的效果」）。
      //   放在两条「跟指针」之后：先把元件摆到指针下（上面两条），再做磁吸偏移 ——
      //   顺序反了会被 pin 覆盖掉，磁吸就白做。逐子步、纯位置投影、幂等。
      if(grab.kind==='body'&&grab.obj&&!grab.obj.dead)midMagnetPullRig(grab.obj);
      /* ★R131-5（已撤销，2026-09-25）：曾在测试「被抓 W 体逐子步重钉」（治帧级摆放与
       *   240Hz 子步之间重力攒速度 75.8px/s 的铁砧污染）。_probe_r104 E3 实测：开它之后
       *   铰链拖拽的另一端逐帧位移 5.6→82.3px（爆震），禁用即回 5.6px；而杆钟摆的真正
       *   病根是 conDragConstrain 的帧级清速度（R131-7），撤掉清速度后钟摆复活、
       *   本补丁不再需要（杆长残差 −0.27px < 墨线半宽 2.325px，不可见）。 */
      // ★R106-3：虚影（从面板拖出、还没放下）也要吸 —— 否则「虚影停在旁边、松手却跳到中点」。
      if(typeof TOOL!=='undefined'&&TOOL&&TOOL.devDrag)midMagnetPullGhost();
      // ★R117：原 R91②「高中纯滚动 highPureRoll」的逐子步调用已**整体删除**
      //   （回退到 R91_pre：高中不再有任何「写 ω」的通道，见函数原位置墓碑注释）。
      if(RODS.length){
        // 约束求解只改速度（位置由速度推进 + 穿透偏置速度），镜像板不必再写一次
        for(var r6=0;r6<RODS.length;r6++)rodResolve(RODS[r6]);
        rodImpactFeedback(PREW);
      }
      // ★R130：圆的模式化摩擦（逐子步，放在求解之后、e≥1 修正之前：滑移归位要赶在
      // 下一个子步之前，否则求解器会把它当真实滑移啃掉平动 —— 撞墙骤降就是这么来的）。
      if(CB)circleRollStep(CB,ROD_SUB_DT);
      if(EL.length||EL_Z.length)elasticContactFix(PRE,EL);
    }
    MW.acc-=1/60;n++;
  }
  if(n===4)MW.acc=0;
  // R70：步进后全量刷一遍活动碰撞对 —— ①frictionStatic 按每帧刷 min（Matter 新 pair 原生
  // 取 max，球贴 μ=0 凹槽滚动会被逐段静摩擦咬死）；②极值接触对（有效 μ=0 或 e≥1）双方
  // frictionAir 归零；③非极值体按 R68 公式恢复。幂等、与 applyWFrict 的手动刷新不冲突。
  if(n>0)refreshAllPairs();
  for(i=0;i<bodies.length;i++){
    B=bodies[i];
    if(B.kind!=='W'||!B.mb)continue;
    B.x=B.mb.position.x;B.y=B.mb.position.y;B.th=B.mb.angle;
    // R72-G（用户：「圆弧的地面吸附功能怎么没有」）：吸附原来只挂在「拖拽松手」那一次
    // —— 自由落体停在地附近的弧/线永远不会吸附。这里补上**安定触发**：速度近零、没被
    // 抓住、没吸过，就做一次与松手完全相同的判定（snapWToGround 内部自带「够近 + 够平 +
    // 仅开链」三重守卫，不满足就什么都不做）。
    // _snapped 防止每帧重吸把休眠彻底禁掉（snap 成功会显式唤醒体）；重新抓住 / 拖走就清零。
    if(grab.kind==='body'&&grab.obj===B)B._snapped=false;
    else if(!B.fixed&&!B._snapped&&!B.dead){
      var vs7=B.mb.velocity;
      if(vs7.x*vs7.x+vs7.y*vs7.y<0.25){          // <0.5px/子步（120px/s）≈ 已安定
        /* ★R132-9i：每帧「安定触发」的吸附一并删除（用户明确不要这个功能）。
         *  ★它就是「卡顿」的来源：近地的弧每帧重新吸一次 ⇒ 位姿被反复回写。 */
        B._snapped=true;   // 只留「别再试」的标记，不再做任何吸附
      }
    }
    // ---- R57（用户 #5「把东西放到圆弧上面一直不断抖动」）--------------------------------
    // 这里原本写「B.vx=B.mb.velocity.x*60」，把 Matter 的 velocity 直接当成边界的真实速度。
    // 三件事叠在一起，造就了「永久微弹」：
    //  ① 静止接触里 Matter 会保留一个非零 velocity——它靠每帧的 positionImpulse 把位移抵消
    //     回去。实测一个稳稳落在地面上的弧，mb.velocity.y 恒为 ~2.6（≈156px/s），位置却一动
    //     不动，而且永远进不了休眠（实测 120/120 帧醒着）。
    //  ② 把它当「墙正在动」喂给 bndHit / collideBodies 的接触冲量，压在弧上的字母每帧都被
    //     按相对速度 vn 反弹一次，实测 vy 永远停在 127~161px/s 不衰减。→ 改由位姿差分求速度。
    //  ③ 差分本身也有噪声：多段复合体静置时 Matter 会有 1px 级求解器跳变（实测弧每约 15 帧
    //     整体上跳 1.2px 再慢慢落回），差出来就是 ±72px/s 的假速度，照样能把上面的东西顶飞。
    //     → 亚像素级运动按静止处理（死区）。边界按设计是「没有惯性、只能被拖动」的铁砧，
    //       这种数值抖动不该传导给压在上面的物体。
    if(B._px===undefined){B._px=B.x;B._py=B.y;B._pth=B.th;}
    var invdt=1/Math.max(1e-4,dt);
    var rvx=(B.x-B._px)*invdt,rvy=(B.y-B._py)*invdt;
    // vx/vy = 对外语义的「边界真实速度」（位姿差分），渲染以外的读取者（黑洞吸力累加、
    // 调试探针、验证脚本）都看它；rvx/rvy = 接触计算专用，多一层亚像素死区（见下）。
    B.vx=rvx;B.vy=rvy;
    B.rvx=(Math.abs(rvx)<W_V_DEAD)?0:rvx;
    B.rvy=(Math.abs(rvy)<W_V_DEAD)?0:rvy;
    B._px=B.x;B._py=B.y;B._pth=B.th;
    // ④ 静置检测：每 20 帧（约 0.33s）比一次快照，净位姿变化小于 1.6px 就让它睡。Matter 自己
    //    睡不着——①的幻影 velocity 让它的 motion 永远高于休眠门限。睡着后位置彻底冻结，压在
    //    它上面的东西也就不会再被求解器跳变甩动。（另一个后果：压在上面的物体自己也有幻影
    //    motion，会通过 Sleeping.afterCollisions 反复把它唤醒，所以这里必须能重复入睡。）
    //    必须按**净**位移判，不能按逐帧：多段复合体静置时 Matter 每隔十几帧会把整块向上修正
    //    1.2px 再慢慢落回（实测弧的 y 在 588.41~589.64 之间来回），逐帧判会永远攒不满静置帧
    //    数。而真正在倾倒/下落的物体，净位移是单调增长的，不会被误判。
    //    也要同时看转角——绕质心原地转动时质心净位移接近 0，只看位移会把正在倒的杆睡死
    //    （R37 就是这么坏的：锤子被冻在倾斜半空）。
    // ⑤ R100：**净位移之外还要看窗口内的最大偏离**（excursion）。只看净位移会被「弹跳顶点」
    //    骗过去 —— 实测（_diag_r100c_flow.py，用户流程：传送带 + 球从上方落下）：
    //      0ms y=420 → 200ms y=482(vy=+546) → 400ms y=531(vy=-233，弹回) → 600ms y=552.35
    //    球在带面上弹起又落回，20 帧（0.33s）的**净**位移几乎为 0，而它其实走了 ~27px；
    //    于是被 `nd<1.6` 判成静置、`Sleeping.set(true)` **睡死在带面上方 11.65px 的半空**
    //    （贴面应在 564，末次读数 552.35），此后永不苏醒、任何接触通道都够不到它。
    //    这是 R37「锤子被冻在倾斜半空」的同一类错误：**「净位移小」≠「没在动」**。
    //    加一条 excursion ≤ 1.6px ⇒ 整个窗口内它**从没走远过**，才是真静置。
    //    阈值刻意复用同一个 1.6px 尺度：静置多段体的求解器跳变实测 ~1.2px（见上面③），
    //    落在门内；弹跳体的 excursion 是 20px 量级，差一个数量级，不靠新魔数分辨。
    if(!B.mb.isStatic&&!(grab.kind==='body'&&grab.obj===B)){
      if(!B._snap)B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      if(B._snap.ex===undefined)B._snap.ex=0;
      var exd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
      if(exd>B._snap.ex)B._snap.ex=exd;
      if(++B._snap.n>=20){
        var nd=Math.abs(B.x-B._snap.x)+Math.abs(B.y-B._snap.y)+Math.abs(B.th-B._snap.th)*60;
        if(nd<1.6&&B._snap.ex<1.6&&!B.mb.isSleeping)Matter.Sleeping.set(B.mb,true);
        B._snap={x:B.x,y:B.y,th:B.th,n:0,ex:0};
      }
    }else if(B._snap)B._snap.n=0;
    // 圆形是真实刚体：滚动角速度回传（松开时带着转）；形状/线保持 0 即可
    if(B.wshape==='circle'&&B.rad){B.om=B.mb.angularVelocity;}
    if(grab.kind==='body'&&grab.obj===B){B.vx=0;B.vy=0;B.rvx=0;B.rvy=0;B._px=B.x;B._py=B.y;}
  }
  // ★R130d：W 体回写**之后**把双端锚定的杆再摆一次姿态。杆位姿在子步内摆（Engine.update
  //   之前，rodIntegrate→rodSyncAnchors），W 体在子步里还会被 Matter 积分 ⇒ 杆姿态恒滞后
  //   一帧：自由落体 1022px/s 实测 gap=17.1px（=恰好一帧位移），用户看到「杆和体脱钩」的
  //   分量之一。这里只摆姿态（位置语义 setPosition/setAngle，不带速度意图），求解器口径
  //   仍以子步内那次为准；单端锚定杆的姿态由 rodSyncAnchors 单端分支自算，此处不碰。
  if(n>0&&RODS.length){
    for(var rq=0;rq<RODS.length;rq++){
      var RQ=RODS[rq];
      if(!RQ||RQ.dead||!RQ.anc||!RQ.anc[0]||!RQ.anc[1])continue;
      if(grab&&grab.obj===RQ&&(grab.kind==='body'||grab.kind==='rodlen'))continue;
      if(RQ.anc[0].B&&!RQ.anc[0].B.dead&&RQ.anc[1].B&&!RQ.anc[1].B.dead&&
         bodies.indexOf(RQ.anc[0].B)>=0&&bodies.indexOf(RQ.anc[1].B)>=0){
        var q0=springAnchoredWorld(RQ,0),q1=springAnchoredWorld(RQ,1);
        if(q0&&q1){
          RQ.x=(q0.x+q1.x)/2;RQ.y=(q0.y+q1.y)/2;
          RQ.th=(RQ.th||0)+shortAng(Math.atan2(q0.y-q1.y,q0.x-q1.x)-(RQ.th||0));  // ★R130d 连续化
          RQ.hw=RQ.len/2+2;
          if(MW&&RQ.mb){Matter.Body.setPosition(RQ.mb,{x:RQ.x,y:RQ.y});Matter.Body.setAngle(RQ.mb,RQ.th||0);}
        }
      }
    }
  }
}
/* ---- geometry ------------------------------------------------------------------------ */
function bndPts(B){
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),out=[];
  for(var i=0;i<B.pts.length;i++){
    var p=B.pts[i];
    out.push([B.x+p[0]*c-p[1]*s,B.y+p[0]*s+p[1]*c]);
  }
  return out;
}
/* R71⑯（用户：「吸附功能：弧/手绘线条接近地面且即将水平时自动吸附成与地面平滑相接」）
   只对**开链**笔画/圆弧生效（闭合图形有面积、姿态由重心决定，不该被磁吸摆平；圆形更没有
   朝下的平面）。判据两条，缺一不可：
     · 够近：最低点的**墨迹下缘**离地面在 SNAP_D 之内（也允许已经轻微扎进地面）
     · 够平：最低点处的**局部切线**与水平夹角在 SNAP_A 之内
   满足就把那条切线转成严格水平（绕最低点旋转，最低点自身不动 → 视觉上就是「原地压平」），
   再把整条线竖直平移，使墨迹下缘正好落在地面线上。结果 = 与地面平滑相接：
   一端不悬空、另一端不扎进地里，滚动体滚上来也不会有台阶。
   返回 true 表示确实吸附了（供探针判定）。
   R73-E（用户：「圆弧在地面的吸附效果还是没有，我的意思是要圆弧固定以后，拖动圆弧后，拖到
   地面附近后的吸附」）：`force` = 允许**已固定**的体参与吸附。旧版一刀切 `B.fixed` 直接返回
   false，于是「先右键固定、再拖到地面」这条最常用的路径永远不吸附（固定的体恰好是用户最想
   摆平的那类 —— 它不会再自己动，姿态全看用户摆得准不准）。固定体在拖拽里本来就是位置驱动
   （stepPhysics 的 `O.fixed` 分支按 O.vx 走），吸附只是把它的位置/姿态改成贴合地面，合法。
   默认 false：R72-G 的「安定后自动吸附」仍然跳过固定体（钉住的体不是「落下来安定的」）。 */
var SNAP_D=20;                        // 吸附带：离地面 20px 以内
var SNAP_A=Math.PI*9/180;             // 「即将水平」：与水平相差 9° 以内
function snapWToGround(B,force){
  /* ★★R132-9i（用户 2026-10-02：「圆弧自动吸附地面的功能给删了，吸附不准确，还是会卡顿，
   *  不要这个功能了」）：**退场填空壳**——两个调用点已删除，这里直接返回 false，
   *  任何残留调用都不会再改位姿。
   *  保留函数名只为让这段历史可被 grep 到：R71⑯ 首次引入（松手吸附）、
   *  R72-G 补每帧「安定触发」（→ 卡顿的来源）、R73-E 放开 fixed 限制，R132-9i 整体撤销。 */
  return false;
  /* eslint-disable no-unreachable */
  if(!B||B.dead||B.kind!=='W'||B.closed)return false;
  if(B.fixed&&!force)return false;    // R73-E：固定体只在「拖拽松手」这条显式路径上吸附
  if(!B.pts||B.pts.length<2)return false;
  var wp=bndPts(B),n=wp.length,i;
  if(n<2)return false;
  var lo=-1e9,li=0;
  for(i=0;i<n;i++)if(wp[i][1]>lo){lo=wp[i][1];li=i;}
  var gap=groundY-(lo+BND_INK);              // 墨迹下缘到地面的净空（正 = 悬空）
  if(gap>SNAP_D)return false;                // 太高，够不着
  if(gap<-BND_INK*5)return false;            // 已经深埋，不是「接近」而是穿模了，别动它
  // 最低点处的局部切线：取相邻两点连成的方向（弧的采样足够密，等价于真切线）。
  // 注意**开链**：首/末点的邻居不能取模绕到另一端去（那会算出一条跨越整条线的假切线，
  // 角度完全失真）。端点处就用它唯一的内侧邻居。
  var pa,pb;
  if(li===0){pa=wp[0];pb=wp[1];}
  else if(li===n-1){pa=wp[n-2];pb=wp[n-1];}
  else {pa=wp[li-1];pb=wp[li+1];}
  var tx=pb[0]-pa[0],ty=pb[1]-pa[1];
  if(Math.abs(tx)<1e-6&&Math.abs(ty)<1e-6)return false;
  var d=Math.atan2(ty,tx);
  while(d>Math.PI/2)d-=Math.PI;              // 折到 (-90°,90°]，因为「水平」不分正反方向
  while(d<=-Math.PI/2)d+=Math.PI;
  if(Math.abs(d)>SNAP_A)return false;        // 不够平
  // 绕最低点旋转 -d：最低点在世界坐标里原地不动，只把切线摆平
  var px=wp[li][0],py=wp[li][1];
  var c0=Math.cos(-d),s0=Math.sin(-d);
  var vx=B.x-px,vy=B.y-py;
  B.x=px+vx*c0-vy*s0;
  B.y=py+vx*s0+vy*c0;
  B.th=(B.th||0)-d;
  // 再按旋转后的真实几何竖直平移，令墨迹下缘 == 地面线（自校正，不依赖上面的角度推导）
  var wp2=bndPts(B),lo2=-1e9;
  for(i=0;i<wp2.length;i++)if(wp2[i][1]>lo2)lo2=wp2[i][1];
  B.y+=groundY-(lo2+BND_INK);
  B.vx=0;B.vy=0;B.om=0;
  if(B.mb&&MW){
    Matter.Body.setPosition(B.mb,{x:B.x,y:B.y});
    Matter.Body.setAngle(B.mb,B.th);
    Matter.Body.setVelocity(B.mb,{x:0,y:0});
    Matter.Body.setAngularVelocity(B.mb,0);
    Matter.Sleeping.set(B.mb,false);
  }
  return true;
}
// R57：悬浮/抓取命中 = 「贴着线」才算，空心内部不响应。
// 用户：图形是空心的，只有有线的地方才该有反应。旧实现用 AABB（甚至是个半径圆），
// 于是一个 300x200 的矩形在内部任意空白处都会亮起、都能抓——和「只有线是边界」自相矛盾。
// 这里直接算「指针到轮廓折线的最短距离」，阈值 = 线半宽 + 抓取余量（约十几 px）。
var INK_GRAB_PAD=11;                     // 线外再放宽 11px 便于点中（视觉线半宽约 4.65）
function nearInk(B,px,py){
  if(!B||B.kind!=='W'||!B.pts||B.pts.length<2)return false;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),n=B.pts.length;
  var lim=B.closed?n:n-1;
  var lim2=(BND_HH*1.55+INK_GRAB_PAD);lim2=lim2*lim2;
  for(var i=0;i<lim;i++){
    var a=B.pts[i],b=B.pts[(i+1)%n];
    var ax=B.x+a[0]*c-a[1]*s, ay=B.y+a[0]*s+a[1]*c;
    var bx=B.x+b[0]*c-b[1]*s, by=B.y+b[0]*s+b[1]*c;
    var ex=bx-ax,ey=by-ay,L2=ex*ex+ey*ey;
    var t=L2>0?((px-ax)*ex+(py-ay)*ey)/L2:0;
    if(t<0)t=0;else if(t>1)t=1;
    var dx=px-(ax+ex*t),dy=py-(ay+ey*t);
    if(dx*dx+dy*dy<=lim2)return true;
  }
  return false;
}
function bndSegs(B){
  // the solid part of the outline, each piece a thin oriented box — the boundary analogue of the
  // t-rod's single plank, so the rod collision code can treat them the same way. ONLY THE LINE IS
  // SOLID: for a CLOSED shape that is its rim (a hollow frame — you can drop things inside it),
  // for an OPEN pen stroke it is the stroke itself, a chain of marker-thick planks with no gap
  // between neighbours.
  var wp=bndPts(B),m=wp.length,out=[],n=B.closed?m:m-1;
  var hh=BND_INK;   // R71⑦：开口笔画与闭合轮廓统一取「屏幕上那根线的半厚」。
                    // 原来开口取 PEN_HW、闭合取 BND_HH，两者都是 3.0，比渲染的 2.325 胖 0.675px。
  for(var i=0;i<n;i++){
    var a=wp[i],b=wp[(i+1)%m];
    var ex=b[0]-a[0],ey=b[1]-a[1],L=Math.hypot(ex,ey);
    if(L<0.5)continue;
    out.push({x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,hw:L/2,hh:hh,th:Math.atan2(ey,ex),pad:0});
  }
  return out;
}
/* ★★R127（补齐 §50.5 的欠账）：复合体（trough/tub/ring/arc → `segCompound`）的惯量合成。
 *   Matter 的 `Body.setParts` 合成**根**惯量时走 `_totalProperties`：**只是把各 part 的 `inertia`
 *   相加**，**漏掉平行轴项** `Σ m_i·d_i²`（`d_i` = part 质心到根质心）；而每个 part 的 `inertia`
 *   又是「纯几何惯量 × `_inertiaScale`(=4)」（`Body.setVertices` 里的库默认，见源码
 *   `_inertiaScale*i.inertia(e.vertices`）。
 *   ⇒ **两条错一起犯**：根 = `4·Σ I_cm`，而物理值 = `Σ I_cm + Σ m_i·d_i²`。
 *   ★实测基线（`_diag_r122c.py`，2026-09-23，`R127_pre`）：trough 根 lam=0.8108、tub=0.6087、
 *     **ring=0.013**（ring 的平行轴项占完整物理惯量的 **99.7%** ⇒ 偏小 **77 倍**）。
 *   ★数值对账（证明「根就是 Σ part.inertia、确实没有平行轴」）：缺口 1−0.797=0.203 ⇒ 0.203×4=0.812
 *     ≈ 实测 0.8108 ⇒ 假定成立，不是猜的。
 *   修法 = §50.5 的四步（★R127 实测**纠正了其中一条**，见 ①）：
 *     ① 逐 part 撤掉 scale（`p.inertia / Matter.Body._inertiaScale`）—— **不是行为必需**。
 *        ★★§50.5 / R79 / R82 曾记「求解器读 **part** 的 `inverseInertia`」——**源码看是错的**：
 *        `Detector` 交给 `Collision` 的确实是 part（`i.bodyA.parent`），但 `Pair.update` 立刻折回根
 *        （`var a=t.parentA,s=t.parentB; e.inverseMass=a.inverseMass+s.inverseMass; e.friction=…`），
 *        `Resolver.solveVelocity` 也只取 `g=collision.parentA` / `x=collision.parentB`，
 *        力矩臂 `L=顶点−g.position`（量自**根**）。
 *        ⇒ **求解器读的是【根】的 `inverseMass / inverseInertia / friction`，part 只提供几何。**
 *        保留这一步的理由只剩**口径一致性**（part 也撤掉 4 倍，任何读者/重组成员都拿不到 4 倍值）；
 *        守卫里的 `P*` 判据守的就是这条一致性，**不是**「求解器那一侧」。
 *     ② 根按**平行轴**重新合成 `Σ(I_part + m_i·d_i²)` —— **这一步才是行为真源**；
 *     ③ 必须在 `Body.create({parts})`（内部走 `setParts`）**之后**做 —— 否则被它覆盖回 Σ；
 *     ④ `Body.setInertia` 同时写 `inverseInertia` ⇒ 求解器侧跟着变。
 *   ★口径：`p.inertia / Matter.Body._inertiaScale` 得到的是**绕该 part 自身质心**的物理惯量
 *     （`Body.setVertices` 先把顶点平移到自己质心再算 `Vertices.inertia`），正是平行轴公式要的 `I_cm`。
 *   ★★**首跑踩坑（务必别改回去）**：`_inertiaScale` 是 **`Matter.Body` 上的模块级静态**
 *     （源码 `Body._inertiaScale=4`），**不是体实例的属性** ⇒ 写 `p._inertiaScale` 读到的
 *     是 `undefined`，`||1` 一兜底 `Ip` 就等于 `p.inertia` 本身（已含 4 倍）⇒ ① 退化成
 *     **空操作**，而 ② 照旧把平行轴叠上去 ⇒ 根变成 `4·ΣI_cm + Σm·d²`（**超调**）。
 *     实测过这个错（好在对账能一眼认出来）：trough 根 lam=1.6081 = 4×0.203+0.797、
 *     tub 1.4565 = 4×0.152+0.848，逐位吻合；且**逐 part lam 仍是 `[4,4,4]`**
 *     —— 那就是「① 没生效」的铁证（① 生效时它必然是 1.0）。 */
function segCompoundInertia(mb){
  if(!mb||!mb.parts||mb.parts.length<2)return mb;
  var ps=mb.parts,i;
  var SC=(Matter.Body&&isFinite(Matter.Body._inertiaScale)&&Matter.Body._inertiaScale>0)
           ?Matter.Body._inertiaScale:1;    // ★模块级静态！**不是** p._inertiaScale（首跑踩坑，见上）
  function rMass(o){                        // 静态化后 mass=Inf ⇒ 从 `_original` 取回物理质量
    if(isFinite(o.mass))return o.mass;
    return (o._original&&isFinite(o._original.mass))?o._original.mass:0;
  }
  function cmI(p){                          // 绕**自身质心**的物理惯量（撤掉库的 4 倍；同样兼容静态化）
    var raw=isFinite(p.inertia)?p.inertia
            :((p._original&&isFinite(p._original.inertia))?p._original.inertia:0);
    var Ip=raw/SC;
    return (isFinite(Ip)&&Ip>0)?Ip:0;
  }
  var tot=0,cx=0,cy=0;
  for(i=1;i<ps.length;i++){
    var m0=rMass(ps[i]);
    tot+=m0;
    cx+=m0*ps[i].position.x;cy+=m0*ps[i].position.y;
  }
  if(!(tot>0))return mb;
  cx/=tot;cy/=tot;                          // 与 Matter.setParts 的合成质心同口径
  var I=0;
  for(i=1;i<ps.length;i++){
    var p=ps[i],m=rMass(p),Ip=cmI(p);
    // ① 撤 scale。★静态体**不能**写：它的 `inverseInertia` 必须留在 0，否则求解器会让它自转。
    if(!p.isStatic&&Ip>0)Matter.Body.setInertia(p,Ip);
    var dx=p.position.x-cx,dy=p.position.y-cy;
    I+=Ip+m*(dx*dx+dy*dy);                   // ② 平行轴
  }
  // ③ 必须在 setParts（Body.create 内部）之后写根 —— 否则被 `_totalProperties` 的 Σ 覆盖回去。
  if(I>0&&!mb.isStatic)Matter.Body.setInertia(mb,I);
  return mb;
}
function segCompound(parts,B,opt){
  // 开链/凹槽轮廓的刚体构造：沿墨迹每小段一个定向矩形，再合成一个复合体。
  // 兜底是必须的——arcResample 的段长会随扫过角一起缩，而 bndSegs 有 L<0.5 的去噪阈。
  // 圆弧扫过角收到 MIN 时每段都短于 0.5px，parts 全被滤掉 → parts[0] 是 undefined →
  // 调用方紧接着读 mb.position 直接抛 TypeError（R62 实测：rx=150/ry=50 压到最小扫过角必崩）。
  // 这时退化成「一根包住实际范围的薄板」：碰撞和肉眼都等价，但绝不返回 undefined。
  if(parts.length>1)return segCompoundInertia(Matter.Body.create({parts:parts}));   // ★R127：合成后立刻补惯量
  if(parts.length===1)return parts[0];
  var wp=bndPts(B),n=wp.length,o=opt||{friction:0.08,frictionStatic:0.6,restitution:0,slop:0.02};
  var cx=0,cy=0,x0=1e9,y0=1e9,x1=-1e9,y1=-1e9,i;
  for(i=0;i<n;i++){
    cx+=wp[i][0];cy+=wp[i][1];
    if(wp[i][0]<x0)x0=wp[i][0];if(wp[i][0]>x1)x1=wp[i][0];
    if(wp[i][1]<y0)y0=wp[i][1];if(wp[i][1]>y1)y1=wp[i][1];
  }
  if(n){cx/=n;cy/=n;}else{x0=x1=B.x;y0=y1=B.y;}
  return Matter.Bodies.rectangle(cx,cy,Math.max(6,x1-x0),Math.max(6,y1-y0),o);
}
function mkBoundary(worldPts,opt){
  opt=opt||{};
  // A pen stroke is an OPEN line; a preset shape is a CLOSED ring. Same body, same physics —
  // only the caps and the last segment differ.
  var closed=(opt.closed!==false);
  var raw=[],i,j;
  for(i=0;i<worldPts.length;i++){
    var q=worldPts[i];
    if(q&&isFinite(q[0])&&isFinite(q[1]))raw.push([q[0],q[1]]);
  }
  if(raw.length<(closed?3:2))return null;
  // ---- the weight is spread ALONG THE LINE, not over the enclosed area -------------------
  // The user draws a line and the line is the boundary, so the mass sits on the line: uniform
  // linear density, so a segment's weight is proportional to its LENGTH. That is what makes a
  // circle's weight sit on its rim and a long plank's weight sit along its middle.
  var seg=[],L=0,cx=0,cy=0,n=raw.length,last=closed?n:n-1;
  for(i=0;i<last;i++){
    var a=raw[i],b=raw[(i+1)%n];
    var dxx=b[0]-a[0],dyy=b[1]-a[1],len=Math.hypot(dxx,dyy);
    if(len<0.01)continue;
    seg.push([a[0],a[1],b[0],b[1],len]);
    L+=len;cx+=len*(a[0]+b[0])/2;cy+=len*(a[1]+b[1])/2;
  }
  if(!isFinite(L)||L<BND_MIN_LEN)return null;       // too short to be a body at all
  cx/=L;cy/=L;                                       // centroid of the line distribution
  // polar second moment of a uniform LINE distribution about that centroid: each segment carries
  // rho*len*d^2 (parallel-axis, d = the distance from the centroid to the segment's own middle)
  // plus its own rho*len^3/12 (a rod about its own centre). rho == 1, so mass == total length.
  var J=0;
  for(i=0;i<seg.length;i++){
    var s=seg[i];
    var mx=(s[0]+s[2])/2-cx,my=(s[1]+s[3])/2-cy;
    J+=s[4]*(mx*mx+my*my)+s[4]*s[4]*s[4]/12;
  }
  var B=BODY(cx,cy);
  B.kind='W';                     // boundary: gravity-driven falling + gravity-torque tipping
  B.pts=[];
  for(i=0;i<raw.length;i++)B.pts.push([raw[i][0]-cx,raw[i][1]-cy]);
  B.closed=closed;
  B.bndM=L;                       // mass == the length of the line (linear density 1)
  B.bndI=J||1;                    // so bndI carries the right units for bndM
  B.om=0;
  B.wshape=opt.shape||'poly';
  if(opt.rad)B.rad=opt.rad;
  if(opt.notch)B.notch=opt.notch;
  if(opt.ell)B.ell={lcx:opt.ell.cx-cx,lcy:opt.ell.cy-cy,rx:opt.ell.rx,ry:opt.ell.ry,a0:opt.ell.a0,a1:opt.ell.a1};
  // R68：凹槽/滑梯的**真弧渲染元数据**。shapeOutline 给出的是世界坐标圆心+弧中点；
  // 这里转成与 B.pts 同一套的本地坐标（质心原点）。走向(ccw)不存——渲染时用中点在哪一侧现算，
  // 避免对四种开口变换逐一手推角度方向。碰撞仍走 bndSegs 的多段采样（Matter 只吃多边形）。
  if(opt.arcs){
    B.arcs=[];
    for(i=0;i<opt.arcs.length;i++){var aR=opt.arcs[i];
      B.arcs.push({i0:aR.i0,i1:aR.i1,lcx:aR.cx-cx,lcy:aR.cy-cy,
                   lmx:aR.mx-cx,lmy:aR.my-cy,r:aR.r});
    }
  }
  var mnx=1e9,mny=1e9,mxx=-1e9,mxy=-1e9;
  for(i=0;i<B.pts.length;i++){
    if(B.pts[i][0]<mnx)mnx=B.pts[i][0];if(B.pts[i][0]>mxx)mxx=B.pts[i][0];
    if(B.pts[i][1]<mny)mny=B.pts[i][1];if(B.pts[i][1]>mxy)mxy=B.pts[i][1];
  }
  B.hw=Math.max(6,(mxx-mnx)/2);
  B.hh=Math.max(6,(mxy-mny)/2);
  B.mass=1;
  B.bounc=0;                      // a boundary lands, it never bounces
  B.vx=0;B.vy=0;
  B.pop=1;
  // y grows DOWNWARD, so the "lowest" vertex is the one with the LARGEST y. Never be born
  // buried in the ground line.
  var lowY=-1e9;
  for(i=0;i<B.pts.length;i++)if(B.pts[i][1]>lowY)lowY=B.pts[i][1];
  if(cy+lowY>groundY)B.y-=((cy+lowY)-groundY);
  buildMatterBody(B);              // born into the Matter world: real weight from here on
  return B;
}
function shapeOutline(shape,x0,y0,x1,y1){
  var ax=Math.min(x0,x1),ay=Math.min(y0,y1),bx=Math.max(x0,x1),by=Math.max(y0,y1);
  if(shape==='circle'){
    var cx=(ax+bx)/2,cy=(ay+by)/2,r=Math.max(10,Math.min(bx-ax,by-ay)/2),out=[];
    for(var i=0;i<32;i++){var a=i/32*6.2832;out.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}
    return {pts:out,shape:'circle',rad:r};
  }
  if(shape==='ring'){
    // 圆环/空心圆（R82，用户：「把圆改成空心的，里面可以放东西进去，因为有时也需要圆形轨道」）
    // 与 circle 的唯一差别：**这里返回的多边形就是物理几何本身**。
    //   · circle 的 B.pts 只服务 nearInk/命中判定（32 点够用），碰撞走 buildMatterBody 的
    //     polygon(CIRCLE_SIDES) 实心圆盘、渲染走 canvas 真弧 —— 三者各说各话；
    //   · ring 的 B.pts 是**外接多边形**（其弦中点正好落在半径 rad 的圆上，见下方 rv），
    //     下游一路同一份几何：
    //       bndSegs 沿它切出 48 根定向矩形（厚 = 2·BND_INK = 屏幕上那根线的粗细），
    //       segCompound 拼成复合体 ⇒ 碰撞体恰好是「墨线本身」；
    //       traceWPath 沿它描边 ⇒ 渲染也恰好是同一条线。
    //     于是「画出来的线 = 唯一的实体」这条纪律（见 drawBoundaries 里 ONLY THE LINE IS THE
    //     BOUNDARY）第一次对圆也成立：外壁在 rad+BND_INK、内壁在 rad−BND_INK、环内是空的。
    // R83：段数从固定 CIRCLE_SIDES 改为**按半径自适应**的 outlineSides(rr) —— 详见该函数注释。
    //   R≤140 仍是 48 段（逐位兼容），R=300 的大环升到 71 段、半径偏差峰峰从实测 0.6120px
    //   压到 0.2704px（几何预测 0.2939；＝用户「让它尽量接近圆」这条诉求的量化落点）。
    // 视觉上与 circle 逐像素相同（同一条 BND_HH*1.55 = 4.65px 的描边）。
    // ⚠ 顶点半径要取 rad/cos(π/N)，**不是** rad：下游 bndSegs 用的是**相邻两点的中点**
    //   （= 弦中点，半径 rad·cos(π/N)），照字面写 rad 会让整条墨带朝环心内缩
    //   rad(1−cos(π/48)) = 0.214px（rad=100 时实测 part 中心落在 99.786 而非 100），
    //   于是「画出来的线」与「碰撞的线」差 0.21px —— 正是用户反复抱怨的名实不符。
    //   把顶点放到外接圆上，弦中点就**逐位**落在 rad 上，bndSegs 切出的每根矩形径向覆盖
    //   恰为 [rad−BND_INK, rad+BND_INK]，与那条 4.65px 描边完全重合。
    //   （代价：48 边形的尖角比真圆多探出 0.21px，肉眼不可见。）
    // 段数 = outlineSides(rr)（R83，见文件上方该常量的注释）：按半径自适应地把半径偏差
    // 钉在 OUTLINE_PP_MAX 以下。R≤140 时它**精确返回 48**，与旧行为逐位相同。
    var cxr=(ax+bx)/2,cyr=(ay+by)/2,rr=Math.max(10,Math.min(bx-ax,by-ay)/2),outr=[];
    var NS=outlineSides(rr);
    var rv=rr/Math.cos(Math.PI/NS);
    for(var ir=0;ir<NS;ir++){
      // 整圈角步长用 2*Math.PI（**不是** 6.2832）：截断字面量会少转 1.47e-5 rad，48 段累计下来
      // 让多边形的**长度质心**偏离几何中心 ~6e-5 px，mkBoundary 减掉这个质心后顶点半径就带上
      // ±6e-5 的摆动（_diag_r83b 的 Q1 组实测跨度 1.16e-4，逐位对得上）。量级无关紧要，但没理由留着。
      var ar=ir/NS*2*Math.PI;
      outr.push([cxr+Math.cos(ar)*rv,cyr+Math.sin(ar)*rv]);
    }
    return {pts:outr,shape:'ring',rad:rr,cx:cxr,cy:cyr};
  }
  if(shape==='tri'){
    // 直角三角形（R54 首末点语义）：首点 P0 与末点 P1 是斜边的两个端点（都不是直角点），
    // 直角点由二者推导 = (x0,y1)——从首点走竖直边、到末点走水平边。上/下/左/右拖拽
    // 自然给出对应朝向，无需特判。
    /* ★★R132-9zr：**三角形器件必须有身份**。原来这里（以及下面矩形那条）返回 `shape:'poly'`
     *   —— 与**画笔随手画的折线**完全同值 ⇒ 无法区分「预设器件」与「手绘形状」。
     *   用户要的是「形状里面矩形/圆形/三角形**画出来的器件**」能赋电荷 ⇒ 补回 `'tri'`。
     *   （全文件没有任何地方依赖 `wshape==='poly'`，已 grep 确认；传送带/画笔仍走 'poly'。） */
    return {pts:[[x0,y0],[x0,y1],[x1,y1]],shape:'tri'};
  }
  if(shape==='trough'){
    // 半凹槽（R54，用户图 1）：一个矩形，它的「顶边+一条邻边」被一条四分之一圆弧替代
    // （弧内凹，像滑梯/滑坡）；保留另一条邻边和对边作直边。开口（弧的凹面）朝拖拽的
    // 反方向——向下拖画开口朝上的滑梯，向右拖画开口朝左的，以此类推。
    // 规范形（开口朝上，对齐用户图1）：左上角 (ax,ay) -> 顶边小平台 -> 四分之一弧
    // 圆心在右上角 (bx,ay)、半径 R，从 180° 扫到 90° 落在 (bx,ay+R)，到底边 (bx,by)，
    // 左边闭合。起点陡降、终点水平汇入底边 = 滑梯。R=min(H,W-t)。
    // 方向判定（R55）：看包围盒的宽高比，不是拖拽的 dx/dy。
    // 扁盒子 -> 上下开口；高盒子 -> 左右开口。斜着拖（W≈H）时宽高比给不出跳变，
    // 而 dx/dy 在 45° 附近会让整个形状忽然旋转 90°（用户：很反人类）。
    // 开口朝哪一侧仍由末点相对首点的方向决定。
    // 规范形（开口朝上）：四分之一弧圆心 (ax+t,by)、半径 R，从正上方扫到正右方。
    var wT=bx-ax,hT=by-ay,wT2=wT,hT2=hT;
    var t5=Math.max(12,wT-hT),R5=Math.min(hT,wT-t5);
    // R68：采样 14 -> 28 段。渲染已改 canvas 真弧（见 arcs 元数据），这里加密是给**碰撞**
    // 用的——Matter 只吃多边形，段越密多边形越贴真弧（大滑梯 R≈400px 时 14 段弦高偏差 ~2px，
    // 28 段降到 ~0.5px，球贴着弧面滚不再看见悬浮/下陷）。
    // R70：28 -> 29（奇数）—— 同 tub/shapeArcPts 的接缝楔住教训：让弧的扫过中点落在段中央。
    var N5=29,base=[],k5;
    // R55 修正：弧心在右上角 (bx,ay)，从 180°(圆心正左 = 顶边末端) 扫到 90°(圆心正下 = 底边右端)。
    // 起点切线垂直（陡降）、终点切线水平（平滑汇入底边）——这才是滑梯。
    // R54 画反了：圆心放在左下角、弧从顶边垂直扎下去，得到的是镜像的怪形状。
    base.push([ax,ay]);                                        // 左上角 -> 顶边平台（到弧起点）
    for(k5=0;k5<=N5;k5++){var a5=Math.PI-Math.PI/2*k5/N5;      // 180° -> 90°
      base.push([bx+Math.cos(a5)*R5,ay+Math.sin(a5)*R5]);}
    if(ay+R5<by-1)base.push([bx,by]);                          // 弧终点未到底边时补一小段右壁
    base.push([ax,by]);                                        // 底边 -> 左边闭合
    // R68：弧元数据（规范形）。pts[1..1+N5] 是圆心 (bx,ay)、半径 R5 的圆弧；mid = 弧中点
    // （3π/4 处）。四种开口变换（恒等/y 镜像/±90° 旋转）都是等距变换——圆映到圆，把圆心与
    // 中点跟着点一起变换即可，走向(ccw)由渲染时用「中点在哪一侧」现算，不必逐变换手推。
    var arcs5=[{i0:1,i1:1+N5,cx:bx,cy:ay,r:R5,
                mx:bx+Math.cos(Math.PI*0.75)*R5,my:ay+Math.sin(Math.PI*0.75)*R5}];
    // 方向变换：恒等(开口朝上) / y镜像(朝下) / 绕包围盒中心 ±90° 旋转(朝左、朝右)。
    // R55 关键修正：旋转必须绕包围盒中心 (mx,my)。之前写成 [y, ax+bx-x] 的「转置」，
    // 形状会瞬移到关于对角线镜像的位置（画在右上角、出现在左下角）——反人类本尊。
    var wide=(wT2>=hT2),down5=(y1>=y0),right5=(x1>=x0),out5=[];
    var mx5=(ax+bx)/2,my5=(ay+by)/2;
    function xf5(p){
      if(wide&&down5)return p;                                         // 开口朝上（从左上往右下拖）
      if(wide)return [p[0],ay+by-p[1]];                                // 开口朝下（y 镜像，中心不动）
      if(right5)return [mx5-my5+p[1],mx5+my5-p[0]];                    // 开口朝左（绕中心转 90°，顶边→左边）
      return [mx5+my5-p[1],my5-mx5+p[0]];                              // 开口朝右（绕中心转 -90°）
    }
    for(k5=0;k5<base.length;k5++)out5.push(xf5(base[k5]));
    for(k5=0;k5<arcs5.length;k5++){
      var c5=xf5([arcs5[k5].cx,arcs5[k5].cy]),m5b=xf5([arcs5[k5].mx,arcs5[k5].my]);
      arcs5[k5].cx=c5[0];arcs5[k5].cy=c5[1];arcs5[k5].mx=m5b[0];arcs5[k5].my=m5b[1];
    }
    return {pts:out5,shape:'trough',arcs:arcs5};
  }
  if(shape==='tub'){
    // 全凹槽（R54，用户图 2）：一个矩形，它的顶边被一条大半圆弧替代（浴缸/碗），
    // 顶边两端各留一小段平台。开口朝拖拽的反方向。规范形（开口朝上）：
    // 半圆弧圆心在顶边中央、直径 = W-2t，R=min(H, W/2-t)，弧底落在包围盒内。
    var w6=bx-ax,h6=by-ay;
    // R55：参数按用户图 2 反推（拟合圆心 (587,145)、半径 398、包围盒 924x437）：
    // 半径取 0.92H（弧底不触底，留 ~8% 余量），平台 = W/2 - R（参考图约 64px）。
    // ★R128（用户：「全凹槽画得过小会穿模，上面的线都出来了」）：原来 R 与平台各自独立
    //   clamp（R 下限 10、t 下限 10）⇒ 小尺寸时 **R + t > W/2**，弧的两端**伸进顶边平台**——
    //   实测 W=70 的 tub 侵入 5.10px、W=24 侵入 8.32px（默认 W=160 恰好 0，所以平时看不见）。
    //   修法 = **先给平台留出 10px，再把 R 压进剩下的空间**：R = min(0.92H, 0.43W, W/2−10)，
    //   t = W/2−R（不足 2px 时顶到 2）。★W≥143 的大形状逐位不变（那时 0.43W 本来就 ≤ W/2−10）。
    var R6=Math.max(2,Math.min(h6*0.92,w6*0.43,w6/2-10));
    var t6=Math.max(2,w6/2-R6);
    // R68：采样 16 -> 40 段（理由同 trough —— 碰撞多边形贴真弧）。
    // R70：40 -> **41（奇数）** —— 偶数段时 90° 弧底恰好落在段与段的交界上，球每次振荡
    // 经过弧底都骑在 V 形接缝上；诊断实测球某次通过时被两侧楔面把切向速度吃光，嵌进缝里
    // 被夹死（sp 3.3 -> 0.01，位置钉在弧底 (498,668) 而非振荡端点），随后被睡眠冻结 ——
    // 这就是用户「μ=0 还是衰减过一会儿就停」的最后一击。奇数段让弧底落在**段中央**（该处
    // 接触面连续无折角），球贴面平滑通过，不再有楔住点。
    var cx6=(ax+bx)/2,N6=41,base6=[],k6;
    base6.push([ax,ay],[ax+t6,ay]);
    // R55：180° -> 0°（经过 90°），sin 为正 = 弧向下凹进矩形（浴缸底）。
    // 之前写成 180°->360°，sin 为负，弧整个翻到顶边上方去了。
    for(k6=0;k6<=N6;k6++){var a6=Math.PI-Math.PI*k6/N6;          // 180°(左端) -> 0°(右端)，经底部
      base6.push([cx6+Math.cos(a6)*R6,ay+Math.sin(a6)*R6]);}
    base6.push([bx-t6,ay],[bx,ay],[bx,by],[ax,by]);
    // R68：弧元数据（规范形）。pts[2..2+N6] 是圆心 (cx6,ay)、半径 R6 的半圆弧；mid = 90° 处
    // （弧底）。走向(ccw)渲染时按中点在哪一侧现算。
    var arcs6=[{i0:2,i1:2+N6,cx:cx6,cy:ay,r:R6,mx:cx6,my:ay+R6}];
    // 方向判定同 trough：宽高比决定上下/左右开口，末点方向决定朝哪一侧（R55）。
    // 旋转同样必须绕包围盒中心（R55 修正，见 trough 处注释）。
    var wide6=(w6>=h6),down6=(y1>=y0),right6=(x1>=x0),out6=[];
    var mx6b=(ax+bx)/2,my6b=(ay+by)/2;
    function xf6(p){
      if(wide6&&down6)return p;
      if(wide6)return [p[0],ay+by-p[1]];
      if(right6)return [mx6b-my6b+p[1],mx6b+my6b-p[0]];
      return [mx6b+my6b-p[1],my6b-mx6b+p[0]];
    }
    for(k6=0;k6<base6.length;k6++)out6.push(xf6(base6[k6]));
    for(k6=0;k6<arcs6.length;k6++){
      var c6=xf6([arcs6[k6].cx,arcs6[k6].cy]),m6c=xf6([arcs6[k6].mx,arcs6[k6].my]);
      arcs6[k6].cx=c6[0];arcs6[k6].cy=c6[1];arcs6[k6].mx=m6c[0];arcs6[k6].my=m6c[1];
    }
    return {pts:out6,shape:'tub',arcs:arcs6};
  }
  if(shape==='arc'){
    // R71⑭（用户：「弧的绘制不太符合习惯，改成统一绘制四分之一的弧，然后鼠标点下位置为圆心，
    // 松开位置为弧的位置」）：绘制语义整体换掉 ——
    //   · 按下点 = **圆心**（不再是「拖出一个外接框 + 取内切圆」）
    //   · 松开点 = 弧上的位置，取为弧的**中点**（用户原话「松开位置为弧的位置」）
    //   · 永远四分之一弧（90°）= [θ−45°, θ+45°]，θ = 松开点相对圆心的方向
    // 于是「按住 → 朝想要的方向拖出去 → 松手」直接得到一段朝该方向鼓起、大小=拖拽距离的
    // 90° 弧。注意这里必须用**原始**的 x0,y0 / x1,y1 —— 本函数开头的 ax/ay/bx/by 已经
    // 归一化成 min/max，按下与松开的先后关系（谁当圆心）在那里就丢了。
    // 端点手柄能力不回退：ell 的 a0/a1 照旧，黄点仍可改起止角。
    var dxA=x1-x0,dyA=y1-y0;
    var RA=Math.max(30,Math.hypot(dxA,dyA));         // 半径 = 圆心到松开点的距离（保底 30）
    var thA=((dxA||dyA)?Math.atan2(dyA,dxA):Math.PI/4);
    return shapeArcPts(x0,y0,RA,RA,thA-Math.PI/4,thA+Math.PI/4);
  }
  /* ★R132-9zr：同上 —— **矩形器件**补回 `'rect'`（原来与手绘折线同为 'poly'）。 */
  return {pts:[[ax,ay],[bx,ay],[bx,by],[ax,by]],shape:'rect'};
}
// 圆弧采样：角度用屏幕系（y 向下，顺时针为正）。段数按扫过角度自适应——
// 每段角步长 <= 0.09 rad（约 5°），300px 的圆上矢高 < 0.3px，肉眼是光滑曲线不是折线。
// R69：对外永远 rx=ry（正圆弧）；保留 rx/ry 两个参数以便万一将来想画椭圆。
function shapeArcPts(cx,cy,rx,ry,a0,a1){
  // R70：段数强制**奇数**（n|=1）—— 偶数段时弧的扫过中点（最凹点）正好落在两段交界上，
  // 球振荡经过时骑在 V 形接缝上会被楔住（同 tub N6=41 的教训，见彼处注释）。
  var sw=a1-a0,n=Math.max(20,Math.min(160,Math.ceil(Math.abs(sw)/0.09)))|1,pts=[],k;
  for(k=0;k<=n;k++){var a=a0+sw*k/n;pts.push([cx+Math.cos(a)*rx,cy+Math.sin(a)*ry]);}
  return {pts:pts,shape:'arc',open:true,ell:{cx:cx,cy:cy,rx:rx,ry:ry,a0:a0,a1:a1}};
}
function shapeDefault(shape,x,y){
  if(shape==='circle')return shapeOutline('circle',x-70,y-70,x+70,y+70);
  if(shape==='ring')return shapeOutline('ring',x-80,y-80,x+80,y+80);      // R82 空心圆：默认半径 80
  if(shape==='tri')return shapeOutline('tri',x-85,y-70,x+85,y+70);        // 默认斜边从左上到右下
  if(shape==='trough')return shapeOutline('trough',x-70,y-45,x+70,y+45);  // 默认开口朝上（滑梯）
  if(shape==='tub')return shapeOutline('tub',x-80,y-45,x+80,y+45);        // 默认开口朝上（浴缸）
  // R71⑭：弧的默认形 = 圆心就在落点、半径 70、右下象限 90° 弧（等价于「按下后朝右下拖 70px」）
  if(shape==='arc')return shapeArcPts(x,y,70,70,0,Math.PI/2);
  return shapeOutline('rect',x-80,y-45,x+80,y+45);
}
/* ---- ① ready-made wholes -------------------------------------------------------------- */
// Each preset is just "a mass letter + the letters merged into it" — the exact same assembly
// path copyBody() uses (massG as the base, mem[] merged in, then refresh()), so a preset is
// byte-for-byte what you get by dragging the same letters together.
// `tex` is the WRITTEN form of the very same formula — a tiny LaTeX subset (\frac{a}{b}, ^{2},
// \mu). It exists because a formula has to LOOK the way it is written on paper: the numerator
// stacked over the denominator with a rule between, superscripts raised. "mv^2/r" is computer
// notation and it is exactly what the menu must never show.
var WHOLE_PRESETS=[
  /* ★R132-9n（用户 2026-10-02：「那个公式示例面板里面，下面的小字介绍**只要名称就行**，
   *  其他的什么"撞墙会分裂"这些效果的说明删掉」）：`note` 一律只留**物理名称**。
   *  原来还混了行为预告（会下落 / 会进入圆轨道 / 撞墙会分裂 / 会塌成黑洞 / 会膨胀爆炸 /
   *  当前默认 / 两个 v 自动出平方）—— 那些是**实现细节的剧透**，写死后还常常与实际行为
   *  对不上（改一次物理就得同步一遍文案）。⇒ 全部删掉，只留定理/概念名。 */
  {name:'mg',      tex:'mg',                 note:'重力',                mass:'m',mem:['g'],friction:0.01},
  {name:'ma',      tex:'ma',                 note:'牛顿第二定律',        mass:'m',mem:['a']},
  {name:'mv',      tex:'mv',                 note:'动量',                mass:'m',mem:['v']},
  {name:'mv²',     tex:'mv^{2}',             note:'动能',                mass:'m',mem:['v','v']},
  {name:'mv²/r',   tex:'\\frac{mv^{2}}{r}',  note:'向心力',              mass:'m',mem:['v','v','r']},
  /* ★R132-9g（用户：「左边下拉框内公式示例还是没有按照标准的 latex 格式显示，那个
   *  1/2 mv² 分子分母都没有在上下换行」）⇒ tex 走标准 `\frac{1}{2}mv^{2}`（真上下分式）。
   *  ★注意 mem 仍是单个 `½` 字形 —— 那是**物理组装体**的内部表示，与显示无关；
   *    bossIsEk 认的也是它。 */
  {name:'½mv²',    tex:'\\frac{1}{2}mv^{2}',  note:'动能定理',            mass:'m',mem:[HALF,'v','v']},
  {name:'GMm/r²',  tex:'\\frac{GMm}{r^{2}}', note:'万有引力',            mass:'m',mem:['G','M','r','r']},
  {name:'2GM/c²',  tex:'\\frac{2GM}{c^{2}}', note:'史瓦西半径',          mass:'M',mem:['G','c','c']},
  {name:'mc²',     tex:'mc^{2}',             note:'质能方程',            mass:'m',mem:['c','c']},
  {name:'m(g+gμ)', tex:'m(g+g\\mu)',         note:'滑动摩擦',            mass:'m',mem:['g','g',MU]}
];
/* ---- written maths (a LaTeX subset -> HTML) -------------------------------------------
   Hand-rolled so the page stays ONE offline file (no KaTeX, no CDN, no network):
     \frac{mv^{2}}{r} -> mv² stacked over r with a rule between them
     mv^{2}           -> mv with a raised superscript 2
     \mu              -> μ
   Everything else is passed straight through; digits and operators are set upright while the
   letters inherit the italic of the .mth container — the way a hand-written formula looks. */
function mthHTML(tex){
  var S=String(tex==null?'':tex);
  function esc(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c;}
  function grp(s,i){                       // read one {...} group (or a single char) at s[i]
    if(s.charAt(i)!=='{')return {body:s.charAt(i),next:i+1};
    var d=0,j;
    for(j=i;j<s.length;j++){
      if(s.charAt(j)==='{')d++;
      else if(s.charAt(j)==='}'){d--;if(!d)return {body:s.slice(i+1,j),next:j+1};}
    }
    return {body:s.slice(i+1),next:s.length};
  }
  function run(s){
    var out='',i=0;
    while(i<s.length){
      var c=s.charAt(i);
      if(c==='\\'){
        var m=/^\\([a-zA-Z]+)/.exec(s.slice(i));
        var cmd=m?m[1]:'';
        if(cmd==='frac'){
          var a=grp(s,i+5),b=grp(s,a.next);
          /* ★★R132-4：分数线做成**独立元素** `.fracbar`（原来是 `.mnum` 的 border-bottom）。
           *  它排在分子之后、分母之前 ⇒ DOM 顺序天然是「分子 → 横线 → 分母」
           *  ⇒ 进 `BOSS.chars` 后可被逐个点亮（border/伪元素做不到，子元素控不了父元素）。 */
          out+='<span class="mfrac"><span class="mnum">'+run(a.body)+'</span>'+
               '<span class="fracbar"></span>'+
               '<span class="mden">'+run(b.body)+'</span></span>';
          i=b.next;continue;
        }
        if(cmd==='mu'){out+='μ';i+=3;continue;}
        if(cmd==='cdot'){out+='<span class="mcoef">·</span>';i+=5;continue;}
        out+=esc(c);i++;continue;
      }
      if(c==='^'||c==='_'){                // superscript / subscript, braced or single char
        var g=grp(s,i+1);
        out+=(c==='^')?('<sup>'+run(g.body)+'</sup>'):('<sub>'+run(g.body)+'</sub>');
        i=g.next;continue;
      }
      out+=((c>='0'&&c<='9')?('<span class="mcoef">'+esc(c)+'</span>'):esc(c));
      i++;
    }
    return out;
  }
  return '<span class="mth">'+run(S)+'</span>';
}
function spawnWhole(ps,x,y){
  var massN=GD(ps.mass);massN.pop=0;
  var B=BODY(x,y);
  B.massG=massN;massN.body=B;
  B.glyphs=[];B.mem=[];
  var mm=[];
  for(var i=0;i<ps.mem.length;i++){var g=GD(ps.mem[i]);g.pop=0;B.mem.push(g);mm.push(g);}
  var list=[massN].concat(mm);
  list.forEach(function(g){g.body=B;g.inBody=true;B.glyphs.push(g);});
  // 摩擦预设（R52）：mg = 重力，地面摩擦极小（像冰面）；m(g+gμ) = 有 μ，用默认摩擦。
  // 由 WHOLE_PRESETS 的 friction 字段注入；μ 字母本身仍是 frict 参数（右键可调）。
  if(ps.friction!=null)B.frict=ps.friction;
  refresh(B);   // layoutRun/layoutFrac/anchorBox all centre the INK on B.x/B.y
  B.pop=1;B.vx=0;B.vy=0;
  return B;
}

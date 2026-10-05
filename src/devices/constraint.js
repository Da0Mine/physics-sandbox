/* 轻绳 / 铰链共用的两点约束求解 */
import Matter from 'matter-js';
import { rodLenFrozen } from '../bodies/rod.js';
import { bodies } from '../core/dom.js';
import { springAnchoredWorld, springSyncEnds } from './spring.js';
import { grab } from '../input/pointer.js';
import { MW } from '../physics/matter.js';

// ---- 统一的两点约束求解器（轻绳 / 铰链共用）----
// 单位冲量在某点沿 n 产生的法向速度：k = 1/m + (r×n)²/I。
// 转动项即「偏心冲量会把物体转起来」：少了它，挂在球边缘时球不会被拽正，
// 而是以偏挂姿态僵在半空（弹簧上踩过同样的坑）。
export function conVel(h,px,py,nx,ny){
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
// 正被长度手柄按住的杆 / 弹簧这种无质量幽灵。指针与外部位移源不能被约束改写：
// 拖拽端在约束里等于无穷大质量，约束只搬另一端。
export function conSide(h,nx,ny,px,py){
  if(!h||!h.mb||h.dead)return null;
  if(h.kind==='S')return null;
  if(grab&&grab.kind==='body'&&grab.obj===h)return null;
  if(rodLenFrozen(h))return null;
  var mb=h.mb,im=(mb.inverseMass!=null)?mb.inverseMass:0;
  if(!(im>0))return null;                        // isStatic / 被 setStatic 过：inverseMass = 0
  var ii=(mb.inverseInertia!=null)?mb.inverseInertia:0;
  var rx=px-mb.position.x,ry=py-mb.position.y,cr=rx*ny-ry*nx;
  return {k:im+cr*cr*ii,im:im,ii:ii,cr:cr};
}
export function conPush(h,s,nx,ny,J){
  if(!s||!h||!h.mb)return;
  var mb=h.mb,v=mb.velocity||{x:0,y:0};
  Matter.Body.setVelocity(mb,{x:v.x+nx*J*s.im,y:v.y+ny*J*s.im});
  if(s.ii&&s.cr)Matter.Body.setAngularVelocity(mb,(mb.angularVelocity||0)+s.cr*J*s.ii);
  if(Matter.Sleeping)Matter.Sleeping.set(mb,false);
}
// 沿 n 把两个物质点的相对速度投影成 0。onlySep=true 时只在「正在分离」时才动手
// —— 轻绳的单边语义：会拉，绝不推。
export function conProj(h0,px0,py0,h1,px1,py1,nx,ny,onlySep){
  var s0=conSide(h0,nx,ny,px0,py0),s1=conSide(h1,nx,ny,px1,py1);
  var kk=(s0?s0.k:0)+(s1?s1.k:0);
  if(!(kk>1e-12))return 0;
  var vr=conVel(h1,px1,py1,nx,ny)-conVel(h0,px0,py0,nx,ny);
  if(onlySep&&!(vr>0))return 0;
  // 符号约定（别改）：n 由 e0 指向 e1，vr = (v1−v0)·n（>0 = 两端在远离）；J = 施加在 h0 上沿 +n 的冲量
  //   ⇒ Δv0·n = +J/m0、Δv1·n = −J/m1 ⇒ vr' = vr − J·kk，令 vr'=0 得 J = +vr/kk。
  //   写成 −vr/kk 会让 vr' = 2·vr，每帧把分离速度翻倍（悬挂载荷 1.5s 掉 287px），而代码照常运行不报错。
  var J=vr/kk;
  conPush(h0,s0,nx,ny,J);
  conPush(h1,s1,nx,ny,-J);
  return J;
}
// 位置修正用的「动得了的程度」（只要 1/m，与转动无关）。
// allowGrab 只给轻绳/铰链的位置修正开口：拖拽端在冲量通道（conSide）里仍当无穷大质量（不跟指针抢）；
//   但若位置通道也把它归零，就没有任何通道能把它拉回，指针每帧外搬一点，d 一路涨到 368px（脱离物体还拖一根线）。
// 让拖动端按 1/m 参与 conPull 的位移分配：两端都可动 ⇒ 一起走；另一端是铁砧 ⇒ 全由拖拽端吸收。
// 不要改用「求解器末端另加夹子否决越界位移」：它绕过 CON_MAXSTEP 平滑收敛，与 Matter 自走形成正反馈，
//   帧内修正量单调增长（20.8→219.7px），还会把被拖物体顶进铁砧。
export function conMov(h,allowGrab){
  if(!h||!h.mb||h.dead)return 0;
  if(h.kind==='S')return 0;
  if(!allowGrab&&grab&&grab.kind==='body'&&grab.obj===h)return 0;
  if(rodLenFrozen(h))return 0;
  var im=(h.mb.inverseMass!=null)?h.mb.inverseMass:0;
  return im>0?im:0;
}
// 把两锚点沿连线拉近（按 1/m 分配位移，限幅 maxStep）。
// setPosition 只能传两参：第三参会把位移当速度传送，凭空注能。
export function conPull(h0,px0,py0,h1,px1,py1,target,maxStep,allowGrab){
  var dx=px1-px0,dy=py1-py0,d=Math.hypot(dx,dy);
  if(!(d>1e-4))return 0;
  var w0=conMov(h0,allowGrab),w1=conMov(h1,allowGrab),sw=w0+w1;
  if(!(sw>0))return 0;
  var ux=dx/d,uy=dy/d;
  // target 必须显式传入：轻绳的目标是 len（绷直后停在 len），铰链的目标是 0（两锚点重合）。
  //   若写死成 0，轻绳一绷直就被当铰链往重合处拉（载荷被往上提、两端交叉后另一端被推飞）。
  //   这里只做「超出多少就收回多少」。
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
 * 松手那一刻的速度也要落在约束可行域里。
 * 位置收口（conDragConstrain）只在拖拽期运行；pointerup 会把指针速度原样抛出（~3200px/s ⇒ 53px/帧），
 * 而约束每帧最多拉回 CON_DRAG_STEP=48px ⇒ 位置修正与速度对拉，表现为松手后「拉出一根线 + 抖」。
 *
 * 做法：先把速度投影到约束的可行方向，而不是事后拽回：
 *   · 铰链（锚点必须停在销上）⇒ 只留绕销的转动分量：v := ω ẑ×r，ω=(r×v)/|r|²，丢掉径向分量
 *     （与杆端投影同一个式子）。
 *   · 轻绳（锚点到挂点距离 ≤ len）⇒ 只在绷直且正往外跑时丢掉向外的径向分量；
 *     松弛、向内收、切向摆一概不碰。
 * 另一端可动时的规则见下方分支。
 */
export function releaseConstrainVel(B){
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
        // 另一端可动 ⇒ 速度也要传过去（与 conDragConstrain 的位置规则一致）。
        //   不能指望 hingeSolve 的冲量投影（conProj）：偏心锚点 k = 1/m + (r×n)²/I，销在 80px 方块边中点时
        //   (r×n)²/I = 40²·0.0067 = 10.7，而 1/m 只有 0.14 —— 冲量 98% 变成自转，线速度几乎没变，
        //   松手后拖拽端飞走、另一端不动。
        //   铰链 = 刚性连杆 ⇒ 直接给另一端同速度（两端 ω 为 0 时销点速度自然相等）；
        //   绷直的绳 ⇒ 只补「正在分离」的径向相对速度（绳不管切向）。
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
// 才让约束唯一决定拖拽端的位姿（见 conDragConstrain）。
export function hostIsAnvil(h){
  if(!h||!h.mb)return true;
  /* 正在被拖拽、位置归指针的体在杆链求解里也当铁砧（不许被约束搬走，否则破坏指针权威）。
   * 由 rodDragPinChain 临时打标。 */
  if(h._dragPin)return true;
  if(h.mb.isStatic||h.fixed)return true;
  if(rodLenFrozen(h))return true;
  return false;
}
// 「还能被约束搬动」= W 体（位置驱动体，见 stepMatter 里 W 的分工）且不是铁砧。
// 只对 W 开放：非 W 动体的位置归 Matter 积分，直接写字段会被下一帧覆盖，形成两个写者互相追打。
export function hostMovableByConstraint(h){
  if(!h||!h.mb)return false;
  if(h.kind!=='W')return false;
  return !hostIsAnvil(h);
}
/*
 * 拖拽期的权威摆放先满足轻绳/铰链约束 —— 必须是精确投影（唯一解），不能是按质量分配。
 *
 * 根因是过约束：指针把抓取点钉在世界某点（2 个方程），销钉把锚点钉在另一点（2 个方程），
 * 刚体只有 3 个自由度（x,y,th）⇒ 一般无解。两个写者（stepMatter 按指针摆、conPull 按销拉回）
 * 互相追打成极限环；任何按质量分配的平滑收敛都不可能收敛（只改每步走多远，不改无解）。
 * （实测夹具：拖 B 绕固定 A 的铰链，d 每帧变大、B.th 转到 −72.6°、B.x 来回跳 ±100px。）
 *
 * 解法：另一端是铁砧时销/挂点在世界系里不动，「锚点落在销上」对 (x,y) 有唯一解（th 仍自由，
 * 被拖物体照样能绕销转）。精确投影：
 *   · 铰链：B.pos += (q − p)          ⇒ 锚点精确落到销上（d ≡ 0）
 *   · 轻绳：越界时 B.pos −= v·(L−len)/L ⇒ 锚点落在半径 len 的圆上；L ≤ len 时不动（松弛态自由拖）。
 * 只动 (x,y)、不动 th，改完即止，没有第二个写者。
 * 另一端可动（自由物体）时方程组有解，在下方分支直接把另一端拉过来（拖一个，另一个跟着走）。
 *
 * 调用点：stepMatter 里 W 体的每帧权威摆放（以及 pointermove 的同款分支）。
 * 返回 null = 没有约束需要投影；否则返回投影后的 {x,y}。
 */
export function conDragConstrain(B){
  if(!B||!B.mb||B.kind==='T')return null;
  var moved=false;
  for(var i=0;i<bodies.length;i++){
    var S=bodies[i];
    if(S.dead||!S.anc)continue;
    // 轻质杆（kind 'T'）也走同一条拖拽规则：两端锚定时它是刚体连杆，
    //   漏掉会导致拖快时杆变长 / 异常抖动。
    var isS=(S.kind==='S'&&(S.rope||S.hinge));
    var isT=(S.kind==='T');
    if(!isS&&!isT)continue;
    for(var j=0;j<2;j++){
      var a=S.anc[j],oh=S.anc[1-j];
      if(!a||a.B!==B)continue;
      if(!oh||!oh.B)continue;                  // 只有一端锚定 ⇒ 自由端无载荷，不约束拖拽摆位
      if(oh.B===B)continue;                    // 两端都在被拖的物体上：没有「另一端」可言
      var p=springAnchoredWorld(S,j);          // 本端锚点（按指针摆出来的位姿算）
      var q=springAnchoredWorld(S,1-j);        // 另一端锚点
      if(!p||!q)continue;
      var dx=p.x-q.x,dy=p.y-q.y,d=Math.hypot(dx,dy);
      if(!(d>1e-6))continue;                   // 两端重合：方向未定，无从投影
      var need;
      if(isT){
        /* 轻质杆是刚体连杆，拖拽规则必须覆盖它，且是双向的（拉长与压短都算越界）；
         * 目标长度取 _rodL（有意设定的长度，见 rodSyncAnchors 双端分支）。
         * 否则指针每帧整份覆盖被抓方块位姿、杆的纠正每子步只还 24px 又被覆盖 ⇒ 拖动期杆长在
         * 120↔204 之间来回写，表现为抖动、另一物体垂到地上。
         * 分配规则与下方相同：另一端可动 ⇒ 拉过来；另一端是铁砧 ⇒ 反向钳位拖拽端。
         * 位移量精确等于越界量 ⇒ 本帧结束时 d 恒等于目标。 */
        //   杆没有 e0/e1（几何真值是 x/th/len）⇒ 不能调 springSyncEnds（会在 springSetEnd 里读
        //   undefined.e0）；杆的位姿由同一帧子步的 rodSyncAnchors 摆正。
        var tl=(S._rodL!=null&&S._rodL>0)?S._rodL:(S.len||170);
        need=d-tl;
        if(!(Math.abs(need)>1e-4))continue;    // 已满足（±1e-4）⇒ 指针说了算
      }else{
        need=S.hinge?d:(d-(S.len||0));         // 要缩短多少：铰链 ⇒ 全量；绳 ⇒ 只收越界量
        if(!(need>1e-4))continue;              // 铰链 d≈0 / 绳在长度以内 ⇒ 指针说了算
      }
      var ux=dx/d,uy=dy/d,mvx=ux*need,mvy=uy*need;
      // 「谁能动，谁吸收」—— 两条分支是同一个位移量，只是施加在哪一侧：
      //   · 另一端可动 ⇒ 把它沿 p→q 拉过来 need ⇒ 拖一个、另一个同步跟走；本帧结束时 d 恒等于 target。
      //   · 另一端是铁砧 ⇒ 反向施加在拖拽端上（钳位）⇒ 绳不可伸长 / 销钉刚性。
      //   不能交给 conPull 分配：拖拽端位姿下一帧会被指针整份覆盖，分给它的那一半白做，
      //   d 每帧残留越界量（实测拖拽期 dmax=46.6px，即 CON_DRAG_STEP 饱和值）。
      if(hostMovableByConstraint(oh.B)){
        var O=oh.B;
        O.x+=mvx;O.y+=mvy;
        if(O.mb){
          Matter.Body.setPosition(O.mb,{x:O.x,y:O.y});
          Matter.Sleeping.set(O.mb,false);
          /* 不要在这里清另一端速度（setVelocity(0,0)）：每帧清零会把可动端的切向钟摆速度一并杀掉，
           * 下面的杆和物体无法自由摆动（只会缓慢蠕行）。径向一致性由每子步的速度投影 + 位置相位守住。 */
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

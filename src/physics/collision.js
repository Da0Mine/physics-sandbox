/* 圆 / 环的解析碰撞（替换 Matter 的 SAT） */
import Matter from 'matter-js';

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
export let _ringTok=0, _ringHit={};
export const _ringSig={};
export let _ringDedupOK=false;

export function setupPhysicsCollision(){
  (function(){
    var _collides=Matter.Collision.collides;
    // —— 先安装 token 推进器（放在 collides 之前，装不上就去重自动停用）——
    if(!Matter.Engine._ringTokWrap){
      var _engUpd=Matter.Engine.update;
      Matter.Engine.update=function(eng,delta){
        if(++_ringTok>1e9){_ringTok=1;_ringHit={};}   // 溢出保护（240 子步/s 下 ≈48 天）
        return _engUpd.apply(this,arguments);
      };
      Matter.Engine._ringTokWrap=true;
      _ringDedupOK=true;
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
        var rky=rctr.id+':'+cbo.id, rsig=cbo.position.x;
        if(_ringDedupOK&&_ringHit[rky]===_ringTok&&_ringSig[rky]===rsig)return null;
        _ringHit[rky]=_ringTok; _ringSig[rky]=rsig;
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
}

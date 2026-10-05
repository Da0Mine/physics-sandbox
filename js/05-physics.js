/* 物理步进、碰撞、传送带牵引、悬停检测（原 index.html 第 7961–8969 行） */
/* ★R131-42：被 a 赋予「持续加速度」的物体每帧受力（v += a·dt）——
 *  与重力同量级持续作用；时间静止时本函数不跑 ⇒ 自然停住。 */
/* ★★R131-60：**必须逐子步调用**，不能每帧一次。
 *  `_m*ax/1e6` 这个系数是按 **1000/240 子步**标定的（Matter 的
 *  `Δv[px/s] = force/mass · dt_ms² · 240` ⇒ 要得到 ax px/s²，force/mass 必须是 ax/1e6）。
 *  但 **Matter 在每次 Engine.update 结束后就清掉 body.force** ⇒ 每帧只施力一次时，
 *  一帧 4 个子步里**只有第 1 个子步吃到** ⇒ 实际加速度只有给定值的 **1/4**（实测 0.258/0.225）。
 *  后果：面板上限 6000（≈23 m/s²）实际只有 ≈5.8 m/s² < g=10 m/s² ⇒
 *  **物体调到最大也永远飞不起来**（用户：「我给了大于重力加速度的加速度向上，但它并没有飞起来」）。
 *  修：调用点搬到 stepMatter 的子步循环里（每个子步施力一次）。dt 形参不用（量纲已含在系数里）。 */
function applyGivenAccel(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||!B.accGive||!B.mb||B.mb.isStatic)continue;
    var ax=B.accX||0, ay=B.accY||0;
    if(!isFinite(ax)||!isFinite(ay))continue;
    /* ★★R131-45（用户：「a 赋予圆后运动一卡一卡的，动一下停一下」）：真因=这里每帧
     *  **强制 setVelocity（用自己维护的 B.vx/B.vy）+ 反复 Sleeping.set(false)** ——
     *  与 Matter 的积分互相覆盖（Matter 刚积出来的速度被我们下一帧写回去），且每次唤醒
     *  都会重置睡眠计时 ⇒ 表现为"抖一下停一下"。
     *  修：**直接用 Matter 的力通道**（applyForce），不再自己维护速度、不再反复唤醒。 */
    var _m=B.mb.mass||1;
    Matter.Body.applyForce(B.mb,{x:B.mb.position.x,y:B.mb.position.y},{x:_m*ax/1e6,y:_m*ay/1e6});
    if(B.mb.isSleeping)Matter.Sleeping.set(B.mb,false);
  }
}
function stepPhysics(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.kind==='B'||B.kind==='E')continue;
    if(B.bh)continue;   // black holes (any stage) are handled by stepBlackHole, not normal physics
    if(grab.kind==='body'&&grab.obj===B)continue;
    // R98-3：拖长度手柄期间杆的位姿归指针 —— 重力、a 推力、阻尼、积分全部让位
    // （漏这一条的表现：按住端点不动，杆自己往下掉，用户看着像「手柄松了」）。
    if(rodLenFrozen(B))continue;
    if(B.kind==='W')continue;   // boundaries are integrated by the Matter layer (stepMatter)
    if(B.shatterBlast){
      // mc² explosion blast: the whole body shatters into its own letters (already flung out
      // with a big outward kick whose speed decays fast via B.decay)
      B.shatterBlast=false;
      shatter(B,'split');   // letters inherit the outward kick; freeL damping decays it fast
      continue;
    }
    // R71⑫（用户：「把字符 g 放下后，右键它，他就会自动往下坠」）：一个**孤零零的 g** 是重力
    // 这个**参数本身**的可视化控件，不是一块有重量的物体。但 promoteFreeLetter 沿用了「含 g 的
    // 体就有重力」的规则把 hasG 置真 —— 于是松开手还好好浮着的 g，一右键（被 promote 成 body）
    // 就开始掉。对照其它参数字母：孤立的 r/a/v/m/μ 都因为不设 hasG 而浮在原地，只有 g 是异类。
    // 这里把「只有 g 一个字形、且不是质量体、也没有 kind」的体从重力通道里摘出去（保持浮空），
    // 而**不动 hasG 本身** —— hasG 还兼职「g + t -> gt」的组合判定（见 findTComboTarget），
    // 摘掉标志会让「先放下 g、再把 t 拖上去」这条组合路径失效。
    // R102（用户：「那个轻质杆是没有质量的（所以不受重力）」）：轻质杆从重力通道里摘出去。
    //   makeRod 当初写的是 `B.hasG=true`（注释原话「weighs & falls to rest, like a real plank」），
    //   那是把杆当成**有重量的木板**做的；而「轻质杆」在物理题里的定义就是**质量可忽略** ⇒
    //   没有重量、不受重力。用户这次要的就是这个语义。
    // ★为什么只在这里加 `kind!=='T'` 而不是去改 makeRod 的 hasG：本函数上方的注释（R100①）
    //   写明「rodIntegrate 不含重力，这里（stepPhysics）是杆**唯一**的重力来源」⇒ 摘这一处就够；
    //   hasG 同时还兼职别处的判定（见 findTComboTarget 那条注释），动它会牵连不相干的路径。
    // ★可以预期的连带效果：杆**还**保留阻尼与碰撞，所以「推动它」照旧；只是松手后它不再自己
    //   往下掉，而是**停在松手的位置**（这正是「无质量」该有的样子）。
    // ★顺带治掉的正是用户报的另一条：锚定端抽搐 —— 见 rodSyncAnchors 里那段「重力每子步给 vy
    //   加一点，投影又把那份位移吃掉」的对拉（R100① 实测锚端残差峰值 13.8px = v/60）。
    if(B.hasG&&B.kind!=='T'&&!isGravityLetterOnly(B))B.vy+=((B.grav!=null)?B.grav:GRAV)*dt;
    if(B.hasA){
      var th=B.th||0;
      var aA=(B.acc!=null)?B.acc:AACC;
      B.vx+=-aA*Math.cos(th)*dt;
      B.vy+=-aA*Math.sin(th)*dt;
    }
    /* ★★R132-9q（用户：「q 字符运动没有阻力（一动就一直动）」）：
     *   原来是 `if(B.kind!=='q'){B.vx*=damp;B.vy*=damp;}` —— **q 被整条摘在阻尼之外**。
     *   而 q 场源体**也没有重力**（`B.hasG` 不成立 ⇒ 不进上面 `B.vy+=g·dt` 那一行）
     *   ⇒ 既不下沉、也不减速：甩出去就一路滑到底。实测（`_tmp_r362_qdrag.py`，
     *   初速 1200px/s）：0.75s 内**逐帧衰减系数恰好 1.00000**（匀速滑了 900px），
     *   撞墙反弹成 −600px/s 之后**仍然零衰减**地再滑 1s。
     *   修法：q 用**和自由字符同一套**的阻尼（`0.94^(dt·60)` ≈ 5.4%/帧）——
     *   「字符级」手感一致，不另造常数；其它体维持 0.9992（近乎无阻尼）**一字不动**。
     *   作用域只有 `kind==='q'`：q 字母被右键 promote 成的电荷体、以及被丢在空白处
     *   生成的 q 场源体（`spawnField('q')`）。B/E 场源在函数开头就被 `continue` 掉了。 */
    var damp=(B.kind==='q')?Math.pow(0.94,dt*60):Math.pow(0.9992,dt*60);
    B.vx*=damp;B.vy*=damp;
    // R100①：杆的**位置积分只归 rodIntegrate**（240Hz 子步，与镜像板同步同一节拍 —— 见
    // stepMatter 里 R73-G 那段的理由）。这里原来把杆一起搬，于是杆被积分**两次**：
    // 实测（_tmp_probe_rod7.py，关掉每体重力、给初速度、钩住 rodIntegrate 比位移）
    //     integ : observe = 1 : 2.05
    // 后果①：杆的落体/滑动速度约为正常的两倍（重力每帧在这里 + 每子步在 rodIntegrate 各推进一次）；
    // 后果②：R100① 把杆端锚到物体上之后，这里每帧还把杆搬 v·(1/60)，而锚点约束每子步拉回来
    //        ⇒ 两者永久对拉，实测锚端残差峰值 **13.8px = v/60**（v≈829px/s，逐位吻合）。
    // 重力与阻尼仍留在本函数（rodIntegrate 不含重力，这里是杆**唯一**的重力来源），只把位移让出去。
    // walls(B) 照旧（杆左右墙/地面的细活另在 rodResolve 里，这是既有分工，本轮不动）。
    if(B.kind!=='T'){B.x+=B.vx*dt;B.y+=B.vy*dt;}
    walls(B);
  }
    for(var k=0;k<freeL.length;k++){
    var d=freeL[k];
    /* ★★R131-59：**被拖的字符**一律跳过自身积分 —— 原来要求 `d.state==='grab'`，而 gdDown
     *  给自由字符设的是 `state='free'`（R131-51 放宽后这就是常态）⇒ 条件几乎永不成立 ⇒
     *  字符带着**上一次抛出的残余速度**一边被指针摆位、一边自己继续积分 ⇒ 从指针下"滑走"
     *  （实测拖拽中每 30ms 领先指针 13~19px；刚抛过的字符直接飞出去 = 用户说的"抓不动"）。
     *  与上面 body 分支（`grab.obj===B ⇒ continue`）同一语义：拖拽期间位置归指针。 */
    if(grab.kind==='letter'&&grab.obj===d)continue;
    var massless=!!d.massless;
    var fdmp=massless?Math.pow(0.45,dt):Math.pow(0.94,dt*60);
    d.vx*=fdmp;d.vy*=fdmp;
    d.x2=d.wx+d.vx*dt;d.y2=d.wy+d.vy*dt;
    d.wx=d.x2;d.wy=d.y2;
    if(d.wx<20){d.wx=20;d.vx=Math.abs(d.vx)*0.6;}
    if(d.wx>W-20){d.wx=W-20;d.vx=-Math.abs(d.vx)*0.6;}
    if(d.wy<20){d.wy=20;d.vy=Math.abs(d.vy)*0.6;}
    if(!massless&&d.wy>groundY-8){d.wy=groundY-8;d.vy=-Math.abs(d.vy)*0.6;}
    // R68⑥（用户：「很多那些符号怎么不被那些物体所阻挡，或者说碰不到那些？」）
    // 自由字母（k / x / ½ / c / G / t … 这类没有参数面板、因此不会 promote 成 body 的符号）
    // 此前只与屏幕四壁和地面打交道，完全不认识用户画的 W 体 / 杆 / 弹簧 —— 扔过去直接穿
    // 过去（已 promote 成体的符号走 collideBodies 的 bndHit 通道，是会被挡住的，实测 mv²
    // 撞上竖板后 vx 由 +600 翻成 −294）。这里给自由字母补上同一套接触：n 由边界指向字母，
    // 沿 n 推出 ov 解重叠，再抹掉法向速度（净效果 = 停在表面上、被挡住不再前进）。
    // 注意：这里**不加重力** —— 符号是浮空标签，给重力会让每个字母一松手就掉走、拼不成
    // 公式（实测 24 套回归全挂，GMm / mv²r 这类多字母组装全部失败）。
    var _noBound=(d.ch==='v'||d.ch==='q'||d.ch==='t'||d.ch==='a');   // ★R131-42：四类赋予型字符不受物体边界影响
    if(!massless&&!_noBound){
      var fc=freeLetterContact(d);
      if(fc){
        d.wx+=fc.nx*fc.ov;d.wy+=fc.ny*fc.ov;
        var fvn=(d.vx||0)*fc.nx+(d.vy||0)*fc.ny;
        if(fvn<0){d.vx-=fc.nx*fvn;d.vy-=fc.ny*fvn;}
      }
    }
  }
}
// R68⑥：自由字母 vs 实体（W 体 / T 杆 / S 弹簧）的最深接触。bndHit 要一个带 glyphs 的
// 「另一侧」对象，这里复用同一个壳子只改字段，避免每帧每字母都新建字面量。
var _flProxy={x:0,y:0,th:0,sc:1,glyphs:[null],kind:null,bh:null,vx:0,vy:0,hw:12,hh:11};
function freeLetterContact(d){
  if(!d||d.dead)return null;
  var mm=d.m||null;
  var iw=mm?((mm.ir!=null&&mm.il!=null)?(mm.ir-mm.il):(mm.w||16)):((d.el&&d.el.offsetWidth)||16);
  var ih=mm?((mm.bot!=null&&mm.top!=null)?(mm.bot-mm.top):((d.el&&d.el.offsetHeight)||22)):22;
  _flProxy.x=d.wx;_flProxy.y=d.wy;_flProxy.vx=d.vx||0;_flProxy.vy=d.vy||0;
  _flProxy.hw=Math.max(4,iw/2);_flProxy.hh=Math.max(4,ih/2);
  _flProxy.glyphs[0]=d;
  var best=null;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead)continue;
    // 只认 W 体：bndHit 第一参数要过 bndSegs→bndPts（读 B.pts），而 T 杆 / S 弹簧没有 pts
    // （杆在 collideBodies 里走的是 SAT 分支、弹簧走镜像板），传进去会直接抛
    // "Cannot read properties of undefined (reading 'length')" —— r45 里就是这个崩的。
    if(B.kind!=='W'||!B.pts||B.pts.length<2)continue;
    var wr=bndHit(B,_flProxy);
    if(wr&&(!best||wr.ov>best.ov))best=wr;
  }
  _flProxy.glyphs[0]=null;
  return best;
}
function bodyHitSpeed(B,comp){
  var v=(comp==='x')?B.vx:B.vy;
  return Math.abs(v);
}
function shatter(B,mode){
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  var cx=B.x,cy=B.y;
  var S=Math.hypot(B.vx,B.vy)||1;
  var ux=-B.vx/S,uy=-B.vy/S;
  var px=-uy,py=ux;
  var base=S*0.275,spread=S*0.275;
  // structural glyphs (brackets / superscripts / bars) are always discarded
  for(var sk=B.glyphs.length-1;sk>=0;sk--){if(B.glyphs[sk].stk)killG(B.glyphs[sk]);}
  var lets=[];
  if(B.massG)lets.push(B.massG);
  for(var j2=0;j2<B.mem.length;j2++)if(B.mem[j2]!==B.massG)lets.push(B.mem[j2]);
  if(mode==='split'){
    // the body breaks into ITS OWN letters (e.g. mv² -> m, v, v) — reusable pieces
    for(var q=0;q<lets.length;q++){
      var L=lets[q];
      if(L.body===B){L.body=null;L.inBody=false;}
      L.pop=0;
      var off=(q-(lets.length-1)/2)*28;
      freeLetter(L,cx+px*off,cy+py*off, ux*base+px*spread*off/28, uy*base+py*spread*off/28, false);
    }
  }else{
    for(var j=0;j<lets.length;j++){
      var g=lets[j];
      if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}
    }
  }
  B.glyphs=[];B.mem=[];
  if(mode==='formula'){
    // ½mv² wall smash — three preset outcomes by probability:
    //  0.4  full elastic-collision pair (v₁′/v₂′ with (m₁−m₂)v₁+2m₂v₂ numerators)
    //  0.3  simplified pair: v₁′=(m₁−m₂)/(m₁+m₂)·v₁  and  v₂′=2m₁/(m₁+m₂)·v₁
    //  0.3  single common-velocity formula v_共=(m₁v₁+m₂v₂)/(m₁+m₂), flying back the way it came
    var roll=Math.random();
    if(roll<0.4){
      spawnFormula(1,cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
      spawnFormula(2,cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
    }else if(roll<0.7){
      spawnFormula(3,cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
      spawnFormula(4,cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
    }else{
      // 原路返回: (ux,uy) already points AGAINST the incoming velocity, i.e. back along
      // the way the body came — fly the single formula back out along that path.
      spawnFormula(5,cx,cy,ux*base*0.8,uy*base*0.8);
    }
  }else if(mode==='labels'){
    spawnText('m₁v₁′',cx+px*26,cy+py*26, ux*base+px*spread, uy*base+py*spread);
    spawnText('m₂v₂′',cx-px*26,cy-py*26, ux*base-px*spread, uy*base-py*spread);
  }
  ringGo(cx,cy);
}
function walls(B){
  if(B.kind){
    if(B.kind!=='T')return;
    // t-rod: a solid plank — rest on the ground, bounce off the screen edges, keep rotation
    // R101①：**地面这一边不能再自己定口径**。半高必须用杆的墨迹半厚 ROD_HH(=2)，与
    //   rebuildRodMirror 建板（高 2·ROD_HH）和 rodResolve 的接触判据同源；用 B.hh(=4)
    //   会把杆撑到离地 2px 的缝里，rodResolve 从此永不触发 ⇒ 每帧落 0.7px 再被拍回（锯齿）。
    //   且这里**不反弹**（原来是 −|vy|×0.5 且 |vy|≥60 才生效 = 地面蹦床）：杆的支撑在
    //   rodResolve 里本来就是 e=0（「支撑不反弹」），口径分开写就会一个托住、一个弹起来。
    //   这一支现在只是**深穿透安全网**（正常的贴地全在 rodResolve 里逐子步解）。
    var lenh=B.len/2,c=Math.abs(Math.cos(B.th)),s=Math.abs(Math.sin(B.th));
    var ex=lenh*c+ROD_HH*s,ey=lenh*s+ROD_HH*c;
    if(B.y-ey<-8){B.y=-8+ey;B.vy=Math.abs(B.vy)*0.5;if(Math.abs(B.vy)<60)B.vy=0;}
    if(B.y+ey>groundY){B.y=groundY-ey;if(B.vy>0)B.vy=0;}
    if(B.x-ex<-8){B.x=-8+ex;B.vx=Math.abs(B.vx)*0.5;if(Math.abs(B.vx)<60)B.vx=0;}
    if(B.x+ex>W+8){B.x=W+8-ex;B.vx=-Math.abs(B.vx)*0.5;if(Math.abs(B.vx)<60)B.vx=0;}
    return;
  }
  var sc=B.sc||1;
  var hw=(B.hw||20)*sc,hh=(B.hh||18)*sc;
  var el=B.hasV,e=el?0.92:0.28;
  if(B.bounc!=null)e=B.bounc;
  // R52: mg 是"重力"预设（friction:0.01 → 地面摩擦极小，像冰面），m(g+gμ) 是默认摩擦。
  // 无论有没有 μ 字母，摩擦力都只在"贴地/贴墙"时施加，避免空中乱衰减。
  if(B.hasMu||B.frict!=null){
    var fk=(B.frict!=null)?B.frict:(B.hasMu?0.10:0);
    // 只有贴着地面/墙壁时摩擦才作用（判断四边接触）
    var touch=((cyp+hh)>=(groundY-0.5))||((cyp-hh)<=(-8+0.5))||((cxp-hw)<=(-8+0.5))||((cxp+hw)>=(W+8-0.5));
    if(touch){
      B.vx*=(1-fk);B.vy*=(1-fk);
    }
  }
  var ox=0,oy=0;
  if(B.orb&&B.orb.k>=0.02&&B.orb.gx!=null){ox=B.orb.gx-B.x;oy=B.orb.gy-B.y;}
  var cxp=B.x+ox,cyp=B.y+oy;
  function shatterIfFast(sp){
    if(sp<SHATTER_SPEED)return false;
    if(B.hasC&&B.cCount>=2){
      return false;   // mc² never shatters on a wall — it just bounces off (then inflates/explodes)
    }
    if(B.hasHalf&&B.vCount>=2){
      shatter(B,'formula');   // ½mv² keeps its elastic-collision formula shards (preset)
      return true;
    }
    // EVERY other lettered whole (mv, mv², mg, GMm/r² well, ...) breaks into its OWN letters
    if(B.massG||B.mem.length){
      shatter(B,'split');
      return true;
    }
    return false;
  }
  if(cyp-hh<-8){
    if(shatterIfFast(Math.abs(B.vy)))return;
    cyp=-8+hh;B.vy=Math.abs(B.vy)*e;if(!el)B.vx*=0.4;
  }
  if(cyp+hh>groundY){
    if(shatterIfFast(Math.abs(B.vy)))return;
    cyp=groundY-hh;B.vy=-Math.abs(B.vy)*e;if(!el)B.vx*=0.35;
  }
  if(cxp-hw<-8){
    if(shatterIfFast(Math.abs(B.vx)))return;
    cxp=-8+hw;B.vx=Math.abs(B.vx)*e;if(!el)B.vy*=0.55;
  }
  if(cxp+hw>W+8){
    if(shatterIfFast(Math.abs(B.vx)))return;
    cxp=W+8-hw;B.vx=-Math.abs(B.vx)*e;if(!el)B.vy*=0.55;
  }
  B.x=cxp-ox;B.y=cyp-oy;
}
/* ================= R99 传送带（器件）：**表面牵引** ===================================
 * 实测前提（_diag_r99a_belt.py，先量后改，别凭猜）：
 *   ① 公式体**没有 Matter 镜像**（实测 khasMb=false）—— 它与 W 的接触只走下面 collideBodies
 *      里 bndHit 那条手写 SAT 通道。Matter 社区那套「给静态体 setVelocity 当传送带」的技巧
 *      对它完全无效：实测 mb.velocity 稳稳保持 (2,0)，物块 Δx 仍是 **0.00**（M0/M1/M2 三组全 0）。
 *   ② 那条手写通道原本**只有法向响应**（穿透推出 + vn 反弹），**没有任何切向耦合** ——
 *      所以哪怕把表面速度喂进 rvx/rvy 也只是改写了扫掠的相对位移，带不动东西。
 *   ⇒ 牵引必须在这里显式加；加在别处（Matter 侧 / rvx 侧）都不是这一条路上的写入点。
 * 模型：把对方的**切向**速度朝「带面速度」指数松弛（时间常数 BELT_TAU）。
 *   · 只改切向（法向留给正常冲量）⇒ 物体不会被吸进带子、也不会被弹起；
 *   · 指数松弛而非「瞬间等于带速」⇒ 保住惯性感（放上去是一段加速过程，不是瞬移）；
 *   · μ=0 时不牵引：μ 取**带子自己**的 wfrict（paramV 口径），与高中模式 μ=0 同一条默认链。
 */
var BELT_TAU=0.10;              // 秒：表面牵引的松弛时间常数（越小抓得越急）
// R100：Matter 那条路（W-vs-W）单独一个「抓力」时间常数，比公式体那条**更紧**。
// 理由（_diag_r100c_flow.py 实测，同一条带子 conv=260、球从上方落下、取安定后 1.2s 末段）：
//   公式体：没有转动耦合、也就没有滚动阻力 ⇒ 稳态 258.7px/s ≈ 带速 100%（R99 已验收）。
//   圆球  ：那时（R100 实测）稳态由「牵引速率」与「滚动摩擦」的平衡决定（applyWRoll 每子步
//           ω×=0.99，且纯滚动段**同时**磨 v ⇒ 约 4%/帧的动量流失）。
//           · τ=BELT_TAU=0.10 ⇒ 平衡在 ~120px/s，只有带速的 46%；
//           · τ=BELT_GRIP_TAU=0.02 ⇒ 平衡在 ~230px/s（带速的 ~88%）。
//           ★R115：滚动摩擦整条链已按用户要求删除 ⇒ 上面这条「平衡」**不再存在**，
//             球的稳态应**更接近带速**（没有每帧 4% 的动量流失了）。常量仍取 0.02 ——
//             它当初是为了躲开「球相对带面往回滚」的观感，删掉滚动摩擦只会让球更跟得上
//             带子，不会把那个观感带回来，所以保守不动。★真值待 _probe_r99/_probe_r100 复测。
//   取 0.02：传送带是**机器**，带面抓力本就该赢过一颗球的滚动阻力；46% 那个档位下，
//   球相对带面看起来是往后的（正是用户抱怨的「往回滚」的观感来源），必须避开。
//
// ★R101②（用户：「传送带的箭头动画是不是太快了，和其实际的传送速度不符」）——定值 0.02 → 0.004。
//   先量**动画本身**：纹路相位速率 +262.4 px/s vs conv=260（误差 0.9%，纹路周期
//   BELT_DECO_STEP=26px）—— 动画速度是准的，用户看到的「不符」不是它算错。
//   真正不符的是**货**：被带走的物件只走到带速的 96%（圆）/ 94%（方块），即箭头每 ~2s
//   就超货一整格 —— 看起来就是「箭头比东西跑得快」。
//   为什么贴不到 100%：Matter 对 W-vs-W 的摩擦**把带子当地面**（见 beltDragMatter 的 ★），
//   它每帧把接触点切向速度往 0 拉，与这里注入的「往带面速度拉」顶牛；τ 越大，被顶回来的越多。
//   实测（`_diag_r101e_grip.py`：长带 1200px，只取「已落在带面且已加速到位」的窗口，
//   读数 = 稳态 v / 带速，圆 ÷ 方块）：
//     τ=0.02 → 96% / 94%    | τ=0.008 → 99% / 99%    | τ=0.004 → 100% / 100%
//     τ=0.002 → 100% / 100% | τ=0.001 → 100% / 100%
//   高速档（conv=1040 = 4 m/s）同样 100% / 100%，y 峰峰 0.00–0.01px（不炸、不甩出、不发散）。
//   取 **0.004**：两个形状 × 两档带速都到 100%，且比 0.002 留了余量（k=1−e^(−dt/τ)=0.985，
//   不是把切向速度硬写成带速的「运动学钉死」）。
//   注：这条**不动**打滑语义 —— 光滑带（μ=0）在两条牵引通道的入口早退里就整段跳过了，
//   `_probe_r99` 组 D（μ=0 时物块原地不动）照旧绿。
var BELT_GRIP_TAU=0.004;
function beltSurfVel(B){
  if(!B||!B.conv)return null;
  var th2=B.th||0;
  return {x:Math.cos(th2)*B.conv,y:Math.sin(th2)*B.conv};   // conv 沿本体 +x（随 th 旋转）
}
function beltTract(WB,oth,nx,ny,ov){
  if(!WB||!oth||!WB.conv||!(ov>0))return;
  if(oth.kind==='W'||oth.kind==='S'||oth.isWell||oth.bh)return;   // 这条通道里不可推动的一方
  var mu=paramV(WB,'wfrict');
  if(!(mu>0))return;                                             // 光滑带 = 打滑（与地面 μ 同义）
  var s=beltSurfVel(WB);
  var tx=-ny,ty=nx;                                              // 切向单位向量（法向转 90°）
  var vt=((oth.vx||0)-s.x)*tx+((oth.vy||0)-s.y)*ty;               // 相对带面的切向速度
  if(!vt)return;
  var k=1-Math.exp(-lastDt/BELT_TAU);
  var dv=-vt*k;
  oth.vx=(oth.vx||0)+dv*tx;
  oth.vy=(oth.vy||0)+dv*ty;
}
/* ---- R100：Matter 自管的那条接触路（W-vs-W）也要牵引 --------------------------------
 * 实测（_diag_r100b_beltball.py，干净对照：长带 600px、每个工况重建场景、落体阶段先 conv=0）：
 *   画出来的圆（W 体）在带上 conv=0 / +260 / −260 三组**全部** Δx=+0.00、vx=0、ω=0
 *   —— 完全不被带动，连符号都没有。
 * 根因：collideBodies 的 W 分支开头就把 W-vs-W `continue` 交给 Matter 求解器了，
 *   而 beltTract 只挂在 bndHit（W-vs-公式体）那条路上，从未作用于 W-vs-W。
 *   Matter 侧也没有「传送带速度」这个概念：它只认 pair.friction，而 pair 摩擦取
 *   min(双方 μ) —— 高中模式物体 μ 默认 0，会把带子自己那 0.6 一起归零。
 *   ★「给静态体 setVelocity 当传送带」这条路在本 build 里是**反的**，别再试（_tmp_sign2.py
 *     实测，球强制清醒、手写牵引静默、conv=0 完全旁路）：
 *       带子 mb.velocity.x=+260 ⇒ 球 Δx=−136.66、ω=−3.97rad/s（往左滚）
 *       带子 mb.velocity.x=−260 ⇒ 球 Δx=+130.35、ω=+4.09rad/s（往右滚）
 *     即摩擦只把「接触点相对**地面**」拉静止，带子速度只决定了反向的自旋 —— 符号与物理
 *     相反。另外静态体的速度**唤不醒睡着的球**（实测球 sleep=True 时 mb.velocity 稳在
 *     260 而 Δx=+0.00），所以这条路还得额外配一个唤醒通道才有机会生效。综上：牵引只能手写。
 * 做法：几何自算接触法向（不依赖 Matter 的碰撞数据 —— 这条分支在进入时还没算过碰撞），
 *   只在**上下带面**那一类接触上做切向指数松弛；写入走 Matter.Body.setVelocity
 *   （MU-01：velocity 属性 = 每 1/60s，真值 ×60。用 API 做换算，不手写比例，免得与
 *   impAt 的「子步位移」口径混掉 —— impAt 收的是 position−positionPrev 那种量纲）。
 * 睡觉的刚体会被 Matter 整段跳过积分 ⇒ 注入的速度不生效（实测球就是被睡死在半空的，
 *   见 stepMatter ⑤ 的 excursion 判据）——所以这里必须顺手唤醒。 */
function beltFaceTouch(WB,oth){
  var th=WB.th||0,c=Math.cos(th),s=Math.sin(th);
  var dx=oth.x-WB.x,dy=oth.y-WB.y;
  var lx=dx*c+dy*s, ly=-dx*s+dy*c;                    // 世界 → 本体（转 −th）
  var hw=WB.hw||BELT_SPAWN_LEN/2;
  if(lx<-hw||lx>hw)return null;                       // 质心不在带体横向范围内（在带子端外）
  var nyl=ly<0?-1:1;                                  // 最近的那条带面：上 / 下
  var n={x:-nyl*s,y:nyl*c};                           // 本体法向 → 世界（转 +th）
  var d=dx*n.x+dy*n.y;                                // 带心 → 对方质心，沿 n（>0 = 在那条面外侧）
  if(!(d>0))return null;
  // ★支撑半径必须问 Matter 的顶点，不能用 B.rad / B.hw —— 本项目的 Matter 体统一被
  //   BND_INK(2.325) 膨胀过：实测球的 circleRadius=28.325（rad 只有 26），带子的 Matter
  //   顶面在 587.675（名义 590）。按 rad 算会把「已接触」判成还差 4.64px 而整段拒掉
  //   （这正是本函数第一版干的事：D1 明明写了牵引，球 Δx 仍是 0.00）。
  //   改成顶点支撑：圆走 circleRadius（O(1)），多边形精确求 max(v·n)−center·n，
  //   与本体的膨胀约定无关，也不需要多加任何常数。
  if(d-beltSup(WB.mb,n)-beltSup(oth.mb,n)>2)return null;   // 够不着 → 没接触
  return n;
}
function beltSup(mb,n){
  if(!mb)return 0;
  if(mb.circleRadius)return mb.circleRadius;
  var v=mb.vertices,mx=-1e9;
  for(var i=0;i<v.length;i++){var q=v[i].x*n.x+v[i].y*n.y;if(q>mx)mx=q;}
  return mx-(mb.position.x*n.x+mb.position.y*n.y);
}
function beltDragMatter(WB,oth){
  if(!WB||!WB.belt||!WB.conv)return;                  // 不是带子 / 带速为 0 → 零成本早退
  if(!oth||oth===WB||oth.kind!=='W')return;           // 只处理刚体：杆/弹簧由位姿驱动，写了也被覆盖
  if(oth.belt||oth.fixed||oth.dead||oth.isWell)return; // 别的带子 / 钉住的机器 / 陷阱：不互相拖
  var mb=oth.mb;if(!mb||mb.isStatic)return;
  if(!(paramV(WB,'wfrict')>0))return;                 // 光滑带 = 打滑（与地面 μ 同义）
  var n=beltFaceTouch(WB,oth);if(!n)return;
  var sv=beltSurfVel(WB);
  var brv=60;                                         // MU-01：属性值 → 真值 px/s
  var tx=-n.y,ty=n.x;
  var vx=mb.velocity.x*brv, vy=mb.velocity.y*brv;
  var vt=vx*tx+vy*ty, st=sv.x*tx+sv.y*ty;             // 质心切向速度 / 带面切向速度
  // ★牵引目标 = **接触点速度**（不是质心速度）朝带面速度松弛。
  //   ① 只推质心会被 Matter 的摩擦反噬：圆球的滑动摩擦同时给出「质心加速 + 反向自旋」，
  //      两者把接触点速度拉回 0（相对**地面**静止），于是「我推质心 / 摩擦拉回来」形成
  //      拔河 —— 实测（_diag_r100c_flow.py 第一版修法）球只有 ~30–50px/s，而带速 260。
  //   ② 改成朝接触点松弛后，稳态满足 v_接触 = v_带面 ⇒ **相对滑移为 0**，摩擦项自动归零、
  //      不再反噬，且这个态是自持的（无需每帧硬顶）。
  //   ③ 转动按刚体在接触点受冲量的真实分配（dJ 在接触点 ⇒ dv=dJ/m、dω=−dJ·R/I）：
  //      slip = v_t − ωR − s_t，令 d(slip)=ΔS ⇒ dv_t=ΔS·I/(I+mR²)、R·dω=−ΔS·(1−I/(I+mR²))。
  //      λ=mR²/I（圆盘 λ=2 ⇒ dv=ΔS/3、R·dω=−2ΔS/3）。**稳态与松弛速率无关**：
  //      slip→0 的唯一终点是 v=s/3、ωR=−2s/3 —— 正是传送带上小球的课本稳态（反向自旋地
  //      被往前送）。非圆（方块）没有滚动耦合 λ→∞ ⇒ dv=ΔS：整体以带速平移，也对。
  var R=(oth.wshape==='circle'&&mb.circleRadius)?mb.circleRadius:0;
  var w=R?mb.angularVelocity*brv:0;
  var k=1-Math.exp(-lastDt/BELT_GRIP_TAU);
  var dvt=(st-vt)*k, nvt=vt+dvt;
  Matter.Body.setVelocity(mb,{x:(vx+dvt*tx)/brv,y:(vy+dvt*ty)/brv});
  // ★为什么还要喂 ω：Matter 对 W-vs-W 的摩擦**把带子当静止地面**（见上面 ★ 的实测），
  //   它唯一的诉求就是把「接触点速度」v_t−ωR 拉向 0。若只推质心，摩擦会把注入量转成自旋、
  //   自旋再被别的耗散通道吃掉（当年是滚动摩擦；R115 删掉它之后这条**损耗**没了，但
  //   「只推质心 ⇒ 注入量被转成自旋、平移拿不到」这个**运动学**结论不变）——
  //   实测球只有 30–50px/s（带速 260），而**反向**
  //   喂自旋更糟：摩擦直接把它换成反向平移，实测 Δx=−360、ω=−0.137·60 —— 这就是用户看到的
  //   「球会往回滚」。正解是让注入后的状态**对摩擦中立**：ω 同步到以 nvt 纯滚动的 ω=nvt/R，
  //   接触点速度本就为 0 ⇒ 摩擦无事可做，牵引量全部落到平移上（方块没有滚动耦合，天然中立）。
  if(R){
    var nw=nvt/R;
    Matter.Body.setAngularVelocity(mb,(w+(nw-w)*k)/brv);
  }
  oth._snap&&(oth._snap.n=0);                         // 别让产品自己的 20 帧静置判据本帧就把它睡回去
  if(mb.isSleeping)Matter.Sleeping.set(mb,false);     // 睡着的体不参与积分，注了也白注
}
/* ★R131-39：产品自研的边界判定也要跳过**同碰撞组**（铰链相连的两物体可相互重叠）——
 *  只在 Matter 的 collisionFilter 设组不够，自研碰撞会继续把它们推开 ⇒ 仍然抽搐。 */
function sameRodGroup(A,B){
  /* ★★R131-41b：**即时查连接关系**，不依赖 `_rcg` 标记——标记可能在上一步场景里残留
   *  ⇒ 误把不该忽略的碰撞跳过（实测 r106g G2c 贴墙角穿透 39px）。 */
  if(!A||!B)return false;
  /* ★★★R131-63：**静态体（用户画的地面/墙/挡板）永远是边界，不参与"同类不碰撞"**。
   *  与 `rodSyncNoCollide` 的同一处修正同源（那边真因实测：B 穿地 23.6px）。
   *  这里虽然 G2 走不到（W↔W / W↔T 那段在上面已 continue），但两条通道必须同口径 ——
   *  否则换个 kind 组合（例如公式体当宿主）又会从这条缝里漏出去。 */
  if((A.mb&&A.mb.isStatic)||(B.mb&&B.mb.isStatic))return false;
  for(var i=0;i<bodies.length;i++){
    var R=bodies[i];
    if(R.dead||!R.anc)continue;
    if(R.kind!=='T'&&!(R.kind==='S'&&R.hinge))continue;
    var h0=R.anc[0]?R.anc[0].B:null, h1=R.anc[1]?R.anc[1].B:null;
    if(!h0||!h1)continue;
    if((h0===A&&h1===B)||(h0===B&&h1===A))return true;
  }
  return false;
}
function collideBodies(){
  function ext(B){
    var th=B.th||0,c=Math.abs(Math.cos(th)),s=Math.abs(Math.sin(th));
    // B.hw/B.hh live in LAYOUT units; B.sc shrinks big formulas (½mv²/r, GMm/r²…) to fit.
    // walls() already scales by it — do the same here, otherwise a shrunk formula collides
    // with a 1/sc times too large box (a plank would "hit" it from far away).
    var sc=B.sc||1;
    var hw=(B.hw||24)*sc,hh=(B.hh||18)*sc;
    return {ex:hw*c+hh*s,ey:hw*s+hh*c};
  }
  for(var i=0;i<bodies.length;i++){
    var A=bodies[i];
    // fields pass through; black holes are singularities (no solid box). 'W' boundaries ARE
    // solid — they are walls, so they take part in exactly the same contact pass as a rod.
    // R69（用户：「我用画笔画出一个轨迹，然后让 q 运动，他就直接穿过去了；还有很多其他的
    // 字符 I」）：q（电荷）/I（电流）此前与 B/E 场一起被整段排除 —— 它们沿 vx/vy 直线运动、
    // 完全无视用户画的轨迹。B/E 是力场，保持透明（场不该挡路）；但 q/I 是**有实体的粒子**，
    // 要与公式体一样被挡住。放进接触通道后：W-vs-q 走 bndHit（会被画笔轨迹/轮廓挡住并弹开），
    // q-vs-杆/弹簧/其它公式走各自的分支。
    // 注意：`!A.kind` 必须放行 —— 公式体（mg / mv² / F=ma …）的 kind 为 null，R69 首版把
    // 入口改成白名单时漏掉了它们，导致 mg 落下后直接飘走不落板面（CORE 回归 r68_sym 3a）。
    var AK=(!A.kind||A.kind==='T'||A.kind==='W'||A.kind==='S'||A.kind==='q'||A.kind==='I');
    if(!AK||A.bh)continue;
    if(grab.kind==='body'&&grab.obj===A)continue;
    var ea=ext(A);
    for(var j=i+1;j<bodies.length;j++){
      var B=bodies[j];
      // R69：同 A —— 让 q / I 也进入接触通道（见上一条注释）
      var BK=(!B.kind||B.kind==='T'||B.kind==='W'||B.kind==='S'||B.kind==='q'||B.kind==='I');
      if(!BK||B.bh)continue;
      if(grab.kind==='body'&&grab.obj===B)continue;
      var eb=ext(B);
      var aox=0,aoy=0; if(A.orb&&A.orb.k>=0.02&&A.orb.gx!=null){aox=A.orb.gx-A.x;aoy=A.orb.gy-A.y;}
      var box=0,boy=0; if(B.orb&&B.orb.k>=0.02&&B.orb.gx!=null){box=B.orb.gx-B.x;boy=B.orb.gy-B.y;}
      var dx=(B.x+box)-(A.x+aox),dy=(B.y+boy)-(A.y+aoy);
      var nx=0,ny=0,ov=0,hitSeg=null;
      var AT=(A.kind==='T'),BT=(B.kind==='T');
      var AW=(A.kind==='W'),BW=(B.kind==='W');
      // R57 弹簧（kind 'S'）：接触几何与 T 杆同型（一根细长条），走同一条 SAT 分支。
      // 弹簧在碰撞里当作**不可推动**的物体（和杆/边界一样）——它的两端由锚点和指针决定，
      // 让碰撞去改 B.x 没意义（下一帧 refreshSpringGeom 就覆盖了），只会造成穿插。
      var AS=(A.kind==='S'),BS=(B.kind==='S');
      if(AW||BW){
        // ---- BOUNDARY contacts --------------------------------------------------------------
        // W-vs-W, W-vs-rod and W-vs-spring are owned by the Matter world (a real sequential-impulse
        // solver: stacking, momentum, resting stability). This hand-rolled pass keeps only the case
        // it is still needed for: a formula letter touching a boundary's solid edges.
        if((AW&&BW)||(AW&&B.kind==='T')||(BW&&A.kind==='T')
           ||(AW&&BS)||(BW&&AS)){
          // R100：这一族接触照旧交给 Matter 求解器（叠放/动量/静置稳定性是它的强项），
          // 但传送带的**带面牵引**必须在这里补一刀再 continue —— Matter 完全不知道带子在跑。
          // 放在 continue 之前而不是之后：continue 之后这条对就再也不进任何手写通道了。
          if(A.belt)beltDragMatter(A,B);
          if(B.belt)beltDragMatter(B,A);
          continue;
        }
        /* ★R131-39：**同碰撞组（铰链相连）⇒ 直接跳过手写碰撞**——它们允许互相重叠，
         *  只剩杆的约束把它们连在一起（消除接触/分离的边界抖动）。 */
        if(sameRodGroup(A,B))continue;
        var wr;
        if(AW&&!BW)wr=bndHit(A,B);                       // n already points A -> B
        else if(BW&&!AW){var wr2=bndHit(B,A);wr=wr2?{ov:wr2.ov,nx:-wr2.nx,ny:-wr2.ny}:null;}
        else wr=bndSolidHit(A,B);                        // (no longer reachable; kept as a guard)
        if(!wr)continue;
        ov=wr.ov;nx=wr.nx;ny=wr.ny;
        hitSeg=AW?A:B;
        // R99：传送带表面牵引（唯一有效的写入点，理由见 beltTract 上方那段实测注释）。
        // 放在**法向冲量之前**：牵引只改切向，不改法向，先加后加都不影响上面的 vn 判定。
        // （切向由法向转 90° 得到，法向整体取反时 vt 与 t 同时反号，牵引量不变 ⇒ 无需翻转）
        if(AW)beltTract(A,B,nx,ny,ov);else beltTract(B,A,nx,ny,ov);
      }else if(AT||BT||AS||BS){
        /* ★★R131-63（**多杆链「拖动分离」的真正病根**）：**杆—杆（T↔T）不做任何接触**。
         *
         * R131-21 用户已拍板「杆没有碰撞箱，只是对物体起约束作用」，那条拍板在
         * `rebuildRodMirror`（Matter 侧）与 `rodResolve`（支撑侧）都贯彻了，
         * **唯独这条手写 SAT 通道漏了**：`AT||BT` 一进来就把杆当"2px 半厚的实心细板"
         * 做 OBB 的 SAT、并按质量把双方沿法线推开。
         *
         * 实测（_diag_r179i，W1固定—杆1—W2—杆2—W3，拖 W3 到 (300,250) 停住整帧追踪）：
         *   `collideBodies` 每帧改 **杆1 (−1.059,+6.96) / 杆2 (+1.059,−6.96)**（等大反向 = 互推），
         *   而 W2 的 x/th **一位小数都不动** ⇒ 残差 0 → 7.04px 完全由这一对产生。
         *   停 1.2s 后仍在 7~10px 徘徊（帧序增长 7.06→8.55）——正是用户看到的"杆与物体分离"。
         *
         * 机理：两根杆各自锚在 W2 的两个材料点上，拖动时两根杆在 W2 附近**空间上必然交叉**
         * （链折叠时尤其如此）。它们本来只该受「杆长约束 + 锚点约束」，现在却多出一条
         * "不许互相穿透"的实心板约束 —— 而这条约束**没有任何物理依据**（杆是轻质约束件，
         * 不是实体），于是：
         *   · 链解 `rodDragPinChain` 每子步把杆摆到"锚点正好落在杆端"（残差 → 0），
         *   · 紧接着帧末 `collideBodies` 又把两根杆各推开 7px（残差 → 7px），
         *   两者拉锯的稳态就是那个 7~10px 的恒定分离。
         *   这也解释了 R131-62 记录的「峰值 8.6px ↔ 64.8px 偶发波动」——波动取决于
         *   当帧两杆的交叉深度，而不是什么"求解器不收敛"。
         *
         * 修法 = 把 R131-21 贯彻到底：**T↔T 直接 continue**。
         *   · 与 S（弹簧）一致：`sameRodGroup` 早就用"负 group"把铰链相连的一对排除掉了，
         *     走的是同一个哲学「约束件之间只剩几何约束，没有接触」。
         *   · 与 Matter 侧一致：杆已无 `mb`（板删除）⇒ Matter 里本来就不存在这对接触。
         *   · **不损失任何用户可见能力**：R131-21 已拍板"物品不能搁在杆上"（承重面语义
         *     随板删除一起退役），杆只在被打字/公式体撞到时才需要响应 —— 那些情形是
         *     T↔非T，**不受本条影响**。 */
        if(AT&&BT)continue;
        // ---- ROD vs BODY: exact 2-D SAT between oriented boxes --------------------------
        // The rod is a THIN PLANK (half-length len/2, half-thickness 2) — the very same kind
        // of solid as the ground and the screen walls; a wall is just the axis-aligned special
        // case of this test.
        // IMPORTANT: a formula is NOT a filled rectangle. Its ink is a ROW OF GLYPH BOXES and
        // the glyphs never fill the corners of their union AABB — the 'm' of "mg" has no
        // descender at all. With a single AABB it is that EMPTY corner which touches a tilted
        // plank, so the nearest real ink stayed 10–25px away: the box was in perfect contact
        // (gap 0) while the user saw "隔着一段距离". So test the plank against EVERY glyph's
        // ink box and keep the deepest REAL contact. For axis-aligned contact (ground, flat
        // rod, vertical rod) the union of those boxes equals the old AABB, so nothing else
        // moves; a body with no glyphs (synthetic/test bodies) still uses its whole AABB.
        var seg,oth,isSegA;
        if(AT){seg=A;oth=B;isSegA=true;}else{seg=B;oth=A;isSegA=false;}
        // R62（用户：「弹簧和字符m连接后，m会不受控制的远离弹簧」）：弹簧**不推它自己拴住的宿主**。
        // 这条规则 Matter 侧本来就有 —— SPR_CGROUP=-2 把「弹簧镜像板 ↔ 宿主」这一对放进同一个
        // 负 group，两者永不碰撞（见 springMirror / springSyncGroups 的注释：板必然穿过锚在它身上
        // 的宿主，求解器每帧强行分开会注入巨大能量）。但**字母刚体没有 Matter 体**，走的是这条
        // 手写通道，springSyncGroups 里那句 `if(!a.B.mb)continue` 正好把它跳过 —— 于是弹簧的板
        // 在字母身上照旧生效，而板在这一通道里是"不可推动的铁砧"（immA/immB 对 S 恒真），
        // 字母每帧被沿法线推出去；e0/e1 又锚在字母身上、跟着一起走，重叠永不消除 ——
        // 实测（GRAV=0、弹簧处于原长、零弹力）：m 2 秒自己爬了 Δ=(+11.5,-45.6)px，位移
        // 100% 来自这个推挤，和弹力无关，正是用户看到的"不受控制地远离弹簧"。
        // 关掉之后弹簧与宿主之间**只剩弹力**这一条通道 —— 也就同时满足了用户要的
        // 「不能给物体施加左右方向的力，只有一个弹力」。
        if(seg.kind==='S'){
          var ah0=seg.anc[0],ah1=seg.anc[1];
          if((ah0&&ah0.B===oth)||(ah1&&ah1.B===oth))continue;
        }
        var sX2=seg.x,sY2=seg.y;
        var aTH=seg.th||0,aHW=Math.max(4,(seg.len||170)/2),aHH=2;
        var ae1x=Math.cos(aTH),ae1y=Math.sin(aTH),ae2x=-ae1y,ae2y=ae1x;
        var pieces=null;
        if(oth.glyphs&&oth.glyphs.length&&!oth.kind&&!oth.bh){
          var osc0=oth.sc||1,oTH=oth.th||0,oc0=Math.cos(oTH),os0=Math.sin(oTH);
          pieces=[];
          for(var pi=0;pi<oth.glyphs.length;pi++){
            var pg=oth.glyphs[pi];
            if(!pg||pg.dead||!pg.m)continue;
            var gtop=(pg.m.top==null?-F/2:pg.m.top),gbot=(pg.m.bot==null?F/2:pg.m.bot);
            var gw=(pg.m.w||F*0.6);
            var gil=(pg.m.il==null?-gw/2:pg.m.il),gir=(pg.m.ir==null?gw/2:pg.m.ir);
            var gx=(pg.sx||0)+(gil+gir)/2,gy=(pg.sy||0)+(gtop+gbot)/2;
            pieces.push({x:oth.x+(gx*oc0-gy*os0)*osc0,y:oth.y+(gx*os0+gy*oc0)*osc0,
                         hw:((gir-gil)/2)*osc0,hh:((gbot-gtop)/2)*osc0,th:oTH,pad:ROD_PAD});
          }
        }
        if(!pieces||!pieces.length){
          // no glyphs (synthetic bodies): keep the plain AABB, whose hw/hh already carry their
          // own padding from anchorBox -> pad 0 here.
          pieces=[{x:(oth===B)?(B.x+box):(A.x+aox),y:(oth===B)?(B.y+boy):(A.y+aoy),
                   hw:(oth.hw||24)*(oth.sc||1),hh:(oth.hh||18)*(oth.sc||1),th:oth.th||0,pad:0}];
        }
        // ---- CONTINUOUS (swept) contact along THIS FRAME'S MOTION -------------------------
        // The plank is only 2px half-thick, but a falling body covers ~17-20px in one 1/60s
        // frame, so a test of the CURRENT position alone can miss the plank entirely. And a miss
        // is not merely a missed hit: the very next frame the glyph's centre is already PAST the
        // rod's centre line, so the sign picked from `ad` flips and the body gets flung THROUGH
        // instead of stopped (measured: mg dropped on a plank jumped 39px per frame and went
        // straight through). So walk the swept path in <=3px sub-steps. The FIRST sub-step that
        // touches is shallow and still on the original side, which gives both a trustworthy
        // contact normal and a small penetration. At rest the sweep is ~0 -> K=1 -> the plain SAT.
        var mdx=(oth.vx||0)*lastDt,mdy=(oth.vy||0)*lastDt;
        var mlen=Math.sqrt(mdx*mdx+mdy*mdy);
        var K=(mlen>3)?Math.min(12,Math.ceil(mlen/3)):1;
        ov=0;nx=0;ny=0;
        for(var qi=0;qi<pieces.length;qi++){
          var PC=pieces[qi];
          var be1x=Math.cos(PC.th),be1y=Math.sin(PC.th),be2x=-be1y,be2y=be1x;
          var ax=[ae1x,ae1y,ae2x,ae2y,be1x,be1y,be2x,be2y];
          var hit=false,qnx=0,qny=0,qR=0;
          for(var kk=1;kk<=K&&!hit;kk++){
            var ft=kk/K;                               // 1 = where the body is NOW
            var pdx=PC.x-mdx*(1-ft)-sX2,pdy=PC.y-mdy*(1-ft)-sY2;
            var tmin=1e9,tnx=0,tny=0,tR=0,tsep=false;
            for(var ai=0;ai<8;ai+=2){
              var anx=ax[ai],any=ax[ai+1];
              var ra=aHW*Math.abs(anx*ae1x+any*ae1y)+aHH*Math.abs(anx*ae2x+any*ae2y);
              var rb=PC.hw*Math.abs(anx*be1x+any*be1y)+PC.hh*Math.abs(anx*be2x+any*be2y);
              var ad=pdx*anx+pdy*any;
              // PC.pad is applied ALONG THE CONTACT NORMAL (not per axis), so a 45 deg contact is
              // not inflated to 1.41x the intended clearance — that is what made the tilted rod
              // look like it had a gap while the flat rod looked right.
              var need=ra+rb+PC.pad,aov=need-Math.abs(ad);
              if(aov<=0){tsep=true;break;}             // a separating axis exists -> this glyph is clear
              if(aov<tmin){tmin=aov;var asg=(ad<0)?-1:1;tnx=asg*anx;tny=asg*any;tR=need;}
            }
            if(tsep)continue;
            hit=true;qnx=tnx;qny=tny;qR=tR;
          }
          if(!hit)continue;
          // qn points rod -> the side the glyph CAME FROM; push the body's real (current) centre
          // back out to that surface. If the sweep had to catch a jump this is > R, which is
          // exactly the correction that undoes the jump. Resting contact -> 0 (i.e. the MTV).
          var adv=(PC.x-sX2)*qnx+(PC.y-sY2)*qny;
          var ovc=qR-adv;
          if(ovc>ov){ov=ovc;nx=isSegA?qnx:-qnx;ny=isSegA?qny:-qny;}
        }
        if(ov<=0)continue;                             // no glyph is touching the plank
        hitSeg=seg;
      }else{
        var ox=ea.ex+eb.ex-Math.abs(dx);
        if(ox<=0)continue;
        var oy=ea.ey+eb.ey-Math.abs(dy);
        if(oy<=0)continue;
        if(ox<oy){nx=(dx>0)?1:-1;ov=ox;}else{ny=(dy>0)?1:-1;ov=oy;}
      }
      // A gravity well (complete GMm/r²), a t-rod AND a boundary ('W') are STATIC BODIES: they
      // never move or gain velocity from impacts - an anvil, not a projectile. A boundary is still
      // allowed to FALL by gravity (stepPhysics) and to be pushed back out of whatever it landed
      // on (the block further down); what it never gets is a shove or a bounce. Once a well is
      // split (losing M or a 2nd r) it is no longer isWell and becomes a normal pushable body.
      // R71⑧（用户：「物体质量不影响碰撞效果（999kg 落体撬不动 1kg 杠杆）」）：**杆退出这条免责**。
      // 以前 'T' 也在这里被写成 1e7 + imm —— 无惯性铁砧，999kg 砸上去它一动不动，
      // 于是「质量」在杠杆上完全失效。现在杆按自己的质量参与（默认 1kg，见 rodMassOf）。
      // W（画出来的线/图形）与 S（弹簧）保持不可推动：W 是用户画的地形，S 的两端由锚点决定，
      // 让碰撞去改它们的位置只会与每帧几何重建打架（R57 的结论，不动）。
      var mA=(A.kind==='W'||A.kind==='S'?1e7:(A.kind==='T'?rodMassOf(A):(A.isWell?1e9:(A.bh?1e9:(A.mass||1))))),mB=(B.kind==='W'||B.kind==='S'?1e7:(B.kind==='T'?rodMassOf(B):(B.isWell?1e9:(B.bh?1e9:(B.mass||1))))),sum=mA+mB;
      var immA=(A.kind==='W')||(A.kind==='S')||A.isWell||!!A.bh, immB=(B.kind==='W')||(B.kind==='S')||B.isWell||!!B.bh;
      // n points A->B; B sits on the +n side. To SEPARATE: B along +n, A along -n.
      if(!immA){A.x-=nx*ov*(mB/sum);A.y-=ny*ov*(mB/sum);}
      if(!immB){B.x+=nx*ov*(mA/sum);B.y+=ny*ov*(mA/sum);}
      // R57：边界（W）一侧用 rvx/rvy —— 位姿差分求出的真实速度，且带亚像素死区。见 stepMatter
      // 的三条注释：Matter 的幻影 velocity 与复合体静置时的 1px 跳变，都会把「稳如地面的墙」
      // 报成 150px/s 在动，于是压在上面的物体每帧被 vn 反弹一次，永不停歇（用户 #5）。
      var avx2=(A.kind==='W')?(A.rvx||0):A.vx, avy2=(A.kind==='W')?(A.rvy||0):A.vy;
      var bvx2=(B.kind==='W')?(B.rvx||0):B.vx, bvy2=(B.kind==='W')?(B.rvy||0):B.vy;
      // ---- R71⑧：杆的接触点速度必须带上自身的转动 ------------------------------------
      // 杆现在是**有质量、可转动**的刚体（见下），而冲量收敛的前提是「冲量施加后 vn 不再为正」。
      // 若 vn 只看质心速度，那么加到 om 上的角冲量永远不参与 vn —— 冲量每帧原样重来，
      // 杆会被转成陀螺（实测 ω 一路冲到 10+ rad/s）。所以先把接触点速度算全：
      //   接触点速度 = 质心速度 + ω × r ，在本页的旋转约定下即 (vx − ω·rAy, vy + ω·rAx)。
      var rodT=null,othT=null;
      if(A.kind==='T'&&!immA){rodT=A;othT=B;}
      else if(B.kind==='T'&&!immB){rodT=B;othT=A;}
      var rAx=0,rAy=0,rr=0,rotI=0;
      if(rodT){
        var cthT=Math.cos(rodT.th||0),sthT=Math.sin(rodT.th||0);
        var LT=rodT.len||170,hlT=LT/2;
        // 接触点近似取「对方质心在杆轴上的投影」（细杆 + 点状对方，误差远小于杆长）
        var sT=(othT.x-rodT.x)*cthT+(othT.y-rodT.y)*sthT;
        if(sT>hlT)sT=hlT; if(sT<-hlT)sT=-hlT;
        rAx=cthT*sT;rAy=sthT*sT;
        rotI=(rodMassOf(rodT)*LT*LT)/12;         // 均匀细杆绕质心：I = mL²/12
        if(!(rotI>1e-9))rotI=0;
        if(rotI>0){
          var wT=rodT.om||0;
          if(rodT===A){avx2-=wT*rAy;avy2+=wT*rAx;}
          else{bvx2-=wT*rAy;bvy2+=wT*rAx;}
        }
      }
      var vn=(avx2-bvx2)*nx+(avy2-bvy2)*ny;
      if(vn>0){   // vn>0 = approaching (n points A->B); reflect the relative normal speed
        var eA=(A.bounc!=null)?A.bounc:(A.hasV?1:0.75);
        var eB=(B.bounc!=null)?B.bounc:(B.hasV?1:0.75);
        var e=(eA+eB)/2;
        // R71⑪：配对表里为 (这个物体 ↔ 这个物体) 显式设过的弹性优先于默认合成规则。
        // 公式体没有 Matter 体，W↔公式体的接触完全走这条手写通道，覆盖必须在这里生效，
        // 否则用户为「圆1 ↔ mg」设了 e 却毫无反应（面板里看得见、物理上不生效 = 假控件）。
        var eov2=pairOvAB(A,B);
        if(eov2.e!=null)e=eov2.e;
        // R57：静止接触不该有弹性。墙（W）自己的 bounc=0（「边界落地永不弹」），但 (eA+eB)/2
        // 会把对面的弹性混进来——字母 0.75 → e=0.375。于是每帧被重力加上的那点法向速度又被
        // 弹回去，压在弧/线上的物体就永远停在 0.x 像素的微弹里（用户 #5）。相对法向速度小到
        // 只可能是「重力一帧加出来的」时，按完全非弹性处理；真正撞上来（速度大）照旧反弹。
        // 弹簧同理（它也是无惯性的铁砧，bounc=0），否则东西停在弹簧上会一直微弹。
        if((AW||BW||AS||BS)&&Math.abs(vn)<W_BOUNCE_MIN)e=0;
        // ---- R71⑧：把「角冲量」补上 ----------------------------------------------------
        // 这条手写通道原本**完全没有角冲量** —— 就算把杆从「不可推动」里放出来，它也只会平移，
        // 永远不会被撬起来（用户要的正是「把另一头撬上去」）。这里补标准刚体冲量：
        // 有效质量里加入转动项 (r×n)²/I，冲量再按力矩 τ = r × F 折算成 Δω = τ/I。
        // 杆越轻越长越容易被撬动 —— 这就是用户要的「质量影响碰撞效果」。
        var Kden=1/mA+1/mB;
        if(rotI>0){rr=rAx*ny-rAy*nx;Kden+=(rr*rr)/rotI;}   // (r×n) 的 z 分量
        var jimp=-(1+e)*vn/Kden;
        if(!immA){A.vx+=jimp*nx/mA;A.vy+=jimp*ny/mA;}
        if(!immB){B.vx-=jimp*nx/mB;B.vy-=jimp*ny/mB;}
        if(rotI>0){
          // 作用在杆上的冲量：杆是 A 时取 +n，是 B 时取 −n（与上面两行同符号）
          var sgnT=(rodT===A)?1:-1;
          rodT.om+=(rAx*(sgnT*jimp*ny)-rAy*(sgnT*jimp*nx))/rotI;
        }
      }
      // ---- a boundary that FELL onto a STATIC body still has to be able to LAND on it ---------
      // Both sides unpushable means the block above produced no response whatsoever, so an
      // outline falling onto a rod / another outline would sink straight through the very plank it
      // landed on. Give the boundary the single move it needs: back out along the normal, and kill
      // its landing speed. It is still never shoved sideways and never bounces (bounc=0), so
      // nothing can knock it about - weight, not inertia.
      if((AW||BW)&&immA&&immB){
        var half=(AW&&BW)?0.5:1;                       // two boundaries share the separation
        if(AW){
          A.x-=nx*ov*half;A.y-=ny*ov*half;
          var va=A.vx*nx+A.vy*ny;if(va>0){A.vx-=va*nx;A.vy-=va*ny;}
        }
        if(BW){
          B.x+=nx*ov*half;B.y+=ny*ov*half;
          var vb=-(B.vx*nx+B.vy*ny);if(vb>0){B.vx+=vb*nx;B.vy+=vb*ny;}
        }
      }
    }
  }
}
function refreshHover(){
  // R57：W 体的悬浮命中改在这里算（每帧一次），不再只在 pointermove 里算。
  // 旧逻辑的问题：画笔落笔期间被 TOOL.stroke 挡掉，松手后指针不动就没有新的 pointermove，
  // 于是「刚画完的东西指针正停在上面也不发光」——用户说的「画笔模式下鼠标悬浮没有效果」。
  // 判定也一并改成「贴着线才算」（nearInk），空心图形的内部空白不再响应。
  hoverW=null;
  // R57：#4 让「只有线才响应」之后，旋转手柄（悬在物体上边缘再往外 26px）就悬在了空中——
  // 指针一移到手柄上，hoverW/hoverB 立刻变空，手柄自己的 pointerdown（它要读 hoverB）拿不到
  // 宿主，旋转功能直接失效。所以先算一次「指针是否压在手柄命中框内」，是的话把上一帧的宿主
  // 继续当成悬浮目标。handleBody 在下方放置手柄时写入。
  var onRotHandle=false;
  if(handleBody&&handle.classList.contains('on')){
    var hr0=handle.getBoundingClientRect();
    onRotHandle=(pointer.x>=hr0.left-4&&pointer.x<=hr0.right+4
                 &&pointer.y>=hr0.top-4&&pointer.y<=hr0.bottom+4);
  }
  // R98-3：杆两端的长度手柄也是「悬在命中带之外」的 DOM 手柄（长杆的端点远在悬浮半径 rr 之外），
  // 指针一挪到手柄上 hoverB 就空 ⇒ 手柄下一帧消失 ⇒ 永远点不到。与 onRotHandle 同一套解法：
  // 先判「指针是否压在已显示的手柄上」，是就继续把上一帧的宿主 rodHov 当悬浮目标。
  var onRodHandle=false;
  for(var ri0=0;ri0<2;ri0++){
    if(!rodh[ri0]||!rodh[ri0].classList.contains('on'))continue;
    var rr0=rodh[ri0].getBoundingClientRect();
    if(pointer.x>=rr0.left-4&&pointer.x<=rr0.right+4
       &&pointer.y>=rr0.top-4&&pointer.y<=rr0.bottom+4){onRodHandle=true;break;}
  }
  if(!grab.kind&&!TOOL.stroke&&!TOOL.drag&&!trashDrag.active){
    if(onRotHandle&&handleBody.kind==='W')hoverW=handleBody;
    else for(var wi=0;wi<bodies.length;wi++){
      var WB=bodies[wi];
      if(WB.kind!=='W'||WB.dead)continue;
      if(nearInk(WB,pointer.x,pointer.y)){hoverW=WB;continue;}
      if(WB.ell){   // 弧的两个黄色端点手柄直径 18px，要够好点中
        for(var we=0;we<2;we++){
          var wep=arcEndWorld(WB,we);
          if(Math.hypot(pointer.x-wep.x,pointer.y-wep.y)<16){hoverW=WB;break;}
        }
      }
    }
  }
  hoverB=null;
  if(grab.kind==='body'){hoverB=grab.obj;}
  else{
    var best=null,bd=1e9;
    for(var i=0;i<bodies.length;i++){
      var B=bodies[i];
      var s=(B.kind==='T')?{x:B.x,y:B.y}:(B.massG?slot(B,B.massG):{x:B.x,y:B.y});
      var dx=pointer.x-s.x,dy=pointer.y-s.y;
      if(B.kind==='E'){
        // The E-field floating rotate button must appear while the pointer is ANYWHERE
        // inside the field BOX (possibly asymmetric edges), not only when it sits on the
        // E glyph — same box test as stepField / drawFieldE so the hover area matches.
        // +8 edge tolerance: the resize bar hangs just OUTSIDE the edge, so the pointer on
        // the bar must still register the field as hovered (hover reaching the handle).
        var erH=B.er||{l:(B.fieldR||E_FIELD_RANGE)/2,r:(B.fieldR||E_FIELD_RANGE)/2,t:(B.fieldR||E_FIELD_RANGE)/2,b:(B.fieldR||E_FIELD_RANGE)/2};
        if(dx>=-erH.l-8&&dx<=erH.r+8&&dy>=-erH.t-8&&dy<=erH.b+8){
          var dE=Math.max(Math.max(-dx+erH.l,dx-erH.r),Math.max(-dy+erH.t,dy-erH.b));
          if(dE<bd){bd=dE;best=B;}
        }
        continue;
      }
      if(B.kind==='B'){
        // B-circle hover covers the whole disc (the resize handle lives on the rim, so the
        // pointer must register the body while ON the boundary too).
        var rBH=B.fieldR||B_FIELD_RANGE;
        var dBH=Math.hypot(dx,dy);
        if(dBH<=rBH+8){
          if(dBH<bd){bd=dBH;best=B;}
        }
        continue;
      }
      if(B.kind==='W'){
        // R57：空心图形只在「线」上响应。内部空白既不高亮也不可抓——和「只有线是边界」一致。
        if(!nearInk(B,pointer.x,pointer.y))continue;
        var dW=Math.sqrt(dx*dx+dy*dy);
        if(dW<bd){bd=dW;best=B;}
        continue;
      }
      if(B.kind==='S'){
        // R57：弹簧只有线圈本身响应悬浮（和「只有线才响应」同一条原则），
        // 不能用下面那个 max(34,hw)+18 的大圆——弹簧很长，那个圆会把 100px 外的空白也算进去。
        if(segPointDist(B.e0.x,B.e0.y,B.e1.x,B.e1.y,pointer.x,pointer.y)>SPR_GRAB)continue;
        var dS=Math.sqrt(dx*dx+dy*dy);
        if(dS<bd){bd=dS;best=B;}
        continue;
      }
      var rr=Math.max(34,(B.hw||30))+18;
      var d=Math.sqrt(dx*dx+dy*dy);
      if(d<rr&&d<bd){bd=d;best=B;}
    }
    hoverB=best;
    // 见 refreshHover 开头 onRotHandle / onRodHandle 的说明（DOM 手柄悬空 → 用上一帧宿主顶住）
    if(!hoverB&&onRodHandle&&rodHov&&!rodHov.dead&&bodies.indexOf(rodHov)>=0)hoverB=rodHov;
    if(!hoverB&&onRotHandle)hoverB=handleBody;
  }
  // ------ field-area resize handle (or resizing): pointer on the E-square / B-circle border ------
  var rszT=null;
  if(grab.kind==='resizeE'||grab.kind==='resizeB'){
    rszT={kind:grab.obj.kind,B:grab.obj,edge:grab.rszEdge||'x',side:grab.rszSide};
  }else if(!grab.kind&&hoverB){
    if(hoverB.kind==='E'){
      // resize handle appears on ANY edge point (the pointer-side one); the rotate handle
      // also stays visible — the resize bar is pushed aside near the rotate knob in the
      // positioning block below, so the two never overlap.
      var er2=hoverB.er||{l:(hoverB.fieldR||E_FIELD_RANGE)/2,r:(hoverB.fieldR||E_FIELD_RANGE)/2,t:(hoverB.fieldR||E_FIELD_RANGE)/2,b:(hoverB.fieldR||E_FIELD_RANGE)/2};
      var pxE=pointer.x-hoverB.x,pyE=pointer.y-hoverB.y;
      if(Math.abs(Math.abs(pxE)-er2.r)<=8&&Math.abs(pxE)>=er2.r-8&&pyE>=-er2.t-8&&pyE<=er2.b+8)rszT={kind:'E',B:hoverB,edge:'x',side:(pxE>0)?'r':'l'};
      else if(Math.abs(Math.abs(pyE)-er2.b)<=8&&Math.abs(pyE)>=er2.b-8&&pxE>=-er2.l-8&&pxE<=er2.r+8)rszT={kind:'E',B:hoverB,edge:'y',side:(pyE>0)?'b':'t'};
    }else if(hoverB.kind==='B'){
      var rB=hoverB.fieldR||B_FIELD_RANGE;
      var dB=Math.hypot(pointer.x-hoverB.x,pointer.y-hoverB.y);
      if(dB>=rB-8&&dB<=rB+8)rszT={kind:'B',B:hoverB,edge:'rad'};
    }
  }
  if(rszT){
    rszHandle.classList.add('on');
    var rszTh=rszT.B.th||0;
    // rotate knob sits on the E box edge along the knob direction (sin th, -cos th),
    // measured with the SAME per-edge helper as the render — never the l/r average,
    // which made the knob drift while an edge was being dragged.
    var rEr=rszT.B.er||{l:(rszT.B.fieldR||320)/2,r:(rszT.B.fieldR||320)/2,t:(rszT.B.fieldR||320)/2,b:(rszT.B.fieldR||320)/2};
    var kux=Math.sin(rszTh),kuy=-Math.cos(rszTh);
    var rExt=boxExtentAlong(kux,kuy,rEr);
    var rotHx=rszT.B.x+kux*rExt,rotHy=rszT.B.y+kuy*rExt;
    var bx=pointer.x,by=pointer.y;
    if(rszT.kind==='E'){
      // anchor the bar on the DRAGGED EDGE (side-aware for asymmetric boxes); it slides
      // ALONG that edge to keep clear of the rotate knob — never leaves the edge band.
      var ex0,ey0,ex1,ey1,alongX;   // edge endpoints
      if(rszT.side==='l'||rszT.side==='r'){
        var ex=rszT.B.x+(rszT.side==='r'?rEr.r:-rEr.l);
        ex0=ex;ey0=rszT.B.y-rEr.t;ex1=ex;ey1=rszT.B.y+rEr.b;alongX=false;
      }else{
        var ey=rszT.B.y+(rszT.side==='b'?rEr.b:-rEr.t);
        ex0=rszT.B.x-rEr.l;ey0=ey;ex1=rszT.B.x+rEr.r;ey1=ey;alongX=true;
      }
      // pointer's natural anchor on the edge
      var pxT=clamp(pointer.x,Math.min(ex0,ex1),Math.max(ex0,ex1));
      var pyT=clamp(pointer.y,Math.min(ey0,ey1),Math.max(ey0,ey1));
      // slide along the edge away from the rotate knob (min gap 40px). On a horizontal
      // edge (t/b) we can only slide x; on a vertical edge (l/r) we slide y — clamping to
      // the edge line would otherwise undo the shift.
      var gap=40;
      if(alongX){
        if(Math.abs(pxT-rotHx)<gap)pxT=(pxT<rotHx)?rotHx-gap:rotHx+gap;
        pxT=clamp(pxT,Math.min(ex0,ex1),Math.max(ex0,ex1));
      }else{
        if(Math.abs(pyT-rotHy)<gap)pyT=(pyT<rotHy)?rotHy-gap:rotHy+gap;
        pyT=clamp(pyT,Math.min(ey0,ey1),Math.max(ey0,ey1));
      }
      bx=pxT;by=pyT;
    }
    rszHandle.style.left=(bx-9)+'px';
    rszHandle.style.top=(by-9)+'px';
    cv.classList.add(rszT.kind==='E'?(rszT.edge==='y'?'cur-ns':'cur-ew'):'cur-ew');
    // while the resize handle is up, the ROTATE handle stays visible beside it (the resize
    // bar slides along the edge to keep clear, so they coexist without overlapping)
    handle.classList.remove('hideRot');
  }else{
    rszHandle.classList.remove('on');
    cv.classList.remove('cur-ew','cur-ns');
    handle.classList.remove('hideRot');
  }
  // the rotate knob stays up while resizing a field too (grab.obj fallback), so the whole
  // edge affordance does not blink off the moment the pointer drifts past the +8 tolerance
  var hov2=hoverB||((grab.kind==='resizeE'||grab.kind==='resizeB')?grab.obj:null);
  if(grab.kind==='rot'&&grab.obj)hov2=grab.obj;   // R59：拖旋转手柄期间手柄必须一直亮着（此前 hoverB 为空，拖到一半手柄闪没）
  // R59（用户「旋转按钮显示后隔一会儿再消失，不然完全点不到」）：弹簧/固定体的旋转手柄悬在
  // 线外 ~56px，而悬浮命中带只有 SPR_GRAB=16px —— 指针从线圈挪到手柄上要跨过一段「真空区」，
  // hover 一丢手柄下一帧就没了，手柄永远追不上指针。给手柄一个**驻留期**：显示过就再留
  // HANDLE_LINGER 毫秒，期间指针到了手柄上（onRotHandle -> hoverB=handleBody）会刷新计时，
  // 驻留期内宿主被删/解散则立即消失。
  var nowMs=performance.now();
  /* ★★R131-51（用户：「把 ma 组合体上面的旋转悬浮按钮删了，ma 的都统一归到 a 的参数面板」）：
   *  **含字母 a 的表达式体（ma / Ma / ma²…）不显示旋转手柄**——它的角度由 a 的参数面板调。 */
  /* ★★R131-54f（用户截图确认：ma 组合体上的旋转钮还在）：真因——用户是按「**m 并入 a**」
   *  组的 ma，那时 **a 是宿主**、不在 `mem` 里 ⇒ 原来的「mem 含 a」判据落空。
   *  改用**语义判据**：该体带 a 的加速度语义（accGive / accX / accY）⇒ 就是 ma 组合体。 */
  /* ★R131-55b（用户：「ma 组合体的旋转钮仍然存在」）：上一版用 accGive/accX 判——但
   *  **组合**出来的 ma（而不是"赋予"出来的）**没有 accGive** ⇒ 判据落空。
   *  改用**字形判据**：`glyphs`（合成后的字形串，实测 ma ⇒ ["m","(","a","+","m",")"]）里
   *  出现 'a' ⇒ 就是含 a 的表达式体。 */
  var _hasA=!!(hov2&&((hov2.glyphs&&hov2.glyphs.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.mem&&hov2.mem.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.massG&&(hov2.massG.ch==='a'||hov2.massG.type==='a'))
              ||hov2.accGive!=null||hov2.accX!=null||hov2.accY!=null));
  if(hov2&&!_hasA&&(hov2.hasA||hov2.kind==='T'||hov2.kind==='E'||springCanRotate(hov2)
            ||(hov2.kind==='W'&&hov2.fixed))){
    // R59：驻留只给「手柄悬在悬浮命中带之外」的类型（弹簧贴线带 16px、固定 W 的贴线带），
    // E/B/T 的手柄本来就在命中区内部、随显随收（_verify_r39 的契约：离开场方块立即消失）。
    if(springCanRotate(hov2)||(hov2.kind==='W'&&hov2.fixed)){
      handleKeep=hov2;handleLinger=nowMs+HANDLE_LINGER;
    }
  }else if(handleKeep&&nowMs<handleLinger&&!handleKeep.dead&&bodies.indexOf(handleKeep)>=0){
    hov2=handleKeep;
  }else handleKeep=null;
  if(hov2&&(hov2.hasA||hov2.kind==='T'||hov2.kind==='E'||springCanRotate(hov2)
            ||(hov2.kind==='W'&&hov2.fixed))){
    var s2=hov2.massG?slot(hov2,hov2.massG):{x:hov2.x,y:hov2.y};
    var th=hov2.th||0;
    // E field: the rotate handle rides on the FIELD BOX edge in the knob direction
    var hh=Math.max(30,(hov2.hh||24))+26;
    if(hov2.kind==='E'){
      var erK=hov2.er||{l:(hov2.fieldR||E_FIELD_RANGE)/2,r:(hov2.fieldR||E_FIELD_RANGE)/2,t:(hov2.fieldR||E_FIELD_RANGE)/2,b:(hov2.fieldR||E_FIELD_RANGE)/2};
      hh=boxExtentAlong(Math.sin(th),-Math.cos(th),erK);
    }
    handle.style.left=(s2.x+Math.sin(th)*hh-15)+'px';
    handle.style.top=(s2.y-Math.cos(th)*hh-15)+'px';
    handle.classList.add('on');
    handleBody=hov2;   // 手柄的宿主：下一帧 onRotHandle 命中时用它顶住 hover（见 refreshHover 开头）
  }else{handle.classList.remove('on');handleBody=null;}
  // ------ R56：圆弧端点手柄（悬浮弧上出现；拖动中跟随） + 固定体的旋转手柄已在上面放行 ------
  arcHov=null;
  var showArc=null;
  if(grab.kind==='arcedit'){showArc=grab.obj;arcHov=grab.obj;}
  else if(!grab.kind&&hoverW&&hoverW.wshape==='arc'&&hoverW.ell&&!hoverW.dead){showArc=hoverW;arcHov=hoverW;}
  if(showArc&&!showArc.dead&&showArc.ell){
    for(var ai=0;ai<2;ai++){
      var ep=arcEndWorld(showArc,ai);
      ark[ai].style.left=(ep.x-9)+'px';
      ark[ai].style.top=(ep.y-9)+'px';
      ark[ai].classList.add('on');
    }
  }else{
    ark[0].classList.remove('on');ark[1].classList.remove('on');
  }
  // ------ R98-3：轻质杆两端的**长度手柄**（悬浮杆上出现；拖动中跟随） ------
  // 与圆弧端点手柄同构：DOM 小圆点钉在端点世界坐标上，按住哪一端就拖哪一端（另一端钉死）。
  var showRod=null;
  if(grab.kind==='rodlen')showRod=grab.obj;                       // 拖动中必须一直亮（hoverB 此刻为空）
  // R100⑤：传送带也进这一族（用户：「并且鼠标再两端也可以像杆那样拖动长短」）——
  // 手柄元素、命中判定、按下/移动/松手三处收口全是**同一套**，只有「端点怎么取」和
  // 「怎么把两个端点写回去」按宿主分派（见 rodEndWorld / beltEndWorld 与 setBeltEnds）。
  else if(!grab.kind&&hoverB&&!hoverB.dead
          &&(hoverB.kind==='T'||(hoverB.kind==='W'&&(hoverB.belt||hoverB.gnd))))showRod=hoverB;
  if(showRod&&!showRod.dead&&bodies.indexOf(showRod)>=0){
    var ew=showRod.belt?beltEndWorld:rodEndWorld;
    for(var ri1=0;ri1<2;ri1++){
      var rp=ew(showRod,ri1);
      rodh[ri1].style.left=(rp.x-9)+'px';
      rodh[ri1].style.top=(rp.y-9)+'px';
      /* ★★R131-31（用户：「杆和圆的中心连接，还能在那一侧调节长度」）：**已锚定端不显示
       *  长度手柄**——锚定端的长度由约束决定，不是用户拖出来的（且拖它会干扰双击解除）。 */
      var _endAnc=showRod.anc&&showRod.anc[ri1];
      if(_endAnc)rodh[ri1].classList.remove('on');
      else rodh[ri1].classList.add('on');
    }
    rodHov=showRod;                                               // 手柄 pointerdown 读它取宿主
  }else{
    rodh[0].classList.remove('on');rodh[1].classList.remove('on');
    rodHov=null;
  }
}

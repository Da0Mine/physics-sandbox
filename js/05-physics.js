/* 物理步进、碰撞、传送带牵引、悬停检测（原 index.html 第 7961–8969 行） */
/* 被 a 赋予「持续加速度」的物体每帧受力（v += a·dt），与重力同量级持续作用；时间静止时本函数不跑 ⇒ 自然停住。 */
/* 必须逐子步调用（在 stepMatter 的子步循环里），不能每帧一次。
 * 系数 _m*ax/1e6 按 1000/240 子步标定：Matter 的 Δv[px/s] = force/mass · dt_ms² · 240 ⇒ 要得到 ax px/s²，
 * force/mass 须为 ax/1e6。Matter 每次 Engine.update 后清掉 body.force，每帧只施力一次时
 * 4 个子步里只有第 1 个吃到 ⇒ 实际加速度只有 1/4（面板上限 6000≈23 m/s² 实际 ≈5.8 < g，物体飞不起来）。
 * dt 形参不用（量纲已含在系数里）。 */
function applyGivenAccel(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead||!B.accGive||!B.mb||B.mb.isStatic)continue;
    var ax=B.accX||0, ay=B.accY||0;
    if(!isFinite(ax)||!isFinite(ay))continue;
    /* 通过 Matter 的力通道（applyForce）驱动，不自己维护速度、不反复唤醒：
     * 每帧 setVelocity + Sleeping.set(false) 会覆盖 Matter 刚积分出的速度并重置睡眠计时，表现为一卡一卡。 */
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
    // 拖长度手柄期间杆的位姿归指针：重力、a 推力、阻尼、积分全部让位（否则按住端点不动杆也会往下掉）。
    if(rodLenFrozen(B))continue;
    if(B.kind==='W')continue;   // boundaries are integrated by the Matter layer (stepMatter)
    if(B.shatterBlast){
      // mc² explosion blast: the whole body shatters into its own letters (already flung out
      // with a big outward kick whose speed decays fast via B.decay)
      B.shatterBlast=false;
      shatter(B,'split');   // letters inherit the outward kick; freeL damping decays it fast
      continue;
    }
    // 孤立的 g（只有 g 一个字形、不是质量体、也没有 kind）是重力参数的可视化控件，不受重力，保持浮空
    // （与孤立的 r/a/v/m/μ 一致）。不要改 hasG 本身：promoteFreeLetter 会给含 g 的体置 hasG，
    // 但 hasG 还兼职「g + t -> gt」的组合判定（见 findTComboTarget）。
    // 轻质杆（kind==='T'）质量可忽略，同样不受重力：rodIntegrate 不含重力，这里是杆唯一的重力来源，
    // 摘这一处即可，不要改 makeRod 的 hasG。杆仍保留阻尼与碰撞，松手后停在原位。
    // 去掉杆的重力也消除了锚定端抽搐（重力每子步给 vy 加一点、锚点投影又吃掉这份位移的对拉）。
    if(B.hasG&&B.kind!=='T'&&!isGravityLetterOnly(B))B.vy+=((B.grav!=null)?B.grav:GRAV)*dt;
    if(B.hasA){
      var th=B.th||0;
      var aA=(B.acc!=null)?B.acc:AACC;
      B.vx+=-aA*Math.cos(th)*dt;
      B.vy+=-aA*Math.sin(th)*dt;
    }
    /* q（右键 promote 的电荷体、spawnField('q') 生成的场源体）没有重力，必须有阻尼，否则甩出去零衰减一路滑到底。
     * 用与自由字符同一套阻尼 0.94^(dt·60)（≈5.4%/帧），其它体维持 0.9992（近乎无阻尼）。
     * B/E 场源在函数开头已 continue。 */
    var damp=(B.kind==='q')?Math.pow(0.94,dt*60):Math.pow(0.9992,dt*60);
    B.vx*=damp;B.vy*=damp;
    // 杆的位置积分只归 rodIntegrate（240Hz 子步），这里不搬杆的位置。
    // 两处都积分会让杆速度约为正常的两倍，且与锚点约束永久对拉（锚端残差峰值 = v/60）。
    // 重力与阻尼仍在本函数（rodIntegrate 不含重力）。
    if(B.kind!=='T'){B.x+=B.vx*dt;B.y+=B.vy*dt;}
    walls(B);
  }
    for(var k=0;k<freeL.length;k++){
    var d=freeL[k];
    /* 被拖的字符（grab.obj===d）一律跳过自身积分，不能只看 d.state==='grab'：gdDown 给自由字符设的是
     * state='free'，条件几乎永不成立，字符会带着上次抛出的残余速度从指针下滑走。
     * 与 body 分支（grab.obj===B ⇒ continue）同一语义：拖拽期间位置归指针。 */
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
    // 自由字母（k / x / ½ / c / G / t … 没有参数面板、不会 promote 成 body 的符号）与 W 体 / 杆 / 弹簧的接触：
    // n 由边界指向字母，沿 n 推出 ov 解重叠，再抹掉法向速度（停在表面上被挡住）。
    // 已 promote 的符号走 collideBodies 的 bndHit 通道。
    // 注意：这里不加重力 —— 符号是浮空标签，给重力会让字母一松手就掉走，多字母公式（GMm / mv²r）拼不起来。
    var _noBound=(d.ch==='v'||d.ch==='q'||d.ch==='t'||d.ch==='a');   // 四类赋予型字符不受物体边界影响
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
// 自由字母 vs 实体（W 体 / T 杆 / S 弹簧）的最深接触。bndHit 要一个带 glyphs 的
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
    // 只认 W 体：bndHit 第一参数要过 bndSegs→bndPts（读 B.pts），T 杆 / S 弹簧没有 pts，
    // 传进去会抛 "Cannot read properties of undefined (reading 'length')"。
    if(B.kind!=='W'||!B.pts||B.pts.length<2)continue;
    var wr=bndHit(B,_flProxy);
    if(wr&&(!best||wr.ov>best.ov))best=wr;
  }
  _flProxy.glyphs[0]=null;
  return best;
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
    // 杆没有 Matter 体，地面/屏幕边缘对杆的支撑只在这里：半高用 ROD_HH（不是 B.hh=4，否则杆悬在离地 2px 处），且不反弹。
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
  // mg 是「重力」预设（friction:0.01 → 地面摩擦极小，像冰面），m(g+gμ) 是默认摩擦。
  // 无论有没有 μ 字母，摩擦力都只在贴地/贴墙时施加，避免空中乱衰减。
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
/* ================= 传送带（器件）：表面牵引 ===================================
 * 为什么必须在这里显式加：
 *   ① 公式体没有 Matter 镜像，与 W 的接触只走 collideBodies 里 bndHit 那条手写 SAT 通道；
 *      「给静态体 setVelocity 当传送带」的技巧对它无效（实测物块 Δx=0）。
 *   ② 那条手写通道只有法向响应（穿透推出 + vn 反弹），没有切向耦合；把表面速度喂进 rvx/rvy 也带不动。
 * 模型：把对方的切向速度朝「带面速度」指数松弛（时间常数 BELT_TAU）。
 *   · 只改切向（法向留给正常冲量）⇒ 物体不会被吸进带子、也不会被弹起；
 *   · 指数松弛而非瞬间等于带速 ⇒ 保住惯性感（放上去有一段加速过程）；
 *   · μ=0 时不牵引：μ 取带子自己的 wfrict（paramV 口径），与高中模式 μ=0 同一条默认链。
 */
var BELT_TAU=0.10;              // 秒：表面牵引的松弛时间常数（越小抓得越急）
// Matter 那条路（W-vs-W）单独的抓力时间常数，比公式体那条更紧。
// 公式体没有转动耦合，τ=BELT_TAU 即可达到带速的 ~100%。W-vs-W 时 Matter 的摩擦把带子当静止地面
// （见 beltDragMatter），每帧把接触点切向速度往 0 拉，与这里的牵引顶牛，τ 越大货越跟不上带速
// （箭头动画看起来比货跑得快；动画本身是准的：纹路相位速率 262.4px/s vs conv=260，BELT_DECO_STEP=26px）。
// 实测标定（长带 1200px，取已落在带面且加速到位的窗口，稳态 v / 带速，圆 / 方块）：
//   τ=0.02 → 96% / 94%    | τ=0.008 → 99% / 99%    | τ=0.004 → 100% / 100%
//   τ=0.002 / 0.001 → 100% / 100%
//   高速档 conv=1040（4 m/s）同样 100% / 100%，y 峰峰 ≤0.01px（不炸、不甩出、不发散）。
// 取 0.004：两种形状 × 两档带速都到 100%，且比 0.002 留余量（k=1−e^(−dt/τ)=0.985，不是把切向速度硬写成带速）。
// 不影响打滑语义：光滑带（μ=0）在两条牵引通道入口就早退。
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
/* ---- Matter 自管的那条接触路（W-vs-W）也要牵引 --------------------------------
 * collideBodies 的 W 分支把 W-vs-W 直接 continue 交给 Matter，而 beltTract 只挂在 bndHit（W-vs-公式体）上；
 * Matter 侧没有「传送带速度」概念，只认 pair.friction（取双方 μ 的 min，高中模式物体 μ 默认 0 会把带子的 0.6 归零）。
 * 不要用「给静态体 setVelocity 当传送带」：在本 build 里方向是反的（带子 +260 ⇒ 球往左滚 Δx≈−137），
 * 摩擦只把接触点相对地面拉静止；且静态体的速度唤不醒睡着的球。牵引只能手写。
 * 做法：几何自算接触法向（进入时 Matter 还没算碰撞），只在上下带面这一类接触上做切向指数松弛；
 * 写入走 Matter.Body.setVelocity（velocity 属性 = 每 1/60s 的位移，真值 ×60；用 API 换算，
 * 免得与 impAt 的「子步位移」量纲混掉）。
 * 睡着的刚体会被 Matter 跳过积分，注入的速度不生效 ⇒ 必须顺手唤醒。 */
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
  // 支撑半径必须问 Matter 的顶点，不能用 B.rad / B.hw：Matter 体统一被 BND_INK(2.325) 膨胀过
  // （球 circleRadius=28.325 而 rad=26），按 rad 算会把已接触判成还差 4.64px 而拒掉。
  // 圆走 circleRadius（O(1)），多边形精确求 max(v·n)−center·n，与膨胀约定无关。
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
  if(!WB||!WB.belt||!WB.conv)return;                  // 不是带子 / 带速为 0 → 早退
  if(!oth||oth===WB||oth.kind!=='W')return;           // 只处理刚体：杆/弹簧由位姿驱动，写了也被覆盖
  if(oth.belt||oth.fixed||oth.dead||oth.isWell)return; // 别的带子 / 钉住的机器 / 陷阱：不互相拖
  var mb=oth.mb;if(!mb||mb.isStatic)return;
  if(!(paramV(WB,'wfrict')>0))return;                 // 光滑带 = 打滑（与地面 μ 同义）
  var n=beltFaceTouch(WB,oth);if(!n)return;
  var sv=beltSurfVel(WB);
  var brv=60;                                         // Matter 属性值（px/帧）→ 真值 px/s
  var tx=-n.y,ty=n.x;
  var vx=mb.velocity.x*brv, vy=mb.velocity.y*brv;
  var vt=vx*tx+vy*ty, st=sv.x*tx+sv.y*ty;             // 质心切向速度 / 带面切向速度
  // 牵引目标 = 接触点速度（不是质心速度）朝带面速度松弛。
  //   ① 只推质心会被 Matter 摩擦反噬：滑动摩擦同时给出「质心加速 + 反向自旋」，把接触点速度拉回 0，
  //      形成拔河（球只有 ~30–50px/s，带速 260）。
  //   ② 朝接触点松弛后稳态满足 v_接触 = v_带面 ⇒ 相对滑移为 0，摩擦自动归零，且该态自持。
  //   ③ 转动按刚体在接触点受冲量的真实分配（dJ 在接触点 ⇒ dv=dJ/m、dω=−dJ·R/I）：
  //      slip = v_t − ωR − s_t，令 d(slip)=ΔS ⇒ dv_t=ΔS·I/(I+mR²)、R·dω=−ΔS·(1−I/(I+mR²))。
  //      λ=mR²/I（圆盘 λ=2 ⇒ dv=ΔS/3、R·dω=−2ΔS/3）。稳态与松弛速率无关：
  //      slip→0 的唯一终点是 v=s/3、ωR=−2s/3（传送带上小球的课本稳态）。方块无滚动耦合 λ→∞ ⇒ dv=ΔS，整体以带速平移。
  var R=(oth.wshape==='circle'&&mb.circleRadius)?mb.circleRadius:0;
  var w=R?mb.angularVelocity*brv:0;
  var k=1-Math.exp(-lastDt/BELT_GRIP_TAU);
  var dvt=(st-vt)*k, nvt=vt+dvt;
  Matter.Body.setVelocity(mb,{x:(vx+dvt*tx)/brv,y:(vy+dvt*ty)/brv});
  // 为什么还要喂 ω：Matter 对 W-vs-W 的摩擦把带子当静止地面，只想把接触点速度 v_t−ωR 拉向 0。
  // 只推质心 ⇒ 注入量被摩擦转成自旋，平移拿不到；反向喂自旋更糟（摩擦把它换成反向平移，球往回滚）。
  // 正解是让注入后的状态对摩擦中立：ω 同步到以 nvt 纯滚动的 ω=nvt/R，接触点速度为 0，
  // 牵引量全部落到平移上（方块没有滚动耦合，天然中立）。
  if(R){
    var nw=nvt/R;
    Matter.Body.setAngularVelocity(mb,(w+(nw-w)*k)/brv);
  }
  oth._snap&&(oth._snap.n=0);                         // 别让 20 帧静置判据本帧就把它睡回去
  if(mb.isSleeping)Matter.Sleeping.set(mb,false);     // 睡着的体不参与积分，注了也白注
}
/* 自研的边界判定也要跳过同碰撞组（铰链相连的两物体可相互重叠）：只在 Matter 的 collisionFilter 设组不够，
 * 自研碰撞会继续把它们推开 ⇒ 抽搐。 */
function sameRodGroup(A,B){
  /* 即时查连接关系，不依赖 _rcg 标记：标记可能从上一个场景残留，误把不该忽略的碰撞跳过（贴墙角穿透）。 */
  if(!A||!B)return false;
  /* 静态体（用户画的地面/墙/挡板）永远是边界，不参与「同组不碰撞」，与 rodSyncNoCollide 同口径；
   * 否则换个 kind 组合（例如公式体当宿主）会穿地。 */
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
    // B/E 是力场，保持透明；q（电荷）/I（电流）是有实体的粒子，要与公式体一样被挡住：
    // W-vs-q 走 bndHit（被画笔轨迹/轮廓挡住并弹开），q-vs-杆/弹簧/其它公式走各自分支。
    // 注意：!A.kind 必须放行 —— 公式体（mg / mv² / F=ma …）的 kind 为 null，漏掉会让 mg 不落在板面上。
    var AK=(!A.kind||A.kind==='T'||A.kind==='W'||A.kind==='S'||A.kind==='q'||A.kind==='I');
    if(!AK||A.bh)continue;
    if(grab.kind==='body'&&grab.obj===A)continue;
    var ea=ext(A);
    for(var j=i+1;j<bodies.length;j++){
      var B=bodies[j];
      // 同 A：让 q / I 也进入接触通道
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
      // 弹簧（kind 'S'）：接触几何与 T 杆同型（细长条），走同一条 SAT 分支。
      // 弹簧在碰撞里不可推动（和杆/边界一样）：两端由锚点和指针决定，碰撞改 B.x 会被下一帧
      // refreshSpringGeom 覆盖，只会造成穿插。
      var AS=(A.kind==='S'),BS=(B.kind==='S');
      if(AW||BW){
        // ---- BOUNDARY contacts --------------------------------------------------------------
        // W-vs-W, W-vs-rod and W-vs-spring are owned by the Matter world (a real sequential-impulse
        // solver: stacking, momentum, resting stability). This hand-rolled pass keeps only the case
        // it is still needed for: a formula letter touching a boundary's solid edges.
        if((AW&&BW)||(AW&&B.kind==='T')||(BW&&A.kind==='T')
           ||(AW&&BS)||(BW&&AS)){
          // 这一族接触交给 Matter 求解器，但传送带的带面牵引必须在 continue 之前补上：
          // Matter 不知道带子在跑，continue 之后这对接触不再进任何手写通道。
          if(A.belt)beltDragMatter(A,B);
          if(B.belt)beltDragMatter(B,A);
          continue;
        }
        /* 同碰撞组（铰链相连）⇒ 直接跳过手写碰撞：它们允许互相重叠，只剩杆的约束把它们连在一起（消除接触/分离的边界抖动）。 */
        if(sameRodGroup(A,B))continue;
        var wr;
        if(AW&&!BW)wr=bndHit(A,B);                       // n already points A -> B
        else if(BW&&!AW){var wr2=bndHit(B,A);wr=wr2?{ov:wr2.ov,nx:-wr2.nx,ny:-wr2.ny}:null;}
        else wr=bndSolidHit(A,B);                        // (no longer reachable; kept as a guard)
        if(!wr)continue;
        ov=wr.ov;nx=wr.nx;ny=wr.ny;
        hitSeg=AW?A:B;
        // 传送带表面牵引（唯一有效的写入点，见 beltTract 上方注释）。放在法向冲量之前：牵引只改切向，
        // 不影响 vn 判定。切向由法向转 90° 得到，法向取反时 vt 与 t 同时反号，牵引量不变 ⇒ 无需翻转。
        if(AW)beltTract(A,B,nx,ny,ov);else beltTract(B,A,nx,ny,ov);
      }else if(AT||BT||AS||BS){
        /* 杆—杆（T↔T）不做任何接触：杆没有碰撞箱（也没有 Matter 体），只对物体起约束作用。
         * 若在这条 SAT 通道里把两根杆当 2px 半厚的实心板互推：多杆链中两根杆锚在同一物体上、拖动时在其附近必然交叉，
         * rodDragPinChain 每子步把锚点残差拉到 0，帧末这里又把两杆各推开 ~7px，拉锯成恒定 7~10px 的「杆与物体分离」
         * （峰值随当帧交叉深度波动）。
         * 与弹簧一致（sameRodGroup 用负 group 排除铰链相连的一对）：约束件之间只剩几何约束。
         * 物品不能搁在杆上；杆被字符/公式体撞到属于 T↔非T，不受本条影响。 */
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
        // 弹簧不推它自己拴住的宿主。Matter 侧靠 SPR_CGROUP=-2 把「弹簧镜像板 ↔ 宿主」放进同一负 group
        // （板必然穿过锚在它身上的宿主，求解器强行分开会注入巨大能量），但字母刚体没有 Matter 体，
        // springSyncGroups 的 if(!a.B.mb)continue 会跳过它，必须在这条手写通道里排除；
        // 否则板（immA/immB 对 S 恒真）每帧沿法线推字母，而 e0/e1 锚在字母上跟着走，重叠永不消除，宿主自己爬走。
        // 排除后弹簧与宿主之间只剩弹力。
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
      // A gravity well (complete GMm/r²) and a boundary ('W') are STATIC BODIES: they
      // never move or gain velocity from impacts - an anvil, not a projectile. A boundary is still
      // allowed to FALL by gravity (stepPhysics) and to be pushed back out of whatever it landed
      // on (the block further down); what it never gets is a shove or a bounce. Once a well is
      // split (losing M or a 2nd r) it is no longer isWell and becomes a normal pushable body.
      // 杆不在此列：按自己的质量参与碰撞（默认 1kg，见 rodMassOf），否则重物砸杠杆撬不动，质量失效。
      // W 与 S（弹簧）保持不可推动：W 是用户画的地形，S 的两端由锚点决定，碰撞改位置会与每帧几何重建打架。
      var mA=(A.kind==='W'||A.kind==='S'?1e7:(A.kind==='T'?rodMassOf(A):(A.isWell?1e9:(A.bh?1e9:(A.mass||1))))),mB=(B.kind==='W'||B.kind==='S'?1e7:(B.kind==='T'?rodMassOf(B):(B.isWell?1e9:(B.bh?1e9:(B.mass||1))))),sum=mA+mB;
      var immA=(A.kind==='W')||(A.kind==='S')||A.isWell||!!A.bh, immB=(B.kind==='W')||(B.kind==='S')||B.isWell||!!B.bh;
      // n points A->B; B sits on the +n side. To SEPARATE: B along +n, A along -n.
      if(!immA){A.x-=nx*ov*(mB/sum);A.y-=ny*ov*(mB/sum);}
      if(!immB){B.x+=nx*ov*(mA/sum);B.y+=ny*ov*(mA/sum);}
      // 边界（W）一侧用 rvx/rvy：位姿差分求出的真实速度，带亚像素死区（见 stepMatter）。
      // Matter 的幻影 velocity 与复合体静置时的 1px 跳变会把静止的墙报成 ~150px/s，压在上面的物体每帧被 vn 反弹。
      var avx2=(A.kind==='W')?(A.rvx||0):A.vx, avy2=(A.kind==='W')?(A.rvy||0):A.vy;
      var bvx2=(B.kind==='W')?(B.rvx||0):B.vx, bvy2=(B.kind==='W')?(B.rvy||0):B.vy;
      // ---- 杆的接触点速度必须带上自身的转动 ------------------------------------
      // 杆是有质量、可转动的刚体；冲量收敛的前提是施加后 vn 不再为正。vn 只看质心速度的话，
      // 加到 om 上的角冲量永远不参与 vn，冲量每帧重来，杆被转成陀螺（ω 冲到 10+ rad/s）。
      //   接触点速度 = 质心速度 + ω × r，在本页的旋转约定下即 (vx − ω·rAy, vy + ω·rAx)。
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
        // 配对表里为（这个物体 ↔ 这个物体）显式设过的弹性优先于默认合成规则。
        // 公式体没有 Matter 体，W↔公式体的接触完全走这条手写通道，覆盖必须在这里生效。
        var eov2=pairOvAB(A,B);
        if(eov2.e!=null)e=eov2.e;
        // 静止接触不该有弹性：墙（W）bounc=0，但 (eA+eB)/2 会混进对面的弹性（字母 0.75 → e=0.375），
        // 每帧重力加出的那点法向速度又被弹回，物体永远停在亚像素微弹里。相对法向速度小到只可能是
        // 「重力一帧加出来的」时按完全非弹性处理；真正撞上来照旧反弹。弹簧同理（bounc=0 的铁砧）。
        if((AW||BW||AS||BS)&&Math.abs(vn)<W_BOUNCE_MIN)e=0;
        // ---- 角冲量 ----------------------------------------------------
        // 标准刚体冲量：有效质量里加入转动项 (r×n)²/I，冲量按力矩 τ = r × F 折算成 Δω = τ/I。
        // 没有这一项杆只会平移、永远撬不起来；杆越轻越长越容易被撬动。
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
  // W 体的悬浮命中在这里每帧算一次，不只在 pointermove 里：画笔落笔期间 pointermove 被 TOOL.stroke 挡掉，
  // 松手后指针不动又没有新的 pointermove，刚画完的东西指针停在上面也不发光。
  // 判定为「贴着线才算」（nearInk），空心图形的内部空白不响应。
  hoverW=null;
  // 旋转手柄悬在物体上边缘再往外 26px，在「只有线才响应」的命中区之外：指针一移到手柄上 hoverW/hoverB 就变空，
  // 手柄的 pointerdown（要读 hoverB）拿不到宿主。所以先判指针是否压在手柄命中框内，是则把上一帧宿主
  // 继续当悬浮目标。handleBody 在下方放置手柄时写入。
  var onRotHandle=false;
  if(handleBody&&handle.classList.contains('on')){
    var hr0=handle.getBoundingClientRect();
    onRotHandle=(pointer.x>=hr0.left-4&&pointer.x<=hr0.right+4
                 &&pointer.y>=hr0.top-4&&pointer.y<=hr0.bottom+4);
  }
  // 杆两端的长度手柄同样悬在命中带之外（长杆端点远在悬浮半径 rr 之外），指针挪上去 hoverB 就空、手柄消失。
  // 与 onRotHandle 同一解法：指针压在已显示的手柄上时继续把上一帧的宿主 rodHov 当悬浮目标。
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
        // 空心图形只在「线」上响应，内部空白既不高亮也不可抓。
        if(!nearInk(B,pointer.x,pointer.y))continue;
        var dW=Math.sqrt(dx*dx+dy*dy);
        if(dW<bd){bd=dW;best=B;}
        continue;
      }
      if(B.kind==='S'){
        // 弹簧只有线圈本身响应悬浮，不能用下面那个 max(34,hw)+18 的大圆：弹簧很长，那个圆会把 100px 外的空白也算进去。
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
  if(grab.kind==='rot'&&grab.obj)hov2=grab.obj;   // 拖旋转手柄期间手柄必须一直亮着（此时 hoverB 为空）
  // 手柄驻留期：弹簧/固定体的旋转手柄悬在线外 ~56px，而悬浮命中带只有 SPR_GRAB=16px，指针从线圈挪到手柄
  // 要跨过一段「真空区」，hover 一丢手柄就没了。显示过就再留 HANDLE_LINGER 毫秒，期间指针到了手柄上
  // （onRotHandle -> hoverB=handleBody）会刷新计时；驻留期内宿主被删/解散则立即消失。
  var nowMs=performance.now();
  /* 含字母 a 的表达式体（ma / Ma / ma²…）不显示旋转手柄，角度由 a 的参数面板调。判据要覆盖所有组成方式：
   * glyphs（组合出的 ma 没有 accGive，glyphs 如 ["m","(","a","+","m",")"]）、mem、massG（m 并入 a 时 a 是宿主、
   * 不在 mem 里），以及 a 的加速度语义（accGive / accX / accY）。 */
  var _hasA=!!(hov2&&((hov2.glyphs&&hov2.glyphs.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.mem&&hov2.mem.some(function(x){return x&&(x.ch==='a'||x.type==='a');}))
              ||(hov2.massG&&(hov2.massG.ch==='a'||hov2.massG.type==='a'))
              ||hov2.accGive!=null||hov2.accX!=null||hov2.accY!=null));
  if(hov2&&!_hasA&&(hov2.hasA||hov2.kind==='T'||hov2.kind==='E'||springCanRotate(hov2)
            ||(hov2.kind==='W'&&hov2.fixed))){
    // 驻留只给手柄悬在命中带之外的类型（弹簧贴线带 16px、固定 W 的贴线带）；
    // E/B/T 的手柄本来就在命中区内部，随显随收（离开场方块立即消失）。
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
  // ------ 圆弧端点手柄（悬浮弧上出现；拖动中跟随）；固定体的旋转手柄已在上面放行 ------
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
  // ------ 轻质杆两端的长度手柄（悬浮杆上出现；拖动中跟随） ------
  // 与圆弧端点手柄同构：DOM 小圆点钉在端点世界坐标上，按住哪一端就拖哪一端（另一端钉死）。
  var showRod=null;
  if(grab.kind==='rodlen')showRod=grab.obj;                       // 拖动中必须一直亮（hoverB 此刻为空）
  // 传送带也用这套两端长度手柄：手柄元素、命中判定、按下/移动/松手全是同一套，
  // 只有取端点和写回端点按宿主分派（rodEndWorld / beltEndWorld 与 setBeltEnds）。
  else if(!grab.kind&&hoverB&&!hoverB.dead
          &&(hoverB.kind==='T'||(hoverB.kind==='W'&&(hoverB.belt||hoverB.gnd))))showRod=hoverB;
  if(showRod&&!showRod.dead&&bodies.indexOf(showRod)>=0){
    var ew=showRod.belt?beltEndWorld:rodEndWorld;
    for(var ri1=0;ri1<2;ri1++){
      var rp=ew(showRod,ri1);
      rodh[ri1].style.left=(rp.x-9)+'px';
      rodh[ri1].style.top=(rp.y-9)+'px';
      /* 已锚定端不显示长度手柄：长度由约束决定，且拖它会干扰双击解除。 */
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

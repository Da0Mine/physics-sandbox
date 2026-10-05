/* 公式文字、粒子爆炸、黑洞与终章（原 index.html 第 10592–11587 行） */
function metS(ch,size){
  ctx2d.font='italic '+size+'px Georgia,"Times New Roman",serif';
  var q=ctx2d.measureText(ch);
  var fba=q.fontBoundingBoxAscent||size*0.8,fbd=q.fontBoundingBoxDescent||size*0.25;
  var ia=q.actualBoundingBoxAscent||0,id=q.actualBoundingBoxDescent||0;
  var bl=(size-(fba+fbd))/2+fba;
  return {top:bl-ia-size/2,bot:bl+id-size/2,w:q.width};
}
function mkFG(ch,size){
  var el=DD.createElement('div');
  el.className='char';
  el.style.fontSize=size+'px';
  el.style.pointerEvents='none';
  el.style.cursor='default';
  el.style.zIndex='8';
  el.textContent=ch;
  DD.body.appendChild(el);
  var m=metS(ch,size);
  el.style.display='none';
  // back-pointer so the black-hole panel-eating pass can find the letter that owns this .char
  var d={el:el,ch:ch,m:m,sx:0,sy:0,dead:false};
  el._letterRef=d;
  return d;
}
function buildFormulaGlyphs(Fo,which){
  function tok(ch,sub){return {ch:ch,sub:sub?true:false};}
  var lhs,COM='共';
  var num,den;
  if(which===1){
    lhs=[tok('v'),tok(SUB1,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB1,true),tok('−'),tok('m'),tok(SUB2,true),tok(')'),tok('v'),tok(SUB1,true),tok('+'),tok('2'),tok('m'),tok(SUB2,true),tok('v'),tok(SUB2,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else if(which===2){
    lhs=[tok('v'),tok(SUB2,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB2,true),tok('−'),tok('m'),tok(SUB1,true),tok(')'),tok('v'),tok(SUB2,true),tok('+'),tok('2'),tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB2,true),tok('+'),tok('m'),tok(SUB1,true)];
  }else if(which===3){
    // v₁' = (m₁−m₂)/(m₁+m₂) · v₁
    lhs=[tok('v'),tok(SUB1,true),tok(PRIME),tok('=')];
    num=[tok('('),tok('m'),tok(SUB1,true),tok('−'),tok('m'),tok(SUB2,true),tok(')'),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else if(which===4){
    // v₂' = 2m₁/(m₁+m₂) · v₁
    lhs=[tok('v'),tok(SUB2,true),tok(PRIME),tok('=')];
    num=[tok('2'),tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }else{
    // v_共 = (m₁v₁+m₂v₂)/(m₁+m₂)   (common velocity, single formula)
    lhs=[tok('v'),tok(COM,true),tok('=')];
    num=[tok('m'),tok(SUB1,true),tok('v'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true),tok('v'),tok(SUB2,true)];
    den=[tok('m'),tok(SUB1,true),tok('+'),tok('m'),tok(SUB2,true)];
  }
  function sizeOf(t){return t.sub?F*0.62:F;}
  function run(tokens){
    var x=0,items=[];
    for(var i=0;i<tokens.length;i++){
      var t=tokens[i];
      var g=mkFG(t.ch,sizeOf(t));
      var w=g.m.w;
      items.push({g:g,x0:x,w:w,sub:t.sub});
      Fo.glyphs.push(g);
      x+=w+(i<tokens.length-1?3:0);
    }
    return {items:items,width:x};
  }
  var L=run(lhs),N=run(num),D=run(den);
  var fracW=Math.max(N.width,D.width)+14;
  var barGap=5;
  var nTop=1e9,nBot=-1e9;
  N.items.forEach(function(it){var s=it.sub?0.62:1;nTop=Math.min(nTop,it.g.m.top*s);nBot=Math.max(nBot,it.g.m.bot*s);});
  var nShift=-barGap-nBot;
  N.items.forEach(function(it){it.g.sx=(-N.width/2)+it.x0+it.w/2;it.g.sy=nShift;});
  var dTop=1e9,dBot=-1e9;
  D.items.forEach(function(it){var s=it.sub?0.62:1;dTop=Math.min(dTop,it.g.m.top*s);dBot=Math.max(dBot,it.g.m.bot*s);});
  var dShift=barGap-dTop;
  D.items.forEach(function(it){it.g.sx=(-D.width/2)+it.x0+it.w/2;it.g.sy=dShift;});
  var wholeTop=nTop+nShift, wholeBot=dBot+dShift;
  var cY=-(wholeTop+wholeBot)/2;
  N.items.forEach(function(it){it.g.sy+=cY;});
  D.items.forEach(function(it){it.g.sy+=cY;});
  var lhsX0=-(fracW/2)-8-L.width;
  L.items.forEach(function(it){it.g.sx=lhsX0+it.x0+it.w/2;it.g.sy=cY;});
  var totalL=lhsX0, totalR=fracW/2;
  var cX=-(totalL+totalR)/2;
  N.items.forEach(function(it){it.g.sx+=cX;});
  D.items.forEach(function(it){it.g.sx+=cX;});
  L.items.forEach(function(it){it.g.sx+=cX;});
  Fo.bar={x1:cX-fracW/2,y:cY,x2:cX+fracW/2};
  var extW=totalR-totalL,extH=wholeBot-wholeTop;
  Fo.sc=clamp(150/Math.max(extW,extH),0.55,1);
  Fo.hw=extW*Fo.sc/2;Fo.hh=extH*Fo.sc/2;
}
function spawnFormula(which,x,y,bvx,bvy){
  var Fo={x:x,y:y,vx:bvx,vy:bvy,age:0,life:14,glyphs:[],alpha:1,dead:false,bar:null,sc:1,hw:60,hh:30,stoppedAt:null};
  buildFormulaGlyphs(Fo,which);
  var sc=Fo.sc||1;
  for(var i=0;i<Fo.glyphs.length;i++){
    var g=Fo.glyphs[i];
    g.el.style.display='';
    g.el.style.left=(x+g.sx*sc)+'px';
    g.el.style.top=(y+g.sy*sc)+'px';
    g.el.style.transform='translate(-50%,-50%) scale('+sc+')';
    g.el.style.transformOrigin='center';
    g.el.style.opacity='1';
  }
  formulas.push(Fo);
  return Fo;
}
function spawnText(text,x,y,bvx,bvy){
  var Fo={x:x,y:y,vx:bvx,vy:bvy,age:0,life:14,glyphs:[],alpha:1,dead:false,bar:null,sc:1,hw:60,hh:30,stoppedAt:null};
  var g=mkFG(text,F*0.92);
  g.sx=0;g.sy=0;
  Fo.glyphs.push(g);
  var w=g.el.offsetWidth||120,h=g.el.offsetHeight||44;
  Fo.sc=clamp(150/Math.max(w,h),0.55,1);
  Fo.hw=w*Fo.sc/2;Fo.hh=h*Fo.sc/2;
  g.el.style.display='';
  g.el.style.left=(x)+'px';
  g.el.style.top=(y)+'px';
  g.el.style.transform='translate(-50%,-50%) scale('+Fo.sc+')';
  g.el.style.transformOrigin='center';
  g.el.style.opacity='1';
  formulas.push(Fo);
  return Fo;
}
function stepFormulas(dt){
  for(var i=formulas.length-1;i>=0;i--){
    var F=formulas[i];
    F.age+=dt;
    if(F.hw&&pointer.x>F.x-F.hw&&pointer.x<F.x+F.hw&&pointer.y>F.y-F.hh&&pointer.y<F.y+F.hh){
      F.stoppedAt=null;
    }
    var damp=Math.pow(0.22,dt);
    F.vx*=damp;F.vy*=damp;
    F.x+=F.vx*dt;F.y+=F.vy*dt;
    var margin=22,e=0.9;
    if(F.x<margin){F.x=margin;if(F.vx<0)F.vx=-F.vx*e;}
    if(F.x>W-margin){F.x=W-margin;if(F.vx>0)F.vx=-F.vx*e;}
    if(F.y<margin){F.y=margin;if(F.vy<0)F.vy=-F.vy*e;}
    if(F.y>groundY-margin){F.y=groundY-margin;if(F.vy>0)F.vy=-F.vy*e;}
    var sp=Math.hypot(F.vx,F.vy);
    if(sp<26){ if(F.stoppedAt==null)F.stoppedAt=F.age; } else { F.stoppedAt=null; }
    var a=1;
    if(F.stoppedAt!=null){
      var idle=F.age-F.stoppedAt-3.0;
      if(idle>0){
        var blink=0.35+0.65*Math.abs(Math.sin(F.age*6));
        var fade=clamp(1-idle/2.0,0,1);
        a=blink*fade;
        if(idle>=2.0){ killFormula(F); formulas.splice(i,1); continue; }
      }
    }
    F.alpha=a;
    var sc=F.sc||1;
    for(var j=0;j<F.glyphs.length;j++){
      var g=F.glyphs[j];
      g.el.style.left=(F.x+g.sx*sc)+'px';
      g.el.style.top=(F.y+g.sy*sc)+'px';
      g.el.style.transform='translate(-50%,-50%) scale('+sc+')';
      g.el.style.opacity=a;
    }
    if(F.age>=F.life){
      killFormula(F);
      formulas.splice(i,1);
    }
  }
}
function killFormula(F){
  for(var i=0;i<F.glyphs.length;i++){
    var g=F.glyphs[i];
    if(g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
  }
  F.glyphs=[];F.dead=true;
}
var particles=[];
var shakeAmp=0,shakeDur=0,shakeT=0,shakeOn=false;
function shake(a,d){shakeAmp=Math.max(shakeAmp,a);shakeDur=Math.max(shakeDur,d);shakeT=0;shakeOn=true;}
function stepParticles(dt){
  for(var i=particles.length-1;i>=0;i--){
    var p=particles[i];
    p.age+=dt;
    var damp=Math.pow(0.35,dt);
    p.vx*=damp;p.vy*=damp;
    p.x+=p.vx*dt;p.y+=p.vy*dt;
    p.alpha=Math.max(0,1-p.age/p.life);
    if(p.age>=p.life)particles.splice(i,1);
  }
}
function spawnExplosion(cx,cy){
  var N=240;
  for(var i=0;i<N;i++){
    var ang=Math.random()*6.2832;
    var sp=120+Math.random()*820;
    var r=1+Math.random()*2.4;
    particles.push({x:cx+(Math.random()*10-5),y:cy+(Math.random()*10-5),vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,age:0,life:0.9+Math.random()*1.1,r:r,alpha:1});
  }
}
// BLAST WAVE (mc² explosion / black-hole detonation):
//  - whole bodies in range  -> shatter into their OWN letters, flung outward (letters
//    inherit the big kick and their speed decays fast — freeLetter damping)
//  - free letters in range  -> vaporized outright
//  - rendered formula shards -> blown away with an outward kick
function blastAt(cx,cy,R){
  for(var j=bodies.length-1;j>=0;j--){
    var O=bodies[j];
    if(O.bh)continue;
    if(grab.kind==='body'&&grab.obj===O)continue;
    // 画出来的边界（线/图形）走专门的撕裂/汽化（不能被 O.kind 一刀切跳过）：
    // 闭合图形汽化成粒子，开放笔画被撕成 2~3 段继续飞。
    if(O.kind==='W'){
      if(Math.hypot(O.x-cx,O.y-cy)<=R)blastBoundary(O,cx,cy);
      continue;
    }
    if(O.kind==='S'||O.kind==='T'){
      /* 范围内的 S（弹簧/轻绳）/ T（杆）直接销毁，冲击波对它们才有效（下面的 if(O.kind)continue 会跳过所有带 kind 的体）。
       * killBody 负责摘掉引用它的 Matter 约束、铰链 Constraint 并唤醒睡眠体，不会留下幽灵约束把宿主钉住。 */
      if(Math.hypot(O.x-cx,O.y-cy)<=R){
        burstParticles(O.x,O.y,14,0.9);
        if(O.anc){O.anc[0]=null;O.anc[1]=null;}   // 先解绑，免得求解器这一帧还去够已经没了的体
        killBody(O);
      }
      continue;
    }
    if(O.kind)continue;
    var dx=O.x-cx,dy=O.y-cy;
    var d=Math.hypot(dx,dy);
    if(d<=R){
      var dirx=dx/(d||1),diry=dy/(d||1);
      var fl=1200*(1-d/R)+240;
      O.vx+=dirx*fl;O.vy+=diry*fl;
      O.shatterBlast=true;   // stepPhysics converts this into shatter(O,'split')
    }
  }
  for(var fl2=freeL.length-1;fl2>=0;fl2--){
    var L2=freeL[fl2];
    if(L2.state==='grab')continue;
    var ldx=L2.wx-cx,ldy=L2.wy-cy;
    if(Math.hypot(ldx,ldy)<=R){killLetter(L2);}   // killLetter already removes it from freeL
  }
  for(var fx2=formulas.length-1;fx2>=0;fx2--){
    var F=formulas[fx2];
    var fdx=F.x-cx,fdy=F.y-cy;
    var fd=Math.hypot(fdx,fdy);
    if(fd<=R){
      var k2=1-fd/R;
      F.vx+=(fdx/(fd||1))*(900+500*k2);
      F.vy+=(fdy/(fd||1))*(900+500*k2);
    }
  }
}
function blastBoundary(O,cx,cy){
  // mc² 冲击波对边界的专门处理：闭合图形（矩形/三角形/凹槽）没有字母碎片可炸，直接汽化成粒子（同 annihBody）；
  // 开放笔画被撕成 2~3 段，各自带着向外的冲量继续飞。
  var i0=bodies.indexOf(O);if(i0<0)return;
  if(O.closed||O.pts.length<8){annihBody(O,i0);return;}
  var wp=bndPts(O),nSeg=wp.length-1,nCut=(nSeg>=24)?3:2,c1;
  var cuts=[];
  for(c1=1;c1<=nCut;c1++)cuts.push(Math.round(nSeg*c1/(nCut+1)));
  var prev=0;
  for(c1=0;c1<=nCut;c1++){
    var endP=(c1<nCut)?cuts[c1]:nSeg;
    var seg=wp.slice(prev,endP+1);prev=endP;
    if(seg.length<2)continue;
    var nb=mkBoundary(seg,{shape:'poly',closed:false});
    if(!nb)continue;
    var scx=0,scy=0,q;
    for(q=0;q<seg.length;q++){scx+=seg[q][0];scy+=seg[q][1];}
    scx/=seg.length;scy/=seg.length;
    var ddx=scx-cx,ddy=scy-cy,dd=Math.hypot(ddx,ddy)||1;
    var fl=1200*(1-Math.min(1,dd/320))+240;
    nb.vx=O.vx+ddx/dd*fl;nb.vy=O.vy+ddy/dd*fl;
    if(nb.mb){Matter.Body.setVelocity(nb.mb,{x:nb.vx/60,y:nb.vy/60});Matter.Sleeping.set(nb.mb,false);}
  }
  removeMatterBody(O);
  bodies.splice(i0,1);
  burstParticles(O.x,O.y,10,0.8);
}
function explodeBody(B){
  var cx=B.x,cy=B.y;
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  spawnExplosion(cx,cy);
  for(var j=0;j<B.glyphs.length;j++){var g=B.glyphs[j];if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}}
  B.glyphs=[];B.mem=[];
  blastAt(cx,cy,300);   // shockwave: shatter nearby wholes, vaporize nearby loose letters
  shake(16,0.55);
}
function stepExplode(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B.exploding)continue;
    B.explT+=dt;
    var T=0.9;
    var k=clamp(B.explT/T,0,1);
    B.infl=1+0.7*k;
    B.wob=Math.sin(B.explT*38)*0.05*k;
    // NOTE: velocity is NOT zeroed here — the inflating mc² keeps moving and can be
    // pushed/gravitated like any other body (stepPhysics handles it).
    if(B.explT>=T){explodeBody(B);break;}
  }
}
// ================= BLACK HOLE (2GM/c² -> collapse) =================
var BH_MAXR=105;
// full-screen reach: pull tapers linearly to 0 at the screen's diagonal so the influence
// feels whole-screen but is exactly 0 at the rim and stronger the closer it is to the hole
var BH_REACH=2000;
/* 黑洞出现 BH_FORCE_AGE 秒后强制清场：场上剩余物体直接碎裂为粒子被吸入。
 * stage-1 的吞噬有三重门槛：d>BH_REACH 直接跳过；吸力按 1/d² 衰减，远处几乎不动；
 * fixed 锚死或装配体被杆约束连成整体时等效加速度被稀释（补偿上限 8 倍，连着固定点拉不动是正确物理）
 * ⇒ 连接体/远处物体可能永远进不了视界，需要这个兜底。 */
var BH_FORCE_AGE=15;
function stepBlackHole(dt){
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B.bh)continue;
    var bh=B.bh;
    bh.age+=dt;bh.spin+=dt*(0.5+bh.r/60);
    if(bh.stage===0){
      // stage 0 — collapse: horizon grows outward while the formula's letters
      // (2, G, M, c, ²) spiral inward and get sucked through (alpha -> 0).
      bh.t+=dt;
      var k=bh.t/0.8;
      if(k>=1){bh.stage=1;bh.r=BH_MAXR;continue;}
      var ek=1-Math.pow(1-clamp(k,0,1),3);
      bh.r=BH_MAXR*ek*0.5;
      var s=clamp(1-k*1.4,0,1);
      B.infl=s;B.wob=Math.sin(bh.t*30)*0.3*k;
      bh.fade=(k>0.7)?clamp(1-(k-0.7)*4,0,1):1;   // letters sink into the horizon
      if(k>=0.92){
        // the letters are consumed by the horizon
        B.glyphs.slice().forEach(function(g){if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}});
        B.glyphs=[];
      }
      continue;
    }
    // ---- stage 1 — alive: devour EVERYTHING on screen (whole-screen accretion) ----
    if(!(BH_MERGE&&(BH_MERGE.a===B||BH_MERGE.b===B))){if(B.vx||B.vy){B.vx=0;B.vy=0;}}   // the hole itself is immovable（BH_MERGE 合并期间除外）
    if(BH_FINALE&&BH_FINALE.hole===B)continue;   // finale drives the hole visuals now (suck/shrink)
    if(grab.kind==='body'&&grab.obj===B)continue;   // paused while the hole is being dragged
    /* 到时清场：不看距离、质量、是否 fixed（黑洞面前固定不住），逐个爆粒子并走既有的湮灭/清场通道。
     * 只做一次（bh.forced），否则每帧重扫会连刚生成的粒子一起爆。被指针抓着的体跳过。 */
    if(!bh.forced&&bh.age>BH_FORCE_AGE){
      bh.forced=1;
      for(var fj=bodies.length-1;fj>=0;fj--){
        var OF=bodies[fj];
        if(!OF||OF===B||OF.bh||OF.dead)continue;
        if(grab.kind==='body'&&grab.obj===OF)continue;
        var ofIsField=(OF.kind==='q'||OF.kind==='I'||OF.kind==='B'||OF.kind==='E');
        try{
          burstParticles(OF.x,OF.y,10,1);
          if(ofIsField)killFieldBody(OF,fj); else annihBody(OF,fj);
        }catch(e3){}
      }
      for(var fl2=freeL.length-1;fl2>=0;fl2--){
        var LF=freeL[fl2];
        if(!LF||LF.dead)continue;
        try{burstParticles(LF.wx||LF.x||0,LF.wy||LF.y||0,4,0.6);}catch(e4){}
        LF.body=null;LF.inBody=false;
        try{killLetter(LF);}catch(e5){}
      }
    }
    // BH reach: full-screen diagonal + margin. The pull tapers linearly to 0 at the edge so
  // the influence FEELS whole-screen but fades out at the screen boundary — a corner is no
  // stronger than another, and at the very rim the pull is exactly zero.
  var reach=BH_REACH;
    /* 吸力加速度与质量无关，但杆约束把互连物体连成整体，有效加速度被稀释 m_self/M_total 倍。
     * 按「装配体总质量 / 自质量」放大吸力（BFS 连通分量，上限 8 倍防爆炸）；
     * 连着固定点的装配体拉不动是正确物理（fixed 锚死），不在补偿之列。 */
    var _asmMult={};
    (function(){
      var seen={};
      for(var qi=0;qi<bodies.length;qi++){
        var Q0=bodies[qi];
        if(seen[Q0.i]!=null)continue;
        var comp=[],stk=[Q0];seen[Q0.i]=1;
        while(stk.length){
          var N=stk.pop();comp.push(N);
          for(var r2=0;r2<bodies.length;r2++){
            var RR2=bodies[r2];
            if(RR2.kind!=='T'||RR2.dead||!RR2.anc)continue;
            var aa2=RR2.anc[0],ab2=RR2.anc[1];
            if(!(aa2&&ab2&&aa2.B&&ab2.B))continue;
            var other=null;
            if(aa2.B===N&&!ab2.B.dead&&!seen[ab2.B.i])other=ab2.B;
            if(ab2.B===N&&!aa2.B.dead&&!seen[aa2.B.i])other=aa2.B;
            if(other){seen[other.i]=1;stk.push(other);}
          }
        }
        var Mtot=0;
        for(var ci=0;ci<comp.length;ci++)Mtot+=((comp[ci].mb&&!comp[ci].mb.isStatic)?comp[ci].mb.mass:1)||1;
        for(ci=0;ci<comp.length;ci++){
          var mm2=((comp[ci].mb&&!comp[ci].mb.isStatic)?comp[ci].mb.mass:1)||1;
          _asmMult[comp[ci].i]=Math.max(1,Math.min(8,Mtot/mm2));
        }
      }
    })();
    for(var j=bodies.length-1;j>=0;j--){
      var O=bodies[j];
      if(O===B||O.bh)continue;
      if(grab.kind==='body'&&grab.obj===O)continue;
      var dx=B.x-O.x,dy=B.y-O.y;
      var d=Math.hypot(dx,dy)||1;
      if(d>reach){O.bhFade=null;O.bhShed=0;continue;}
      // spiral accretion, closer = much stronger. The pull has a radial part and a
      // tangential part (spiral), and ACCRETION DRAG — velocity-proportional damping,
      // a true energy sink that is stronger the closer the body is. No stable orbit
      // can survive the drag: everything spirals in and gets swallowed.
      // Field sources (B/E) and rods ARE devoured too — they are objects on the canvas.
      var fall=(O.kind==='q'||O.kind==='I');
      var src=(O.kind==='B'||O.kind==='E');
      var taper=clamp(1-d/reach,0,1);
      var inv=1/Math.max(d,20);
      var ux2=dx*inv,uy2=dy*inv;       // toward the hole
      var tx2=-uy2,ty2=ux2;            // tangential (spiral)
      var pull=(fall?1600:(src?5000:20000))*bh.r/(d*d)*(dt*60)*taper;
      var _am=_asmMult[O.i]||1;
      O.vx+=ux2*pull*_am;O.vy+=uy2*pull*_am;
      O.vx+=tx2*pull*0.5*_am;O.vy+=ty2*pull*0.5*_am;
      var drg=Math.pow(0.25,dt*1.6*Math.min(1,bh.r/Math.max(d,30)));
      O.vx*=drg;O.vy*=drg;
      // B/E sources and rods are skipped by stepPhysics (static), so integrate them here.
      // W 边界是 Matter 刚体，stepMatter 每帧用 mb.position 覆写 B.x/B.y，直接手推坐标会被吞掉，
      // 必须把速度注入 Matter 本体；固定（static）的边界用 setPosition 硬拽（黑洞面前固定不住）。
      if(O.kind==='W'&&O.mb){
        if(O.fixed){Matter.Body.setPosition(O.mb,{x:O.x+O.vx*dt,y:O.y+O.vy*dt});}
        else{Matter.Body.setVelocity(O.mb,{x:O.vx/60,y:O.vy/60});}
        Matter.Sleeping.set(O.mb,false);
      }
      else if(src||O.kind==='T'){O.x+=O.vx*dt;O.y+=O.vy*dt;}
      // progressive disintegration: the nearer it gets, the faster it sheds particles and
      // the more it has eroded away — it visibly comes apart on the way in. The falloff is
      // long enough (~280px) that disintegration starts far from the horizon so the trail
      // is clearly visible.
      var near=clamp(1-(d-bh.r)/280,0,1);
      if(near>0){
        O.bhShed=(O.bhShed||0)+dt;
        var iv=0.06-0.045*near;
        if(O.bhShed>=iv){
          O.bhShed=0;
          burstParticles(O.x+(Math.random()*22-11),O.y+(Math.random()*22-11),2+Math.round(near*3),0.45);
        }
        O.bhFade=clamp(1-near*1.1,0.06,1);
      }
      if(d<bh.r+16){   // swallowed
        if(fall||src){
          burstParticles(O.x,O.y,12,1);
          killFieldBody(O,j);
        }else{
          annihBody(O,j);   // particleize the whole into the hole
        }
      }
    }
    for(var fl=freeL.length-1;fl>=0;fl--){
      var L2=freeL[fl];
      if(L2.state==='grab')continue;
      var fdx=B.x-L2.wx,fdy=B.y-L2.wy;
      var fd=Math.hypot(fdx,fdy)||1;
      if(fd>reach)continue;
      var fux=fdx/fd,fuy=fdy/fd;
      var ftap=clamp(1-fd/reach,0,1);
      var fpull=(26000*bh.r)/(fd*fd)*(dt*60)*ftap;
      L2.vx+=fux*fpull*2.2;L2.vy+=fuy*fpull*2.2;
      L2.vx+=(-fuy)*fpull*0.5;L2.vy+=(fux)*fpull*0.5;
      // progressive disintegration: the letter visibly flicks apart and fades as it falls
      var fnear=clamp(1-(fd-bh.r)/280,0,1);
      if(fnear>0){
        L2.bhShed=(L2.bhShed||0)+dt;
        var fiv=0.06-0.045*fnear;
        if(L2.bhShed>=fiv){
          L2.bhShed=0;
          burstParticles(L2.wx+(Math.random()*10-5),L2.wy+(Math.random()*10-5),1+Math.round(fnear*2),0.4);
        }
        L2.fade=clamp(1-fnear*1.0,0.1,1);
      }
      if(fd<bh.r+8){killLetter(L2);burstParticles(B.x,B.y,14,1);}   // killLetter removes it from freeL
    }
    // formulas (rendered collision shards) also get pulled in and consumed
    for(var fx=formulas.length-1;fx>=0;fx--){
      var F=formulas[fx];
      var fx2=B.x-F.x,fy2=B.y-F.y;
      var fd2=Math.hypot(fx2,fy2)||1;
      if(fd2>reach)continue;
      var fux2=fx2/fd2,fuy2=fy2/fd2;
      var ftap2=clamp(1-fd2/reach,0,1);
      var fp=(20000*bh.r)/(fd2*fd2)*(dt*60)*ftap2;
      F.vx+=fux2*fp*2.2-fuy2*fp*0.5;F.vy+=fuy2*fp*2.2+fux2*fp*0.5;
      if(fd2<bh.r+10){killFormula(F);formulas.splice(fx,1);burstParticles(B.x,B.y,14,1);}
    }
    // the debris itself falls in: particles spiral into the hole and wink out at the horizon
    for(var pi=particles.length-1;pi>=0;pi--){
      var p=particles[pi];
      var pdx=B.x-p.x,pdy=B.y-p.y;
      var pd=Math.hypot(pdx,pdy)||1;
      if(pd>reach)continue;
      var pux=pdx/pd,puy=pdy/pd;
      var ptap=clamp(1-pd/reach,0,1);
      var ppull=(30000*bh.r)/(pd*pd)*(dt*60)*ptap;
      p.vx+=pux*ppull*1.6-puy*ppull*0.5;
      p.vy+=puy*ppull*1.6+pux*ppull*0.5;
      if(pd<bh.r*0.75){particles.splice(pi,1);}   // crossed the horizon
    }
    // the top-right panel gets devoured too — letters detach and fly into the hole, then the
    // bare panel itself breaks apart in chunks nearest the hole first
    stepBlackHolePanel(B,bh,dt);
    // slow breathing of the horizon
    bh.r=BH_MAXR+Math.sin(bh.age*2.2)*3;
  }
}
// the hole slowly pulls docked letters out of the top-right panel, one at a time. Each
// letter that is taken leaves an EMPTY slot in the tray frame — the frame itself never
// shrinks or breaks apart (its 4x4 grid rows are fixed in CSS, and each letter is pinned
// to its own cell by sortPanel/dockSlotEl).
function ensurePanelEat(bh){
  if(bh.panelEat)return;
  bh.panelEat={t:0.45+Math.random()*0.35};
}
function stepBlackHolePanel(B,bh,dt){
  ensurePanelEat(bh);
  var pe=bh.panelEat;
  if(!pe)return;
  pe.t-=dt;
  if(pe.t>0)return;
  var pool=[];
  var chars=[].slice.call(panel.querySelectorAll('.char'));
  for(var i=0;i<chars.length;i++){
    var r=chars[i].getBoundingClientRect();
    var ref=chars[i]._letterRef;
    if(ref&&ref.state==='dock'&&ref.el===chars[i]){
      pool.push({cx:r.x+r.width/2,cy:r.y+r.height/2,d:ref});
    }
  }
  if(!pool.length)return;   // tray fully emptied — the hole moves on to its finale
  // RANDOM batch: sometimes a single letter slips away, sometimes two or three go at once,
  // always picked at random across the whole tray (no fixed near-to-far order).
  var rr=Math.random();
  var count=rr<0.38?1:rr<0.68?2:rr<0.88?3:4;
  if(count>pool.length)count=pool.length;
  for(var c=0;c<count;c++){
    var idx=Math.floor(Math.random()*pool.length);
    var cell=pool[idx];
    pool.splice(idx,1);
    if(!cell||!cell.d)continue;
    var dx=B.x-cell.cx,dy=B.y-cell.cy,dd=Math.hypot(dx,dy)||1;
    var sp=180+Math.random()*300;
    // jitter so a multi-letter batch fans out instead of overlapping
    var jx=(Math.random()-0.5)*130,jy=(Math.random()-0.5)*130;
    freeLetter(cell.d,cell.cx,cell.cy,(dx/dd)*sp+jx,(dy/dd)*sp+jy,1);
  }
  pe.t=0.5+Math.random()*1.15;   // irregular pause between events
}
// ================= black-hole finale =================
// Once the hole has devoured EVERYTHING (all tray letters, all bodies, no free letters),
// it pulls the trash bin across the screen, gets swallowed by the bin, the bin shakes twice
// ("something trying to get out"), then the bin BURSTS — every tray letter flies out of it
// and glides back into its own slot, and the bin returns home to the bottom-right corner.
var BH_FINALE=null;
// k / x 也要能被黑洞吃掉（和面板里其它符号一视同仁）
var BH_CHARS=['m','M','g','a','v','r','½','μ','c','G','t','B','E','q','I','k','x'];
function finaleSlot(i,pr){
  var col=i%4,row=Math.floor(i/4);
  return {x:pr.left+10+col*50+22,y:pr.top+10+row*50+22};
}
function resetTrashPos(){
  trash.style.left='';trash.style.top='';trash.style.transform='';
  trash.style.right='24px';trash.style.bottom='24px';
}
function trashTo(px,py){
  trash.style.right='auto';trash.style.bottom='auto';
  trash.style.left=px+'px';trash.style.top=py+'px';
}
function trashCenter(){
  var r=trash.getBoundingClientRect();
  return {x:r.left+r.width/2,y:r.top+r.height/2};
}
/* 两黑洞合并：只剩黑洞时两洞解除 immovable、互相螺旋吸引（径向 + 切向），接触即合并（r=√(r1²+r2²)），
 * 之后正常走 finale。当前已停用（不能同时存在两个黑洞，见 maybeStartFinale 与出生处门控）。 */
var BH_MERGE=null;
function stepBHMerge(dt){
  if(!BH_MERGE)return;
  var A=BH_MERGE.a,Bb=BH_MERGE.b;
  if(BH_MERGE.ax0==null){BH_MERGE.ax0=A.x;BH_MERGE.ay0=A.y;}
  if(!A||!Bb||A.dead||Bb.dead||!A.bh||!Bb.bh){BH_MERGE=null;return;}
  var dx=Bb.x-A.x,dy=Bb.y-A.y,d=Math.hypot(dx,dy)||1;
  /* 参数化螺旋。不要直接换成真实并合模型：未做数值稳定性（子步/限幅）时会产生 NaN。 */
  var RR=Math.max(A.bh.r,Bb.bh.r);
  /* 场上还有未吞的普通体 ⇒ 只螺旋靠近不合并；没有 ⇒ 允许合并 */
  var _others=0;
  for(var _oi=0;_oi<bodies.length;_oi++){var _Ob=bodies[_oi];
    if(_Ob!==A&&_Ob!==Bb&&!(_Ob.bh&&_Ob.bh.stage===1)&&!_Ob.dead)_others++;}
  /* 只数 bodies，不数自由字母 freeL：黑洞可能永远吞不完某些自由字母（飞出面板的、被固定的），
   * 计入后会永不融合；由下面的倒计时强制合并兜底。 */
  if(BH_MERGE.ph==='orbit'&&_others===0&&d<RR*4)BH_MERGE.ph='plunge';   // 吸完瞬间 ⇒ 收尾
  if(_others===0&&!BH_MERGE.t0)BH_MERGE.t0=performance.now();
  /* 倒计时强制合并：从物体吸完（t0）起，5~10s 渐进加力（plunge + boost 最高 4×），满 10s 无条件合并，
   * 防止两洞卡在轨道上抽搐不融合。 */
  if(BH_MERGE.t0){
    var _el=performance.now()-BH_MERGE.t0;
    if(_el>5000){
      BH_MERGE.ph='plunge';
      BH_MERGE.boost=Math.max(BH_MERGE.boost||1,1+3*Math.min(1,(_el-5000)/5000));
    }
    if(_el>10000){
      burstParticles(Bb.x||A.x,Bb.y||A.y,40,2);
      if(isFinite(A.bh.r)&&isFinite(Bb.bh.r))A.bh.r=Math.sqrt(A.bh.r*A.bh.r+Bb.bh.r*Bb.bh.r);
      else A.bh.r=BH_MAXR*1.4;
      A.bh.r=Math.min(A.bh.r,BH_MAXR*1.6);
      A._rcg=0;Bb._rcg=0;
      if(A.mb&&MW)A.mb.collisionFilter.group=0;
      killBody(Bb);BH_MERGE=null;return;
    }
  }
  /* 任一侧位置/半径变 NaN ⇒ 立刻复位：否则渲染报 createRadialGradient non-finite 并永远卡住。 */
  if(!isFinite(A.x)||!isFinite(A.y)||!isFinite(A.bh.r)){
    A.x=BH_MERGE.ax0||600;A.y=BH_MERGE.ay0||300;A.vx=0;A.vy=0;
    if(!isFinite(A.bh.r))A.bh.r=BH_MAXR;
    if(A.mb&&MW)Matter.Body.setPosition(A.mb,{x:A.x,y:A.y});
  }
  if(!isFinite(Bb.x)||!isFinite(Bb.y)||!isFinite(Bb.bh.r)){
    Bb.x=(BH_MERGE.ax0||600)+200;Bb.y=BH_MERGE.ay0||300;Bb.vx=0;Bb.vy=0;
    if(!isFinite(Bb.bh.r))Bb.bh.r=BH_MAXR;
    if(Bb.mb&&MW)Matter.Body.setPosition(Bb.mb,{x:Bb.x,y:Bb.y});
  }
  /* 正常合并需吸完（t0）后至少 5s，留出螺旋观赏期；满 10s 由上面的分支强制合并。 */
  var _sinceT0=BH_MERGE.t0?(performance.now()-BH_MERGE.t0):0;
  if(d<RR*0.8&&_others===0&&_sinceT0>=5000){
    burstParticles(Bb.x,Bb.y,40,2);ringGo(Bb.x,Bb.y);
    A.bh.r=Math.sqrt(A.bh.r*A.bh.r+Bb.bh.r*Bb.bh.r);
    A.bh.r=Math.min(A.bh.r,BH_MAXR*1.6);
    killBody(Bb);
    BH_MERGE=null;
  }
}
function maybeStartFinale(){
  /* BH_FINALE 自愈：finale 中途被打断或黑洞被清屏移除时，残留的 BH_FINALE 会让 if(BH_FINALE)return 永久挡住后续黑洞；
   * 宿主已死/不在场/超时（25s）则清掉再继续。 */
  if(BH_FINALE){
    var _fh=BH_FINALE.hole;
    var _stale=(!_fh||_fh.dead||bodies.indexOf(_fh)<0||
                (BH_FINALE.t0&&performance.now()-BH_FINALE.t0>25000));
    if(_stale)BH_FINALE=null;else return;
  }
  if(grab.kind||trashDrag.active)return;
  var hole=null,holes=[];
  for(var i=0;i<bodies.length;i++){
    var Bx=bodies[i];
    if(Bx.bh&&Bx.bh.stage===1){if(!hole)hole=Bx;holes.push(Bx);}
  }
  if(!hole)return;
  /* 合并只在 otherBodies===0（吸完）后允许，判定在 stepBHMerge 里。 */
  var otherBodies=0;
  for(i=0;i<bodies.length;i++){var By=bodies[i];if(!(By.bh&&By.bh.stage===1))otherBodies++;}
  /* 两黑洞合并已停用：若出现两个洞（极端情况）也不启动合并，各自独立存在。 */
  if(holes.length>=2)return;
  var docked=false;
  var chars=panel.querySelectorAll('.char');
  for(var j=0;j<chars.length;j++){
    var ref=chars[j]._letterRef;
    if(ref&&ref.state==='dock'){docked=true;break;}
  }
  if(docked)return;                 // tray letters still remain to be eaten
  if(bodies.length>1)return;        // other bodies still being devoured
  if(freeL.length||formulas.length)return;   // debris still in flight
  // everything is consumed — begin the finale
  var bin=trash.getBoundingClientRect();
  hole.bh.finalizing=true;
  BH_FINALE={ph:'pull',t:0,hole:hole,
    hx:hole.x,hy:hole.y,
    bl:bin.left,bt:bin.top,bw:bin.width,bhh:bin.height,
    pullD:1.05,suckD:0.55,shakeD:0.85,letters:[],removed:false};
}
function suckPuff(x,y,tx,ty){
  for(var n=0;n<3;n++){
    var a=Math.random()*6.2832;
    particles.push({x:x+(Math.random()*10-5),y:y+(Math.random()*10-5),
      vx:Math.cos(a)*60+(tx-x)*1.6,vy:Math.sin(a)*60+(ty-y)*1.6,
      age:0,life:0.28+Math.random()*0.22,r:1+Math.random()*1.4,alpha:1});
  }
}
function finaleBurst(){
  var F=BH_FINALE;
  var pr=panel.getBoundingClientRect();
  var names=['mO','M2O','gO','aO','vO','rO','halfO','muO','cO','GO','tO','BO','EO','qO','IO'];
  var refs=[mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO];
  for(var i=0;i<BH_CHARS.length;i++){
    var old=refs[i];
    if(old&&old.el&&old.el.parentNode)old.el.parentNode.removeChild(old.el);
    var nd=GD(BH_CHARS[i]);
    nd.cat=1;nd.pop=0;
    switch(names[i]){
      case 'mO':mO=nd;break;case 'M2O':M2O=nd;break;case 'gO':gO=nd;break;case 'aO':aO=nd;break;
      case 'vO':vO=nd;break;case 'rO':rO=nd;break;case 'halfO':halfO=nd;break;case 'muO':muO=nd;break;
      case 'cO':cO=nd;break;case 'GO':GO=nd;break;case 'tO':tO=nd;break;case 'BO':BO=nd;break;
      case 'EO':EO=nd;break;case 'qO':qO=nd;break;case 'IO':IO=nd;break;
    }
    nd.el.style.fontSize='34px';
    nd.el.style.pointerEvents='none';
    DD.body.appendChild(nd.el);
    var a=Math.random()*6.2832,sp=240+Math.random()*360;
    var tgt=finaleSlot(i,pr);
    F.letters.push({d:nd,el:nd.el,x:F.bx||F.hx,y:F.by||F.hy,
                    vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,tx:tgt.x,ty:tgt.y,arr:false});
    place(nd,F.hx,F.hy,0,1,true);
  }
  burstParticles(F.hx,F.hy,24,1.5);
  ringGo(F.hx,F.hy);
}
function stepFinale(dt){
  if(BH_MERGE){stepBHMerge(dt);return;}
  if(!BH_FINALE){maybeStartFinale();return;}
  var F=BH_FINALE;
  F.t+=dt;
  if(F.ph==='pull'){
    // the hole drags the bin across the screen toward itself (accelerating)
    var e=Math.min(1,F.t/F.pullD);e=e*e;
    var bc=trashCenter();
    var sx=F.bl+F.bw/2,sy=F.bt+F.bhh/2;
    var cx=sx+(F.hx-sx)*e,cy=sy+(F.hy-sy)*e;
    trashTo(cx-F.bw/2,cy-F.bhh/2);
    if(F.t>=F.pullD){
      F.ph='suck';F.t=0;
    }
  }else if(F.ph==='suck'){
    // the hole shrinks and streams into the bin, then vanishes inside it
    /* e2 的 NaN 防护：F.t 被污染成 NaN 时会把 bh.r 写成 NaN，缩洞动画整个失效。 */
    var e2=Math.min(1,Math.max(0,(isFinite(F.t/F.suckD)?F.t/F.suckD:0)));
    var h=F.hole;
    if(!isFinite(F.t))F.t=0;
    if(h.bh)h.bh.r=Math.max(1.5,BH_MAXR*(1-e2));
    if(Math.random()<0.8)suckPuff(h.x,h.y,F.hx,F.hy);
    if(F.t>=F.suckD){
      var hx=h.x,hy=h.y;
      var bi=bodies.indexOf(h);if(bi>=0)bodies.splice(bi,1);
      if(h.bh){h.bh.dead=true;}
      F.removed=true;
      burstParticles(hx,hy,20,1.2);
      shake(10,0.35);
      F.ph='shake';F.t=0;
    }
  }else if(F.ph==='shake'){
    // two diminishing bounces — something inside is trying to break out
    var p=Math.min(1,F.t/F.shakeD);
    var cyc=p*2.2,n2=Math.floor(cyc),f2=cyc-n2;
    var amp=(1-p)*11;
    var ox=(n2%2===0?1:-1)*Math.sin(f2*Math.PI)*amp;
    var oy=Math.sin(f2*Math.PI*1.7)*2.4*(1-p);
    trash.style.transform='translate('+ox.toFixed(1)+'px,'+oy.toFixed(1)+'px)';
    if(F.t>=F.shakeD){
      F.ph='fly';F.t=0;
      finaleBurst();
    }
  }else if(F.ph==='fly'){
    // letters burst out of the bin and glide back into their tray slots
    var any=false;
    for(var i=0;i<F.letters.length;i++){
      var L=F.letters[i];
      if(L.arr)continue;
      any=true;
      L.vx+=(L.tx-L.x)*24*dt;L.vy+=(L.ty-L.y)*24*dt;
      L.vx*=Math.pow(0.86,dt*60);L.vy*=Math.pow(0.86,dt*60);
      var sp2=Math.hypot(L.vx,L.vy);
      if(sp2>1500){L.vx*=1500/sp2;L.vy*=1500/sp2;}
      L.x+=L.vx*dt;L.y+=L.vy*dt;
      L.el.style.left=(L.x-L.el.offsetWidth/2)+'px';
      L.el.style.top=(L.y-L.el.offsetHeight/2)+'px';
      var d2=Math.hypot(L.tx-L.x,L.ty-L.y);
      if(d2<4&&sp2<140){
        L.arr=true;L.el.style.pointerEvents='';
        dockLetter(L.d);
      }
    }
    // the bin flies home while the letters do
    var e4=Math.min(1,F.t/1.1);
    var sc=trashCenter();
    var hx0=F.hx,hy0=F.hy;
    var hcx=F.bl+F.bw/2,hcy=F.bt+F.bhh/2;
    var cx2=hx0+(hcx-hx0)*e4,cy2=hy0+(hcy-hy0)*e4;
    trashTo(cx2-F.bw/2,cy2-F.bhh/2);
    var arrN=0;for(var k=0;k<F.letters.length;k++)if(F.letters[k].arr)arrN++;
    if(!any&&arrN===F.letters.length||F.t>4.5){
      for(var m2=0;m2<F.letters.length;m2++){
        var L2=F.letters[m2];
        if(!L2.arr){L2.arr=true;L2.el.style.pointerEvents='';dockLetter(L2.d);}
      }
      resetTrashPos();
      BH_FINALE=null;
      return;
    }
  }
}
function annihBody(O,idx){
  // the body is swallowed: it particleizes (letters burst) and merges into the hole
  var cx=O.x,cy=O.y;
  burstParticles(cx,cy,22,1.2);
  ringGo(cx,cy);
  removeMatterBody(O);    // if a boundary is swallowed, its Matter body goes with it
  var i=bodies.indexOf(O);if(i>=0)bodies.splice(i,1);
  if(O.go){var gD=O.go;if(gD.bin){var P2=gD.by;if(P2&&bodies.indexOf(P2)>=0){P2.vx=-Math.sin(gD.ang)*gD.w*gD.rad*gD.rP;P2.vy=Math.cos(gD.ang)*gD.w*gD.rad*gD.rP;P2.goB=null;}}O.go=null;}
  if(O.goB&&bodies.indexOf(O.goB)>=0){var H2=O.goB,gH2=H2.go;if(gH2){H2.vx=-Math.sin(gH2.ang)*gH2.w*gH2.rad*gH2.rB;H2.vy=Math.cos(gH2.ang)*gH2.w*gH2.rad*gH2.rB;H2.go=null;}O.goB.goB=null;}
  O.diss=true;
  for(var j=0;j<O.glyphs.length;j++){
    var g=O.glyphs[j];
    if(g.body===O){g.body=null;g.inBody=false;killLetter(g);}
  }
  O.glyphs=[];O.mem=[];
}
function burstParticles(cx,cy,n,sp){
  for(var i=0;i<n;i++){
    var ang=Math.random()*6.2832;
    var v=140+Math.random()*320*sp;
    particles.push({x:cx+(Math.random()*16-8),y:cy+(Math.random()*16-8),vx:Math.cos(ang)*v,vy:Math.sin(ang)*v,age:0,life:0.7+Math.random()*0.8,r:1.2+Math.random()*2.2,alpha:1});
  }
}
// a field source (B / E) or a charge/current (q / I) swallowed by the hole: its field dies
// with it, so it is simply destroyed in a last puff of debris.
function killFieldBody(O,idx){
  burstParticles(O.x,O.y,16,1.1);
  ringGo(O.x,O.y);
  killBody(O);
}
// kill (trash / double-click) of a LIVE black hole: it "explodes" — a blast wave
// shatters whole bodies in range into their own letters (flung outward, fast decay),
// free letters are vaporized outright, and formulas are blown away.
var BLAST_R=500;
function explodeBlackHole(B){
  var cx=B.x,cy=B.y;
  var i=bodies.indexOf(B);if(i>=0)bodies.splice(i,1);
  if(B.bh)B.bh.dead=true;
  B.diss=true;
  B.glyphs.slice().forEach(function(g){if(g.body===B){g.body=null;g.inBody=false;killLetter(g);}});
  B.glyphs=[];B.mem=[];
  // flash: 240 dark + 120 white-hot particles
  spawnExplosion(cx,cy);
  for(var w=0;w<120;w++){
    var wa=Math.random()*6.2832,ws=200+Math.random()*900;
    particles.push({x:cx,y:cy,vx:Math.cos(wa)*ws,vy:Math.sin(wa)*ws,age:0,life:0.5+Math.random()*0.7,r:1+Math.random()*2,alpha:1,hot:true});
  }
  shake(22,0.8);
  blastAt(cx,cy,BLAST_R);   // blast wave: shatter wholes, vaporize letters, blow shards
}
function drawParticles(){
  for(var i=0;i<particles.length;i++){
    var p=particles[i];
    cvx.fillStyle=p.hot?('rgba(255,224,150,'+p.alpha+')'):('rgba(38,34,28,'+p.alpha+')');
    cvx.beginPath();cvx.arc(p.x,p.y,p.r,0,6.2832);cvx.fill();
  }
}
/* 磁场方向画法：bz<0 画 ⊗（场穿入纸面），bz>0 画 ⊙（场穿出纸面），与 Bz>0 为 +z 出屏一致。 */
function drawFieldDots(cx,cy,R,bz){
  var into=(bz!=null&&bz<0);                 /* 场背向观察者 ⇒ 叉 */
  var col='rgba(38,34,28,0.16)',colS='rgba(38,34,28,0.28)';
  cvx.fillStyle=col;cvx.strokeStyle=colS;cvx.lineWidth=1.3;
  var sp=26;
  for(var gx=-R;gx<=R;gx+=sp){
    for(var gy=-R;gy<=R;gy+=sp){
      if(gx*gx+gy*gy<=R*R){
        var px=cx+gx,py=cy+gy;
        if(!into){
          cvx.beginPath();
          cvx.arc(px,py,1.7,0,6.2832);
          cvx.fill();
        }else{
          /* 叉只画两笔交叉，不加外圈圆（标准 ⊗ 画法）。 */
          var k=4.6;
          cvx.lineWidth=1.6;
          cvx.beginPath();
          cvx.moveTo(px-k,py-k);cvx.lineTo(px+k,py+k);
          cvx.moveTo(px+k,py-k);cvx.lineTo(px-k,py+k);
          cvx.stroke();
          cvx.lineWidth=1.3;
        }
      }
    }
  }
  cvx.strokeStyle='rgba(38,34,28,0.10)';
  cvx.lineWidth=1;
  cvx.beginPath();
  cvx.arc(cx,cy,R,0,6.2832);
  cvx.stroke();
}
// Extent of an (asymmetric) E-box from its centre along the unit direction (ux,uy).
// e.g. u=(1,0) -> the +x edge (er.r); u=(0,-1) -> the TOP edge (er.t). Used so the arrow
// spread, the rotate knob and the resize bar all agree with the real per-edge geometry.
function boxExtentAlong(ux,uy,er){
  if(Math.abs(ux)>=Math.abs(uy))return ux>=0?er.r:er.l;
  return uy>=0?er.b:er.t;
}
function drawFieldE(cx,cy,R,th,B){
  // E field: a (possibly asymmetric) RANGE crossed by parallel arrows whose arrowheads
  // TOUCH the dashed border on BOTH ends. The 4 edges live in B.er {l,r,t,b} (half-extents
  // from the centre), so dragging ONE edge only stretches that side. The arrow slab is
  // clipped to the ACTUAL asymmetric rect — never to a symmetric superset — otherwise the
  // arrows would run past the shorter edges (that was the "线条和边界错位" bug).
  /* eacc（电场强度）的符号在物理里已生效（a=E_FIELD_ACC*eacc*qsign），绘制也要跟着：eacc<0 时箭头方向翻转 180°。 */
  if(B&&B.eacc!=null&&B.eacc<0)th=th+Math.PI;
  var er=B&&B.er?B.er:{l:R/2,r:R/2,t:R/2,b:R/2};
  var hsL=er.l,hsR=er.r,hsT=er.t,hsB=er.b;   // half-extents per side
  var dx=Math.cos(th),dy=Math.sin(th);        // field direction
  var px=-dy,py=dx;                           // perpendicular (spacing direction)
  var ah=Math.atan2(dy,dx);
  // asymmetric rect used as the clip window
  var x0=cx-hsL,x1=cx+hsR,y0=cy-hsT,y1=cy+hsB;
  // spread the arrows over the box's TRUE perpendicular extent (asymmetric-aware)
  var ePos=boxExtentAlong(px,py,er),eNeg=boxExtentAlong(-px,-py,er);
  var span=Math.max(40,ePos+eNeg),mid=(ePos-eNeg)/2;
  var n=Math.max(4,Math.round(span/46));
  var margin=3,al=11;
  cvx.strokeStyle='rgba(38,34,28,0.18)';
  cvx.fillStyle='rgba(38,34,28,0.18)';
  cvx.lineWidth=1.4;cvx.lineCap='round';
  for(var i=0;i<n;i++){
    var off=mid+((n===1)?0:(i-(n-1)/2)*(span/n));
    var ox=cx+px*off,oy=cy+py*off;
    // clip the infinite line through (ox,oy) along (dx,dy) to the asymmetric rect (slab test)
    var t0=-1e9,t1=1e9,okk=true;
    if(Math.abs(dx)>1e-6){
      var a1=(x0-ox)/dx,a2=(x1-ox)/dx;
      t0=Math.max(t0,Math.min(a1,a2));t1=Math.min(t1,Math.max(a1,a2));
    }else if(ox<x0||ox>x1)okk=false;
    if(okk){
      if(Math.abs(dy)>1e-6){
        var b1=(y0-oy)/dy,b2=(y1-oy)/dy;
        t0=Math.max(t0,Math.min(b1,b2));t1=Math.min(t1,Math.max(b1,b2));
      }else if(oy<y0||oy>y1)okk=false;
    }
    if(!okk||t1-t0<26)continue;
    var ax=ox+dx*(t0+margin),ay=oy+dy*(t0+margin);
    var bx=ox+dx*(t1-margin),by=oy+dy*(t1-margin);
    cvx.beginPath();cvx.moveTo(ax,ay);cvx.lineTo(bx,by);cvx.stroke();
    cvx.beginPath();
    cvx.moveTo(bx,by);
    cvx.lineTo(bx-al*Math.cos(ah-0.42),by-al*Math.sin(ah-0.42));
    cvx.lineTo(bx-al*Math.cos(ah+0.42),by-al*Math.sin(ah+0.42));
    cvx.closePath();cvx.fill();
  }
  // asymmetric dashed border: 4 edges each at its own half-extent
  cvx.strokeStyle='rgba(38,34,28,0.12)';
  cvx.lineWidth=1.2;
  cvx.setLineDash([7,6]);
  cvx.beginPath();
  cvx.moveTo(cx-hsL,cy-hsT);cvx.lineTo(cx+hsR,cy-hsT);
  cvx.lineTo(cx+hsR,cy+hsB);cvx.lineTo(cx-hsL,cy+hsB);
  cvx.closePath();cvx.stroke();
  cvx.setLineDash([]);
}
function max2(a,b){return a>b?a:b;}
function stepShake(dt){
  if(!shakeOn)return;
  shakeT+=dt;
  var k=clamp(1-shakeT/shakeDur,0,1);
  var a=shakeAmp*k;
  var dx=(Math.random()*2-1)*a;
  var dy=(Math.random()*2-1)*a;
  document.body.style.transform='translate('+dx+'px,'+dy+'px)';
  if(shakeT>=shakeDur){document.body.style.transform='';shakeOn=false;shakeAmp=0;shakeDur=0;}
}

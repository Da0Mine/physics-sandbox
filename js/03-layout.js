/* 公式排版、面板停靠、字母合并 / 拆分（原 index.html 第 5488–6699 行） */
function layoutField(B){
  if(B.kind==='S'){
    // 弹簧：没有字母、不排公式，几何完全由两端点决定（refreshSpringGeom 负责）
    B.fg=null;B.glyphs=[];B.sc=1;B.frac=false;B.subBar=null;
    refreshSpringGeom(B);
    return;
  }
  if(B.kind==='T'){
    B.fg=null;
    B.hw=B.len/2+2;B.hh=4;   // rod is a 3px thin line -> thin collision box (no float on the ground)
    B.sc=1;B.frac=false;B.subBar=null;
    return;
  }
  B.glyphs=[B.fg];
  B.fg.body=B;B.fg.inBody=true;B.fg.sx=0;B.fg.sy=0;
  B.hw=(B.fg.m.w/2)+8;B.hh=(B.fg.m.bot-B.fg.m.top)/2+4;B.sc=1;B.frac=false;B.subBar=null;
}
// 进圆轨道必须是完整的 mv²/r：除了 mem 里的 v,v,r，还必须有 m 或 M 作质量字母。
// 裸的 v²/r 只是加速度不是向心力，不能进圆轨道。
function isMVR(B){
  return !!(B&&!B.kind&&B.hasV&&B.hasR&&B.vCount>=2&&B.massG&&isMass(B.massG.type));
}
function setF(B){
  B.hasG=false;B.hasA=false;B.hasV=false;B.hasR=false;B.hasHalf=false;B.hasMu=false;B.hasC=false;B.hasGrav=false;
  for(var i=0;i<B.mem.length;i++){
    var tt=B.mem[i].type;
    if(tt==='g')B.hasG=true;
    else if(tt==='a')B.hasA=true;
    else if(tt==='v')B.hasV=true;
    else if(tt==='r')B.hasR=true;
    else if(tt===HALF)B.hasHalf=true;
    else if(tt===MU)B.hasMu=true;
    else if(tt==='c')B.hasC=true;
    else if(tt==='G')B.hasGrav=true;
  }
  B.family=(B.hasG||B.hasA||B.hasMu||B.hasC||B.hasGrav)?1:((B.hasV||B.hasR||B.hasHalf)?2:0);
  B.vCount=0;
  for(var k=0;k<B.mem.length;k++)if(B.mem[k].type==='v')B.vCount++;
  B.cCount=0;
  for(var k2=0;k2<B.mem.length;k2++)if(B.mem[k2].type==='c')B.cCount++;
  B.rCount=0;
  for(var rk=0;rk<B.mem.length;rk++)if(B.mem[rk].type==='r')B.rCount++;
  // ---- gravity formula shape (single source of truth) ----
  // 'schwarz' : 2GM/c²  -> needs G, a capital M and at least one c (no r). The small m is
  //             NOT part of this formula, so it is hidden rather than drawn on top of GM.
  // 'well'    : GMm/r²  -> needs G, a capital M AND the small m, plus r². A bare GM/r² is
  //             an incomplete formula: no ring, no gravity.
  // 'plain'   : incomplete gravity body, drawn as a plain product.
  B.gravMode=gravModeOf(B);
  B.isSchwarzschild=!!(B.gravMode==='schwarz'&&B.cCount>=2);
  B.isWell=!!(B.gravMode==='well');
  if(B.massG){
    var pvM=B.param&&B.param.mass!=null;
    B.mass=pvM?B.param.mass:((B.massG.type==='M')?3:1);
    // capital-M mass stored separately (param key 'massM') so M can be tuned independently
    var pvC=B.param&&B.param.massM!=null;
    B.massCap=pvC?B.param.massM:((B.massG.type==='M')?3:1);
  }
}
function gravModeOf(B){
  if(!B.hasGrav)return 'plain';
  var Mtot=(B.massG&&B.massG.type==='M')?1:0,mtot=(B.massG&&B.massG.type==='m')?1:0;
  var rc=0,cc2=0;
  for(var i=0;i<B.mem.length;i++){
    var t=B.mem[i].type;
    if(t==='M')Mtot++;
    else if(t==='m')mtot++;
    else if(t==='r')rc++;
    else if(t==='c')cc2++;
  }
  if(Mtot>=1&&cc2>=1&&rc<2)return 'schwarz';
  if(Mtot>=1&&mtot>=1&&rc>=2)return 'well';
  return 'plain';
}
function wLet(x){if(x==='g')return 0;if(x==='a')return 1;if(x==='v')return 2;return 3;}
function ensureSt(B){
  var p1=(B.family===1&&B.mem.length>=2&&B.cCount<2&&!(B.hasGrav||B.hasR));
  var p2=(B.family===2&&B.vCount>=2);
  var pFrac=(B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2)||(B.hasGrav&&B.hasR);
  var keeps=[];
  function live(k,ch,sc){
    if(!B.st[k]||B.st[k].dead){if(B.st[k])killG(B.st[k]);B.st[k]=stGD(ch,sc);}
    var g=B.st[k];
    if(B.glyphs.indexOf(g)<0)B.glyphs.push(g);
    g.body=B;g.s=1;keeps.push(g);
  }
  function dead(k){
    if(B.st[k]){killG(B.st[k]);B.st[k]=null;}
  }
  if(p1){live('open',OPEN);live('plus',PLUS);live('close',CLOSE);}
  else{dead('open');dead('plus');dead('close');}
  var gMode=gravModeOf(B);
  var pSq=(B.family===2&&B.vCount>=2)||(B.family===1&&B.cCount>=2&&!B.hasGrav)||(B.hasGrav&&B.rCount>=2)||(gMode==='schwarz'&&B.cCount>=2);
  if(pSq){live('sq',SQ,0.6);}
  else{dead('sq');}
  // a gravity body turns into a fraction as soon as its denominator letter (r or c) arrives,
  // so the letter can never sit on top of the numerator.
  var pFrac=(gMode==='schwarz')||(B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2)||(B.hasGrav&&B.hasR);
  if(pFrac){live('bar',BAR);}
  else{dead('bar');}
  if(B.hasHalf||B.isSchwarzschild){live('h2','2');}
  else{dead('h1');dead('h2');}
  for(var i=B.glyphs.length-1;i>=0;i--){
    var g=B.glyphs[i];
    if(g.stk&&keeps.indexOf(g)<0){B.glyphs.splice(i,1);killG(g);}
  }
}
function killG(g){
  if(!g||g.dead)return;
  g.dead=true;
  if(g.el&&g.el.parentNode)g.el.parentNode.removeChild(g.el);
  if(g.body){var k=g.body.glyphs.indexOf(g);if(k>=0)g.body.glyphs.splice(k,1);}
  g.body=null;
}
function stGD(ch,sc){
  var d=GD(ch,sc||1);
  d.stk=true;
  d.s=1;
  return d;
}
function tokenSeq(B){
  var out=[B.massG];
  if(B.family===0){
    // pure mass stack (M+m): show all mem masses
    for(var mi0=0;mi0<B.mem.length;mi0++)if(isMass(B.mem[mi0]))out.push(B.mem[mi0]);
  }else if(B.family===1){
    if(B.mem.length===1)out.push(B.mem[0]);
    else if(B.cCount>=2){
      var c1=null;
      for(var ci=0;ci<B.mem.length;ci++){if(B.mem[ci].type==='c'){c1=B.mem[ci];break;}}
      if(c1)out.push(c1);
      if(B.st.sq)out.push(B.st.sq);
    }
    else{
      out.push(B.st.open);
      for(var i=0;i<B.mem.length;i++){
        if(i)out.push(B.st.plus);
        out.push(B.mem[i]);
      }
      out.push(B.st.close);
    }
  }else if(B.family===2){
    var vSeen=false;
    for(var j=0;j<B.mem.length;j++){
      var tt=B.mem[j].type;
      if(tt==='r')continue;
      if(tt==='v'){
        if(vSeen)continue;
        vSeen=true;
      }
      out.push(B.mem[j]);
    }
    if(B.vCount>=2)out.push(B.st.sq);
  }
  var fin=[];
  for(var k=0;k<out.length;k++)if(out[k])fin.push(out[k]);
  return fin;
}
function kern(a,b){
  if(a===SQ||b===SQ)return 2;
  if(a===OPEN||b===CLOSE)return 4;
  return 5;
}
function hRun(items){
  var x=0,parts=[];
  for(var i=0;i<items.length;i++){
    var it=items[i];
    var w=it.g.m.w*it.s;
    var gap=(i<items.length-1)?kern(it.g.type, items[i+1].g.type):0;
    parts.push({g:it.g,s:it.s,dy:it.dy,cx:x+w/2,w:w});
    x+=w+gap;
  }
  return {parts:parts,w:x};
}
function placeRun(parts, runW, centerY){
  var top=1e9,bot=-1e9;
  for(var i=0;i<parts.length;i++){var p=parts[i];top=Math.min(top,p.dy+p.g.m.top*p.s);bot=Math.max(bot,p.dy+p.g.m.bot*p.s);}
  var dv=(top+bot)/2;
  for(var j=0;j<parts.length;j++){var q=parts[j];q.g.sx=q.cx-runW/2;q.g.sy=(q.dy-dv)+centerY;}
}
function layoutRun(B, items){
  var run=hRun(items);
  placeRun(run.parts, run.w, 0);
  B.frac=false;
  var top=1e9,bot=-1e9;
  for(var i=0;i<run.parts.length;i++){var p=run.parts[i];top=Math.min(top,p.dy+p.g.m.top*p.s);bot=Math.max(bot,p.dy+p.g.m.bot*p.s);}
  B.hw=run.w/2+5;B.hh=(bot-top)/2+1;B.sc=1;B.subBar=null;
}
function layoutBracket(B){
  var toks=tokenSeq(B);
  var items=[];for(var i=0;i<toks.length;i++)items.push({g:toks[i],s:1,dy:0});
  layoutRun(B,items);
}
function layoutFrac(B, vG, rG){
  // 同 layoutBody：裸体（promoteFreeLetter 提升的非质量字母）的 massG 是 null，
  // 直接当分子基准会在 hRun 里读 null.m 崩掉；取一个安全基准，且不和 vG 重复。
  var base=B.massG||vG||rG||(B.mem&&B.mem[0])||(B.glyphs&&B.glyphs[0])||null;
  var num=[];
  if(base)num.push({g:base,s:1,dy:0});
  if(vG&&vG!==base)num.push({g:vG,s:1,dy:0});
  if(B.vCount>=2&&B.st.sq&&B.st.sq!==base&&B.st.sq!==vG)num.push({g:B.st.sq,s:1,dy:0});
  if(!num.length){B.hw=26;B.hh=26;return;}
  var numR=hRun(num);
  var nTop=1e9,nBot=-1e9;
  numR.parts.forEach(function(p){nTop=Math.min(nTop,p.dy+p.g.m.top*p.s);nBot=Math.max(nBot,p.dy+p.g.m.bot*p.s);});
  var rows=[];
  if(B.hasR&&rG){var rr=hRun([{g:rG,s:1,dy:0}]);rows.push(rr);}
  if(B.hasHalf){var rr2=hRun([{g:B.st.h2,s:1,dy:0}]);rows.push(rr2);}
  rows.forEach(function(r){r.top=1e9;r.bot=-1e9;r.parts.forEach(function(p){r.top=Math.min(r.top,p.dy+p.g.m.top*p.s);r.bot=Math.max(r.bot,p.dy+p.g.m.bot*p.s);});});
  var dGap=7, subGap=3;
  // 分母顶必须定在「线下方 dGap」，不能写成 nBot+dGap：nBot 是分子平移前的底度量（约 +17），
  // 分子随后被 numShift=-dGap-nBot 搬走、底已落到 -dGap；用旧 nBot 会把分母推到线下约 24px，
  // 而分子离线只有 7px。正确写法是 dShift = barGap - dTop。
  var denTop=dGap;
  var dTop,dBot,subBarY=null;
  if(rows.length===1){
    var r0=rows[0];var sh=denTop-r0.top;
    r0.parts.forEach(function(p){p.g.sy=sh+p.dy;});
    dTop=r0.top+sh;dBot=r0.bot+sh;
  }else{
    var A=rows[0],Bb=rows[1];
    var ah=A.bot-A.top;
    subBarY=denTop+ah+subGap/2;
    var shA=subBarY-subGap/2-A.bot;
    A.parts.forEach(function(p){p.g.sy=shA+p.dy;});
    var shB=subBarY+subGap/2-Bb.top;
    Bb.parts.forEach(function(p){p.g.sy=shB+p.dy;});
    dTop=A.top+shA;dBot=Bb.bot+shB;
  }
  var numShift=-dGap-nBot;
  numR.parts.forEach(function(p){p.g.sx=p.cx-numR.w/2;p.g.sy=numShift+p.dy;});
  rows.forEach(function(r){r.parts.forEach(function(p){p.g.sx=p.cx-r.w/2;});});
  var denW=0;rows.forEach(function(r){denW=Math.max(denW,r.w);});
  var fracW=Math.max(numR.w,denW)+14;
  B.st.bar.w=fracW;B.st.bar.h=2;B.st.bar.sx=0;B.st.bar.sy=0;
  var wholeTop=nTop+numShift, wholeBot=dBot;
  var shiftY=-(wholeTop+wholeBot)/2;
  numR.parts.forEach(function(p){p.g.sy+=shiftY;});
  rows.forEach(function(r){r.parts.forEach(function(p){p.g.sy+=shiftY;});});
  B.st.bar.sy=shiftY;
  if(subBarY!=null){B.subBar={y:subBarY+shiftY,w:Math.max(rows[0].w,rows[1].w)+6};}else{B.subBar=null;}
  B.hw=fracW/2+4;B.hh=(wholeBot-wholeTop)/2+2;
  var maxDim=Math.max(fracW,(wholeBot-wholeTop));
  B.sc=clamp(155/maxDim,0.5,1);
  B.frac=true;
}
function gravParts(B){
  // collect the gravity formula's pieces by type so assembly order is irrelevant.
  // bigM = the capital-M letter (from base or mem), smallM = the lowercase-m letter.
  var Gg=null,bigM=null,smallM=null;
  for(var i=0;i<B.mem.length;i++){
    var t=B.mem[i].type;
    if(t==='G'){if(!Gg)Gg=B.mem[i];}
    else if(t==='M'){if(!bigM)bigM=B.mem[i];}
    else if(t==='m'){if(!smallM)smallM=B.mem[i];}
  }
  if(B.massG){
    if(B.massG.type==='M'){if(!bigM)bigM=B.massG;}
    else if(B.massG.type==='m'){if(!smallM)smallM=B.massG;}
  }
  return {Gg:Gg,bigM:bigM,smallM:smallM};
}
function layoutGrav(B){
  var p=gravParts(B),Gg=p.Gg,bigM=p.bigM,smallM=p.smallM,rG=null;
  for(var i=0;i<B.mem.length;i++){if(B.mem[i].type==='r')rG=B.mem[i];}
  var cG=null;
  for(var ci=0;ci<B.mem.length;ci++){if(B.mem[ci].type==='c'){cG=B.mem[ci];break;}}
  var mode=gravModeOf(B);
  function gravItems(){
    var a=[];
    if(B.isSchwarzschild&&B.st.h2)a.push({g:B.st.h2,s:1,dy:0});   // automatic leading "2"
    if(Gg)a.push({g:Gg,s:1,dy:0});
    if(bigM)a.push({g:bigM,s:1,dy:0});
    // 2GM/c² has no lowercase m — it is not part of the formula (it stays hidden)
    if(smallM&&mode!=='schwarz')a.push({g:smallM,s:1,dy:0});
    return a;
  }
  // the denominator is r (GMm/r²) or c (2GM/c²) — as soon as the letter is there it goes
  // UNDER the fraction bar, so it can never overlap the numerator.
  var denMain=(B.hasR&&rG)?rG:((mode==='schwarz'&&cG)?cG:null);
  var gravBase=!!denMain;
  if(gravBase){
    var num=gravItems();
    var numR=hRun(num);
    var nTop=1e9,nBot=-1e9;
    numR.parts.forEach(function(p){nTop=Math.min(nTop,p.dy+p.g.m.top*p.s);nBot=Math.max(nBot,p.dy+p.g.m.bot*p.s);});
    var denMain=(B.hasR&&rG)?rG:((mode==='schwarz'&&cG)?cG:null);
    var den=[{g:denMain,s:1,dy:0}];
    if(B.st.sq&&(B.isSchwarzschild||B.rCount>=2)){
      // superscript ²: raise it so its BOTTOM sits 4px above the denominator main glyph's top
      // (proper exponent), derived from metrics.
      var sqM=B.st.sq.m||{bot:8,top:-12};
      var dySup=(denMain.m.top-sqM.bot)-4;
      den.push({g:B.st.sq,s:1,dy:dySup});
    }
    var dR=hRun(den);
    var dTop=1e9,dBot=-1e9;
    dR.parts.forEach(function(p){dTop=Math.min(dTop,p.dy+p.g.m.top*p.s);dBot=Math.max(dBot,p.dy+p.g.m.bot*p.s);});
    var dGap=7;
    // 同上：分母顶 = 线下 dGap，与分子对称（不要写成 nBot+dGap）
    var denTop=dGap;
    // 锚定的是整个分母块的顶（含上标 ²），不是 denMain 的顶：
    // 只用 denMain 时 r 贴到线下 7px，而 ² 比 r 高约 18px，会横跨分式线被劈成两半。
    // 分子那边是「整块分子的底离线 dGap」，分母也按整块来量。
    var shR=denTop-dTop;
    dR.parts.forEach(function(p){p.g.sx=p.cx-dR.w/2;p.g.sy=shR+p.dy;});
    var numShift=-dGap-nBot;
    numR.parts.forEach(function(p){p.g.sx=p.cx-numR.w/2;p.g.sy=numShift+p.dy;});
    var denW=dR.w;
    var fracW=Math.max(numR.w,denW)+14;
    B.st.bar.w=fracW;B.st.bar.h=2;B.st.bar.sx=0;B.st.bar.sy=0;
    // 分母刚被 shR 平移过，底是 dBot+shR；漏掉 shR 会让 wholeBot 偏小、shiftY 算错，
    // 整条分式在 body 里上下偏心（layoutFrac 那边 dBot 已含平移量）。
    var wholeTop=nTop+numShift, wholeBot=dBot+shR;
    var shiftY=-(wholeTop+wholeBot)/2;
    numR.parts.forEach(function(p){p.g.sy+=shiftY;});
    dR.parts.forEach(function(p){p.g.sy+=shiftY;});
    B.st.bar.sy=shiftY;
    B.subBar=null;
    B.hw=fracW/2+4;B.hh=(wholeBot-wholeTop)/2+2;
    var maxDim=Math.max(fracW,(wholeBot-wholeTop));
    B.sc=clamp(155/maxDim,0.5,1);
    B.frac=true;
  }else{
    // no r yet (and not on the 2GM/c² path): render as a plain product "GMm". EVERY letter
    // the user has glued on participates — in particular stray c's are laid out side by side
    // so they can never sit on top of the row (sx/sy unset -> body centre) and a second c
    // cannot silently drop the G and morph the body into an mc² look-alike.
    var items=gravItems();
    for(var xi=0;xi<B.mem.length;xi++){
      var xg=B.mem[xi];
      if(xg.type==='r')continue;
      var dup=false;
      for(var yj=0;yj<items.length;yj++)if(items[yj].g===xg){dup=true;break;}
      if(!dup)items.push({g:xg,s:1,dy:0});
    }
    var R=hRun(items);
    var top=1e9,bot=-1e9;
    R.parts.forEach(function(p){top=Math.min(top,p.dy+p.g.m.top);bot=Math.max(bot,p.dy+p.g.m.bot);});
    var dv=(top+bot)/2;
    R.parts.forEach(function(p){p.g.sx=p.cx-R.w/2;p.g.sy=(p.dy-dv);});
    B.frac=false;B.subBar=null;
    B.hw=R.w/2+5;B.hh=(bot-top)/2+1;
    B.sc=clamp(155/Math.max(R.w,(bot-top)),0.5,1);
    // glyph list must match exactly what was laid out (refresh skips tokList for these)
    B._plainGlyphs=[];
    for(var gi2=0;gi2<items.length;gi2++)B._plainGlyphs.push(items[gi2].g);
  }
}
function layoutBody(B){
  B.mem.sort(function(x,y){return wLet(x.type)-wLet(y.type);});
  ensureSt(B);
  // promoteFreeLetter 提升的非质量字母（v/r/g/a/μ…）不会被赋值 massG，之后往这个裸体合字母时
  // 排版基准 B.massG 是 null，hRun 读 null.m.w 会抛错、整个排版中断。
  // 所以取安全基准：有 massG 用它，否则退回 mem[0] / glyphs[0]。
  var base=B.massG||(B.mem&&B.mem[0])||(B.glyphs&&B.glyphs[0])||null;
  if(!base){B.hw=26;B.hh=26;B.frac=false;B.subBar=null;return;}
  if(B.hasGrav){layoutGrav(B);return;}
  var isFrac=B.family===2&&(B.hasR||B.hasHalf)&&B.vCount>=2;
  var vG=null,rG=null;
  for(var i=0;i<B.mem.length;i++){if(B.mem[i].type==='v'&&!vG)vG=B.mem[i];if(B.mem[i].type==='r'&&!rG)rG=B.mem[i];}
  if(B.family===1){
    if(B.cCount>=2){
      var cg=null;
      for(var ci2=0;ci2<B.mem.length;ci2++){if(B.mem[ci2].type==='c'){cg=B.mem[ci2];break;}}
      var num=[{g:base,s:1,dy:0}];
      if(cg&&cg!==base)num.push({g:cg,s:1,dy:0});
      if(B.st.sq&&B.st.sq!==base)num.push({g:B.st.sq,s:1,dy:0});
      layoutRun(B,num);
      return;
    }
    layoutBracket(B);return;
  }
  if(isFrac){layoutFrac(B,vG,rG);return;}
  var num=[{g:base,s:1,dy:0}];
  if(vG&&vG!==base)num.push({g:vG,s:1,dy:0});
  if(B.vCount>=2&&B.st.sq&&B.st.sq!==base)num.push({g:B.st.sq,s:1,dy:0});
  if(B.family===0){
    // pure mass stack (e.g. M then m, no G/v/r yet): render every mass side by side
    for(var mq=0;mq<B.mem.length;mq++)if(isMass(B.mem[mq])&&B.mem[mq]!==base)num.push({g:B.mem[mq],s:1,dy:0});
  }
  layoutRun(B,num);
}
function slot(B,g){
  var sc=B.sc||1;
  var co=Math.cos(B.th),si=Math.sin(B.th);
  return {x:B.x+(g.sx*co-g.sy*si)*sc,y:B.y+(g.sx*si+g.sy*co)*sc};
}
function initWorld(B){
  for(var i=0;i<B.glyphs.length;i++){
    var s=slot(B,B.glyphs[i]);
    B.glyphs[i].wx=s.x;
    B.glyphs[i].wy=s.y;
  }
}
var DD=document,dpr=window.devicePixelRatio||1,cvx=cv.getContext('2d');
var freeL=[];
var formulas=[];
var BOX_PAD=2;   // px of slack kept between the visible ink and the collision box
// Extra clearance for a PLANK contact (rod vs body), applied along the contact normal.
// The plank is DRAWN as a 3px line (half-thickness 1.5) but COLLIDES as a 4px plank
// (half-thickness 2), which already buys 0.5px; ROD_PAD adds ~1px so the ink ends up about
// 1px outside the drawn edge — visually touching, never overlapping. It is deliberately much
// smaller than BOX_PAD: at 45 deg a per-axis pad is multiplied by sqrt(2) at the contact
// corner, which is what used to leave a 25px-looking hole under a tilted rod.
var ROD_PAD=0.5;
// ---- collision box == the VISIBLE formula -------------------------------------------------
// Every layout function writes hw/hh with its own ad-hoc padding (+4/+5/+6/+8) centred on
// B.x/B.y — but the glyphs are NOT symmetric about that origin (the r of GMm/r² hangs far
// below the bar, a superscript ² rides high, a subscript 2 sits low). The old box therefore
// floated above / stuck out past the letters, and a plank or the ground could "hit" the
// formula while still visually clear of it.
// Here we measure the real ink union of every glyph (plus the fraction bar), slide the whole
// glyph set so that union centre lands exactly on B.x/B.y, and set hw/hh to the union half
// extents + BOX_PAD. The AABB then *is* the formula, and it stays centred while it rotates.
function anchorBox(B){
  if(!B.glyphs||!B.glyphs.length)return;
  var minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  function put(cx,cy,w,t,b){
    if(cx-w/2<minx)minx=cx-w/2;
    if(cx+w/2>maxx)maxx=cx+w/2;
    if(cy+t<miny)miny=cy+t;
    if(cy+b>maxy)maxy=cy+b;
  }
  for(var i=0;i<B.glyphs.length;i++){
    var g=B.glyphs[i];
    if(!g||g.dead||!g.m)continue;
    put(g.sx||0,g.sy||0,g.m.w||F*0.6,
        (g.m.top==null?-F/2:g.m.top),(g.m.bot==null?F/2:g.m.bot));
  }
  if(B.frac&&B.st&&B.st.bar&&B.st.bar.w){
    var bh=(B.st.bar.h||2)/2;
    put(B.st.bar.sx||0,B.st.bar.sy||0,B.st.bar.w,-bh,bh);
  }
  if(minx>maxx)return;
  var ucx=(minx+maxx)/2,ucy=(miny+maxy)/2;
  if(ucx||ucy){   // re-anchor: glyphs + bars move together, so the box centre == ink centre
    for(var j=0;j<B.glyphs.length;j++){
      B.glyphs[j].sx=(B.glyphs[j].sx||0)-ucx;
      B.glyphs[j].sy=(B.glyphs[j].sy||0)-ucy;
    }
    if(B.st&&B.st.bar&&B.glyphs.indexOf(B.st.bar)<0){   // 若线已在 glyphs 里，上面的循环已经平移过它，再减一次会让分数线扎进分子
      B.st.bar.sx=(B.st.bar.sx||0)-ucx;B.st.bar.sy=(B.st.bar.sy||0)-ucy;}
    if(B.subBar)B.subBar.y-=ucy;
  }
  B.hw=Math.max(2,(maxx-minx)/2)+BOX_PAD;
  B.hh=Math.max(2,(maxy-miny)/2)+BOX_PAD;
}
function refresh(B){
  if(B.kind){layoutField(B);return;}
  if(B.bh&&(B.bh.stage===1||B.bh.t>0.6)){
    // the formula is being/has been consumed by the hole — never rebuild its glyphs
    B.bh.fade=(B.bh.stage===1)?null:0;
    return;
  }
  setF(B);
  layoutBody(B);
  if(B.frac){
    if(B.hasGrav){
      B.glyphs=[];
      var gp=gravParts(B),Gg=gp.Gg,bigM=gp.bigM,smallM=gp.smallM,rGg=null,cGg=null;
      for(var q=0;q<B.mem.length;q++){
        var tq=B.mem[q].type;
        if(tq==='r')rGg=B.mem[q];
        else if(tq==='c'&&!cGg)cGg=B.mem[q];
      }
      if(gravModeOf(B)==='schwarz'){
        // 2GM/c²: automatic leading "2", G, M, bar, c, ² — the lowercase m is NOT part of
        // this formula, so it is left out of the glyph list (and stays hidden).
        if(B.isSchwarzschild&&B.st.h2)B.glyphs.push(B.st.h2);
        if(Gg)B.glyphs.push(Gg);
        if(bigM)B.glyphs.push(bigM);
        if(B.st.bar)B.glyphs.push(B.st.bar);
        if(cGg)B.glyphs.push(cGg);
        if(B.st.sq)B.glyphs.push(B.st.sq);
      }else{
        if(Gg)B.glyphs.push(Gg);
        if(bigM)B.glyphs.push(bigM);
        if(smallM)B.glyphs.push(smallM);
        if(rGg)B.glyphs.push(rGg);
        if(B.st.sq&&B.rCount>=2)B.glyphs.push(B.st.sq);
        if(B.st.bar)B.glyphs.push(B.st.bar);
      }
    }else{
      // 裸体（promoteFreeLetter 提升的非质量字母）massG 是 null：不能写成 B.glyphs=[B.massG]，
      // 否则塞进 null，下一行 B.glyphs[i].body=B 立刻崩，之后每帧 syncGlyphs 读 null.dead 连环报错。
      B.glyphs=[];
      if(B.massG)B.glyphs.push(B.massG);
      var vG=null,rG=null;
      for(var q2=0;q2<B.mem.length;q2++){if(B.mem[q2].type==='v'&&!vG)vG=B.mem[q2];if(B.mem[q2].type==='r'&&!rG)rG=B.mem[q2];}
      if(vG)B.glyphs.push(vG);
      if(B.st.sq)B.glyphs.push(B.st.sq);
      if(rG)B.glyphs.push(rG);
      if(B.hasHalf){if(B.st.h2)B.glyphs.push(B.st.h2);}
      if(B.st.bar)B.glyphs.push(B.st.bar);
    }
  }else if(B.hasGrav&&B._plainGlyphs){
    // incomplete gravity body: glyphs are exactly the letters layoutGrav placed in the row
    B.glyphs=B._plainGlyphs;
  }else{
    B.glyphs=tokList(B);
  }
  for(var i=0;i<B.glyphs.length;i++){B.glyphs[i].body=B;B.glyphs[i].inBody=true;}
  // any LETTER owned by this body that is NOT in B.glyphs must be hidden, INCLUDING the
  // base massG (e.g. the lowercase m that becomes a stray in the 2GM/c² formula — it is
  // not part of the schwarz layout and would otherwise sit on top of the capital M).
  for(var m=0;m<B.mem.length;m++){
    if(B.glyphs.indexOf(B.mem[m])<0)B.mem[m].el.style.display='none';
  }
  if(B.massG&&B.glyphs.indexOf(B.massG)<0)B.massG.el.style.display='none';
  // TIGHTEN: replace the layout's generous hw/hh with the true ink box (must run BEFORE the
  // scaleParam multiply below, so a scaled r still inflates the box for non-well bodies).
  anchorBox(B);
  if(B.orb&&!isMVR(B))B.orb=null;
  if(!B.orb&&isMVR(B)){B.orb={spin:0,age:0,pulse:0,ringPts:null,R:120,k:0,e:0,gx:B.x,gy:B.y,gs:1,ga:1};}
  // apply per-body scale (from r) — scale visual+collision box WITHOUT cumulative growth:
  // the layout functions just wrote the UNSCALED hw/hh; multiply once here.
  // EXCEPTION: a complete GMm/r² well keeps its COMPACT collision box — r scales ONLY the
  // attraction range (wellR) and the wireframe ring, never the physical AABB. Otherwise a
  // big r inflates the well's hitbox and shoves every body away ("式子卡在原地不动").
  if(B.scaleParam!=null&&B.scaleParam!==1){
    if(!B.isWell){B.hw=(B.hw||20)*B.scaleParam;B.hh=(B.hh||18)*B.scaleParam;}
    if(B.orb)B.orb.R=130*B.scaleParam;
  }else if(B.scaleParam===1){
    if(B.orb)B.orb.R=130;
  }
  // keep the current velocity on inflation start — mc² must stay pushable while it inflates.
  // A 2GM/c² formula (isSchwarzschild) does NOT explode — it collapses into a black hole.
  // A gravity body (G…) is never an mc² bomb: E=mc² needs mass + c² and NO G.
  if(B.family===1&&B.cCount>=2&&!B.hasGrav&&!B.isSchwarzschild&&!B.exploding&&!B.copied){B.exploding=true;B.explT=0;B.infl=1;}
  if(B.cCount<2||B.isSchwarzschild){B.exploding=false;B.infl=1;B.wob=0;}
  // 2GM/c² complete -> the whole formula COLLAPSES into a black hole (event horizon grows
  // outward, the letters get sucked in and vanish, the hole stays and devours everything).
  if(B.isSchwarzschild&&!B.bh){
    /* 不能同时召唤两个黑洞：出生处门控，场上已有黑洞时这个公式不坍缩（保持普通公式体）。
     * 从根上避免两个黑洞的场景，黑洞合并逻辑因此停用。 */
    var _hasBH=false;
    for(var _bi2=0;_bi2<bodies.length;_bi2++){
      var _B2=bodies[_bi2];
      if(_B2&&_B2!==B&&_B2.bh&&_B2.bh.stage>=1&&!_B2.dead){_hasBH=true;break;}
    }
    if(!_hasBH){
      B.bh={stage:0,r:0,R:210,t:0,age:0,spin:0,seed:Math.random()*1000,dead:false};
      ringGo(B.x,B.y);
    }
  }
  if(!B.isSchwarzschild&&B.bh&&B.bh.stage===0)B.bh=null;   // split mid-collapse: no hole
}
function tokList(B){
  var t=tokenSeq(B);
  for(var i=0;i<t.length;i++){if(t[i]&&!t[i].body)t[i].body=B;}
  return t;
}
function place(g,x,y,rot,sc,show){
  var e=g.el;
  if(!show){e.style.display='none';return;}
  e.style.display='';
  e.style.left=(x-g.w/2)+'px';
  e.style.top=(y-g.h/2)+'px';
  var t='rotate('+(rot||0)+'rad) scale('+(sc==null?1:sc)+')';
  if(e.style.transform!==t)e.style.transform=t;
}
function placeLetter(d){
  if(d.state==='dock'){
    if(d.el.parentNode!==panel)panel.appendChild(d.el);
    d.el.style.display='';
    d.el.style.fontSize='34px';
    d.el.style.left='';d.el.style.top='';d.el.style.transform='';
    return;
  }
  if(d.el.parentNode!==DD.body)DD.body.appendChild(d.el);
  d.el.style.fontSize=F+'px';
  if(d.inBody&&d.body){
    var s=slot(d.body,d);
    place(d,s.x,s.y,d.body.th||0,1,true);
  }else if(d.state==='free'||d.state==='grab'){
    place(d,d.wx||0,d.wy||0,0,1,true);
  }
  // progressive fade while a free letter is being consumed by the black hole
  d.el.style.opacity=(d.fade!=null)?d.fade:'';
}
function dockedTwins(ch,me){
  var els=panel.querySelectorAll('.char');
  for(var i=0;i<els.length;i++){
    var e=els[i];
    if(e===me)continue;
    if(e.textContent===ch){
      var r=e._letterRef;
      if(r&&r.state==='dock')return true;
    }
  }
  return false;
}
/* 字符参数的默认值表，与面板（dock）单例分开：
 *  · 面板上改参数 ⇒ 记进 CHAR_DEF[字符]，不碰 dock 单例（dock 单例的数值不许被写回，否则后续拖出的同名字符全被改）；
 *  · 世界里的字符改参数 ⇒ 只写它自己；
 *  · 从面板拖出克隆时 ⇒ 先用 CHAR_DEF 补齐缺省字段（否则面板上调好的 q 电荷，新拖出的 q 仍是默认 1）。
 * 于是「改面板 = 定后续克隆的默认」与「改实例 = 只影响它」同时成立。 */
var CHAR_DEF={};
function charDefWrite(letter,key,val){
  if(!letter||!letter.ch)return;
  if(!CHAR_DEF[letter.ch])CHAR_DEF[letter.ch]={};
  CHAR_DEF[letter.ch][key]=val;
}
/* 给新造的克隆补齐 CHAR_DEF 里的默认值。只补缺省字段（不覆盖克隆自己已带的值，
 也不覆盖世界里那个字符的实例值），字段名与 gdDown 克隆分支的拷贝清单一致。 */
function charDefFill(d){
  if(!d||!d.ch)return;
  var cd=CHAR_DEF[d.ch];if(!cd)return;
  for(var k in cd){
    if(cd[k]==null)continue;
    if(typeof d[k]==='undefined')d[k]=cd[k];
  }
}
function dockLetter(d){
  // the palette always keeps one docked copy of each letter (dragging a docked letter grabs
  // a clone of it). So docking a CLONE here would stack a duplicate — let it dissolve back
  // into the palette instead. Only a letter whose docked copy has LEFT (e.g. eaten by a
  // black hole) may dock again and refill its empty slot.
  if(dockedTwins(d.ch,d.el)){
    d.body=null;d.inBody=false;
    killLetter(d);
    return;
  }
  d.state='dock';d.body=null;d.inBody=false;
  var e=d.el;
  if(e.parentNode!==panel)panel.appendChild(e);
  e.style.display='';
  e.style.fontSize='34px';
  e.style.left='';e.style.top='';e.style.transform='';
  e.style.opacity='';
  e.classList.remove('dockin');
  e.classList.add('dockin');
  setTimeout(function(){if(d.state==='dock')e.classList.remove('dockin');},240);
  sortPanel();
}
var DOCK_ORDER={'m':0,'M':1,'g':2,'a':3,'v':4,'r':5,'½':6,'μ':7,'c':8,'G':9,'t':10,'B':11,'E':12,'q':13,'I':14,'k':15,'x':16};
function dockSlotEl(e){
  var i=DOCK_ORDER[e.textContent];
  if(i==null)return;
  /* 序号 → 格的唯一真源，fixPanelSlot 与 sortPanel 共用：第 1 行只放 3 个（第 4 格留给 #panelToggle 下拉把手），
   * 之后每行 4 个。两处规则不一致时，清屏会先把字符放到把手下面、再被 fixPanelSlot 拉回，闪一帧。 */
  var row,col;
  if(i<3){row=1;col=i+1;}                       // 第 1 行 3 个，第 4 格留给把手
  else{var k=i-3;row=2+Math.floor(k/4);col=k%4+1;}
  /* 先清掉 gridColumn/gridRow 简写：简写会连带写 end（残留成如 3 / auto），与下面单独设的 start 打架。
   * 统一只用长写。 */
  e.style.gridColumn='';e.style.gridRow='';
  e.style.gridRowStart=String(row);
  e.style.gridColumnStart=String(col);
}
function sortPanel(){
  var kids=[mO,M2O,gO,aO,vO,rO,halfO,muO,cO,GO,tO,BO,EO,qO,IO];
  for(var i=0;i<kids.length;i++){
    var d=kids[i];
    if(d.state==='dock'&&d.el.parentNode!==panel)panel.appendChild(d.el);
  }
  var arr=[].slice.call(panel.querySelectorAll('.char'));
  arr.sort(function(x,y){return DOCK_ORDER[x.textContent]-DOCK_ORDER[y.textContent];});
  arr.forEach(function(e){panel.appendChild(e);});
  // pin every docked letter to its OWN fixed grid cell, so when a black hole takes a letter
  // the rest do NOT reflow — the eaten letter simply leaves a blank slot in the frame.
  for(var k2=0;k2<arr.length;k2++)dockSlotEl(arr[k2]);
}
function freeLetter(d,x,y,vx,vy,cat){
  d.body=null;d.inBody=false;d.state='free';
  d.wx=x;d.wy=y;d.vx=vx||0;d.vy=vy||0;d.cat=cat;
  if(freeL.indexOf(d)<0)freeL.push(d);
  d.el.classList.remove('dockin');
  placeLetter(d);
}
/* 字符 v / q 拖到物体上 ⇒ 赋予该物体属性（不并入 mem）：
 *   v = 赋初速度（大小 B.vGive、方向 B.vAng，默认水平向右）；q = 赋电荷量（B.charge）。
 *   时间静止（TIME_SCALE=0）时赋的速度不立刻生效，时间恢复后才动。
 *   赋予后字符播放「注入」消失动画（dockLetter 回面板 + burst 粒子）。 */
/* 可被赋予电荷的 W 体白名单：只看预设物体工具的 wshape，不做任何几何推断。
 *   rect（矩形器件）/ circle（圆形器件）/ tri（直角三角形器件）可赋电荷；
 *   其余一律不可：画笔随手画的方框（wshape 为空/poly，哪怕看着像矩形）、圆轨 ring、半凹槽 trough、滑梯 tub、圆弧 arc。
 *   原因：手绘笔画没有稳定的质心/惯量语义、形状可任意折返，在电磁场里受力后表现不可预期。
 *   不在白名单时 q 走兜底 spawnField('q') 生成场源体，不并进物体。 */
var Q_GIVE_SHAPES={rect:1,circle:1,tri:1};
function qGiveable(B){
  if(!B)return false;
  if(B.kind!=='W')return true;                 /* 公式体等照旧 */
  return !!Q_GIVE_SHAPES[B.wshape||''];
}
function giveFromLetter(B,d){
  var t=d.type||d.ch;
  if(t==='q'&&!qGiveable(B))return false;      /* 形状不在白名单 ⇒ 交回上层走场源体兜底 */
  if(t==='v'){
    var sp=(d.vGive!=null)?d.vGive:300;
    var an=(d.vAng!=null)?d.vAng:0;                 // 0° = 水平向右
    var rr=an*Math.PI/180;
    var vx=Math.cos(rr)*sp, vy=Math.sin(rr)*sp;
    /* v 的赋予是叠加而非覆盖（第二次赋 6 是再加 6），与 a 的矢量累加同口径：
     *  · 动态体：读回当前 Matter 速度，加上增量再写回，并把 B.vx/vy 同步成真实值；
     *  · 固定体（B.fixed / isStatic）：Matter 不推动它，速度由 B.vx/vy 驱动（stepPhysics 的 fixed 分支），累加 B.vx/vy。
     * 单位：B.vx/vy 是 px/s，Matter 速度是 px/帧，差一个 /60。 */
    var _stat=!!B.fixed||(B.mb&&B.mb.isStatic);
    if(B.mb&&!_stat){
      var _cv=Matter.Body.getVelocity(B.mb)||{x:0,y:0};
      var _nx=_cv.x+vx/60,_ny=_cv.y+vy/60;
      Matter.Body.setVelocity(B.mb,{x:_nx,y:_ny});
      B.vx=_nx*60;B.vy=_ny*60;
    }else{
      B.vx=(B.vx||0)+vx;B.vy=(B.vy||0)+vy;
    }
    if(B.mb)Matter.Sleeping.set(B.mb,false);
    burstParticles(B.x,B.y,10,0.6);
    return 'v';
  }
  if(t==='a'){
    /* 矢量累加（不覆盖）：多次赋 a 做矢量合成，面板显示合成后的大小和角度。 */
    var aa=(d.aGive!=null)?d.aGive:1300, an2=(d.aAng!=null)?d.aAng:0, rr2=an2*Math.PI/180;
    B.accGive=aa;B.accAng=an2;
    B.accX=(B.accX||0)+Math.cos(rr2)*aa;
    B.accY=(B.accY||0)+Math.sin(rr2)*aa;
    B.accSumN=(B.accSumN||0)+1;
    if(B.mb)Matter.Sleeping.set(B.mb,false);
    burstParticles(B.x,B.y,10,0.6);
    return 'a';
  }
  if(t==='q'){
    var qv=(d.qCharge!=null)?d.qCharge:1;
    B.charge=(B.charge||0)+qv;
    burstParticles(B.x,B.y,10,0.6);
    return 'q';
  }
  return null;
}
/* 引力场强公式 GM/r²：与引力井 GMm/r² 只差一个小写 m，语义不同：
 *  · GMm/r²（well）= 两物体之间的力 ⇒ 引力井；
 *  · GM/r²（field）= 场源 M 在该处的场强 ⇒ 即 g。
 * 拼全时整个表达式化成一个 g 字符（吸收 G/M/r/r），落在原处、保持原速度；再把 m 拖上去即得 mg。
 * 判据用逐字母清点而不是 gravModeOf：'well' 要求同时有 M 和 m，'plain' 把有 G 的其它形状全算进去，
 * 这里要的是二者之间的空档（有 G、M、r²，没有 m、c、其它字母）。
 * massG 可以就是 M（M → G → r → r 起手），M 也可以在 mem 里。 */
function gravFieldShape(B){
  if(!B||B.dead||B.kind||!B.hasGrav)return false;
  if(B.bh||B.isSchwarzschild||B.isWell)return false;
  var Mtot=0,mtot=0,rc=0,cc2=0,other=0;
  var all=[];
  if(B.massG)all.push(B.massG);
  for(var m=0;m<B.mem.length;m++)if(all.indexOf(B.mem[m])<0)all.push(B.mem[m]);
  for(var i=0;i<all.length;i++){
    var t=all[i]&&all[i].type;
    if(t==='G')continue;          // 场源常数：必要但不计入"形状"
    else if(t==='M')Mtot++;
    else if(t==='m')mtot++;
    else if(t==='r')rc++;
    else if(t==='c')cc2++;
    else other++;
  }
  return mtot===0&&Mtot>=1&&rc>=2&&cc2===0&&other===0;
}
function gravFieldToG(B){
  if(!gravFieldShape(B))return false;
  var x=B.x,y=B.y,vx=B.vx||0,vy=B.vy||0;
  var g=GD('g');
  if(!g)return false;
  g.pop=0;
  var msvx=vx,msvy=vy;
  killBody(B);                    // 吸收掉 G / M / r / r（killBody 只清 B.glyphs 里的，不碰新字形）
  freeLetter(g,x,y,msvx,msvy,false);
  /* 这里不加文字提示：变形本身（G/M/r/r 收成 g + 光环 + 粒子）已说明一切。 */
  ringGo(x,y);
  burstParticles(x,y,22,1.0);
  return true;
}
function attach(B,d){
  /* BOSS 召唤：光速 v 落到 ½mv² 公式体上 ⇒ 转 bossTryPlace（前两次排斥、第三次融合）。
   * 必须抢在下面所有分支之前：½mv² 是由字符组成的表达式，会走到 mem 并入分支，一进去公式就毁了。
   * 判据用 bossIsEk() 精确判型，不是「有 v 就拦」。 */
  if(d&&d.ch==='v'&&d.vLight&&bossTryPlace(B,d))return;
  /* 光速 v 的其它落点一律拒绝：不并入 mem、不赋予速度，把 v 弹开并在落点显示 error。
   * 排在 bossTryPlace 之后，½mv² 的召唤通道先接。普通 v（vLight=false）不受影响。 */
  if(d&&d.ch==='v'&&d.vLight){if(vLightReject(B,d))return;}
  /* v / q 是赋予型字符：不并入物体，赋予完就回面板（播消失动画）。 */
  /* 目标是由字符组成的表达式 ⇒ 跳过赋予、直接走正常并入（组合）；只有纯形状物体才赋予。
   * 若无条件先执行 giveFromLetter，组合分支永远走不到（如 a 落到 m 上）。 */
  var _isFormulaTarget=!!(B&&(B.massG||(B.glyphs&&B.glyphs.length)||(B.mem&&B.mem.length)));
  if(!_isFormulaTarget){
    var _gave=giveFromLetter(B,d);
    if(_gave){
      d.pop=0;
      var mi2=freeL.indexOf(d);if(mi2>=0)freeL.splice(mi2,1);
      dockLetter(d);
      return;
    }
    /* q 落在不在白名单的形状上必须在这里中止：giveFromLetter 返回 false 后若继续往下走，
     * 会执行 B.mem.push(d) 把 q 并进物体。交回上层走场源体兜底。 */
    if((d.type||d.ch)==='q'&&!qGiveable(B))return;
  }
  if(B.mem.indexOf(d)>=0)return;
  var mi=freeL.indexOf(d);if(mi>=0)freeL.splice(mi,1);
  var pv=null;
  if(B.massG&&B.massG.sx!=null)pv={sx:B.massG.sx,sy:B.massG.sy};
  d.state='mem';
  B.mem.push(d);
  d.body=B;d.inBody=true;
  B.pop=1;
  refresh(B);
  var hh=Math.max(20,B.hh||18);
  if(B.y+hh>groundY){B.y=groundY-hh;B.vy=-Math.abs(B.vy)*0.5;}
  if(pv)keepMass(B,pv);
  ringGo(B.x,B.y);
  /* 拼接完成的最后一步：若这次并入刚好补成 GM/r²，整个表达式化成一个 g 字符。
   * 必须在 keepMass / ringGo 之后：它们要读 B.massG / B.x/y，而 gravFieldToG 会删除 B。 */
  if(gravFieldShape(B)){gravFieldToG(B);return;}
}
function keepMass(B,pv){
  var m=B.massG;if(!m)return;
  var th=B.th||0,c=Math.cos(th),s=Math.sin(th);
  var dx=pv.sx-m.sx,dy=pv.sy-m.sy;
  B.x+=dx*c-dy*s;
  B.y+=dx*s+dy*c;
}
function splitOne(B,d){
  var i=B.mem.indexOf(d);
  if(i<0){
    i=-1;
    for(var q=B.mem.length-1;q>=0;q--)if(B.mem[q].type==='v')i=q;
    if(i<0)i=B.mem.length-1;
    if(i<0)return;
    d=B.mem[i];
  }
  var out=[d];
  if(d.type==='v'&&B.vCount>=2&&(B.hasR||B.hasHalf)){
    for(var k=B.mem.length-1;k>=0;k--){
      var tk=B.mem[k].type;
      if((tk==='r'||tk===HALF)&&out.indexOf(B.mem[k])<0)out.push(B.mem[k]);
    }
  }
  var pv=null;
  if(B.massG&&B.massG.sx!=null)pv={sx:B.massG.sx,sy:B.massG.sy};
  var msvx=B.vx,msvy=B.vy;
  for(var j=0;j<out.length;j++){
    var g=out[j],mi2=B.mem.indexOf(g);
    if(mi2>=0)B.mem.splice(mi2,1);
    g.body=null;g.inBody=false;g.state='free';g.pop=0;
  }
  refresh(B);
  if(pv)keepMass(B,pv);
  var dir=Math.random()*6.2832, dx=Math.cos(dir), dy=Math.sin(dir), sep=75;
  B.vx=msvx+dx*sep; B.vy=msvy+dy*sep;
  for(var n=0;n<out.length;n++){
    var L=out[n], sp=slot(B,L);
    var fi=freeL.indexOf(L); if(fi>=0)freeL.splice(fi,1);
    freeLetter(L, sp.x, sp.y, msvx-dx*sep+(Math.random()*24-12), msvy-dy*sep+(Math.random()*24-12), false);
  }
}
function canMerge(B,d){
  /* 已成表达式（mem ≥ 2）之后，禁止再并入常量/符号类字母（c/G/t/q/k/x 等）：
   * 它们只能作为表达式的起点（如 mc²、GMm），不能追加到已成形的表达式里（如 Gm + c）。 */
  /* c 只在表达式含小写 m 时拒绝追加；大写 M 的组合（GM…）允许，以便继续拼成 GM/c²。 */
  if(B&&B.mem&&B.mem.length>=2&&d&&d.ch==='c'){
    var _hasLittleM=false;
    for(var _mi=0;_mi<B.mem.length;_mi++){
      var _mm=B.mem[_mi];if(_mm&&(_mm.ch==='m'||_mm.type==='m')){_hasLittleM=true;break;}
    }
    if(B.massG&&(B.massG.ch==='m'||B.massG.type==='m'))_hasLittleM=true;
    if(_hasLittleM)return false;
  }
  if(!B||B.kind)return false; // field bodies (B/q/I) are not letter-merge targets
  if(B.bh)return false;       // a black hole devours letters — never merges with them
  var t=d.type;
  if(t==='t')return false;   // 't' only forms combos (gt→v, qt→I, vt→rod), never an inert formula letter
  // k / x 同理：只参与 k·x → 弹簧（见 applyKXCombo），绝不进公式；
  // 否则 k 会被 canMerge 末段当成「任意其它字母」并入单字母体（如 kv）。
  if(t==='k'||t==='x')return false;
  if(isMass(t)){
    var hasM=false,hasm=false;
    if(B.massG){if(B.massG.type==='M')hasM=true;else if(B.massG.type==='m')hasm=true;}
    for(var mi=0;mi<B.mem.length;mi++){
      var mt=B.mem[mi].type;
      if(mt==='M')hasM=true;else if(mt==='m')hasm=true;
    }
    // two IDENTICAL masses can never merge (mm / MM): every formula needs at most one M
    // and one m. Different masses (M+m) are still allowed so the build order stays free.
    if(t==='M'&&hasM)return false;
    if(t==='m'&&hasm)return false;
    var nM=(hasM?1:0)+(hasm?1:0);
    if(B.hasGrav){
      if(B.cCount>=1)return false;   // on the 2GM/c² path (G M c …) the masses are settled
      if(nM>=2)return false;         // GMm already has its two masses (M and m)
      if(B.mem.length>=5)return false;
      return true;
    }
    // before G is attached: allow stacking M+m (so m→M→G and M→m→G both work)
    if(nM>=2)return false;
    return true;
  }
  if(t==='c'){
    var cc=0;
    for(var cci=0;cci<B.mem.length;cci++)if(B.mem[cci].type==='c')cc++;
    if(cc>=2)return false;
    if(B.hasV||B.hasR||B.hasHalf)return false;
    // into a gravity body (GMc -> GMc², on the way to 2GM/c²): allow up to 2 c's
    if(B.hasGrav)return B.mem.length<4;
    // into a mass-only body (mc²): keep it small
    if(B.mem.length>=2)return false;
    return true;
  }
  if(t==='G'){
    if(B.hasGrav)return false;
    if(B.family===2)return false;          // don't drop G into a v/r formula
    // into an empty / mass-only body, or a mass-with-c body (M+c -> GMc -> GMc² -> 2GM/c²)
    if(B.hasC){if(B.mem.length>=1)return false;return true;}
    if(B.mem.length>=2)return false;
    return true;
  }
  var fam=(t==='g'||t==='a'||t===MU||t==='c'||t==='G')?1:2;
  if(B.family&&B.family!==fam&&!B.hasGrav)return false;
  if(t==='r'||t===HALF){
    if(t==='r'){if(B.hasGrav){if(B.rCount>=2)return false;if(B.mem.length>=5)return false;return true;}for(var i=0;i<B.mem.length;i++)if(B.mem[i].type==='r')return false;}
    else{for(var i2=0;i2<B.mem.length;i2++)if(B.mem[i2].type===HALF)return false;}
    if(B.vCount<2)return false;
    if(B.mem.length>=3)return false;
    return true;
  }
  if(t==='v'){
    if(B.vCount>=2)return false;
    if(B.mem.length>=3)return false;
    return true;
  }
  for(var k=0;k<B.mem.length;k++)if(B.mem[k].type===t)return false;
  if(B.mem.length>=2)return false;
  return true;
}
// 符号拼接必须交叠或非常靠近才发生，用盒距而不是以锚点为圆心的固定大半径（旧的 150/200px 会把远处的字母吸回去）。
// 盒距 = 两个字形盒之间的像素间隔（交叠/接触 = 0），盒外再容 MERGE_PAD。
// 对宿主逐字形取最小值，上标 ²、分母 r 也能正确命中。
var MERGE_PAD=14;
function lw(d){return d.w||30;}          // 字形的渲染宽/高（缺省按 F=48 的常规字母）
function lh(d){return d.h||48;}
function boxGap(ax,ay,aw,ah,bx,by,bw,bh){
  var dx=Math.abs(ax-bx)-(aw+bw)/2, dy=Math.abs(ay-by)-(ah+bh)/2;
  return Math.hypot(Math.max(0,dx),Math.max(0,dy));
}
function ptToGlyphGap(x,y,cx,cy,cw,ch){return boxGap(x,y,0,0,cx,cy,cw,ch);}
function twoLetterGap(a,b){return boxGap(a.wx,a.wy,lw(a),lh(a),b.wx,b.wy,lw(b),lh(b));}
// 落下的字母 d 到宿主任一字形盒的最短距离（没有字形就退回宿主包围盒）
function bodyMergeGap(B,d){
  var sc=B.sc||1,i,best=1e9;
  if(B.glyphs&&B.glyphs.length){
    for(i=0;i<B.glyphs.length;i++){
      var g=B.glyphs[i];
      if(!g)continue;
      var s=slot(B,g);
      var gp=boxGap(d.wx,d.wy,lw(d),lh(d),s.x,s.y,(g.w||30)*sc,(g.h||48)*sc);
      if(gp<best)best=gp;
    }
    return best;
  }
  return boxGap(d.wx,d.wy,lw(d),lh(d),B.x,B.y,(B.hw||26)*2,(B.hh||26)*2);
}
/* 实心命中：点是否落在 W 体 B.pts 的凸包内（含 pad 容差）。
 * 用于 findSolidBodyAt 的补充判定（只决定把字母给谁，不改任何物理量）：
 *  · Matter.Query.point 只判碰撞多边形内部，空心形状（圆环/空心多边形）的环心是空的；
 *    distToHost 量的是到墨迹的距离，环心约一个半径，远超容差 ⇒ q 会退化成场源体。
 *  · 用凸包而不是原多边形：带洞形状用 even-odd 会把洞判成外部，凸包正好等于视觉上的实心区。
 *  · 凸包每次现算（n 只有几十、只在松手时调用），不缓存，不会存旧形状。 */
function bodyFillHit(B,x,y,pad){
  if(!B||!B.pts||B.pts.length<3)return false;
  var P=B.pts,_n=P.length,i;
  /* 适用于所有 W 体（含开放笔画）：V / C / S / 波浪线这类笔画的质心常落在空处，离任何一段墨迹都远，
   * 只认「离墨迹 ≤22px」会找不到用户瞄准的目标。
   * 护栏：凸包对角线 > BODY_FILL_MAX 的大跨度笔画不适用（否则横贯屏幕的长线会把整块空地算成内部），
   * 仍走离墨迹判定。 */
  var _minx=1e9,_maxx=-1e9,_miny=1e9,_maxy=-1e9;
  for(i=0;i<_n;i++){
    var _p=P[i];
    if(_p[0]<_minx)_minx=_p[0]; if(_p[0]>_maxx)_maxx=_p[0];
    if(_p[1]<_miny)_miny=_p[1]; if(_p[1]>_maxy)_maxy=_p[1];
  }
  if(Math.hypot(_maxx-_minx,_maxy-_miny)>BODY_FILL_MAX)return false;
  var c=Math.cos(B.th||0),s=Math.sin(B.th||0),dx=x-B.x,dy=y-B.y;
  var lx=dx*c+dy*s, ly=-dx*s+dy*c;
  var uni=[];

  for(i=0;i<P.length;i++){
    var px=P[i][0],py=P[i][1],dup=false;
    for(var j=0;j<uni.length;j++)if(uni[j][0]===px&&uni[j][1]===py){dup=true;break;}
    if(!dup)uni.push([px,py]);
  }
  if(uni.length<3)return false;
  uni.sort(function(a,b){return (a[0]-b[0])||(a[1]-b[1]);});
  function cross(o,a,b){return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);}
  var lo=[],up=[],k;
  for(k=0;k<uni.length;k++){while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],uni[k])<=0)lo.pop();lo.push(uni[k]);}
  for(k=uni.length-1;k>=0;k--){while(up.length>=2&&cross(up[up.length-2],up[up.length-1],uni[k])<=0)up.pop();up.push(uni[k]);}
  lo.pop();up.pop();
  var H=lo.concat(up);
  if(H.length<3)return false;
  /* 容差：把点向内/外扩 pad（凸包是凸的 ⇒ 「到凸包距离 ≤ pad」等价于「膨胀 pad 后的凸包含」） */
  var n=H.length,inPoly=false,px=0,py=0;
  for(i=0;i<n;i++){px+=H[i][0];py+=H[i][1];}
  var cx=px/n,cy=py/n;
  function outEdge(ax,ay,bx,by,qx,qy){
    var ex=bx-ax,ey=by-ay,rel=(ex*(qx-ax)+ey*(qy-ay));
    if(rel<-pad)return -1;                         /* 在边外侧太远 */
    if(rel>pad)return 1;
    var L2=ex*ex+ey*ey;
    var t=(L2>1e-9)?((qx-ax)*ex+(qy-ay)*ey)/L2:0;  /* 投影参数 */
    t=(t<-pad/(Math.sqrt(L2)+1e-9))?-pad/(Math.sqrt(L2)+1e-9):
      (t>pad/(Math.sqrt(L2)+1e-9))?pad/(Math.sqrt(L2)+1e-9):t;
    return t;
  }
  for(i=0;i<n;i++){
    var a=H[i],b=H[(i+1)%n];
    var st=outEdge(a[0],a[1],b[0],b[1],lx,ly);
    if(st===0)return true;
    if(i===0&&st>0)inPoly=true;
    else if(i>0&&st<0)inPoly=false;
  }
  return inPoly;
}
/* 场源体 / 临时参数宿主的字形在被抓起时先摘成真正的自由字符：从宿主 glyphs 移除、inBody=false、body=null，
 * 宿主若已无字形则一并清掉。这样落点时能正常走赋予/合并，与从面板拖出的字符同权。
 * 背景：拖到空处的 q 会生成场源体，其字形 inBody=true、位置由 slot() 决定，看起来就是个 q；
 * 不摘的话再抓它实际是抓宿主，松手弹回宿主，什么也不发生。
 * 注意：场源体没有 Matter 体，录制器（if(!mb&&!_isRod)continue）会整类跳过它。 */
function detachFieldGlyph(d){
  if(!d||!d.body)return false;
  var B=d.body;
  var isField=(B.kind==='B'||B.kind==='E'||B.kind==='q'||B.kind==='I');
  var inWorld=(bodies.indexOf(B)>=0);
  if(!isField&&inWorld)return false;      /* 正常公式体的字形：照旧，不动 */
  if(B.glyphs){var i=B.glyphs.indexOf(d);if(i>=0)B.glyphs.splice(i,1);}
  d.body=null;d.inBody=false;
  if(!B.glyphs||!B.glyphs.length){
    if(inWorld){try{killFieldBody(B,bodies.indexOf(B));}catch(e){}}
    else{try{if(B.mb&&MW)Matter.Composite.remove(MW.wLayer,B.mb);}catch(e2){}}
  }
  return true;
}
function findSolidBodyAt(x,y){
  var best=null,bd=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!B||B.dead)continue;
    /* 只排除 gnd / belt / bh（地面器件 / 传送带 / 黑洞）：否则在画布任何地方松手都会命中地面，字符被赋予后消失。
     * 不要排除 fixed / isStatic：右键固定过的普通物体仍要能接受电荷/速度（排除后 q 会退化成场源体）。
     * 墙和 ensureMatter 的 ground/wl/wr/wt 静态框不在 bodies[] 里，本函数天然看不见。 */
    if(B.gnd||B.belt||B.bh)continue;
    var inside=false;
    try{ if(B.mb&&MW&&MW.engine&&typeof Matter!=='undefined'&&Matter.Query&&Matter.Query.point)
           inside=Matter.Query.point([B.mb],{x:x,y:y}).length>0; }catch(e){inside=false;}
    /* Matter.Query.point 对空心形状环心判否，补一层 W 体凸包内判定（含 22px 容差），否则 q 会退化成场源体。 */
    if(!inside){try{inside=bodyFillHit(B,x,y,22);}catch(e2){inside=false;}}
    var d2=distToHost(B,x,y);
    var gap=inside?0:d2;
    if(gap<bd){bd=gap;best=B;}
  }
  return bd<=22?best:null;   /* 容差 22px：实心区域整体算命中，不只认墨线 */
}
function findMergeTarget(d){
  var best=null,bg=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(B.massG===d||B.mem.indexOf(d)>=0)continue;
    if(!canMerge(B,d))continue;
    var gap=bodyMergeGap(B,d);
    if(gap<bg){bg=gap;best=B;}
  }
  return bg<=MERGE_PAD?best:null;
}
// a loose mass letter on the canvas (left over from a shatter or a split) can be a merge
// target just like a body: drop another letter onto it and it is promoted to the base of a
// fresh body on the spot (instead of requiring the player to nudge it first).
function findFreeMassTarget(d){
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var F=freeL[i];
    if(F===d||F.dead||F.state!=='free')continue;
    if(!isMass(F))continue;
    var gap=twoLetterGap(d,F);
    if(gap<bg){bg=gap;best=F;}
  }
  return bg<=MERGE_PAD?best:null;
}
function findFreeLetterTarget(B){
  var best=null,bg=1e9;
  for(var i=0;i<freeL.length;i++){
    var L=freeL[i];
    if(!canMerge(B,L))continue;
    var gap=bodyMergeGap(B,L);
    if(gap<bg){bg=gap;best=L;}
  }
  return bg<=MERGE_PAD?best:null;
}

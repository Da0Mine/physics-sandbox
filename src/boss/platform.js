/* BOSS 飞行平台的构建与布局 */
import { BOSS, bossTermTex } from './boss.js';
import { DD } from '../core/dom.js';
import { mthHTML } from '../formula/presets.js';
import { H, W } from '../render/render.js';

/* 平台行数按纵向可用高度自适应：从「Ek 墨迹底 + 余量」到「视口底 − 余量」按行距折算，
 * 上限 BOSS_ROWS_MAX（bossBuildPlat 里实际再限到 3 行）。 */
export const BOSS_ROWS_MAX=4;        // 平台最多几行
/* 逐字符汇聚的总时长 s（每字间隔 = BOSS_BUILD_SEC/字符数）。不用固定每字间隔：
 * 字符数随窗口宽度变（实测可达 880 个），固定 0.006 s/字会拖到 5 s 以上。
 * 同时每帧增量 nch/(60·BOSS_BUILD_SEC) 要 ≤8：nch=880、2.2 s ⇒ 6.67 字/帧。 */
export const BOSS_BUILD_SEC=2.2;
/* 项高标定（48px 字号下）：每项 element 高 97.81px，与 n 无关（由 \frac 两行 + 分数线决定）。
 * 行距下限原为 2×BOSS_AMP + 项高；现按下面的口径允许行间轻微重叠。 */
/* 行距 98、项盒高 100 ⇒ 项盒重叠 2px，叠上 ±BOSS_AMP(15) 晃动后最坏重叠 32px（有意允许轻微重叠）。
 * 大项缩字号后墨迹多在 74px 上下，实际重叠观感远小于盒重叠。 */
export const BOSS_LH=98;             // 行距 px
export const BOSS_ROW_H=100;         // .bossline 的行高（须 ≥ 项高 97.81，否则 overflow:hidden 裁字）
export const BOSS_AMP=15;            // 上下晃动振幅 px（逐行，频率 1.05）
export const BOSS_AMPX=26;           // 左右晃动振幅 px（整块共同，低频 0.41）
export const BOSS_PAD_X=60;         // 行盒两侧外扩量（必须 > BOSS_AMPX，否则晃动会露出边缘）
/* 晃动参数：左右 ±BOSS_AMPX（整块共同的低频正弦，频率 0.41），上下 ±BOSS_AMP（逐行，频率 1.05）；
 * shake 相位按 shakeK 从 1 衰减。调大左右振幅时 BOSS_PAD_X 必须跟着保持更大，否则行盒露边。 */
/* 振幅/频率在独立调参页 boss_tune.html 里调，调好再回填这里的常量（不在网页内加输入框）。 */
/* 项宽 w > BOSS_WT 的按 48·BOSS_WT/w 缩字号（只缩不放），下限 BOSS_FSMIN，
 * 使各项大小与基准项 ½mv² 接近。系数位数随 n 增长（n=20 的分子分母 22 位），不缩的话最宽项可达 500px+。 */
export const BOSS_FS=48;             // 平台正文字号（必须与 CSS .bossterm 一致）
export const BOSS_WT=185;            // 每一项的目标墨迹宽（超出即按比例缩）
/* 标定：基准项 ½mv² ≈ 124px；项宽随系数位数单调增长（n=2:135 / n=6:216 / n=10:248 / n=20:500+）。
 * BOSS_WT=185 ⇒ 最宽的项缩到 ≈185px（48→36px 左右），与基准项比 ≤1.5 倍；项变窄后又能多挤进几项。 */
export const BOSS_FSMIN=30;          // 缩字号的下限
export const BOSS_SEP=18;            // 项间距下限 px（等间隙铺满条带时不会低于它，只作保险丝）
export function bossBuildPlat(){
  /* =======================================================================================
   * 平台构建：
   *   ① 量测：.bossmeas 必须与平台同字号（CSS 声明 48px），否则量到的宽度偏小，每行塞进过多项而溢出。
   *   ② 项数由窗口宽度自适应。
   *   ③ 等间隙铺满。
   *   ④ 逐字符包裹：每字符一个 .bcharg，飞入以字符为单位。
   * ======================================================================================= */
  var meas=document.getElementById('bossmeas');
  if(!meas){
    meas=document.createElement('div');
    meas.id='bossmeas';meas.className='bossmeas';
    DD.body.appendChild(meas);
  }
  meas.innerHTML='';
  /* 量上屏后的真实盒子，不要用 tw+PW+BOSS_SEP 拼凑：平台上 ` + ` 包在项内部，
   * 只量项本体会让每项少算 PW+letter-spacing（48px 下 31.29px），间隙虚高、末项右缘溢出。
   * 在离屏域按平台真实结构建 [ + ][项] 量整盒宽 aw，切行与铺满共用这一把尺。 */
  var probeT=document.createElement('span');
  probeT.className='bossterm';
  var probeP=document.createElement('span');
  probeP.className='bossterm';
  probeP.innerHTML='<span class="mth"> + </span>';
  var probeA=document.createElement('span');
  probeA.className='bossterm';                       // [ + ][项] 合成盒
  meas.appendChild(probeT);meas.appendChild(probeP);meas.appendChild(probeA);
  var PW=probeP.getBoundingClientRect().width||22;
  /* 除 E_k= 与第 1 项外，每一项都自带 ` + ` 前缀，保证项与项之间视觉结构一致。 */
  var head='<span class="mth"> + </span>';
  var EQ='E_{k}=';
  /* =========================================================================================
   * 布局口径：
   *  ① 有限式子：E_k = ½mv² + t2 + … + tn + ⋯（末尾省略号收尾，不循环）；
   *  ② 行数 = 3（纵向装不下时往下退），墨迹总长 = 2 个视口宽（半行 + 一行 + 半行）；
   *  ③ 首行起点 x0 使第 1 项（½mv²）中心落在屏幕正中，它左边只有 E_k=，再往左是空白；
   *  ④ 不滚动 ⇒ 项不会跨行搬家，按顺序从上到下逐项出现。
   *  不要改回无限循环条带：尾段会绕回第一行左边，出现「E_k= 左边还有东西」和「先下行后上行」。
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
  /* 按目标宽给每一项定字号（只缩不放）：E_k= 与基准项 ½mv² 不缩；
   * 其余项 fs = clamp(48·BOSS_WT/项宽, BOSS_FSMIN, 48)，占位宽同步乘 fs/48。 */
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
    /* 已放下的 + 这一项 + 末尾省略号 + 每项最小间隙 超过目标长就停（项数随屏幕宽度自适应） */
    var fs2=fsFor(tw);                       // 该项字号
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
  var g=(target-sumW)/m;                     // 等间隙铺满目标长
  if(g<BOSS_SEP)g=BOSS_SEP;
  var lefts=[],acc=0;
  for(q=0;q<m;q++){lefts.push(acc);acc+=terms[q].wUse+g;}
  var totW=acc;                              // 式子总墨迹长（≈ 2W）
  /* 首行起点：让**第 1 项（½mv²）的中心正好在屏幕水平中央** */
  var x0=W/2-lefts[1]-terms[1].w/2;

  /* ---- ② 平台 + R 行：每行的轨里放同一条完整式子，行 ri 的轨平移 = x0 − ri·W ---------------- */
  var plat=document.createElement('div');
  plat.className='bossplat';
  DD.body.appendChild(plat);
  var baseY=0;
  {
    /* 平台不另算纵向位置，锚在 Ek 升空后的落点上：第 0 行项心 == BOSS.y1 ⇒ ½mv² 原地长出，零跳变；
     * 其余各行依次向下排。不要用「Ek 底 + 30 到视口底 − 30」的可行带另算 y，那样第一行会比 Ek 低近 300px，像突然掉下去。 */
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
    /* 每一行的轨里放同一条完整式子，行 ri 的轨平移 = x0 − ri·W
     * ⇒ 第 ti 项在行 ri 显示于 x = (x0 + lefts[ti]) − ri·W：
     *   · 在它自己那一行 r = floor((x0+s)/W) 里 x 落进 [0,W)，完整可见；
     *   · 跨行界的那一项在 r 行显示左半、在 r+1 行显示右半（同一绝对位置被两行切开），墨迹在行界处接住。
     * 行数 3、式子总长 ≈ 2W < 3W ⇒ 末行之后没有内容绕回来。轨从 0 起，不需要无限条带的 left:-P 补位。 */
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
      if(tm.pre)sp.insertAdjacentHTML('beforeend',head);   // E_k= 与第 1 项都不带 +
      sp.insertAdjacentHTML('beforeend',mthHTML(tm.tex));
      grp.appendChild(sp);
      /* 字号不一的项若按盒中心对齐，分数线会高低不齐。改为按第一根分数线对齐：
       * 量出它相对盒心的偏移并反向补掉，所有项的共同基准线 = 行中线。 */
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
    /* 逐字符包裹：每一行都要包（静态布局下每项只在自己那一行与相邻行出现，但逐行统一处理最简单）。 */
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
               /* 每行竖向相位 = 按行等分 + 随机扰动：纯随机偶尔抽出两个接近的相位，看起来像整块一起动；
                * 等分保证各行相位明显错开。 */
               ph:(ri*2.0944+Math.random()*1.2),row:ri});
  }

  /* ---- ③ 揭示顺序：以第 1 项（½mv²）为基准，按式子读序补全 -----------------------------
   *  顺序 = 第 1 项（基准）→ E_k= → t2 → t3 → … → 末尾。
   *  基准项出生即亮（见下面的 classList.add('on')）：Ek 刚被吸收、它就长在同一处，
   *  等 build 相位再淡入的话，shake 那 0.55s 会在正中留一块空白。
   *  order 里每一项只出现一次（写成 for(d=0;d<m;d++) 会把每项推两次，BOSS.chars 长度翻倍）。 */
  var order=[1,0];
  for(var oi=2;oi<m;oi++)order.push(oi);
  var allChars=[];
  for(var o2=0;o2<order.length;o2++){
    var grpC=byTerm[order[o2]];
    for(var gi=0;gi<grpC.length;gi++)
      for(var ci2=0;ci2<grpC[gi].length;ci2++){
        var _ce=grpC[gi][ci2];
        allChars.push(_ce);
        /* 从四周渐显汇聚的起始偏移写成 CSS 变量而不是 inline left/top：
         * .bcharg.on{left:0;top:0} 是类选择器，inline 样式会压过它 ⇒ 基础规则读变量、.on 覆盖。 */
        /* 起始偏移全方位随机、半径 55~150px：幅度太小看起来像直接出现。 */
        var _th=Math.random()*6.2832,_rr=55+Math.random()*95;
        _ce.style.setProperty('--dx',(Math.cos(_th)*_rr).toFixed(1)+'px');
        _ce.style.setProperty('--dy',(Math.sin(_th)*_rr*0.7).toFixed(1)+'px');
        if(order[o2]===1)_ce.classList.add('on');      // 基准项出生即亮（正中不留空）
      }
  }

  BOSS.charDt=BOSS_BUILD_SEC/Math.max(1,allChars.length);
  BOSS.plat=plat;
  BOSS.rows=rows;
  BOSS.rowW=W;             // 单行可视宽
  BOSS.cycleW=totW;        // 式子总墨迹长（≈2W）
  BOSS.x0=x0;              // 首行起点（让第 1 项居中）
  BOSS.totW=totW;
  BOSS.rowsN=ROWSN;        // 实际行数（3 行，纵向装不下时往下退）
  BOSS.terms=terms;
  BOSS.lefts=lefts;
  BOSS.gap=g;
  BOSS.baseY=baseY;
  /* 不滚动：式子有限、整条都在屏幕上。第 1 项居中已内建在 x0 里，off 恒 0（仅保留字段）。 */
  BOSS.off=0;
  BOSS.platT=0;
  BOSS.reveal=0;
  BOSS.revealT=0;
  BOSS.chars=allChars;
  bossPlatLayout();
}
/* 把 e 底下的**文本节点**逐个换成 <span class="bcharg">（保留已有元素结构与原顺序） */
export function wrapTextNodes(e,out){
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
/* 供 bossBuildPlat 使用。mthHTML 已自带 .fracbar，这里只做幂等兜底：给（理论上不会出现的）
 * 老结构补一根线，并把 .fracbar 转成 .bcharg.fracbar 纳入逐字符序列。
 * 必须加 bcharg 类：.bcharg 出生即 opacity=0、由 BOSS.reveal 逐个点亮，不加的话横线一开场就全亮。
 * 非 boss 路径（公式菜单 / 面板）不加 bcharg ⇒ opacity 默认 1，照常显示。 */
export function fracInsertBars(root){
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
export function bossPlatLayout(){
  var rows=BOSS&&BOSS.rows;
  if(!rows)return;
  var amp=BOSS_AMP*(BOSS.ph==='shake'?BOSS.shakeK:1);
  var ampX=BOSS_AMPX*(BOSS.ph==='shake'?BOSS.shakeK:1);
  /* 布局是静态的：行的轨平移 = x0 − 行号×W（与时间无关）。第 ti 项在行 ri 的屏幕 x = (x0 + lefts[ti]) − ri·W，
   * 只在自己那一行（及跨行界的相邻行）落进 [0,W)，别处被 overflow:hidden 裁掉。
   * 不滚动是为了让项按顺序逐个出现：一滚动项就会跨行搬家。 */
  /* 左右晃动整块共同，不要每行各自一个相位：静态布局靠统一的轨平移保证跨行界那一项的两半
   * 落在同一水平位置，每行叠各自的 dx 会让两半错开（实测 11.89px），行界出现可见接缝。
   * 竖向晃动仍逐行独立（不跨行）。 */
  var dxAll=Math.sin(BOSS.platT*0.41)*ampX;
  for(var i=0;i<rows.length;i++){
    var R=rows[i];
    var dy=Math.sin(BOSS.platT*1.05+R.ph)*amp;
    /* 水平晃动低频大幅（频率 0.41 vs 竖向 1.05，振幅 BOSS_AMPX vs BOSS_AMP），平移作用在整行上，不扰动行内排版。 */
    var dx=dxAll;
    var y=BOSS.baseY+(i-(rows.length-1)/2)*BOSS_LH+dy;
    R.el.style.transform='translate3d('+dx.toFixed(2)+'px,'+y.toFixed(2)+'px,0)';
    /* 行盒左边从 −BOSS_PAD_X 起 ⇒ 轨平移要加回 BOSS_PAD_X，项才落在该在的屏幕 x 上
     * （行盒外扩只影响能画到哪里，不影响布局原点）。 */
    R.track.style.transform='translate3d('+(((BOSS.x0||0)-i*W+BOSS_PAD_X)).toFixed(2)+'px,0,0)';
  }
}

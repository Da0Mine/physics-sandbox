/* 终局 BOSS：½mv² 召唤流程 */
import { app } from '../state.js';
import { killBody, killLetter } from '../bodies/body.js';
import { bossBuildPlat, bossPlatLayout } from './platform.js';
import { DD } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { ALL, bodies, freeL } from '../core/world.js';
import { burstParticles, particles, shake, spawnExplosion } from '../effects/particles.js';
import { placeLetter, slot } from '../letters/layout.js';
import { PX_PER_M } from '../params/defs.js';
import { paramBody, paramLetter, paramRows, renderParamPanel } from '../params/panel.js';
import { removeMatterBody } from '../physics/matter.js';
import { H, W } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { errTip, setToolMode } from '../ui/toolbar.js';
import { clearAll } from '../ui/trash.js';

/* =========================================================================================
 * BOSS 召唤
 * -----------------------------------------------------------------------------------------
 * 流程：场上有 ½mv² 公式（多个则先融合为一个）时，在参数面板 v 的大小框里输入字母 c ⇒ v 变成光速；
 *   把光速 v 放到 Ek 上：前两次排斥（v 被弹飞），第三次融合 ⇒ Ek 缓缓升空、能量粒子汇聚、爆发，
 *   随后字符逐个汇聚补全成相对论动能的泰勒展开（LaTeX 渲染，多行铺开），平台上下左右晃动；
 *   停留 BOSS_HOLD 后屏幕闪黑两次、黑屏 BOSS_DARK，再回到网页初始加载状态。
 *
 * ---- 数学（按 n 现算，项数由窗口宽度定）------------------------------------------------
 *   相对论动能  E_k = mc²(γ−1),  γ = (1−β²)^(−1/2) = Σ_{n≥0} C(2n,n)/4^n · β^{2n}
 *   ⇒ E_k = Σ_{n≥1} C(2n,n)/4^n · m v^{2n} / c^{2n−2}
 *     n=1: 1/2 ⇒ mv²/2；n=2: 3/8 ⇒ 3mv⁴/(8c²)；n=3: 5/16；n=4: 35/128
 *   ⇒ bossTermTex(n) 现算二项式系数并约分，交给既有 mthHTML（手写 LaTeX 子集：
 *     \frac / ^{} / {} / \mu / \cdot）渲染，不依赖 CDN。
 *
 * ---- 接入点（7 处）----------------------------------------------------------------------
 *   ① frame() 的 TIME_SCALE>0 块末尾   ⇒ stepBoss(dt)
 *   ② 画布 pointerup 的 letter 分支    ⇒ 光速 v 落在 ½mv² 上 ⇒ bossPlace
 *   ③ attach() 开头                    ⇒ 同上的兜底分流（别的路径把 v 送进来时）
 *   ④ renderParamPanel 的 vsize 行     ⇒ 数字框 keydown 输入字母 c ⇒ 光速态
 *   ⑤ renderParamPanel 渲染末尾        ⇒ 光速态回显（重渲染后不丢）
 *   ⑥ gdDown 的 dock 分支              ⇒ 把面板 v 的光速态传给拖出的克隆
 *   ⑦ clearAll() 末尾                  ⇒ bossAbort() 复位
 * ========================================================================================= */
export const C_LIGHT=299792458;      // 光速 m/s
export let BOSS=null;              // boss 状态机（null = 没有 boss 进行中）
export const BOSS_CHAR_DT=0.006;     // 逐字符飞入间隔的兜底值；正常由 BOSS.charDt = BOSS_BUILD_SEC/字符数 现算
export const BOSS_RISE_MS=1.35;      // Ek 升空的时长 s
export const BOSS_HOLD=8.0;          // 平台出现（字符补全）后停留 s，然后开始闪黑
export const BOSS_DARK=2.6;          // 黑屏时长 s
export const BOSS_DROP_PAD=80;       // 光速 v 松手时命中 ½mv² 的容差 px（比 MERGE_PAD 宽，好放）
/* 汇聚粒度是单个字符，不是整项（避免整项整块出现）。 */
export const BOSS_WAIT_GRACE=600;    // 「等用户放 v」的兜底窗口（产品秒）——见 bossLive() 的长注释
export const BOSS_SHAKE=0.55;        // Ek 爆发后的余波时长 s
export const BOSS_FADE_IN=0.46;      // 闪黑两次的时长 s（0.06/0.17/0.28/0.38/0.46 五个台阶）
export function bossGcd(a,b){a=Math.abs(a);b=Math.abs(b);while(b>0){var t=a%b;a=b;b=t;}return a||1;}
export function bossGcdB(a,b){if(a<0n)a=-a;if(b<0n)b=-b;while(b>0n){var t=a%b;a=b;b=t;}return a||1n;}
/* 必须用 BigInt：系数 C(2n,n)/4ⁿ 中 C(2n,n) 在 n≥27 时超过 2^53（C(54,27)=1.9e15），
 * 递推 r=r*(n-k+i)/i 的中间结果失真后系数全错；项数由窗口宽度决定，宽窗口下这是常规路径。
 * BigInt 不可用时退回 Number（只有 n≥27 的项会失真，但至少画得出来）。 */
export function bossBinom(n,k){
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
/* 第 n 项（n≥1）：\frac{系数分子}{系数分母} m \frac{v^{2n}}{c^{2n-2}}
 *   E_k=\frac12 mv^2+\frac38 m\frac{v^4}{c^2}+\frac5{16}m\frac{v^6}{c^4}+\cdots
 * 每项是两段分式相乘（系数分式 × v/c 分式），不是把 m·v^{2n} 整个塞进分子的大分式。
 * 第 1 项也渲染为 \frac{1}{2}mv^{2}（分子分母上下分开），不内联成 ½mv²。 */
export function bossTermTex(n){
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
export function bossIsEk(B){
  if(!B||B.dead||B.kind)return false;
  if(B.bh||B.go||B.goB||B._bossFrozen)return false;
  if(!B.hasHalf||!B.massG)return false;
  if((B.vCount||0)<2)return false;
  if(B.hasG||B.hasA||B.hasR||B.hasC||B.hasGrav||B.hasMu)return false;
  return true;
}
/* 松手点附近有没有 ½mv²（容差 BOSS_DROP_PAD） */
export function bossFindEkNear(x,y){
  var pick=null,bd=1e9;
  for(var i=0;i<bodies.length;i++){
    var B=bodies[i];
    if(!bossIsEk(B))continue;
    /* 命中判据同时看质心距离与墨迹包围盒（矩形外扩 BOSS_DROP_PAD），取较近者再与容差比：
     * 只按质心判，½mv² 稍有漂移就拖不中；只按包围盒判，旁边不相干的公式会被优先抢走。 */
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
/* 把一个多余的 ½mv² 溶解掉（多个 Ek 先融合为一个） */
export function bossDissolveEk(O){
  burstParticles(O.x,O.y,26,1.2);
  ringGo(O.x,O.y);
  /* 必须按 d.body===O 扫全表，不能只扫 O.glyphs：组装期 refresh()/ensureSt() 会把部分字形移出
   * B.glyphs（仍在 DOM 里，display:none），d.body 依旧指着 O。只扫 glyphs 会漏掉它们，
   * 屏幕上残留一个多余的 mv²/2。 */
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
export function bossMaskEl(){
  var m=document.getElementById('bossfade');
  if(m)return m;
  m=document.createElement('div');
  m.id='bossfade';
  DD.body.appendChild(m);
  return m;
}
export function bossSetMask(a){
  var m=bossMaskEl();
  m.style.opacity=(''+a);
}
/* ---- ① 面板：v 的大小参数框输入字母 c ⇒ 光速 ------------------------------------------ */
export function bossLightOn(nu,val){
  var L=paramLetter;
  if(!L)return false;
  L.vLight=true;L.vGive=C_LIGHT*PX_PER_M;
  if(paramBody){paramBody.vLight=true;paramBody.vGive=C_LIGHT*PX_PER_M;}
  /* 光速态同时挂到面板单例 vO 上：同一动作要重复三次，往后从面板拖出的克隆都自动是光速 v
   * （由接入点⑥ gdDown 传递），不用每次重新输入 c。bossLightReset 在 boss 收尾时复原。 */
  /* 只有改的是面板里那个 v（L.state==='dock'）才回写单例，与 vsize/vang/qcharge 同口径；
   * 不分来源地回写会让改世界里某个 v 也污染单例，之后每个克隆都是光速 v。 */
  if(app.vO&&L.state==='dock'){app.vO.vLight=true;app.vO.vGive=C_LIGHT*PX_PER_M;}
  if(nu){nu.value='';nu.placeholder='c';}
  if(val)val.textContent='c ≈ '+C_LIGHT+' m/s';
  /* 滑块顶到最右（max 临时放宽到光速），让「数值变成光速」在两种控件上都看得见 */
  if(paramRows){
    for(var i=0;i<paramRows.length;i++){
      var R=paramRows[i];
      if(R&&R.spec&&R.spec.key==='vsize'){R.sl.max=C_LIGHT;R.sl.value=C_LIGHT;}
    }
  }
  /* 光速态不弹任何说明文字。 */
  return true;
}
/* 复原光速态（boss 收尾 / 清屏 / 手动取消都要调）。
 * 必须独立于 bossAbort 里的 if(!BOSS)return;：bossFinish() 先把 BOSS 置 null 再调 clearAll()，
 * clearAll() 末尾才调 bossAbort()，复位若写在早退之后就永远跑不到，清屏后 v 框里仍显示光速。 */
export function bossLightReset(skipRender){
  var any=false;
  if(paramLetter&&paramLetter.vLight){paramLetter.vLight=false;paramLetter.vGive=null;any=true;}
  if(paramBody&&paramBody.vLight){paramBody.vLight=false;paramBody.vGive=null;any=true;}
  if(app.vO&&app.vO.vLight){app.vO.vLight=false;app.vO.vGive=null;any=true;}
  /* skipRender=true 供 applyParam 用：用户正在输入框里改数值，此时重渲染面板会重建输入框，
   * 焦点与刚敲的字符一起丢。 */
  if(any&&!skipRender&&paramBody)renderParamPanel();
}
/* 当前参数面板是否处于「v = 光速」态（vsize 行渲染用） */
export function bossLightState(){
  if(paramBody&&paramBody.vLight)return true;
  if(paramLetter&&paramLetter.vLight)return true;
  if(app.vO&&app.vO.vLight)return true;
  return false;
}
/* ---- ② 放置：前两次排斥、第三次融合 ---------------------------------------------------- */
export function bossRepel(Ek,d){
  var vx=(d.wx!=null)?d.wx:((d.el?d.el.offsetLeft+14:Ek.x));
  var vy=(d.wy!=null)?d.wy:((d.el?d.el.offsetTop+14:Ek.y));
  var ux=vx-Ek.x,uy=vy-Ek.y,L=Math.hypot(ux,uy);
  if(!(L>1)){ux=0;uy=-1;L=1;}
  ux/=L;uy/=L;
  var n=BOSS.n;                       // 第几次放置（1 或 2）
  var sp=1500+900*n;                  // 第二次弹得更快（「排斥」逐次加强）
  d.state='free';d.cat=1;d.pop=1;d.massless=false;
  d.wx=vx;d.wy=vy;
  d.vx=ux*sp;d.vy=uy*sp-380;          // 略微上抛 ⇒ 弧线更自然
  if(freeL.indexOf(d)<0)freeL.push(d);
  placeLetter(d);
  burstParticles(vx,vy,16,0.7);
  burstParticles(Ek.x,Ek.y,20,1.0);
  ringGo(Ek.x,Ek.y);
  /* 第一/二次被弹开时在落点冒一行红字，文案只有 Error，不加前缀、原因或其他说明。 */
  errTip(vx,vy,'Error');
  /* 不要给 Ek 加位移反冲：Ek 一旦被推离原位，第 2/3 次拖到原处会落空（bossFindEkNear 容差 80px），
   * 三次融合做不完，boss 永远出不来。被弹飞的是 v，Ek 只做纯视觉反馈（原地回弹 + 粒子/光环），位置不动。 */
  Ek.pop=Math.max(Ek.pop||0,0.6);     // 渲染层 popScale ⇒ 看得见"被撞了一下"再弹回
  shake(4,0.22);
}
export function bossStartRise(Ek,d){
  BOSS.ph='rise';BOSS.t=0;BOSS.ek=Ek;BOSS._frozenEk=Ek;
  /* 召唤开始 ⇒ 压淡符号面板（CSS body.bossing .panel） */
  if(DD&&DD.body)DD.body.classList.add('bossing');
  bossBump();                       // 融合成功 ⇒ 操作窗口重新计时（见 bossLive）
  /* 融合时把前两次被弹飞的游离 v 收进爆发（粒子 + 销毁）：否则它们落地后永久留在画面上，
   * 平台升起后还看得到孤立的 v。语义上是散出去的 v 被 Ek 吸收。
   * 只收 ch==='v'、state==='free' 且不在任何 body 里的，不动用户别处的字母和面板 dock 里的。 */
  for(var i=freeL.length-1;i>=0;i--){
    var f=freeL[i];
    if(!f||f.dead||f===d)continue;
    if(f.ch!=='v')continue;
    if(f.inBody)continue;
    if(f.body)continue;
    if(f.state&&f.state!=='free')continue;
    burstParticles(f.wx!=null?f.wx:Ek.x,f.wy!=null?f.wy:Ek.y,10,0.75);
    killLetter(f);
  }
  /* 融合时同样不弹文字提示。 */
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
  /* 升空：x0/y0 = 起飞点（用户摆放处），x1 = 屏幕水平中央，y1 = 升空高度；
   * rise 相位让 (x,y) 同时向 (x1,y1) 缓动。 */
  BOSS.x0=Ek.x;
  BOSS.y0=Ek.y;
  BOSS.x1=Math.round(W/2);
  /* 升空目标 0.16H（H=900 ⇒ 144）。平台锚在这个 y 上原位召唤，所以 y1 决定整块平台的高度。 */
  BOSS.y1=Math.max(110,Math.round(H*0.16));
}
export function bossPlace(Ek,d){
  if(!BOSS){
    /* 多个 ½mv² 先融合为一个：把其余的溶解掉 */
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
export function bossTotalChars(){
  /* 字符袋是一条线性序列（顺序见 bossBuildPlat ③），直接返回长度。 */
  return (BOSS&&BOSS.chars)?BOSS.chars.length:0;
}
export function bossNthChar(k){
  var B=BOSS;
  if(!B||!B.chars)return null;
  return (k>=0&&k<B.chars.length)?B.chars[k]:null;
}
/* 式子补完时的收束爆发：沿已铺开的各行撒粒子 + 一次抖屏。
 * 与 bossBurst() 分工：那次是 Ek 被吸收、式子开始长的起点爆发；这次是整条式子长完的收束。 */
export function bossFinale(){
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
export function bossBurst(){
  var cx=W/2,cy=BOSS.y||BOSS.y1||(H*0.25);
  spawnExplosion(cx,cy);
  for(var w=0;w<160;w++){
    var wa=Math.random()*6.2832,ws=180+Math.random()*980;
    particles.push({x:cx,y:cy,vx:Math.cos(wa)*ws,vy:Math.sin(wa)*ws,age:0,
                    life:0.6+Math.random()*0.9,r:1+Math.random()*2.3,alpha:1,hot:true});
  }
  shake(22,0.9);
  /* Ek 本体在这一刻被表达式吸收，不再是场上独立的公式体：bossDissolveEk 把它的字形连分数线一起收掉
   * （同时撒粒子），紧接着 bossBuildPlat() 在同一处长出式子第 1 项，交接被粒子和抖动盖住。
   * 不要保留 Ek 体（_bossKept）：那样它会独自挂在平台上方。 */
  var Ek=BOSS.ek;
  if(Ek&&!Ek.dead){
    Ek.pop=Math.max(Ek.pop||0,0.9);
    bossDissolveEk(Ek);
  }
  BOSS.ek=null;
  BOSS._frozenEk=null;
  /* 必须先把 BOSS.ph 切到 'shake'（脱离 rise），再 bossBuildPlat()：
   * bossBuildPlat 内部已跑过一次 bossPlatLayout()，只要 ph 还是 'rise'，后继帧会再次触发
   * if(p>=1)bossBurst() ⇒ 无限爆发（粒子数暴增、平台被反复重建）。先切相位保证只爆发一次。 */
  BOSS.ph='shake';BOSS.t=0;BOSS.shakeK=1;
  bossBuildPlat();
  BOSS.reveal=0;BOSS.revealT=0;
}
/* ---- ④ 主状态机 ------------------------------------------------------------------------ */
/* 活跃窗口用产品时钟 BOSS.live（每帧减 dt），不用 performance.now()：
 * dt 可能被 TIME_SCALE 缩放，墙钟与帧时间在时间停止/慢放下会背离——倍率 0.1 时墙钟超时会提前掐掉 boss；
 * 反之帧被压缩时会在动画刚开始就判死。BOSS.live 与 BOSS.t/BOSS.platT 共用同一把尺。
 * bossLive() 只负责兜底收尾：正常路径各相位都有明确转场条件，它只在用户拖太久 / 时间倍率极端 /
 * 帧循环被打断时保证 boss 一定结束。 */
export function bossBump(){BOSS.live=BOSS_WAIT_GRACE;}     // 用户又放了一次 ⇒ 操作窗口重新计时
export function bossLive(){return BOSS.live>0;}
export function stepBoss(dt){
  if(!BOSS)return;
  BOSS.live-=dt;
  if(BOSS.ph==='repel'){
    BOSS.t+=dt;
    /* 兜底：用户放着不管太久 ⇒ 悄悄取消（否则 BOSS 会永久抓着一个公式体）。
     * 不进 'fade'：用户还没看到任何东西，黑屏只会让人莫名其妙。 */
    if(!bossLive())bossAbort();
    return;
  }
  var i,k;
  if(BOSS.ph==='rise'){
    BOSS.t+=dt;
    var p=clamp(BOSS.t/BOSS_RISE_MS,0,1);
    var e=1-Math.pow(1-p,3);                     // 缓出
    var y=BOSS.y0+(BOSS.y1-BOSS.y0)*e;
    /* x 同步向屏幕中央缓动，用同一条缓出曲线 ⇒ 斜向上飘，落点在正中。 */
    var xx=BOSS.x0+((BOSS.x1!=null?BOSS.x1:W/2)-BOSS.x0)*e;
    var Ek=BOSS.ek;
    if(Ek&&!Ek.dead){
      Ek.x=xx;Ek.y=y;Ek.vx=0;Ek.vy=0;            // 位置由本模块接管（渲染仍走 render/syncGlyphs）
    }
    BOSS.x=xx;
    BOSS.y=y;
    /* 能量粒子汇聚：从四周生成 seek 粒子 */
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
    /* 爆发后的余波：平台已在 bossBurst 里建好（这里只做抖动，不重建）。
     * 抖动衰减到 0 就进 build（逐字符飞入）；窗口耗尽也强制进 build。 */
    BOSS.t+=dt;
    BOSS.shakeK=Math.max(0,BOSS.shakeK-dt*1.8);
    BOSS.platT+=dt;
    bossPlatLayout();
    if(BOSS.t>=BOSS_SHAKE||!bossLive()){BOSS.ph='build';BOSS.t=0;BOSS.reveal=0;BOSS.revealT=0;}
    return;
  }
  if(BOSS.ph==='build'||BOSS.ph==='platform'){
    BOSS.platT+=dt;
    bossPlatLayout();
    if(BOSS.ph==='build'){
      /* 汇聚粒度是单个字符（.bcharg）。项容器 .bossterm 保持 opacity=0、可见性交给内部 .bcharg，
       * 否则整项会先整块亮起。 */
      BOSS.revealT+=dt;
      var nch=bossTotalChars();
      /* 间隔按总时长现算（见 BOSS_BUILD_SEC）：字符数随窗口变，固定每字间隔会让宽窗口的 build 拖到 5s 以上。 */
      var cdt=(BOSS.charDt!=null&&BOSS.charDt>0)?BOSS.charDt:BOSS_CHAR_DT;
      var want=Math.min(nch,Math.floor(BOSS.revealT/cdt)+1);
      while(BOSS.reveal<want){
        var ce=bossNthChar(BOSS.reveal);
        BOSS.reveal++;
        if(!ce)continue;
        /* 逐字符汇聚 = 加 .on 类，位移由 build 期写好的 --dx/--dy + CSS transition（.bcharg / .bcharg.on）完成，
         * 这里不做强制重排。
         * 用相对定位 left/top 而不是 transform：transform 对非替换行内元素无效（唯一例外是分数线 .fracbar），
         * 会导致只有分数线在飞、数字不动，分数线高低不齐。相对定位对行内元素有效且不参与布局。 */
        ce.classList.add('on');
      }
      /* 补完的那一刻来一次收束爆发（bossFinale：沿整条式子撒粒子 + 抖屏）。 */
      if(BOSS.reveal>=nch&&nch>0){bossFinale();BOSS.ph='platform';BOSS.t=0;}
    }else{
      BOSS.t+=dt;
      if(BOSS.t>=BOSS_HOLD){BOSS.ph='fade';BOSS.t=0;}   // 停留 BOSS_HOLD 秒
    }
    return;
  }
  if(BOSS.ph==='fade'){
    /* 闪黑两次 → 黑屏几秒 → 屏幕恢复 */
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
export function bossFinish(){
  var pl=BOSS&&BOSS.plat;
  if(pl&&pl.parentNode)pl.parentNode.removeChild(pl);
  /* Ek 体收尾时必须显式清掉，否则回到初始状态时会多一个冻结的幽灵公式。
   * 不依赖后面的 clearAll()：它是交互清屏路径，语义可能变；这里逐件清干净最稳。 */
  var Ek=bossKillKept();
  void Ek;
  BOSS=null;
  if(DD&&DD.body)DD.body.classList.remove('bossing');   // 复位面板透明度
  bossSetMask(0);
  app.TIME_SCALE=1;
  setToolMode(null);
  try{clearAll();}catch(e){}
}
/* 清掉 boss 保留的 Ek（字形 + 分数线 + bodies 记录），返回被清的件数 */
export function bossKillKept(){
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
export function bossAbort(){
  bossLightReset();
  if(!BOSS)return;
  if(BOSS.plat&&BOSS.plat.parentNode)BOSS.plat.parentNode.removeChild(BOSS.plat);
  if(BOSS.rows)BOSS.rows=null;
  if(BOSS.ek)BOSS.ek._bossFrozen=false;
  /* 中途取消同样要清掉被保留的 Ek（否则留个幽灵公式） */
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
  if(DD&&DD.body)DD.body.classList.remove('bossing');   // 复位面板透明度
  bossSetMask(0);
}
/* 光速 v 无论从哪条路送进 attach()，一律归 boss 管。
 * 抛错时返回 false = 这次不归 boss，按原语义继续赋予速度。 */
export function bossTryPlace(B,d){
  if(!d||d.ch!=='v'||!d.vLight)return false;
  if(!bossIsEk(B))return false;
  bossPlace(B,d);
  return true;
}

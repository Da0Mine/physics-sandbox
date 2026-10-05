/* 参数面板 UI 与逐对材质表 */
import { C_LIGHT, bossLightOn, bossLightState } from '../boss/boss.js';
import { bodies, pbox, pclose, pcontacts, prows, ptitleEl, pvalEl } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { PARAM_DEFS, applyParam, paramDef, paramDefForLetter, paramDefVal, paramLabel, paramV, specIdForLetter } from './defs.js';
import { wEffE, wEffMu, wMuIdeal } from '../physics/material.js';
import { MW, refreshWPairs } from '../physics/matter.js';
import { H, W } from '../render/render.js';
import { closeMenu } from '../ui/menu.js';

// 比例尺 260 px = 1 m：默认重力 2600 px/s² 显示为 10 m/s²，画布高约 3.5 m。
// 内部计算全部仍是 px；换算只发生在参数面板的显示/输入层：SI 显示值 = 内部值 / siK。
// 1 单位质量 = 1 kg；k 的 N/m 是标称值 —— F=ks·Δx 按 F=ma 走加速度通道时，
// kg/s² 的数值与内部值一致（px 与比例尺在分式里约掉）。
export const PX_PER_M=260;
/* 出生尺寸常量区：所有器件的出生尺寸常量都集中在这里。
 * ① PARAM_DEFS 里 slen.def:SPR_SPAWN_LEN 这类写法在对象字面量求值时取值，
 *    var 只提升声明不提升赋值 ⇒ 常量必须声明在参数表之前，否则是 undefined（点「默认」掉到量程下限）。
 * ② 这是「默认值 == 出生值」不变式的唯一真源：只改这里一个数，参数表默认值机械跟随。
 *    不要在别处重复声明或在 PARAM_DEFS 里写死数字，否则两处会漂移（曾出现出生 110 / 默认 170）。 */
export const SPR_SPAWN_LEN=110;    // 弹簧：= makeSpring 长度钳制 clamp(d,110,340) 的下限
export const ROPE_SPAWN_LEN=110;   // 轻绳：与弹簧同款「拖出来即可用」的默认长度
export const ROD_SPAWN_LEN=170;    // 轻质杆：= makeRod 的默认，也是 vt 拼接实际得到的长度
/* ================= PARAM PANEL (per-letter rows: slider + number + 默认) ================= */
export let paramBody=null, paramLetter=null, paramRows=[];
// 当前展开的配对行（'mu' = 摩擦、'e' = 弹性；null = 都没展开，接触区按摩擦口径）。
export let pairOpenField=null;
export function openParams(B,d){
  if(!B)return;
  var ids=d?paramDefForLetter(B,d):paramDef(B);
  if(!ids.length)return;
  closeMenu();
  paramBody=B;
  paramLetter=d||null;
  paramRows=[];
  pairOpenField=null;   // 换成另一个物体 = 配对展开状态重置
  pbox.style.left=clamp(B.x-120,4,W-248)+'px';
  pbox.style.top=clamp(B.y+44,4,H-190)+'px';
  pbox.classList.add('on');
  renderParamPanel();
  // 先显示、再量实际尺寸、按视口收（面板行数变多时固定偏移会把底部顶出视口）。
  // 接触区行数每帧还会变，逐帧复收见 clampParamPanel。
  clampParamPanel();
}
// 参数面板视口收位。以当前 style 位置为基准夹紧，不追踪物体位置（物体移动时面板不能跟着瞬移），
// 只保证整块落在窗口内。接触区（updateParamContacts）每帧增减行高后调用。
export function clampParamPanel(){
  if(!paramBody||!pbox.classList.contains('on'))return;
  var prr=pbox.getBoundingClientRect();
  if(prr.width<2)return;                       // 尚未渲染出来，没得量
  var l=parseFloat(pbox.style.left),t=parseFloat(pbox.style.top);
  if(isNaN(l))l=prr.left;
  if(isNaN(t))t=prr.top;
  pbox.style.left=clamp(l,4,Math.max(4,window.innerWidth-prr.width-6))+'px';
  pbox.style.top=clamp(t,4,Math.max(4,window.innerHeight-prr.height-6))+'px';
}
// 整块物体一次暴露多行参数时（GMm/r² 有 M/m/r、弹簧有 k/L₀/D、vt 杆有长度/质量），每行标注归属：
// 符号参数归它自己的字母，弹簧归 kx，杆归 vt，W 体归本体。
// 放在独立的 .pown span 里、不动 .plab 的文本（探针按 .plab 取标签）。
export const PARAM_OWNER={mass:'m',massM:'M',grav:'g',acc:'a',bounc:'v',frict:'μ',scale:'r',
  bz:'B',eacc:'E',iacc:'I',rodlen:'vt 杆',rodmass:'vt 杆',
  sk:'kx 弹簧',slen:'kx 弹簧',sdamp:'kx 弹簧',
  wmass:'本体',wfrict:'本体',wbounc:'本体',wair:'本体',convspeed:'本体',beltangle:'本体',rlen:'本体'};
export function renderParamPanel(){
  if(!paramBody)return;
  // 标题用编号名（圆1、弧1…），不显示裸 kind（'W'/'S'/'T'）。
  /* 针对某个字符打开面板（paramLetter 非空）时标题用字符本身：此时 paramBody 是临时参数宿主体
   * （openMenu 里的 mb，不在 glyphs/mem 里），bodyName() 只能编出「物体1」。 */
  ptitleEl.textContent=(paramLetter?paramLetter.ch:bodyName(paramBody))+' · 参数';
  var sub=[];
  if(paramLetter)sub.push(paramLetter.ch+' → '+specIdForLetter(paramLetter,paramBody));
  else sub.push(paramBody.mem.length?paramBody.mem.map(function(g){return g.type;}).join(' '):(paramBody.kind||''));
  pvalEl.textContent=sub.join(' ');
  var ids=paramLetter?paramDefForLetter(paramBody,paramLetter):paramDef(paramBody);
  prows.innerHTML='';
  paramRows=[];
  for(var i=0;i<ids.length;i++){
    var spec=PARAM_DEFS[ids[i]];
    // W 体的弹性/摩擦用「下拉框 + 逐物配对表」渲染，而不是普通滑块。
    if(paramBody.kind==='W'&&ids[i]==='wbounc'){appendPairRow(spec,'e');continue;}
    if(paramBody.kind==='W'&&ids[i]==='wfrict'){appendPairRow(spec,'mu');continue;}
    // 布尔参数（「固定铰链」开关）渲染成开/关按钮，不是滑块+数字框；
    // 复用设置面板 .sbtn/.sbtn.act 的选中视觉。
    if(spec.bool){
      var rowB=document.createElement('div');rowB.className='prow';
      var hdB=document.createElement('div');hdB.className='prhead';
      var lbB=document.createElement('span');lbB.className='plab';lbB.textContent=paramLabel(spec);
      var owB=document.createElement('span');owB.className='pown';
      owB.textContent=PARAM_OWNER[ids[i]]||'';
      owB.title='该参数归属的对象';
      owB.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
      var vlB=document.createElement('span');vlB.className='prval';
      hdB.appendChild(lbB);hdB.appendChild(owB);hdB.appendChild(vlB);
      var onB=!!+paramV(paramBody,ids[i]);
      vlB.textContent=onB?'已开启：角度定死（刚接）':'关闭：完全光滑（自由转动）';
      var tg=document.createElement('button');
      tg.className='sbtn'+(onB?' act':'');
      tg.style.cssText='align-self:flex-start;padding:5px 16px;border-radius:8px;font-size:13px';
      tg.textContent=onB?'已开启':'关闭';
      tg.title='开启后铰链两端的角度被定死在开启那一刻，不再能相对转动';
      tg.addEventListener('click',function(e){
        e.stopPropagation();
        applyParam(paramBody,spec,paramV(paramBody,spec.key)?0:1);
        renderParamPanel();
      });
      rowB.appendChild(hdB);rowB.appendChild(tg);
      prows.appendChild(rowB);
      continue;
    }
    var row=document.createElement('div');
    row.className='prow';
    var head=document.createElement('div');
    head.className='prhead';
    var lab=document.createElement('span');
    lab.className='plab';lab.textContent=paramLabel(spec);
    var own=document.createElement('span');
    own.className='pown';own.textContent=PARAM_OWNER[ids[i]]||'';
    own.title='该参数归属的对象';
    own.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
    var val=document.createElement('span');
    val.className='prval';
    head.appendChild(lab);head.appendChild(own);head.appendChild(val);
    var sl=document.createElement('input');
    sl.type='range';
    var nu=document.createElement('input');
    nu.type='number';
    var pb=document.createElement('div');
    pb.className='presets';
    row.appendChild(head);row.appendChild(sl);row.appendChild(nu);
    /* 可视化角度调节：方向行加一个可拖动的指向箭头圆盘，与数字框/滑块双向同步
     * （0° = 水平向右，屏幕坐标系向下为正）。 */
    if(spec.key==='vang'||spec.key==='aang'||spec.key==='waccang'){
      /* 圆盘由 vang / aang / waccang 三行共用，必须用 IIFE 逐行捕获自己那一行的 spec / sl / nu / val：
       * 不要写死 vang，也不要直接引用循环变量（函数作用域，循环结束后停在最后一行）
       * 或用 paramRows[paramRows.length-1] 取控件。 */
      (function(_spec,_sl,_nu,_val){
      var dial=document.createElement('div');
      dial.className='pdial';
      dial.style.cssText='width:44px;height:44px;flex:none;cursor:grab;touch-action:none;margin:2px 0 0 6px';
      /* 轮盘外观与 .ttoggle / .sbtn 一致：半透明白底 + 细边框 + 柔和阴影 + 四周刻度 + 圆头指针 + 中心小圆。 */
      var _ticks='';
      for(var _ti=0;_ti<12;_ti++){
        var _a=_ti*30*Math.PI/180, _r1=15.5, _r2=(_ti%3===0)?11.5:13.5;
        _ticks+='<line x1="'+(22+Math.cos(_a)*_r1).toFixed(2)+'" y1="'+(22+Math.sin(_a)*_r1).toFixed(2)
              +'" x2="'+(22+Math.cos(_a)*_r2).toFixed(2)+'" y2="'+(22+Math.sin(_a)*_r2).toFixed(2)
              +'" stroke="rgba(38,34,28,'+(_ti%3===0?'0.34':'0.18')+')" stroke-width="1" stroke-linecap="round"/>';
      }
      dial.innerHTML='<svg viewBox="0 0 44 44" width="44" height="44">'
        +'<circle cx="22" cy="22" r="17" fill="rgba(255,255,255,.62)" stroke="rgba(38,34,28,.22)" stroke-width="1"/>'
        +_ticks
        +'<line class="darw" x1="22" y1="22" x2="22" y2="5.5" stroke="#3E7C74" stroke-width="2.4" stroke-linecap="round"/>'
        +'<circle cx="22" cy="22" r="2.2" fill="#26221C" opacity=".72"/>'
        +'<circle class="dknob" cx="22" cy="5.5" r="4.2" fill="#3E7C74" opacity=".9"/></svg>';
      /* 0° = 水平向右 ⇒ 图形初始指向上(-90°)，旋转量 = deg+90 */
      var _setArrow=function(deg){
        var g=dial.querySelectorAll('.darw,.dknob');
        for(var _q=0;_q<g.length;_q++)g[_q].setAttribute('transform','rotate('+(deg+90)+' 22 22)');
      };
      _setArrow(paramV(paramBody,_spec.key)||0);   // 读本行的角度
      var _drag=false;
      dial.addEventListener('pointerdown',function(e){
        e.preventDefault();e.stopPropagation();_drag=true;dial.style.cursor='grabbing';
        if(dial.setPointerCapture)dial.setPointerCapture(e.pointerId);
      });
      dial.addEventListener('pointermove',function(e){
        if(!_drag)return;
        var r=dial.getBoundingClientRect();
        var cx=r.left+r.width/2, cy=r.top+r.height/2;
        var deg=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI;
        deg=Math.round(deg);
        _setArrow(deg);
        /* 与滑块/数字框同一入口写回参数（applyParam），写回字符也按本行分派。 */
        applyParam(paramBody,_spec,deg);
        if(paramLetter){
          if(_spec.key==='vang')paramLetter.vAng=deg;
          else if(_spec.key==='aang')paramLetter.aAng=deg;
        }
        /* 同步本行的滑块/数字框/读数 */
        _sl.value=deg;_nu.value=deg;
        if(_val)_val.textContent=fmtVal(deg,_spec);
      });
      dial.addEventListener('pointerup',function(e){_drag=false;dial.style.cursor='grab';});
      dial.title='拖动旋钮设定'+(paramLabel(_spec).replace('方向 θ','')||'')+'方向（0°=水平向右，向上为 −90°）';
      dial.addEventListener('pointerenter',function(){dial.style.filter='brightness(1.03)';});
      dial.addEventListener('pointerleave',function(){dial.style.filter='';});
      row.appendChild(dial);
      })(spec,sl,nu,val);   // IIFE 收口：每个圆盘只认自己那一行的 spec/控件
    }
    // 面板以 SI 单位显示/输入（SI = 内部/siK），内部仍是 px —— 滑块范围、步长一并换算。
    var kSI=spec.siK||1;
    var cur=paramV(paramBody,ids[i])/kSI;
    sl.min=spec.min/kSI;sl.max=spec.max/kSI;sl.step=spec.step/kSI;sl.value=cur;
    nu.value=Math.round(cur*1000)/1000;
    val.textContent=fmtVal(cur,spec);
    /* 光速态回显：面板重渲染（换体/点默认/拖圆盘）后保留「c = 光速」。
     * 滑块顶到最右（max 临时放宽到光速），数字框留空 + placeholder='c'。 */
    if(spec.key==='vsize'&&bossLightState()){
      sl.max=C_LIGHT;sl.value=C_LIGHT;
      nu.value='';nu.placeholder='c';
      /* 用 ≈ 而非 =：屏幕上是换算后的读数，与 bossLightOn 里的文案保持一致。 */
      val.textContent='c ≈ '+C_LIGHT+' m/s';
    }
    // single 默认 button: resets THIS row's param to its default value
    var dflt=document.createElement('button');
    dflt.textContent='默认';
    dflt.title='回到默认数值';
    // 用 IIFE 固定本行的 spec：spec 是函数作用域的循环变量，直接闭包引用会让每一行的
    // 「默认」都只重置最后一行的参数。paramBody 取全局引用即可（换体时 openParams 会整体重渲染）。
    dflt.addEventListener('click',(function(spec2){
      return function(e){e.stopPropagation();applyParam(paramBody,spec2,paramDefVal(paramBody,spec2));renderParamPanel();};
    })(spec));
    pb.appendChild(dflt);
    row.appendChild(pb);
    prows.appendChild(row);
    paramRows.push({spec:spec,sl:sl,nu:nu,val:val});
    sl.oninput=(function(spec2,B2,sl2,nu2,val2,k2){
      return function(){applyParam(B2,spec2,+sl2.value*k2);nu2.value=Math.round(+sl2.value*1000)/1000;val2.textContent=fmtVal(+sl2.value,spec2);};
    })(spec,paramBody,sl,nu,val,kSI);
    nu.onchange=(function(spec2,B2,nu2,sl2,val2,k2){
      return function(){
        var v=+nu2.value;
        /* 光速态下输入框是空的（placeholder='c'）。此时不要按「空 ⇒ 回默认值」处理，
         * 否则会把光速打回默认并清掉光速态；直接跳过，想改回数字就输入一个数。 */
        if((isNaN(v)||nu2.value==='')&&bossLightState())return;
        if(isNaN(v)||v==='')v=paramDefVal(B2,spec2)/k2;
        // number input has UNLIMITED range — no clamp here. The slider is clamped by
        // its own min/max (it will just rest at an endpoint for out-of-range values).
        applyParam(B2,spec2,v*k2);
        sl2.value=v;   // browser clamps the displayed slider position only
        nu2.value=Math.round(v*1000)/1000;
        val2.textContent=fmtVal(v,spec2);
      };
    })(spec,paramBody,nu,sl,val,kSI);
    // blur = apply immediately (same as pressing enter / firing change).
    // NOTE: capture the body in a CLOSURE — by the time blur fires, closeParams() may
    // already have nulled the global paramBody (document pointerdown runs first).
    nu.addEventListener('blur',(function(spec2,B2,nu2,sl2,val2,k2){
      return function(){
        var v=+nu2.value;
        /* 光速态下输入框是空的（placeholder='c'）。此时不要按「空 ⇒ 回默认值」处理，
         * 否则会把光速打回默认并清掉光速态；直接跳过，想改回数字就输入一个数。 */
        if((isNaN(v)||nu2.value==='')&&bossLightState())return;
        if(isNaN(v)||v==='')v=paramDefVal(B2,spec2)/k2;
        applyParam(B2,spec2,v*k2);
        sl2.value=v;
        nu2.value=Math.round(v*1000)/1000;
        val2.textContent=fmtVal(v,spec2);
      };
    })(spec,paramBody,nu,sl,val,kSI));
    // 回车 = 应用 + 交还焦点：否则焦点留在框里，后续按键仍被当成编辑，画布快捷键失效。
    nu.addEventListener('keydown',(function(nu2){
      return function(e){ if(e.key==='Enter'){e.stopPropagation();nu2.blur();} };
    })(nu));
    /* v 的大小框里输入字母 c ⇒ 数值变成光速。
     * <input type=number> 会吞掉字母（keydown 之后 value 变空），所以只能在 keydown 阶段捕获。只在 vsize 行生效。 */
    if(spec.key==='vsize'){
      nu.addEventListener('keydown',(function(nu2,val2){
        return function(e){
          if(e.key==='c'||e.key==='C'){
            e.preventDefault();e.stopPropagation();
            bossLightOn(nu2,val2);
          }
        };
      })(nu,val));
    }
  }
}
export function fmtVal(v,spec){
  v=Math.round(v*1000)/1000;
  if(spec.unit==='×')return '× '+v;
  if(spec.unit)return v+' '+spec.unit;
  return ''+v;
}
export function closeParams(){if(pbox)pbox.classList.remove('on');paramBody=null;paramLetter=null;}
// 每个物体都有稳定的中文名：首次请求时生成并缓存进 B._nm，之后即使前面同类物体被删也不变
// （否则按名字设好的配对系数会因改名而错位）。
export function nameBase(B){
  if(!B)return '物体';
  if(B.kind==='W'){
    if(B.wshape==='circle'&&B.rad)return '圆';
    // 显示名「圆轨」，内部键仍是 'ring'。
    if(B.wshape==='ring'&&B.rad)return '圆轨';   // 空心圆
    if(B.wshape==='arc')return '弧';
    if(B.wshape==='tri')return '三角';
    if(B.wshape==='trough')return '半凹槽';
    if(B.wshape==='tub')return '凹槽';
    return B.closed?'图形':'线';
  }
  if(B.kind==='S'){
    if(B.hinge)return '光滑铰链';
    if(B.rope)return '轻绳';
    return '弹簧';
  }
  if(B.kind==='T')return '杆';
  if(B.kind==='B')return '磁场';
  if(B.kind==='E')return '电场';
  if(B.kind==='I')return '电流';
  if(B.kind==='q')return '电荷';
  var s='';
  if(B.massG&&B.massG.type)s+=B.massG.type;
  if(B.mem&&B.mem.length)for(var i=0;i<B.mem.length;i++)s+=B.mem[i].type;
  return s||(B.kind||'物体');
}
export function bodyName(B){
  if(!B)return '—';
  if(B._nm)return B._nm;
  var base=nameBase(B),n=0;
  for(var i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(O===B)break;
    if(nameBase(O)===base)n++;          // 只数**排在它前面**的同名类，与缓存无关
  }
  B._nm=base+(n+1);
  return B._nm;
}
// 配对键：物体用惰性分配的稳定 _pid；引擎常驻静态体给它自己的短键。
export let PID_SEQ=0;
export function bodyPid(B){if(!B)return null;if(!B._pid)B._pid='b'+(++PID_SEQ);return B._pid;}
export function peerKeyOf(B){
  if(!MW||!B)return B?bodyPid(B):null;
  if(B===MW.ground)return '@ground';
  if(B===MW.wl||B===MW.wr||B===MW.wt)return '@wall';
  return bodyPid(B);
}
// 一对 (A,B) 实际生效的配对覆盖。返回 {e:…|null, mu:…|null}（null = 用默认规则）。
// 双方都显式设过同一条 → 取平均（不偏袒任一方）。
export function pairOvAB(A,B){
  var ka=A?bodyPid(A):null, kb=B?bodyPid(B):null;
  var oa=(A&&A.pOv&&kb)?A.pOv[kb]:null;
  var ob=(B&&B.pOv&&ka)?B.pOv[ka]:null;
  function pick(f){
    if(oa&&ob){
      if(oa[f]!=null&&ob[f]!=null)return (oa[f]+ob[f])/2;
      return (oa[f]!=null)?oa[f]:ob[f];
    }
    var o=oa||ob;
    return o?(o[f]!=null?o[f]:null):null;
  }
  return {e:pick('e'),mu:pick('mu')};
}
export function setPairOv(B,key,field,val){
  if(!B||!key)return;
  if(!B.pOv)B.pOv={};
  if(!B.pOv[key])B.pOv[key]={e:null,mu:null};
  B.pOv[key][field]=val;
  // A↔B 双向镜像写入：A 面板里设「相对于 B」的值，B 面板里「相对于 A」同步。
  // 只对能反查出场上实体的键联动（地面/墙没有面板，镜像进去是死数据，不写）；
  // 本体默认行（key=null）走 applyParam 不经这里。同 field 同值，last-write-wins。
  var peer=null;
  if(typeof key==='string'&&key.charAt(0)==='b'){
    for(var i=0;i<bodies.length;i++){
      if(!bodies[i]||bodies[i].dead)continue;
      if(bodyPid(bodies[i])===key){peer=bodies[i];break;}
    }
  }
  if(peer&&peer!==B){
    if(!peer.pOv)peer.pOv={};
    var rev=bodyPid(B);
    if(rev){
      if(!peer.pOv[rev])peer.pOv[rev]={e:null,mu:null};   // A↔B 双向镜像
      peer.pOv[rev][field]=val;
    }
  }
}
// 由 Matter 体反查实体（配对覆盖要用实体级字段，不能只看 mb）
export function bodyOfMb(mb){
  if(!MW||!mb)return null;
  if(mb===MW.ground||mb===MW.wl||mb===MW.wr||mb===MW.wt)return null;
  for(var i=0;i<bodies.length;i++)if(bodies[i].mb===mb)return bodies[i];
  return null;
}
// 配对表的行：本体默认 + 地面 + 墙 + 场上每一个其它物体
export function pairPeers(B){
  var out=[{key:null,name:'本体默认'},
           {key:'@ground',name:'地面'},
           {key:'@wall',name:'墙'}];
  for(var i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(!O||O===B||O.dead)continue;
    out.push({key:bodyPid(O),name:bodyName(O)});
  }
  return out;
}
// 一行「下拉框 + 展开的配对表」。specId = 'wbounc'(弹性 e) 或 'wfrict'(摩擦 μ)。
// 结构保留 .prow/.prhead/.plab/.prval/.presets —— 探针按这些类名数行/取标签。
export function appendPairRow(spec,field){
  var B=paramBody;
  var row=document.createElement('div');
  row.className='prow';
  var head=document.createElement('div');
  head.className='prhead';
  var lab=document.createElement('span');
  lab.className='plab';lab.textContent=spec.label;
  // μ / e 走这条独立渲染分支，归属标注也要在这里加。
  var own=document.createElement('span');
  own.className='pown';own.textContent=PARAM_OWNER[spec.key]||'';
  own.title='该参数归属的对象';
  own.style.cssText='opacity:.55;font-size:10px;margin-left:6px;white-space:nowrap';
  var val=document.createElement('span');
  val.className='prval';val.textContent=fmtVal(paramV(B,spec.key),spec);
  var dd=document.createElement('button');
  dd.className='pdd';dd.type='button';dd.textContent='配对 ▾';
  dd.title='展开：逐个物体设置这一对的碰撞系数（空 = 跟随默认规则）';
  head.appendChild(lab);head.appendChild(own);head.appendChild(val);head.appendChild(dd);
  row.appendChild(head);

  var pane=document.createElement('div');
  pane.className='ppairs';
  pane.innerHTML='<div class="pph"><span>物体</span><span>'+
                 (field==='e'?'弹性 e':'摩擦 μ')+
                 '</span><span></span></div>';
  // 面板重建时还原展开状态：pairOpenField 是模块级的，重建后 DOM 是新的，不还原则输入一个数展开就塌了。
  if(pairOpenField===field){pane.classList.add('on');dd.classList.add('open');dd.textContent='配对 ▴';}
  var peers=pairPeers(B);
  for(var i=0;i<peers.length;i++){
    (function(pe){
      var pr=document.createElement('div');
      pr.className='pprow';
      var nm=document.createElement('span');
      nm.className='ppn';nm.textContent=pe.name;
      var inp=document.createElement('input');
      inp.className='ppc';inp.type='number';inp.min=0;
      // 输入域的上限/步长取 spec（μ/e 都是 1 / 0.01），不要写死。
      inp.max=(spec.max!=null)?spec.max:1;
      inp.step=(spec.step!=null)?spec.step:0.01;
      inp.placeholder='默认';
      var cur=null;
      if(pe.key===null)cur=paramV(B,spec.key);
      else if(B.pOv&&B.pOv[pe.key])cur=(B.pOv[pe.key][field]!=null)?B.pOv[pe.key][field]:null;
      if(cur===null){inp.value='';}
      else{inp.value=Math.round(cur*1000)/1000;inp.classList.add('set');}
      var clr=document.createElement('button');
      clr.className='ppx';clr.type='button';clr.textContent='×';
      clr.title='清空该对的显式系数（回到默认规则）';
      pr.appendChild(nm);pr.appendChild(inp);pr.appendChild(clr);
      inp.onchange=(function(pe2,inp2){
        return function(){
          var raw=inp2.value;
          if(raw===''||raw===null||isNaN(+raw)){
            inp2.value='';inp2.classList.remove('set');
            if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));}
            else{setPairOv(paramBody,pe2.key,field,null);refreshPairUI();}
            return;
          }
          var v=clamp(+raw,0,(spec.max!=null)?spec.max:1);
          inp2.value=Math.round(v*1000)/1000;inp2.classList.add('set');
          if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],v);}
          else{setPairOv(paramBody,pe2.key,field,v);refreshPairUI();}
        };
      })(pe,inp);
      clr.onclick=(function(pe2,inp2){
        return function(){
          inp2.value='';inp2.classList.remove('set');
          if(pe2.key===null){applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));}
          else{setPairOv(paramBody,pe2.key,field,null);}
          refreshPairUI();
        };
      })(pe,inp);
      // 回车即完成输入（同主参数行）
      inp.addEventListener('keydown',(function(inp3){
        return function(e){ if(e.key==='Enter'){e.stopPropagation();inp3.blur();} };
      })(inp));
      pane.appendChild(pr);
    })(peers[i]);
  }
  dd.onclick=function(){
    var on=pane.classList.toggle('on');
    dd.classList.toggle('open',on);
    dd.textContent=on?'配对 ▴':'配对 ▾';
    // 下方接触区跟着最后展开的那一行走。
    // 这里不能调 renderParamPanel()（会重建面板、展开状态丢失）；接触区本就逐帧刷新，直接调一次即可。
    pairOpenField = on ? field : (pairOpenField===field ? null : pairOpenField);
    updateParamContacts();
    clampParamPanel();
  };
  row.appendChild(pane);
  var pb=document.createElement('div');
  pb.className='presets';
  var dflt=document.createElement('button');
  dflt.textContent='默认';
  dflt.title='本体回到默认数值，并清空本体的全部配对覆盖';
  dflt.addEventListener('click',function(e){
    e.stopPropagation();
    applyParam(paramBody,PARAM_DEFS[spec.key],paramDefVal(paramBody,PARAM_DEFS[spec.key]));
    paramBody.pOv=null;
    renderParamPanel();
  });
  pb.appendChild(dflt);
  row.appendChild(pb);
  prows.appendChild(row);
}
// 配对覆盖改动后，让 Matter 的**当前活动对**立刻按新值生效（否则要等重新接触）
export function refreshPairUI(){
  if(paramBody&&paramBody.kind==='W')refreshWPairs(paramBody);
  if(paramBody)renderParamPanel();
}
// 参数面板开着且对象是 W 体时，列出全场所有对象（含地面/墙）的配对实际生效值：
// 接触中的显示 Matter pair 的实际值，未接触的显示按配对规则将要生效的值。
// （动摩擦 = 双方 min、静摩擦 = 双方 max；面板里调的 μ 只是本体那一份。）
export function updateParamContacts(){
  if(!pcontacts)return;
  var show=paramBody&&paramBody.kind==='W'&&paramBody.mb&&MW&&pbox.classList.contains('on');
  if(!show){pcontacts.classList.remove('on');pcontacts.innerHTML='';return;}
  // 显示的量跟着展开的配对行走：展开 μ 看摩擦、展开 e 看弹性、都收起时看摩擦。
  // pairOpenField 由 appendPairRow 的配对按钮维护。
  var isE=(pairOpenField==='e');
  // 接触中的 Matter pair 索引（实际生效值优先于规则推算值）
  var map={},list=MW.engine.pairs.list,i;
  for(i=0;i<list.length;i++){
    var pr=list[i];
    var act=pr.isActive||((pr.bodyA.isStatic||pr.bodyA.isSleeping)&&(pr.bodyB.isStatic||pr.bodyB.isSleeping));
    if(!act)continue;
    var a=pr.bodyA.parent||pr.bodyA,b=pr.bodyB.parent||pr.bodyB;
    if(a===paramBody.mb)map[b.id]=pr;
    else if(b===paramBody.mb)map[a.id]=pr;
  }
  function muOf(O){                       // 对方的本体 μ（未接触时按规则推算用）
    if(O===MW.ground||O===MW.wl||O===MW.wr||O===MW.wt)return 0.6;
    if(O.kind==='W')return wEffMu(O);
    if(O.kind==='T')return 0.4;          // 杆的材质摩擦口径
    return null;                         // 公式体/场源：手写通道，无单一 μ 口径
  }
  function restOf(O){                     // 对方的本体 e（未接触时按规则推算用，地面/墙恒 0）
    if(O===MW.ground||O===MW.wl||O===MW.wr||O===MW.wt)return 0;
    if(O.kind==='W')return wEffE(O);
    if(O.kind==='T')return 0;            // 杆无弹性
    return null;
  }
  var rows='',n=0;
  function row(name,pr,muOther,restOther,muIdealOther,othMb){
    var txt;
    if(isE){
      if(pr)txt='e='+Math.round(pr.restitution*1000)/1000;   // 显式配对覆盖已写进 pr，直接用实际值
      else if(restOther!=null){
        var effE=Math.max(wEffE(paramBody),restOther);       // 默认规则：取双方 max
        // μ=0 极值 ⇒ rest=1 的显示与物理同源：只在显式声明 μ=0 时才算，
        // 否则高中模式默认 μ=0 会让每行都显示 e=1，而实际物理是 0。
        if(muIdealOther||wMuIdeal(paramBody))effE=1;
        txt='max 规则 → '+Math.round(effE*1000)/1000;
      }else txt='—';
    }else{
      if(pr)txt='μ='+Math.round(pr.friction*1000)/1000+'（静 '+Math.round(pr.frictionStatic*1000)/1000+'）';
      else if(muOther!=null){
        var eff=Math.min(wEffMu(paramBody),muOther);         // 默认规则：取双方 min
        txt='μ=min 规则 → '+Math.round(eff*1000)/1000;
      }else txt='—';
    }
    rows+='<div class="pc-r"><span>'+(pr?'● ':'○ ')+name+'</span><span>'+txt+'</span></div>';
  }
  row('地面',map[MW.ground.id],0.6,0,false,MW.ground);
  row('墙',map[MW.wl.id]||map[MW.wr.id]||(MW.wt?map[MW.wt.id]:null),0.6,0,false,MW.wl);
  for(i=0;i<bodies.length;i++){
    var O=bodies[i];
    if(!O||O===paramBody||O.dead)continue;
    n++;
    row(bodyName(O),O.mb?map[O.mb.id]:null,O.mb?muOf(O):null,O.mb?restOf(O):null,wMuIdeal(O),O.mb);
  }
  pcontacts.classList.add('on');
  pcontacts.innerHTML='<div class="pc-t">全场对象 · 配对'+
                      (isE?'弹性 e':'摩擦 μ')+
                      '（● 接触中 / ○ 未接触）</div>'+rows;
  clampParamPanel();   // 接触行每帧增减，面板高度变了就重新夹紧
}

export function setupParamsPanel(){
  if(pclose)pclose.addEventListener('click',function(){closeParams();});
  document.addEventListener('pointerdown',function(e){
    if(e.target.closest('#pbox')||e.target.closest('#menu'))return;
    closeParams();
  });
}

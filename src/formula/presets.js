/* 公式示例菜单与 LaTeX 子集排版（mthHTML） */
import { BODY } from '../bodies/body.js';
import { DD, fmask, fmclose, fmenu, fmgrid } from '../core/dom.js';
import { GD } from '../letters/glyph.js';
import { refresh } from '../letters/layout.js';
import { HALF, MU } from '../letters/merge.js';
import { H, W } from '../render/render.js';
import { ringGo } from '../ui/menu.js';
import { setToolsOpen } from '../ui/toolbar.js';

/* ---- ① ready-made wholes -------------------------------------------------------------- */
// Each preset is just "a mass letter + the letters merged into it" — the exact same assembly
// path copyBody() uses (massG as the base, mem[] merged in, then refresh()), so a preset is
// byte-for-byte what you get by dragging the same letters together.
// `tex` is the WRITTEN form of the very same formula — a tiny LaTeX subset (\frac{a}{b}, ^{2},
// \mu). It exists because a formula has to LOOK the way it is written on paper: the numerator
// stacked over the denominator with a rule between, superscripts raised. "mv^2/r" is computer
// notation and it is exactly what the menu must never show.
export let WHOLE_PRESETS;
/* ---- written maths (a LaTeX subset -> HTML) -------------------------------------------
   Hand-rolled so the page stays ONE offline file (no KaTeX, no CDN, no network):
     \frac{mv^{2}}{r} -> mv² stacked over r with a rule between them
     mv^{2}           -> mv with a raised superscript 2
     \mu              -> μ
   Everything else is passed straight through; digits and operators are set upright while the
   letters inherit the italic of the .mth container — the way a hand-written formula looks. */
export function mthHTML(tex){
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
          /* 分数线做成独立元素 .fracbar（而非 .mnum 的 border-bottom）：DOM 顺序天然是「分子 → 横线 → 分母」，
           * 进 BOSS.chars 后可被逐个点亮（边框/伪元素做不到）。 */
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
export function spawnWhole(ps,x,y){
  var massN=GD(ps.mass);massN.pop=0;
  var B=BODY(x,y);
  B.massG=massN;massN.body=B;
  B.glyphs=[];B.mem=[];
  var mm=[];
  for(var i=0;i<ps.mem.length;i++){var g=GD(ps.mem[i]);g.pop=0;B.mem.push(g);mm.push(g);}
  var list=[massN].concat(mm);
  list.forEach(function(g){g.body=B;g.inBody=true;B.glyphs.push(g);});
  // 摩擦预设：mg = 重力，地面摩擦极小（像冰面）；m(g+gμ) = 有 μ，用默认摩擦。
  // 由 WHOLE_PRESETS 的 friction 字段注入；μ 字母本身仍是 frict 参数（右键可调）。
  if(ps.friction!=null)B.frict=ps.friction;
  refresh(B);   // layoutRun/layoutFrac/anchorBox all centre the INK on B.x/B.y
  B.pop=1;B.vx=0;B.vy=0;
  return B;
}
export function openFormulaMenu(){
  fmgrid.innerHTML='';
  for(var i=0;i<WHOLE_PRESETS.length;i++){
    var ps=WHOLE_PRESETS[i];
    var b=DD.createElement('button');
    b.className='fmitem';b.setAttribute('data-ix',i);
    var a=DD.createElement('span');a.className='fmname';a.innerHTML=mthHTML(ps.tex||ps.name);
    var c=DD.createElement('span');c.className='fmnote';c.textContent=ps.note;
    b.appendChild(a);b.appendChild(c);
    fmgrid.appendChild(b);
  }
  fmenu.classList.add('on');fmask.classList.add('on');
}
export function closeFormulaMenu(){fmenu.classList.remove('on');fmask.classList.remove('on');}

export function setupFormulaPresets1(){
  WHOLE_PRESETS=[
    /* note 只写物理名称（定理/概念名），不写行为说明：行为描述是实现细节，物理一改就与实际对不上。 */
    {name:'mg',      tex:'mg',                 note:'重力',                mass:'m',mem:['g'],friction:0.01},
    {name:'ma',      tex:'ma',                 note:'牛顿第二定律',        mass:'m',mem:['a']},
    {name:'mv',      tex:'mv',                 note:'动量',                mass:'m',mem:['v']},
    {name:'mv²',     tex:'mv^{2}',             note:'动能',                mass:'m',mem:['v','v']},
    {name:'mv²/r',   tex:'\\frac{mv^{2}}{r}',  note:'向心力',              mass:'m',mem:['v','v','r']},
    /* tex 用标准 \frac{1}{2}mv^{2}（真上下分式）。mem 仍是单个 ½ 字形：那是物理组装体的内部表示，
     * 与显示无关，bossIsEk 认的也是它。 */
    {name:'½mv²',    tex:'\\frac{1}{2}mv^{2}',  note:'动能定理',            mass:'m',mem:[HALF,'v','v']},
    {name:'GMm/r²',  tex:'\\frac{GMm}{r^{2}}', note:'万有引力',            mass:'m',mem:['G','M','r','r']},
    {name:'2GM/c²',  tex:'\\frac{2GM}{c^{2}}', note:'史瓦西半径',          mass:'M',mem:['G','c','c']},
    {name:'mc²',     tex:'mc^{2}',             note:'质能方程',            mass:'m',mem:['c','c']},
    {name:'m(g+gμ)', tex:'m(g+g\\mu)',         note:'滑动摩擦',            mass:'m',mem:['g','g',MU]}
  ];
}

export function setupFormulaPresets2(){
  fmgrid.addEventListener('click',function(e){
    var b=e.target.closest('.fmitem');if(!b)return;
    var ps=WHOLE_PRESETS[+b.getAttribute('data-ix')];
    var B=spawnWhole(ps,W/2,H/2);          // 正中央
    closeFormulaMenu();
    if(B)ringGo(B.x,B.y);
  });
  fmclose.addEventListener('click',closeFormulaMenu);
  fmask.addEventListener('click',closeFormulaMenu);
  DD.addEventListener('keydown',function(e){
    if(e.key==='Escape'){closeFormulaMenu();setToolsOpen(false);}
  });
}

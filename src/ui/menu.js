/* 右键菜单 */
import Matter from 'matter-js';
import { menu, ring } from '../core/dom.js';
import { clamp } from '../core/math.js';
import { freeL } from '../core/world.js';
import { refreshSpringGeom } from '../devices/spring.js';
import { GD } from '../letters/glyph.js';
import { placeLetter } from '../letters/layout.js';
import { charDefFill } from '../letters/panel.js';
import { copyBody } from '../params/copy.js';
import { paramDef, paramDefForLetter } from '../params/defs.js';
import { openParams } from '../params/panel.js';
import { MW } from '../physics/matter.js';

export let menuBody=null, menuLetter=null;
export function openMenu(x,y,B,d){
  if(!B)return;
  menuBody=B;
  menuLetter=d||null;
  // "参数" button only shows when right-clicked LETTER has an adjustable param
  // (a bare body right-click, e.g. a T-rod, uses paramDef(body) instead)
  var adj=d?paramDefForLetter(B,d).length>0:paramDef(B).length>0;
  var pb=menu.querySelector('[data-act="param"]');
  if(pb)pb.classList.toggle('hide',!adj);
  // "固定/解锁" button shows for BOUNDARIES (drawn lines & preset shapes) — nothing else
  var fb=menu.querySelector('[data-act="fix"]');
  if(fb)fb.classList.toggle('hide',!(B.kind==='W'));
  var fx=menu.querySelector('[data-act="fix"] .fix-lab');
  if(fx)fx.textContent=B.fixed?'取消固定':'固定';
  // 「固定方向」只对弹簧显示（kind==='S' 且不是绳/铰链）：锁定那一刻的弹簧朝向成为导轨，之后只能沿它伸缩。
  // 绳的几何完全由两锚点决定、铰链长度恒 0，都没有「方向」；dirLock 会冻结宿主自转并把锚点拽回导轨，
  // 对它们是纯破坏（铰链会被拽成有向的杆）。下面 menu click 分派里有同一条守卫，两处须同步，
  // 漏一处就会出现「点得到但没反应」。
  var db=menu.querySelector('[data-act="dirlock"]');
  if(db)db.classList.toggle('hide',B.kind!=='S'||!!B.rope||!!B.hinge);
  /* 杆（铰链）显示「固定角度」：锁定后物体随杆一起转（连接点不动，相对姿态锁死）。 */
  var rb=menu.querySelector('[data-act="rodlock"]');
  if(rb){
    var rk=(B.kind==='T'&&B.anc&&(B.anc[0]||B.anc[1]));
    rb.classList.toggle('hide',!rk);
    var rl=rb.querySelector('.rl-lab');
    if(rl)rl.textContent=B._rodAngleLock?'解除角度固定':'固定角度';
  }
  var dl=menu.querySelector('[data-act="dirlock"] .dl-lab');
  if(dl)dl.textContent=B.dirLock?'取消固定方向':'固定方向';
  // 先显示、再量实际渲染尺寸、按视口收：菜单条目数会变，按固定条目数估的偏移会让菜单被屏幕截断。
  menu.classList.add('on');
  var mr=menu.getBoundingClientRect();
  var ax=clamp(x,0,window.innerWidth-mr.width-6);
  var ay=clamp(y,0,window.innerHeight-mr.height-6);
  /* 菜单避开被右键的元素：若左上角放在光标处向右下展开，会盖住刚右键的字符（面板最下一排尤甚，
   * elementFromPoint(字符中心) 返回 menu），用户接着拖这个字符的 pointerdown 被菜单吃掉，grab 始终为 null。
   * 候选顺序 = 元素下方 → 上方 → 右侧 → 左侧，取第一个整条在视口内且与元素矩形不相交的；
   * 都不行才退回原位（宁可挡也别丢菜单）。对画布上的物体右键（d 为空 ⇒ el 为空）不避让。 */
  var _el=(d&&d.el&&d.el.getBoundingClientRect)?d.el:null;
  if(_el){
    var ar=_el.getBoundingClientRect();
    var cand=[[ar.left,ar.bottom+6],              /* 正下方 */
              [ar.left,ar.top-mr.height-6],       /* 正上方 */
              [ar.right+6,ar.top],                /* 右侧 */
              [ar.left-mr.width-6,ar.top]];       /* 左侧 */
    for(var ci=0;ci<cand.length;ci++){
      var L=clamp(cand[ci][0],0,window.innerWidth-mr.width-6);
      var T=clamp(cand[ci][1],0,window.innerHeight-mr.height-6);
      if(L<ar.right&&L+mr.width>ar.left&&T<ar.bottom&&T+mr.height>ar.top)continue;  /* 仍相交 */
      ax=L;ay=T;break;
    }
  }
  menu.style.left=ax+'px';
  menu.style.top=ay+'px';
}
export function closeMenu(){menu.classList.remove('on');}
export function ringGo(x,y){
  var e=ring;
  e.style.left=(x-75)+'px';e.style.top=(y-75)+'px';
  e.classList.remove('go');void e.offsetWidth;e.classList.add('go');
}

export function setupUiMenu(){
  menu.addEventListener('click',function(e){
    e.stopPropagation();
    var it=e.target.closest('.menu-item');
    if(!it)return;
    var act=it.getAttribute('data-act');
    if(act==='param'&&menuBody){openParams(menuBody,menuLetter);}
    else if(act==='copy'&&menuBody){
      /* 右键的是字符（menuLetter 非空）时复制字符本身：此时 menuBody 是为打开参数面板临时造的宿主体，
       * 没有字形信息（赋予型字符不进 glyphs/mem），copyBody 会把字形回退成字符表第一个 'm'。
       * 在旁边生成同字符的自由字符，不碰临时宿主，原字符状态不变（不回面板、仍可拖动）。 */
      /* 只有独立的赋予型字符（v/a/q/t 且不构成表达式）才复制字符本身；
       * 其余（组合体/物体）走 copyBody 整体复制，否则组合体只会复制出其中一个元素。 */
      var _ml=menuLetter;
      var _isLoneGiveChar=!!(_ml&&_ml.ch&&!_ml.dead&&
          (_ml.ch==='v'||_ml.ch==='a'||_ml.ch==='q'||_ml.ch==='t')&&
          !(menuBody&&((menuBody.mem&&menuBody.mem.length>1)||(menuBody.glyphs&&menuBody.glyphs.length>1))));
      if(_isLoneGiveChar){
        var _nd=GD(_ml.ch);
        _nd.cat=_ml.cat||1;_nd.pop=0;
        var _px=(_ml.wx!=null?_ml.wx:0)+48, _py=(_ml.wy!=null?_ml.wy:0)+10;
        _nd.state='free';_nd.wx=_px;_nd.wy=_py;_nd.vx=0;_nd.vy=0;
        if(typeof _ml.vGive!=='undefined')_nd.vGive=_ml.vGive;
        if(typeof _ml.vAng!=='undefined')_nd.vAng=_ml.vAng;
        if(typeof _ml.aGive!=='undefined')_nd.aGive=_ml.aGive;
        if(typeof _ml.aAng!=='undefined')_nd.aAng=_ml.aAng;
        if(typeof _ml.qCharge!=='undefined')_nd.qCharge=_ml.qCharge;
        charDefFill(_nd);   // 面板上改过的默认值（CHAR_DEF）在这里补齐
        if(freeL.indexOf(_nd)<0)freeL.push(_nd);
        placeLetter(_nd);
      }else{
        copyBody(menuBody);
      }
    }
    else if(act==='fix'&&menuBody&&menuBody.kind==='W'){
      menuBody.fixed=!menuBody.fixed;
      if(menuBody.mb&&MW){
        Matter.Body.setStatic(menuBody.mb,menuBody.fixed);
        Matter.Sleeping.set(menuBody.mb,false);
      }
    }
    else if(act==='rodlock'&&menuBody&&menuBody.kind==='T'){
      /* 切换铰链的「固定角度」：锁定 ⇒ 宿主随杆一起转（力矩关闭、ω 重建恢复） */
      menuBody._rodAngleLock=!menuBody._rodAngleLock;
      var rl2=menu.querySelector('[data-act="rodlock"] .rl-lab');
      if(rl2)rl2.textContent=menuBody._rodAngleLock?'解除角度固定':'固定角度';
      var mb2=menuBody;
      for(var _ak=0;_ak<2;_ak++){
        var _h=(mb2.anc&&mb2.anc[_ak])?mb2.anc[_ak].B:null;
        if(_h&&_h.kind!=='T'&&_h.mb&&!_h.mb.isStatic&&!mb2._rodAngleLock){
          /* 解除固定 ⇒ 唤醒（让它按重力摆） */
          Matter.Sleeping.set(_h.mb,false);
        }
      }
    }
    else if(act==='dirlock'&&menuBody&&menuBody.kind==='S'&&!menuBody.rope&&!menuBody.hinge){
      // 锁定 = 把此刻的中点与方向冻结成导轨线；解除 = 清掉，几何回到「跟着宿主走」。
      if(menuBody.dirLock){
        menuBody.dirLock=null;
      }else{
        var mx0=(menuBody.e0.x+menuBody.e1.x)/2,my0=(menuBody.e0.y+menuBody.e1.y)/2;
        var ddx0=menuBody.e1.x-menuBody.e0.x,ddy0=menuBody.e1.y-menuBody.e0.y;
        var dd0=Math.hypot(ddx0,ddy0)||1;
        menuBody.dirLock={mx:mx0,my:my0,ux:ddx0/dd0,uy:ddy0/dd0};
        refreshSpringGeom(menuBody);          // 立刻投影一次，端点贴上导轨
      }
    }
    closeMenu();
  });
}

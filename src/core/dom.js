/* 页面 DOM 元素引用 */


export const cv=document.getElementById('cv');
export const panel=document.getElementById('panel');
export const handle=document.getElementById('handle');
export const rszHandle=document.getElementById('fresize');
export const ark=[document.getElementById('ark0'),document.getElementById('ark1')];   // 圆弧端点手柄
export const rodh=[document.getElementById('rodh0'),document.getElementById('rodh1')]; // 杆两端长度手柄
export const ring=document.getElementById('ring');
export const menu=document.getElementById('menu');
export const pbox=document.getElementById('pbox');
export const ptitleEl=document.querySelector('.params .ptitle'), pvalEl=document.querySelector('.params .pval');
export const prows=document.getElementById('prows'), pclose=document.getElementById('pclose'), pcontacts=document.getElementById('pcontacts');
export const trash=document.getElementById('trash');
export const bodies=[], freeG=[], ALL=[];
// 宿主刚度账本：把「一个宿主身上所有弹簧的有效刚度之和」算出来，超预算时同比例缩水
// （所有挂在同一宿主上的弹簧用同一个 share，力的大小才不会在两端违反牛顿第三定律）。
export const SPR_KHOST=[];
export const DD=document;
export const freeL=[];
export const formulas=[];
export const particles=[];
export const tToggle=document.getElementById('ttoggle'), tRow=document.getElementById('trow'), tSub=document.getElementById('tsub');
// 器件行 #dsub 与 #tsub 分开：syncToolUI 用 tSub.querySelectorAll('.tbtn') 只扫形状 chip，
// 器件 chip 若并入 tSub 会被当作形状按钮比对 data-shape（恒 null），永远不高亮。
export const dSub=document.getElementById('dsub');
export const fmenu=document.getElementById('fmenu'), fmask=document.getElementById('fmask'), fmgrid=document.getElementById('fmgrid'), fmclose=document.getElementById('fmclose');
// μ=0 极值体名单（与 EL 并列，perfectElasticMB 每帧一起重算）。μ=0 对的 pair.restitution 虽被 refreshAllPairs⑥ 置 1，
// 求解器仍复现不了 e=1，曲面 41 段接缝实测 ΔE≈130~150/半周期；用同一台补偿机器修，门控多一条「双方均非地面/墙」（见 elasticContactFix）。
export const EL_Z=[];
export const _ropeHitBuf=[];
// 设置面板（左上角工具下拉 → 设置）。PHYS_MODE 切换即时生效：空气阻力由 refreshAllPairs 每帧重刷
// （applyWAir/wAirDef 都读 PHYS_MODE），弹簧阻尼与力矩在下一帧 stepSprings 按新模式作用。
// 弹性由 applyEffRest 刷 mb.restitution：默认体没调过参不经过 applyWFrict/applyWBounc，切换时需扫场上 W 体
// 主动刷一遍，否则旧体仍是 buildMatterBody 的初值（圆为 BALL_REST）。
export const smenu=document.getElementById('smenu'), smask=document.getElementById('smask'), sclose=document.getElementById('sclose');
export const recbtn=document.getElementById('recbtn'), recnote=document.getElementById('recnote'), recbadge=document.getElementById('recbadge');
export const bugmask=DD.getElementById('bugmask'), bugbox=DD.getElementById('bugbox'), bugdesc=DD.getElementById('bugdesc'), buginfo=DD.getElementById('buginfo'), bugsubmit=DD.getElementById('bugsubmit'), bugdl=DD.getElementById('bugdl'), bugstatus=DD.getElementById('bugstatus'), bugclose=DD.getElementById('bugclose');

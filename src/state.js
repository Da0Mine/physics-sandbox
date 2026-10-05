/* 跨模块共享、会被多个模块改写的可变状态（ES 模块不能改写别的模块导出的变量，所以集中放这里） */
export const app = {
  TOUCH_SEL: null,
  TOUCH_LP: null,
  TIME_SCALE: 1,
  BH_FINALE: null,
  hoverW: null,
  mO: undefined,   // 在启动时赋值
  gO: undefined,   // 在启动时赋值
  aO: undefined,   // 在启动时赋值
  vO: undefined,   // 在启动时赋值
  rO: undefined,   // 在启动时赋值
  M2O: undefined,   // 在启动时赋值
  halfO: undefined,   // 在启动时赋值
  muO: undefined,   // 在启动时赋值
  cO: undefined,   // 在启动时赋值
  GO: undefined,   // 在启动时赋值
  tO: undefined,   // 在启动时赋值
  BO: undefined,   // 在启动时赋值
  qO: undefined,   // 在启动时赋值
  IO: undefined,   // 在启动时赋值
  EO: undefined,   // 在启动时赋值
  kO: undefined,   // 在启动时赋值
  xO: undefined,   // 在启动时赋值
};

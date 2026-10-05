# 物理沙盒

在网页里把物理符号（m、g、v、a……）拖出来组成公式，公式会按物理规律运动；还能画物体、放弹簧/杆/绳/铰链/传送带，召唤黑洞和终局 BOSS。

原项目：[Da0Mine/physics-sandbox](https://github.com/Da0Mine/physics-sandbox)（单个 HTML 文件）。本仓库把它整理成了模块化的工程，行为与原版逐帧一致（见「回归测试」）。

## 快速开始

```bash
npm install
npm run dev        # 本地开发，改代码浏览器自动刷新
npm run build      # 产出 dist/index.html：单文件、无外部依赖，可直接双击离线打开
npm test           # 构建并跑回归测试（需要本机装有 Chrome）
npm run lint       # ESLint：未定义变量、对导入绑定赋值、未使用变量
```

## 目录结构

```
index.html            页面骨架（面板、菜单、工具栏的 DOM）
src/
  main.js             入口：按原始顺序调用各模块的 setup，然后 init()
  state.js            被多个模块改写的共享可变状态（app 对象）
  style.css
  core/               数学工具、DOM 引用、场景对象集合（world.js）、主循环（loop.js）
  letters/            字形、公式排版、符号面板、字母合并/拆分/组合
  bodies/             物体、轻质杆、传送带、画出来的物体（W 体：轮廓/凸包/圆弧）
  devices/            弹簧、轻绳、铰链、地面、两点约束、吸附几何、器件放置
  physics/            帧级物理、Matter.js 桥接、材质参数、接触修正、圆/环解析碰撞
  formula/            公式示例菜单与 LaTeX 子集排版
  effects/            粒子、mc² 爆炸、黑洞与终章、飘字
  render/             每帧绘制与悬停检测
  params/             参数定义、参数面板、复制
  ui/                 右键菜单、垃圾桶、触屏模式、设置、工具栏、Bug 记录与提交
  tools/              画笔与预设形状
  input/              指针/触摸事件（抓取、拖拽、松手）
  boss/               终局 BOSS 流程、飞行平台、碎片动画
tests/                确定性回归测试（见下）
```

每个模块文件第一行注释说明它负责什么。

## 代码约定

- **模块只放声明**：函数、常量、模块内变量。加载时要执行的代码（注册事件、创建 DOM、给 Matter 打补丁）写在模块的 `setupXxx()` 里，由 `main.js` 按固定顺序调用。这样模块之间互相 import 也不会因为加载顺序出问题。
- **跨模块改写的状态放 `app`**（`src/state.js`）。ES 模块不能给别的模块导出的变量重新赋值，所以凡是被两个以上模块写的变量都在 `app` 上，例如 `app.TIME_SCALE`、`app.mO`（面板上的符号单例）。只被一个模块写的变量就留在那个模块里 `export let`，其他模块只读。
- **同一元素上同一事件的监听器有先后**：调整 `main.js` 里 setup 的调用顺序前，先确认没有改变这一点。
- Matter.js 用 npm 的 `matter-js@0.20.0`（版本固定：碰撞补丁 `physics/collision.js` 依赖它的内部结构）。

## 回归测试

`tests/` 是一套确定性的端到端测试：

- `prelude.js` 在页面脚本运行前固定时钟、随机数和 `requestAnimationFrame`，由测试逐帧推进，所以同一份代码每次结果完全相同；
- `scenarios.js` 是 18 个针对性场景（字母合并、各种形状、器件、黑洞、BOSS、触屏……），`monkey.js` 再加 6 组随机但可复现的操作序列；
- 每 5 帧采样一次「画布像素 + DOM」的指纹，与 `tests/golden.json` 对比。

golden 是用重构前的原版录制的（之后只因修复下面这个 bug 更新过 `monkey1` 的报错记录），所以 `npm test` 通过就说明行为与原版一致。

**有意改变行为后**（修 bug、加功能），先确认改动符合预期，再运行 `npm run test:update` 重新录制 golden，并把 golden 的变化一起提交。

Chrome 不在默认位置时，用环境变量 `CHROME_PATH` 指定。

## 已知问题 / 修复记录

- 已修复：拖出很小的半凹槽时弧半径为负，`canvas.arc()` 抛异常、那一帧画不完（原版就有）。现在半径下限 2px，见 `shapeOutline` 的 trough 分支。
- 「提交 Bug」会把记录数据 POST 到 `src/ui/bug-report.js` 里的 `BUG_ENDPOINT`（原作者的服务）。

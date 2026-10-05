/* 入口：按原始顺序执行各模块的初始化，然后启动主循环 */
import { init } from './core/loop.js';
import { setupBossFx } from './boss/fx.js';
import { setupDevicesPlacement1, setupDevicesPlacement2 } from './devices/placement.js';
import { setupFormulaPresets1, setupFormulaPresets2 } from './formula/presets.js';
import { setupInputPointer } from './input/pointer.js';
import { setupLettersGlyph } from './letters/glyph.js';
import { setupLettersPanel1, setupLettersPanel2, setupLettersPanel3 } from './letters/panel.js';
import { setupParamsDefs } from './params/defs.js';
import { setupParamsPanel } from './params/panel.js';
import { setupPhysicsCollision } from './physics/collision.js';
import { setupPhysicsMatter } from './physics/matter.js';
import { setupRenderRender } from './render/render.js';
import { setupUiBugReport } from './ui/bug-report.js';
import { setupUiMenu } from './ui/menu.js';
import { setupUiRecorder } from './ui/recorder.js';
import { setupUiSettings1, setupUiSettings2, setupUiSettings3 } from './ui/settings.js';
import { setupUiToolbar1, setupUiToolbar2, setupUiToolbar3 } from './ui/toolbar.js';
import { setupUiTouch1, setupUiTouch2 } from './ui/touch.js';
import { setupUiTrash } from './ui/trash.js';



/* ---- 启动：按原始顺序执行各模块的初始化 ---- */
setupLettersGlyph();
setupPhysicsCollision();
setupUiTouch1();
setupRenderRender();
setupUiMenu();
setupInputPointer();
setupParamsDefs();
setupParamsPanel();
setupUiTrash();
setupPhysicsMatter();
setupFormulaPresets1();
setupDevicesPlacement1();
setupUiRecorder();
setupUiBugReport();
setupUiSettings1();
setupLettersPanel1();
setupUiTouch2();
setupLettersPanel2();
setupUiToolbar1();
setupUiSettings2();
setupLettersPanel3();
setupUiSettings3();
setupUiToolbar2();
setupDevicesPlacement2();
setupUiToolbar3();
setupFormulaPresets2();
init();
setupBossFx();

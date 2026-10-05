import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 开发：npm run dev（热更新）；发布：npm run build → dist/index.html（单文件，可双击离线打开）
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
});

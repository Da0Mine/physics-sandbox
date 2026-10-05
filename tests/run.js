/* 回归测试入口。
 *   npm test               构建后逐场景对比 tests/golden.json，有差异即失败
 *   npm run test:update    重新录制 golden（只在有意改变行为后使用）
 *   node tests/run.js --only=shapes,boss   只跑部分场景
 * 运行是确定性的：prelude.js 固定了时钟、随机数和帧推进，同一份代码每次的采样完全相同。 */
const path = require('path'), fs = require('fs');
const { serve, runScenario, withBrowser } = require('./driver');
const SCENARIOS = require('./scenarios');
const GOLDEN = path.join(__dirname, 'golden.json');
const update = process.argv.includes('--update');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
(async () => {
  const rootArg = (process.argv.find(a => a.startsWith('--root=')) || '').slice(7);   // 测别的目录（例如旧版本快照）
  const dist = rootArg ? path.resolve(rootArg) : path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/index.html 不存在：先运行 npm run build'); process.exit(2); }
  const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : {};
  const srv = await serve(dist); const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  let failed = 0; const t0 = Date.now();
  await withBrowser(async br => {
    for (const [name, fn] of Object.entries(SCENARIOS)) {
      if (only.length && !only.includes(name)) continue;
      const r = await runScenario(br, url, fn);
      const rec = { samples: r.samples, errors: r.errors, fail: r.fail ? r.fail.split('\n')[0] : null };
      if (update) { golden[name] = rec; console.log(`recorded ${name} (${r.samples.length} samples)`); continue; }
      const g = golden[name];
      if (!g) { console.log(`?    ${name}: 没有 golden，先运行 npm run test:update`); failed++; continue; }
      let i = 0; while (i < g.samples.length && g.samples[i] === rec.samples[i]) i++;
      const same = i === g.samples.length && g.samples.length === rec.samples.length
        && JSON.stringify(g.errors) === JSON.stringify(rec.errors) && g.fail === rec.fail;
      if (!same) failed++;
      console.log(`${same ? 'ok  ' : 'FAIL'} ${name}` + (same ? '' : `  首个差异在第 ${i} 个采样（共 ${g.samples.length}）`
        + (JSON.stringify(g.errors) !== JSON.stringify(rec.errors) ? `\n     报错变化: ${JSON.stringify(rec.errors)}` : '')
        + (g.fail !== rec.fail ? `\n     场景异常: ${rec.fail}` : '')));
    }
  });
  srv.close();
  if (update) fs.writeFileSync(GOLDEN, JSON.stringify(golden));
  console.log(`${update ? '已更新 golden' : failed ? failed + ' 个场景不一致' : '全部一致'}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
  process.exit(failed ? 1 : 0);
})();

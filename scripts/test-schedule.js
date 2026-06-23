/** Node 端测试脚本 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ScheduleConfig = require(path.join(root, 'public/js/config'));

function loadBrowserScript(filename) {
  const code = fs.readFileSync(path.join(root, 'public/js', filename), 'utf8');
  const sandbox = {
    window: { ScheduleConfig },
    ScheduleConfig,
    Validator: undefined,
    Scheduler: undefined,
    module: { exports: {} },
    console,
  };
  vm.runInNewContext(code, sandbox);
  return sandbox;
}

const vSandbox = loadBrowserScript('validator.js');
const sSandbox = {
  window: { ScheduleConfig, Validator: vSandbox.window.Validator },
  ScheduleConfig,
  Validator: vSandbox.window.Validator,
  module: { exports: {} },
  console,
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'public/js', 'scheduler.js'), 'utf8'), sSandbox);
const Validator = vSandbox.window.Validator;
const Scheduler = sSandbox.window.Scheduler;

const { MEMBERS, SHIFT } = ScheduleConfig;
const db = require('../server/db');
const year = 2026, month = 7;

console.log(`\n生成 ${year}年${month}月 排班（基于上月数据）...\n`);

const prev = db.loadMonth(2026, 6);
if (!prev) {
  console.error('缺少 2026-06 数据');
  process.exit(1);
}
console.log('上月依据:', prev.year, '年', prev.month, '月');

const options = { memberStates: prev.memberStates, prevData: prev };

const result = Scheduler.generateBest(year, month, 80, options);
const { schedule, validation, meta } = result;

const dailyOk = !result.validation.issues.some(i => i.type === 'dailyMin');
console.log('校验:', dailyOk ? '每日人数通过 ✓' : `${result.validation.issues.filter(i=>i.type==='dailyMin').length} 处人数不足`);

const summary = Validator.summarize(schedule, meta.dayOfWeeks);
const failedDays = summary.daily.filter(d => !d.ok);
if (failedDays.length) {
  console.log('\n人数不足日期:');
  failedDays.forEach(d => console.log(`  ${d.day}日(${d.dow}) 夜一:${d.y1}/${d.min.y1} 夜二:${d.y2}/${d.min.y2}`));
} else {
  console.log('每日人数: 全部达标 ✓');
}

console.log('\n成员统计:');
for (const m of MEMBERS) {
  const row = schedule[m.name];
  const y1 = row.filter(v => v === SHIFT.Y1).length;
  const y2 = row.filter(v => v === SHIFT.Y2).length;
  const off = row.filter(v => v === SHIFT.OFF).length;
  console.log(`  ${m.name}: 夜一${y1} 夜二${y2} 休${off}`);
}

if (!dailyOk) {
  const grouped = {};
  for (const i of validation.issues) grouped[i.type] = (grouped[i.type] || 0) + 1;
  console.log('问题分类:', grouped);
  process.exit(1);
}
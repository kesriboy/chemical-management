/* 核心业务逻辑自测：在 Node 环境下模拟浏览器全局对象，
   仅加载 utils.js / store.js / report.js 三个无 DOM 依赖的模块。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const sandbox = {
  console,
  localStorage: (() => {
    const m = new Map();
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k),
      clear: () => m.clear()
    };
  })(),
  Blob: class { constructor(a) { this.size = JSON.stringify(a).length; } },
  setTimeout, clearTimeout, Date, Math, JSON
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);

['js/utils.js', 'js/store.js', 'js/report.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

const { U, Store, Report } = sandbox;

let pass = 0, fail = 0;
const failures = [];
function t(name, fn) {
  try {
    fn();
    pass++;
    console.log('  ✓ ' + name);
  } catch (e) {
    fail++;
    failures.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name + '\n      ' + e.message);
  }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || '') + ' 期望 ' + sb + '，实际 ' + sa);
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

console.log('\n=== 化学品管理系统 · 核心逻辑自测 ===\n');

/* ---------- 1. 基础工具 ---------- */
console.log('[1] 工具函数');
t('日期格式化 ymd', () => eq(U.ymd(new Date(2026, 9, 22)), '2026-10-22'));
t('月份截取', () => eq(U.month('2026-10-22'), '2026-10'));
t('日期加减', () => eq(U.addDays('2026-10-22', -1), '2026-10-21'));
t('日期差值', () => eq(U.dayDiff('2026-10-01', '2026-10-22'), 21));
t('数量格式化去尾零', () => eq(U.fmtQty(12.5000), '12.5'));
t('数量格式化三位小数', () => eq(U.fmtQty(1.23456), '1.235'));
t('CSV 单元格转义', () => eq(U.csvCell('a,b"c'), '"a,b""c"'));
t('CSV 单元格普通值', () => eq(U.csvCell('plain'), 'plain'));
t('空值安全', () => eq(U.esc(null), ''));
t('XSS 转义', () => ok(U.esc('<script>').indexOf('<') < 0, '未转义尖括号'));
t('去重（按字符串等价，数字 2 与 "2" 视为同一项）', () => eq(U.uniq([1, 1, 2, '2', 3]), [1, 2, 3]));

/* ---------- 2. 化学品 CRUD ---------- */
console.log('\n[2] 化学品档案');
Store.load();
const c1 = Store.addChemical({ code: 'HX-01', name: '无水乙醇', unit: '瓶', openingStock: 40, minStock: 10, category: '危险化学品', hazard: '易燃' });
const c2 = Store.addChemical({ code: 'HX-02', name: '浓硫酸', unit: '瓶', openingStock: 12, minStock: 4, category: '腐蚀品', hazard: '腐蚀' });
const c3 = Store.addChemical({ code: 'HX-03', name: '氯化钠', unit: 'kg', openingStock: 500, minStock: 100, category: '一般化学品', hazard: '无危害' });

t('新增后化学品数量为 3', () => eq(Store.state.chemicals.length, 3));
t('默认值填充（单位）', () => eq(c1.unit, '瓶'));
t('默认值填充（危险性）', () => eq(c3.hazard, '无危害'));
t('数值字段强制转数字', () => eq(typeof c1.openingStock, 'number'));
t('期初库存正确', () => eq(Store.stockOf(c1.id), 40));
t('未领用时库存 = 期初', () => eq(Store.stockOf(c2.id), 12));
t('修改化学品名称生效', () => {
  Store.updateChemical(c1.id, { name: '无水乙醇(AR级)' });
  eq(Store.getChemical(c1.id).name, '无水乙醇(AR级)');
});
t('有领用记录的化学品不可删除', () => {
  Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: 5, applicant: '张三', dept: '生产部', purpose: '实验', status: 'issued' });
  const res = Store.removeChemical(c1.id);
  eq(res.ok, false);
  ok(res.msg.indexOf('不能删除') > 0);
});
t('无记录的化学品可删除', () => {
  const tmp = Store.addChemical({ name: '临时品', unit: 'kg' });
  const res = Store.removeChemical(tmp.id);
  eq(res.ok, true);
  eq(Store.state.chemicals.length, 3);
});

/* ---------- 3. 领用记录与库存联动 ---------- */
console.log('\n[3] 领用记录与库存联动');
t('领用后库存扣减', () => eq(Store.stockOf(c1.id), 40 - 5));
t('领用单号自动生成', () => {
  const r = Store.state.records[0];
  ok(/^LY\d{8}-\d{4}$/.test(r.docNo), '单号格式异常: ' + r.docNo);
});
t('单号在当日内递增', () => {
  const r2 = Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: 1, applicant: '李四', dept: '技术部', purpose: '检验', status: 'issued' });
  const n1 = Store.state.records[0].docNo, n2 = r2.record.docNo;
  ok(n1 !== n2, '两笔单号重复');
  ok(parseInt(n2.split('-')[1], 10) > parseInt(n1.split('-')[1], 10), '序号未递增');
});
t('领用数量为 0 被拒绝', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: 0, applicant: '王五', purpose: 'x', status: 'issued' });
  eq(res.ok, false);
});
t('领用数量为负被拒绝', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: -5, applicant: '王五', purpose: 'x', status: 'issued' });
  eq(res.ok, false);
});
t('缺少领用人被拒绝', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: 1, applicant: '', purpose: 'x', status: 'issued' });
  eq(res.ok, false);
  ok(res.msg.indexOf('领用人') > 0);
});
t('缺少用途被拒绝', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c1.id, qty: 1, applicant: '王五', purpose: '', status: 'issued' });
  eq(res.ok, false);
});
t('超库存领用被拦截', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c2.id, qty: 999, applicant: '赵六', purpose: 'x', status: 'issued' });
  eq(res.ok, false);
  ok(res.msg.indexOf('库存不足') >= 0, '提示信息不符: ' + res.msg);
});
t('退库记录允许超出现存（返还语义）', () => {
  const res = Store.addRecord({ date: U.today(), chemicalId: c2.id, qty: 5, applicant: '赵六', purpose: '退库', status: 'returned' });
  eq(res.ok, true);
});
t('退库后库存回升', () => eq(Store.stockOf(c2.id), 12 + 5));
t('编辑记录：改数量后库存同步调整', () => {
  const rid = Store.state.records[0].id;
  const before = Store.stockOf(c1.id);
  Store.updateRecord(rid, { date: U.today(), chemicalId: c1.id, qty: 10, applicant: '张三', dept: '生产部', purpose: '实验', status: 'issued' });
  eq(Store.stockOf(c1.id), before - 5); // 5 → 10，多扣 5
});
t('编辑记录：换化学品时原品回冲', () => {
  const rid = Store.state.records[0].id;
  const c1Before = Store.stockOf(c1.id), c2Before = Store.stockOf(c2.id);
  Store.updateRecord(rid, { date: U.today(), chemicalId: c2.id, qty: 10, applicant: '张三', dept: '生产部', purpose: '实验', status: 'issued' });
  eq(Store.stockOf(c1.id), c1Before + 10); // 原化学品退回 10
  eq(Store.stockOf(c2.id), c2Before - 10);
});
t('编辑记录：改状态为退库后库存返还（-10 扣减翻转为 +10 返还，共 +20）', () => {
  const rid = Store.state.records[0].id;
  const before = Store.stockOf(c2.id);
  Store.updateRecord(rid, { date: U.today(), chemicalId: c2.id, qty: 10, applicant: '张三', dept: '生产部', purpose: '实验', status: 'returned' });
  eq(Store.stockOf(c2.id), before + 20);
});
t('删除记录后库存回冲（删除退库记录则扣回其返还量）', () => {
  const rid = Store.state.records[0].id;
  const before = Store.stockOf(c2.id);
  Store.removeRecord(rid);
  eq(Store.stockOf(c2.id), before - 10);
});
t('库存快照与逐条计算一致', () => {
  const sm = Store.stockMap();
  Store.state.chemicals.forEach(c => eq(sm[c.id], Store.stockOf(c.id)));
});

/* ---------- 4. 预警 ---------- */
console.log('\n[4] 库存预警');
t('低于下限的化学品进入预警列表', () => {
  Store.updateChemical(c3.id, { minStock: 1000 });
  const low = Store.lowStockList();
  ok(low.some(l => l.chemical.id === c3.id), 'c3 应触发预警');
});
t('预警排序按库存升序', () => {
  const low = Store.lowStockList();
  for (let i = 1; i < low.length; i++) ok(low[i - 1].stock <= low[i].stock, '未按库存升序');
});
t('零库存视为预警', () => {
  const c4 = Store.addChemical({ name: '零库存品', unit: 'kg', openingStock: 0, minStock: 1 });
  ok(Store.lowStockList().some(l => l.chemical.id === c4.id), '零库存未预警');
  Store.removeChemical(c4.id);
});

/* ---------- 5. 报表筛选与汇总 ---------- */
console.log('\n[5] 报表筛选与汇总');
Store.load();
Store.clearAll();
const r1 = Store.addChemical({ name: '乙醇', unit: '瓶', openingStock: 100, minStock: 10, category: '危险化学品', hazard: '易燃' }).id;
const r2 = Store.addChemical({ name: '硫酸', unit: 'kg', openingStock: 100, minStock: 10, category: '腐蚀品', hazard: '腐蚀' }).id;
Store.addRecord({ date: '2026-10-01', chemicalId: r1, qty: 5, applicant: '张三', dept: '生产部', purpose: '实验', status: 'issued' });
Store.addRecord({ date: '2026-10-01', chemicalId: r2, qty: 3, applicant: '张三', dept: '生产部', purpose: '实验', status: 'issued' });
Store.addRecord({ date: '2026-10-15', chemicalId: r1, qty: 2, applicant: '李四', dept: '质量部', purpose: '检验', status: 'issued' });
Store.addRecord({ date: '2026-09-20', chemicalId: r1, qty: 7, applicant: '王五', dept: '技术部', purpose: '调试', status: 'issued' });
Store.addRecord({ date: '2026-10-20', chemicalId: r2, qty: 4, applicant: '王五', dept: '技术部', purpose: '调试', status: 'returned' });

t('日期区间筛选（起）', () => eq(Report.filterRecords({ from: '2026-10-15' }).length, 2));
t('日期区间筛选（止）', () => eq(Report.filterRecords({ to: '2026-10-01' }).length, 3));
t('日期区间筛选（双端）', () => eq(Report.filterRecords({ from: '2026-10-01', to: '2026-10-15' }).length, 3));
t('部门筛选', () => eq(Report.filterRecords({ dept: '生产部' }).length, 2));
t('化学品筛选', () => eq(Report.filterRecords({ chemicalId: r1 }).length, 3));
t('危险性筛选', () => eq(Report.filterRecords({ hazard: '腐蚀' }).length, 2));
t('多条件组合筛选', () => eq(Report.filterRecords({ from: '2026-10-01', dept: '生产部' }).length, 2));
t('无匹配返回空集', () => eq(Report.filterRecords({ dept: '不存在的部门' }).length, 0));

t('明细行数 = 记录数', () => eq(Report.detailRows(Store.state.records).length, 5));
t('明细按日期倒序', () => {
  const rows = Report.detailRows(Store.state.records);
  ok(rows[0].date >= rows[rows.length - 1].date, '未倒序');
  eq(rows[0].date, '2026-10-20');
});
t('明细序号连续', () => {
  const rows = Report.detailRows(Store.state.records);
  eq(rows.map(r => r.idx), [1, 2, 3, 4, 5]);
});
t('按化学品汇总：数量与次数正确', () => {
  const rows = Report.summarize(Store.state.records, 'chemical');
  const eth = rows.find(r => r.key === '乙醇');
  eq(eth.count, 3);
  eq(eth.total, 14); // 5+2+7
  eq(eth.units['瓶'], 14);
});
t('按部门汇总正确', () => {
  const rows = Report.summarize(Store.state.records, 'dept');
  eq(rows.find(r => r.key === '生产部').count, 2);
  eq(rows.find(r => r.key === '技术部').count, 2);
  eq(rows.find(r => r.key === '质量部').count, 1);
});
t('按领用人汇总正确', () => {
  const rows = Report.summarize(Store.state.records, 'applicant');
  eq(rows.find(r => r.key === '张三').count, 2);
  eq(rows.find(r => r.key === '王五').count, 2);
});
t('按月份汇总正确', () => {
  const rows = Report.summarize(Store.state.records, 'month');
  eq(rows.find(r => r.key === '2026-10').count, 4);
  eq(rows.find(r => r.key === '2026-09').count, 1);
});
t('按用途汇总正确', () => {
  const rows = Report.summarize(Store.state.records, 'purpose');
  eq(rows.find(r => r.key === '实验').count, 2);
});
t('按类别汇总正确', () => {
  const rows = Report.summarize(Store.state.records, 'category');
  eq(rows.find(r => r.key === '危险化学品').count, 3);
  eq(rows.find(r => r.key === '腐蚀品').count, 2);
});
t('不同单位不合并计量（分单位统计）', () => {
  const rows = Report.summarize(Store.state.records, 'chemical');
  const eth = rows.find(r => r.key === '乙醇');
  eq(Object.keys(eth.units), ['瓶']);
  ok(eth.unitText.indexOf('瓶') >= 0);
});
t('汇总按数量降序', () => {
  const rows = Report.summarize(Store.state.records, 'chemical');
  for (let i = 1; i < rows.length; i++) ok(rows[i - 1].total >= rows[i].total, '未降序');
});
t('退库记录计入汇总', () => {
  const rows = Report.summarize(Store.state.records, 'chemical');
  const sul = rows.find(r => r.key === '硫酸');
  eq(sul.total, 7); // 3 发放 + 4 退库
});
t('报表元信息包含区间与条数', () => {
  const meta = Report.buildMeta(Store.state.records, { from: '2026-10-01', to: '2026-10-31' });
  ok(meta.indexOf('2026-10-01') >= 0, '缺起始日期');
  ok(meta.indexOf('5 条') >= 0, '缺条数');
});

/* ---------- 6. 导入导出 ---------- */
console.log('\n[6] 导入导出');
t('导出 JSON 可解析且含关键字段', () => {
  const json = Store.exportAll();
  const data = JSON.parse(json);
  ok(Array.isArray(data.chemicals) && Array.isArray(data.records), '结构不符');
  eq(data.chemicals.length, 2);
  eq(data.records.length, 5);
});
t('导入非法 JSON 返回错误', () => {
  const res = Store.importAll('这不是json', 'merge');
  eq(res.ok, false);
});
t('导入结构不符返回错误', () => {
  const res = Store.importAll('{"a":1}', 'merge');
  eq(res.ok, false);
});
t('导入合并按 id 覆盖', () => {
  const json = Store.exportAll();
  const data = JSON.parse(json);
  data.chemicals[0].name = '乙醇-改';
  const res = Store.importAll(JSON.stringify(data), 'merge');
  eq(res.ok, true);
  eq(Store.getChemical(r1).name, '乙醇-改');
});
t('导入替换模式生效', () => {
  const json = Store.exportAll();
  const data = JSON.parse(json);
  data.records = data.records.slice(0, 1);
  Store.importAll(JSON.stringify(data), 'replace');
  eq(Store.state.records.length, 1);
});
t('清空记录后库存回到期初', () => {
  Store.load();
  Store.clearAll();
  const c = Store.addChemical({ name: '测试品', unit: 'kg', openingStock: 50, minStock: 0 });
  Store.addRecord({ date: U.today(), chemicalId: c.id, qty: 20, applicant: 'A', purpose: 'B', status: 'issued' });
  eq(Store.stockOf(c.id), 30);
  Store.clearRecords();
  eq(Store.stockOf(c.id), 50);
});

/* ---------- 7. 单号生成 ---------- */
console.log('\n[7] 单据号');
t('不同日期单号前缀不同', () => {
  const c = Store.addChemical({ name: '单号测试', unit: 'kg', openingStock: 100 });
  Store.addRecord({ date: '2026-10-01', chemicalId: c.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  const a = Store.state.records[0].docNo;
  Store.addRecord({ date: '2026-10-02', chemicalId: c.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  const b = Store.state.records[1].docNo;
  ok(a.indexOf('LY20261001') === 0, 'a 前缀错: ' + a);
  ok(b.indexOf('LY20261002') === 0, 'b 前缀错: ' + b);
});
t('删除记录后单号不复用（审计要求：已发出的号不可重复）', () => {
  const c = Store.addChemical({ name: '单号测试2', unit: 'kg', openingStock: 100 });
  const r = Store.addRecord({ date: '2026-10-05', chemicalId: c.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  const no = r.record.docNo;
  Store.removeRecord(r.record.id);
  const r2 = Store.addRecord({ date: '2026-10-05', chemicalId: c.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  ok(r2.record.docNo !== no, '单号被复用: ' + no);
  ok(parseInt(r2.record.docNo.split('-')[1], 10) > parseInt(no.split('-')[1], 10), '新单号应递增: ' + r2.record.docNo);
});
t('单号固定 4 位补零', () => {
  const c = Store.addChemical({ name: '单号测试3', unit: 'kg', openingStock: 100 });
  const r = Store.addRecord({ date: '2026-11-09', chemicalId: c.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  ok(/LY20261109-0001$/.test(r.record.docNo), '格式错: ' + r.record.docNo);
});

/* ---------- 结果 ---------- */
console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (fail) {
  console.log('\n失败明细：');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}

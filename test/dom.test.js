/* DOM 级集成测试：用 jsdom 真实加载 index.html + 全部脚本，
   驱动界面交互，验证渲染、弹窗、事件绑定、导出产物。
   需设置 NODE_PATH 指向 node workspace。 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
const pending = [];
function t(name, fn) {
  if (fn.length > 0) {           // 异步用例：登记后串行 await
    pending.push({ name, fn });
    return;
  }
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) {
    fail++; failures.push(name + ' → ' + e.message);
    console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      '));
  }
}
async function runAsync() {
  for (const { name, fn } of pending) {
    try { await fn(); pass++; console.log('  ✓ ' + name); }
    catch (e) {
      fail++; failures.push(name + ' → ' + e.message);
      console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 3).join('\n      '));
    }
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error((msg || '') + ' 期望 ' + sb + '，实际 ' + sa);
}

console.log('\n=== 化学品管理系统 · DOM 集成测试 ===\n');

/* ---------- 启动 jsdom ---------- */
const vc = new VirtualConsole();
vc.on('jsdomError', e => console.error('[jsdom error]', e.message));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  url: 'http://localhost/',
  pretendToBeVisual: true,
  virtualConsole: vc
});

const { window } = dom;
const { document } = window;

// 补齐 jsdom 缺失的 API
window.print = () => { window.__printed = true; };
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};

// 捕获下载动作
const downloads = [];
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = function (tag) {
  const node = origCreate(tag);
  if (String(tag).toLowerCase() === 'a') {
    node.click = function () {
      downloads.push({ download: node.download, href: node.href });
    };
  }
  return node;
};

const OrigBlob = window.Blob;

// 按顺序注入脚本（jsdom 不加载外部相对脚本时手动执行）
['js/utils.js', 'js/store.js', 'js/report.js', 'js/app.js'].forEach(f => {
  const scriptEl = document.createElement('script');
  scriptEl.textContent = fs.readFileSync(path.join(ROOT, f), 'utf8');
  document.body.appendChild(scriptEl);
});

// 应用在 DOMContentLoaded 时启动，等待该事件（与真实浏览器时序一致）
const ready = new Promise(resolve => {
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(resolve, 0);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(resolve, 0));
  }
});

const { U, Store, Report, App } = window;
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

// 临时替换 Blob 以捕获导出内容
function captureBlob(fn) {
  let captured = null;
  const prev = window.Blob;
  window.Blob = function (parts, opts) { captured = parts.join(''); return new prev(parts, opts); };
  try { fn(); } finally { window.Blob = prev; }
  return captured;
}

async function main() {
  await ready;

/* ---------- 1. 初始化 ---------- */
console.log('[1] 应用初始化');
t('全局对象已挂载', () => {
  ok(U && Store && Report && App, '缺少全局对象');
});
t('DOMContentLoaded 后已完成初始化渲染', () => {
  eq($$('#kpiGrid .kpi').length, 4, 'KPI 未渲染，init 可能未执行');
});
t('页面默认激活概览', () => {
  ok($('#page-dashboard').classList.contains('active'), '概览未激活');
});
t('五个标签页均已绑定', () => {
  eq($$('.tab').map(b => b.dataset.page), ['dashboard', 'chemicals', 'records', 'report', 'data']);
});
t('标签切换生效', () => {
  $$('.tab').find(b => b.dataset.page === 'report').click();
  ok($('#page-report').classList.contains('active'), '未切到报表页');
  ok(!$('#page-dashboard').classList.contains('active'), '旧页未隐藏');
});

/* ---------- 2. 新增化学品（走真实弹窗流程） ---------- */
console.log('\n[2] 化学品档案（弹窗交互）');
t('点击新增打开弹窗', () => {
  $('#chemAddBtn').click();
  ok($('#modalMask').classList.contains('show'), '弹窗未显示');
  eq($('#modalTitle').textContent, '新增化学品');
});
t('弹窗含全部 13 个字段', () => {
  const keys = $$('#modalBody [data-key]').map(i => i.dataset.key);
  eq(keys.length, 13);
  ['code', 'name', 'cas', 'category', 'hazard', 'spec', 'unit', 'openingStock', 'minStock',
   'location', 'manufacturer', 'expiry', 'note'].forEach(k => ok(keys.includes(k), '缺字段 ' + k));
});
t('必填项标记存在', () => {
  ok($('#modalBody .req'), '无必填标记');
});
t('名称为空时保存被拒绝', () => {
  $$('#modalBody [data-key]').forEach(i => { if (i.dataset.key !== 'name') i.value = ''; });
  $('#modalOk').click();
  ok($('#modalMask').classList.contains('show'), '弹窗应保持打开');
});
t('填写完整后保存成功', () => {
  const set = (k, v) => { const i = $(`#modalBody [data-key="${k}"]`); i.value = v; };
  set('code', 'HX-T01'); set('name', '测试乙醇'); set('cas', '64-17-5');
  set('openingStock', '50'); set('minStock', '10'); set('unit', '瓶');
  set('location', 'A区-01柜');
  $('#modalOk').click();
  ok(!$('#modalMask').classList.contains('show'), '弹窗未关闭');
  eq(Store.state.chemicals.length, 1);
});
t('表格渲染出该化学品', () => {
  const rows = $$('#chemTable tbody tr');
  eq(rows.length, 1);
  ok(rows[0].textContent.includes('测试乙醇'), '未渲染名称');
  ok(rows[0].textContent.includes('HX-T01'), '未渲染编号');
});
t('库存列显示当前库存 50', () => {
  ok($('#chemTable tbody tr').textContent.includes('50'), '库存未显示');
});

/* ---------- 3. 领用记录（走真实弹窗流程） ---------- */
console.log('\n[3] 领用记录（弹窗交互）');
t('点击新增领用打开弹窗', () => {
  $('#recAddBtn').click();
  ok($('#modalMask').classList.contains('show'), '弹窗未显示');
  eq($('#modalTitle').textContent, '新增领用记录');
});
t('化学品下拉自动带出库存', () => {
  const opt = $('#modalBody select[data-key="chemicalId"] option[value]');
  ok(opt.textContent.includes('测试乙醇'), '下拉未带出化学品');
  ok(opt.textContent.includes('50'), '下拉未显示库存: ' + opt.textContent);
});
t('弹窗含全部领用字段', () => {
  const keys = $$('#modalBody [data-key]').map(i => i.dataset.key);
  ['chemicalId', 'qty', 'date', 'applicant', 'dept', 'purpose', 'operator', 'status', 'note']
    .forEach(k => ok(keys.includes(k), '缺字段 ' + k));
});
t('输入数量时实时更新库存提示', () => {
  const qty = $('#modalBody [data-key="qty"]');
  qty.value = '20';
  qty.dispatchEvent(new window.Event('input'));
  const hint = $('#stockHint');
  ok(hint.textContent.includes('50'), '提示未含当前库存: ' + hint.textContent);
  ok(hint.textContent.includes('30'), '提示未含发放后剩余: ' + hint.textContent);
});
t('超库存时提示标红', () => {
  const qty = $('#modalBody [data-key="qty"]');
  qty.value = '999';
  qty.dispatchEvent(new window.Event('input'));
  ok($('#stockHint').style.color.includes('danger'), '未标红: ' + $('#stockHint').style.color);
});
t('缺少领用人时保存被拒绝', () => {
  const set = (k, v) => { const i = $(`#modalBody [data-key="${k}"]`); if (i) i.value = v; };
  set('qty', '10'); set('applicant', ''); set('purpose', '化验分析');
  $('#modalOk').click();
  ok($('#modalMask').classList.contains('show'), '弹窗应保持打开');
  eq(Store.state.records.length, 0, '不应写入记录');
});
t('填写完整后保存成功并生成单号', () => {
  const set = (k, v) => { const i = $(`#modalBody [data-key="${k}"]`); if (i) i.value = v; };
  set('qty', '10'); set('applicant', '张伟'); set('dept', '生产部');
  set('purpose', '理化检验'); set('operator', '孙管理员');
  $('#modalOk').click();
  ok(!$('#modalMask').classList.contains('show'), '弹窗未关闭');
  eq(Store.state.records.length, 1);
  ok(/^LY\d{8}-\d{4}$/.test(Store.state.records[0].docNo), '单号异常');
});
t('领用后库存扣减为 40', () => eq(Store.stockOf(Store.state.chemicals[0].id), 40));
t('记录表格渲染出行', () => {
  const row = $('#recTable tbody tr');
  ok(row.textContent.includes('张伟'), '未渲染领用人');
  ok(row.textContent.includes('理化检验'), '未渲染用途');
  ok(row.textContent.includes('10'), '未渲染数量');
});
t('底部汇总显示条数与合计', () => {
  ok($('#recSummary').textContent.includes('共 1 条'), '汇总文本错: ' + $('#recSummary').textContent);
  ok($('#recSummary').textContent.includes('合计数量 10'), '合计错: ' + $('#recSummary').textContent);
});
t('单位名称输入框存在', () => {
  ok($('#orgName'), '缺单位名称输入框');
});

/* ---------- 4. 领用记录表输出 ---------- */
console.log('\n[4] 领用记录表输出');
t('报表页渲染明细行', () => {
  $$('.tab').find(b => b.dataset.page === 'report').click();
  const rows = $$('#rpTable tbody tr');
  ok(rows.length >= 2, '明细行数不足（含合计行）: ' + rows.length);
  ok($('#rpTable tbody').textContent.includes('张伟'), '未渲染领用人');
});
t('报表抬头显示记录条数', () => {
  ok($('#rpMeta').textContent.includes('1 条'), '条数错: ' + $('#rpMeta').textContent);
});
t('汇总表按化学品分组正确', () => {
  const head = $$('#rpSumHead th').map(th => th.textContent);
  ok(head.some(h => h.includes('化学品')), '表头错: ' + head.join('|'));
  ok($('#rpSumTable tbody').textContent.includes('测试乙醇'), '汇总缺化学品');
});
t('切换汇总维度为按部门', () => {
  $$('#rpDimSeg .seg-btn').find(b => b.dataset.dim === 'dept').click();
  ok($('#rpSumHead').textContent.includes('部门'), '未切到部门维度');
  ok($('#rpSumTable tbody').textContent.includes('生产部'), '部门汇总为空');
});
t('切换汇总维度为按领用人', () => {
  $$('#rpDimSeg .seg-btn').find(b => b.dataset.dim === 'applicant').click();
  ok($('#rpSumTable tbody').textContent.includes('张伟'), '领用人汇总为空');
});
t('日期筛选生效', () => {
  $('#rpFrom').value = '2020-01-01';
  $('#rpTo').value = '2020-12-31';
  $('#rpFrom').dispatchEvent(new window.Event('change'));
  ok($('#rpMeta').textContent.includes('0 条'), '筛选未生效: ' + $('#rpMeta').textContent);
  ok($('#rpTable tbody').textContent.includes('无记录'), '应显示空态');
});
t('重置筛选恢复数据', () => {
  $('#rpResetBtn').click();
  ok($('#rpMeta').textContent.includes('1 条'), '重置未恢复: ' + $('#rpMeta').textContent);
});
t('按化学品筛选生效', () => {
  const cid = Store.state.chemicals[0].id;
  $('#rpChem').value = cid;
  $('#rpChem').dispatchEvent(new window.Event('change'));
  ok($('#rpMeta').textContent.includes('1 条'), '筛选结果错');
  $('#rpChem').value = '';
  $('#rpChem').dispatchEvent(new window.Event('change'));
});
t('导出 CSV 产出正确内容', () => {
  downloads.length = 0;
  const captured = captureBlob(() => $('#rpCsvBtn').click());
  ok(downloads.length === 1, '未触发下载');
  ok(downloads[0].download.endsWith('.csv'), '文件名异常: ' + downloads[0].download);
  ok(captured.includes('序号') && captured.includes('化学品名称'), '表头缺失');
  ok(captured.includes('张伟') && captured.includes('理化检验'), '数据行缺失');
  ok(captured.includes('测试乙醇'), '化学品缺失');
});
t('导出 Excel 产出 SpreadsheetML 结构', () => {
  downloads.length = 0;
  const captured = captureBlob(() => $('#rpXlsBtn').click());
  ok(downloads.length === 1, '未触发下载');
  ok(downloads[0].download.endsWith('.xls'), '文件名异常: ' + downloads[0].download);
  ok(captured.includes('<?xml version="1.0"'), '缺 XML 声明');
  ok(captured.includes('urn:schemas-microsoft-com:office:spreadsheet'), '缺 SpreadsheetML 命名空间');
  ok(captured.includes('领用明细'), '缺明细工作表');
  ok(captured.includes('按化学品汇总'), '缺化学品汇总表');
  ok(captured.includes('按部门汇总'), '缺部门汇总表');
  ok(captured.includes('张伟'), '缺数据');
  const openTags = (captured.match(/<Worksheet\b/g) || []).length;
  const closeTags = (captured.match(/<\/Worksheet>/g) || []).length;
  eq(openTags, closeTags, 'Worksheet 标签不闭合');
});
t('打印调用 window.print（延时 60ms 后触发，需等待）', async () => {
  window.__printed = false;
  $('#rpPrintBtn').click();
  await new Promise(r => setTimeout(r, 150));
  ok(window.__printed === true, '未触发打印');
});
t('打印内容含签字栏与合计行', () => {
  const html = $('#printRoot').innerHTML;
  ok(html.includes('p-title'), '缺标题');
  ok(html.includes('p-sign'), '缺签字栏');
  ok(html.includes('制表人'), '缺制表人');
  ok(html.includes('合计'), '缺合计行');
});
t('化学品台账导出含库存与下限', () => {
  downloads.length = 0;
  const captured = captureBlob(() => $('#chemExportBtn').click());
  ok(downloads.length === 1, '未触发下载');
  ok(captured.includes('期初库存') && captured.includes('当前库存') && captured.includes('库存下限'), '表头缺失');
  ok(captured.includes('测试乙醇'), '数据缺失');
});

/* ---------- 5. 概览页 ---------- */
console.log('\n[5] 概览页');
t('KPI 卡片渲染 4 张', () => {
  $$('.tab').find(b => b.dataset.page === 'dashboard').click();
  eq($$('#kpiGrid .kpi').length, 4);
});
t('KPI 数值正确', () => {
  const txt = $('#kpiGrid').textContent;
  ok(txt.includes('在册化学品'), '缺标签');
  ok(txt.includes('累计领用'), '缺标签');
  ok(txt.includes('库存预警'), '缺标签');
});
t('最近领用列表有数据', () => {
  ok($('#recentList').textContent.includes('张伟'), '最近领用为空');
});
t('趋势图渲染 14 个柱', () => {
  eq($$('#trendChart .chart-col').length, 14);
});
t('预警列表：库存 40 高于下限 10 故无预警', () => {
  ok($('#alertList').textContent.includes('所有'), '预警态异常: ' + $('#alertList').textContent.slice(0, 60));
});

/* ---------- 6. 库存联动（UI 层） ---------- */
console.log('\n[6] UI 层库存联动');
t('降低下限触发预警展示', () => {
  Store.updateChemical(Store.state.chemicals[0].id, { minStock: 100 });
  $$('.tab').find(b => b.dataset.page === 'dashboard').click();
  ok($('#alertList').textContent.includes('测试乙醇'), '未进入预警列表');
});
t('表格中标记预警标签', () => {
  $$('.tab').find(b => b.dataset.page === 'chemicals').click();
  ok($('#chemTable tbody').textContent.includes('预警'), '未标记预警');
});
t('删除含记录的化学品被拒绝并提示', () => {
  const delBtn = $$('#chemTable tbody [data-act="chem-del"]')[0];
  delBtn.click();
  ok($('#modalMask').classList.contains('show'), '未弹确认框');
  $('#modalOk').click();
  eq(Store.state.chemicals.length, 1, '不应被删除');
  ok(!$('#modalMask').classList.contains('show'), '弹窗应关闭');
});
t('删除记录后库存回冲', () => {
  $$('.tab').find(b => b.dataset.page === 'records').click();
  const before = Store.stockOf(Store.state.chemicals[0].id);
  const delBtn = $$('#recTable tbody [data-act="rec-del"]')[0];
  delBtn.click();
  $('#modalOk').click();
  const after = Store.stockOf(Store.state.chemicals[0].id);
  eq(after, before + 10, '库存未回冲');
});
t('删除后单号不复用', () => {
  const cid = Store.state.chemicals[0].id;
  const c2 = Store.addChemical({ name: '单号检查品', unit: 'kg', openingStock: 100 });
  const r = Store.addRecord({ date: U.today(), chemicalId: c2.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  Store.removeRecord(r.record.id);
  const r2 = Store.addRecord({ date: U.today(), chemicalId: c2.id, qty: 1, applicant: 'A', purpose: 'B', status: 'issued' });
  ok(r2.record.docNo !== r.record.docNo, '单号被复用');
});

/* ---------- 7. 搜索与筛选 ---------- */
console.log('\n[7] 搜索与筛选');
t('化学品搜索生效', () => {
  $$('.tab').find(b => b.dataset.page === 'chemicals').click();
  $('#chemSearch').value = '测试乙醇';
  $('#chemSearch').dispatchEvent(new window.Event('input'));
  eq($$('#chemTable tbody tr').length, 1);
});
t('搜索无结果显示空态', () => {
  $('#chemSearch').value = '不存在的品名';
  $('#chemSearch').dispatchEvent(new window.Event('input'));
  ok($('#chemTable tbody').textContent.includes('没有符合条件'), '未显示空态');
});
t('清空搜索恢复', () => {
  $('#chemSearch').value = '';
  $('#chemSearch').dispatchEvent(new window.Event('input'));
  ok($$('#chemTable tbody tr').length >= 1);
});
t('领用记录搜索生效', () => {
  $$('.tab').find(b => b.dataset.page === 'records').click();
  $('#recSearch').value = '不存在的关键字';
  $('#recSearch').dispatchEvent(new window.Event('input'));
  ok($$('#recTable tbody tr').length === 0 || $('#recTable tbody').textContent.includes('没有符合条件'), '搜索未生效');
  $('#recSearch').value = '';
  $('#recSearch').dispatchEvent(new window.Event('input'));
});
t('仅看预警复选框生效', () => {
  $$('.tab').find(b => b.dataset.page === 'chemicals').click();
  $('#chemOnlyAlert').checked = true;
  $('#chemOnlyAlert').dispatchEvent(new window.Event('change'));
  ok($$('#chemTable tbody tr').length >= 1, '预警筛选结果为空');
  $('#chemOnlyAlert').checked = false;
  $('#chemOnlyAlert').dispatchEvent(new window.Event('change'));
});

/* ---------- 8. 数据管理 ---------- */
console.log('\n[8] 数据管理');
t('统计信息渲染', () => {
  $$('.tab').find(b => b.dataset.page === 'data').click();
  ok($('#dataStats').textContent.includes('化学品档案'), '缺统计项');
  ok($('#dataStats').textContent.includes('领用记录'), '缺统计项');
});
t('导出 JSON 备份', () => {
  downloads.length = 0;
  const captured = captureBlob(() => $('#dataExportBtn').click());
  ok(downloads.length === 1, '未触发下载');
  ok(downloads[0].download.endsWith('.json'), '文件名异常');
  const data = JSON.parse(captured);
  ok(Array.isArray(data.chemicals) && Array.isArray(data.records), '备份结构错');
});
t('单位名称保存并进入报表抬头', () => {
  $('#orgName').value = '迈昆（苏州）电子科技有限公司';
  $('#orgName').dispatchEvent(new window.Event('change'));
  eq(Store.state.meta.orgName, '迈昆（苏州）电子科技有限公司');
  $$('.tab').find(b => b.dataset.page === 'report').click();
  ok($('#rpTitle').textContent.includes('迈昆'), '抬头未带单位名: ' + $('#rpTitle').textContent);
});
t('存储标志显示正常', () => {
  ok($('#storageFlag').textContent.includes('正常'), '存储标志: ' + $('#storageFlag').textContent);
});

/* ---------- 9. 持久化 ---------- */
console.log('\n[9] 持久化');
t('数据写入 localStorage', () => {
  const raw = window.localStorage.getItem(Store.KEY);
  ok(raw, 'localStorage 为空');
  const data = JSON.parse(raw);
  ok(Array.isArray(data.chemicals), '化学品未落盘');
  ok(data.meta.docSeq, 'docSeq 未落盘');
});
t('重新 load 后数据一致', () => {
  const before = Store.state.chemicals.length;
  Store.load();
  eq(Store.state.chemicals.length, before);
});

/* ---------- 结果 ---------- */
await runAsync();
console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
if (fail) {
  console.log('\n失败明细：');
  failures.forEach(f => console.log('  · ' + f));
  process.exit(1);
}
process.exit(0);
}

main().catch(e => {
  console.error('\n测试执行异常：', e);
  process.exit(1);
});

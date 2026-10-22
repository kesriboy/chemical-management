/* ===========================================================
   app.js — 界面逻辑
   =========================================================== */
(function (global) {
  'use strict';

  var $ = U.$, $$ = U.$$;

  var PAGE_SIZE = 15;
  var recPage = 1;

  /* =========================================================
     启动
     ========================================================= */
  function init() {
    Store.load();
    bindTabs();
    bindGlobal();
    renderAll();
    Store.onChange(function () { renderAll(); });
    updateStorageFlag();
  }

  function updateStorageFlag() {
    var f = $('#storageFlag');
    if (!f) return;
    if (Store.storageOk) {
      f.className = 'storage-flag ok';
      f.textContent = '本地存储正常';
      f.title = '数据保存在本机浏览器 localStorage';
    } else {
      f.className = 'storage-flag warn';
      f.textContent = '存储异常';
      f.title = 'localStorage 不可用或已满，修改可能无法保存';
    }
  }

  function renderAll() {
    renderDashboard();
    renderChemicals();
    renderRecords();
    renderReport();
    renderDataStats();
    updateStorageFlag();
  }

  /* =========================================================
     标签页
     ========================================================= */
  function bindTabs() {
    $('#tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      showPage(btn.dataset.page);
    });
    document.addEventListener('click', function (e) {
      var g = e.target.closest('[data-goto]');
      if (g) showPage(g.dataset.goto);
    });
  }

  function showPage(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.page === name); });
    $$('.page').forEach(function (p) { p.classList.toggle('active', p.id === 'page-' + name); });
    if (name === 'dashboard') renderDashboard();
    if (name === 'chemicals') renderChemicals();
    if (name === 'records') renderRecords();
    if (name === 'report') renderReport();
    if (name === 'data') renderDataStats();
  }

  /* =========================================================
     概览
     ========================================================= */
  function renderDashboard() {
    var st = Store.state;
    var sm = Store.stockMap();
    var low = Store.lowStockList();
    var today = U.today();
    var monthPrefix = U.month(today);

    var todayCount = st.records.filter(function (r) { return r.date === today; }).length;
    var monthCount = st.records.filter(function (r) { return U.month(r.date) === monthPrefix; }).length;
    var monthQty = U.round3(U.sumBy(st.records.filter(function (r) {
      return U.month(r.date) === monthPrefix;
    }), function (r) { return r.qty; }));

    var kpis = [
      { label: '在册化学品', value: st.chemicals.length, sub: '条档案记录', cls: '' },
      { label: '累计领用', value: st.records.length, sub: '本月 ' + monthCount + ' 次 / 合计 ' + U.fmtQty(monthQty), cls: 'ok' },
      { label: '今日领用', value: todayCount, sub: today, cls: '' },
      { label: '库存预警', value: low.length, sub: low.length ? '低于下限，需补货' : '库存状态正常', cls: low.length ? 'danger' : 'ok' }
    ];
    $('#kpiGrid').innerHTML = kpis.map(function (k) {
      return '<div class="kpi ' + k.cls + '"><div class="k-label">' + k.label + '</div>' +
             '<div class="k-value">' + k.value + '</div><div class="k-sub">' + U.esc(k.sub) + '</div></div>';
    }).join('');

    // 预警列表
    $('#alertCount').textContent = low.length ? low.length + ' 项低于下限' : '无';
    var alertBox = $('#alertList');
    if (!low.length) {
      alertBox.innerHTML = '<div class="empty">所有化学品库存均高于下限</div>';
    } else {
      alertBox.innerHTML = low.map(function (l) {
        var over = l.stock < 0;
        return '<div class="list-item"><div><div class="li-main">' + U.esc(l.chemical.name) +
          ' <span class="tag ' + (over ? 'danger' : 'warn') + '">' + (over ? '库存为负' : '低于下限') + '</span></div>' +
          '<div class="li-sub">' + U.esc(l.chemical.code || '无编号') + ' · ' + U.esc(l.chemical.category) +
          ' · 下限 ' + U.fmtQty(l.min) + ' ' + U.esc(l.chemical.unit) + '</div></div>' +
          '<div class="li-right"><div class="li-qty" style="color:' + (over ? 'var(--danger)' : 'var(--warn)') + '">' +
          U.fmtQty(l.stock) + '</div><div class="li-sub">' + U.esc(l.chemical.unit) + '</div></div></div>';
      }).join('');
    }

    // 最近领用
    var recent = Report.sortRecords(st.records).slice(0, 10);
    var recBox = $('#recentList');
    if (!recent.length) {
      recBox.innerHTML = '<div class="empty">暂无领用记录</div>';
    } else {
      recBox.innerHTML = recent.map(function (r) {
        return '<div class="list-item"><div><div class="li-main">' + U.esc(r.chemicalName) +
          ' <span class="tag info">' + U.fmtQty(r.qty) + ' ' + U.esc(r.unit) + '</span></div>' +
          '<div class="li-sub">' + U.esc(r.date) + ' · ' + U.esc(r.applicant) +
          (r.dept ? ' · ' + U.esc(r.dept) : '') + ' · ' + U.esc(r.purpose || '未填用途') + '</div></div>' +
          '<div class="li-right"><div class="li-sub">' + U.esc(r.docNo) + '</div></div></div>';
      }).join('');
    }

    // 近 30 天趋势
    renderTrend();
  }

  function renderTrend() {
    var days = 14;
    var today = U.today();
    var start = U.addDays(today, -(days - 1));
    var buckets = [];
    var map = {};
    for (var i = 0; i < days; i++) {
      var d = U.addDays(start, i);
      map[d] = 0;
      buckets.push(d);
    }
    Store.state.records.forEach(function (r) {
      if (map[r.date] !== undefined) map[r.date] += 1;
    });
    var max = Math.max.apply(null, buckets.map(function (d) { return map[d]; }).concat([1]));
    $('#trendChart').innerHTML = buckets.map(function (d) {
      var v = map[d];
      var h = Math.max(2, Math.round(v / max * 140));
      return '<div class="chart-col" title="' + d + '：' + v + ' 次">' +
             '<div class="chart-val">' + (v || '') + '</div>' +
             '<div class="chart-bar" style="height:' + h + 'px"></div>' +
             '<div class="chart-lab">' + d.slice(5) + '</div></div>';
    }).join('');
  }

  /* =========================================================
     化学品档案
     ========================================================= */
  function filteredChemicals() {
    var kw = ($('#chemSearch').value || '').trim().toLowerCase();
    var cat = $('#chemCategoryFilter').value;
    var hz = $('#chemHazardFilter').value;
    var onlyAlert = $('#chemOnlyAlert').checked;
    var sm = Store.stockMap();
    var low = {};
    Store.lowStockList().forEach(function (l) { low[l.chemical.id] = l; });

    return Store.state.chemicals.filter(function (c) {
      if (cat && c.category !== cat) return false;
      if (hz && c.hazard !== hz) return false;
      if (onlyAlert && !low[c.id]) return false;
      if (kw) {
        var hay = [c.name, c.code, c.cas, c.manufacturer, c.spec, c.location, c.category, c.hazard]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function renderChemicals() {
    // 过滤下拉
    var d = Store.dict();
    fillSelect('#chemCategoryFilter', d.categories, '全部类别', $('#chemCategoryFilter').value);
    fillSelect('#chemHazardFilter', d.hazards, '全部危险性', $('#chemHazardFilter').value);

    var list = filteredChemicals();
    var sm = Store.stockMap();
    var tbody = $('#chemTable').querySelector('tbody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="empty">没有符合条件的化学品</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (c) {
      var stock = sm[c.id] !== undefined ? sm[c.id] : 0;
      var low = stock < U.num(c.minStock, 0);
      var neg = stock < 0;
      var stockCls = neg ? 'color:var(--danger)' : (low ? 'color:var(--warn)' : '');
      var stockTag = neg ? '<span class="tag danger">负库存</span>'
        : (low ? '<span class="tag warn">预警</span>' : '');
      return '<tr>' +
        '<td class="mono">' + U.esc(c.code || '—') + '</td>' +
        '<td><strong>' + U.esc(c.name) + '</strong>' + (c.note ? ' <span class="muted" title="' + U.esc(c.note) + '">📝</span>' : '') + '</td>' +
        '<td class="mono">' + U.esc(c.cas || '—') + '</td>' +
        '<td><span class="tag">' + U.esc(c.category) + '</span></td>' +
        '<td>' + hazardTag(c.hazard) + '</td>' +
        '<td>' + U.esc(c.spec || '—') + '</td>' +
        '<td class="num" style="' + stockCls + '">' + U.fmtQty(stock) + ' ' + U.esc(c.unit) + ' ' + stockTag + '</td>' +
        '<td class="num muted">' + U.fmtQty(c.minStock) + '</td>' +
        '<td>' + U.esc(c.location || '—') + '</td>' +
        '<td>' + U.esc(c.manufacturer || '—') + '</td>' +
        '<td>' + U.esc(c.expiry || '—') + '</td>' +
        '<td><div class="actions">' +
          '<button class="link-btn" data-act="chem-edit" data-id="' + c.id + '">编辑</button>' +
          '<button class="link-btn" data-act="chem-use" data-id="' + c.id + '">领用</button>' +
          '<button class="link-btn del" data-act="chem-del" data-id="' + c.id + '">删除</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function hazardTag(h) {
    var map = { '剧毒': 'danger', '高毒': 'danger', '一般毒物': 'warn', '易燃': 'warn',
                '助燃': 'warn', '腐蚀': 'warn', '爆炸': 'danger', '无危害': 'mute' };
    return '<span class="tag ' + (map[h] || '') + '">' + U.esc(h || '—') + '</span>';
  }

  function fillSelect(sel, values, allLabel, keep) {
    var node = $(sel);
    if (!node) return;
    var cur = keep !== undefined ? keep : node.value;
    var html = '<option value="">' + allLabel + '</option>';
    values.forEach(function (v) {
      html += '<option value="' + U.esc(v) + '">' + U.esc(v) + '</option>';
    });
    node.innerHTML = html;
    if (cur && values.indexOf(cur) >= 0) node.value = cur;
  }

  /* ---- 化学品编辑弹窗 ---- */
  function openChemModal(id) {
    var c = id ? Store.getChemical(id) : null;
    var d = Store.dict();
    var isEdit = !!c;

    var form = U.el('div', { class: 'form-grid' });
    var fields = [
      { k: 'code', l: '编号', ph: '如 HX-0001' },
      { k: 'name', l: '化学品名称', req: true, ph: '如 无水乙醇' },
      { k: 'cas', l: 'CAS 号', ph: '如 64-17-5' },
      { k: 'category', l: '类别', type: 'select', opts: d.categories },
      { k: 'hazard', l: '危险性', type: 'select', opts: d.hazards },
      { k: 'spec', l: '规格/包装', ph: '如 500mL/瓶' },
      { k: 'unit', l: '单位', type: 'select', opts: d.units },
      { k: 'openingStock', l: '期初库存', type: 'number', step: '0.001', ph: '0',
        hint: '当前库存 = 期初库存 + 退库 − 发放' },
      { k: 'minStock', l: '库存下限', type: 'number', step: '0.001', ph: '0', hint: '低于此值触发预警' },
      { k: 'location', l: '存放位置', ph: '如 A区-01柜' },
      { k: 'manufacturer', l: '生产厂家', ph: '' },
      { k: 'expiry', l: '有效期至', type: 'date' },
      { k: 'note', l: '备注', type: 'textarea', full: true }
    ];

    fields.forEach(function (f) {
      var wrap = U.el('div', { class: 'form-item' + (f.full ? ' full' : '') });
      var val = c ? c[f.k] : (f.type === 'select' ? f.opts[0] : '');
      if (f.k === 'openingStock' || f.k === 'minStock') val = (c ? c[f.k] : 0);

      var input;
      if (f.type === 'select') {
        input = U.el('select', { class: 'input' });
        f.opts.forEach(function (o) {
          input.appendChild(U.el('option', { value: o, text: o }));
        });
        input.value = val || f.opts[0];
      } else if (f.type === 'textarea') {
        input = U.el('textarea', { class: 'input', placeholder: f.ph || '' });
        input.value = val || '';
      } else {
        input = U.el('input', { class: 'input', type: f.type || 'text', placeholder: f.ph || '' });
        if (f.step) input.step = f.step;
        input.value = val === null || val === undefined ? '' : val;
      }
      input.dataset.key = f.k;
      if (f.type !== 'select') input.dataset.t = f.type || 'text';

      wrap.appendChild(U.el('label', {}, [
        document.createTextNode(f.l),
        f.req ? U.el('span', { class: 'req', text: '*' }) : null
      ]));
      wrap.appendChild(input);
      if (f.hint) wrap.appendChild(U.el('div', { class: 'hint', text: f.hint }));
      form.appendChild(wrap);
    });

    U.modal({
      title: isEdit ? '编辑化学品' : '新增化学品',
      content: form,
      okText: isEdit ? '保存修改' : '确认新增',
      onOk: function () {
        var data = {};
        $$('input,select,textarea', form).forEach(function (i) {
          var k = i.dataset.key;
          if (!k) return;
          var t = i.dataset.t;
          data[k] = (t === 'number') ? U.num(i.value, 0) : i.value.trim();
        });
        if (!data.name) { U.toast('请填写化学品名称', 'err'); return; }
        if (!data.code) data.code = 'HX-' + U.pad(Store.state.chemicals.length + 1, 4);
        if (isEdit) {
          Store.updateChemical(id, data);
          U.toast('已保存修改', 'ok');
        } else {
          Store.addChemical(data);
          U.toast('已新增化学品：' + data.name, 'ok');
        }
        U.closeModal();
      }
    });
  }

  /* =========================================================
     领用记录
     ========================================================= */
  function filteredRecords() {
    var kw = ($('#recSearch').value || '').trim().toLowerCase();
    var from = $('#recFrom').value;
    var to = $('#recTo').value;
    var dept = $('#recDeptFilter').value;
    var status = $('#recStatusFilter').value;

    return Store.state.records.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (dept && r.dept !== dept) return false;
      if (status && Store.STATUS_TEXT[r.status] !== status) return false;
      if (kw) {
        var hay = [r.docNo, r.chemicalName, r.applicant, r.dept, r.purpose, r.operator, r.note]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  function renderRecords() {
    fillSelect('#recDeptFilter', Store.dict().departments, '全部部门', $('#recDeptFilter').value);

    var list = Report.sortRecords(filteredRecords());
    var totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (recPage > totalPages) recPage = totalPages;
    if (recPage < 1) recPage = 1;
    var slice = list.slice((recPage - 1) * PAGE_SIZE, recPage * PAGE_SIZE);

    var tbody = $('#recTable').querySelector('tbody');
    if (!slice.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty">没有符合条件的领用记录</td></tr>';
    } else {
      tbody.innerHTML = slice.map(function (r) {
        var c = Store.getChemical(r.chemicalId);
        var isReturn = r.status === 'returned';
        return '<tr>' +
          '<td class="mono">' + U.esc(r.docNo) + '</td>' +
          '<td class="mono">' + U.esc(r.date) + '</td>' +
          '<td><strong>' + U.esc(r.chemicalName) + '</strong>' +
            (c ? ' <span class="tag mute">' + U.esc(c.category) + '</span>' : ' <span class="tag danger">档案已删除</span>') + '</td>' +
          '<td class="num"' + (isReturn ? ' style="color:var(--ok)"' : '') + '>' + U.fmtQty(r.qty) + '</td>' +
          '<td>' + U.esc(r.unit) + '</td>' +
          '<td>' + U.esc(r.applicant) + '</td>' +
          '<td>' + U.esc(r.dept || '—') + '</td>' +
          '<td>' + U.esc(r.purpose || '—') + '</td>' +
          '<td>' + U.esc(r.operator || '—') + '</td>' +
          '<td><span class="tag ' + (isReturn ? 'ok' : 'info') + '">' + U.esc(Store.STATUS_TEXT[r.status]) + '</span></td>' +
          '<td><div class="actions">' +
            '<button class="link-btn" data-act="rec-edit" data-id="' + r.id + '">编辑</button>' +
            '<button class="link-btn del" data-act="rec-del" data-id="' + r.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('');
    }

    // 汇总条
    var qtyText = U.fmtQty(U.sumBy(list, function (r) { return r.qty; }));
    $('#recSummary').textContent = '共 ' + list.length + ' 条记录，合计数量 ' + qtyText +
      '（不同单位未合并计量）　·　当前第 ' + recPage + ' / ' + totalPages + ' 页';

    // 分页
    var pager = $('#recPager');
    var html = '<button data-p="prev"' + (recPage <= 1 ? ' disabled' : '') + '>‹</button>';
    var start = Math.max(1, recPage - 2), end = Math.min(totalPages, start + 4);
    start = Math.max(1, end - 4);
    for (var p = start; p <= end; p++) {
      html += '<button data-p="' + p + '" class="' + (p === recPage ? 'active' : '') + '">' + p + '</button>';
    }
    html += '<button data-p="next"' + (recPage >= totalPages ? ' disabled' : '') + '>›</button>';
    pager.innerHTML = html;
  }

  /* ---- 领用弹窗 ---- */
  function openRecModal(id, presetChemId) {
    var r = id ? Store.getRecord(id) : null;
    var d = Store.dict();
    var isEdit = !!r;

    if (!Store.state.chemicals.length) {
      U.toast('请先添加化学品档案', 'err');
      showPage('chemicals');
      return;
    }

    var form = U.el('div', { class: 'form-grid' });

    function addField(label, node, req, hint, full) {
      var wrap = U.el('div', { class: 'form-item' + (full ? ' full' : '') });
      wrap.appendChild(U.el('label', {}, [
        document.createTextNode(label),
        req ? U.el('span', { class: 'req', text: '*' }) : null
      ]));
      wrap.appendChild(node);
      if (hint) wrap.appendChild(U.el('div', { class: 'hint', text: hint }));
      form.appendChild(wrap);
      return node;
    }

    function mk(tag, attrs, value) {
      var n = U.el(tag, attrs);
      if (value !== undefined && value !== null) n.value = value;
      return n;
    }

    // 化学品
    var chemSel = mk('select', { class: 'input' });
    Store.state.chemicals.forEach(function (c) {
      var st = Store.stockOf(c.id);
      chemSel.appendChild(U.el('option', {
        value: c.id,
        text: c.name + '（库存 ' + U.fmtQty(st) + ' ' + c.unit + '）'
      }));
    });
    var selChemId = r ? r.chemicalId : (presetChemId || Store.state.chemicals[0].id);
    chemSel.value = selChemId;
    chemSel.dataset.key = 'chemicalId';
    addField('化学品', chemSel, true);

    var stockHint = U.el('div', { class: 'hint', id: 'stockHint' });
    var qtyInput = mk('input', { class: 'input', type: 'number', step: '0.001', min: '0', placeholder: '0' },
      r ? r.qty : '');
    qtyInput.dataset.key = 'qty';
    var qtyWrap = U.el('div', { class: 'form-item' });
    qtyWrap.appendChild(U.el('label', {}, [document.createTextNode('数量'), U.el('span', { class: 'req', text: '*' })]));
    qtyWrap.appendChild(qtyInput);
    form.appendChild(qtyWrap);

    var dateInput = mk('input', { class: 'input', type: 'date' }, r ? r.date : U.today());
    dateInput.dataset.key = 'date';
    addField('领用日期', dateInput, true);

    var appInput = mk('input', { class: 'input', placeholder: '领用人姓名' }, r ? r.applicant : '');
    appInput.dataset.key = 'applicant';
    addField('领用人', appInput, true);

    var deptInput = mk('input', { class: 'input', list: 'deptList', placeholder: '选择或输入部门' }, r ? r.dept : '');
    deptInput.dataset.key = 'dept';
    addField('部门', deptInput);

    var purposeInput = mk('input', { class: 'input', placeholder: '如 理化实验 / 工艺调试' }, r ? r.purpose : '');
    purposeInput.dataset.key = 'purpose';
    addField('用途', purposeInput, true);

    var opInput = mk('input', { class: 'input', placeholder: '发放人 / 保管员' }, r ? r.operator : '');
    opInput.dataset.key = 'operator';
    addField('发放人', opInput);

    var statusSel = mk('select', { class: 'input' }, r ? r.status : 'issued');
    statusSel.dataset.key = 'status';
    statusSel.appendChild(U.el('option', { value: 'issued', text: '已发放（扣减库存）' }));
    statusSel.appendChild(U.el('option', { value: 'returned', text: '已退库（返还库存）' }));
    addField('状态', statusSel, true, '退库记录用于冲销此前领用，不影响历史单号。');

    var noteInput = mk('textarea', { class: 'input', placeholder: '备注' }, r ? r.note : '');
    noteInput.dataset.key = 'note';
    addField('备注', noteInput, false, null, true);

    // 库存提示
    function refreshHint() {
      var cid = chemSel.value;
      var avail = Store.stockOf(cid);
      var status = statusSel.value;
      var c = Store.getChemical(cid);
      var cur = U.num(qtyInput.value, 0);
      if (status === 'returned') {
        stockHint.textContent = '当前库存 ' + U.fmtQty(avail) + ' ' + (c ? c.unit : '') + '，退库后为 ' + U.fmtQty(avail + cur) + ' ' + (c ? c.unit : '');
        stockHint.style.color = 'var(--ok)';
      } else {
        var after = avail - cur;
        stockHint.textContent = '当前库存 ' + U.fmtQty(avail) + ' ' + (c ? c.unit : '') +
          '，发放后剩余 ' + U.fmtQty(after) + ' ' + (c ? c.unit : '') +
          (after < 0 ? '　⚠ 库存不足' : '');
        stockHint.style.color = after < 0 ? 'var(--danger)' : 'var(--text-3)';
      }
    }
    chemSel.addEventListener('change', refreshHint);
    qtyInput.addEventListener('input', refreshHint);
    statusSel.addEventListener('change', refreshHint);
    qtyWrap.appendChild(stockHint);

    // datalist
    var dl = U.el('datalist', { id: 'deptList' });
    d.departments.forEach(function (x) { dl.appendChild(U.el('option', { value: x })); });
    form.appendChild(dl);

    refreshHint();

    U.modal({
      title: isEdit ? '编辑领用记录' : '新增领用记录',
      content: form,
      okText: isEdit ? '保存修改' : '确认领用',
      onOk: function () {
        var data = {};
        $$('input,select,textarea', form).forEach(function (i) {
          var k = i.dataset.key;
          if (!k) return;
          data[k] = (i.type === 'number') ? U.num(i.value, 0) : i.value.trim();
        });
        var res = isEdit ? Store.updateRecord(id, data) : Store.addRecord(data);
        if (!res.ok) { U.toast(res.msg, 'err'); return; }
        U.toast(isEdit ? '记录已更新，库存已同步调整' : '领用记录已保存：' + res.record.docNo, 'ok');
        U.closeModal();
      }
    });
  }

  /* =========================================================
     领用记录表
     ========================================================= */
  function currentFilter() {
    return {
      from: $('#rpFrom').value,
      to: $('#rpTo').value,
      dept: $('#rpDept').value,
      chemicalId: $('#rpChem').value,
      hazard: $('#rpHazard').value
    };
  }

  function renderReport() {
    var d = Store.dict();
    fillSelect('#rpDept', d.departments, '全部部门', $('#rpDept').value);
    fillSelect('#rpHazard', d.hazards, '全部危险性', $('#rpHazard').value);

    // 化学品下拉以 id 为 value，重建前先记住当前选中 id
    var chemSel = $('#rpChem');
    var keepId = chemSel.value;
    var html = '<option value="">全部化学品</option>';
    Store.state.chemicals.forEach(function (c) {
      html += '<option value="' + c.id + '">' + U.esc(c.name) + '</option>';
    });
    chemSel.innerHTML = html;
    if (keepId) {
      var still = Store.state.chemicals.some(function (c) { return c.id === keepId; });
      chemSel.value = still ? keepId : '';
    }

    var f = currentFilter();
    Report.currentFilter = f;
    var records = Report.filterRecords(f);
    var rows = Report.detailRows(records);

    $('#rpMeta').textContent = '共 ' + records.length + ' 条';
    $('#rpSubtitle').textContent = Report.buildMeta(records, f).split('　|　').join('　　');
    $('#rpTitle').textContent = (Store.state.meta.orgName ? Store.state.meta.orgName + '　' : '') + '化学品领用记录表';

    var tbody = $('#rpTable').querySelector('tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="13" class="empty">当前筛选条件下无记录</td></tr>';
    } else {
      tbody.innerHTML = rows.map(function (r) {
        return '<tr>' +
          '<td class="num">' + r.idx + '</td>' +
          '<td class="mono">' + U.esc(r.date) + '</td>' +
          '<td class="mono">' + U.esc(r.docNo) + '</td>' +
          '<td>' + U.esc(r.name) + '</td>' +
          '<td>' + U.esc(r.category) + '</td>' +
          '<td>' + hazardTag(r.hazard) + '</td>' +
          '<td>' + U.esc(r.spec) + '</td>' +
          '<td class="num">' + U.esc(r.qty) + '</td>' +
          '<td>' + U.esc(r.unit) + '</td>' +
          '<td>' + U.esc(r.applicant) + '</td>' +
          '<td>' + U.esc(r.dept) + '</td>' +
          '<td>' + U.esc(r.purpose) + '</td>' +
          '<td>' + U.esc(r.operator) + '</td>' +
        '</tr>';
      }).join('') +
      '<tr style="background:var(--surface-2);font-weight:600"><td colspan="7">合计 ' + rows.length + ' 条</td>' +
      '<td class="num">—</td><td>—</td><td colspan="3" class="muted" style="font-weight:400">不同单位数量不合并计量</td></tr>';
    }

    renderSummary(records);
  }

  function renderSummary(records) {
    var dim = Report.currentDim;
    var def = Report.SUM_DIMS[dim];
    var rows = Report.summarize(records, dim);

    var head = $('#rpSumHead');
    head.innerHTML = '<th style="width:200px">' + def.label + '</th>' +
      '<th style="width:180px">说明</th>' +
      '<th style="width:100px" class="num">领用次数</th>' +
      '<th style="width:220px" class="num">分单位数量</th>';

    var tbody = $('#rpSumTable').querySelector('tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty">无数据</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (s) {
      return '<tr>' +
        '<td><strong>' + U.esc(s.key) + '</strong></td>' +
        '<td class="muted">' + U.esc(s.sub || '—') + '</td>' +
        '<td class="num">' + s.count + '</td>' +
        '<td class="num">' + U.esc(s.unitText) + '</td>' +
      '</tr>';
    }).join('') +
    '<tr style="background:var(--surface-2);font-weight:600">' +
      '<td>合计</td><td class="muted" style="font-weight:400">' + rows.length + ' 个分组</td>' +
      '<td class="num">' + records.length + '</td>' +
      '<td class="num">—</td></tr>';
  }

  /* =========================================================
     数据管理
     ========================================================= */
  function renderDataStats() {
    var st = Store.state;
    var bytes = 0;
    try { bytes = new Blob([JSON.stringify(st)]).size; } catch (e) {}

    var org = $('#orgName');
    if (org && document.activeElement !== org) org.value = st.meta.orgName || '';

    $('#dataStats').innerHTML =
      '<div class="list-item"><div class="li-main">化学品档案</div><div class="li-right li-qty">' + st.chemicals.length + ' 条</div></div>' +
      '<div class="list-item"><div class="li-main">领用记录</div><div class="li-right li-qty">' + st.records.length + ' 条</div></div>' +
      '<div class="list-item"><div class="li-main">数据体积</div><div class="li-right li-qty">' + (bytes / 1024).toFixed(1) + ' KB</div></div>' +
      '<div class="list-item"><div class="li-main">最后更新</div><div class="li-right">' + U.esc(st.meta.updatedAt || '—') + '</div></div>' +
      '<div class="list-item"><div class="li-main">存储位置</div><div class="li-right">本机浏览器 localStorage</div></div>';
  }

  /* =========================================================
     事件绑定
     ========================================================= */
  function bindGlobal() {
    $('#todayText').textContent = U.today() + ' ' + ['周日','周一','周二','周三','周四','周五','周六'][new Date().getDay()];

    // 弹窗
    $('#modalClose').addEventListener('click', U.closeModal);
    $('#modalCancel').addEventListener('click', U.closeModal);
    $('#modalMask').addEventListener('click', function (e) {
      if (e.target === $('#modalMask')) U.closeModal();
    });
    $('#modalOk').addEventListener('click', function () {
      var mask = $('#modalMask');
      if (!mask.classList.contains('show')) return;
      // 注意：不可在此处清空 _onOk —— 校验失败时弹窗保持打开，
      // 再次点击必须能重试，否则用户会卡死在"点了没反应"。
      if (App._onOk) App._onOk();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') U.closeModal();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        var mask = $('#modalMask');
        if (mask.classList.contains('show') && App._onOk) App._onOk();
      }
    });

    // 化学品
    $('#chemAddBtn').addEventListener('click', function () { openChemModal(null); });
    $('#chemSearch').addEventListener('input', renderChemicals);
    $('#chemCategoryFilter').addEventListener('change', renderChemicals);
    $('#chemHazardFilter').addEventListener('change', renderChemicals);
    $('#chemOnlyAlert').addEventListener('change', renderChemicals);
    $('#chemExportBtn').addEventListener('click', exportChemLedger);

    $('#chemTable').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.dataset.id;
      if (btn.dataset.act === 'chem-edit') openChemModal(id);
      if (btn.dataset.act === 'chem-use') openRecModal(null, id);
      if (btn.dataset.act === 'chem-del') {
        var c = Store.getChemical(id);
        U.confirm('确认删除化学品「' + (c ? c.name : '') + '」？此操作不可撤销。', function () {
          var res = Store.removeChemical(id);
          if (!res.ok) { U.toast(res.msg, 'err'); return; }
          U.toast('已删除', 'ok');
        });
      }
    });

    // 领用记录
    $('#recAddBtn').addEventListener('click', function () { openRecModal(null); });
    $('#recSearch').addEventListener('input', function () { recPage = 1; renderRecords(); });
    $('#recFrom').addEventListener('change', function () { recPage = 1; renderRecords(); });
    $('#recTo').addEventListener('change', function () { recPage = 1; renderRecords(); });
    $('#recDeptFilter').addEventListener('change', function () { recPage = 1; renderRecords(); });
    $('#recStatusFilter').addEventListener('change', function () { recPage = 1; renderRecords(); });
    $('#recExportBtn').addEventListener('click', function () {
      var list = filteredRecords();
      if (!list.length) { U.toast('当前无记录可导出', 'err'); return; }
      Report.exportCsv(list, '领用记录明细_' + U.today() + '.csv');
      U.toast('已导出 CSV', 'ok');
    });

    $('#recTable').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.dataset.id;
      if (btn.dataset.act === 'rec-edit') openRecModal(id);
      if (btn.dataset.act === 'rec-del') {
        var r = Store.getRecord(id);
        U.confirm('确认删除领用记录「' + (r ? r.docNo : '') + '」？删除后库存将自动回冲。', function () {
          Store.removeRecord(id);
          U.toast('记录已删除，库存已回冲', 'ok');
        });
      }
    });

    $('#recPager').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-p]');
      if (!btn || btn.disabled) return;
      var p = btn.dataset.p;
      if (p === 'prev') recPage--;
      else if (p === 'next') recPage++;
      else recPage = parseInt(p, 10);
      renderRecords();
    });

    // 报表
    ['#rpFrom', '#rpTo', '#rpDept', '#rpChem', '#rpHazard'].forEach(function (sel) {
      $(sel).addEventListener('change', renderReport);
    });
    $('#rpResetBtn').addEventListener('click', function () {
      $('#rpFrom').value = ''; $('#rpTo').value = '';
      $('#rpDept').value = ''; $('#rpChem').value = ''; $('#rpHazard').value = '';
      renderReport();
    });
    $('#rpDimSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('.seg-btn');
      if (!btn) return;
      $$('#rpDimSeg .seg-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      Report.currentDim = btn.dataset.dim;
      renderSummary(Report.filterRecords(currentFilter()));
    });
    $('#rpCsvBtn').addEventListener('click', function () {
      var recs = Report.filterRecords(currentFilter());
      if (!recs.length) { U.toast('当前无记录可导出', 'err'); return; }
      Report.exportCsv(recs, '领用记录表_' + U.today() + '.csv');
      U.toast('已导出 CSV', 'ok');
    });
    $('#rpXlsBtn').addEventListener('click', function () {
      var recs = Report.filterRecords(currentFilter());
      if (!recs.length) { U.toast('当前无记录可导出', 'err'); return; }
      Report.exportExcel(recs, '领用记录表_' + U.today() + '.xls', Store.state.meta.orgName);
      U.toast('已导出 Excel（含明细与汇总表）', 'ok');
    });
    $('#rpPrintBtn').addEventListener('click', function () {
      var recs = Report.filterRecords(currentFilter());
      Report.print(recs, currentFilter(), Store.state.meta.orgName);
    });

    // 数据管理
    $('#dataExportBtn').addEventListener('click', function () {
      U.download('化学品管理系统备份_' + U.today() + '.json', Store.exportAll(), 'application/json', false);
      U.toast('已导出备份文件', 'ok');
    });
    $('#orgName').addEventListener('change', function (e) {
      Store.state.meta.orgName = e.target.value.trim();
      Store.commit();
      U.toast('单位名称已保存', 'ok');
    });
    $('#dataImportBtn').addEventListener('click', function () { $('#dataFile').click(); });
    $('#dataFile').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var txt = String(reader.result || '').replace(/^\uFEFF/, '');
        U.confirm('导入将按记录 ID 合并覆盖同 ID 数据，确定继续？', function () {
          var res = Store.importAll(txt, 'merge');
          U.toast(res.ok ? res.msg : res.msg, res.ok ? 'ok' : 'err');
        });
      };
      reader.readAsText(file, 'utf-8');
      e.target.value = '';
    });
    $('#dataSeedBtn').addEventListener('click', function () {
      U.confirm('载入示例数据会追加示例化学品与领用记录，确定继续？', function () {
        seedDemo();
        U.toast('示例数据已载入', 'ok');
      });
    });
    $('#dataClearRecBtn').addEventListener('click', function () {
      U.confirm('确认清空全部领用记录？库存将回到期初库存。此操作不可撤销。', function () {
        Store.clearRecords();
        U.toast('领用记录已清空', 'ok');
      });
    });
    $('#dataClearAllBtn').addEventListener('click', function () {
      U.confirm('确认清空全部数据（化学品 + 领用记录）？此操作不可撤销，建议先导出备份。', function () {
        Store.clearAll();
        U.toast('全部数据已清空', 'ok');
      });
    });
  }

  /* ---------------- 导出化学品台账 ---------------- */
  function exportChemLedger() {
    var list = filteredChemicals();
    if (!list.length) { U.toast('当前无记录可导出', 'err'); return; }
    var sm = Store.stockMap();
    var head = ['编号', '名称', 'CAS 号', '类别', '危险性', '规格/包装', '单位',
                '期初库存', '当前库存', '库存下限', '存放位置', '生产厂家', '有效期至', '备注'];
    var body = list.map(function (c) {
      return [c.code, c.name, c.cas, c.category, c.hazard, c.spec, c.unit,
              U.fmtQty(c.openingStock), U.fmtQty(sm[c.id] || 0), U.fmtQty(c.minStock),
              c.location, c.manufacturer, c.expiry, c.note];
    });
    U.download('化学品台账_' + U.today() + '.csv', U.toCsv([head].concat(body)), 'text/csv');
    U.toast('已导出化学品台账', 'ok');
  }

  /* ---------------- 示例数据 ---------------- */
  function seedDemo() {
    var samples = [
      { code: 'HX-0001', name: '无水乙醇', cas: '64-17-5', category: '危险化学品', hazard: '易燃', spec: '500mL/瓶', unit: '瓶', openingStock: 40, minStock: 10, location: 'A区-01柜', manufacturer: '国药集团', expiry: '2027-06-30' },
      { code: 'HX-0002', name: '浓硫酸', cas: '7664-93-9', category: '腐蚀品', hazard: '腐蚀', spec: '500mL/瓶', unit: '瓶', openingStock: 12, minStock: 4, location: '危化柜-02', manufacturer: '中石化', expiry: '2028-03-15' },
      { code: 'HX-0003', name: '氢氧化钠', cas: '1310-73-2', category: '一般化学品', hazard: '腐蚀', spec: '25kg/袋', unit: 'kg', openingStock: 200, minStock: 50, location: 'B区-03架', manufacturer: '天津碱厂', expiry: '2029-12-01' },
      { code: 'HX-0004', name: '丙酮', cas: '67-64-1', category: '易燃液体', hazard: '易燃', spec: '2.5kg/桶', unit: '桶', openingStock: 8, minStock: 3, location: '危化柜-01', manufacturer: '巴斯夫', expiry: '2026-11-20' },
      { code: 'HX-0005', name: '次氯酸钠溶液 10%', cas: '7681-52-9', category: '危险化学品', hazard: '腐蚀', spec: '1L/瓶', unit: '瓶', openingStock: 15, minStock: 5, location: '危化柜-02', manufacturer: '安道麦', expiry: '2026-08-10' },
      { code: 'HX-0006', name: '二甲苯', cas: '1330-20-7', category: '易燃液体', hazard: '易燃', spec: '2.5kg/桶', unit: '桶', openingStock: 6, minStock: 2, location: '危化柜-01', manufacturer: '金陵石化', expiry: '2027-04-18' },
      { code: 'HX-0007', name: '氯化钠', cas: '7647-14-5', category: '一般化学品', hazard: '无危害', spec: '25kg/袋', unit: 'kg', openingStock: 500, minStock: 100, location: 'B区-05架', manufacturer: '连云港碱厂', expiry: '2030-01-01' },
      { code: 'HX-0008', name: '硝酸（65%）', cas: '7697-37-2', category: '危险化学品', hazard: '腐蚀', spec: '500mL/瓶', unit: '瓶', openingStock: 9, minStock: 3, location: '危化柜-03', manufacturer: '中石化', expiry: '2026-12-05' }
    ];

    var idMap = {};
    samples.forEach(function (s) {
      var c = Store.addChemical(s);
      idMap[s.name] = c.id;
    });

    var people = [
      { applicant: '张伟', dept: '生产部', purpose: '工艺调试' },
      { applicant: '李娜', dept: '质量部', purpose: '理化检验' },
      { applicant: '王强', dept: '技术部', purpose: '实验分析' },
      { applicant: '刘洋', dept: '安全环保部', purpose: '废液预处理' },
      { applicant: '陈静', dept: '研发部', purpose: '小试实验' },
      { applicant: '赵磊', dept: '设备部', purpose: '设备清洗' }
    ];
    var today = new Date();
    var recs = [
      { n: '无水乙醇', qty: 6, d: 0, p: 0 },
      { n: '浓硫酸', qty: 2, d: 1, p: 1 },
      { n: '氢氧化钠', qty: 25, d: 1, p: 4 },
      { n: '丙酮', qty: 3, d: 2, p: 0 },
      { n: '无水乙醇', qty: 4, d: 3, p: 2 },
      { n: '次氯酸钠溶液 10%', qty: 5, d: 4, p: 3 },
      { n: '二甲苯', qty: 2, d: 5, p: 0 },
      { n: '氯化钠', qty: 50, d: 6, p: 1 },
      { n: '硝酸（65%）', qty: 1, d: 7, p: 2 },
      { n: '氢氧化钠', qty: 30, d: 9, p: 5 },
      { n: '无水乙醇', qty: 8, d: 12, p: 1 },
      { n: '丙酮', qty: 2, d: 14, p: 4 }
    ];

    recs.forEach(function (r) {
      var p = people[r.p];
      var d = new Date(today.getTime());
      d.setDate(d.getDate() - r.d);
      Store.addRecord({
        date: U.ymd(d),
        chemicalId: idMap[r.n],
        qty: r.qty,
        applicant: p.applicant,
        dept: p.dept,
        purpose: p.purpose,
        operator: '孙管理员',
        status: 'issued',
        note: ''
      });
    });
  }

  /* =========================================================
     暴露
     ========================================================= */
  var App = {
    _onOk: null,
    openChemModal: openChemModal,
    openRecModal: openRecModal,
    seedDemo: seedDemo
  };

  // 劫持 U.modal 以捕获 ok 回调
  var _modal = U.modal;
  U.modal = function (opts) {
    App._onOk = opts.onOk || null;
    return _modal(opts);
  };

  // 关闭弹窗时清空回调，避免下次打开时误触发上一个动作
  var _closeModal = U.closeModal;
  U.closeModal = function () {
    App._onOk = null;
    return _closeModal();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.App = App;
})(window);

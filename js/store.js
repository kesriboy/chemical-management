/* ===========================================================
   store.js — 数据层
   ------------------------------------------------------------
   设计要点：
   1. 领用记录是 append-only 流水账，库存不直接存储在化学品上，
      而是"物化视图"：
          当前库存 = 期初库存 + Σ(退库数量) − Σ(发放数量)
      这样任意编辑 / 删除记录都不会造成账实不符。
   2. 持久化使用 localStorage（键 chem_db_v1），带版本号与迁移入口。
   3. 所有写操作走 Store.commit()，统一落盘 + 广播 change 事件。
   =========================================================== */
(function (global) {
  'use strict';

  var KEY = 'chem_db_v1';
  var SCHEMA_VERSION = 1;

  var CATEGORIES = [
    '危险化学品', '一般化学品', '易制毒化学品', '易制爆化学品',
    '剧毒品', '腐蚀品', '氧化剂', '易燃液体', '压缩气体', '粉尘'
  ];

  var HAZARDS = ['剧毒', '高毒', '一般毒物', '易燃', '助燃', '腐蚀', '爆炸', '无危害'];

  var STATUS_TEXT = { issued: '已发放', returned: '已退库' };

  var DEPARTMENTS = [
    '生产部', '技术部', '质量部', '安全环保部', '设备部', '仓储部', '研发部', '行政部'
  ];

  var UNITS = ['kg', 'g', 'L', 'mL', '瓶', '桶', '罐', '箱', '包', '支', '件'];

  /* ---------------- 状态 ---------------- */
  var state = {
    version: SCHEMA_VERSION,
    chemicals: [],
    records: [],
    meta: { seq: 0, orgName: '', updatedAt: '', docSeq: {} }
  };

  var listeners = [];
  var storageOk = true;

  /* ---------------- 持久化 ---------------- */
  function readRaw() {
    try {
      var txt = localStorage.getItem(KEY);
      if (!txt) return null;
      return JSON.parse(txt);
    } catch (e) {
      console.warn('[store] 读取失败', e);
      return null;
    }
  }

  function persist() {
    state.meta.updatedAt = U.nowStamp();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      storageOk = true;
    } catch (e) {
      storageOk = false;
      console.error('[store] 写入失败', e);
      U.toast('本地存储写入失败，请检查浏览器存储权限', 'err');
    }
  }

  function load() {
    var raw = readRaw();
    if (!raw) { persist(); return; }
    state.version = raw.version || SCHEMA_VERSION;
    state.chemicals = Array.isArray(raw.chemicals) ? raw.chemicals : [];
    state.records   = Array.isArray(raw.records)   ? raw.records   : [];
    state.meta      = raw.meta || { seq: 0, orgName: '', updatedAt: '', docSeq: {} };
    if (typeof state.meta.seq !== 'number') state.meta.seq = 0;
    if (!state.meta.docSeq || typeof state.meta.docSeq !== 'object') state.meta.docSeq = {};
    normalize();
  }

  /** 补齐历史数据缺失字段，避免 undefined 参与运算 */
  function normalize() {
    state.chemicals.forEach(function (c) {
      c.id         = c.id || genId('C');
      c.code       = c.code || '';
      c.name       = c.name || '未命名';
      c.cas        = c.cas || '';
      c.category   = c.category || '一般化学品';
      c.hazard     = c.hazard || '无危害';
      c.spec       = c.spec || '';
      c.unit       = c.unit || 'kg';
      c.openingStock = U.num(c.openingStock, 0);
      c.minStock   = U.num(c.minStock, 0);
      c.location   = c.location || '';
      c.manufacturer = c.manufacturer || '';
      c.expiry     = c.expiry || '';
      c.note       = c.note || '';
      c.createdAt  = c.createdAt || U.nowStamp();
    });
    state.records.forEach(function (r) {
      r.id      = r.id || genId('R');
      r.date    = r.date || U.today();
      r.qty     = U.num(r.qty, 0);
      r.status  = (r.status === 'returned') ? 'returned' : 'issued';
      r.applicant = r.applicant || '';
      r.dept    = r.dept || '';
      r.purpose = r.purpose || '';
      r.operator = r.operator || '';
      r.note    = r.note || '';
      r.createdAt = r.createdAt || U.nowStamp();
    });
  }

  /* ---------------- ID / 单号 ---------------- */
  function genId(prefix) {
    state.meta.seq += 1;
    return prefix + Date.now().toString(36).toUpperCase() +
           state.meta.seq.toString(36).toUpperCase().padStart(3, '0');
  }

  /** 生成领用单号：LY + 日期 + 4 位当日序号
   *  单号只增不复：即使记录被删除，已发出的号也不会被复用（审计要求）。
   *  计数器持久化在 meta.docSeq，避免删记录后单号回退重复。 */
  function nextSerialNo(dateStr) {
    var day = (dateStr || U.today()).replace(/-/g, '');
    if (!state.meta.docSeq) state.meta.docSeq = {};

    var n = U.num(state.meta.docSeq[day], 0);

    // 计数器落后于实际数据时（如导入备份后），向后扫描补齐
    var guard = 0;
    do {
      n += 1;
      var no = U.serial('LY', day, n);
      guard += 1;
      var exists = state.records.some(function (r) { return r.docNo === no; });
      if (!exists) {
        state.meta.docSeq[day] = n;
        return no;
      }
    } while (guard < 9999);

    state.meta.docSeq[day] = n;
    return U.serial('LY', day, n);
  }

  /* ---------------- 库存计算 ---------------- */
  /** 计算某化学品的当前库存 */
  function stockOf(chemId) {
    var chem = getChemical(chemId);
    if (!chem) return 0;
    var delta = 0;
    state.records.forEach(function (r) {
      if (r.chemicalId !== chemId) return;
      if (r.status === 'returned') delta += U.num(r.qty, 0);
      else delta -= U.num(r.qty, 0);
    });
    return U.round3(U.num(chem.openingStock, 0) + delta);
  }

  /** 全量库存快照：{ chemId: stock } */
  function stockMap() {
    var map = {};
    state.chemicals.forEach(function (c) { map[c.id] = U.num(c.openingStock, 0); });
    state.records.forEach(function (r) {
      if (!map[r.chemicalId] && map[r.chemicalId] !== 0) return;
      if (r.status === 'returned') map[r.chemicalId] += U.num(r.qty, 0);
      else map[r.chemicalId] -= U.num(r.qty, 0);
    });
    Object.keys(map).forEach(function (k) { map[k] = U.round3(map[k]); });
    return map;
  }

  /** 低于下限的化学品 */
  function lowStockList() {
    var sm = stockMap();
    return state.chemicals.filter(function (c) {
      return sm[c.id] < U.num(c.minStock, 0);
    }).map(function (c) {
      return { chemical: c, stock: sm[c.id], min: U.num(c.minStock, 0) };
    }).sort(function (a, b) { return a.stock - b.stock; });
  }

  /**
   * 可发放量校验：编辑场景需排除该记录自身已占用的量
   * @param {string} chemId
   * @param {number} qty      计划发放数量
   * @param {string} excludeId 编辑时排除的记录 id
   */
  function canIssue(chemId, qty, excludeId) {
    var chem = getChemical(chemId);
    if (!chem) return { ok: false, msg: '化学品不存在' };
    var avail = stockOf(chemId);
    if (excludeId) {
      var self = getRecord(excludeId);
      if (self && self.chemicalId === chemId && self.status === 'issued') {
        avail = U.round3(avail + U.num(self.qty, 0));
      }
    }
    if (U.num(qty, 0) > avail) {
      return { ok: false, msg: '库存不足：当前可用 ' + U.fmtQty(avail) + ' ' + chem.unit + '，本次需要 ' + U.fmtQty(qty) + ' ' + chem.unit };
    }
    return { ok: true, avail: avail };
  }

  /* ---------------- CRUD：化学品 ---------------- */
  function getChemical(id) {
    for (var i = 0; i < state.chemicals.length; i++) {
      if (state.chemicals[i].id === id) return state.chemicals[i];
    }
    return null;
  }

  function addChemical(data) {
    var c = Object.assign({
      id: genId('C'),
      code: '', name: '', cas: '', category: '一般化学品', hazard: '无危害',
      spec: '', unit: 'kg', openingStock: 0, minStock: 0,
      location: '', manufacturer: '', expiry: '', note: '',
      createdAt: U.nowStamp()
    }, data);
    c.openingStock = U.num(c.openingStock, 0);
    c.minStock = U.num(c.minStock, 0);
    state.chemicals.push(c);
    commit();
    return c;
  }

  function updateChemical(id, data) {
    var c = getChemical(id);
    if (!c) return null;
    Object.keys(data).forEach(function (k) { c[k] = data[k]; });
    c.openingStock = U.num(c.openingStock, 0);
    c.minStock = U.num(c.minStock, 0);
    commit();
    return c;
  }

  function removeChemical(id) {
    var used = state.records.some(function (r) { return r.chemicalId === id; });
    if (used) return { ok: false, msg: '该化学品存在领用记录，不能删除。可将库存下限设为 0 或改为停用。' };
    state.chemicals = state.chemicals.filter(function (c) { return c.id !== id; });
    commit();
    return { ok: true };
  }

  /* ---------------- CRUD：领用记录 ---------------- */
  function getRecord(id) {
    for (var i = 0; i < state.records.length; i++) {
      if (state.records[i].id === id) return state.records[i];
    }
    return null;
  }

  function addRecord(data) {
    var chem = getChemical(data.chemicalId);
    if (!chem) return { ok: false, msg: '请选择有效的化学品' };
    var qty = U.num(data.qty, 0);
    if (qty <= 0) return { ok: false, msg: '领用数量必须大于 0' };
    if (!data.applicant) return { ok: false, msg: '请填写领用人' };
    if (!data.purpose) return { ok: false, msg: '请填写用途' };

    var status = data.status === 'returned' ? 'returned' : 'issued';
    if (status === 'issued') {
      var chk = canIssue(chem.id, qty, null);
      if (!chk.ok) return { ok: false, msg: chk.msg };
    }

    var r = Object.assign({
      id: genId('R'),
      docNo: nextSerialNo(data.date),
      date: data.date || U.today(),
      chemicalId: chem.id,
      chemicalName: chem.name,
      unit: chem.unit,
      qty: qty,
      applicant: data.applicant || '',
      dept: data.dept || '',
      purpose: data.purpose || '',
      operator: data.operator || '',
      status: status,
      note: data.note || '',
      createdAt: U.nowStamp()
    }, {});
    state.records.push(r);
    commit();
    return { ok: true, record: r };
  }

  function updateRecord(id, data) {
    var r = getRecord(id);
    if (!r) return { ok: false, msg: '记录不存在' };
    var chem = getChemical(data.chemicalId || r.chemicalId);
    if (!chem) return { ok: false, msg: '请选择有效的化学品' };
    var qty = U.num(data.qty, 0);
    if (qty <= 0) return { ok: false, msg: '领用数量必须大于 0' };
    if (!data.applicant) return { ok: false, msg: '请填写领用人' };
    if (!data.purpose) return { ok: false, msg: '请填写用途' };

    var status = data.status === 'returned' ? 'returned' : 'issued';
    if (status === 'issued') {
      var chk = canIssue(chem.id, qty, id);
      if (!chk.ok) return { ok: false, msg: chk.msg };
    }

    Object.assign(r, {
      date: data.date || r.date,
      chemicalId: chem.id,
      chemicalName: chem.name,
      unit: chem.unit,
      qty: qty,
      applicant: data.applicant,
      dept: data.dept || '',
      purpose: data.purpose,
      operator: data.operator || '',
      status: status,
      note: data.note || ''
    });
    commit();
    return { ok: true, record: r };
  }

  function removeRecord(id) {
    state.records = state.records.filter(function (r) { return r.id !== id; });
    commit();
    return { ok: true };
  }

  /* ---------------- 提交 / 事件 ---------------- */
  function commit() {
    persist();
    listeners.forEach(function (fn) {
      try { fn(); } catch (e) { console.error(e); }
    });
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function exportAll() {
    return JSON.stringify({
      version: SCHEMA_VERSION,
      exportedAt: U.nowStamp(),
      chemicals: state.chemicals,
      records: state.records,
      meta: state.meta
    }, null, 2);
  }

  function importAll(json, mode) {
    var data;
    try { data = JSON.parse(json); } catch (e) { return { ok: false, msg: '文件不是有效的 JSON' }; }
    if (!data || !Array.isArray(data.chemicals) || !Array.isArray(data.records)) {
      return { ok: false, msg: '文件结构不符合备份格式' };
    }
    if (mode === 'replace') {
      state.chemicals = data.chemicals;
      state.records = data.records;
      state.meta = data.meta || { seq: 0, orgName: '', updatedAt: '', docSeq: {} };
      if (!state.meta.docSeq || typeof state.meta.docSeq !== 'object') state.meta.docSeq = {};
    } else {
      // merge：按 id 去重覆盖
      data.chemicals.forEach(function (c) {
        var exist = getChemical(c.id);
        if (exist) Object.assign(exist, c); else state.chemicals.push(c);
      });
      data.records.forEach(function (r) {
        var exist = getRecord(r.id);
        if (exist) Object.assign(exist, r); else state.records.push(r);
      });
    }
    normalize();
    commit();
    return { ok: true, msg: '导入成功：' + data.chemicals.length + ' 条化学品，' + data.records.length + ' 条领用记录' };
  }

  function clearRecords() {
    state.records = [];
    commit();
  }

  function clearAll() {
    state.chemicals = [];
    state.records = [];
    state.meta = { seq: 0, orgName: state.meta.orgName, updatedAt: '', docSeq: {} };
    commit();
  }

  /* ---------------- 字典 ---------------- */
  function dict() {
    var cats = U.uniq(state.chemicals.map(function (c) { return c.category; }).concat(CATEGORIES));
    var hz = U.uniq(state.chemicals.map(function (c) { return c.hazard; }).concat(HAZARDS));
    var depts = U.uniq(state.records.map(function (r) { return r.dept; })
      .concat(state.chemicals.map(function (c) { return c.dept; }))
      .concat(DEPARTMENTS).filter(Boolean));
    return { categories: cats, hazards: hz, departments: depts, units: UNITS, statuses: STATUS_TEXT };
  }

  global.Store = {
    KEY: KEY,
    CATEGORIES: CATEGORIES,
    HAZARDS: HAZARDS,
    DEPARTMENTS: DEPARTMENTS,
    UNITS: UNITS,
    STATUS_TEXT: STATUS_TEXT,
    get state() { return state; },
    get storageOk() { return storageOk; },
    load: load,
    commit: commit,
    onChange: onChange,
    dict: dict,
    getChemical: getChemical,
    addChemical: addChemical,
    updateChemical: updateChemical,
    removeChemical: removeChemical,
    getRecord: getRecord,
    addRecord: addRecord,
    updateRecord: updateRecord,
    removeRecord: removeRecord,
    stockOf: stockOf,
    stockMap: stockMap,
    lowStockList: lowStockList,
    canIssue: canIssue,
    nextSerialNo: nextSerialNo,
    exportAll: exportAll,
    importAll: importAll,
    clearRecords: clearRecords,
    clearAll: clearAll,
    genId: genId
  };
})(window);

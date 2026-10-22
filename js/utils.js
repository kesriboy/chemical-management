/* ===========================================================
   utils.js — 通用工具函数
   =========================================================== */
(function (global) {
  'use strict';

  var U = {};

  /* ---------- DOM ---------- */
  U.$  = function (sel, root) { return (root || document).querySelector(sel); };
  U.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  U.el = function (tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== '') node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  /* ---------- 转义 ---------- */
  U.esc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- 数字 ---------- */
  U.num = function (v, def) {
    var n = parseFloat(v);
    return isNaN(n) ? (def === undefined ? 0 : def) : n;
  };

  /** 数值格式化：最多 3 位小数，去掉尾随 0 */
  U.fmtQty = function (v) {
    var n = U.num(v, 0);
    var s = (Math.round(n * 1000) / 1000).toString();
    return s;
  };

  U.round3 = function (v) { return Math.round(U.num(v, 0) * 1000) / 1000; };

  /* ---------- 日期 ---------- */
  U.today = function () {
    var d = new Date();
    return U.ymd(d);
  };

  U.ymd = function (d) {
    var y = d.getFullYear(),
        m = d.getMonth() + 1,
        dd = d.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  };

  U.month = function (ymd) { return (ymd || '').slice(0, 7); };

  U.nowStamp = function () {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
           ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };

  /** 两个 YYYY-MM-DD 相差天数 (b - a) */
  U.dayDiff = function (a, b) {
    var t1 = Date.parse(a + 'T00:00:00'),
        t2 = Date.parse(b + 'T00:00:00');
    if (isNaN(t1) || isNaN(t2)) return 0;
    return Math.round((t2 - t1) / 86400000);
  };

  U.addDays = function (ymd, n) {
    var d = new Date(ymd + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return U.ymd(d);
  };

  /* ---------- 数组 / 集合 ---------- */
  U.uniq = function (arr) {
    var seen = {}, out = [];
    arr.forEach(function (v) {
      var k = String(v);
      if (!seen[k]) { seen[k] = 1; out.push(v); }
    });
    return out;
  };

  U.groupBy = function (arr, keyFn) {
    var map = {};
    arr.forEach(function (item) {
      var k = keyFn(item);
      if (!map[k]) map[k] = [];
      map[k].push(item);
    });
    return map;
  };

  U.sumBy = function (arr, valFn) {
    return arr.reduce(function (acc, it) { return acc + U.num(valFn(it), 0); }, 0);
  };

  U.sortBy = function (arr, keyFn, desc) {
    var copy = arr.slice();
    copy.sort(function (a, b) {
      var ka = keyFn(a), kb = keyFn(b);
      if (ka === kb) return 0;
      if (ka === null || ka === undefined || ka === '') return 1;
      if (kb === null || kb === undefined || kb === '') return -1;
      return (ka > kb ? 1 : -1) * (desc ? -1 : 1);
    });
    return copy;
  };

  /* ---------- 字符串 ---------- */
  U.pad = function (n, len) {
    var s = String(n);
    while (s.length < len) s = '0' + s;
    return s;
  };

  /** 生成流水号前缀 + 4 位序号，如 LY20261022-0007 */
  U.serial = function (prefix, dateStr, seq) {
    return prefix + dateStr.replace(/-/g, '') + '-' + U.pad(seq, 4);
  };

  /* ---------- 文件下载 ---------- */
  /**
   * 触发文件下载
   * @param {string} filename
   * @param {string} content
   * @param {string} mime
   * @param {boolean} bom 是否添加 UTF-8 BOM（Excel 打开 CSV 必需；JSON 必须为 false，否则 JSON.parse 失败）
   */
  U.download = function (filename, content, mime, bom) {
    var text = (bom === false) ? content : ('\uFEFF' + content);
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  };

  /** CSV 单元格转义 */
  U.csvCell = function (v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  U.toCsv = function (rows) {
    return rows.map(function (r) { return r.map(U.csvCell).join(','); }).join('\r\n');
  };

  /* ---------- Toast ---------- */
  U.toast = function (msg, type) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(U._toastTimer);
    U._toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  };

  /* ---------- 弹窗 ---------- */
  U.modal = function (opts) {
    var mask = document.getElementById('modalMask');
    document.getElementById('modalTitle').textContent = opts.title || '';
    var body = document.getElementById('modalBody');
    body.innerHTML = '';
    body.appendChild(opts.content);
    document.getElementById('modalOk').textContent = opts.okText || '保存';
    document.getElementById('modalOk').style.display = opts.hideOk ? 'none' : '';
    document.getElementById('modalCancel').textContent = opts.cancelText || '取消';
    mask.classList.add('show');
    return body;
  };

  U.closeModal = function () {
    var mask = document.getElementById('modalMask');
    if (mask) mask.classList.remove('show');
  };

  /**
   * 确认框：点击"确定"后先关闭弹窗，再执行回调。
   * 统一在此处关闭，避免各调用方遗漏或行为不一致。
   */
  U.confirm = function (msg, onOk) {
    var box = U.el('div', { class: 'confirm-box' }, [
      U.el('p', { text: msg, style: 'margin:0 0 16px;font-size:13.5px;line-height:1.7;color:var(--text-2)' })
    ]);
    U.modal({
      title: '请确认',
      content: box,
      okText: '确定',
      onOk: function () {
        U.closeModal();
        if (onOk) onOk();
      }
    });
  };

  global.U = U;
})(window);

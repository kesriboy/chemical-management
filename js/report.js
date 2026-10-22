/* ===========================================================
   report.js — 领用记录表：筛选 / 汇总 / 导出 / 打印
   ------------------------------------------------------------
   记录表输出采用受控表单格式（参考《化学品管理程序》附录三）：
   - 页眉：化学品管理程序 | 文件编号：MFG20CN-MK 版本号：01
   - 标题：附录三：化学品领用记录
   - 每种化学品一个表块：第一行 物料号/物品名称/危险分类，
     第二行列头 日期/当前库存/领用数量/结余库存/用途/领料人
   - 页脚：公司名/质量管理系统 | 机密/专有 | 受控文件 第X页共Y页
   - 结余库存为 running balance：以期初库存为起点按日期升序累计，
     先对全部记录计算、再按筛选区间截取展示，保证任意筛选下结余准确。
   导出格式：
   - Excel (.xls)：SpreadsheetML 2003，Excel / WPS 原生打开，无需联网
   - CSV：UTF-8 BOM，Excel 直接双击不乱码
   - 打印：构造独立 printRoot，走 @media print 样式，A4 纵向
   =========================================================== */
(function (global) {
  'use strict';

  var R = {};

  /* ---------------- 筛选 ---------------- */
  /**
   * @param {object} f  { from, to, dept, chemicalId, hazard }
   * @returns {Array} 命中记录
   */
  R.filterRecords = function (f) {
    f = f || {};
    return Store.state.records.filter(function (r) {
      if (f.from && r.date < f.from) return false;
      if (f.to && r.date > f.to) return false;
      if (f.dept && r.dept !== f.dept) return false;
      if (f.chemicalId && r.chemicalId !== f.chemicalId) return false;
      if (f.hazard) {
        var c = Store.getChemical(r.chemicalId);
        if (!c || c.hazard !== f.hazard) return false;
      }
      return true;
    });
  };

  /** 记录按日期倒序（同日按创建时间倒序） */
  R.sortRecords = function (records) {
    return records.slice().sort(function (a, b) {
      if (a.date === b.date) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }
      return a.date < b.date ? 1 : -1;
    });
  };

  /* ---------------- 明细行（报表专用，冗余取快照字段） ---------------- */
  R.detailRows = function (records) {
    var sorted = R.sortRecords(records);
    return sorted.map(function (r, i) {
      var c = Store.getChemical(r.chemicalId);
      return {
        idx: i + 1,
        date: r.date,
        docNo: r.docNo,
        name: r.chemicalName || (c ? c.name : '（已删除）'),
        category: c ? c.category : '—',
        hazard: c ? c.hazard : '—',
        spec: c ? c.spec : '—',
        qty: U.fmtQty(r.qty),
        unit: r.unit || (c ? c.unit : ''),
        applicant: r.applicant,
        dept: r.dept,
        purpose: r.purpose,
        operator: r.operator,
        status: Store.STATUS_TEXT[r.status] || r.status,
        note: r.note
      };
    });
  };

  /* ---------------- 台账（附录三格式） ----------------
   * 每种化学品一个分块。结余库存为 running balance：
   * 以期初库存为起点，按日期升序（同日按录入顺序）累计发放/退库。
   * 先对全部记录计算结余，再按筛选条件截取展示区间——
   * 这样无论筛选哪段日期，结余库存都基于完整流水，不会失真。
   */
  R.buildLedger = function (f) {
    f = f || {};
    var byChem = {};
    Store.state.records.forEach(function (r) {
      (byChem[r.chemicalId] = byChem[r.chemicalId] || []).push(r);
    });
    var blocks = [];
    Store.state.chemicals.forEach(function (c) {
      if (f.chemicalId && c.id !== f.chemicalId) return;
      var recs = byChem[c.id];
      if (!recs || !recs.length) return;
      recs = recs.slice().sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return String(a.createdAt || a.docNo || '').localeCompare(String(b.createdAt || b.docNo || ''));
      });
      var balance = U.num(c.openingStock, 0);
      var all = recs.map(function (r) {
        var before = balance;
        var qty = U.num(r.qty, 0);
        var after = r.status === 'returned' ? U.round3(before + qty) : U.round3(before - qty);
        balance = after;
        return {
          id: r.id,
          date: r.date,
          qty: qty,
          before: before,
          after: after,
          returned: r.status === 'returned',
          purpose: (r.status === 'returned' ? '退库 · ' : '') + (r.purpose || ''),
          applicant: r.applicant || '',
          raw: r
        };
      });
      var shown = all.filter(function (row) {
        var r = row.raw;
        if (f.from && r.date < f.from) return false;
        if (f.to && r.date > f.to) return false;
        if (f.dept && (r.dept || '') !== f.dept) return false;
        if (f.hazard && c.hazard !== f.hazard) return false;
        return true;
      });
      blocks.push({
        chemical: c,
        rows: shown,
        totalRows: all.length,
        finalBalance: balance,
        stockOk: U.round3(balance) === U.round3(U.num(c.openingStock, 0) +
          all.filter(function (x) { return x.returned; }).reduce(function (s, x) { return s + x.qty; }, 0) -
          all.filter(function (x) { return !x.returned; }).reduce(function (s, x) { return s + x.qty; }, 0))
      });
    });
    return blocks;
  };

  /** 受控表单常量（可在 meta.formNo / meta.formVer 中覆盖） */
  R.FORM_NO = function () { return Store.state.meta.formNo || 'MFG20CN-MK'; };
  R.FORM_VER = function () { return Store.state.meta.formVer || '01'; };

  /** 列头（附录三格式，6 列） */
  R.LEDGER_HEAD = ['日期', '当前库存', '领用数量', '结余库存', '用途', '领料人'];

  /** 领用数量显示：退库为负数，与结余的加减关系一目了然 */
  function qtyText(row) {
    return U.fmtQty(row.returned ? -row.qty : row.qty);
  }

  /**
   * 生成单个化学品表块的 HTML（预览与打印共用骨架）。
   * @param {object} block  buildLedger 返回的分块
   * @param {object} opts   { print: 是否打印版（含填充空行）, padTo: 打印最少行数 }
   */
  R.ledgerBlockHtml = function (block, opts) {
    opts = opts || {};
    var c = block.chemical;
    var h = [];
    h.push('<table class="p-table ledger-table"><tbody>');
    // 第一行：物料号 / 物品名称 / 危险分类
    h.push('<tr class="p-info">' +
      '<td class="p-label">物料号</td><td>' + U.esc(c.code || '—') + '</td>' +
      '<td class="p-label">物品名称</td><td>' + U.esc(c.name) + '</td>' +
      '<td class="p-label">危险分类</td><td>' + U.esc(c.hazard || '—') + '</td></tr>');
    // 第二行：列头
    h.push('<tr class="p-headrow">');
    R.LEDGER_HEAD.forEach(function (t) { h.push('<th>' + t + '</th>'); });
    h.push('</tr>');
    // 数据行
    if (!block.rows.length) {
      h.push('<tr><td colspan="6" class="p-empty">（本区间无领用记录）</td></tr>');
    } else {
      block.rows.forEach(function (row) {
        h.push('<tr>' +
          '<td class="p-date">' + U.esc(row.date) + '</td>' +
          '<td class="p-num">' + U.fmtQty(row.before) + '</td>' +
          '<td class="p-num">' + qtyText(row) + '</td>' +
          '<td class="p-num">' + U.fmtQty(row.after) + '</td>' +
          '<td>' + U.esc(row.purpose) + '</td>' +
          '<td>' + U.esc(row.applicant) + '</td></tr>');
      });
    }
    // 打印版补空行，还原纸质表单的留白行
    if (opts.print) {
      var padTo = opts.padTo || 14;
      for (var i = block.rows.length; i < padTo; i++) {
        h.push('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td></tr>');
      }
    }
    h.push('</tbody></table>');
    return h.join('');
  };


  /* ---------------- 汇总 ---------------- */
  R.SUM_DIMS = {
    chemical:  { label: '化学品名称', get: function (r) { return r.chemicalName; }, sub: function (r) { var c = Store.getChemical(r.chemicalId); return c ? (c.category + ' / ' + c.hazard) : '—'; } },
    dept:      { label: '部门',       get: function (r) { return r.dept || '未填写'; }, sub: function (r) { return ''; } },
    applicant: { label: '领用人',     get: function (r) { return r.applicant || '未填写'; }, sub: function (r) { return r.dept || ''; } },
    purpose:   { label: '用途',       get: function (r) { return r.purpose || '未填写'; }, sub: function (r) { return ''; } },
    month:     { label: '月份',       get: function (r) { return U.month(r.date); }, sub: function (r) { return ''; } },
    category:  { label: '类别',       get: function (r) { var c = Store.getChemical(r.chemicalId); return c ? c.category : '—'; }, sub: function (r) { var c = Store.getChemical(r.chemicalId); return c ? c.hazard : '—'; } }
  };

  /**
   * 按维度汇总。数量按"单位"分组累加——不同单位的化学品不可直接相加，
   * 故返回中含 units 明细：{ key, sub, count, qty, units: {unit: qty} }
   */
  R.summarize = function (records, dim) {
    var def = R.SUM_DIMS[dim];
    if (!def) return [];
    var groups = U.groupBy(records, def.get);
    var rows = Object.keys(groups).map(function (k) {
      var items = groups[k];
      var unitQty = {};
      items.forEach(function (r) {
        var u = r.unit || '—';
        unitQty[u] = U.round3((unitQty[u] || 0) + U.num(r.qty, 0));
      });
      return {
        key: k,
        sub: def.sub(items[0]),
        count: items.length,
        total: U.round3(U.sumBy(items, function (r) { return r.qty; })),
        units: unitQty,
        unitText: Object.keys(unitQty).map(function (u) {
          return U.fmtQty(unitQty[u]) + ' ' + u;
        }).join(' / ')
      };
    });
    rows.sort(function (a, b) { return b.total - a.total; });
    return rows;
  };

  /* ---------------- 报表元信息 ---------------- */
  R.buildMeta = function (records, f) {
    f = f || {};
    var parts = [];
    if (f.from || f.to) {
      parts.push('统计区间：' + (f.from || '最早') + ' 至 ' + (f.to || U.today()));
    } else {
      parts.push('统计区间：全部记录');
    }
    if (f.dept) parts.push('部门：' + f.dept);
    if (f.chemicalId) {
      var c = Store.getChemical(f.chemicalId);
      parts.push('化学品：' + (c ? c.name : '—'));
    }
    if (f.hazard) parts.push('危险性：' + f.hazard);
    parts.push('记录条数：' + records.length + ' 条');
    parts.push('涉及品种：' + U.uniq(records.map(function (r) { return r.chemicalId; })).length + ' 种');
    parts.push('制表时间：' + U.nowStamp());
    if (Store.state.meta.orgName) parts.push('单位：' + Store.state.meta.orgName);
    return parts.join('　|　');
  };

  /* ---------------- 导出：CSV ---------------- */
  R.exportCsv = function (records, filename) {
    var rows = R.detailRows(records);
    var head = ['序号', '领用日期', '单据号', '化学品名称', '类别', '危险性', '规格/包装',
                '数量', '单位', '领用人', '部门', '用途', '发放人', '状态', '备注'];
    var body = rows.map(function (r) {
      return [r.idx, r.date, r.docNo, r.name, r.category, r.hazard, r.spec,
              r.qty, r.unit, r.applicant, r.dept, r.purpose, r.operator, r.status, r.note];
    });
    U.download(filename || ('领用记录表_' + U.today() + '.csv'), U.toCsv([head].concat(body)), 'text/csv');
  };

  /** 台账版 CSV：与附录三列一致，化学品三要素在每行重复（CSV 无分块概念） */
  R.exportLedgerCsv = function (f, filename) {
    var blocks = R.buildLedger(f);
    var head = ['物料号', '物品名称', '危险分类'].concat(R.LEDGER_HEAD);
    var body = [];
    blocks.forEach(function (b) {
      b.rows.forEach(function (row) {
        body.push([b.chemical.code || '', b.chemical.name, b.chemical.hazard || '',
                   row.date, U.fmtQty(row.before), qtyText(row), U.fmtQty(row.after),
                   row.purpose, row.applicant]);
      });
    });
    U.download(filename || ('化学品领用记录_' + U.today() + '.csv'), U.toCsv([head].concat(body)), 'text/csv');
  };

  /* ---------------- 导出：Excel (SpreadsheetML) ---------------- */
  function xlsEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  R.exportExcel = function (f, filename, orgName) {
    var blocks = R.buildLedger(f);
    var org = orgName || Store.state.meta.orgName || '';

    var xml = [];
    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push('<?mso-application progid="Excel.Sheet"?>');
    xml.push('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"');
    xml.push(' xmlns:o="urn:schemas-microsoft-com:office:office"');
    xml.push(' xmlns:x="urn:schemas-microsoft-com:office:excel"');
    xml.push(' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">');
    xml.push('<Styles>');
    xml.push('<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/>' +
             '<Font ss:FontName="微软雅黑" ss:Size="10"/></Style>');
    xml.push('<Style ss:ID="Title"><Font ss:FontName="微软雅黑" ss:Size="15" ss:Bold="1"/>' +
             '<Alignment ss:Horizontal="Left" ss:Vertical="Center"/></Style>');
    xml.push('<Style ss:ID="Sub"><Font ss:FontName="微软雅黑" ss:Size="9" ss:Color="#666666"/>' +
             '<Alignment ss:Vertical="Center"/></Style>');
    xml.push('<Style ss:ID="Head"><Font ss:FontName="微软雅黑" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>' +
             '<Interior ss:Color="#1C6FB8" ss:Pattern="Solid"/>' +
             '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>' +
             '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>');
    xml.push('<Style ss:ID="Label"><Font ss:FontName="微软雅黑" ss:Size="10" ss:Bold="1"/>' +
             '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/>' +
             '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>' +
             '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/></Borders></Style>');
    xml.push('<Style ss:ID="Cell"><Borders>' +
             '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>' +
             '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>' +
             '</Borders><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>');
    xml.push('<Style ss:ID="Num"><Borders>' +
             '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>' +
             '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#999999"/>' +
             '</Borders><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>');
    xml.push('</Styles>');

    /* ---- Sheet 1：附录三 · 化学品领用记录（台账，每化学品一块） ----
       平面网格 9 列：信息行占前 6 列（3 组标签+值）+ 尾列，
       列头/数据行前 3 列留空，后 6 列与附录三列头对齐。 */
    xml.push('<Worksheet ss:Name="化学品领用记录">');
    xml.push('<Table>');
    var colW = [95, 110, 95, 110, 95, 110, 95, 190, 90];
    xml.push('<Row>' + colW.map(function (w) {
      return '<Column ss:Width="' + w + '"/>';
    }).join('') + '</Row>');

    // 页眉行：左 程序名，右 文件编号+版本
    xml.push('<Row ss:Height="18">' +
      '<Cell ss:StyleID="Sub"><Data ss:Type="String">化学品管理程序</Data></Cell>' +
      '<Cell ss:StyleID="Sub" ss:MergeAcross="4"/>' +
      '<Cell ss:StyleID="Sub" ss:MergeAcross="2"><Data ss:Type="String">文件编号：' +
      xlsEsc(R.FORM_NO()) + '　版本号：' + xlsEsc(R.FORM_VER()) + '</Data></Cell></Row>');
    // 标题行
    xml.push('<Row ss:Height="28"><Cell ss:StyleID="Title" ss:MergeAcross="8">' +
             '<Data ss:Type="String">附录三：化学品领用记录</Data></Cell></Row>');
    if (org) {
      xml.push('<Row ss:Height="16"><Cell ss:StyleID="Sub" ss:MergeAcross="8">' +
               '<Data ss:Type="String">' + xlsEsc(org) + '</Data></Cell></Row>');
    }
    xml.push('<Row/>');

    blocks.forEach(function (b, bi) {
      if (bi > 0) xml.push('<Row/>');
      // 信息行：物料号 / 物品名称 / 危险分类（3 组标签+值，尾列留空）
      xml.push('<Row ss:Height="22">' +
        cellStr('物料号', 'Label') + cellStr(b.chemical.code || '', 'Cell') + '<Cell ss:StyleID="Cell"/>' +
        cellStr('物品名称', 'Label') + cellStr(b.chemical.name, 'Cell') + '<Cell ss:StyleID="Cell"/>' +
        cellStr('危险分类', 'Label') + cellStr(b.chemical.hazard || '', 'Cell') + '<Cell ss:StyleID="Cell"/></Row>');
      // 列头行：前 3 列空 + 6 列头
      xml.push('<Row ss:Height="22"><Cell ss:StyleID="Cell"/><Cell ss:StyleID="Cell"/><Cell ss:StyleID="Cell"/>' +
        R.LEDGER_HEAD.map(function (t) {
          return '<Cell ss:StyleID="Head"><Data ss:Type="String">' + xlsEsc(t) + '</Data></Cell>';
        }).join('') + '</Row>');
      // 数据行：前 3 列空 + 6 列数据
      b.rows.forEach(function (row) {
        xml.push('<Row>' + '<Cell ss:StyleID="Cell"/><Cell ss:StyleID="Cell"/><Cell ss:StyleID="Cell"/>' +
          cellStr(row.date, 'Cell') +
          cellStr(U.fmtQty(row.before), 'Num') +
          cellStr(qtyText(row), 'Num') +
          cellStr(U.fmtQty(row.after), 'Num') +
          cellStr(row.purpose, 'Cell') +
          cellStr(row.applicant, 'Cell') + '</Row>');
      });
    });

    xml.push('</Table>');
    xml.push('</Worksheet>');

    /* ---- Sheet 2：按化学品汇总 ---- */
    var recs = R.filterRecords(f);
    var sumRows = R.summarize(recs, 'chemical');
    xml.push('<Worksheet ss:Name="按化学品汇总">');
    xml.push('<Table><Row>' + [120, 150, 70, 80, 160].map(function (w) {
      return '<Column ss:Width="' + w + '"/>';
    }).join('') + '</Row>');
    xml.push('<Row ss:Height="26"><Cell ss:StyleID="Title" ss:MergeAcross="4">' +
             '<Data ss:Type="String">领用数量汇总（按化学品）</Data></Cell></Row>');
    xml.push('<Row/>');
    xml.push('<Row ss:Height="22">' + ['化学品名称', '类别/危险性', '领用次数', '合计数量', '分单位数量'].map(function (h) {
      return '<Cell ss:StyleID="Head"><Data ss:Type="String">' + h + '</Data></Cell>';
    }).join('') + '</Row>');
    sumRows.forEach(function (s) {
      xml.push('<Row>' + cellStr(s.key, 'Cell') + cellStr(s.sub, 'Cell') +
        cellNum(s.count, 'Num') + cellStr(s.unitText, 'Cell') +
        cellStr('单位数：' + Object.keys(s.units).length, 'Cell') + '</Row>');
    });
    xml.push('</Table></Worksheet>');

    /* ---- Sheet 3：按部门汇总 ---- */
    var deptRows = R.summarize(recs, 'dept');
    xml.push('<Worksheet ss:Name="按部门汇总">');
    xml.push('<Table><Row>' + [130, 80, 100, 180].map(function (w) {
      return '<Column ss:Width="' + w + '"/>';
    }).join('') + '</Row>');
    xml.push('<Row ss:Height="26"><Cell ss:StyleID="Title" ss:MergeAcross="3">' +
             '<Data ss:Type="String">领用数量汇总（按部门）</Data></Cell></Row>');
    xml.push('<Row/>');
    xml.push('<Row ss:Height="22">' + ['部门', '领用次数', '合计数量', '分单位数量'].map(function (h) {
      return '<Cell ss:StyleID="Head"><Data ss:Type="String">' + h + '</Data></Cell>';
    }).join('') + '</Row>');
    deptRows.forEach(function (s) {
      xml.push('<Row>' + cellStr(s.key, 'Cell') + cellNum(s.count, 'Num') +
        cellStr(s.unitText, 'Cell') + cellStr('', 'Cell') + '</Row>');
    });
    xml.push('</Table></Worksheet>');

    xml.push('</Workbook>');

    U.download(filename || ('化学品领用记录_' + U.today() + '.xls'),
      xml.join('\n'), 'application/vnd.ms-excel');
  };

  function cellStr(v, style) {
    return '<Cell ss:StyleID="' + style + '"><Data ss:Type="String">' + xlsEsc(v) + '</Data></Cell>';
  }
  function cellNum(v, style) {
    var n = U.num(v, 0);
    return '<Cell ss:StyleID="' + style + '"><Data ss:Type="Number">' + n + '</Data></Cell>';
  }

  /* ---------------- 打印（附录三受控表单格式，A4 纵向） ----------------
   * 版式完全对齐参考表单：
   *   页眉：化学品管理程序 | 文件编号：MFG20CN-MK 版本号：01（下横线）
   *   标题：附录三：化学品领用记录
   *   每种化学品一个表块，独占一页（page-break）
   *   页脚：公司名/质量管理系统 | 机密/专有 | 受控文件 第X页，共Y页
   */
  R.print = function (f, orgName) {
    var blocks = R.buildLedger(f);
    var org = orgName || Store.state.meta.orgName || '';
    var root = document.getElementById('printRoot');
    var total = Math.max(blocks.length, 1);

    var html = [];
    html.push('<div class="p-head"><span>化学品管理程序</span>' +
      '<span>文件编号：' + U.esc(R.FORM_NO()) + '　版本号：' + U.esc(R.FORM_VER()) + '</span></div>');
    html.push('<div class="p-title">附录三：化学品领用记录</div>');

    blocks.forEach(function (b, bi) {
      html.push('<div class="p-block">');
      html.push(R.ledgerBlockHtml(b, { print: true, padTo: 14 }));
      html.push('<div class="p-foot">' +
        '<div class="p-foot-l">' + U.esc(org || '&nbsp;') + '<br>质量管理系统</div>' +
        '<div class="p-foot-c">机密/专有</div>' +
        '<div class="p-foot-r">受控文件<br>第' + (bi + 1) + '页，共' + total + '页</div>' +
        '</div>');
      html.push('</div>');
    });
    if (!blocks.length) {
      html.push('<div class="p-empty">当前筛选条件下无领用记录</div>');
    }

    root.innerHTML = html.join('');
    setTimeout(function () {
      window.print();
      setTimeout(function () { root.innerHTML = ''; }, 800);
    }, 60);
  };

  /* ---------------- 报表页预览（屏幕版台账块） ---------------- */
  R.ledgerHtml = function (blocks) {
    var h = [];
    blocks.forEach(function (b) {
      h.push('<div class="ledger-block">');
      h.push('<div class="ledger-info">' +
        '<span><b>物料号</b>' + U.esc(b.chemical.code || '—') + '</span>' +
        '<span><b>物品名称</b>' + U.esc(b.chemical.name) + '</span>' +
        '<span><b>危险分类</b>' + U.esc(b.chemical.hazard || '—') + '</span>' +
        '<span class="ledger-count">' + b.rows.length + ' 条</span></div>');
      h.push(R.ledgerBlockHtml(b, { print: false }));
      h.push('</div>');
    });
    return h.join('');
  };

  /* ---------------- 状态 ---------------- */
  R.currentFilter = {};
  R.currentDim = 'chemical';

  global.Report = R;
})(window);

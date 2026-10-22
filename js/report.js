/* ===========================================================
   report.js — 领用记录表：筛选 / 汇总 / 导出 / 打印
   ------------------------------------------------------------
   导出格式：
   - Excel (.xls)：SpreadsheetML 2003 格式，Excel / WPS 原生打开，
     带样式与冻结表头，无需联网、无需第三方库。
   - CSV：UTF-8 BOM，Excel 直接双击不乱码。
   - 打印：构造独立 printRoot，走 @media print 样式，A4 横向。
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

  /* ---------------- 导出：Excel (SpreadsheetML) ---------------- */
  function xlsEsc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  R.exportExcel = function (records, filename, orgName) {
    var rows = R.detailRows(records);
    var title = orgName ? orgName + '　化学品领用记录表' : '化学品领用记录表';

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
             '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>');
    xml.push('<Style ss:ID="Sub"><Font ss:FontName="微软雅黑" ss:Size="9" ss:Color="#666666"/>' +
             '<Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>');
    xml.push('<Style ss:ID="Head"><Font ss:FontName="微软雅黑" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>' +
             '<Interior ss:Color="#1C6FB8" ss:Pattern="Solid"/>' +
             '<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>' +
             '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>');
    xml.push('<Style ss:ID="Cell"><Borders>' +
             '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
             '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
             '</Borders><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>');
    xml.push('<Style ss:ID="Num"><Borders>' +
             '<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
             '<Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CCCCCC"/>' +
             '</Borders><Alignment ss:Horizontal="Right" ss:Vertical="Center"/></Style>');
    xml.push('</Styles>');

    /* ---- Sheet 1：明细 ---- */
    xml.push('<Worksheet ss:Name="领用明细">');
    xml.push('<Table>');
    var cols = [50, 88, 128, 190, 78, 62, 96, 62, 46, 74, 92, 150, 70, 62, 150];
    xml.push('<Row>' + cols.map(function (w) {
      return '<Column ss:Width="' + w + '"/>';
    }).join('') + '</Row>');

    xml.push('<Row ss:Height="30"><Cell ss:StyleID="Title" ss:MergeAcross="14">' +
             '<Data ss:Type="String">' + xlsEsc(title) + '</Data></Cell></Row>');
    xml.push('<Row ss:Height="18"><Cell ss:StyleID="Sub" ss:MergeAcross="14">' +
             '<Data ss:Type="String">' + xlsEsc(R.buildMeta(records, Report.currentFilter)) +
             '</Data></Cell></Row>');
    xml.push('<Row/>');

    var head = ['序号', '领用日期', '单据号', '化学品名称', '类别', '危险性', '规格/包装',
                '数量', '单位', '领用人', '部门', '用途', '发放人', '状态', '备注'];
    xml.push('<Row ss:Height="26">' + head.map(function (h) {
      return '<Cell ss:StyleID="Head"><Data ss:Type="String">' + xlsEsc(h) + '</Data></Cell>';
    }).join('') + '</Row>');

    rows.forEach(function (r) {
      var cells = [];
      cells.push(cellStr(r.idx, 'Cell'));
      cells.push(cellStr(r.date, 'Cell'));
      cells.push(cellStr(r.docNo, 'Cell'));
      cells.push(cellStr(r.name, 'Cell'));
      cells.push(cellStr(r.category, 'Cell'));
      cells.push(cellStr(r.hazard, 'Cell'));
      cells.push(cellStr(r.spec, 'Cell'));
      cells.push(cellNum(r.qty, 'Num'));
      cells.push(cellStr(r.unit, 'Cell'));
      cells.push(cellStr(r.applicant, 'Cell'));
      cells.push(cellStr(r.dept, 'Cell'));
      cells.push(cellStr(r.purpose, 'Cell'));
      cells.push(cellStr(r.operator, 'Cell'));
      cells.push(cellStr(r.status, 'Cell'));
      cells.push(cellStr(r.note, 'Cell'));
      xml.push('<Row>' + cells.join('') + '</Row>');
    });

    // 合计行：15 列 —— "合计"跨 1-7，条数占 8，"条"占 9，说明跨 10-15
    xml.push('<Row ss:Height="20">' +
      '<Cell ss:StyleID="Head" ss:MergeAcross="6"><Data ss:Type="String">合计</Data></Cell>' +
      '<Cell ss:StyleID="Num"><Data ss:Type="Number">' + rows.length + '</Data></Cell>' +
      '<Cell ss:StyleID="Head"><Data ss:Type="String">条</Data></Cell>' +
      '<Cell ss:StyleID="Head" ss:MergeAcross="5"><Data ss:Type="String">（不同单位数量不合并计量）</Data></Cell>' +
      '</Row>');
    xml.push('</Table>');
    xml.push('<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>4</SplitHorizontal><TopRowBottomPane>4</TopRowBottomPane><ActivePane>2</ActivePane></WorksheetOptions>');
    xml.push('</Worksheet>');

    /* ---- Sheet 2：按化学品汇总 ---- */
    var sumRows = R.summarize(records, 'chemical');
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
    var deptRows = R.summarize(records, 'dept');
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

    U.download(filename || ('领用记录表_' + U.today() + '.xls'),
      xml.join('\n'), 'application/vnd.ms-excel');
  };

  function cellStr(v, style) {
    return '<Cell ss:StyleID="' + style + '"><Data ss:Type="String">' + xlsEsc(v) + '</Data></Cell>';
  }
  function cellNum(v, style) {
    var n = U.num(v, 0);
    return '<Cell ss:StyleID="' + style + '"><Data ss:Type="Number">' + n + '</Data></Cell>';
  }

  /* ---------------- 打印 ---------------- */
  R.print = function (records, f, orgName) {
    var rows = R.detailRows(records);
    var root = document.getElementById('printRoot');
    var title = orgName ? orgName + ' 化学品领用记录表' : '化学品领用记录表';

    var html = [];
    html.push('<div class="p-title">' + U.esc(title) + '</div>');
    html.push('<div class="p-sub">' + U.esc(R.buildMeta(records, f)).split('　|　').join('　　') + '</div>');
    html.push('<table class="p-table"><thead><tr>');
    ['序号', '领用日期', '单据号', '化学品名称', '类别', '危险性', '规格/包装', '数量', '单位',
     '领用人', '部门', '用途', '发放人'].forEach(function (h) {
      html.push('<th>' + h + '</th>');
    });
    html.push('</tr></thead><tbody>');
    rows.forEach(function (r) {
      html.push('<tr><td>' + r.idx + '</td><td>' + U.esc(r.date) + '</td><td>' + U.esc(r.docNo) +
        '</td><td>' + U.esc(r.name) + '</td><td>' + U.esc(r.category) + '</td><td>' + U.esc(r.hazard) +
        '</td><td>' + U.esc(r.spec) + '</td><td>' + U.esc(r.qty) + '</td><td>' + U.esc(r.unit) +
        '</td><td>' + U.esc(r.applicant) + '</td><td>' + U.esc(r.dept) + '</td><td>' + U.esc(r.purpose) +
        '</td><td>' + U.esc(r.operator) + '</td></tr>');
    });
    html.push('<tr class="p-tot"><td colspan="7">合计 ' + rows.length + ' 条</td><td>—</td><td>—</td>' +
      '<td colspan="3">（不同单位数量不合并计量）</td></tr>');
    html.push('</tbody></table>');
    html.push('<div class="p-sign"><div>制表人：____________</div><div>审核人：____________</div>' +
      '<div>批准人：____________</div><div>日期：______年____月____日</div></div>');

    root.innerHTML = html.join('');
    setTimeout(function () {
      window.print();
      setTimeout(function () { root.innerHTML = ''; }, 800);
    }, 60);
  };

  /* ---------------- 状态 ---------------- */
  R.currentFilter = {};
  R.currentDim = 'chemical';

  global.Report = R;
})(window);

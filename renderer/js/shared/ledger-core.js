'use strict';
// ============================================================================
// 六芒星记账 — 共享数据层(桌面/手机共用)
// ----------------------------------------------------------------------------
// 这是一切读账、写账的唯一入口。它不关心"账本放在哪、用什么存"——
// 只定义了一个简单的"数据库适配器"接口,由各端实现:
//
//   Desktop(电脑版):main/db.js 用 better-sqlite3 提供(同步)
//   Mobile(手机版): renderer/js/mobile-backend.js 用 SQLite 插件提供(异步)
//
// 本文件同时被两种环境加载,因此不能用 require / import:
//   - 桌面端:main/ipc.js 用 require('./ledger-core.js') 引入(模块导出)
//   - 手机端:index.html 用 <script> 标签引入(window.LedgerCore)
// 末尾用 UMD 双保险,两种加载方式都拿得到。
// ============================================================================

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();   // CommonJS(main 进程 require)
  } else {
    root.LedgerCore = factory();  // 浏览器/WebView(script 标签)
  }
})(typeof self !== 'undefined' ? self : this, function () {

  // ===== 通用常量 =====
  var EXPORT_FORMAT = 'hexagram-ledger-export';
  var EXPORT_VERSION = 1;

  // 记录的"白名单字段"——导入/导出、界面传参统一用它过滤,其余字段一律丢弃
  var RECORD_FIELDS = ['amount', 'date', 'type', 'category', 'subcategory', 'note', 'created_at', 'updated_at'];

  // ===== 分类表(和 main/seed-data.js 完全一致)=====
  var CATEGORIES = {
    expense: [
      { name: '餐饮美食', children: ['早餐', '午餐', '晚餐', '水果零食', '饮料咖啡', '外卖'] },
      { name: '交通出行', children: ['公交地铁', '出租车', '共享单车', '火车飞机', '加油停车'] },
      { name: '购物消费', children: ['服装鞋帽', '数码电器', '日用百货', '美妆个护', '宠物用品'] },
      { name: '居住生活', children: ['房租房贷', '水电燃气', '物业费', '家具家电', '家政维修'] },
      { name: '娱乐休闲', children: ['电影演出', '游戏充值', '运动健身', '旅行度假'] },
      { name: '医疗健康', children: ['门诊药品', '体检', '医疗保健'] },
      { name: '学习成长', children: ['书籍资料', '课程培训', '考试报名'] },
      { name: '人情往来', children: ['请客送礼', '红包份子', '孝敬父母'] },
      { name: '其他', children: ['其他支出'] },
    ],
    income: [
      { name: '收入', children: ['工资奖金', '人情往来', '投资理财', '退款报销'] },
    ],
  };

  var TYPES = ['expense', 'income'];

  // ===== 校验工具(供导入用)=====
  // normalizeImportRecord 定义在 createLedger 内部;这里作为顶层函数再暴露一次,
  // 供其他模块(手机端校验)直接复用,逻辑完全一致。
  function topNormalizeImportRecord(raw) {
    return normalizeImportRecordShim(raw);
  }
  // 顶层实现(createLedger 内部直接用;此处只做转发,避免重复定义)
  function normalizeImportRecordShim(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var rec = {};
    for (var i = 0; i < RECORD_FIELDS.length; i++) {
      var f = RECORD_FIELDS[i];
      if (Object.prototype.hasOwnProperty.call(raw, f)) rec[f] = raw[f];
    }
    if (rec.type === undefined) rec.type = 'expense';
    if (!isAmount(rec.amount)) return null;
    if (!isType(rec.type)) return null;
    if (!isDateStr(rec.date)) return null;
    if (typeof rec.category !== 'string' || !rec.category) return null;
    if (typeof rec.subcategory !== 'string') rec.subcategory = '';
    if (typeof rec.note !== 'string') rec.note = '';
    return rec;
  }

  function isAmount(fen) {
    return Number.isInteger(fen) && fen > 0;
  }

  function isType(t) {
    return TYPES.indexOf(t) !== -1;
  }

  function isDateStr(str) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    var d = new Date(str);
    if (isNaN(d.getTime())) return false;
    // 防 "2026-02-30" 这种不存在的日期被 new Date 自动进位
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') === str;
  }

  // ==========================================================================
  // 核心工厂:接收一个"适配器",返回全部数据操作
  // 适配器接口(桌面端同步实现、手机端异步实现,本层一律 await 调用):
  //   init()                 —— 打开/创建数据库,建表、迁移、建索引
  //   all(sql, params)       —— 查询多行 -> [{...}]
  //   get(sql, params)       —— 查询单行 -> {...}
  //   run(sql, params)       —— 执行写操作 -> { changes, lastInsertRowid? }
  //   transaction(fn)        —— 在事务里执行 fn(全部成功才落盘)
  // ==========================================================================
  function createLedger(adapter) {

    // ----- 分类 -----
    function listCategories(opts) {
      var toList = function (group) {
        return group.map(function (c) { return { category: c.name, subcategories: c.children }; });
      };
      var type = opts && opts.type;
      if (type) {
        if (!CATEGORIES[type]) throw new Error('type 参数非法,只允许 expense / income');
        return Promise.resolve(toList(CATEGORIES[type]));
      }
      return Promise.resolve({
        expense: toList(CATEGORIES.expense),
        income: toList(CATEGORIES.income),
      });
    }

    // 校验单条记录(导入用):合法返回清洗后的记录,非法返回 null
    function normalizeImportRecord(raw) {
      return normalizeImportRecordShim(raw);
    }

    // ----- 记一笔 / 改一笔 / 删一笔 -----
    // 注意:写操作一律 await 适配器——电脑版适配器是同步的(await 同步值无副作用),
    // 手机版适配器是异步的(必须等它落盘再继续),这样两端语义完全一致。
    async function addRecord(input) {
      var rec = normalizeImportRecord(input);
      if (!rec) return Promise.reject(new Error('记账数据不合法,保存失败'));
      var sql = 'INSERT INTO records (amount, date, type, category, subcategory, note) VALUES (?, ?, ?, ?, ?, ?)';
      var info = await adapter.run(sql, rec.amount, rec.date, rec.type, rec.category, rec.subcategory, rec.note || '');
      return { id: info.lastInsertRowid };
    }

    async function updateRecord(id, input) {
      var rec = normalizeImportRecord(input);
      if (!rec) return Promise.reject(new Error('记账数据不合法,保存失败'));
      var sql = "UPDATE records SET amount = ?, date = ?, type = ?, category = ?, subcategory = ?, note = ?, updated_at = datetime('now', 'localtime') WHERE id = ?";
      await adapter.run(sql, rec.amount, rec.date, rec.type, rec.category, rec.subcategory, rec.note || '', id);
      return { ok: true };
    }

    async function removeRecord(id) {
      await adapter.run('DELETE FROM records WHERE id = ?', id);
      return { ok: true };
    }

    // ----- 明细列表 -----
    // 电脑版适配器同步返回数组,手机版返回 Promise;统一 await,两端都行
    async function listRecords(filter) {
      var where = [];
      var params = [];
      if (filter && filter.type) {
        if (!isType(filter.type)) throw new Error('type 参数非法,只允许 expense / income');
        where.push('type = ?');
        params.push(filter.type);
      }
      if (filter && filter.category) {
        where.push('category = ?');
        params.push(filter.category);
      }
      if (filter && filter.month) {
        where.push("substr(date, 1, 7) = ?");
        params.push(filter.month);
      }
      var sql = 'SELECT * FROM records' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY date DESC, id DESC';
      return await adapter.all(sql, params);
    }

    // ----- 统计:环形图(按分类汇总)-----
    // 同 listRecords:统一 await 适配器(同步/异步都兼容)
    async function summaryByCategory(opts) {
      var where = [];
      var params = [];
      if (opts && opts.type) {
        if (!isType(opts.type)) throw new Error('type 参数非法,只允许 expense / income');
        where.push('type = ?');
        params.push(opts.type);
      } else {
        where.push("type = 'expense'");
      }
      if (opts && opts.month) {
        where.push("substr(date, 1, 7) = ?");
        params.push(opts.month);
      }
      if (opts && opts.year) {
        where.push('substr(date, 1, 4) = ?');
        params.push(String(opts.year));
      }
      var sql = 'SELECT category, SUM(amount) AS total FROM records' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' GROUP BY category ORDER BY total DESC';
      return await adapter.all(sql, params);
    }

    // ----- 统计:折线图(每日支出/收入两组)-----
    // 同 listRecords:统一 await 适配器
    async function summaryByDay(opts) {
      var where = [];
      var params = [];
      if (opts && opts.month) {
        where.push("substr(date, 1, 7) = ?");
        params.push(opts.month);
      }
      if (opts && opts.year) {
        where.push('substr(date, 1, 4) = ?');
        params.push(String(opts.year));
      }
      var sql = 'SELECT type, date, SUM(amount) AS total, COUNT(*) AS count FROM records' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' GROUP BY type, date ORDER BY date ASC';
      var rows = await adapter.all(sql, params);
      var expense = [];
      var income = [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].type === 'income') income.push(rows[i]);
        else expense.push(rows[i]);
      }
      return { expense: expense, income: income };
    }

    // ----- 统计:汇总卡片 -----
    // 同 listRecords:适配器可能同步(电脑)也可能异步(手机),统一 await
    async function summaryCard(opts) {
      var where = [];
      var params = [];
      if (opts && opts.month) {
        where.push("substr(date, 1, 7) = ?");
        params.push(opts.month);
      }
      if (opts && opts.year) {
        where.push('substr(date, 1, 4) = ?');
        params.push(String(opts.year));
      }
      var sql = 'SELECT' +
        ' COUNT(*) AS count,' +
        " COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense," +
        " COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income" +
        ' FROM records' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
      var row = await adapter.get(sql, params);
      return { count: row.count, expense: row.expense, income: row.income, balance: row.income - row.expense };
    }

    // ----- 导出:打包成 JSON 字符串 -----
    // 电脑版适配器同步返回、手机版异步返回,统一 await 后取结果
    async function exportData() {
      var rows = await adapter.all('SELECT * FROM records ORDER BY date ASC, id ASC', []);
      var payload = {
        app: EXPORT_FORMAT,
        formatVersion: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        records: rows.map(function (r) {
          return {
            amount: r.amount,
            date: r.date,
            type: r.type,
            category: r.category,
            subcategory: r.subcategory,
            note: r.note,
            created_at: r.created_at,
            updated_at: r.updated_at,
          };
        }),
      };
      return JSON.stringify(payload, null, 2);
    }

    // ----- 导入:解析 + 校验 + 写入(覆盖/合并)-----
    async function importData(jsonText, mode) {
      var parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        return Promise.reject(new Error('文件不是有效的账目备份(JSON 解析失败)'));
      }
      if (!parsed || parsed.app !== EXPORT_FORMAT) {
        return Promise.reject(new Error('这不是六芒星记账导出的备份文件'));
      }
      if (!Array.isArray(parsed.records)) {
        return Promise.reject(new Error('备份文件缺少 records 数据'));
      }

      var valid = [];
      var skipped = 0;
      for (var i = 0; i < parsed.records.length; i++) {
        var clean = normalizeImportRecord(parsed.records[i]);
        if (clean) valid.push(clean);
        else skipped++;
      }

      var result = await adapter.transaction(function () {
        // 覆盖模式:先把旧账全部清空
        if (mode === 'overwrite') {
          adapter.run('DELETE FROM records', []);
        }
        var inserted = 0;
        for (var j = 0; j < valid.length; j++) {
          var r = valid[j];
          adapter.run(
            'INSERT INTO records (amount, date, type, category, subcategory, note) VALUES (?, ?, ?, ?, ?, ?)',
            r.amount, r.date, r.type, r.category, r.subcategory, r.note || ''
          );
          inserted++;
        }
        return { inserted: inserted };
      });
      return { inserted: result.inserted, skipped: skipped };
    }

    return {
      listCategories: listCategories,
      addRecord: addRecord,
      updateRecord: updateRecord,
      removeRecord: removeRecord,
      listRecords: listRecords,
      summaryByCategory: summaryByCategory,
      summaryByDay: summaryByDay,
      summaryCard: summaryCard,
      exportData: exportData,
      importData: importData,
    };
  }

  // ==========================================================================
  // 桌面端适配器(在 main/ipc.js 里组装):构造时传 better-sqlite3 的 Database
  // ==========================================================================
  function createDesktopAdapter(db) {
    // better-sqlite3 是同步的;这里把返回值包装成"看起来是同步"的对象,
    // 共享层统一用 await 调用,遇到同步值 Promise.resolve 自动接管,两种都行。
    return {
      init: function () {
        // 建表逻辑由 main/db.js 负责(它已经建好库再进来)
      },
      all: function (sql, params) {
        var stmt = db.prepare(sql);
        return Array.isArray(params) ? stmt.all.apply(stmt, params) : stmt.all.apply(stmt, arguments.length > 1 ? Array.prototype.slice.call(arguments, 1) : []);
      },
      get: function (sql, params) {
        var stmt = db.prepare(sql);
        if (Array.isArray(params)) {
          return stmt.get.apply(stmt, params);
        }
        return stmt.get.apply(stmt, arguments.length > 1 ? Array.prototype.slice.call(arguments, 1) : []);
      },
      run: function (sql, params) {
        var stmt = db.prepare(sql);
        var info;
        if (Array.isArray(params)) {
          info = stmt.run.apply(stmt, params);
        } else if (arguments.length > 1) {
          info = stmt.run.apply(stmt, Array.prototype.slice.call(arguments, 1));
        } else {
          info = stmt.run();
        }
        // better-sqlite3 的 RunResult 是 { changes, lastInsertRowid },和手机端对齐
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      },
      transaction: function (fn) {
        return db.transaction(fn)();
      },
    };
  }

  return {
    CATEGORIES: CATEGORIES,
    TYPES: TYPES,
    EXPORT_FORMAT: EXPORT_FORMAT,
    EXPORT_VERSION: EXPORT_VERSION,
    createLedger: createLedger,
    createDesktopAdapter: createDesktopAdapter,
    normalizeImportRecord: topNormalizeImportRecord,
  };
});

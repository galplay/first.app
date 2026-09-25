'use strict';
// ============================================================================
// 六芒星记账 — 手机版桥接层(安卓 / Capacitor 环境专用)
// ----------------------------------------------------------------------------
// 电脑版:window.ledger 由 Electron 的 preload.js 注入(走主进程 better-sqlite3)
// 手机版:本文件在界面里用 <script> 加载,自己定义 window.ledger,
//         底层用 @capacitor-community/sqlite 插件读写手机本地数据库,
//         业务逻辑全部复用 renderer/js/shared/ledger-core.js(和电脑完全同一套)。
//
// 安全:第一行先检测,只有真在 Capacitor 环境才往下走;
//       电脑版加载本文件时 window.Capacitor 不存在,直接什么都不做。
// ============================================================================

(function () {
  // 不是 Capacitor 环境(电脑版 / 普通浏览器)就什么都不做
  if (typeof window === 'undefined' || !window.Capacitor || !window.LedgerCore) {
    return;
  }

  var CapacitorSQLite = window.Capacitor.Plugins.SQLite;
  var DB_NAME = 'hexagram_ledger'; // 手机本地数据库文件名(SQLite 插件要求小写+下划线)
  var DB_VERSION = 1;

  // 建表 + 迁移,和电脑版 main/db.js 保持一致:
  // records 表 + 两个索引 + type 列(老库没有就补上)
  var CREATE_RECORDS = [
    'CREATE TABLE IF NOT EXISTS records (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
      "amount INTEGER NOT NULL CHECK (amount > 0), " +
      "date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), " +
      "type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')), " +
      'category TEXT NOT NULL, ' +
      "subcategory TEXT NOT NULL DEFAULT '', " +
      "note TEXT NOT NULL DEFAULT '', " +
      "created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), " +
      "updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))" +
      ')',
    'CREATE INDEX IF NOT EXISTS idx_records_date ON records (date)',
    'CREATE INDEX IF NOT EXISTS idx_records_category ON records (category)',
    'CREATE INDEX IF NOT EXISTS idx_records_type ON records (type)',
  ];

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ==========================================================================
  // 手机数据库适配器:满足 ledger-core 要求的 5 个方法
  //   init / all / get / run / transaction
  // SQLite 插件一次只能执行一条语句,且是异步的。
  // 电脑版 better-sqlite3 是"同步执行、天然有序",所以这里用一条
  // promise 队列把所有操作排成一条龙,保证执行顺序和电脑版完全一致。
  // ==========================================================================
  var mobileAdapter = (function () {
    var queue = Promise.resolve(); // 操作串行化的队列
    var dbHandle = null;           // 打开的数据库句柄

    // 把一条操作追加到队列尾巴,返回它自己的 Promise
    function enqueue(op) {
      var run = queue.then(function () { return op(); });
      // 出错也继续往后排,不让队列卡死
      queue = run.catch(function () {});
      return run;
    }

    function assertDb() {
      if (!dbHandle) throw new Error('数据库还没准备好');
    }

    function buildResult(r) {
      // 插件返回值转换成 ledger-core 需要的形状:{ changes, lastInsertRowid }
      if (!r) return { changes: 0, lastInsertRowid: 0 };
      return {
        changes: typeof r.changes === 'number' ? r.changes : 0,
        lastInsertRowid: typeof r.changes === 'number' && r.changes > 0 && typeof r.lastId === 'number'
          ? r.lastId
          : 0,
      };
    }

    return {
      init: function () {
        return enqueue(function () {
          return CapacitorSQLite.createConnection({ database: DB_NAME, version: DB_VERSION, encrypted: false, mode: 'no-encryption' })
            .then(function (conn) {
              dbHandle = conn;
              return dbHandle.open();
            })
            .then(function () {
              // 建表 + 迁移
              var stmts = [];
              for (var i = 0; i < CREATE_RECORDS.length; i++) {
                stmts.push({ statement: CREATE_RECORDS[i], values: [] });
              }
              return dbHandle.execute(stmts);
            })
            .then(function () {
              // 迁移:老库(没有 type 列)补列。查询一下表结构,缺了再补。
              return dbHandle.query('PRAGMA table_info(records)', []);
            })
            .then(function (res) {
              var hasType = false;
              if (res && res.values && res.values.length) {
                for (var j = 0; j < res.values.length; j++) {
                  if (res.values[j].name === 'type') { hasType = true; break; }
                }
              }
              if (!hasType) {
                var alter = [
                  { statement: "ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income'))", values: [] },
                  { statement: 'CREATE INDEX IF NOT EXISTS idx_records_type ON records (type)', values: [] },
                ];
                return dbHandle.execute(alter);
              }
              return null;
            });
        });
      },

      // 查询多行 -> 返回 [{...}] (和电脑版 all 的返回形状一致)
      all: function (sql, params) {
        return enqueue(function () {
          assertDb();
          return dbHandle.query(sql, Array.isArray(params) ? params : [])
            .then(function (res) {
              if (!res || !res.values) return [];
              return res.values.map(function (row) {
                var out = {};
                var keys = Object.keys(row);
                for (var i = 0; i < keys.length; i++) out[keys[i]] = row[keys[i]];
                return out;
              });
            });
        });
      },

      // 查询单行 -> 返回 {...} 或 undefined
      get: function (sql, params) {
        return enqueue(function () {
          assertDb();
          return dbHandle.query(sql, Array.isArray(params) ? params : [])
            .then(function (res) {
              if (!res || !res.values || !res.values.length) return undefined;
              return res.values[0];
            });
        });
      },

      // 写操作 -> 返回 { changes, lastInsertRowid }
      run: function (sql, params) {
        return enqueue(function () {
          assertDb();
          return dbHandle.run(sql, Array.isArray(params) ? params : [])
            .then(function (res) { return buildResult(res); });
        });
      },

      // 事务:fn 里写数据库,全部成功才落盘,失败回滚
      transaction: function (fn) {
        return enqueue(function () {
          assertDb();
          return dbHandle.run('BEGIN TRANSACTION', [])
            .then(function () {
              return Promise.resolve().then(function () { return fn(); })
                .then(function (result) {
                  return dbHandle.run('COMMIT', [])
                    .then(function () { return result; });
                }, function (err) {
                  return dbHandle.run('ROLLBACK', [])
                    .then(function () { throw err; });
                });
            });
        });
      },
    };
  })();

  // ==========================================================================
  // 组装手机版 ledger 对象(和 preload.js 暴露的方法签名完全一致)
  // ==========================================================================
  var ledger = {
    version: '0.4.0',
    platform: 'mobile',
  };

  function wireLedger() {
    var core = window.LedgerCore;
    var ledgerAPI = core.createLedger(mobileAdapter);

    ledger.categories = {
      list: function (opts) { return ledgerAPI.listCategories(opts); },
    };
    ledger.add = function (record) { return ledgerAPI.addRecord(record); };
    ledger.update = function (id, record) { return ledgerAPI.updateRecord(id, record); };
    ledger.remove = function (id) { return ledgerAPI.removeRecord(id); };
    ledger.list = function (filter) { return ledgerAPI.listRecords(filter); };

    ledger.summaryByCategory = function (opts) { return ledgerAPI.summaryByCategory(opts); };
    ledger.summaryByDay = function (opts) { return ledgerAPI.summaryByDay(opts); };
    ledger.summaryCard = function (opts) { return ledgerAPI.summaryCard(opts); };

    // 某月天数,直接算,不查库
    ledger.daysInMonth = function (year, month) {
      return Promise.resolve(new Date(year, month, 0).getDate());
    };

    // 数据搬家
    ledger.exportData = function () { return ledgerAPI.exportData(); };
    ledger.importData = function (jsonText, mode) { return ledgerAPI.importData(jsonText, mode); };

    window.ledger = ledger;
  }

  // 启动:打开数据库(建表/迁移)完成后,才把 ledger 挂到 window 上
  // (api.js 里 window.ledger 是同步取值,所以必须先等这里初始化完)
  mobileAdapter.init().then(function () {
    wireLedger();
  }).catch(function (err) {
    // 数据库起不来是致命问题:挂一个会报错的 ledger,避免界面黑屏后更难排查
    window.ledger = {
      platform: 'mobile',
      version: '0.4.0',
      _broken: true,
      _err: String(err && err.message || err),
    };
  });
})();

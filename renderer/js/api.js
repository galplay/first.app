'use strict';
// 界面层调用后台的统一入口:所有函数最终都走 window.ledger(preload 桥接层 / 手机端桥接层)

window.LedgerApp = window.LedgerApp || {};

// 电脑版:window.ledger 由 preload.js 提供(同步存在)
// 手机版:window.ledger 由 mobile-backend.js 提供,打开数据库成功后才会挂上。
// 因此这里做一个"等待就绪"的兜底:数据库还没开好时,先把请求排队,开好再依次放行。
// (正常情况下数据库几毫秒就开好了,不会有感知差别。)
function waitLedgerReady() {
  return new Promise(function (resolve) {
    if (window.ledger) { resolve(window.ledger); return; }
    var tries = 0;
    var timer = setInterval(function () {
      tries++;
      if (window.ledger) { clearInterval(timer); resolve(window.ledger); }
      else if (tries > 200) { // 2 秒还没好,按"后台不可用"处理
        clearInterval(timer);
        resolve(null);
      }
    }, 10);
  });
}

// 把所有方法包装成"先等就绪,再拿后台对象调用"。
// fn 形如 (backend, ...args) -> Promise
function wrap(fn) {
  return function () {
    const args = Array.prototype.slice.call(arguments);
    return waitLedgerReady().then(function (b) {
      if (!b) throw new Error('后台还没准备好');
      return fn.apply(null, [b].concat(args));
    });
  };
}

window.LedgerApp.api = {
  // 分类(可选传 { type: 'expense' | 'income' };不传返回两组)
  listCategories: wrap((b) => b.categories.list()),

  // 记账
  addRecord: wrap((b, record) => b.add(record)),
  updateRecord: wrap((b, id, record) => b.update(id, record)),
  removeRecord: wrap((b, id) => b.remove(id)),
  listRecords: wrap((b, filter) => b.list(filter)),

  // 统计
  summaryByCategory: wrap((b, opts) => b.summaryByCategory(opts)),
  summaryByDay: wrap((b, opts) => b.summaryByDay(opts)),
  summaryCard: wrap((b, opts) => b.summaryCard(opts)),
  daysInMonth: wrap((b, year, month) => b.daysInMonth(year, month)),

  // 数据搬家
  exportData: wrap((b) => b.exportData()),
  importData: wrap((b, jsonText, mode) => b.importData(jsonText, mode)),
};

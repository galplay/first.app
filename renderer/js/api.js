'use strict';
// 界面层调用后台的统一入口:所有函数最终都走 window.ledger(preload 桥接层)
window.LedgerApp = window.LedgerApp || {};

const api = window.ledger;

window.LedgerApp.api = {
  // 分类(可选传 { type: 'expense' | 'income' };不传返回两组)
  listCategories: (opts) => api.categories.list(opts),

  // 记账
  addRecord: (record) => api.add(record),
  updateRecord: (id, record) => api.update(id, record),
  removeRecord: (id) => api.remove(id),
  listRecords: (filter) => api.list(filter),

  // 统计
  summaryByCategory: (opts) => api.summaryByCategory(opts),
  summaryByDay: (opts) => api.summaryByDay(opts),
  summaryCard: (opts) => api.summaryCard(opts),
  daysInMonth: (year, month) => api.daysInMonth(year, month),
};

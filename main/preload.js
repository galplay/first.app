'use strict';
// 桥接层:把后台能力安全地暴露给界面层。
// 界面只能通过 window.ledger 调用这里列出的函数,拿不到任何 Node 能力。
const { contextBridge, ipcRenderer } = require('electron');

// 分类列表:categories.list({ type? }) -> [{ category, subcategories: [...] }] 或 { expense: [...], income: [...] }
// 记账:ledger.add({ amount, date, type?, category, subcategory, note })
// 修改:ledger.update(id, {...})  删除:ledger.remove(id)
// 明细:ledger.list({ category?, month?, type? })
// 统计:ledger.summaryByCategory({ month?/year?, type? }) / summaryByDay / summaryCard / daysInMonth
// 搬家:ledger.exportData() -> { canceled, path?, count? } / ledger.importData({ jsonText, mode })
// 平台:ledger.platform -> 'desktop' | 'mobile'(手机端在 mobile-backend.js 里定义)
contextBridge.exposeInMainWorld('ledger', {
  version: '0.4.0',
  platform: 'desktop',

  categories: {
    list: (opts) => ipcRenderer.invoke('categories:list', opts),
  },

  add: (record) => ipcRenderer.invoke('records:add', record),
  update: (id, record) => ipcRenderer.invoke('records:update', id, record),
  remove: (id) => ipcRenderer.invoke('records:remove', id),
  list: (filter) => ipcRenderer.invoke('records:list', filter),

  summaryByCategory: (opts) => ipcRenderer.invoke('records:summaryByCategory', opts),
  summaryByDay: (opts) => ipcRenderer.invoke('records:summaryByDay', opts),
  summaryCard: (opts) => ipcRenderer.invoke('records:summaryCard', opts),
  daysInMonth: (year, month) => ipcRenderer.invoke('stats:daysInMonth', year, month),

  // 数据搬家
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: (jsonText, mode) => ipcRenderer.invoke('data:import', { jsonText, mode }),
});

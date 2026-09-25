'use strict';
// 主进程接收界面层请求:界面上所有按钮点下去,最终都通过这里读写数据库。
// 所有 SQL 逻辑在 renderer/js/shared/ledger-core.js(桌面/手机共用),
// 本文件只负责:把 better-sqlite3 的数据库包装成共享层要的"适配器",
// 然后把界面请求转交给共享层,并回传结果。
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const dbModule = require('./db');
const LedgerCore = require('../renderer/js/shared/ledger-core');

// 桌面适配器(同步),所有 SQL 都走这里;建表/迁移仍由 main/db.js 负责
function makeAdapter() {
  return LedgerCore.createDesktopAdapter(dbModule.getDb());
}

function requireLedger() {
  return LedgerCore.createLedger(makeAdapter());
}

function registerIpc() {
  // 取分类:传 { type: 'expense' | 'income' } 只返回那一组;不传返回 { expense: [...], income: [...] }
  ipcMain.handle('categories:list', (_event, opts) => requireLedger().listCategories(opts));

  // 记一笔:成功返回 { id },失败抛错由界面统一兜底
  ipcMain.handle('records:add', (_event, input) => requireLedger().addRecord(input));

  // 修改一笔
  ipcMain.handle('records:update', (_event, id, input) => requireLedger().updateRecord(id, input));

  // 删除一笔
  ipcMain.handle('records:remove', (_event, id) => requireLedger().removeRecord(id));

  // 明细页列表:可按收支类型、分类筛选,按日期倒序,同一天按 id 倒序
  ipcMain.handle('records:list', (_event, filter) => requireLedger().listRecords(filter));

  // 统计页:按分类汇总(用于环形图)
  ipcMain.handle('records:summaryByCategory', (_event, opts) => requireLedger().summaryByCategory(opts));

  // 统计页:每日汇总(用于折线图)
  ipcMain.handle('records:summaryByDay', (_event, opts) => requireLedger().summaryByDay(opts));

  // 统计页汇总卡片
  ipcMain.handle('records:summaryCard', (_event, opts) => requireLedger().summaryCard(opts));

  // 统计页:某月天数(不查库,直接算)
  ipcMain.handle('stats:daysInMonth', (_event, year, month) => {
    return new Date(year, month, 0).getDate();
  });

  // ===== 数据搬家:导出 =====
  // 电脑上点"导出":弹出"另存为"对话框,用户选好位置后写入 JSON 备份文件
  ipcMain.handle('data:export', async (event) => {
    const jsonText = await requireLedger().exportData();

    const win = event.sender ? event.sender.getOwnerBrowserWindow() : null;
    const defaultName = '六芒星记账备份_' + new Date().toISOString().slice(0, 10) + '.json';
    const result = win
      ? await dialog.showSaveDialog(win, {
          title: '保存记账备份',
          defaultPath: defaultName,
          filters: [{ name: '六芒星记账备份', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          title: '保存记账备份',
          defaultPath: defaultName,
          filters: [{ name: '六芒星记账备份', extensions: ['json'] }],
        });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }
    fs.writeFileSync(result.filePath, jsonText, 'utf8');
    return { canceled: false, path: result.filePath, count: 0 };
  });

  // ===== 数据搬家:导入 =====
  // 界面层自己用 <input type="file"> 读文件(桌面/手机通用),读完后把文本传进来
  ipcMain.handle('data:import', (_event, payload) => {
    return requireLedger().importData(payload.jsonText, payload.mode);
  });
}

module.exports = { registerIpc };

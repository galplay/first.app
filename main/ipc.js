'use strict';
// 主进程接收界面层请求:界面上所有按钮点下去,最终都通过这里读写数据库。
// 界面上传的数据都是白名单字段,不透传用户输入拼 SQL,防注入。
const { ipcMain } = require('electron');
const CATEGORIES = require('./seed-data');

// 以下字段是界面可以带的"白名单",其余一律丢弃
const ALLOWED_RECORD_FIELDS = ['amount', 'date', 'category', 'subcategory', 'note', 'type'];
const TYPES = ['expense', 'income'];

function requireDb() {
  return require('./db');
}

function normalizeRecord(input) {
  const record = {};
  for (const field of ALLOWED_RECORD_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) record[field] = input[field];
  }
  // 老调用不传 type 时,一律按支出处理,保证向后兼容
  if (record.type === undefined) record.type = 'expense';
  if (!TYPES.includes(record.type)) throw new Error('type 参数非法,只允许 expense / income');
  return record;
}

function registerIpc() {
  // 取分类:传 { type: 'expense' | 'income' } 只返回那一组;不传返回 { expense: [...], income: [...] }
  ipcMain.handle('categories:list', (_event, opts) => {
    const toList = (group) => group.map((c) => ({ category: c.name, subcategories: c.children }));
    const type = opts && opts.type;
    if (type) {
      if (!CATEGORIES[type]) throw new Error('type 参数非法,只允许 expense / income');
      return toList(CATEGORIES[type]);
    }
    return {
      expense: toList(CATEGORIES.expense),
      income: toList(CATEGORIES.income),
    };
  });

  // 记一笔:成功返回 { id },失败抛错由界面统一兜底
  ipcMain.handle('records:add', (_event, input) => {
    const rec = normalizeRecord(input);
    const info = requireDb().getDb()
      .prepare('INSERT INTO records (amount, date, type, category, subcategory, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(rec.amount, rec.date, rec.type, rec.category, rec.subcategory, rec.note || '');
    return { id: info.lastInsertRowid };
  });

  // 修改一笔
  ipcMain.handle('records:update', (_event, id, input) => {
    const rec = normalizeRecord(input);
    requireDb().getDb()
      .prepare('UPDATE records SET amount = ?, date = ?, type = ?, category = ?, subcategory = ?, note = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?')
      .run(rec.amount, rec.date, rec.type, rec.category, rec.subcategory, rec.note || '', id);
    return { ok: true };
  });

  // 删除一笔
  ipcMain.handle('records:remove', (_event, id) => {
    requireDb().getDb().prepare('DELETE FROM records WHERE id = ?').run(id);
    return { ok: true };
  });

  // 明细页列表:可按收支类型、分类筛选,按日期倒序,同一天按 id 倒序
  ipcMain.handle('records:list', (_event, filter) => {
    const db = requireDb().getDb();
    const where = [];
    const params = [];
    if (filter && filter.type) {
      if (!TYPES.includes(filter.type)) throw new Error('type 参数非法,只允许 expense / income');
      where.push('type = ?');
      params.push(filter.type);
    }
    if (filter && filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter && filter.month) {
      where.push('substr(date, 1, 7) = ?');
      params.push(filter.month);
    }
    const sql = `SELECT * FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`;
    return db.prepare(sql).all(...params);
  });

  // 统计页:按分类汇总(用于环形图),可选月份/年份。
  // 默认只看支出(和旧版一致);环形图就按支出分类占比画,收入分类不参与。
  ipcMain.handle('records:summaryByCategory', (_event, opts) => {
    const db = requireDb().getDb();
    const where = [];
    const params = [];
    if (opts && opts.type) {
      if (!TYPES.includes(opts.type)) throw new Error('type 参数非法,只允许 expense / income');
      where.push('type = ?');
      params.push(opts.type);
    } else {
      where.push('type = \'expense\'');
    }
    if (opts && opts.month) {
      where.push('substr(date, 1, 7) = ?');
      params.push(opts.month);
    }
    if (opts && opts.year) {
      where.push('substr(date, 1, 4) = ?');
      params.push(String(opts.year));
    }
    const sql = `SELECT category, SUM(amount) AS total FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY category ORDER BY total DESC`;
    return db.prepare(sql).all(...params);
  });

  // 统计页:每日汇总(用于折线图),一次返回支出和收入两组,可选月份/年份
  ipcMain.handle('records:summaryByDay', (_event, opts) => {
    const db = requireDb().getDb();
    const where = [];
    const params = [];
    if (opts && opts.month) {
      where.push('substr(date, 1, 7) = ?');
      params.push(opts.month);
    }
    if (opts && opts.year) {
      where.push('substr(date, 1, 4) = ?');
      params.push(String(opts.year));
    }
    const sql = `SELECT type, date, SUM(amount) AS total, COUNT(*) AS count FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''} GROUP BY type, date ORDER BY date ASC`;
    const rows = db.prepare(sql).all(...params);
    const expense = [];
    const income = [];
    for (const row of rows) {
      if (row.type === 'income') income.push(row);
      else expense.push(row);
    }
    return { expense, income };
  });

  // 统计页汇总卡片:笔数 + 支出总额 + 收入总额 + 结余(收入 - 支出)
  ipcMain.handle('records:summaryCard', (_event, opts) => {
    const db = requireDb().getDb();
    const where = [];
    const params = [];
    if (opts && opts.month) {
      where.push('substr(date, 1, 7) = ?');
      params.push(opts.month);
    }
    if (opts && opts.year) {
      where.push('substr(date, 1, 4) = ?');
      params.push(String(opts.year));
    }
    const sql = `SELECT
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income
      FROM records ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
    const row = db.prepare(sql).get(...params);
    return { count: row.count, expense: row.expense, income: row.income, balance: row.income - row.expense };
  });

  // 统计页:某月天数(折线图横轴用),不查库,直接算
  ipcMain.handle('stats:daysInMonth', (_event, year, month) => {
    return new Date(year, month, 0).getDate();
  });
}

module.exports = { registerIpc };

'use strict';
// 数据库封装:所有对数据库的读写都在这一个文件里,主进程其他部分不得直接碰 SQLite。
// 数据文件位置: %APPDATA%\hexagram-ledger\ledger.db (用户数据目录,系统自动创建)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// 表结构说明:
// - categories   分类表(内置 9 大类,两层用 category / subcategory 两个字段平铺,避免额外一张子表)
// - records      记账流水表,amount 一律以"分"为整数存储,date 固定 YYYY-MM-DD 字符串
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  subcategory TEXT NOT NULL DEFAULT '',
  UNIQUE (category, subcategory)
);

CREATE TABLE IF NOT EXISTS records (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  date        TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  type        TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income')),
  category    TEXT NOT NULL,
  subcategory TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_records_date ON records (date);
CREATE INDEX IF NOT EXISTS idx_records_category ON records (category);
`;

let db = null;
let dbPath = null;

// 无损迁移:老版本的 ledger.db 没有 type 列,这里补一列,老数据一律标为 'expense'(支出)。
// 只加列、不动旧数据,升级后数字和升级前完全一致。
// 注意:type 的索引要放在 ALTER 之后建——老库执行 SCHEMA 时还没有 type 列,先建索引会报错。
function migrate(db) {
  const cols = db.pragma('table_info(records)');
  if (!cols.some((c) => c.name === 'type')) {
    db.exec("ALTER TABLE records ADD COLUMN type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'income'))");
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_records_type ON records (type)');
}

function getDbPath() {
  if (dbPath) return dbPath;
  // 数据文件位置固定为文档中约定的目录,和 Electron 自己的缓存分开,便于备份/恢复
  const dir = process.env.APPDATA || app.getPath('userData');
  const ledgerDir = path.join(dir, 'hexagram-ledger');
  fs.mkdirSync(ledgerDir, { recursive: true });
  dbPath = path.join(ledgerDir, 'ledger.db');
  return dbPath;
}

function getDb() {
  if (db) return db;
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// 每次进程退出时,先把改动全部落盘再退出,防止丢数据
// (app 在纯 Node 环境下可能为 undefined,比如单元测试直接 require 本文件)
function close() {
  if (db) {
    try {
      db.close();
    } catch (e) {
      // 关闭失败也直接退出,不阻塞用户关窗
    }
  }
  db = null;
}

if (app && typeof app.on === 'function') {
  app.on('before-quit', close);
}

// 打开数据库(应用启动时调用)
function open() {
  getDb();
}

// 写入/更新时统一刷新 updated_at
function touch(recordId) {
  getDb().prepare('UPDATE records SET updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(recordId);
}

module.exports = {
  open,
  getDb,
  getDbPath,
  touch,
  close,
};

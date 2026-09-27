# 六芒星记账 (Hexagram Ledger)

一款运行在 **Windows 电脑**上的个人记账软件,同时支持**安卓手机端**。随手记一笔,它帮你归类、统计,让你清楚钱花在了哪里。

- 目标用户:个人日常记账
- 货币:人民币(元/角/分)
- 数据:本地存储,不联网,隐私安全

---

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| 📝 记账 | 记录每笔**支出 / 收入**:金额(精确到分)、日期、分类、备注 |
| 🗂️ 两级分类 | 内置分类,开箱即用:支出 9 大类 35 小类、收入 4 小类 |
| 📋 明细页 | 按日期分组展示,可按分类、按收支类型筛选,支持修改 / 删除 |
| 📊 统计页 | 月度 / 年度切换;支出、收入、结余、笔数汇总卡片;支出占比**环形图**;每日收支**双线折线图** |
| 💾 备份 | 一键导出 / 导入账目,电脑、手机备份文件通用 |

## 🛠️ 技术栈

- **桌面框架**:Electron + 原生 HTML / CSS / JavaScript(不用前端框架)
- **数据库**:SQLite(`better-sqlite3`),金额以「分」为整数存储,避免小数误差
- **图表**:Chart.js(本地离线副本)
- **安卓端**:Capacitor 套壳 + `@capacitor-community/sqlite`,复用同一套界面
- **打包**:electron-builder → NSIS 安装包

## 📦 快速开始(Windows 桌面版)

```bash
npm install       # 首次安装依赖(装一次即可)
npm start         # 运行应用(开发调试)
npm run dist      # 打包生成安装包(输出在 release/ 文件夹)
```

## 📱 安卓版打包

需要 JDK 21:

```bash
npm run android:sync            # 把界面文件同步进安卓工程(改了界面后执行)
npm run android:build:17        # 打包 APK(自动指向本机 JDK21 路径)
# 产物:android\app\build\outputs\apk\debug\app-debug.apk
```

## 💾 数据与备份

账目数据保存在本机的一个数据库文件里:

```
C:\Users\你的用户名\AppData\Roaming\hexagram-ledger\ledger.db
```

- **备份数据** = 把这个文件复制一份保存
- **恢复数据** = 把备份文件复制回原位置

## 📁 项目结构

```
hexagram-ledger/
├── main/                 # Electron 主进程(唯一能碰数据库的地方)
│   ├── main.js           # 窗口、生命周期、单实例锁
│   ├── preload.js        # 桥接层(contextBridge)
│   ├── db.js             # 数据库封装(全部 SQL)
│   ├── seed-data.js      # 建表 + 分类种子数据
│   └── ipc.js            # 主进程接收渲染层请求
├── renderer/             # 界面层(HTML/CSS/JS)
│   ├── index.html        # 单页四屏(记账/明细/统计/备份)
│   ├── css/style.css
│   └── js/               # 页面逻辑 + 共享数据层(桌面/手机共用)
├── android/              # 安卓工程(Capacitor 生成)
├── assets/icon.ico       # 应用图标
└── package.json          # 项目清单与命令
```

## 📋 版本记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-17 | v0.1 | 产品规划、技术栈拍板 |
| 2026-09-17 | v0.2 | 三屏页面骨架、数据库建库、IPC 桥接 |
| 2026-09-19 | v0.3 | 收入功能、收支双线折线图、汇总卡片 |
| 2026-09-25 | v0.4 | 备份页(导出 / 导入),共享数据层拆分 |
| 2026-09-25 | v0.5 | 安卓版(Capacitor 套壳,手机本地数据库) |

## 📄 开源协议

[MIT](LICENSE)

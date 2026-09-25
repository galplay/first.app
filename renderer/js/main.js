'use strict';
// 全局入口:顶栏三屏切换 + 各屏懒加载初始化(第一次进入才初始化)

(function () {
  // 单页三屏切换:记账页随应用启动初始化;明细页、统计页第一次进入时初始化
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
      var page = document.getElementById(btn.dataset.page);
      page.classList.add('active');
      if (btn.dataset.page === 'page-list') initList();
      if (btn.dataset.page === 'page-stats') initStats();
      if (btn.dataset.page === 'page-backup') initBackup();
    });
  });

  function initList() {
    if (window.__listInited) return;
    window.__listInited = true;
    window.LedgerApp.listInit();
  }

  function initStats() {
    if (window.__statsInited) return;
    window.__statsInited = true;
    window.LedgerApp.statsInit();
  }

  function initBackup() {
    if (window.__backupInited) return;
    window.__backupInited = true;
    window.LedgerApp.backupInit();
  }

  // 启动即初始化记账页
  window.LedgerApp.entryInit();
})();

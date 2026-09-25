'use strict';
// ============================================================================
// 备份页逻辑:导出(备份)/ 导入(恢复)
// ----------------------------------------------------------------------------
// 电脑版:window.ledger.exportData() 走主进程,弹出"另存为"保存文件;
//         导入用 <input type="file"> 选文件(和手机版一致)。
// 手机版:window.ledger 是 mobile-backend.js,数据库在手机本地;
//         导出没有"保存对话框",改用系统分享面板把备份文件发给微信/QQ/网盘;
//         导入同样是 <input type="file"> 选备份文件。
//
// 界面提示文字根据平台显示不同(见 style.css:.backup-desktop / .backup-mobile)。
// ============================================================================

(function () {
  const api = window.LedgerApp.api;

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function detectPlatform() {
    // 电脑版:preload 注入的 ledger 有 platform:'desktop'
    // 手机版:mobile-backend 注入的 ledger 有 platform:'mobile'
    if (window.ledger && window.ledger.platform === 'mobile') return 'mobile';
    return 'desktop';
  }

  function applyPlatform() {
    const body = document.body;
    const p = detectPlatform();
    body.classList.remove('platform-desktop', 'platform-mobile');
    body.classList.add(p === 'mobile' ? 'platform-mobile' : 'platform-desktop');
  }

  // ===== 导出 =====
  async function onExport() {
    const btn = document.getElementById('btn-export');
    if (!btn) return;
    btn.disabled = true;
    try {
      const platform = detectPlatform();
      if (platform === 'mobile') {
        // 手机版:生成备份文本 -> 存成临时文件 -> 调系统分享面板
        const jsonText = await api.exportData();
        await exportOnMobile(jsonText);
        showToast('备份文件已生成,去微信/QQ 里选择发送给谁吧');
      } else {
        // 电脑版:主进程弹"另存为"对话框
        const result = await api.exportData();
        if (result && result.canceled) {
          showToast('已取消保存');
        } else if (result && result.path) {
          showToast('备份已保存:' + result.path);
        } else {
          showToast('导出失败,请重试');
        }
      }
    } catch (e) {
      showToast('导出失败:' + (e && e.message ? e.message : '请重试'));
    } finally {
      btn.disabled = false;
    }
  }

  // 手机版导出:写到临时目录,再调系统分享
  async function exportOnMobile(jsonText) {
    const fs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    const share = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    if (!fs || !share) throw new Error('手机文件功能不可用');

    const fileName = 'hexagram-ledger-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    const res = await fs.writeFile({
      path: fileName,
      data: jsonText,
      directory: 'CACHE',
      encoding: 'utf8',
    });
    await share.share({
      title: '六芒星记账备份',
      text: '这是我导出的记账备份文件,可以发给朋友或存到网盘。',
      url: res.uri,
      dialogTitle: '分享记账备份',
    });
    // 分享面板调完即可;缓存文件留在 CACHE 目录,系统会自动清理
  }

  // ===== 导入 =====
  function onImportFileChanged() {
    const input = document.getElementById('import-file');
    const file = input && input.files && input.files[0];
    if (!file) return;

    const mode = (document.querySelector('input[name="import-mode"]:checked') || {}).value || 'overwrite';
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await api.importData(String(reader.result || ''), mode);
        showToast('导入成功:新增 ' + result.inserted + ' 笔' + (result.skipped ? ',跳过 ' + result.skipped + ' 条不合法记录' : ''));
      } catch (e) {
        showToast('导入失败:' + (e && e.message ? e.message : '文件内容不对'));
      } finally {
        input.value = ''; // 清空,下次选同一个文件也能触发 change
      }
    };
    reader.onerror = () => {
      showToast('读取文件失败');
      input.value = '';
    };
    reader.readAsText(file, 'utf8');
  }

  function init() {
    applyPlatform();
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', onExport);
    const importBtn = document.getElementById('btn-import');
    const importFile = document.getElementById('import-file');
    if (importBtn) importBtn.addEventListener('click', () => importFile && importFile.click());
    if (importFile) importFile.addEventListener('change', onImportFileChanged);
  }

  window.LedgerApp.backupInit = init;
})();

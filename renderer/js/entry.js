'use strict';
// 记账页逻辑:底部"记一笔"表单,填写金额/日期/分类/备注,点"记一笔"保存。
// 表单校验放在这里做。

(function () {
  const { yuanToFen, today } = window.LedgerApp.utils;
  const api = window.LedgerApp.api;

  let currentType = 'expense'; // 当前记的是支出还是收入
  let categoriesCache = { expense: [], income: [] }; // 分类两组一次拿全,切换不重新请求

  // 从后台加载分类表(支出 + 收入两组)
  async function loadCategories() {
    const all = await api.listCategories();
    categoriesCache.expense = all.expense;
    categoriesCache.income = all.income;
    return categoriesCache;
  }

  // 当前类型对应的分类组
  function currentCats() {
    return categoriesCache[currentType] || [];
  }

  function renderCategorySelects() {
    const mainSelect = document.getElementById('add-category');
    if (!mainSelect) return;

    mainSelect.innerHTML = '';
    currentCats().forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.category;
      opt.textContent = c.category;
      mainSelect.appendChild(opt);
    });
    fillSubcategories(mainSelect.value);
  }

  // 大类切换时,刷新小类下拉框
  function fillSubcategories(categoryName) {
    const subSelect = document.getElementById('add-subcategory');
    if (!subSelect) return;
    const cat = currentCats().find((c) => c.category === categoryName);
    const subs = cat ? cat.subcategories : [];
    subSelect.innerHTML = '';
    subs.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      subSelect.appendChild(opt);
    });
  }

  // 支出/收入 分段切换:换高亮、重填分类下拉
  function setType(type) {
    currentType = type;
    document.querySelectorAll('#add-type-seg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
    });
    renderCategorySelects();
  }

  function validateForm(amountStr, dateStr) {
    if (!amountStr || amountStr.trim() === '') return '请填写金额';
    const fen = yuanToFen(amountStr);
    if (fen === null) return '金额格式不对,只能写数字,最多两位小数,比如 12.34';
    if (fen <= 0) return '金额要大于 0';
    if (!dateStr) return '请选择日期';
    return null;
  }

  function readForm() {
    const amountStr = document.getElementById('add-amount').value.trim();
    const dateStr = document.getElementById('add-date').value;
    const category = document.getElementById('add-category').value;
    const subcategory = document.getElementById('add-subcategory').value;
    const note = document.getElementById('add-note').value.trim();

    const err = validateForm(amountStr, dateStr);
    if (err) return { error: err };

    return {
      record: {
        amount: yuanToFen(amountStr),
        date: dateStr,
        type: currentType,
        category,
        subcategory,
        note,
      },
    };
  }

  function clearForm() {
    const amount = document.getElementById('add-amount');
    const note = document.getElementById('add-note');
    if (amount) amount.value = '';
    if (note) note.value = '';
    const date = document.getElementById('add-date');
    if (date) date.value = today();
    if (amount) amount.focus();
  }

  async function submitAdd() {
    const { error, record } = readForm();
    if (error) {
      showToast(error);
      return;
    }
    const btn = document.getElementById('btn-save');
    btn.disabled = true;
    try {
      await api.addRecord(record);
      clearForm();
      showToast('记好了 ✔');
    } catch (e) {
      // 把真实错误显示出来,方便排查(手机端数据库问题时会看到具体原因)
      var msg = e && e.message ? e.message : String(e);
      showToast('保存失败:' + msg);
    } finally {
      btn.disabled = false;
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 1800);
  }

  function init() {
    const mainSelect = document.getElementById('add-category');
    if (mainSelect) {
      mainSelect.addEventListener('change', () => fillSubcategories(mainSelect.value));
    }
    const dateInput = document.getElementById('add-date');
    if (dateInput) dateInput.value = today();

    // 支出/收入 分段切换
    document.querySelectorAll('#add-type-seg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => setType(btn.dataset.type));
    });

    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) saveBtn.addEventListener('click', submitAdd);

    // 回车快捷提交
    const form = document.getElementById('add-form');
    if (form) {
      form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          submitAdd();
        }
      });
    }

    loadCategories().then(renderCategorySelects);
  }

  window.LedgerApp.entryInit = init;
})();

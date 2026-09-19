'use strict';
// 明细页逻辑:所有账目按天分组展示,可筛选分类,每笔可修改/删除。

(function () {
  const { fenToYuan, formatDateCN, yuanToFen, isValidDate } = window.LedgerApp.utils;
  const api = window.LedgerApp.api;

  let allRecords = [];
  let currentFilter = null; // { category?, type? }
  let catData = { expense: [], income: [] }; // 分类两组缓存(筛选下拉 + 编辑弹层共用)
  let editType = 'expense'; // 编辑弹层当前的收支类型

  async function loadRecords(filter) {
    currentFilter = filter || null;
    allRecords = await api.listRecords(currentFilter);
    renderList();
  }

  // 按日期倒序分组,同一天内保持顺序
  // 注意:分组对象(含 items)和查重表必须用同一个数组,否则记录塞进去但渲染时拿不到
  function groupByDate(records) {
    const groups = [];
    const map = new Map();
    for (const r of records) {
      let group = map.get(r.date);
      if (!group) {
        group = { date: r.date, items: [] };
        map.set(r.date, group);
        groups.push(group);
      }
      group.items.push(r);
    }
    groups.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return groups;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderList() {
    const container = document.getElementById('list-body');
    if (!container) return;

    if (allRecords.length === 0) {
      container.innerHTML = '<div class="empty-tip">还没有账目,去记账页记一笔吧</div>';
      return;
    }

    const groups = groupByDate(allRecords);
    let html = '';
    for (const g of groups) {
      html += '<div class="day-group">';
      html += '<div class="day-header"><span>' + formatDateCN(g.date) + '</span></div>';
      for (const r of g.items) {
        html += renderRecordRow(r);
      }
      html += '</div>';
    }
    container.innerHTML = html;

    bindRowActions();
  }

  function renderRecordRow(r) {
    const isIncome = r.type === 'income';
    const sign = isIncome ? '+' : '-';
    return (
      '<div class="record-row" data-id="' + r.id + '">' +
        '<div class="record-info">' +
          '<div class="record-cat">' + r.category + ' · ' + r.subcategory + '</div>' +
          (r.note ? '<div class="record-note">' + escapeHtml(r.note) + '</div>' : '') +
        '</div>' +
        '<div class="record-amount' + (isIncome ? ' income' : '') + '">' + sign + '¥' + fenToYuan(r.amount) + '</div>' +
        '<div class="record-actions">' +
          '<button class="btn-edit" data-id="' + r.id + '">改</button>' +
          '<button class="btn-del" data-id="' + r.id + '">删</button>' +
        '</div>' +
      '</div>'
    );
  }

  // 根据两个筛选下拉拼过滤条件(类型 + 分类)
  function buildFilter() {
    const typeSelect = document.getElementById('filter-type');
    const catSelect = document.getElementById('filter-category');
    const type = typeSelect ? typeSelect.value : '';
    const category = catSelect ? catSelect.value : '';
    const filter = {};
    if (type) filter.type = type;
    if (category) filter.category = category;
    return Object.keys(filter).length ? filter : null;
  }

  // 分类下拉:按当前"收支类型"筛选显示哪组分类
  async function renderCategoryFilter() {
    const select = document.getElementById('filter-category');
    if (!select) return;
    const typeSelect = document.getElementById('filter-type');
    const type = typeSelect ? typeSelect.value : '';

    select.innerHTML = '<option value="">全部分类</option>';
    const groupList = type ? [type] : ['expense', 'income'];
    for (const t of groupList) {
      const cats = catData[t] || [];
      if (cats.length) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = t === 'expense' ? '支出' : '收入';
        cats.forEach((c) => {
          const opt = document.createElement('option');
          opt.value = c.category;
          opt.textContent = c.category;
          optGroup.appendChild(opt);
        });
        select.appendChild(optGroup);
      }
    }
    select.value = currentFilter ? currentFilter.category || '' : '';
  }

  // 收支类型下拉 + 分类下拉 联动
  async function setupFilter() {
    const typeSelect = document.getElementById('filter-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', async () => {
        await renderCategoryFilter();
        loadRecords(buildFilter());
      });
    }
    const catSelect = document.getElementById('filter-category');
    if (catSelect) {
      catSelect.addEventListener('change', () => {
        loadRecords(buildFilter());
      });
    }
    await renderCategoryFilter();
  }

  function bindRowActions() {
    document.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', () => openEditModal(Number(btn.dataset.id)));
    });
    document.querySelectorAll('.btn-del').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        if (confirm('确定删除这笔账吗?删除后无法恢复。')) {
          api.removeRecord(id).then(() => {
            loadRecords(currentFilter);
          });
        }
      });
    });
  }

  // ===== 编辑弹层 =====
  function openEditModal(id) {
    const r = allRecords.find((x) => x.id === id);
    if (!r) return;

    setEditType(r.type || 'expense');
    document.getElementById('edit-id').value = r.id;
    document.getElementById('edit-amount').value = fenToYuan(r.amount);
    document.getElementById('edit-date').value = r.date;
    document.getElementById('edit-note').value = r.note || '';
    document.getElementById('edit-category').value = r.category;
    fillEditSubcategories(r.category, r.subcategory);

    document.getElementById('edit-modal').style.display = 'flex';
  }

  // 编辑弹层的 支出/收入 切换:换高亮、重填分类小类
  function setEditType(type) {
    editType = type;
    document.querySelectorAll('#edit-type-seg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
    });
    fillEditCategories();
  }

  function fillEditCategories() {
    const catSelect = document.getElementById('edit-category');
    if (!catSelect) return;
    const cats = catData[editType] || [];
    catSelect.innerHTML = '';
    cats.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.category;
      opt.textContent = c.category;
      catSelect.appendChild(opt);
    });
    fillEditSubcategories(catSelect.value);
  }

  function findSubs(category) {
    const cats = catData[editType] || [];
    const cat = cats.find((c) => c.category === category);
    return cat ? cat.subcategories : [];
  }

  function fillEditSubcategories(category, selectedSub) {
    const subSelect = document.getElementById('edit-subcategory');
    if (!subSelect) return;
    const sub = category ? findSubs(category) : [];
    subSelect.innerHTML = '';
    sub.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      if (s === selectedSub) opt.selected = true;
      subSelect.appendChild(opt);
    });
  }

  function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
  }

  async function saveEdit() {
    const id = Number(document.getElementById('edit-id').value);
    const amountStr = document.getElementById('edit-amount').value.trim();
    const dateStr = document.getElementById('edit-date').value;
    const category = document.getElementById('edit-category').value;
    const subcategory = document.getElementById('edit-subcategory').value;
    const note = document.getElementById('edit-note').value.trim();

    const fen = yuanToFen(amountStr);
    if (fen === null || fen <= 0) {
      alert('金额格式不对');
      return;
    }
    if (!isValidDate(dateStr)) {
      alert('日期格式不对');
      return;
    }

    await api.updateRecord(id, {
      amount: fen,
      date: dateStr,
      type: editType,
      category,
      subcategory,
      note,
    });
    closeEditModal();
    loadRecords(currentFilter);
  }

  async function init() {
    const catSelect = document.getElementById('edit-category');
    if (catSelect) {
      catSelect.addEventListener('change', () => {
        fillEditSubcategories(catSelect.value);
      });
    }
    // 编辑弹层 支出/收入 切换
    document.querySelectorAll('#edit-type-seg .seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => setEditType(btn.dataset.type));
    });
    const closeBtn = document.getElementById('edit-cancel');
    if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
    const saveBtn = document.getElementById('edit-save');
    if (saveBtn) saveBtn.addEventListener('click', saveEdit);

    // 分类表(支出 + 收入两组)缓存,筛选下拉和编辑弹层共用
    const cats = await api.listCategories();
    catData.expense = cats.expense;
    catData.income = cats.income;

    await setupFilter();
    await loadRecords(null);
  }

  window.LedgerApp.listInit = init;
})();

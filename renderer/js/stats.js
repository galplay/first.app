'use strict';
// 统计页逻辑:月度/年度切换,汇总卡片(支出/收入/结余/笔数) + 环形图(支出分类占比) + 折线图(收支双线趋势)

(function () {
  const { fenToYuan } = window.LedgerApp.utils;
  const api = window.LedgerApp.api;

  const CATEGORY_COLORS = [
    '#e74c3c', '#3498db', '#f39c12', '#2ecc71', '#9b59b6',
    '#e67e22', '#1abc9c', '#f1c40f', '#7f8c8d',
  ];

  const EXPENSE_COLOR = '#3498db';
  const INCOME_COLOR = '#27ae60';

  let pieChart = null;
  let lineChart = null;

  let currentView = 'month';   // 'month' | 'year'
  let currentYear = new Date().getFullYear();
  let currentMonth = new Date().getMonth() + 1; // 1-12

  function init() {
    const monthBtn = document.getElementById('view-month');
    const yearBtn = document.getElementById('view-year');
    if (monthBtn) monthBtn.addEventListener('click', () => setView('month'));
    if (yearBtn) yearBtn.addEventListener('click', () => setView('year'));

    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    if (prevBtn) prevBtn.addEventListener('click', goPrev);
    if (nextBtn) nextBtn.addEventListener('click', goNext);

    refresh();
  }

  function setView(view) {
    currentView = view;
    document.getElementById('view-month').classList.toggle('active', view === 'month');
    document.getElementById('view-year').classList.toggle('active', view === 'year');
    document.getElementById('btn-prev').textContent = view === 'month' ? '‹ 上月' : '‹ 上一年';
    document.getElementById('btn-next').textContent = view === 'month' ? '下月 ›' : '下一年 ›';
    refresh();
  }

  function goPrev() {
    if (currentView === 'month') {
      currentMonth -= 1;
      if (currentMonth < 1) { currentMonth = 12; currentYear -= 1; }
    } else {
      currentYear -= 1;
    }
    refresh();
  }

  function goNext() {
    if (currentView === 'month') {
      currentMonth += 1;
      if (currentMonth > 12) { currentMonth = 1; currentYear += 1; }
    } else {
      currentYear += 1;
    }
    refresh();
  }

  function titleText() {
    if (currentView === 'month') {
      return currentYear + '年' + currentMonth + '月';
    }
    return currentYear + '年';
  }

  async function refresh() {
    const title = document.getElementById('stats-title');
    if (title) title.textContent = titleText();

    const opts = currentView === 'month'
      ? { year: currentYear, month: String(currentYear) + '-' + String(currentMonth).padStart(2, '0') }
      : { year: currentYear };

    const [card, catSummary, daySummary] = await Promise.all([
      api.summaryCard(opts),
      api.summaryByCategory(opts),
      api.summaryByDay(opts),
    ]);

    renderCards(card);
    renderPie(catSummary);
    renderLine(daySummary);
  }

  function renderCards(card) {
    const expenseEl = document.getElementById('stat-expense');
    const incomeEl = document.getElementById('stat-income');
    const balanceEl = document.getElementById('stat-balance');
    const countEl = document.getElementById('stat-count');
    if (!expenseEl) return;

    expenseEl.textContent = '¥' + fenToYuan(card.expense);
    incomeEl.textContent = '¥' + fenToYuan(card.income);

    // 结余 = 收入 - 支出,正数前面加 +,负数显示红色
    balanceEl.textContent = (card.balance >= 0 ? '+¥' : '-¥') + fenToYuan(Math.abs(card.balance));
    balanceEl.classList.toggle('negative', card.balance < 0);

    countEl.textContent = card.count + ' 笔';
  }

  function renderPie(catSummary) {
    const canvas = document.getElementById('pie-chart');
    if (!canvas) return;

    const labels = catSummary.map((c) => c.category);
    const data = catSummary.map((c) => c.total);
    const colors = labels.map((_, i) => CATEGORY_COLORS[i % CATEGORY_COLORS.length]);

    if (pieChart) {
      pieChart.data.labels = labels;
      pieChart.data.datasets[0].data = data;
      pieChart.data.datasets[0].backgroundColor = colors;
      pieChart.update();
      return;
    }

    pieChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { boxWidth: 14, padding: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = fenToYuan(ctx.parsed);
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0;
                return ' ' + ctx.label + ': ¥' + v + ' (' + pct + '%)';
              },
            },
          },
        },
      },
    });
  }

  function renderLine(daySummary) {
    const canvas = document.getElementById('line-chart');
    if (!canvas) return;

    if (currentView === 'month') {
      const days = new Date(currentYear, currentMonth, 0).getDate();
      renderMonthlyLine(daySummary, days);
    } else {
      renderYearlyLine(daySummary);
    }
  }

  function renderMonthlyLine(daySummary, days) {
    const labels = [];
    const expenseData = new Array(days).fill(0);
    const incomeData = new Array(days).fill(0);
    const expenseMap = new Map(daySummary.expense.map((d) => [d.date, d.total]));
    const incomeMap = new Map(daySummary.income.map((d) => [d.date, d.total]));
    for (let i = 1; i <= days; i++) {
      labels.push(i + '日');
      const key = String(currentYear) + '-' + String(currentMonth).padStart(2, '0') + '-' + String(i).padStart(2, '0');
      expenseData[i - 1] = expenseMap.get(key) || 0;
      incomeData[i - 1] = incomeMap.get(key) || 0;
    }
    setLineChart(labels, expenseData, incomeData);
  }

  function renderYearlyLine(daySummary) {
    const labels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    const expenseTotals = new Array(12).fill(0);
    const incomeTotals = new Array(12).fill(0);
    for (const d of daySummary.expense) {
      expenseTotals[parseInt(d.date.split('-')[1], 10) - 1] += d.total;
    }
    for (const d of daySummary.income) {
      incomeTotals[parseInt(d.date.split('-')[1], 10) - 1] += d.total;
    }
    setLineChart(labels, expenseTotals, incomeTotals);
  }

  function setLineChart(labels, expenseData, incomeData) {
    const canvas = document.getElementById('line-chart');

    if (lineChart) {
      lineChart.data.labels = labels;
      lineChart.data.datasets[0].data = expenseData;
      lineChart.data.datasets[1].data = incomeData;
      lineChart.update();
      return;
    }

    lineChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '支出',
            data: expenseData,
            borderColor: EXPENSE_COLOR,
            backgroundColor: 'rgba(52, 152, 219, 0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: '收入',
            data: incomeData,
            borderColor: INCOME_COLOR,
            backgroundColor: 'rgba(39, 174, 96, 0.12)',
            fill: false,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => ' ' + ctx.dataset.label + ': ¥' + fenToYuan(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: (v) => fenToYuan(v) },
          },
        },
      },
    });
  }

  window.LedgerApp.statsInit = init;
})();

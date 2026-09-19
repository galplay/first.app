'use strict';
// 工具函数:金额、日期相关。界面层全局挂一个 LedgerApp 命名空间。
window.LedgerApp = window.LedgerApp || {};

// ===== 金额工具:单位是"分"(1 元 = 100 分),一律存整数,避免小数误差 =====

// 把"元"字符串转成"分"整数。如 "12.34" -> 1234,"5" -> 500
// 传错格式返回 null,调用处负责提示
function yuanToFen(str) {
  if (typeof str !== 'string') str = String(str);
  str = str.trim();
  if (!str) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(str)) return null;
  const [intPart, decPart = ''] = str.split('.');
  return parseInt(intPart, 10) * 100 + parseInt(decPart.padEnd(2, '0') || '0', 10);
}

// 把"分"整数转成"元"字符串,保留两位小数。如 1234 -> "12.34"
function fenToYuan(fen) {
  const yuan = Math.floor(fen / 100);
  const rest = fen % 100;
  return yuan + '.' + String(rest).padStart(2, '0');
}

// ===== 日期工具:统一 YYYY-MM-DD 字符串 =====

// 今天,返回 "YYYY-MM-DD"
function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 把 Date 对象转成 "YYYY-MM-DD"
function toDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// 判断字符串是不是合法日期 "YYYY-MM-DD"
function isValidDate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str);
  return !isNaN(d.getTime()) && toDateStr(d) === str;
}

// 格式化显示: "2026-09-17" -> "9月17日"
function formatDateCN(str) {
  const [y, m, d] = str.split('-').map((x) => parseInt(x, 10));
  return m + '月' + d + '日';
}

window.LedgerApp.utils = {
  yuanToFen: yuanToFen,
  fenToYuan: fenToYuan,
  today: today,
  toDateStr: toDateStr,
  isValidDate: isValidDate,
  formatDateCN: formatDateCN,
};

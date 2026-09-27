'use strict';
// 贪吃蛇小游戏:Canvas 画布实现,顶部 🎮 按钮打开全屏覆盖层
// 电脑用方向键/WASD 控制(按住 Shift 加速),安卓手机用手指滑动(长按屏幕加速)
// 最高分存浏览器本地存储,不碰记账数据库

(function () {
  var GRID = 20;           // 棋盘 20×20 格
  var BASE_SPEED = 1000;   // 起步最慢:每格 1 秒
  var SPEED_FACTOR = 0.93; // 每吃一个食物,每步时间 ×0.93(约快 7%),越吃越快
  var MIN_SPEED = 80;      // 快到极限就不再加了(每格毫秒数)
  var BOOST_MULT = 0.45;   // 加速时每步时间 ×0.45(约 2.2 倍速)
  var MIN_BOOST = 40;      // 加速后的最快限制(每格毫秒数)
  var BEST_KEY = 'snake_best_score';

  var overlay = document.getElementById('game-overlay');
  var canvas = document.getElementById('game-canvas');
  var ctx = canvas.getContext('2d');
  var scoreEl = document.getElementById('game-score');
  var bestEl = document.getElementById('game-best');
  var startBtn = document.getElementById('game-start');
  var closeBtn = document.getElementById('game-close');

  // 颜色直接用 App 的 CSS 主题色,风格统一;拿不到就退回默认值
  var COLORS = { bg: '#fff', grid: '#e8eaf0', snake: '#3498db', food: '#e74c3c', text: '#2c3e50', muted: '#95a5a6' };
  function themeColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  var snake = [];          // 蛇身各节,第 0 个是蛇头
  var dir = { x: 1, y: 0 };
  var nextDir = dir;       // 本步待生效方向(防止一帧内快速连按造成 180° 回头)
  var food = null;
  var score = 0;
  var best = 0;
  var state = 'idle';      // idle 准备 | running 进行 | paused 暂停 | over 结束
  var rafId = 0;
  var lastTime = 0;
  var acc = 0;
  var speed = BASE_SPEED;
  var cell = 20;           // 每格 CSS 像素,打开时按画布实际大小算
  var cssSize = 400;       // 画布实际显示边长(CSS 像素)
  var isMobile = false;    // 手机上提示文字换成"手指滑动"
  var boosting = false;    // 是否正在加速(电脑按住 Shift / 手机长按屏幕)
  var boostTimer = 0;      // 手机长按计时器

  // 每吃一个,每步时间按比例缩短(起步 1 秒,逐渐加快)
  function speedOf(s) { return Math.max(MIN_SPEED, BASE_SPEED * Math.pow(SPEED_FACTOR, s)); }

  // 当前实际每步用时:加速时更短
  function stepTime() { return boosting ? Math.max(MIN_BOOST, speed * BOOST_MULT) : speed; }

  function loadBest() {
    try { best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0; } catch (e) { best = 0; }
    bestEl.textContent = best;
  }
  function saveBest() {
    if (score > best) {
      best = score;
      bestEl.textContent = best;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* 隐私模式等场景忽略 */ }
    }
  }

  // 画布按实际显示尺寸 + 设备像素比调整,保证高分屏上也清晰
  function resizeCanvas() {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cssSize = Math.max(1, rect.width);
    cell = cssSize / GRID;
  }

  function onSnake(x, y) {
    for (var i = 0; i < snake.length; i++) {
      if (snake[i].x === x && snake[i].y === y) return true;
    }
    return false;
  }

  // 食物只出现在空格上
  function spawnFood() {
    var empty = [];
    for (var x = 0; x < GRID; x++) {
      for (var y = 0; y < GRID; y++) {
        if (!onSnake(x, y)) empty.push({ x: x, y: y });
      }
    }
    food = empty.length ? empty[Math.floor(Math.random() * empty.length)] : null;
  }

  function setDir(d) {
    if (d.x === -dir.x && d.y === -dir.y && snake.length > 1) return; // 不允许掉头
    nextDir = d;
  }

  // 走一步
  function step() {
    dir = nextDir;
    var head = snake[0];
    var nx = head.x + dir.x;
    var ny = head.y + dir.y;
    if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) { gameOver(); return; } // 撞墙
    for (var i = 0; i < snake.length - 1; i++) {                            // 撞自己
      if (snake[i].x === nx && snake[i].y === ny) { gameOver(); return; }
    }
    snake.unshift({ x: nx, y: ny });
    if (food && nx === food.x && ny === food.y) {
      score++;
      scoreEl.textContent = score;
      speed = speedOf(score);
      spawnFood();
    } else {
      snake.pop(); // 尾巴往前走一步(没吃到就挪开)
    }
  }

  function gameOver() {
    state = 'over';
    saveBest();
    updateStartBtn();
    draw();
  }

  function resetGame() {
    snake = [{ x: 7, y: 10 }, { x: 6, y: 10 }, { x: 5, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    speed = BASE_SPEED;
    boosting = false;
    acc = 0;
    lastTime = 0;
    scoreEl.textContent = 0;
    spawnFood();
  }

  function beginLoop() {
    state = 'running';
    updateStartBtn();
    lastTime = performance.now();
    acc = 0;
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function startGame() {
    resetGame();
    beginLoop();
  }

  function togglePause() {
    if (state === 'running') {
      state = 'paused';
      lastTime = 0;
      updateStartBtn();
      draw();
    } else if (state === 'paused') {
      beginLoop(); // 继续 = 接着跑,不清空蛇
    }
  }

  function loop(now) {
    if (state !== 'running') { rafId = 0; return; }
    if (!lastTime) lastTime = now;
    var dt = now - lastTime;
    lastTime = now;
    if (dt > 250) dt = 250; // 切走窗口再回来,别一口气追太多步
    acc += dt;
    while (acc >= stepTime()) {
      acc -= stepTime();
      step();
      if (state !== 'running') break; // 游戏结束就停
    }
    draw();
    if (state === 'running') rafId = requestAnimationFrame(loop);
    else rafId = 0;
  }

  function stopLoop() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function updateStartBtn() {
    if (state === 'running') startBtn.textContent = '暂停';
    else if (state === 'paused') startBtn.textContent = '继续';
    else if (state === 'over') startBtn.textContent = '再来一局';
    else startBtn.textContent = '开始游戏';
  }

  // ===== 绘制 =====
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawMessage(title, sub) {
    var s = cssSize;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(0, s * 0.36, s, s * 0.3);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + Math.max(18, cell * 2.2) + 'px "Microsoft YaHei", sans-serif';
    ctx.fillText(title, s / 2, s * 0.46);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px "Microsoft YaHei", sans-serif';
    ctx.fillText(sub, s / 2, s * 0.56);
  }

  function draw() {
    resizeCanvas();
    var s = cssSize;
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, s, s);
    // 网格线
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var i = 1; i < GRID; i++) {
      var p = Math.round(i * cell) + 0.5;
      ctx.moveTo(p, 0); ctx.lineTo(p, s);
      ctx.moveTo(0, p); ctx.lineTo(s, p);
    }
    ctx.stroke();
    // 食物(红色圆角方块)
    if (food) {
      var f = cell * 0.18;
      ctx.fillStyle = COLORS.food;
      roundRect(food.x * cell + f, food.y * cell + f, cell - 2 * f, cell - 2 * f, cell * 0.22);
    }
    // 蛇(蓝色圆角方块,头比身深一点)
    for (var j = snake.length - 1; j >= 0; j--) {
      var seg = snake[j];
      var inset = cell * 0.1;
      ctx.fillStyle = j === 0 ? COLORS.text : COLORS.snake;
      roundRect(seg.x * cell + inset, seg.y * cell + inset, cell - 2 * inset, cell - 2 * inset, cell * 0.28);
    }
    // 加速中提示(左上角小红标)
    if (boosting && state === 'running') {
      var bw = s * 0.34, bh = s * 0.085;
      ctx.fillStyle = COLORS.food;
      roundRect(s * 0.035, s * 0.035, bw, bh, bh / 2);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + Math.round(bh * 0.55) + 'px "Microsoft YaHei", sans-serif';
      ctx.fillText('⚡ 加速中', s * 0.035 + bw / 2, s * 0.035 + bh / 2);
    }
    // 状态提示
    if (state === 'idle') {
      drawMessage('准备开始', isMobile ? '点「开始游戏」,滑动控制,长按屏幕加速' : '按「开始游戏」,方向键 / WASD,按住 Shift 加速');
    } else if (state === 'paused') {
      drawMessage('已暂停', '点「继续」或按空格键继续');
    } else if (state === 'over') {
      drawMessage('游戏结束', '本局得分 ' + score + (best > 0 ? ' · 最高纪录 ' + best : ''));
    }
  }

  // ===== 打开 / 关闭 =====
  function openGame() {
    overlay.classList.add('show');
    stopLoop();
    resetGame();
    state = 'idle';
    updateStartBtn();
    draw();
  }

  function closeGame() {
    stopLoop();
    overlay.classList.remove('show');
    state = 'idle';
    boosting = false;
    clearTimeout(boostTimer);
    updateStartBtn();
  }

  // ===== 事件绑定 =====
  function bindEvents() {
    startBtn.addEventListener('click', function () {
      if (state === 'running' || state === 'paused') togglePause();
      else startGame();
    });
    closeBtn.addEventListener('click', closeGame);
    document.getElementById('btn-game').addEventListener('click', openGame);

    window.addEventListener('keydown', function (e) {
      if (!overlay.classList.contains('show')) return;
      var d = null;
      switch (e.code) {
        case 'ArrowUp': case 'KeyW': d = { x: 0, y: -1 }; break;
        case 'ArrowDown': case 'KeyS': d = { x: 0, y: 1 }; break;
        case 'ArrowLeft': case 'KeyA': d = { x: -1, y: 0 }; break;
        case 'ArrowRight': case 'KeyD': d = { x: 1, y: 0 }; break;
        case 'ShiftLeft': case 'ShiftRight': boosting = true; return; // 按住 Shift 加速
        case 'Space': case 'KeyP':
          e.preventDefault();
          if (state === 'idle' || state === 'over') startGame();
          else togglePause();
          return;
        case 'Escape':
          closeGame();
          return;
      }
      if (d) {
        e.preventDefault();
        if (state === 'running' || state === 'idle') setDir(d);
      }
    });

    window.addEventListener('keyup', function (e) {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') boosting = false; // 松开 Shift 就恢复
    });
    // 窗口切走时清掉加速,免得"抬键"没收到导致一直冲
    window.addEventListener('blur', function () { boosting = false; });

    // 手机:滑动控制方向 + 长按加速
    var tx = 0, ty = 0;
    overlay.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      tx = t.clientX; ty = t.clientY;
      // 长按 180 毫秒才加速,普通点击/滑动不会误触发
      clearTimeout(boostTimer);
      boostTimer = setTimeout(function () { boosting = true; }, 180);
    }, { passive: true });
    overlay.addEventListener('touchend', function (e) {
      clearTimeout(boostTimer);
      boosting = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - tx, dy = t.clientY - ty;
      if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // 太短的滑动(点按钮)不算
      var d = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 })
        : (dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 });
      if (state === 'running' || state === 'idle') setDir(d);
    }, { passive: true });
    overlay.addEventListener('touchcancel', function () {
      clearTimeout(boostTimer);
      boosting = false;
    }, { passive: true });

    window.addEventListener('resize', function () {
      if (overlay.classList.contains('show')) draw();
    });
  }

  function init() {
    isMobile = !!(window.ledger && window.ledger.platform === 'mobile');
    COLORS.bg = themeColor('--card', COLORS.bg);
    COLORS.grid = themeColor('--border', COLORS.grid);
    COLORS.snake = themeColor('--primary', COLORS.snake);
    COLORS.food = themeColor('--danger', COLORS.food);
    COLORS.text = themeColor('--text', COLORS.text);
    COLORS.muted = themeColor('--muted', COLORS.muted);
    loadBest();
    bindEvents();
    draw();
  }

  window.LedgerApp = window.LedgerApp || {};
  window.LedgerApp.snakeInit = init;
})();

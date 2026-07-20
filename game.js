const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const W = 400;
const H = 600;

const ROAD_X = 80;
const ROAD_W = 240;
const LANE_W = ROAD_W / 3;

const PLAYER_W = 40;
const PLAYER_H = 56;
const PLAYER_SPEED = 5;
const PLAYER_Y = H - 120;

const INITIAL_SPEED = 3;
const SPEED_INCREASE = 0.8;
const SCORE_PER_SPEEDUP = 500;

const MAX_LIVES = 3;
const INVINCIBLE_FRAMES = 60;

const SPAWN_INTERVAL_INIT = 60;
const SPAWN_INTERVAL_MIN = 25;

const FRAME_SCORE = 1;
const SCORE_TICK = 2;
const STORAGE_KEY = 'gyrodrive_highscore';

function loadHighScore() {
  try { return parseInt(localStorage.getItem(STORAGE_KEY)) || 0; }
  catch { return 0; }
}

function saveHighScore(score) {
  try {
    const prev = loadHighScore();
    if (score > prev) localStorage.setItem(STORAGE_KEY, '' + Math.floor(score));
  } catch {}
}

const LANE_CENTERS = [
  ROAD_X + LANE_W / 2,
  ROAD_X + LANE_W + LANE_W / 2,
  ROAD_X + LANE_W * 2 + LANE_W / 2,
];

const PAUSE_BTN = { x: W - 44, y: 34, w: 36, h: 28 };
const SHIELD_DURATION = 180;
const SHIELD_COOLDOWN = 600;
const SHIELD_BTN = { x: W - 44, y: H - 70, w: 36, h: 28 };

const bgMusic = new Audio('audio/bg.mp3');
bgMusic.loop = true;
bgMusic.volume = 0.5;

const sfxHit = new Audio('audio/hit.mp3');
sfxHit.volume = 0.5;
const sfxWhoosh = new Audio('audio/whoosh.mp3');
sfxWhoosh.volume = 0.7;
const sfxShield = new Audio('audio/shield_on.mp3');
sfxShield.volume = 0.5;
const sfxGameover = new Audio('audio/gameover.mp3');
sfxGameover.volume = 0.6;

const socket = io();
let targetX = null;
let controllerConnected = false;

let game;

function initGame() {
  game = {
    speed: INITIAL_SPEED,
    score: 0,
    lives: MAX_LIVES,
    invincible: 0,
    playerX: LANE_CENTERS[1] - PLAYER_W / 2,
    playerY: PLAYER_Y,
    enemies: [],
    spawnTimer: SPAWN_INTERVAL_INIT,
    spawnInterval: SPAWN_INTERVAL_INIT,
    roadOffset: 0,
    scoreTick: 0,
    gameOver: false,
    started: false,
    paused: false,
    shieldActive: false,
    shieldTimer: 0,
    shieldCooldown: 0,
    particles: [],
    keys: { left: false, right: false },
  };
}

initGame();

let muted = false;

function startAudio() {
  if (muted) return;
  bgMusic.play().catch(() => {});
}

function stopAudio() {
  bgMusic.pause();
  bgMusic.currentTime = 0;
}

function pauseAudio() {
  bgMusic.pause();
}

function resumeAudio() {
  if (muted) return;
  bgMusic.play().catch(() => {});
}

function toggleMute() {
  muted = !muted;
  if (muted) {
    bgMusic.pause();
  } else if (game.started && !game.gameOver) {
    bgMusic.play().catch(() => {});
  }
  updateMuteBtn();
}

function updateMuteBtn() {
  const btn = document.getElementById('mute-btn');
  if (btn) btn.textContent = muted ? '\uD83D\uDD07' : '\uD83D\uDD0A';
}

function playSfx(audio) {
  if (muted) return;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

// --- Input ---

document.addEventListener('keydown', (e) => {
  const key = e.key;
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
    if (e.repeat) return;
    game.keys.left = true;
    if (game.started && !game.gameOver && !game.paused) playSfx(sfxWhoosh);
  }
  if (key === 'ArrowRight' || key === 'd' || key === 'D') {
    if (e.repeat) return;
    game.keys.right = true;
    if (game.started && !game.gameOver && !game.paused) playSfx(sfxWhoosh);
  }
  if (key === ' ' || key === 'Space') {
    e.preventDefault();
    if (game.paused) return;
    if (!game.started) {
      game.started = true;
      startAudio();
    } else if (game.gameOver) {
      initGame();
      game.started = true;
      startAudio();
    }
  }
  if (key === 'Escape' && game.started && !game.gameOver) {
    game.paused = !game.paused;
    if (game.paused) pauseAudio(); else resumeAudio();
  }
  if (key === 'Shift' && game.started && !game.gameOver && !game.paused && game.shieldCooldown === 0 && !game.shieldActive) {
    activateShield();
  }
});

document.addEventListener('keyup', (e) => {
  const key = e.key;
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') game.keys.left = false;
  if (key === 'ArrowRight' || key === 'd' || key === 'D') game.keys.right = false;
});

canvas.addEventListener('click', (e) => {
  if (game.started && !game.gameOver) {
    const bx = PAUSE_BTN.x, by = PAUSE_BTN.y, bw = PAUSE_BTN.w, bh = PAUSE_BTN.h;
    if (
      e.offsetX >= bx && e.offsetX <= bx + bw &&
      e.offsetY >= by && e.offsetY <= by + bh
    ) {
      game.paused = !game.paused;
      return;
    }
    const sb = SHIELD_BTN;
    if (
      e.offsetX >= sb.x && e.offsetX <= sb.x + sb.w &&
      e.offsetY >= sb.y && e.offsetY <= sb.y + sb.h
    ) {
      if (game.shieldCooldown === 0 && !game.shieldActive && !game.paused) {
        activateShield();
      }
      return;
    }
    if (game.paused) return;
  }
  if (!game.started) {
    game.started = true;
    startAudio();
  } else if (game.gameOver) {
    initGame();
    game.started = true;
    startAudio();
  }
});

document.getElementById('mute-btn').addEventListener('click', toggleMute);
updateMuteBtn();

socket.on('connect', () => socket.emit('join_game'));

socket.on('tilt', (data) => {
  const gamma = Math.max(-45, Math.min(45, data.gamma));
  const roadStart = ROAD_X;
  const roadEnd = ROAD_X + ROAD_W - PLAYER_W;
  const t = (gamma + 45) / 90;
  targetX = roadStart + t * (roadEnd - roadStart);
});

socket.on('controller_status', (data) => {
  controllerConnected = data.connected;
  updateStatusText();
});

socket.on('shield', () => {
  if (game.started && !game.gameOver && !game.paused && game.shieldCooldown === 0 && !game.shieldActive) {
    activateShield();
  }
});

function updateStatusText() {
  const el = document.getElementById('status-text');
  el.textContent = controllerConnected ? '\u27D0 PHONE CONNECTED' : '\u27D0 KEYBOARD MODE';
  const dot = document.getElementById('connection-dot');
  dot.style.background = controllerConnected ? '#00ff88' : '#333';
  dot.style.boxShadow = controllerConnected ? '0 0 6px #00ff88' : 'none';
}

// --- Pixel art grid ---
// 0=transparent, 1=body, 2=bodyDark, 3=windshield, 4=headlight,
// 5=taillight, 6=wheel, 7=bumper, 8=detail

// Player car: 10 wide x 14 tall, pixel=4px -> 40x56
const PLAYER_PIXELS = [
  [0,0,0,4,4,4,4,0,0,0],
  [0,0,1,1,1,1,1,1,0,0],
  [0,1,1,1,1,1,1,1,1,0],
  [0,1,3,3,3,3,3,3,1,0],
  [0,1,3,3,3,3,3,3,1,0],
  [6,1,1,1,1,1,1,1,1,6],
  [1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1,1,1],
  [6,1,1,1,1,1,1,1,1,6],
  [0,1,1,1,1,1,1,1,1,0],
  [0,0,1,5,5,5,5,1,0,0],
  [0,0,0,7,7,7,7,0,0,0],
];

const PLAYER_COLORS = {
  1: '#00d2ff',
  2: '#0099cc',
  3: '#1a1a3e',
  4: '#ffff66',
  5: '#ff4444',
  6: '#222222',
  7: '#888888',
};

// Enemy car: 8 wide x 12 tall, pixel=4px -> 32x48
const ENEMY_PIXELS = [
  [0,0,7,7,7,7,0,0],
  [0,1,5,5,5,5,1,0],
  [6,1,1,1,1,1,1,6],
  [1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1],
  [6,1,1,1,1,1,1,6],
  [0,1,3,3,3,3,1,0],
  [0,1,3,3,3,3,1,0],
  [0,0,1,1,1,1,0,0],
  [0,0,0,4,4,0,0,0],
];

const ENEMY_COLORS = {
  1: '#e94560',
  2: '#c43a52',
  3: '#1a1a3e',
  4: '#ffff66',
  5: '#ff4444',
  6: '#222222',
  7: '#888888',
};

// --- Drawing ---

function drawRoad() {
  ctx.fillStyle = '#16213e';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#1e2a4a';
  ctx.fillRect(ROAD_X - 4, 0, 4, H);
  ctx.fillRect(ROAD_X + ROAD_W, 0, 4, H);

  ctx.fillStyle = '#2a2a3e';
  ctx.fillRect(ROAD_X, 0, ROAD_W, H);

  const lineX1 = ROAD_X + LANE_W;
  const lineX2 = ROAD_X + LANE_W * 2;
  const dashH = 20;
  const gapH = 20;
  const cycle = dashH + gapH;
  const offset = game.roadOffset % cycle;

  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.35;

  for (let y = -cycle + offset; y < H; y += cycle) {
    ctx.fillRect(lineX1 - 1, y, 2, dashH);
    ctx.fillRect(lineX2 - 1, y, 2, dashH);
  }

  ctx.globalAlpha = 1;
}

function drawPixelCar(x, y, w, h, pixels, colors) {
  const rows = pixels.length;
  const cols = pixels[0].length;
  const px = w / cols;
  const py = h / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const ci = pixels[row][col];
      if (ci === 0) continue;
      ctx.fillStyle = colors[ci];
      ctx.fillRect(
        Math.floor(x + col * px),
        Math.floor(y + row * py),
        Math.ceil(px),
        Math.ceil(py)
      );
    }
  }
}

function drawPlayerCar(x, y) {
  ctx.save();
  if (game.invincible > 0 && Math.floor(game.invincible / 4) % 2 === 0) {
    ctx.globalAlpha = 0.35;
  }
  drawPixelCar(x, y, PLAYER_W, PLAYER_H, PLAYER_PIXELS, PLAYER_COLORS);
  ctx.restore();
}

function drawEnemyCar(x, y, w, h) {
  drawPixelCar(x, y, w, h, ENEMY_PIXELS, ENEMY_COLORS);
}

function drawHUD() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, 30);

  ctx.font = 'bold 14px "Courier New", monospace';
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  for (let i = 0; i < MAX_LIVES; i++) {
    ctx.fillStyle = i < game.lives ? '#ff4466' : 'rgba(255,68,102,0.2)';
    ctx.fillText('\u2665', 10 + i * 22, 16);
  }

  ctx.fillStyle = '#ffd700';
  ctx.textAlign = 'center';
  ctx.fillText('\uD83C\uDFC6 ' + Math.floor(game.score), W / 2, 16);

  ctx.fillStyle = '#00d2ff';
  ctx.textAlign = 'right';
  ctx.fillText('SPD ' + game.speed.toFixed(1), W - 10, 16);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#e94560';
  ctx.font = 'bold 32px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GAME OVER', W / 2, H / 2 - 50);

  ctx.fillStyle = '#ffd700';
  ctx.font = '22px "Courier New", monospace';
  ctx.fillText('Score: ' + Math.floor(game.score), W / 2, H / 2 + 10);

  const hi = loadHighScore();
  ctx.fillStyle = Math.floor(game.score) >= hi ? '#ffd700' : '#666';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText('High Score: ' + hi, W / 2, H / 2 + 35);

  ctx.fillStyle = '#8888aa';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText('Press SPACE or tap to restart', W / 2, H / 2 + 60);
}

function drawPauseButton() {
  const b = PAUSE_BTN;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x, b.y, b.w, b.h);

  ctx.fillStyle = '#aaa';
  ctx.font = '18px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(game.paused ? '\u25B6' : '\u23F8', b.x + b.w / 2, b.y + b.h / 2);
}

function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 32px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('PAUSED', W / 2, H / 2 - 20);

  ctx.fillStyle = '#8888aa';
  ctx.font = '14px "Courier New", monospace';
  ctx.fillText('Press ESC or click \u23F8 to resume', W / 2, H / 2 + 30);
}

function drawShieldButton() {
  const b = SHIELD_BTN;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x, b.y, b.w, b.h);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (game.shieldActive) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText('S', b.x + b.w / 2, b.y + b.h / 2);
  } else if (game.shieldCooldown > 0) {
    ctx.fillStyle = '#555';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.fillText('' + Math.ceil(game.shieldCooldown / 60), b.x + b.w / 2, b.y + b.h / 2);
  } else {
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(Date.now() / 300);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillText('S', b.x + b.w / 2, b.y + b.h / 2);
    ctx.restore();
  }
}

function drawShieldAura(x, y) {
  const pad = 6;
  ctx.save();
  ctx.globalAlpha = 0.15 + 0.1 * Math.sin(Date.now() / 200);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x - pad, y - pad, PLAYER_W + pad * 2, PLAYER_H + pad * 2);
  ctx.restore();
}

// --- Particles ---

function spawnParticles(x, y, count, colors, opts = {}) {
  const { speed = 3, size = 3, life = 30, gravity = 0.05 } = opts;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd = speed * (0.3 + Math.random() * 0.7);
    game.particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: size * (0.5 + Math.random() * 0.5),
      life,
      maxLife: life,
      gravity,
    });
  }
}

function updateParticles() {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const p = game.particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.life--;
    if (p.life <= 0) {
      game.particles.splice(i, 1);
    }
  }
}

function drawParticles() {
  for (const p of game.particles) {
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function activateShield() {
  game.shieldActive = true;
  game.shieldTimer = SHIELD_DURATION;
  playSfx(sfxShield);
  spawnParticles(
    game.playerX + PLAYER_W / 2, game.playerY + PLAYER_H / 2, 25,
    ['#00d2ff', '#ffffff', '#4488ff'],
    { speed: 4, size: 3, life: 35 }
  );
}

// --- Game logic ---

function spawnEnemy() {
  const occupiedLanes = new Set();
  for (const e of game.enemies) {
    if (e.y < H + 50 && e.y > -50) {
      const eLane = Math.floor((e.x + e.w / 2 - ROAD_X) / LANE_W);
      occupiedLanes.add(Math.max(0, Math.min(2, eLane)));
    }
  }

  const availableLanes = [0, 1, 2].filter(l => !occupiedLanes.has(l));
  const lane = availableLanes.length > 0
    ? availableLanes[Math.floor(Math.random() * availableLanes.length)]
    : Math.floor(Math.random() * 3);

  const cx = LANE_CENTERS[lane];
  const w = 28 + Math.floor(Math.random() * 15);
  const h = Math.round(w * 48 / 32);
  const x = cx - w / 2;
  const speedMul = 1 + Math.random() * 1.5;

  game.enemies.push({
    x, y: -h,
    w, h,
    speedMul,
  });
}

function update() {
  if (!game.started || game.gameOver || game.paused) return;

  if (controllerConnected && targetX !== null) {
    game.playerX += (targetX - game.playerX) * 0.15;
  } else {
    if (game.keys.left) game.playerX -= PLAYER_SPEED;
    if (game.keys.right) game.playerX += PLAYER_SPEED;
  }
  game.playerX = Math.max(ROAD_X, Math.min(ROAD_X + ROAD_W - PLAYER_W, game.playerX));

  game.roadOffset += game.speed;

  game.spawnTimer--;
  if (game.spawnTimer <= 0) {
    spawnEnemy();
    game.spawnInterval = Math.max(
      SPAWN_INTERVAL_MIN,
      SPAWN_INTERVAL_INIT - Math.floor(game.score / 20)
    );
    game.spawnTimer = game.spawnInterval;
  }

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    e.y += game.speed * e.speedMul;
    if (e.y > H) {
      game.enemies.splice(i, 1);
    }
  }

  updateParticles();

  if (game.invincible > 0) {
    game.invincible--;
  }

  if (game.shieldActive) {
    game.shieldTimer--;
    if (game.shieldTimer <= 0) {
      game.shieldActive = false;
      game.shieldCooldown = SHIELD_COOLDOWN;
    }
  }
  if (game.shieldCooldown > 0 && !game.shieldActive) {
    game.shieldCooldown--;
  }

  const px = game.playerX;
  const py = game.playerY;
  const pw = PLAYER_W;
  const ph = PLAYER_H;

  for (let i = game.enemies.length - 1; i >= 0; i--) {
    const e = game.enemies[i];
    const hit =
      px < e.x + e.w &&
      px + pw > e.x &&
      py < e.y + e.h &&
      py + ph > e.y;
    if (!hit) continue;
    if (game.shieldActive) {
      spawnParticles(
        e.x + e.w / 2, e.y + e.h / 2, 12,
        ['#00ff88', '#ffffff', '#44ffcc'],
        { speed: 4, size: 3, life: 25 }
      );
      game.enemies.splice(i, 1);
      continue;
    }
    if (game.invincible > 0) continue;
    spawnParticles(
      e.x + e.w / 2, e.y + e.h / 2, 20,
      ['#ff4444', '#ff8800', '#ffcc00', '#ffffff'],
      { speed: 3.5, size: 4, life: 30 }
    );
    game.enemies.splice(i, 1);
    game.lives--;
    playSfx(sfxHit);
    game.invincible = INVINCIBLE_FRAMES;
    if (game.lives <= 0) {
      game.gameOver = true;
      game.lives = 0;
      saveHighScore(game.score);
      stopAudio();
      playSfx(sfxGameover);
      return;
    }
    break;
  }

  game.scoreTick++;
  if (game.scoreTick >= SCORE_TICK) {
    game.scoreTick = 0;
    game.score += FRAME_SCORE;

    if (game.score % SCORE_PER_SPEEDUP === 0) {
      game.speed += SPEED_INCREASE;
    }
  }
}

function drawStartScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#00d2ff';
  ctx.font = 'bold 28px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GYRO DRIVE', W / 2, H / 2 - 80);

  ctx.fillStyle = '#ffd700';
  ctx.font = 'italic 16px "Courier New", monospace';
  ctx.fillText('Retro', W / 2, H / 2 - 60);

  ctx.fillStyle = '#8888aa';
  ctx.font = '13px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText('\u2190 \u2192  /  A  D', W / 2 - 10, H / 2 - 22);
  ctx.fillText('SHIFT', W / 2 - 10, H / 2 - 2);
  ctx.fillText('ESC', W / 2 - 10, H / 2 + 18);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#00d2ff';
  ctx.fillText('Steer', W / 2 + 10, H / 2 - 22);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Shield', W / 2 + 10, H / 2 - 2);
  ctx.fillStyle = '#ffd700';
  ctx.fillText('Pause', W / 2 + 10, H / 2 + 18);

  const hi = loadHighScore();
  if (hi > 0) {
    ctx.fillStyle = '#666';
    ctx.font = '12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('High Score: ' + hi, W / 2, H / 2 + 50);
  }

  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 16px "Courier New", monospace';
  ctx.textAlign = 'center';
  const blink = Math.floor(Date.now() / 600) % 2 === 0;
  if (blink) {
    ctx.fillText('PRESS SPACE TO START', W / 2, H / 2 + 75);
  }
}

function render() {
  drawRoad();
  drawHUD();

  if (game.started) {
    for (const e of game.enemies) {
      drawEnemyCar(e.x, e.y, e.w, e.h);
    }
    if (!game.gameOver) {
      drawPauseButton();
      drawShieldButton();
    }
  }

  if (game.shieldActive) drawShieldAura(game.playerX, game.playerY);
  drawPlayerCar(game.playerX, game.playerY);
  drawParticles();

  if (game.paused) {
    drawPauseOverlay();
  } else if (!game.started) {
    drawStartScreen();
  } else if (game.gameOver) {
    drawGameOver();
  }
}

function resizeGame() {
  const c = document.getElementById('game-container');
  const scale = Math.min(1, (window.innerWidth - 24) / W, (window.innerHeight - 24) / H);
  c.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', resizeGame);
resizeGame();

function gameLoop() {
  update();
  render();
  requestAnimationFrame(gameLoop);
}

gameLoop();

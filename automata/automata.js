/**
 * Subproyecto #02: Autómata Celular & Vida Artificial
 * javiergalilea.es/automata/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('lifeCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let cols = 0;
  let rows = 0;
  const CELL_SIZE = 8; // tamaño de píxel de cada célula

  let grid = null;
  let nextGrid = null;
  let ageGrid = null; // Para efectos térmicos por longevidad

  let isPlaying = true;
  let generations = 0;
  let aliveCount = 0;
  let targetGps = 30; // generaciones por segundo
  let lastGenTime = performance.now();

  let currentRule = 'conway';
  let currentPalette = 'bio';

  let isDrawing = false;
  let drawMode = 1; // 1 = revivir, 0 = matar

  // Elementos UI
  const genCounter = document.getElementById('genCounter');
  const aliveCounter = document.getElementById('aliveCounter');
  const fpsCounter = document.getElementById('fpsCounter');
  const playBtn = document.getElementById('playBtn');
  const playIcon = document.getElementById('playIcon');
  const playLabel = document.getElementById('playLabel');
  const stepBtn = document.getElementById('stepBtn');
  const clearBtn = document.getElementById('clearBtn');
  const randomBtn = document.getElementById('randomBtn');
  const speedSlider = document.getElementById('speedSlider');
  const speedLabel = document.getElementById('speedLabel');
  const canvasHint = document.getElementById('canvasHint');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const hudDock = document.getElementById('hudDock');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Paletas térmicas de color (joven -> madura -> anciana)
  const PALETTES = {
    bio: {
      bg: '#04070d',
      gridLine: 'rgba(0, 245, 212, 0.04)',
      colors: ['#00f5d4', '#00bbf9', '#3a86ff', '#4361ee', '#7209b7']
    },
    cyber: {
      bg: '#080511',
      gridLine: 'rgba(255, 0, 110, 0.05)',
      colors: ['#ff006e', '#ff4d6d', '#8338ec', '#3a86ff', '#00f5d4']
    },
    matrix: {
      bg: '#020904',
      gridLine: 'rgba(0, 255, 102, 0.05)',
      colors: ['#88ffaa', '#00ff66', '#00cc44', '#009933', '#004d1a']
    },
    fire: {
      bg: '#0a0402',
      gridLine: 'rgba(255, 123, 0, 0.05)',
      colors: ['#fff3b0', '#ffbe0b', '#fb5607', '#ff006e', '#8338ec']
    }
  };

  // Reglas (B: Born, S: Survive)
  const RULES = {
    conway: { b: [3], s: [2, 3] },
    highlife: { b: [3, 6], s: [2, 3] },
    seeds: { b: [2], s: [] },
    daynight: { b: [3, 6, 7, 8], s: [3, 4, 6, 7, 8] }
  };

  function initGrid() {
    cols = Math.ceil(window.innerWidth / CELL_SIZE);
    rows = Math.ceil(window.innerHeight / CELL_SIZE);

    grid = new Uint8Array(cols * rows);
    nextGrid = new Uint8Array(cols * rows);
    ageGrid = new Uint8Array(cols * rows);

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    seedRandom(0.18);
  }

  function seedRandom(density = 0.2) {
    generations = 0;
    aliveCount = 0;
    for (let i = 0; i < grid.length; i++) {
      const state = Math.random() < density ? 1 : 0;
      grid[i] = state;
      ageGrid[i] = state ? 1 : 0;
      if (state) aliveCount++;
    }
    updateTelemetry();
  }

  function clearGrid() {
    grid.fill(0);
    nextGrid.fill(0);
    ageGrid.fill(0);
    generations = 0;
    aliveCount = 0;
    updateTelemetry();
  }

  function getIdx(x, y) {
    return y * cols + x;
  }

  function countNeighbors(x, y) {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = (x + dx + cols) % cols;
        const ny = (y + dy + rows) % rows;
        if (grid[ny * cols + nx]) count++;
      }
    }
    return count;
  }

  function stepGeneration() {
    const rule = RULES[currentRule] || RULES.conway;
    let newAlive = 0;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const state = grid[idx];
        const neighbors = countNeighbors(x, y);

        let willLive = 0;
        if (state === 1) {
          willLive = rule.s.includes(neighbors) ? 1 : 0;
        } else {
          willLive = rule.b.includes(neighbors) ? 1 : 0;
        }

        nextGrid[idx] = willLive;

        if (willLive) {
          newAlive++;
          ageGrid[idx] = state ? Math.min(255, ageGrid[idx] + 1) : 1;
        } else {
          ageGrid[idx] = 0;
        }
      }
    }

    // Intercambiar buffers
    const temp = grid;
    grid = nextGrid;
    nextGrid = temp;

    generations++;
    aliveCount = newAlive;
    updateTelemetry();
  }

  function updateTelemetry() {
    if (genCounter) genCounter.textContent = generations.toLocaleString();
    if (aliveCounter) aliveCounter.textContent = aliveCount.toLocaleString();
  }

  // --- DIBUJADO DE PATRONES PREDEFINIDOS ---
  const PATTERNS = {
    glider: [
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1]
    ],
    pulsar: [
      [0,0,1,1,1,0,0,0,1,1,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [0,0,1,1,1,0,0,0,1,1,1,0,0],
      [0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,1,1,0,0,0,1,1,1,0,0],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [1,0,0,0,0,1,0,1,0,0,0,0,1],
      [0,0,0,0,0,0,0,0,0,0,0,0,0],
      [0,0,1,1,1,0,0,0,1,1,1,0,0]
    ],
    gosper: [
      [24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],
      [11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],[16,4],[20,4],[21,4],
      [0,5],[1,5],[10,5],[14,5],[16,5],[17,5],[22,5],[24,5],[10,6],[16,6],[24,6],
      [11,7],[15,7],[12,8],[13,8]
    ],
    acorn: [
      [1,0],[3,1],[0,2],[1,2],[4,2],[5,2],[6,2]
    ]
  };

  function spawnPattern(name, cx, cy) {
    if (name === 'gosper') {
      const coords = PATTERNS.gosper;
      for (const [dx, dy] of coords) {
        const x = (cx + dx + cols) % cols;
        const y = (cy + dy + rows) % rows;
        grid[y * cols + x] = 1;
        ageGrid[y * cols + x] = 1;
      }
    } else if (name === 'acorn') {
      for (const [dx, dy] of PATTERNS.acorn) {
        const x = (cx + dx + cols) % cols;
        const y = (cy + dy + rows) % rows;
        grid[y * cols + x] = 1;
        ageGrid[y * cols + x] = 1;
      }
    } else if (PATTERNS[name]) {
      const p = PATTERNS[name];
      const ph = p.length;
      const pw = p[0].length;
      const ox = cx - Math.floor(pw / 2);
      const oy = cy - Math.floor(ph / 2);
      for (let r = 0; r < ph; r++) {
        for (let c = 0; c < pw; c++) {
          if (p[r][c]) {
            const x = (ox + c + cols) % cols;
            const y = (oy + r + rows) % rows;
            grid[y * cols + x] = 1;
            ageGrid[y * cols + x] = 1;
          }
        }
      }
    }
  }

  // --- RENDERIZADO VISUAL ---
  function render() {
    const pal = PALETTES[currentPalette] || PALETTES.bio;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colors = pal.colors;

    for (let y = 0; y < rows; y++) {
      const py = y * CELL_SIZE;
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (grid[idx]) {
          const age = ageGrid[idx];
          const colorIdx = Math.min(colors.length - 1, Math.floor(age / 5));
          ctx.fillStyle = colors[colorIdx];

          // Dibuja la célula con un ligero reborde redondeado
          ctx.fillRect(x * CELL_SIZE + 0.5, py + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        }
      }
    }
  }

  // --- LOOP PRINCIPAL ---
  let lastFpsUpdate = performance.now();
  let frameCount = 0;

  function loop(now) {
    if (isPlaying) {
      const interval = 1000 / targetGps;
      if (now - lastGenTime >= interval) {
        stepGeneration();
        lastGenTime = now;
      }
    }

    render();

    frameCount++;
    if (now - lastFpsUpdate >= 500) {
      if (fpsCounter) {
        fpsCounter.textContent = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
      }
      frameCount = 0;
      lastFpsUpdate = now;
    }

    requestAnimationFrame(loop);
  }

  // --- INTERACCIÓN Y RATÓN ---
  function setCellFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const x = Math.floor((clientX - rect.left) / CELL_SIZE);
    const y = Math.floor((clientY - rect.top) / CELL_SIZE);

    if (x >= 0 && x < cols && y >= 0 && y < rows) {
      // Pincel de radio 2
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + cols) % cols;
          const ny = (y + dy + rows) % rows;
          const idx = ny * cols + nx;
          grid[idx] = drawMode;
          ageGrid[idx] = drawMode ? 1 : 0;
        }
      }
    }

    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      canvasHint.classList.add('fade-out');
    }
  }

  function setupEvents() {
    window.addEventListener('resize', () => {
      initGrid();
    });

    canvas.addEventListener('mousedown', (e) => {
      isDrawing = true;
      drawMode = e.button === 2 ? 0 : 1;
      setCellFromEvent(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDrawing) setCellFromEvent(e);
    });

    window.addEventListener('mouseup', () => {
      isDrawing = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Touch
    canvas.addEventListener('touchstart', (e) => {
      isDrawing = true;
      drawMode = 1;
      setCellFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDrawing) setCellFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDrawing = false;
    });

    // Play/Pause
    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.classList.toggle('active', isPlaying);
      playIcon.textContent = isPlaying ? '⏸' : '▶';
      playLabel.textContent = isPlaying ? 'Pausar' : 'Reanudar';
    });

    // Paso
    stepBtn.addEventListener('click', () => {
      isPlaying = false;
      playBtn.classList.remove('active');
      playIcon.textContent = '▶';
      playLabel.textContent = 'Reanudar';
      stepGeneration();
    });

    // Limpiar
    clearBtn.addEventListener('click', () => {
      clearGrid();
    });

    // Aleatorio
    randomBtn.addEventListener('click', () => {
      seedRandom(0.2);
    });

    // Reglas
    document.querySelectorAll('.rule-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rule-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRule = btn.dataset.rule;
      });
    });

    // Inyector de patrones
    document.querySelectorAll('.pattern-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        const cx = Math.floor(cols / 2);
        const cy = Math.floor(rows / 2);
        spawnPattern(pattern, cx, cy);
      });
    });

    // Paletas
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.palette;
      });
    });

    // Slider de velocidad
    speedSlider.addEventListener('input', (e) => {
      targetGps = parseInt(e.target.value, 10);
      speedLabel.textContent = `${targetGps} gen/s`;
    });

    // Toggle HUD
    toggleHudBtn.addEventListener('click', () => {
      hudDock.classList.toggle('collapsed');
    });

    // Pantalla completa
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }
  }

  // Inicializar
  initGrid();
  setupEvents();
  requestAnimationFrame(loop);
})();

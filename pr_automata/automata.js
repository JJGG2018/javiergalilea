/**
 * Subproyecto #02: Autómata Celular & Vida Artificial (Rust + WASM)
 * javiergalilea.es/automata/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('lifeCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let wasmInstance = null;
  let wasmMemory = null;
  let gridPtr = 0;
  let agePtr = 0;

  let cols = 0;
  let rows = 0;
  const CELL_SIZE = 8;

  let isPlaying = true;
  let generations = 0;
  let aliveCount = 0;
  let targetGps = 30;
  let lastGenTime = performance.now();

  let currentRule = 0; // 0 = Conway, 1 = HighLife, 2 = Seeds, 3 = Day & Night
  let currentPalette = 'bio';

  let isDrawing = false;
  let drawMode = 1;

  // UI
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

  const PALETTES = {
    bio: {
      bg: '#04070d',
      colors: ['#00f5d4', '#00bbf9', '#3a86ff', '#4361ee', '#7209b7']
    },
    cyber: {
      bg: '#080511',
      colors: ['#ff006e', '#ff4d6d', '#8338ec', '#3a86ff', '#00f5d4']
    },
    matrix: {
      bg: '#020904',
      colors: ['#88ffaa', '#00ff66', '#00cc44', '#009933', '#004d1a']
    },
    fire: {
      bg: '#0a0402',
      colors: ['#fff3b0', '#ffbe0b', '#fb5607', '#ff006e', '#8338ec']
    }
  };

  const RULE_MAP = {
    conway: 0,
    highlife: 1,
    seeds: 2,
    daynight: 3
  };

  function resize() {
    cols = Math.ceil(window.innerWidth / CELL_SIZE);
    rows = Math.ceil(window.innerHeight / CELL_SIZE);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (wasmInstance) {
      gridPtr = wasmInstance.exports.init_automata(cols, rows, Math.floor(Math.random() * 100000));
      agePtr = wasmInstance.exports.get_age_buffer_ptr();
      generations = 0;
    }
  }

  function stepGeneration() {
    if (!wasmInstance) return;
    aliveCount = wasmInstance.exports.step_generation();
    generations++;
    updateTelemetry();
  }

  function updateTelemetry() {
    if (genCounter) genCounter.textContent = generations.toLocaleString();
    if (aliveCounter) aliveCounter.textContent = aliveCount.toLocaleString();
  }

  function render() {
    const pal = PALETTES[currentPalette] || PALETTES.bio;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!wasmInstance || !wasmMemory) return;

    const total = cols * rows;
    const gridBytes = new Uint8Array(wasmMemory.buffer, gridPtr, total);
    const ageBytes = new Uint8Array(wasmMemory.buffer, agePtr, total);
    const colors = pal.colors;

    for (let y = 0; y < rows; y++) {
      const py = y * CELL_SIZE;
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        if (gridBytes[idx]) {
          const age = ageBytes[idx];
          const colorIdx = Math.min(colors.length - 1, Math.floor(age / 5));
          ctx.fillStyle = colors[colorIdx];
          ctx.fillRect(x * CELL_SIZE + 0.5, py + 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        }
      }
    }
  }

  // Loop
  let frameCount = 0;
  let lastFpsUpdate = performance.now();

  function loop(now) {
    if (isPlaying && wasmInstance) {
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

  function setCellFromEvent(e) {
    if (!wasmInstance) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const cx = Math.floor((clientX - rect.left) / CELL_SIZE);
    const cy = Math.floor((clientY - rect.top) / CELL_SIZE);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows) {
          wasmInstance.exports.set_cell(nx, ny, drawMode);
        }
      }
    }

    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      canvasHint.classList.add('fade-out');
    }
  }

  function setupEvents() {
    window.addEventListener('resize', resize);

    canvas.addEventListener('mousedown', (e) => {
      isDrawing = true;
      drawMode = e.button === 2 ? 0 : 1;
      setCellFromEvent(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isDrawing) setCellFromEvent(e);
    });

    window.addEventListener('mouseup', () => { isDrawing = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('touchstart', (e) => {
      isDrawing = true;
      drawMode = 1;
      setCellFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDrawing) setCellFromEvent(e);
    }, { passive: true });

    window.addEventListener('touchend', () => { isDrawing = false; });

    playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.classList.toggle('active', isPlaying);
      playIcon.textContent = isPlaying ? '⏸' : '▶';
      playLabel.textContent = isPlaying ? 'Pausar' : 'Reanudar';
    });

    stepBtn.addEventListener('click', () => {
      isPlaying = false;
      playBtn.classList.remove('active');
      playIcon.textContent = '▶';
      playLabel.textContent = 'Reanudar';
      stepGeneration();
    });

    clearBtn.addEventListener('click', () => {
      if (wasmInstance) wasmInstance.exports.clear_cells();
      generations = 0;
      aliveCount = 0;
      updateTelemetry();
    });

    randomBtn.addEventListener('click', () => {
      if (wasmInstance) {
        gridPtr = wasmInstance.exports.init_automata(cols, rows, Math.floor(Math.random() * 100000));
        generations = 0;
        updateTelemetry();
      }
    });

    document.querySelectorAll('.rule-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.rule-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRule = RULE_MAP[btn.dataset.rule] || 0;
        if (wasmInstance) wasmInstance.exports.set_rule(currentRule);
      });
    });

    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.palette;
      });
    });

    speedSlider.addEventListener('input', (e) => {
      targetGps = parseInt(e.target.value, 10);
      speedLabel.textContent = `${targetGps} gen/s`;
    });

    toggleHudBtn.addEventListener('click', () => {
      hudDock.classList.toggle('collapsed');
    });

    const cleanModeBtn = document.getElementById('cleanModeBtn');
    const restoreUiBtn = document.getElementById('restoreUiBtn');
    if (cleanModeBtn) {
      cleanModeBtn.addEventListener('click', () => {
        document.body.classList.add('clean-mode');
      });
    }
    if (restoreUiBtn) {
      restoreUiBtn.addEventListener('click', () => {
        document.body.classList.remove('clean-mode');
      });
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('clean-mode')) {
        document.body.classList.remove('clean-mode');
      }
    });

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

  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      wasmMemory = wasmInstance.exports.memory;

      resize();
      console.log('✅ automata_engine.wasm (Rust) cargado.');
    } catch (err) {
      console.error('Error cargando automata_engine.wasm:', err);
    }
  }

  resize();
  setupEvents();
  initWasm();
  requestAnimationFrame(loop);
})();

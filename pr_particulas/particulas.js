/**
 * Subproyecto #01: Simulador de Partículas & Benchmark (Rust + WebAssembly)
 * javiergalilea.es/particulas/
 */

(function () {
  'use strict';

  let wasmInstance = null;
  let wasmMemory = null;
  let particlesOffset = 0;
  let particleCount = 2500;
  let currentMode = 0; // 0 = Attract, 1 = Repel, 2 = Vortex
  let currentPalette = 'cyber';
  let showConstellations = true;

  const canvas = document.getElementById('wasmCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let width = 0;
  let height = 0;
  let dpr = 1;

  const mouse = {
    x: -1000,
    y: -1000,
    active: 0
  };

  const PALETTES = {
    cyber: ['#00f5d4', '#7b2cbf', '#3a86ff', '#ff006e', '#ffffff'],
    plasma: ['#ff007f', '#ff7b00', '#ffbe0b', '#8338ec', '#ffffff'],
    matrix: ['#00ff66', '#00cc44', '#88ffaa', '#00aa33', '#ffffff'],
    aurora: ['#38bdf8', '#818cf8', '#c084fc', '#2dd4bf', '#f8fafc']
  };

  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let lastWasmDuration = 0;

  const fpsEl = document.getElementById('fpsCounter');
  const wasmTimeEl = document.getElementById('wasmTime');
  const particleSlider = document.getElementById('particleSlider');
  const particleCountLabel = document.getElementById('particleCountLabel');
  const canvasHint = document.getElementById('canvasHint');

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (wasmInstance) {
      wasmInstance.exports.init(particleCount, width, height);
    }
  }

  function hideHintOnce() {
    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      setTimeout(() => canvasHint.classList.add('fade-out'), 2200);
    }
  }

  function setupInteractivity() {
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = 1;
      hideHintOnce();
    });

    window.addEventListener('mouseleave', () => {
      mouse.active = 0;
    });

    window.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
        mouse.active = 1;
        hideHintOnce();
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
        mouse.active = 1;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      mouse.active = 0;
    });

    // Force mode buttons
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = parseInt(btn.dataset.mode, 10);
      });
    });

    // Palette buttons
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.palette;
      });
    });

    // Particle slider
    particleSlider.addEventListener('input', (e) => {
      particleCount = parseInt(e.target.value, 10);
      particleCountLabel.textContent = particleCount.toLocaleString('es-ES');
      if (wasmInstance) {
        wasmInstance.exports.init(particleCount, width, height);
      }
    });

    // Reset button
    const resetBtn = document.getElementById('resetParticlesBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (wasmInstance) {
          wasmInstance.exports.init(particleCount, width, height);
        }
      });
    }

    // Toggle constellation lines
    const toggleLinesBtn = document.getElementById('toggleLinesBtn');
    if (toggleLinesBtn) {
      toggleLinesBtn.addEventListener('click', () => {
        showConstellations = !showConstellations;
        toggleLinesBtn.classList.toggle('active', showConstellations);
      });
    }

    // Toggle HUD Dock
    const hudDock = document.getElementById('hudDock');
    const toggleHudBtn = document.getElementById('toggleHudBtn');
    if (toggleHudBtn && hudDock) {
      toggleHudBtn.addEventListener('click', () => {
        hudDock.classList.toggle('collapsed');
      });
    }

    // Modo inmersivo (solo botón volver)
    const cleanModeBtn = document.getElementById('cleanModeBtn');
    const restoreUiBtn = document.getElementById('restoreUiBtn');
    if (cleanModeBtn) {
      cleanModeBtn.addEventListener('click', () => {
        document.body.classList.add('clean-mode');
        const benchModal = document.getElementById('benchModal');
        if (benchModal) benchModal.classList.add('hidden');
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

    // Pantalla completa
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    // Benchmark Modal
    const benchModal = document.getElementById('benchModal');
    const openBenchBtn = document.getElementById('toggleBenchModal');
    const closeBenchBtn = document.getElementById('closeBenchModal');

    if (openBenchBtn && benchModal) {
      openBenchBtn.addEventListener('click', () => {
        benchModal.classList.remove('hidden');
      });
    }
    if (closeBenchBtn && benchModal) {
      closeBenchBtn.addEventListener('click', () => {
        benchModal.classList.add('hidden');
      });
    }
    if (benchModal) {
      benchModal.addEventListener('click', (e) => {
        if (e.target === benchModal) {
          benchModal.classList.add('hidden');
        }
      });
    }
  }

  function render(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    ctx.fillStyle = 'rgba(6, 8, 14, 0.32)';
    ctx.fillRect(0, 0, width, height);

    if (wasmInstance) {
      const t0 = performance.now();
      wasmInstance.exports.update(
        particleCount,
        width,
        height,
        mouse.x,
        mouse.y,
        mouse.active,
        currentMode,
        dt
      );
      const t1 = performance.now();
      lastWasmDuration = (t1 - t0);

      const buffer = wasmMemory.buffer;
      const f32 = new Float32Array(buffer, particlesOffset, particleCount * 6);
      const palette = PALETTES[currentPalette] || PALETTES.cyber;

      ctx.save();
      for (let i = 0; i < particleCount; i++) {
        const base = i * 6;
        const px = f32[base];
        const py = f32[base + 1];
        const colorIdx = Math.floor(f32[base + 4]) % 5;
        const size = f32[base + 5];

        ctx.fillStyle = palette[colorIdx];
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }

      if (showConstellations && particleCount <= 3500) {
        ctx.lineWidth = 0.5;
        const sampleStep = 3;
        for (let i = 0; i < particleCount; i += sampleStep) {
          const b1 = i * 6;
          const x1 = f32[b1];
          const y1 = f32[b1 + 1];

          for (let j = i + sampleStep; j < Math.min(i + 35, particleCount); j += sampleStep) {
            const b2 = j * 6;
            const x2 = f32[b2];
            const y2 = f32[b2 + 1];

            const dx = x1 - x2;
            const dy = y1 - y2;
            const distSq = dx * dx + dy * dy;

            if (distSq < 3600) {
              const alpha = (1 - distSq / 3600) * 0.24;
              ctx.strokeStyle = `rgba(0, 245, 212, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }
          }
        }
      }

      ctx.restore();
    }

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      const currentFps = Math.round(frameCount / fpsTimer);
      if (fpsEl) fpsEl.textContent = currentFps;
      if (wasmTimeEl) wasmTimeEl.textContent = lastWasmDuration.toFixed(2);
      frameCount = 0;
      fpsTimer = 0;
    }

    requestAnimationFrame(render);
  }

  function setupBenchmark() {
    const runBtn = document.getElementById('runBenchBtn');
    const wasmTimeResult = document.getElementById('wasmBenchTime');
    const jsTimeResult = document.getElementById('jsBenchTime');
    const wasmBar = document.getElementById('wasmBenchBar');
    const jsBar = document.getElementById('jsBenchBar');
    const verdict = document.getElementById('benchVerdict');

    function jsLeibnizPi(iterations) {
      let sum = 0.0;
      for (let i = 0; i < iterations; i++) {
        const term = 1.0 / (2.0 * i + 1.0);
        if ((i & 1) === 0) {
          sum += term;
        } else {
          sum -= term;
        }
      }
      return sum * 4.0;
    }

    runBtn.addEventListener('click', () => {
      if (!wasmInstance) return;

      runBtn.disabled = true;
      runBtn.innerHTML = '<span>⏳ Calculando...</span>';
      verdict.textContent = 'Ejecutando 5 millones de ciclos...';

      setTimeout(() => {
        const ITERATIONS = 5000000;

        const w0 = performance.now();
        const wasmPi = wasmInstance.exports.benchmark_calc(ITERATIONS);
        const w1 = performance.now();
        const wasmDuration = Math.max(w1 - w0, 0.01);

        const j0 = performance.now();
        jsLeibnizPi(ITERATIONS);
        const j1 = performance.now();
        const jsDuration = Math.max(j1 - j0, 0.01);

        wasmTimeResult.textContent = `${wasmDuration.toFixed(1)} ms`;
        jsTimeResult.textContent = `${jsDuration.toFixed(1)} ms`;

        const maxDuration = Math.max(wasmDuration, jsDuration);
        wasmBar.style.width = `${Math.min(100, Math.round((wasmDuration / maxDuration) * 100))}%`;
        jsBar.style.width = `${Math.min(100, Math.round((jsDuration / maxDuration) * 100))}%`;

        const speedup = (jsDuration / wasmDuration).toFixed(1);
        if (wasmDuration <= jsDuration) {
          verdict.innerHTML = `⚡ <strong>Rust WASM fue ${speedup}x más rápido</strong> que JavaScript nativo. (π ≈ ${wasmPi.toFixed(6)})`;
        } else {
          verdict.innerHTML = `⚡ WASM: ${wasmDuration.toFixed(1)} ms · JS: ${jsDuration.toFixed(1)} ms (π ≈ ${wasmPi.toFixed(6)})`;
        }

        runBtn.disabled = false;
        runBtn.innerHTML = '<span>⚡ Repetir Benchmark (5M ciclos)</span>';
      }, 40);
    });
  }

  const WASM_PATH = 'engine.wasm';

  async function initWasm() {
    try {
      let wasmModule;
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          const res = await WebAssembly.instantiateStreaming(fetch(WASM_PATH));
          wasmModule = res.instance;
        } catch (_) {
          const response = await fetch(WASM_PATH);
          const bytes = await response.arrayBuffer();
          const res = await WebAssembly.instantiate(bytes);
          wasmModule = res.instance;
        }
      } else {
        const response = await fetch(WASM_PATH);
        const bytes = await response.arrayBuffer();
        const res = await WebAssembly.instantiate(bytes);
        wasmModule = res.instance;
      }

      wasmInstance = wasmModule;
      wasmMemory = wasmInstance.exports.memory;
      particlesOffset = wasmInstance.exports.get_memory_offset();
      wasmInstance.exports.init(particleCount, width, height);
    } catch (err) {
      console.error('Error loading WebAssembly:', err);
    }
  }

  window.addEventListener('resize', resizeCanvas);
  setupInteractivity();
  setupBenchmark();
  resizeCanvas();
  initWasm();
  requestAnimationFrame(render);
})();


/**
 * Javier Galilea — Personal WASM Home
 * Canvas + WebAssembly Engine Integration
 */

(function () {
  'use strict';

  // --- STATE ---
  let wasmInstance = null;
  let wasmMemory = null;
  let particlesOffset = 0;
  let particleCount = 2000;
  let currentMode = 0; // 0 = Attract, 1 = Repel, 2 = Vortex
  let currentPalette = 'cyber';

  const canvas = document.getElementById('wasmCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let width = 0;
  let height = 0;
  let dpr = 1;

  let mouse = {
    x: -1000,
    y: -1000,
    active: 0,
    isDown: false
  };

  // Palettes (5 colors per theme)
  const PALETTES = {
    cyber: [
      '#00f5d4', // Neon Cyan
      '#7b2cbf', // Violet
      '#3a86ff', // Electric Blue
      '#ff006e', // Hot Pink
      '#ffffff'  // Pure White
    ],
    plasma: [
      '#ff007f', // Deep Rose
      '#ff7b00', // Bright Orange
      '#ffbe0b', // Solar Yellow
      '#8338ec', // Violet
      '#ffffff'
    ],
    matrix: [
      '#00ff66', // Matrix Green
      '#00cc44', // Darker Green
      '#88ffaa', // Mint
      '#00aa33', // Deep Forest
      '#ffffff'
    ]
  };

  // Performance tracking
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let lastWasmDuration = 0;

  const fpsEl = document.getElementById('fpsCounter');
  const wasmTimeEl = document.getElementById('wasmTime');
  const particleSlider = document.getElementById('particleSlider');
  const particleCountLabel = document.getElementById('particleCountLabel');

  // --- CANVAS RESIZING ---
  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    ctx.scale(dpr, dpr);

    if (wasmInstance) {
      wasmInstance.exports.init(particleCount, width, height);
    }
  }

  // --- MOUSE & TOUCH LISTENERS ---
  function setupInteractivity() {
    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = 1;
    });

    window.addEventListener('mouseleave', () => {
      mouse.active = 0;
    });

    window.addEventListener('mousedown', () => {
      mouse.isDown = true;
    });

    window.addEventListener('mouseup', () => {
      mouse.isDown = false;
    });

    // Touch events for mobile devices
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        mouse.x = e.touches[0].clientX;
        mouse.y = e.touches[0].clientY;
        mouse.active = 1;
        mouse.isDown = true;
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
      mouse.isDown = false;
    });

    // HUD Mode buttons
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

    // Particle Slider
    particleSlider.addEventListener('input', (e) => {
      particleCount = parseInt(e.target.value, 10);
      particleCountLabel.textContent = particleCount.toLocaleString('es-ES');
      if (wasmInstance) {
        wasmInstance.exports.init(particleCount, width, height);
      }
    });
  }

  // --- ANIMATION LOOP ---
  function render(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    // Background fade for light motion blur
    ctx.fillStyle = 'rgba(8, 11, 17, 0.35)';
    ctx.fillRect(0, 0, width, height);

    if (wasmInstance) {
      // 1. WASM Physics Update & Time Profiling
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

      // 2. Read directly from WASM Linear Memory
      // Memory layout per particle: [x, y, vx, vy, color_idx, size] = 6 floats
      const buffer = wasmMemory.buffer;
      const f32 = new Float32Array(buffer, particlesOffset, particleCount * 6);
      const palette = PALETTES[currentPalette] || PALETTES.cyber;

      ctx.save();
      // Render particles
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

      // Constellation lines for subtle network effect when count <= 2500
      if (particleCount <= 2500) {
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

            if (distSq < 3600) { // < 60px
              const alpha = (1 - distSq / 3600) * 0.22;
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

    // FPS Meter
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

  // --- BENCHMARK MODULE ---
  function setupBenchmark() {
    const runBtn = document.getElementById('runBenchBtn');
    const wasmTimeResult = document.getElementById('wasmBenchTime');
    const jsTimeResult = document.getElementById('jsBenchTime');
    const wasmBar = document.getElementById('wasmBenchBar');
    const jsBar = document.getElementById('jsBenchBar');
    const verdict = document.getElementById('benchVerdict');

    // Identical mathematical loop in JS
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
      if (!wasmInstance) {
        alert('Cargando módulo WebAssembly...');
        return;
      }

      runBtn.disabled = true;
      runBtn.innerHTML = '<span>⏳ Calculando...</span>';
      verdict.textContent = 'Ejecutando 5 millones de ciclos...';

      // Use setTimeout to allow UI to show running state
      setTimeout(() => {
        const ITERATIONS = 5000000;

        // 1. Benchmark WASM
        const w0 = performance.now();
        const wasmPi = wasmInstance.exports.benchmark_calc(ITERATIONS);
        const w1 = performance.now();
        const wasmDuration = Math.max(w1 - w0, 0.01);

        // 2. Benchmark JS
        const j0 = performance.now();
        const jsPi = jsLeibnizPi(ITERATIONS);
        const j1 = performance.now();
        const jsDuration = Math.max(j1 - j0, 0.01);

        // Update UI
        wasmTimeResult.textContent = `${wasmDuration.toFixed(1)} ms`;
        jsTimeResult.textContent = `${jsDuration.toFixed(1)} ms`;

        const maxDuration = Math.max(wasmDuration, jsDuration);
        const wasmPercent = Math.min(100, Math.round((wasmDuration / maxDuration) * 100));
        const jsPercent = Math.min(100, Math.round((jsDuration / maxDuration) * 100));

        wasmBar.style.width = `${wasmPercent}%`;
        jsBar.style.width = `${jsPercent}%`;

        const speedup = (jsDuration / wasmDuration).toFixed(1);
        if (wasmDuration <= jsDuration) {
          verdict.innerHTML = `⚡ <strong>WebAssembly fue ${speedup}x más rápido</strong> que JavaScript nativo. (Pi aprox: ${wasmPi.toFixed(6)})`;
        } else {
          verdict.innerHTML = `⚡ Resultados: WASM en ${wasmDuration.toFixed(1)}ms vs JS en ${jsDuration.toFixed(1)}ms. (Pi: ${wasmPi.toFixed(6)})`;
        }

        runBtn.disabled = false;
        runBtn.innerHTML = '<span>⚡ Repetir Benchmark</span>';
      }, 50);
    });
  }

  // --- INITIALIZE WASM ---
  async function initWasm() {
    try {
      let wasmModule;
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          const res = await WebAssembly.instantiateStreaming(fetch('engine.wasm'));
          wasmModule = res.instance;
        } catch (streamingErr) {
          // Fallback if MIME type not application/wasm on local server
          const response = await fetch('engine.wasm');
          const bytes = await response.arrayBuffer();
          const res = await WebAssembly.instantiate(bytes);
          wasmModule = res.instance;
        }
      } else {
        const response = await fetch('engine.wasm');
        const bytes = await response.arrayBuffer();
        const res = await WebAssembly.instantiate(bytes);
        wasmModule = res.instance;
      }

      wasmInstance = wasmModule;
      wasmMemory = wasmInstance.exports.memory;
      particlesOffset = wasmInstance.exports.get_memory_offset();

      console.log('✅ WebAssembly engine loaded successfully!');
      console.log('Available exports:', Object.keys(wasmInstance.exports));

      // Initial particles population
      wasmInstance.exports.init(particleCount, width, height);

    } catch (err) {
      console.error('Error loading WebAssembly:', err);
      // Friendly banner if opened via file:// protocol
      if (window.location.protocol === 'file:') {
        const alertBox = document.createElement('div');
        alertBox.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#ef4444;color:white;padding:12px 24px;border-radius:10px;z-index:9999;font-size:14px;box-shadow:0 10px 25px rgba(0,0,0,0.5);text-align:center;';
        alertBox.innerHTML = '⚠️ Los navegadores bloquean la carga de WebAssembly con protocolo <code>file://</code>.<br>Ejecuta <code>python -m http.server</code> en este directorio.';
        document.body.appendChild(alertBox);
      }
    }
  }

  // --- BOOTSTRAP ---
  window.addEventListener('resize', resizeCanvas);
  setupInteractivity();
  setupBenchmark();
  resizeCanvas();
  initWasm();

  requestAnimationFrame(render);
})();

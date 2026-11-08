/**
 * Subproyecto #06: Reloj Cósmico & Túnel Ambiental (Rust + WASM)
 * Optimizado para navegadores ligeros y Smart TVs
 * javiergalilea.es/pr_reloj/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('tunnelCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let wasmInstance = null;
  let wasmMemory = null;
  let ringsBufferPtr = 0;

  let width = 0;
  let height = 0;
  const RING_COUNT = 36; // Cantidad equilibrada de anillos para 60 FPS en TV

  let shapeSides = 0; // 0 = círculo, 4 = cuadrado, 6 = hexágono, 8 = octógono
  let currentPalette = 'neon';
  let speedValue = 0.0008;
  let curveValue = 1.0;

  // DOM
  const clockTime = document.getElementById('clockTime');
  const clockDate = document.getElementById('clockDate');
  const ambientClock = document.getElementById('ambientClock');
  const toggleClockBtn = document.getElementById('toggleClockBtn');
  const clockBtnText = document.getElementById('clockBtnText');
  const fpsCounter = document.getElementById('fpsCounter');
  const speedSlider = document.getElementById('speedSlider');
  const speedLabel = document.getElementById('speedLabel');
  const curveSlider = document.getElementById('curveSlider');
  const curveLabel = document.getElementById('curveLabel');
  const cleanModeBtn = document.getElementById('cleanModeBtn');
  const restoreUiBtn = document.getElementById('restoreUiBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const hudDock = document.getElementById('hudDock');

  const PALETTES = {
    neon: {
      bg: '#020306',
      colors: ['#00f5d4', '#3b82f6', '#9d4edd', '#f72585']
    },
    aurora: {
      bg: '#010508',
      colors: ['#2dd4bf', '#38bdf8', '#818cf8', '#c084fc']
    },
    gold: {
      bg: '#080502',
      colors: ['#ffbe0b', '#fb5607', '#ff006e', '#ffe494']
    },
    monochrome: {
      bg: '#000000',
      colors: ['#ffffff', '#cbd5e1', '#94a3b8', '#64748b']
    }
  };

  function resize() {
    // En televisores o pantallas Retina, 1.0 o max 1.5 evita sobrecarga de GPU
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Actualización del Reloj Digital
  const DATE_OPTIONS = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  };

  function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');

    if (clockTime) clockTime.textContent = `${h}:${m}:${s}`;
    if (clockDate) clockDate.textContent = now.toLocaleDateString('es-ES', DATE_OPTIONS);
  }

  // Dibuja un polígono regular o círculo según el modo
  function drawRingShape(cx, cy, r, sides) {
    if (sides === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      const step = (Math.PI * 2) / sides;
      for (let s = 0; s < sides; s++) {
        const theta = s * step;
        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // Renderizado del túnel usando datos de Rust
  function render(time) {
    const pal = PALETTES[currentPalette] || PALETTES.neon;
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, width, height);

    if (!wasmInstance || !wasmMemory) return;

    // Actualiza la posición y perspectiva 3D en Rust
    const count = wasmInstance.exports.update_tunnel(
      RING_COUNT,
      width,
      height,
      time,
      speedValue,
      curveValue
    );

    const f32 = new Float32Array(wasmMemory.buffer, ringsBufferPtr, count * 4);
    const colors = pal.colors;

    // Renderizar de atrás hacia adelante
    for (let i = count - 1; i >= 0; i--) {
      const base = i * 4;
      const cx = f32[base];
      const cy = f32[base + 1];
      const radius = f32[base + 2];
      const alpha = f32[base + 3];

      const col = colors[i % colors.length];
      ctx.strokeStyle = col;
      ctx.globalAlpha = Math.min(1.0, alpha);
      ctx.lineWidth = Math.max(1, (radius / (width * 0.75)) * 3.5);

      drawRingShape(cx, cy, radius, shapeSides);
    }

    ctx.globalAlpha = 1.0;
  }

  // Loop
  let frameCount = 0;
  let lastFpsUpdate = performance.now();

  function loop(now) {
    render(now);

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

  function setupEvents() {
    window.addEventListener('resize', resize);

    // Formas
    document.querySelectorAll('.shape-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        shapeSides = parseInt(btn.dataset.sides, 10);
      });
    });

    // Paletas
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.pal;
      });
    });

    // Sliders
    speedSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const speeds = [0.0003, 0.0005, 0.0008, 0.0014, 0.0024];
      const labels = ['Lenta', 'Tranquila', 'Normal', 'Rápida', 'Warp'];
      speedValue = speeds[val - 1] || 0.0008;
      speedLabel.textContent = labels[val - 1] || 'Normal';
    });

    curveSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const curves = [0.0, 0.5, 1.0, 1.8];
      const labels = ['Recto', 'Sutil', 'Suave', 'Dinámica'];
      curveValue = curves[val] !== undefined ? curves[val] : 1.0;
      curveLabel.textContent = labels[val] || 'Suave';
    });

    // Toggle Reloj
    let isClockVisible = true;
    toggleClockBtn.addEventListener('click', () => {
      isClockVisible = !isClockVisible;
      ambientClock.classList.toggle('hidden', !isClockVisible);
      clockBtnText.textContent = isClockVisible ? '⏰ Ocultar Reloj' : '⏰ Mostrar Reloj';
    });

    // Modo Limpio (Salvapantallas TV)
    cleanModeBtn.addEventListener('click', () => {
      document.body.classList.add('clean-mode');
    });

    restoreUiBtn.addEventListener('click', () => {
      document.body.classList.remove('clean-mode');
    });

    // Tecla ESC o cualquier botón de mando a distancia
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.body.classList.remove('clean-mode');
      }
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

    // Toggle HUD
    toggleHudBtn.addEventListener('click', () => {
      hudDock.classList.toggle('collapsed');
    });
  }

  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      wasmMemory = wasmInstance.exports.memory;
      ringsBufferPtr = wasmInstance.exports.get_rings_buffer_ptr();
      console.log('✅ reloj_engine.wasm (Rust 528 bytes) cargado.');
    } catch (err) {
      console.error('Error cargando reloj_engine.wasm:', err);
    }
  }

  resize();
  setupEvents();
  updateClock();
  setInterval(updateClock, 1000);
  initWasm();
  requestAnimationFrame(loop);
})();


/**
 * Javier Galilea — Home Visual & Portal de Subproyectos
 * javiergalilea.es
 */

(function () {
  'use strict';

  // --- 1. SPOTLIGHT HOVER EFFECT ON CARDS ---
  function setupSpotlightCards() {
    const cards = document.querySelectorAll('.spotlight-card');
    window.addEventListener('mousemove', (e) => {
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      }
    });
  }

  // --- 2. AMBIENT BACKGROUND CANVAS ---
  function initAmbientBackground() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let w = 0;
    let h = 0;
    const stars = [];
    const STAR_COUNT = 65;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    }

    for (let i = 0; i < STAR_COUNT; i++) {
      stars.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.6 + 0.6,
        alpha: Math.random() * 0.55 + 0.2
      });
    }

    window.addEventListener('resize', resize);
    resize();

    function drawAmbient() {
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i];
        s.x += s.vx;
        s.y += s.vy;

        if (s.x < 0) s.x = w;
        if (s.x > w) s.x = 0;
        if (s.y < 0) s.y = h;
        if (s.y > h) s.y = 0;

        ctx.fillStyle = `rgba(148, 163, 184, ${s.alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < stars.length; j++) {
          const s2 = stars[j];
          const dx = s.x - s2.x;
          const dy = s.y - s2.y;
          const distSq = dx * dx + dy * dy;
          if (distSq < 18000) {
            const lineAlpha = (1 - distSq / 18000) * 0.08;
            ctx.strokeStyle = `rgba(0, 245, 212, ${lineAlpha})`;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(drawAmbient);
    }

    requestAnimationFrame(drawAmbient);
  }

  // --- 3. SUBPROJECT #01 LIVE WASM PREVIEW CANVAS ---
  async function initParticlesPreview() {
    const canvas = document.getElementById('previewParticlesCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });

    let width = 0;
    let height = 0;
    let wasmInstance = null;
    let wasmMemory = null;
    let particlesOffset = 0;
    const COUNT = 750;
    const PALETTE = ['#00f5d4', '#7b2cbf', '#3a86ff', '#ff006e', '#ffffff'];

    const mouse = { x: 0, y: 0, active: 0 };

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      width = Math.max(rect.width, 300);
      height = Math.max(rect.height, 260);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (wasmInstance) {
        wasmInstance.exports.init(COUNT, width, height);
      }
    }

    canvas.parentElement.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = 1;
    });

    canvas.parentElement.addEventListener('mouseleave', () => {
      mouse.active = 0;
    });

    window.addEventListener('resize', resize);
    resize();

    try {
      const WASM_PATH = 'wasm/engine.wasm';
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
      wasmInstance.exports.init(COUNT, width, height);
    } catch (e) {
      console.warn('WASM preview fallback:', e);
    }

    let last = performance.now();
    function renderPreview(now) {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      ctx.fillStyle = 'rgba(5, 7, 12, 0.35)';
      ctx.fillRect(0, 0, width, height);

      if (wasmInstance) {
        // Gentle automatic orbital attractor when mouse is not hovering
        const mx = mouse.active ? mouse.x : width * 0.5 + Math.cos(now * 0.0012) * (width * 0.22);
        const my = mouse.active ? mouse.y : height * 0.5 + Math.sin(now * 0.0016) * (height * 0.22);

        wasmInstance.exports.update(COUNT, width, height, mx, my, 1, 2, dt);

        const f32 = new Float32Array(wasmMemory.buffer, particlesOffset, COUNT * 6);
        for (let i = 0; i < COUNT; i++) {
          const base = i * 6;
          const px = f32[base];
          const py = f32[base + 1];
          const colorIdx = Math.floor(f32[base + 4]) % 5;
          const size = f32[base + 5];

          ctx.fillStyle = PALETTE[colorIdx];
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      requestAnimationFrame(renderPreview);
    }

    requestAnimationFrame(renderPreview);
  }

  // --- 4. SUBPROJECT #02 & #03 DECORATIVE VISUAL PREVIEWS ---
  function initDecorativePreviews() {
    // Subproject #02: Cellular Automata Grid Preview
    const cellCanvas = document.getElementById('previewCellularCanvas');
    if (cellCanvas) {
      const ctx = cellCanvas.getContext('2d');
      const cols = 22;
      const rows = 12;

      function drawCells(now) {
        const rect = cellCanvas.parentElement.getBoundingClientRect();
        if (cellCanvas.width !== Math.floor(rect.width)) {
          cellCanvas.width = Math.floor(rect.width);
          cellCanvas.height = Math.floor(rect.height);
        }
        const w = cellCanvas.width;
        const h = cellCanvas.height;
        ctx.fillStyle = '#05070c';
        ctx.fillRect(0, 0, w, h);

        const cellW = w / cols;
        const cellH = h / rows;
        const t = now * 0.002;

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const wave = Math.sin(c * 0.45 + t) * Math.cos(r * 0.55 - t * 0.8);
            if (wave > 0.15) {
              const alpha = Math.min(0.85, (wave - 0.15) * 0.9);
              ctx.fillStyle = wave > 0.55
                ? `rgba(0, 245, 212, ${alpha})`
                : `rgba(157, 78, 221, ${alpha * 0.7})`;
              ctx.beginPath();
              ctx.roundRect(c * cellW + 4, r * cellH + 4, cellW - 8, cellH - 8, 4);
              ctx.fill();
            }
          }
        }
        requestAnimationFrame(drawCells);
      }
      requestAnimationFrame(drawCells);
    }

    // Subproject #03: Harmonic Waves Preview
    const waveCanvas = document.getElementById('previewWaveCanvas');
    if (waveCanvas) {
      const ctx = waveCanvas.getContext('2d');

      function drawWaves(now) {
        const rect = waveCanvas.parentElement.getBoundingClientRect();
        if (waveCanvas.width !== Math.floor(rect.width)) {
          waveCanvas.width = Math.floor(rect.width);
          waveCanvas.height = Math.floor(rect.height);
        }
        const w = waveCanvas.width;
        const h = waveCanvas.height;
        ctx.fillStyle = '#05070c';
        ctx.fillRect(0, 0, w, h);

        const t = now * 0.0025;
        const lines = [
          { color: 'rgba(0, 245, 212, 0.75)', amp: 28, freq: 0.018, speed: 1.0 },
          { color: 'rgba(59, 130, 246, 0.65)', amp: 22, freq: 0.024, speed: -1.3 },
          { color: 'rgba(157, 78, 221, 0.55)', amp: 34, freq: 0.012, speed: 0.7 }
        ];

        for (const l of lines) {
          ctx.strokeStyle = l.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const y = h * 0.5
              + Math.sin(x * l.freq + t * l.speed) * l.amp
              * Math.sin((x / w) * Math.PI);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        requestAnimationFrame(drawWaves);
      }
      requestAnimationFrame(drawWaves);
    }
  }

  // --- BOOTSTRAP ---
  setupSpotlightCards();
  initAmbientBackground();
  initParticlesPreview();
  initDecorativePreviews();
})();

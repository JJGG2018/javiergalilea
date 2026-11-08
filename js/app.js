/**
 * Javier Galilea — Home Interactiva & Visual
 * javiergalilea.es
 */

(function () {
  'use strict';

  // --- 1. FONDO DE ESTRELLAS Y CONSTELACIONES SUAVES ---
  function initAmbient() {
    const canvas = document.getElementById('ambientCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let w = 0;
    let h = 0;
    const dots = [];
    const COUNT = 50;

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w;
      canvas.height = h;
    }

    for (let i = 0; i < COUNT; i++) {
      dots.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: Math.random() * 1.5 + 0.5,
        alpha: Math.random() * 0.5 + 0.2
      });
    }

    window.addEventListener('resize', resize);
    resize();

    function renderAmbient() {
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0) d.x = w;
        if (d.x > w) d.x = 0;
        if (d.y < 0) d.y = h;
        if (d.y > h) d.y = 0;

        ctx.fillStyle = `rgba(148, 163, 184, ${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();

        for (let j = i + 1; j < dots.length; j++) {
          const d2 = dots[j];
          const distSq = (d.x - d2.x) ** 2 + (d.y - d2.y) ** 2;
          if (distSq < 14000) {
            const a = (1 - distSq / 14000) * 0.08;
            ctx.strokeStyle = `rgba(0, 245, 212, ${a})`;
            ctx.beginPath();
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d2.x, d2.y);
            ctx.stroke();
          }
        }
      }
      requestAnimationFrame(renderAmbient);
    }
    requestAnimationFrame(renderAmbient);
  }

  // --- 2. MINIATURA VIVA: PARTÍCULAS (P01) ---
  function initThumbParticles() {
    const canvas = document.getElementById('thumbParticles');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0;

    const particles = [];
    const COUNT = 75;
    const colors = ['#00f5d4', '#3b82f6', '#9d4edd', '#f72585'];

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      w = canvas.width = Math.floor(rect.width);
      h = canvas.height = Math.floor(rect.height);
    }

    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * 300,
        y: Math.random() * 200,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        color: colors[i % colors.length],
        r: Math.random() * 2 + 1
      });
    }

    window.addEventListener('resize', resize);
    resize();

    function draw(now) {
      ctx.fillStyle = 'rgba(5, 7, 12, 0.35)';
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5 + Math.cos(now * 0.0015) * (w * 0.25);
      const cy = h * 0.5 + Math.sin(now * 0.002) * (h * 0.25);

      for (const p of particles) {
        // Atracción suave al centro orbital
        const dx = cx - p.x;
        const dy = cy - p.y;
        p.vx += dx * 0.0004;
        p.vy += dy * 0.0004;
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.x += p.vx;
        p.y += p.vy;

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 3. MINIATURA VIVA: AUTÓMATAS (P02) ---
  function initThumbAutomata() {
    const canvas = document.getElementById('thumbAutomata');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cols = 26;
    const rows = 14;

    function draw(now) {
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width)) {
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, w, h);

      const cw = w / cols;
      const ch = h / rows;
      const t = now * 0.002;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = Math.sin(c * 0.4 + t) * Math.cos(r * 0.5 - t * 0.7);
          if (val > 0.1) {
            const alpha = Math.min(0.85, (val - 0.1) * 1.1);
            ctx.fillStyle = val > 0.55 ? `rgba(0, 245, 212, ${alpha})` : `rgba(59, 130, 246, ${alpha * 0.7})`;
            ctx.beginPath();
            ctx.roundRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4, 3);
            ctx.fill();
          }
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 4. MINIATURA VIVA: ONDAS Y AUDIO (P03) ---
  function initThumbWaves() {
    const canvas = document.getElementById('thumbWaves');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw(now) {
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width)) {
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, w, h);

      const t = now * 0.0025;
      const waves = [
        { col: 'rgba(0, 245, 212, 0.75)', amp: 26, freq: 0.02, speed: 1.0 },
        { col: 'rgba(59, 130, 246, 0.6)', amp: 20, freq: 0.025, speed: -1.2 },
        { col: 'rgba(157, 78, 221, 0.5)', amp: 30, freq: 0.015, speed: 0.8 }
      ];

      for (const wave of waves) {
        ctx.strokeStyle = wave.col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = h * 0.5 + Math.sin(x * wave.freq + t * wave.speed) * wave.amp * Math.sin((x / w) * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 5. MINIATURA VIVA: DISPOSITIVO (P04) ---
  function initThumbDevice() {
    const canvas = document.getElementById('thumbDevice');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function draw(now) {
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width)) {
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#05070c';
      ctx.fillRect(0, 0, w, h);

      const t = now * 0.002;
      const bars = 16;
      const bw = (w - 40) / bars;

      for (let i = 0; i < bars; i++) {
        const val = (Math.sin(i * 0.45 + t) + 1) * 0.5;
        const bh = val * (h * 0.55);
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 245, 212, 0.7)' : 'rgba(59, 130, 246, 0.7)';
        ctx.fillRect(20 + i * bw, h - 25 - bh, bw - 4, bh);
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // Iniciar
  initAmbient();
  initThumbParticles();
  initThumbAutomata();
  initThumbWaves();
  initThumbDevice();
})();

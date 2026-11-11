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

  // --- 6. MINIATURA VIVA: FRACTALES (P05) ---
  function initThumbFractals() {
    const canvas = document.getElementById('thumbFractals');
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
      ctx.fillStyle = 'rgba(5, 7, 12, 0.32)';
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const t = now * 0.0018;
      const arms = 5;
      const pointsPerArm = 26;
      const maxR = Math.min(w, h) * 0.42;
      const palette = ['#00f5d4', '#3b82f6', '#9d4edd', '#f72585'];

      for (let a = 0; a < arms; a++) {
        const baseAngle = (a * Math.PI * 2) / arms + t * 0.7;
        for (let i = 1; i <= pointsPerArm; i++) {
          const frac = i / pointsPerArm;
          const r = frac * maxR;
          const spiral = baseAngle + frac * 4.2 + Math.sin(t + frac * 6.0) * 0.35;
          const x = cx + Math.cos(spiral) * r;
          const y = cy + Math.sin(spiral) * r * 0.82;

          ctx.fillStyle = palette[(i + a) % palette.length];
          ctx.beginPath();
          ctx.arc(x, y, (1 - frac * 0.5) * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 7. MINIATURA VIVA: RELOJ CÓSMICO (P06) ---
  function initThumbClock() {
    const canvas = document.getElementById('thumbClock');
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
      ctx.fillStyle = '#020306';
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.5;
      const t = now * 0.001;
      const rings = 12;
      const colors = ['#00f5d4', '#3b82f6', '#9d4edd', '#f72585'];

      for (let i = 0; i < rings; i++) {
        const rawZ = (i / rings + t * 0.4) % 1.0;
        const z = rawZ * rawZ;
        const r = z * (w * 0.48) + 2;
        const alpha = z * 0.85 + 0.1;

        ctx.strokeStyle = colors[i % colors.length];
        ctx.globalAlpha = alpha;
        ctx.lineWidth = Math.max(1, z * 2.2);

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 8. MINIATURA VIVA: NOTICIAS (P07) ---
  function initThumbNews() {
    const canvas = document.getElementById('thumbNews');
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
      ctx.fillStyle = '#06080e';
      ctx.fillRect(0, 0, w, h);

      const t = now * 0.0015;
      const cards = 4;
      const cw = (w - 30) / cards;

      for (let i = 0; i < cards; i++) {
        const offset = Math.sin(t + i * 1.2) * 12;
        const x = 15 + i * cw;
        const y = 30 + offset;
        const cardH = h - 60;

        ctx.fillStyle = 'rgba(13, 17, 26, 0.85)';
        ctx.strokeStyle = 'rgba(0, 245, 212, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, cw - 6, cardH, 8);
        ctx.fill();
        ctx.stroke();

        // Mini foto simulada
        ctx.fillStyle = i % 2 === 0 ? 'rgba(0, 245, 212, 0.2)' : 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(x + 4, y + 4, cw - 14, cardH * 0.42);

        // Líneas de texto simuladas
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(x + 4, y + cardH * 0.55, cw - 18, 3);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.fillRect(x + 4, y + cardH * 0.7, cw - 24, 3);
        ctx.fillRect(x + 4, y + cardH * 0.82, cw - 30, 3);
      }

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 9. MINIATURA VIVA: TIPOGRAFÍA 3D (P08) ---
  function initThumbLetters3d() {
    const canvas = document.getElementById('thumbLetters3d');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Construir puntos 3D del texto "JG" + "JAVIER" en offscreen canvas
    const off = document.createElement('canvas');
    off.width = 120;
    off.height = 52;
    const octx = off.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, 120, 52);
    octx.fillStyle = '#fff';
    octx.font = '900 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.fillText('JAVIER', 60, 16);
    octx.font = '900 19px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
    octx.fillText('GALILEA', 60, 38);

    const data = octx.getImageData(0, 0, 120, 52).data;
    const voxels = [];
    const zLayers = [-8, 0, 8];
    const palette = ['#00f5d4', '#3b82f6', '#9d4edd', '#f72585'];

    for (let y = 0; y < 52; y += 2) {
      for (let x = 0; x < 120; x += 2) {
        if (data[(y * 120 + x) * 4] > 128) {
          for (let l = 0; l < zLayers.length; l++) {
            if (l === 1 && (x + y) % 4 !== 0) continue;
            voxels.push({
              x: (x - 60) * 1.95,
              y: (y - 26) * 1.95,
              z: zLayers[l],
              col: palette[Math.floor((x / 120) * palette.length) % palette.length],
              front: l === zLayers.length - 1
            });
          }
        }
      }
    }

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

      const t = now * 0.0016;
      const rotY = Math.sin(t) * 0.52;
      const rotX = Math.cos(t * 0.7) * 0.22;
      const sinY = Math.sin(rotY), cosY = Math.cos(rotY);
      const sinX = Math.sin(rotX), cosX = Math.cos(rotX);
      const cx = w * 0.5;
      const cy = h * 0.5;

      for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        const waveZ = v.z + Math.sin(t * 2.2 + v.x * 0.04) * 7;
        const rx = v.x * cosY + waveZ * sinY;
        const rz1 = -v.x * sinY + waveZ * cosY;
        const ry = v.y * cosX - rz1 * sinX;
        const rz = v.y * sinX + rz1 * cosX;

        const scale = 240 / (240 + rz);
        const sx = cx + rx * scale;
        const sy = cy + ry * scale;
        const sz = Math.max(1.5, 2.7 * scale);

        ctx.fillStyle = v.front ? v.col : 'rgba(59, 130, 246, 0.38)';
        ctx.fillRect(sx - sz * 0.5, sy - sz * 0.5, sz, sz);
      }

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // --- 10. MINIATURA VIVA: RADAR & TRACKS 3 LETRAS (P09) ---
  function initThumbTracks() {
    const canvas = document.getElementById('thumbTracks');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const agents = [
      { id: 'JGG', col: '#00f5d4', phase: 0.0, speed: 1.0, rx: 0.34, ry: 0.28, trail: [] },
      { id: 'ANA', col: '#f72585', phase: 2.1, speed: -0.85, rx: 0.28, ry: 0.34, trail: [] },
      { id: 'MAX', col: '#3b82f6', phase: 4.2, speed: 0.72, rx: 0.38, ry: 0.22, trail: [] }
    ];

    function draw(now) {
      const rect = canvas.parentElement.getBoundingClientRect();
      if (canvas.width !== Math.floor(rect.width)) {
        canvas.width = Math.floor(rect.width);
        canvas.height = Math.floor(rect.height);
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#04060b';
      ctx.fillRect(0, 0, w, h);

      // Rejilla cartográfica oscura
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.06)';
      ctx.lineWidth = 1;
      for (let x = 24; x < w; x += 32) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 20; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const t = now * 0.0014;
      const cx = w * 0.5;
      const cy = h * 0.54;

      for (const a of agents) {
        const ang = t * a.speed + a.phase;
        const x = cx + Math.cos(ang) * (w * a.rx) + Math.sin(ang * 2.1) * 14;
        const y = cy + Math.sin(ang * 1.3) * (h * a.ry);

        a.trail.push({ x, y });
        if (a.trail.length > 42) a.trail.shift();

        if (a.trail.length > 1) {
          ctx.strokeStyle = a.col;
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          for (let i = 0; i < a.trail.length; i++) {
            if (i === 0) ctx.moveTo(a.trail[i].x, a.trail[i].y);
            else ctx.lineTo(a.trail[i].x, a.trail[i].y);
          }
          ctx.stroke();
        }

        // Baliza y código de 3 letras
        ctx.fillStyle = a.col;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'rgba(7, 10, 18, 0.88)';
        ctx.strokeStyle = a.col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x - 16, y - 20, 32, 13, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 8.5px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(a.id, x, y - 13);
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
  initThumbFractals();
  initThumbClock();
  initThumbNews();
  initThumbLetters3d();
  initThumbTracks();
})();

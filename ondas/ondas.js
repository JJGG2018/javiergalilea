/**
 * Subproyecto #03: Laboratorio de Ondas & Audio
 * javiergalilea.es/ondas/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;

  // Parámetros de onda
  let currentMode = 'harmonic'; // 'harmonic', 'lissajous', 'radial', 'interference'
  let currentPalette = 'spectral';
  let harmonicCount = 4;
  let baseFreq = 220; // Hz
  let waveType = 'sine';

  // Modulación por cursor
  let mouse = {
    x: 0,
    y: 0,
    active: false,
    freqMod: 1.0,
    ampMod: 1.0
  };

  // Web Audio API
  let audioCtx = null;
  let masterGain = null;
  let oscillators = [];
  let isAudioEnabled = false;

  // UI
  const audioStatus = document.getElementById('audioStatus');
  const freqReadout = document.getElementById('freqReadout');
  const fpsCounter = document.getElementById('fpsCounter');
  const toggleAudioBtn = document.getElementById('toggleAudioBtn');
  const audioBtnText = document.getElementById('audioBtnText');
  const harmonicsSlider = document.getElementById('harmonicsSlider');
  const harmonicsLabel = document.getElementById('harmonicsLabel');
  const baseFreqSlider = document.getElementById('baseFreqSlider');
  const baseFreqLabel = document.getElementById('baseFreqLabel');
  const canvasHint = document.getElementById('canvasHint');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const hudDock = document.getElementById('hudDock');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Paletas visuales
  const PALETTES = {
    spectral: ['#00f5d4', '#00bbf9', '#3b82f6', '#8338ec', '#f72585', '#fee440'],
    synthwave: ['#f72585', '#7209b7', '#3a0ca3', '#4361ee', '#4cc9f0'],
    cyan: ['#e0fbfc', '#98c1d9', '#3d5a80', '#293241', '#ee6c4d'],
    sunset: ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff']
  };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // --- AUDIO SYNTHESIS ENGINE ---
  function initAudio() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContextClass();

    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);

    rebuildOscillators();
  }

  function rebuildOscillators() {
    if (!audioCtx) return;

    // Detener y desconectar anteriores
    for (const osc of oscillators) {
      try {
        osc.stop();
        osc.disconnect();
      } catch (_) {}
    }
    oscillators = [];

    const now = audioCtx.currentTime;
    for (let i = 1; i <= harmonicCount; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = waveType;
      // Frecuencia armónica
      const targetFreq = baseFreq * i * mouse.freqMod;
      osc.frequency.setValueAtTime(Math.min(targetFreq, 18000), now);

      // Decaimiento exponencial por armónico
      const armGain = (1 / (i * 1.4)) * 0.15;
      gain.gain.setValueAtTime(armGain, now);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();

      oscillators.push({ osc, gain, harmonic: i });
    }
  }

  function updateAudioFrequencies() {
    if (!audioCtx || !isAudioEnabled) return;
    const now = audioCtx.currentTime;
    const actualFreq = baseFreq * mouse.freqMod;

    if (freqReadout) {
      freqReadout.textContent = actualFreq.toFixed(1);
    }

    for (const item of oscillators) {
      const targetFreq = Math.min(actualFreq * item.harmonic, 16000);
      item.osc.frequency.setTargetAtTime(targetFreq, now, 0.05);
    }
  }

  function toggleAudio() {
    if (!audioCtx) {
      initAudio();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    isAudioEnabled = !isAudioEnabled;
    const now = audioCtx.currentTime;

    if (isAudioEnabled) {
      masterGain.gain.setTargetAtTime(0.18, now, 0.1);
      toggleAudioBtn.classList.add('active');
      audioBtnText.textContent = '🔊 Silenciar';
      audioStatus.textContent = 'Audio: Activo';
    } else {
      masterGain.gain.setTargetAtTime(0.0001, now, 0.1);
      toggleAudioBtn.classList.remove('active');
      audioBtnText.textContent = '🔈 Activar Sonido';
      audioStatus.textContent = 'Audio: Desactivado';
    }
  }

  // --- RENDERIZADO VISUAL DE ONDAS ---
  function render(time) {
    ctx.fillStyle = 'rgba(6, 8, 14, 0.25)';
    ctx.fillRect(0, 0, width, height);

    const t = time * 0.002;
    const colors = PALETTES[currentPalette] || PALETTES.spectral;
    const effectiveFreq = baseFreq * mouse.freqMod;

    if (currentMode === 'harmonic') {
      drawHarmonics(t, colors, effectiveFreq);
    } else if (currentMode === 'lissajous') {
      drawLissajous(t, colors);
    } else if (currentMode === 'radial') {
      drawRadial(t, colors);
    } else if (currentMode === 'interference') {
      drawInterference(t, colors);
    }
  }

  function drawHarmonics(t, colors, f) {
    const cy = height * 0.5;
    const step = 2;
    const baseAmp = 45 * mouse.ampMod;

    for (let h = 1; h <= harmonicCount; h++) {
      const col = colors[(h - 1) % colors.length];
      const amp = baseAmp / (h * 0.65);
      const freqScale = (f * 0.0003) * h;
      const speed = h * 0.9;

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.2, 3.2 - h * 0.4);

      for (let x = 0; x <= width; x += step) {
        // Envolvente gaussiana en los extremos de la pantalla
        const edgeWindow = Math.sin((x / width) * Math.PI);
        const y = cy + Math.sin(x * freqScale + t * speed) * amp * edgeWindow;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawLissajous(t, colors) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const radiusX = Math.min(width, height) * 0.35 * mouse.ampMod;
    const radiusY = Math.min(width, height) * 0.35;
    const samples = 600;

    const a = harmonicCount;
    const b = Math.max(1, Math.round(harmonicCount * mouse.freqMod * 1.5));
    const delta = t * 1.2;

    for (let c = 0; c < 3; c++) {
      const col = colors[c % colors.length];
      const phaseOffset = (c * Math.PI) / 6;

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;

      for (let i = 0; i <= samples; i++) {
        const theta = (i / samples) * Math.PI * 2;
        const x = cx + radiusX * Math.sin(a * theta + delta + phaseOffset);
        const y = cy + radiusY * Math.sin(b * theta);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  function drawRadial(t, colors) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    const baseR = Math.min(width, height) * 0.22;
    const points = 360;

    for (let h = 1; h <= Math.min(harmonicCount, 6); h++) {
      const col = colors[(h - 1) % colors.length];
      const amp = (28 * mouse.ampMod) / h;
      const freq = h * 3;

      ctx.beginPath();
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.8;

      for (let i = 0; i <= points; i++) {
        const rad = (i / points) * Math.PI * 2;
        const offset = Math.sin(rad * freq + t * (h * 1.2)) * amp;
        const r = baseR * (0.6 + h * 0.25) + offset;
        const x = cx + Math.cos(rad) * r;
        const y = cy + Math.sin(rad) * r;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  function drawInterference(t, colors) {
    const step = 14;
    const cx1 = width * 0.35;
    const cy1 = height * 0.5;
    const cx2 = width * 0.65;
    const cy2 = height * 0.5;

    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += step) {
      for (let y = 0; y <= height; y += step) {
        const d1 = Math.hypot(x - cx1, y - cy1);
        const d2 = Math.hypot(x - cx2, y - cy2);

        const v1 = Math.sin(d1 * 0.04 - t * 3);
        const v2 = Math.sin(d2 * 0.04 * mouse.freqMod - t * 3);
        const combined = (v1 + v2) * 0.5;

        if (Math.abs(combined) > 0.4) {
          const colIdx = Math.floor(Math.abs(combined) * colors.length) % colors.length;
          ctx.fillStyle = colors[colIdx];
          const sz = Math.abs(combined) * 4.5 * mouse.ampMod;
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // --- LOOP PRINCIPAL ---
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    render(now);

    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      if (fpsCounter) fpsCounter.textContent = Math.round(frameCount / fpsTimer);
      frameCount = 0;
      fpsTimer = 0;
    }

    requestAnimationFrame(loop);
  }

  // --- EVENTOS ---
  function setupEvents() {
    window.addEventListener('resize', resize);

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;

      // Mapeo interactivo: X modula frecuencia (0.5x - 2.0x), Y modula amplitud (0.3x - 1.8x)
      mouse.freqMod = 0.5 + (e.clientX / width) * 1.5;
      mouse.ampMod = 1.8 - (e.clientY / height) * 1.5;

      updateAudioFrequencies();

      if (canvasHint && !canvasHint.classList.contains('fade-out')) {
        setTimeout(() => canvasHint.classList.add('fade-out'), 1800);
      }
    });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        mouse.x = touch.clientX;
        mouse.y = touch.clientY;
        mouse.active = true;
        mouse.freqMod = 0.5 + (touch.clientX / width) * 1.5;
        mouse.ampMod = 1.8 - (touch.clientY / height) * 1.5;
        updateAudioFrequencies();
      }
    }, { passive: true });

    // Modos
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
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

    // Timbre
    document.querySelectorAll('.wave-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wave-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        waveType = btn.dataset.type;
        rebuildOscillators();
      });
    });

    // Sliders
    harmonicsSlider.addEventListener('input', (e) => {
      harmonicCount = parseInt(e.target.value, 10);
      harmonicsLabel.textContent = `${harmonicCount} capas`;
      rebuildOscillators();
    });

    baseFreqSlider.addEventListener('input', (e) => {
      baseFreq = parseInt(e.target.value, 10);
      baseFreqLabel.textContent = `${baseFreq} Hz`;
      updateAudioFrequencies();
    });

    // Audio
    toggleAudioBtn.addEventListener('click', toggleAudio);

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

  resize();
  setupEvents();
  requestAnimationFrame(loop);
})();

/**
 * Subproyecto #03: Laboratorio de Ondas & Audio (Rust + WASM)
 * javiergalilea.es/ondas/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('waveCanvas');
  const ctx = canvas.getContext('2d');

  let wasmInstance = null;
  let wasmMemory = null;
  let waveBufferPtr = 0;

  let width = 0;
  let height = 0;

  let currentMode = 'harmonic';
  let currentPalette = 'spectral';
  let harmonicCount = 4;
  let baseFreq = 440;
  let waveType = 'sine';

  let mouse = {
    x: 0,
    y: 0,
    active: false,
    freqMod: 1.0,
    ampMod: 1.0
  };

  let audioCtx = null;
  let masterGain = null;
  let oscillators = [];
  let isAudioEnabled = false;

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

  // Audio Engine
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
      const targetFreq = baseFreq * i * mouse.freqMod;
      osc.frequency.setValueAtTime(Math.min(targetFreq, 20000), now);

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
      const targetFreq = Math.min(actualFreq * item.harmonic, 20000);
      item.osc.frequency.setTargetAtTime(targetFreq, now, 0.05);
    }
  }

  function toggleAudio() {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

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

  // Renderizado consumiendo buffer calculado en Rust
  function render(time) {
    ctx.fillStyle = 'rgba(6, 8, 14, 0.25)';
    ctx.fillRect(0, 0, width, height);

    if (!wasmInstance || !wasmMemory) return;

    const t = time * 0.002;
    const colors = PALETTES[currentPalette] || PALETTES.spectral;
    const effectiveFreq = baseFreq * mouse.freqMod;
    const samples = Math.min(Math.floor(width / 2), 1024);

    if (currentMode === 'harmonic') {
      for (let h = 1; h <= harmonicCount; h++) {
        const col = colors[(h - 1) % colors.length];
        const count = wasmInstance.exports.calculate_harmonics(
          samples,
          width,
          height,
          effectiveFreq,
          h,
          t,
          mouse.ampMod
        );

        const f32 = new Float32Array(wasmMemory.buffer, waveBufferPtr, count * 2);

        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = Math.max(1.2, 3.2 - h * 0.4);

        for (let i = 0; i < count; i++) {
          const x = f32[i * 2];
          const y = f32[i * 2 + 1];
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (currentMode === 'lissajous') {
      const cx = width * 0.5;
      const cy = height * 0.5;
      const rx = Math.min(width, height) * 0.35 * mouse.ampMod;
      const ry = Math.min(width, height) * 0.35;
      const a = harmonicCount;
      const b = Math.max(1, Math.round(harmonicCount * mouse.freqMod * 1.5));
      const delta = t * 1.2;

      for (let c = 0; c < 3; c++) {
        const col = colors[c % colors.length];
        const phaseOffset = (c * Math.PI) / 6;

        const count = wasmInstance.exports.calculate_lissajous(
          600,
          cx,
          cy,
          rx,
          ry,
          a,
          b,
          delta + phaseOffset
        );

        const f32 = new Float32Array(wasmMemory.buffer, waveBufferPtr, count * 2);

        ctx.beginPath();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;

        for (let i = 0; i < count; i++) {
          const x = f32[i * 2];
          const y = f32[i * 2 + 1];
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  // Loop
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

  function setupEvents() {
    window.addEventListener('resize', resize);

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;

      mouse.freqMod = 0.5 + (e.clientX / width) * 1.5;
      mouse.ampMod = 1.8 - (e.clientY / height) * 1.5;

      updateAudioFrequencies();

      if (canvasHint && !canvasHint.classList.contains('fade-out')) {
        setTimeout(() => canvasHint.classList.add('fade-out'), 1800);
      }
    });

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentMode = btn.dataset.mode;
      });
    });

    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.palette;
      });
    });

    document.querySelectorAll('.wave-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wave-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        waveType = btn.dataset.type;
        rebuildOscillators();
      });
    });

    harmonicsSlider.addEventListener('input', (e) => {
      harmonicCount = parseInt(e.target.value, 10);
      harmonicsLabel.textContent = `${harmonicCount} capas`;
      rebuildOscillators();
    });

    baseFreqSlider.addEventListener('input', (e) => {
      baseFreq = parseInt(e.target.value, 10);
      baseFreqLabel.textContent = baseFreq >= 1000 ? `${(baseFreq / 1000).toFixed(1)} kHz` : `${baseFreq} Hz`;
      updateAudioFrequencies();
    });

    toggleAudioBtn.addEventListener('click', toggleAudio);

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
      waveBufferPtr = wasmInstance.exports.get_wave_buffer_ptr();

      console.log('✅ ondas_engine.wasm (Rust) cargado.');
    } catch (err) {
      console.error('Error cargando ondas_engine.wasm:', err);
    }
  }

  resize();
  setupEvents();
  initWasm();
  requestAnimationFrame(loop);
})();

/**
 * Subproyecto #05: Explorador de Fractales & Caos (Rust + WASM)
 * javiergalilea.es/pr_fractales/
 */

(function () {
  'use strict';

  const canvas = document.getElementById('fractalCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  // Lienzo intermedio acoplado al buffer RGBA de WebAssembly
  const offscreen = document.createElement('canvas');
  const offCtx = offscreen.getContext('2d', { alpha: false });

  let wasmInstance = null;
  let wasmMemory = null;
  let pixelBufferPtr = 0;

  // Resolución interna adaptativa para mantener 60 FPS fluidos en tiempo real
  const MAX_RENDER_W = 640;
  const MAX_RENDER_H = 360;
  let renderW = 480;
  let renderH = 270;

  // Estado matemático del plano complejo
  let fractalType = 0; // 0: Mandelbrot, 1: Julia, 2: Burning Ship, 3: Tricorn
  let paletteIdx = 0;  // 0: Cosmos, 1: Cyber, 2: Solar, 3: Bio
  let maxIter = 120;

  let centerX = -0.55;
  let centerY = 0.0;
  let scale = 3.2; // Ancho del plano complejo visible
  const BASE_SCALE = 3.2;

  // Interpolación suave hacia el objetivo (zoom/pan sedoso)
  let targetX = -0.55;
  let targetY = 0.0;
  let targetScale = 3.2;

  // Parámetro complejo c para el conjunto de Julia
  let juliaCx = -0.7269;
  let juliaCy = 0.1889;
  let orbitJulia = false;
  let cycleColor = true;
  let colorShift = 0.0;

  // Interacción de puntero
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginCenterX = 0;
  let dragOriginCenterY = 0;
  let isInteracting = false;
  let interactionTimeout = null;

  // Elementos UI
  const zoomReadout = document.getElementById('zoomReadout');
  const coordReadout = document.getElementById('coordReadout');
  const fpsCounter = document.getElementById('fpsCounter');
  const resetViewBtn = document.getElementById('resetViewBtn');
  const orbitBtn = document.getElementById('orbitBtn');
  const cycleColorBtn = document.getElementById('cycleColorBtn');
  const iterSlider = document.getElementById('iterSlider');
  const iterLabel = document.getElementById('iterLabel');
  const canvasHint = document.getElementById('canvasHint');
  const toggleHudBtn = document.getElementById('toggleHudBtn');
  const hudDock = document.getElementById('hudDock');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  const FRACTAL_MAP = {
    mandelbrot: 0,
    julia: 1,
    ship: 2,
    tricorn: 3
  };

  const PALETTE_MAP = {
    cosmos: 0,
    cyber: 1,
    solar: 2,
    emerald: 3
  };

  const PRESETS = {
    seahorse: {
      fractal: 'mandelbrot',
      x: -0.7453,
      y: 0.1127,
      scale: 0.018,
      iter: 240,
      palette: 'cosmos'
    },
    spiral: {
      fractal: 'mandelbrot',
      x: -0.761574,
      y: -0.0847596,
      scale: 0.0045,
      iter: 280,
      palette: 'cyber'
    },
    dendrite: {
      fractal: 'julia',
      x: 0.0,
      y: 0.0,
      scale: 2.8,
      juliaCx: -0.4,
      juliaCy: 0.6,
      iter: 160,
      palette: 'cosmos'
    },
    armada: {
      fractal: 'ship',
      x: -1.755,
      y: -0.032,
      scale: 0.085,
      iter: 200,
      palette: 'solar'
    }
  };

  function markInteracting() {
    isInteracting = true;
    if (interactionTimeout) clearTimeout(interactionTimeout);
    interactionTimeout = setTimeout(() => {
      isInteracting = false;
    }, 180);

    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      canvasHint.classList.add('fade-out');
    }
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    updateRenderResolution();
  }

  function updateRenderResolution() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const scaleFactor = (isInteracting || orbitJulia || cycleColor) ? 0.72 : 0.95;
    renderW = Math.min(MAX_RENDER_W, Math.max(240, Math.floor(520 * scaleFactor)));
    renderH = Math.min(MAX_RENDER_H, Math.max(160, Math.floor(renderW / aspect)));

    if (offscreen.width !== renderW || offscreen.height !== renderH) {
      offscreen.width = renderW;
      offscreen.height = renderH;
    }
  }

  function formatZoom(currentScale) {
    const z = BASE_SCALE / Math.max(currentScale, 1e-14);
    if (z >= 1e6) return `${(z / 1e6).toFixed(1)}M×`;
    if (z >= 1e3) return `${(z / 1e3).toFixed(1)}k×`;
    return `${z.toFixed(1)}×`;
  }

  function formatCoord(re, im) {
    const sign = im >= 0 ? '+' : '-';
    return `${re.toFixed(4)} ${sign} ${Math.abs(im).toFixed(4)}i`;
  }

  function updateTelemetry() {
    if (zoomReadout) {
      zoomReadout.textContent = formatZoom(scale);
    }
    if (coordReadout) {
      if (fractalType === 1) {
        coordReadout.textContent = `c = ${formatCoord(juliaCx, juliaCy)}`;
      } else {
        coordReadout.textContent = formatCoord(centerX, centerY);
      }
    }
  }

  function resetViewForFractal(type) {
    if (type === 1) {
      targetX = 0.0;
      targetY = 0.0;
      targetScale = 3.0;
    } else if (type === 2) {
      targetX = -0.45;
      targetY = -0.5;
      targetScale = 3.4;
    } else {
      targetX = -0.55;
      targetY = 0.0;
      targetScale = 3.2;
    }
  }

  function render(now, dt) {
    // Interpolación suave de cámara
    const lerp = 1.0 - Math.pow(0.001, dt);
    centerX += (targetX - centerX) * lerp;
    centerY += (targetY - centerY) * lerp;
    scale += (targetScale - scale) * lerp;

    if (orbitJulia) {
      const t = now * 0.00065;
      juliaCx = -0.745 + Math.cos(t) * 0.085;
      juliaCy = 0.186 + Math.sin(t * 1.3) * 0.085;
    }

    if (cycleColor) {
      colorShift = (colorShift + dt * 1.6) % 62.83185;
    }

    updateRenderResolution();
    updateTelemetry();

    if (!wasmInstance || !wasmMemory) return;

    wasmInstance.exports.render_fractal(
      renderW,
      renderH,
      centerX,
      centerY,
      scale,
      juliaCx,
      juliaCy,
      maxIter,
      fractalType,
      paletteIdx,
      colorShift
    );

    const byteLength = renderW * renderH * 4;
    const pixels = new Uint8ClampedArray(wasmMemory.buffer, pixelBufferPtr, byteLength);
    const imgData = new ImageData(pixels, renderW, renderH);

    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
  }

  // Bucle principal y contador FPS
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsAccumulator = 0;

  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    render(now, dt);

    frameCount++;
    fpsAccumulator += dt;
    if (fpsAccumulator >= 0.5) {
      if (fpsCounter) {
        fpsCounter.textContent = Math.round(frameCount / fpsAccumulator);
      }
      frameCount = 0;
      fpsAccumulator = 0;
    }

    requestAnimationFrame(loop);
  }

  function zoomAtPoint(clientX, clientY, zoomFactor) {
    markInteracting();
    const rect = canvas.getBoundingClientRect();
    const normX = (clientX - rect.left) / rect.width - 0.5;
    const normY = (clientY - rect.top) / rect.height - 0.5;
    const aspect = rect.height / Math.max(1, rect.width);

    const worldX = targetX + normX * targetScale;
    const worldY = targetY + normY * targetScale * aspect;

    const newScale = Math.max(1e-12, Math.min(8.0, targetScale * zoomFactor));
    targetX = worldX - normX * newScale;
    targetY = worldY - normY * newScale * aspect;
    targetScale = newScale;
  }

  function setupEvents() {
    window.addEventListener('resize', resize);

    // Zoom centrado en el cursor con la rueda del ratón
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 0.8 : 1.25;
      zoomAtPoint(e.clientX, e.clientY, factor);
    }, { passive: false });

    // Doble clic para acercar (Shift + doble clic para alejar)
    canvas.addEventListener('dblclick', (e) => {
      const factor = e.shiftKey ? 2.0 : 0.45;
      zoomAtPoint(e.clientX, e.clientY, factor);
    });

    // Arrastrar para desplazar el plano complejo
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragOriginCenterX = targetX;
      dragOriginCenterY = targetY;
      markInteracting();
    });

    window.addEventListener('mousemove', (e) => {
      if (isDragging) {
        markInteracting();
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const unitsPerPixel = targetScale / Math.max(1, canvas.width);
        targetX = dragOriginCenterX - dx * unitsPerPixel;
        targetY = dragOriginCenterY - dy * unitsPerPixel;
      } else if (fractalType === 1 && !orbitJulia) {
        // En modo Julia sin órbita automática, el cursor modula suavemente el parámetro c
        const nx = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
        const ny = (e.clientY / Math.max(1, window.innerHeight)) * 2 - 1;
        juliaCx = -0.7 + nx * 0.35;
        juliaCy = 0.25 + ny * 0.35;
      }
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Soporte táctil (arrastre con 1 dedo)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        dragStartX = e.touches[0].clientX;
        dragStartY = e.touches[0].clientY;
        dragOriginCenterX = targetX;
        dragOriginCenterY = targetY;
        markInteracting();
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        markInteracting();
        const dx = e.touches[0].clientX - dragStartX;
        const dy = e.touches[0].clientY - dragStartY;
        const unitsPerPixel = targetScale / Math.max(1, canvas.width);
        targetX = dragOriginCenterX - dx * unitsPerPixel;
        targetY = dragOriginCenterY - dy * unitsPerPixel;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDragging = false;
    });

    // Selector de conjunto fractal
    document.querySelectorAll('.fractal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fractal-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        fractalType = FRACTAL_MAP[btn.dataset.fractal] ?? 0;
        resetViewForFractal(fractalType);
      });
    });

    // Viajes rápidos (presets)
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = PRESETS[btn.dataset.preset];
        if (!preset) return;

        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        fractalType = FRACTAL_MAP[preset.fractal] ?? 0;
        document.querySelectorAll('.fractal-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.fractal === preset.fractal);
        });

        targetX = preset.x;
        targetY = preset.y;
        targetScale = preset.scale;
        maxIter = preset.iter;
        iterSlider.value = String(maxIter);
        iterLabel.textContent = `${maxIter} iter`;

        if (preset.juliaCx !== undefined) {
          juliaCx = preset.juliaCx;
          juliaCy = preset.juliaCy;
        }

        if (preset.palette) {
          paletteIdx = PALETTE_MAP[preset.palette] ?? 0;
          document.querySelectorAll('.palette-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.palette === preset.palette);
          });
        }
      });
    });

    // Botones de modulación
    orbitBtn.addEventListener('click', () => {
      orbitJulia = !orbitJulia;
      orbitBtn.classList.toggle('active', orbitJulia);
      if (orbitJulia && fractalType !== 1) {
        fractalType = 1;
        document.querySelectorAll('.fractal-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.fractal === 'julia');
        });
        resetViewForFractal(1);
      }
    });

    cycleColorBtn.addEventListener('click', () => {
      cycleColor = !cycleColor;
      cycleColorBtn.classList.toggle('active', cycleColor);
    });

    // Selector de paleta
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        paletteIdx = PALETTE_MAP[btn.dataset.palette] ?? 0;
      });
    });

    // Slider de iteraciones
    iterSlider.addEventListener('input', (e) => {
      maxIter = parseInt(e.target.value, 10);
      iterLabel.textContent = `${maxIter} iter`;
    });

    // Reiniciar vista
    resetViewBtn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      resetViewForFractal(fractalType);
    });

    // Mostrar/Ocultar HUD
    toggleHudBtn.addEventListener('click', () => {
      hudDock.classList.toggle('collapsed');
    });

    // Modo inmersivo (ocultar todo salvo volver atrás)
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

  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      wasmMemory = wasmInstance.exports.memory;
      pixelBufferPtr = wasmInstance.exports.get_pixel_buffer_ptr();

      console.log('✅ fractales_engine.wasm (Rust) cargado.');
    } catch (err) {
      console.error('Error cargando fractales_engine.wasm:', err);
    }
  }

  resize();
  setupEvents();
  initWasm();
  requestAnimationFrame(loop);
})();

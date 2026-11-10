/**
 * Subproyecto #08: Escultura Tipográfica 3D Interactiva — Javier Galilea (Rust + WebAssembly)
 * javiergalilea.es/pr_letras3d/
 */

(function () {
  'use strict';

  const MAX_NODES = 4096;

  let wasmInstance = null;
  let wasmMemory = null;
  let targetsPtr = 0;
  let projectedPtr = 0;
  let nodeCount = 0;

  // Fallback buffers if WASM hasn't finished loading on frame 1
  const jsTargets = new Float32Array(MAX_NODES * 4);
  const jsProjected = new Float32Array(MAX_NODES * 6);

  const canvas = document.getElementById('lettersCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = 1;

  // Estado de cámara 3D e inercia
  let rotX = -0.16;
  let rotY = 0.28;
  let velRotX = 0;
  let velRotY = 0;
  let zoom = 1.05;
  let isDragging = false;
  let lastDragX = 0;
  let lastDragY = 0;
  let autoOrbitTime = 0;

  // Opciones activas del HUD
  let currentLayout = 'stacked'; // 'stacked' | 'monogram' | 'cylinder'
  let currentRender = 'cubes';   // 'cubes' | 'plexus' | 'hologram'
  let currentAnim = 0;           // 0 = Onda, 1 = Torsión, 2 = Levitación, 3 = Vórtice
  let currentPalette = 'cyber';
  let depthMult = 1.2;

  const mouse = {
    x: -2000,
    y: -2000,
    active: 0
  };

  // Paletas cromáticas RGB pre-parseadas para sombreado 3D rápido
  const PALETTES = {
    cyber: [
      [0, 245, 212],
      [59, 130, 246],
      [157, 78, 221],
      [247, 37, 133],
      [56, 189, 248]
    ],
    solar: [
      [255, 190, 11],
      [251, 86, 7],
      [255, 0, 110],
      [131, 56, 236],
      [255, 229, 127]
    ],
    aurora: [
      [45, 212, 191],
      [56, 189, 248],
      [129, 140, 248],
      [192, 132, 252],
      [167, 243, 208]
    ],
    gold: [
      [251, 191, 36],
      [245, 158, 11],
      [226, 232, 240],
      [148, 163, 184],
      [254, 240, 138]
    ]
  };

  // Estrellas de fondo 3D ambiental
  const BG_STARS = [];
  for (let i = 0; i < 90; i++) {
    BG_STARS.push({
      x: (Math.random() - 0.5) * 1800,
      y: (Math.random() - 0.5) * 1200,
      z: (Math.random() - 0.5) * 900,
      r: Math.random() * 1.6 + 0.5
    });
  }

  // Índices pre-alocados para ordenación Z (Painter's Algorithm)
  const sortIndices = new Int32Array(MAX_NODES);

  // Elementos DOM de telemetría
  const voxelCountEl = document.getElementById('voxelCount');
  const fpsEl = document.getElementById('fpsCounter');
  const wasmTimeEl = document.getElementById('wasmTime');
  const depthSlider = document.getElementById('depthSlider');
  const depthLabel = document.getElementById('depthLabel');
  const canvasHint = document.getElementById('canvasHint');

  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let lastWasmDuration = 0.12;

  /**
   * Rasteriza un texto en un canvas offscreen y extrae una matriz de píxeles activos
   * etiquetados por índice de letra.
   */
  function sampleWordPixels(word, fontSize, step, letterOffset) {
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    const fontSpec = `900 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
    octx.font = fontSpec;

    const charWidths = [];
    let totalW = 0;
    const tracking = Math.round(fontSize * 0.08);
    for (let i = 0; i < word.length; i++) {
      const m = octx.measureText(word[i]);
      const cw = Math.ceil(m.width);
      charWidths.push(cw);
      totalW += cw + (i < word.length - 1 ? tracking : 0);
    }

    const pad = 16;
    const w = Math.max(64, totalW + pad * 2);
    const h = Math.ceil(fontSize * 1.35);
    off.width = w;
    off.height = h;

    octx.fillStyle = '#000';
    octx.fillRect(0, 0, w, h);
    octx.font = fontSpec;
    octx.textBaseline = 'middle';
    octx.fillStyle = '#fff';

    const charRanges = [];
    let cursorX = pad;
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      octx.fillText(ch, cursorX, h * 0.52);
      charRanges.push({
        start: cursorX,
        end: cursorX + charWidths[i] + tracking * 0.5,
        letterId: letterOffset + i
      });
      cursorX += charWidths[i] + tracking;
    }

    const img = octx.getImageData(0, 0, w, h).data;
    const points = [];

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const idx = (y * w + x) * 4;
        if (img[idx] > 128) {
          // Comprobar si es borde para optimizar capas intermedias
          const isEdge =
            x < step || x >= w - step || y < step || y >= h - step ||
            img[(y * w + (x - step)) * 4] <= 128 ||
            img[(y * w + (x + step)) * 4] <= 128 ||
            img[((y - step) * w + x) * 4] <= 128 ||
            img[((y + step) * w + x) * 4] <= 128;

          let letterId = letterOffset;
          for (let c = 0; c < charRanges.length; c++) {
            if (x >= charRanges[c].start && x <= charRanges[c].end) {
              letterId = charRanges[c].letterId;
              break;
            }
          }

          points.push({
            x: x - w * 0.5,
            y: y - h * 0.5,
            isEdge,
            letterId
          });
        }
      }
    }

    return { points, width: w, height: h };
  }

  /**
   * Construye la nube volumétrica 3D según la escultura seleccionada:
   * - 'stacked': JAVIER arriba + GALILEA abajo en bloque 3D extruido
   * - 'monogram': Monograma central "JG" gigante + anillo orbital "JAVIER GALILEA"
   * - 'cylinder': Cilindro panorámico 360° con las letras de "JAVIER · GALILEA"
   */
  function buildLayoutTargets(layoutType, snapImmediately) {
    const out = [];

    if (layoutType === 'stacked') {
      const row1 = sampleWordPixels('JAVIER', 92, 4, 0);
      const row2 = sampleWordPixels('GALILEA', 84, 4, 6);
      const zLayers = [-24, -12, 0, 12, 24];

      for (const p of row1.points) {
        for (let l = 0; l < zLayers.length; l++) {
          const isOuterFace = l === 0 || l === zLayers.length - 1;
          if (isOuterFace || p.isEdge) {
            out.push(p.x * 1.18, p.y * 1.18 - 64, zLayers[l], p.letterId);
          }
        }
      }

      for (const p of row2.points) {
        for (let l = 0; l < zLayers.length; l++) {
          const isOuterFace = l === 0 || l === zLayers.length - 1;
          if (isOuterFace || p.isEdge) {
            out.push(p.x * 1.12, p.y * 1.12 + 64, zLayers[l], p.letterId);
          }
        }
      }
    } else if (layoutType === 'monogram') {
      // Monograma central JG con gran extrusión 3D
      const core = sampleWordPixels('JG', 150, 5, 0);
      const coreLayers = [-38, -22, -8, 8, 22, 38];

      for (const p of core.points) {
        for (let l = 0; l < coreLayers.length; l++) {
          const isOuterFace = l === 0 || l === coreLayers.length - 1;
          if (isOuterFace || p.isEdge) {
            out.push(p.x * 1.1, p.y * 1.1, coreLayers[l], p.letterId);
          }
        }
      }

      // Anillo orbital 3D con "JAVIER · GALILEA · "
      const ringText = sampleWordPixels('JAVIER · GALILEA ·', 56, 4, 2);
      const radius = 310;
      const ringLayers = [-8, 8];

      for (const p of ringText.points) {
        const theta = (p.x / (ringText.width * 0.5)) * Math.PI;
        for (let l = 0; l < ringLayers.length; l++) {
          if (l === 0 || p.isEdge) {
            const r = radius + ringLayers[l];
            const rx = Math.sin(theta) * r;
            const rz = Math.cos(theta) * r;
            const ry = p.y * 0.95 + Math.cos(theta * 2.0) * 18;
            out.push(rx, ry, rz, p.letterId);
          }
        }
      }
    } else if (layoutType === 'cylinder') {
      // Cilindro doble 360° con JAVIER y GALILEA
      const band1 = sampleWordPixels('JAVIER · JAVIER ·', 76, 4, 0);
      const band2 = sampleWordPixels('GALILEA · GALILEA ·', 72, 4, 6);
      const radius = 285;
      const layers = [-10, 10];

      for (const p of band1.points) {
        const theta = (p.x / (band1.width * 0.5)) * Math.PI;
        for (let l = 0; l < layers.length; l++) {
          if (l === 0 || p.isEdge) {
            const r = radius + layers[l];
            out.push(
              Math.sin(theta) * r,
              p.y * 1.05 - 56,
              Math.cos(theta) * r,
              p.letterId
            );
          }
        }
      }

      for (const p of band2.points) {
        const theta = (p.x / (band2.width * 0.5)) * Math.PI + 0.35;
        for (let l = 0; l < layers.length; l++) {
          if (l === 0 || p.isEdge) {
            const r = radius + layers[l];
            out.push(
              Math.sin(theta) * r,
              p.y * 1.05 + 56,
              Math.cos(theta) * r,
              p.letterId
            );
          }
        }
      }
    }

    const totalNodes = Math.min(Math.floor(out.length / 4), MAX_NODES);
    nodeCount = totalNodes;

    for (let i = 0; i < totalNodes * 4; i++) {
      jsTargets[i] = out[i];
    }

    if (wasmInstance && wasmMemory) {
      const wasmTargets = new Float32Array(wasmMemory.buffer, targetsPtr, MAX_NODES * 4);
      wasmTargets.set(jsTargets.subarray(0, totalNodes * 4));
      if (snapImmediately) {
        wasmInstance.exports.snap_to_targets(nodeCount);
      }
    }

    if (voxelCountEl) {
      voxelCountEl.textContent = nodeCount.toLocaleString('es-ES');
    }
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hideHintOnce() {
    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      setTimeout(() => canvasHint.classList.add('fade-out'), 2400);
    }
  }

  function triggerExplosion(strength = 26.0) {
    if (wasmInstance) {
      wasmInstance.exports.explode(nodeCount, strength);
    }
  }

  function setupInteractivity() {
    canvas.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastDragX = e.clientX;
      lastDragY = e.clientY;
      hideHintOnce();
    });

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = isDragging ? 0 : 1;

      if (isDragging) {
        const dx = e.clientX - lastDragX;
        const dy = e.clientY - lastDragY;
        velRotY = dx * 0.0065;
        velRotX = -dy * 0.0055;
        rotY += velRotY;
        rotX = Math.max(-1.15, Math.min(1.15, rotX + velRotX));
        lastDragX = e.clientX;
        lastDragY = e.clientY;
      }
      hideHintOnce();
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    window.addEventListener('mouseleave', () => {
      isDragging = false;
      mouse.active = 0;
    });

    canvas.addEventListener('dblclick', () => {
      triggerExplosion(32.0);
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      zoom = Math.max(0.55, Math.min(2.1, zoom + delta));
      hideHintOnce();
    }, { passive: false });

    // Soporte táctil (móvil y tablet)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        lastDragX = e.touches[0].clientX;
        lastDragY = e.touches[0].clientY;
        mouse.x = lastDragX;
        mouse.y = lastDragY;
        mouse.active = 1;
        hideHintOnce();
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isDragging) {
        const tx = e.touches[0].clientX;
        const ty = e.touches[0].clientY;
        const dx = tx - lastDragX;
        const dy = ty - lastDragY;
        velRotY = dx * 0.006;
        velRotX = -dy * 0.005;
        rotY += velRotY;
        rotX = Math.max(-1.15, Math.min(1.15, rotX + velRotX));
        lastDragX = tx;
        lastDragY = ty;
        mouse.x = tx;
        mouse.y = ty;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      isDragging = false;
      mouse.active = 0;
    });

    // Botones de Escultura 3D (Layout)
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLayout = btn.dataset.layout;
        buildLayoutTargets(currentLayout, false);
        triggerExplosion(12.0);
      });
    });

    // Botones de Geometría Visual
    document.querySelectorAll('.render-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.render-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRender = btn.dataset.render;
      });
    });

    // Botones de Dinámica Física
    document.querySelectorAll('.anim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.anim-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentAnim = parseInt(btn.dataset.anim, 10);
      });
    });

    // Botones de Paleta Cromática
    document.querySelectorAll('.palette-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPalette = btn.dataset.palette;
      });
    });

    // Slider de Extrusión Z
    if (depthSlider) {
      depthSlider.addEventListener('input', (e) => {
        depthMult = parseFloat(e.target.value);
        if (depthLabel) depthLabel.textContent = `${depthMult.toFixed(1)}×`;
      });
    }

    // Botón Impulso 3D
    const explodeBtn = document.getElementById('explodeBtn');
    if (explodeBtn) {
      explodeBtn.addEventListener('click', () => {
        triggerExplosion(30.0);
      });
    }

    // Botón Centrar Vista
    const resetCamBtn = document.getElementById('resetCamBtn');
    if (resetCamBtn) {
      resetCamBtn.addEventListener('click', () => {
        rotX = -0.16;
        rotY = 0.25;
        velRotX = 0;
        velRotY = 0;
        zoom = 1.05;
      });
    }

    // Mostrar/Ocultar Dock
    const hudDock = document.getElementById('hudDock');
    const toggleHudBtn = document.getElementById('toggleHudBtn');
    if (toggleHudBtn && hudDock) {
      toggleHudBtn.addEventListener('click', () => {
        hudDock.classList.toggle('collapsed');
      });
    }

    // Modo Inmersivo Limpio
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

    // Pantalla Completa
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
  }

  function drawAmbientStars(sinX, cosX, sinY, cosY) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    for (let i = 0; i < BG_STARS.length; i++) {
      const s = BG_STARS[i];
      const rx1 = s.x * cosY + s.z * sinY;
      const rz1 = -s.x * sinY + s.z * cosY;
      const ry2 = s.y * cosX - rz1 * sinX;
      const rz2 = s.y * sinX + rz1 * cosX;
      const zCam = rz2 + 950;
      if (zCam > 100) {
        const sc = 650 / zCam;
        const sx = cx + rx1 * sc;
        const sy = cy + ry2 * sc;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r * sc, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function render(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const timeSec = now * 0.001;

    // Fondo espacial con ligero rastro
    ctx.fillStyle = currentRender === 'hologram'
      ? 'rgba(4, 6, 12, 0.38)'
      : 'rgba(5, 7, 12, 0.88)';
    ctx.fillRect(0, 0, width, height);

    // Rotación inercial + balanceo orbital suave en reposo
    if (!isDragging) {
      rotY += velRotY;
      rotX = Math.max(-1.15, Math.min(1.15, rotX + velRotX));
      velRotX *= 0.92;
      velRotY *= 0.92;

      autoOrbitTime += dt;
      if (currentLayout === 'cylinder' || currentLayout === 'monogram') {
        rotY += dt * 0.38;
      } else {
        rotY += Math.cos(autoOrbitTime * 0.55) * dt * 0.18;
        rotX += Math.sin(autoOrbitTime * 0.4) * dt * 0.05;
      }
    }

    const sinX = Math.sin(rotX);
    const cosX = Math.cos(rotX);
    const sinY = Math.sin(rotY);
    const cosY = Math.cos(rotY);

    drawAmbientStars(sinX, cosX, sinY, cosY);

    let projView = jsProjected;

    if (wasmInstance && wasmMemory && nodeCount > 0) {
      const t0 = performance.now();
      wasmInstance.exports.update_scene(
        nodeCount,
        width,
        height,
        rotX,
        rotY,
        zoom,
        timeSec,
        dt,
        currentAnim,
        depthMult,
        mouse.x,
        mouse.y,
        mouse.active,
        115.0
      );
      const t1 = performance.now();
      lastWasmDuration = t1 - t0;
      projView = new Float32Array(wasmMemory.buffer, projectedPtr, nodeCount * 6);
    }

    // Ordenar nodos de atrás hacia adelante (mayor sz primero) para perspectiva 3D real
    for (let i = 0; i < nodeCount; i++) {
      sortIndices[i] = i;
    }
    const indices = sortIndices.subarray(0, nodeCount);
    indices.sort((a, b) => projView[b * 6 + 2] - projView[a * 6 + 2]);

    const palette = PALETTES[currentPalette] || PALETTES.cyber;
    const pLen = palette.length;

    ctx.save();
    if (currentRender === 'hologram') {
      ctx.globalCompositeOperation = 'lighter';
    }

    // Si estamos en modo Red Neural (plexus), dibujar primero filamentos 3D entre nodos cercanos
    if (currentRender === 'plexus') {
      ctx.lineWidth = 0.85;
      const stride = 2;
      for (let idx = 0; idx < nodeCount; idx += stride) {
        const i = indices[idx];
        const b1 = i * 6;
        const x1 = projView[b1];
        const y1 = projView[b1 + 1];
        const z1 = projView[b1 + 2];
        const let1 = projView[b1 + 5];

        for (let next = idx + 1; next < Math.min(idx + 14, nodeCount); next++) {
          const j = indices[next];
          const b2 = j * 6;
          if (projView[b2 + 5] !== let1) continue;
          const dx = x1 - projView[b2];
          const dy = y1 - projView[b2 + 1];
          const dz = z1 - projView[b2 + 2];
          const distSq = dx * dx + dy * dy + dz * dz * 0.25;
          if (distSq < 260) {
            const rgb = palette[Math.abs(Math.floor(let1)) % pLen];
            const alpha = (1 - distSq / 260) * 0.42;
            ctx.strokeStyle = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(projView[b2], projView[b2 + 1]);
            ctx.stroke();
          }
        }
      }
    }

    // Renderizar cada nodo 3D ordenado por profundidad
    for (let idx = 0; idx < nodeCount; idx++) {
      const i = indices[idx];
      const base = i * 6;
      const sx = projView[base];
      const sy = projView[base + 1];
      const sz = projView[base + 2];
      const scale = projView[base + 3];
      const shade = projView[base + 4];
      const letterId = Math.abs(Math.floor(projView[base + 5]));

      if (sx < -40 || sx > width + 40 || sy < -40 || sy > height + 40) continue;

      const baseRgb = palette[letterId % pLen];
      const r = Math.min(255, Math.floor(baseRgb[0] * shade));
      const g = Math.min(255, Math.floor(baseRgb[1] * shade));
      const b = Math.min(255, Math.floor(baseRgb[2] * shade));

      if (currentRender === 'cubes') {
        const size = Math.max(2.2, 4.2 * scale);
        const half = size * 0.5;
        const depthShift = Math.max(1.2, 2.4 * scale);

        // Cara lateral / extrusión sombreada
        ctx.fillStyle = `rgb(${Math.floor(r * 0.48)}, ${Math.floor(g * 0.48)}, ${Math.floor(b * 0.55)})`;
        ctx.fillRect(sx - half + depthShift, sy - half + depthShift, size, size);

        // Cara frontal iluminada
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillRect(sx - half, sy - half, size, size);

        // Brillo especular en la capa frontal
        if (shade > 1.05 && sz < 0) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
          ctx.fillRect(sx - half, sy - half, size, Math.max(1, size * 0.26));
        }
      } else if (currentRender === 'plexus') {
        const radius = Math.max(1.3, 2.5 * scale);
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Modo Holograma
        const wBar = Math.max(2.5, 5.2 * scale);
        const hBar = Math.max(1.2, 1.8 * scale);
        const alpha = Math.min(0.85, Math.max(0.18, shade * 0.55));
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.fillRect(sx - wBar * 0.5, sy - hBar * 0.5, wBar, hBar);
      }
    }

    ctx.restore();

    // Telemetría FPS y tiempo WASM
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
      targetsPtr = wasmInstance.exports.get_targets_ptr();
      projectedPtr = wasmInstance.exports.get_projected_ptr();

      buildLayoutTargets(currentLayout, true);
    } catch (err) {
      console.error('Error loading WebAssembly in pr_letras3d:', err);
    }
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  buildLayoutTargets(currentLayout, true);
  setupInteractivity();
  initWasm();
  requestAnimationFrame(render);
})();

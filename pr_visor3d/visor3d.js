/**
 * Subproyecto #10: Visor de Piezas 3D (WebGL2 + Rust WASM) — Javier Galilea
 * javiergalilea.es/pr_visor3d/
 */

(function () {
  'use strict';

  // --- ELEMENTOS DEL DOM ---
  const canvas = document.getElementById('viewerCanvas');
  const gizmoCanvas = document.getElementById('gizmoCanvas');
  const gctx = gizmoCanvas ? gizmoCanvas.getContext('2d') : null;

  const triStatEl = document.getElementById('triStat');
  const fpsEl = document.getElementById('fpsCounter');
  const wasmTimeEl = document.getElementById('wasmTime');

  const partSourceBadgeEl = document.getElementById('partSourceBadge');
  const partTitleEl = document.getElementById('partTitle');
  const specTrisEl = document.getElementById('specTris');
  const specVertsEl = document.getElementById('specVerts');
  const specDimsEl = document.getElementById('specDims');
  const specAreaEl = document.getElementById('specArea');
  const specVolEl = document.getElementById('specVol');
  const exploreBadgeEl = document.getElementById('exploreBadge');

  const presetCountLabelEl = document.getElementById('presetCountLabel');
  const customPresetBtn = document.getElementById('customPresetBtn');
  const autoStyleGroup = document.getElementById('autoStyleGroup');
  const autoTopBtn = document.getElementById('autoTopBtn');
  const autoTopLabel = document.getElementById('autoTopLabel');

  const fileInput = document.getElementById('fileInput');
  const openFileBtn = document.getElementById('openFileBtn');
  const dropOverlay = document.getElementById('dropOverlay');
  const toastBanner = document.getElementById('toastBanner');
  const canvasHint = document.getElementById('canvasHint');

  const clipSlider = document.getElementById('clipSlider');
  const clipLabel = document.getElementById('clipLabel');
  const speedSlider = document.getElementById('speedSlider');
  const speedLabel = document.getElementById('speedLabel');

  // --- ESTADO DE WASM ---
  let wasm = null;
  let wasmMemory = null;
  let posPtr = 0;
  let normPtr = 0;
  let statsPtr = 0;
  let camPtr = 0;
  let batchCapacity = 4096;

  // --- ESTADO DEL VISOR Y EXPLORACIÓN ---
  let currentPresetKey = 'gear';
  let customModelCache = null; // { name, format, positions, normals, hasFileNormals, zUp }

  let autoEnabled = true;
  let autoMode = 0; // 0 = Órbita 360°, 1 = Tour Cine, 2 = Vistas CAD
  let autoSpeed = 0.9;
  let shadeMode = 0; // 0 = solid, 1 = titanium, 2 = wireframe, 3 = xray
  let showGrid = true;
  let showAxes = true;
  let flipZtoY = false;
  let clipFraction = 1.0;

  // Cámara objetivo (manual / sincronizada con WASM)
  let targetYaw = 0.65;
  let targetPitch = 0.44;
  let targetDist = 3.2;
  let targetPanX = 0.0;
  let targetPanY = 0.0;
  let targetPanZ = 0.0;

  // Estado actual de cámara leído desde WASM o fallback JS
  const camState = new Float32Array([0.65, 0.44, 3.2, 0.0, 0.0, 0.0, 0.0, 0.0]);

  // Interacción de puntero
  let isDragging = false;
  let dragMode = 'orbit'; // 'orbit' | 'pan'
  let lastPointerX = 0;
  let lastPointerY = 0;
  let lastTouchDist = 0;
  let lastTouchMidX = 0;
  let lastTouchMidY = 0;
  let autoPauseUntil = 0;

  // Estadísticas actuales de la pieza
  let currentMeshInfo = {
    name: 'Piñón Helicoidal',
    sourceLabel: 'PIEZA POR DEFECTO',
    isExternal: false,
    triCount: 0,
    minYNorm: -0.5,
    maxYNorm: 0.5,
    rawDims: [2, 2, 2],
    rawArea: 0,
    rawVol: 0,
    rawPositions: null,
    normPositions: null,
    normNormals: null
  };

  // Telemetría FPS
  let lastTime = performance.now();
  let frameCount = 0;
  let fpsTimer = 0;
  let lastWasmMs = 0.04;
  let toastTimeout = null;

  // --- UTILIDADES UI ---
  function showToast(msg, isError = false) {
    if (!toastBanner) return;
    toastBanner.textContent = msg;
    toastBanner.classList.toggle('error', isError);
    toastBanner.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastBanner.classList.add('hidden');
    }, 3400);
  }

  function hideHintSoon() {
    if (canvasHint && !canvasHint.classList.contains('fade-out')) {
      setTimeout(() => canvasHint.classList.add('fade-out'), 2600);
    }
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString('es-ES');
  }

  function formatDim(v) {
    if (v >= 100) return v.toFixed(1);
    if (v >= 10) return v.toFixed(2);
    return v.toFixed(3);
  }

  // --- CONTEXTO WEBGL2 & SHADERS ---
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    showToast('Tu navegador no soporta WebGL2 para renderizado 3D.', true);
  }

  let meshProgram = null;
  let gridProgram = null;
  let meshVao = null;
  let posVbo = null;
  let normVbo = null;
  let baryVbo = null;
  let gridVao = null;
  let gridVbo = null;
  let gridVertexCount = 0;
  let meshUniforms = {};
  let gridUniforms = {};

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(vsSource, fsSource) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  function initWebGL() {
    if (!gl) return;

    const meshVS = `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aPosition;
      layout(location = 1) in vec3 aNormal;
      layout(location = 2) in vec3 aBary;

      uniform mat4 uViewProj;
      uniform mat4 uModel;

      out vec3 vWorldPos;
      out vec3 vNormal;
      out vec3 vBary;

      void main() {
        vec4 worldPos = uModel * vec4(aPosition, 1.0);
        vWorldPos = worldPos.xyz;
        vNormal = mat3(uModel) * aNormal;
        vBary = aBary;
        gl_Position = uViewProj * worldPos;
      }
    `;

    const meshFS = `#version 300 es
      precision highp float;

      in vec3 vWorldPos;
      in vec3 vNormal;
      in vec3 vBary;

      uniform vec3 uCamPos;
      uniform int uShadeMode;
      uniform float uClipY;
      uniform float uClipActive;

      out vec4 outColor;

      void main() {
        if (uClipActive > 0.5 && vWorldPos.y > uClipY) {
          discard;
        }

        vec3 N = normalize(gl_FrontFacing ? vNormal : -vNormal);
        vec3 V = normalize(uCamPos - vWorldPos);

        vec3 keyDir = normalize(vec3(0.62, 0.88, 0.68));
        vec3 fillDir = normalize(vec3(-0.78, 0.30, -0.45));
        vec3 rimDir = normalize(vec3(-0.25, 0.45, -0.85));

        float diffKey = max(dot(N, keyDir), 0.0);
        float diffFill = max(dot(N, fillDir), 0.0);
        float hemi = N.y * 0.5 + 0.5;

        vec3 H1 = normalize(keyDir + V);
        vec3 H2 = normalize(rimDir + V);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

        float distToCut = abs(uClipY - vWorldPos.y);
        float cutGlow = (uClipActive > 0.5) ? (1.0 - smoothstep(0.0, 0.025, distToCut)) : 0.0;

        vec3 finalRgb = vec3(0.0);
        float finalAlpha = 1.0;

        if (uShadeMode == 0) {
          // Sólido CAD (Aluminio anodizado / Estudio)
          vec3 baseCol = gl_FrontFacing ? vec3(0.72, 0.80, 0.88) : vec3(0.18, 0.34, 0.40);
          vec3 ambient = mix(vec3(0.06, 0.09, 0.15), vec3(0.20, 0.27, 0.36), hemi);
          float spec = pow(max(dot(N, H1), 0.0), 46.0);
          finalRgb = baseCol * (ambient + diffKey * 0.82 + diffFill * vec3(0.22, 0.42, 0.72) * 0.45);
          finalRgb += vec3(0.88, 0.96, 1.0) * spec * 0.48;
          finalRgb += vec3(0.0, 0.96, 0.83) * fresnel * 0.28;
        } else if (uShadeMode == 1) {
          // Titanio Metálico
          vec3 baseCol = gl_FrontFacing ? vec3(0.28, 0.34, 0.44) : vec3(0.12, 0.18, 0.24);
          vec3 skyRef = mix(vec3(0.04, 0.06, 0.10), vec3(0.45, 0.62, 0.82), pow(hemi, 1.4));
          float spec1 = pow(max(dot(N, H1), 0.0), 96.0);
          float spec2 = pow(max(dot(N, H2), 0.0), 40.0);
          finalRgb = baseCol * (skyRef * 0.95 + diffKey * 0.92 + diffFill * 0.38);
          finalRgb += vec3(0.95, 0.99, 1.0) * spec1 * 0.95;
          finalRgb += vec3(0.0, 0.96, 0.83) * spec2 * 0.42;
          finalRgb += vec3(0.23, 0.51, 0.96) * fresnel * 0.48;
        } else if (uShadeMode == 2) {
          // Malla Técnica (Barycentric Wireframe)
          vec3 d = fwidth(vBary);
          vec3 a3 = smoothstep(vec3(0.0), d * 1.4, vBary);
          float edge = 1.0 - min(min(a3.x, a3.y), a3.z);
          vec3 coreCol = vec3(0.03, 0.06, 0.11) + vec3(0.06, 0.12, 0.20) * (diffKey * 0.65 + hemi * 0.35);
          vec3 wireCol = mix(vec3(0.0, 0.96, 0.83), vec3(0.35, 0.72, 1.0), fresnel * 0.6);
          finalRgb = mix(coreCol, wireCol, edge * 0.92);
        } else {
          // Rayos X / Holograma
          float rim = pow(1.0 - abs(dot(N, V)), 1.85);
          vec3 holo = mix(vec3(0.0, 0.96, 0.83), vec3(0.62, 0.31, 0.87), clamp(vWorldPos.y * 0.5 + 0.5, 0.0, 1.0));
          finalRgb = holo * (0.28 + rim * 1.35 + diffKey * 0.25);
          finalAlpha = clamp(0.16 + rim * 0.72, 0.14, 0.92);
        }

        // Borde láser cian en el plano de corte
        finalRgb = mix(finalRgb, vec3(0.0, 0.96, 0.83) * 1.35, cutGlow * 0.85);
        outColor = vec4(finalRgb, finalAlpha);
      }
    `;

    const gridVS = `#version 300 es
      precision highp float;
      layout(location = 0) in vec3 aPos;
      layout(location = 1) in vec4 aCol;
      uniform mat4 uViewProj;
      uniform float uFloorY;
      out vec4 vCol;
      out vec2 vXZ;
      void main() {
        vec3 p = vec3(aPos.x, aPos.y + uFloorY, aPos.z);
        vCol = aCol;
        vXZ = p.xz;
        gl_Position = uViewProj * vec4(p, 1.0);
      }
    `;

    const gridFS = `#version 300 es
      precision highp float;
      in vec4 vCol;
      in vec2 vXZ;
      out vec4 outColor;
      void main() {
        float dist = length(vXZ);
        float fade = 1.0 - smoothstep(1.6, 3.2, dist);
        outColor = vec4(vCol.rgb, vCol.a * fade);
      }
    `;

    meshProgram = createProgram(meshVS, meshFS);
    gridProgram = createProgram(gridVS, gridFS);

    meshUniforms = {
      uViewProj: gl.getUniformLocation(meshProgram, 'uViewProj'),
      uModel: gl.getUniformLocation(meshProgram, 'uModel'),
      uCamPos: gl.getUniformLocation(meshProgram, 'uCamPos'),
      uShadeMode: gl.getUniformLocation(meshProgram, 'uShadeMode'),
      uClipY: gl.getUniformLocation(meshProgram, 'uClipY'),
      uClipActive: gl.getUniformLocation(meshProgram, 'uClipActive')
    };

    gridUniforms = {
      uViewProj: gl.getUniformLocation(gridProgram, 'uViewProj'),
      uFloorY: gl.getUniformLocation(gridProgram, 'uFloorY')
    };

    // VAO de la pieza
    meshVao = gl.createVertexArray();
    gl.bindVertexArray(meshVao);

    posVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    normVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    baryVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, baryVbo);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);

    // Construir rejilla de referencia CAD
    buildGridGeometry();
  }

  function buildGridGeometry() {
    const verts = [];
    const extent = 3.0;
    const step = 0.25;

    function pushLine(x1, y1, z1, x2, y2, z2, r, g, b, a) {
      verts.push(x1, y1, z1, r, g, b, a, x2, y2, z2, r, g, b, a);
    }

    const steps = Math.round(extent / step);
    for (let i = -steps; i <= steps; i++) {
      const p = i * step;
      if (i === 0) {
        // Ejes principales X y Z
        pushLine(-extent, 0, 0, extent, 0, 0, 0.96, 0.15, 0.52, 0.65);
        pushLine(0, 0, -extent, 0, 0, extent, 0.23, 0.51, 0.96, 0.65);
        continue;
      }
      const isMajor = i % 4 === 0;
      const r = isMajor ? 0.0 : 0.58;
      const g = isMajor ? 0.96 : 0.64;
      const b = isMajor ? 0.83 : 0.72;
      const a = isMajor ? 0.24 : 0.11;
      pushLine(p, 0, -extent, p, 0, extent, r, g, b, a);
      pushLine(-extent, 0, p, extent, 0, p, r, g, b, a);
    }

    // Anillos concéntricos de calibración
    const rings = [1.15, 1.85];
    const segs = 72;
    for (const rad of rings) {
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        pushLine(
          Math.cos(a0) * rad, 0.001, Math.sin(a0) * rad,
          Math.cos(a1) * rad, 0.001, Math.sin(a1) * rad,
          0.0, 0.96, 0.83, 0.22
        );
      }
    }

    const data = new Float32Array(verts);
    gridVertexCount = verts.length / 7;

    gridVao = gl.createVertexArray();
    gl.bindVertexArray(gridVao);
    gridVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    const stride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 3 * 4);
    gl.bindVertexArray(null);
  }

  // --- ÁLGEBRA MATRICIAL 4x4 (COLUMN-MAJOR) ---
  function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad * 0.5);
    const nf = 1.0 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0];
    let zy = eye[1] - center[1];
    let zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;

    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz);
    if (len < 1e-6) {
      xx = 1; xy = 0; xz = 0;
    } else {
      xx /= len; xy /= len; xz /= len;
    }

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    const out = new Float32Array(16);
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    out[15] = 1;
    return out;
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
      out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
      out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
      out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
      out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
    }
    return out;
  }

  function mat4RotationX(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const out = new Float32Array(16);
    out[0] = 1;
    out[5] = c;
    out[6] = s;
    out[9] = -s;
    out[10] = c;
    out[15] = 1;
    return out;
  }

  // --- GENERADOR DE PIEZAS MECÁNICAS POR DEFECTO ---
  class MeshBuilder {
    constructor() {
      this.pos = [];
      this.norm = [];
    }

    pushTri(ax, ay, az, bx, by, bz, cx, cy, cz, smoothNorms = null) {
      this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
      if (smoothNorms) {
        this.norm.push(...smoothNorms);
      } else {
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        this.norm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
      }
    }

    pushQuad(a, b, c, d, smooth = null) {
      if (smooth) {
        this.pushTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], [
          ...smooth[0], ...smooth[1], ...smooth[2]
        ]);
        this.pushTri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], [
          ...smooth[0], ...smooth[2], ...smooth[3]
        ]);
      } else {
        this.pushTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        this.pushTri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
      }
    }

    // Anillo sólido extruido entre dos perfiles radiales (con tapa inferior, superior y paredes)
    addTubeSegment(rIn, rOut, y0, y1, segs = 48, twist0 = 0, twist1 = 0, smoothWalls = true) {
      for (let i = 0; i < segs; i++) {
        const t0 = (i / segs) * Math.PI * 2;
        const t1 = ((i + 1) / segs) * Math.PI * 2;

        const a0b = t0 + twist0, a1b = t1 + twist0;
        const a0t = t0 + twist1, a1t = t1 + twist1;

        const c0b = Math.cos(a0b), s0b = Math.sin(a0b);
        const c1b = Math.cos(a1b), s1b = Math.sin(a1b);
        const c0t = Math.cos(a0t), s0t = Math.sin(a0t);
        const c1t = Math.cos(a1t), s1t = Math.sin(a1t);

        const o0b = [c0b * rOut, y0, s0b * rOut];
        const o1b = [c1b * rOut, y0, s1b * rOut];
        const o0t = [c0t * rOut, y1, s0t * rOut];
        const o1t = [c1t * rOut, y1, s1t * rOut];

        const i0b = [c0b * rIn, y0, s0b * rIn];
        const i1b = [c1b * rIn, y0, s1b * rIn];
        const i0t = [c0t * rIn, y1, s0t * rIn];
        const i1t = [c1t * rIn, y1, s1t * rIn];

        // Pared exterior
        if (smoothWalls) {
          this.pushQuad(o0b, o0t, o1t, o1b, [
            [c0b, 0, s0b], [c0t, 0, s0t], [c1t, 0, s1t], [c1b, 0, s1b]
          ]);
        } else {
          this.pushQuad(o0b, o0t, o1t, o1b);
        }

        // Pared interior (si rIn > 0)
        if (rIn > 0.0001) {
          if (smoothWalls) {
            this.pushQuad(i1b, i1t, i0t, i0b, [
              [-c1b, 0, -s1b], [-c1t, 0, -s1t], [-c0t, 0, -s0t], [-c0b, 0, -s0b]
            ]);
          } else {
            this.pushQuad(i1b, i1t, i0t, i0b);
          }
          // Tapa superior e inferior (winding exterior CCW)
          this.pushQuad(i0t, i1t, o1t, o0t);
          this.pushQuad(o0b, o1b, i1b, i0b);
        } else {
          this.pushTri(0, y1, 0, o1t[0], o1t[1], o1t[2], o0t[0], o0t[1], o0t[2]);
          this.pushTri(0, y0, 0, o0b[0], o0b[1], o0b[2], o1b[0], o1b[1], o1b[2]);
        }
      }
    }

    addBox(x0, y0, z0, x1, y1, z1) {
      const p000 = [x0, y0, z0], p100 = [x1, y0, z0];
      const p110 = [x1, y1, z0], p010 = [x0, y1, z0];
      const p001 = [x0, y0, z1], p101 = [x1, y0, z1];
      const p111 = [x1, y1, z1], p011 = [x0, y1, z1];

      this.pushQuad(p001, p101, p111, p011); // +Z
      this.pushQuad(p100, p000, p010, p110); // -Z
      this.pushQuad(p101, p100, p110, p111); // +X
      this.pushQuad(p000, p001, p011, p010); // -X
      this.pushQuad(p011, p111, p110, p010); // +Y
      this.pushQuad(p000, p100, p101, p001); // -Y
    }

    toResult(name) {
      return {
        name,
        positions: new Float32Array(this.pos),
        normals: new Float32Array(this.norm),
        hasNormals: true
      };
    }
  }

  function buildGearPart() {
    const mb = new MeshBuilder();
    const teeth = 18;
    const segsPerTooth = 4;
    const totalSegs = teeth * segsPerTooth;
    const rInnerRim = 0.68;
    const rRoot = 0.83;
    const rTip = 1.00;
    const twist = 0.14;
    const yBot = -0.22;
    const yTop = 0.22;

    // 1. Corona dentada helicoidal exterior
    const profile = [];
    for (let t = 0; t < teeth; t++) {
      const base = (t / teeth) * Math.PI * 2;
      const step = (Math.PI * 2) / teeth;
      profile.push({ ang: base + step * 0.00, r: rRoot });
      profile.push({ ang: base + step * 0.16, r: rRoot });
      profile.push({ ang: base + step * 0.27, r: rTip });
      profile.push({ ang: base + step * 0.50, r: rTip });
      profile.push({ ang: base + step * 0.61, r: rRoot });
    }

    for (let i = 0; i < profile.length; i++) {
      const p0 = profile[i];
      const p1 = profile[(i + 1) % profile.length];

      const b0 = [Math.cos(p0.ang) * p0.r, yBot, Math.sin(p0.ang) * p0.r];
      const b1 = [Math.cos(p1.ang) * p1.r, yBot, Math.sin(p1.ang) * p1.r];
      const t0 = [Math.cos(p0.ang + twist) * p0.r, yTop, Math.sin(p0.ang + twist) * p0.r];
      const t1 = [Math.cos(p1.ang + twist) * p1.r, yTop, Math.sin(p1.ang + twist) * p1.r];

      const ib0 = [Math.cos(p0.ang) * rInnerRim, yBot, Math.sin(p0.ang) * rInnerRim];
      const ib1 = [Math.cos(p1.ang) * rInnerRim, yBot, Math.sin(p1.ang) * rInnerRim];
      const it0 = [Math.cos(p0.ang + twist) * rInnerRim, yTop, Math.sin(p0.ang + twist) * rInnerRim];
      const it1 = [Math.cos(p1.ang + twist) * rInnerRim, yTop, Math.sin(p1.ang + twist) * rInnerRim];

      mb.pushQuad(b0, t0, t1, b1);
      mb.pushQuad(ib1, it1, it0, ib0);
      mb.pushQuad(it0, it1, t1, t0);
      mb.pushQuad(b0, b1, ib1, ib0);
    }

    // 2. Anillo interior rebajado y 6 radios estructurales
    mb.addTubeSegment(0.60, 0.70, -0.14, 0.14, totalSegs, 0, 0, true);
    const spokes = 6;
    for (let s = 0; s < spokes; s++) {
      const ang = (s / spokes) * Math.PI * 2;
      const hw = 0.065;
      const r0 = 0.34, r1 = 0.64;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const px = -sa * hw, pz = ca * hw;
      const yb = -0.09, yt = 0.09;

      const a0 = [ca * r0 - px, yb, sa * r0 - pz];
      const a1 = [ca * r0 + px, yb, sa * r0 + pz];
      const a2 = [ca * r0 + px, yt, sa * r0 + pz];
      const a3 = [ca * r0 - px, yt, sa * r0 - pz];

      const b0 = [ca * r1 - px, yb, sa * r1 - pz];
      const b1 = [ca * r1 + px, yb, sa * r1 + pz];
      const b2 = [ca * r1 + px, yt, sa * r1 + pz];
      const b3 = [ca * r1 - px, yt, sa * r1 - pz];

      mb.pushQuad(a3, a2, b2, b3);
      mb.pushQuad(b0, b1, a1, a0);
      mb.pushQuad(a1, b1, b2, a2);
      mb.pushQuad(b0, a0, a3, b3);
    }

    // 3. Cubo central escalonado con taladro y chaflán
    mb.addTubeSegment(0.18, 0.38, -0.30, 0.30, 48, 0, 0, true);
    mb.addTubeSegment(0.20, 0.32, 0.30, 0.38, 48, 0, 0, true);
    mb.addTubeSegment(0.20, 0.32, -0.38, -0.30, 48, 0, 0, true);

    // 4. Chavetero superior/inferior en el cubo (ranura de arrastre)
    mb.addBox(-0.045, -0.38, 0.14, 0.045, 0.38, 0.24);

    return mb.toResult('Piñón Helicoidal');
  }

  function buildTurbinePart() {
    const mb = new MeshBuilder();
    const radialSegs = 44;

    // 1. Cono ojiva parabólico + tambor central
    const profilePts = [];
    const coneSteps = 14;
    for (let i = 0; i <= coneSteps; i++) {
      const u = i / coneSteps; // 0 = base, 1 = punta
      const y = -0.26 + u * 0.78;
      const r = Math.max(0.008, 0.34 * Math.pow(1.0 - u, 0.58));
      profilePts.push([r, y]);
    }

    for (let i = 0; i < profilePts.length - 1; i++) {
      const [r0, y0] = profilePts[i];
      const [r1, y1] = profilePts[i + 1];
      const dy = y1 - y0, dr = r1 - r0;
      const nLen = Math.hypot(dy, -dr) || 1;
      const nr = dy / nLen, ny = -dr / nLen;

      for (let s = 0; s < radialSegs; s++) {
        const a0 = (s / radialSegs) * Math.PI * 2;
        const a1 = ((s + 1) / radialSegs) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);

        const p00 = [c0 * r0, y0, s0 * r0];
        const p01 = [c0 * r1, y1, s0 * r1];
        const p11 = [c1 * r1, y1, s1 * r1];
        const p10 = [c1 * r0, y0, s1 * r0];

        mb.pushQuad(p00, p01, p11, p10, [
          [c0 * nr, ny, s0 * nr],
          [c0 * nr, ny, s0 * nr],
          [c1 * nr, ny, s1 * nr],
          [c1 * nr, ny, s1 * nr]
        ]);
      }
    }

    // Base trasera del rotor con taladro
    mb.addTubeSegment(0.12, 0.34, -0.34, -0.26, radialSegs, 0, 0, true);
    mb.addTubeSegment(0.12, 0.24, -0.44, -0.34, radialSegs, 0, 0, true);

    // 2. 11 Álabe aerodinámicos torsionados
    const blades = 11;
    const spanSegs = 9;
    const rStart = 0.30;
    const rEnd = 0.98;

    for (let b = 0; b < blades; b++) {
      const baseAng = (b / blades) * Math.PI * 2;
      const ca = Math.cos(baseAng), sa = Math.sin(baseAng);
      const tx = -sa, tz = ca;

      const rings = [];
      for (let s = 0; s <= spanSegs; s++) {
        const frac = s / spanSegs;
        const r = rStart + (rEnd - rStart) * frac;
        const pitch = 0.85 - frac * 0.45; // torsión de raíz a punta
        const chord = 0.24 * (1.0 - frac * 0.28);
        const thick = 0.032 * (1.0 - frac * 0.55);
        const yCenter = -0.10 + frac * 0.06;

        const cp = Math.cos(pitch), sp = Math.sin(pitch);

        // Sección aerodinámica cerrada de 5 puntos
        const localPts = [
          [-chord * 0.5, 0],
          [-chord * 0.12, thick],
          [chord * 0.5, thick * 0.25],
          [chord * 0.5, -thick * 0.25],
          [-chord * 0.12, -thick]
        ];

        const ring = localPts.map(([u, v]) => {
          const alongTang = u * cp - v * sp;
          const alongY = u * sp + v * cp + yCenter;
          return [
            ca * r + tx * alongTang,
            alongY,
            sa * r + tz * alongTang
          ];
        });
        rings.push(ring);
      }

      for (let s = 0; s < spanSegs; s++) {
        const r0 = rings[s];
        const r1 = rings[s + 1];
        const plen = r0.length;
        for (let k = 0; k < plen; k++) {
          const kn = (k + 1) % plen;
          mb.pushQuad(r0[k], r0[kn], r1[kn], r1[k]);
        }
      }

      // Tapa en la punta del álabe
      const tip = rings[rings.length - 1];
      for (let k = 1; k < tip.length - 1; k++) {
        mb.pushTri(
          tip[0][0], tip[0][1], tip[0][2],
          tip[k][0], tip[k][1], tip[k][2],
          tip[k + 1][0], tip[k + 1][1], tip[k + 1][2]
        );
      }
    }

    return mb.toResult('Rotor de Turbina Axial');
  }

  function buildFlangePart() {
    const mb = new MeshBuilder();
    const bolts = 6;
    const rBore = 0.24;
    const rNeck = 0.52;
    const rOuter = 0.94;
    const boltRadius = 0.73;
    const holeR = 0.092;
    const yBot = -0.34;
    const yTop = -0.10;

    // 1. Anillo interior sólido y cuello cilíndrico central escalonado con bisel
    mb.addTubeSegment(rBore, rNeck, yBot, yTop, 60, 0, 0, true);
    mb.addTubeSegment(rBore, 0.46, yTop, 0.40, 48, 0, 0, true);
    mb.addTubeSegment(rBore, 0.40, 0.40, 0.48, 48, 0, 0, true);

    // 2. Anillo exterior con 6 taladros pasantes reales en cada sector de 60°
    const halfSec = Math.PI / bolts;
    const arcSteps = 10;
    const radSteps = 4;

    // Contorno en coordenadas locales del sector (+X hacia el centro del taladro)
    const localPerimeter = [];
    // Arco exterior (-halfSec -> +halfSec)
    for (let i = 0; i < arcSteps; i++) {
      const th = -halfSec + (i / arcSteps) * (halfSec * 2);
      localPerimeter.push({ x: Math.cos(th) * rOuter, z: Math.sin(th) * rOuter, isOuter: true });
    }
    // Lado radial (+halfSec: rOuter -> rNeck)
    for (let i = 0; i < radSteps; i++) {
      const r = rOuter - (i / radSteps) * (rOuter - rNeck);
      localPerimeter.push({ x: Math.cos(halfSec) * r, z: Math.sin(halfSec) * r, isOuter: i === 0 });
    }
    // Arco interior (+halfSec -> -halfSec)
    for (let i = 0; i < arcSteps; i++) {
      const th = halfSec - (i / arcSteps) * (halfSec * 2);
      localPerimeter.push({ x: Math.cos(th) * rNeck, z: Math.sin(th) * rNeck, isOuter: false });
    }
    // Lado radial (-halfSec: rNeck -> rOuter)
    for (let i = 0; i < radSteps; i++) {
      const r = rNeck + (i / radSteps) * (rOuter - rNeck);
      localPerimeter.push({ x: Math.cos(-halfSec) * r, z: Math.sin(-halfSec) * r, isOuter: false });
    }

    // Ordenar contorno alrededor del centro del taladro (boltRadius, 0)
    const sortedLoop = localPerimeter.map(pt => ({
      ...pt,
      ang: Math.atan2(pt.z, pt.x - boltRadius)
    })).sort((a, b) => a.ang - b.ang);

    for (let b = 0; b < bolts; b++) {
      const secAng = (b / bolts) * Math.PI * 2;
      const cs = Math.cos(secAng), ss = Math.sin(secAng);
      const rotPt = (lx, y, lz) => [lx * cs - lz * ss, y, lx * ss + lz * cs];

      for (let i = 0; i < sortedLoop.length; i++) {
        const p0 = sortedLoop[i];
        const p1 = sortedLoop[(i + 1) % sortedLoop.length];

        const hx0 = boltRadius + Math.cos(p0.ang) * holeR;
        const hz0 = Math.sin(p0.ang) * holeR;
        const hx1 = boltRadius + Math.cos(p1.ang) * holeR;
        const hz1 = Math.sin(p1.ang) * holeR;

        // Tapa superior (+Y) e inferior (-Y) conectando agujero con perímetro del sector
        mb.pushQuad(
          rotPt(hx0, yTop, hz0),
          rotPt(hx1, yTop, hz1),
          rotPt(p1.x, yTop, p1.z),
          rotPt(p0.x, yTop, p0.z)
        );
        mb.pushQuad(
          rotPt(p0.x, yBot, p0.z),
          rotPt(p1.x, yBot, p1.z),
          rotPt(hx1, yBot, hz1),
          rotPt(hx0, yBot, hz0)
        );

        // Pared interior del taladro pasante
        mb.pushQuad(
          rotPt(hx0, yBot, hz0),
          rotPt(hx1, yBot, hz1),
          rotPt(hx1, yTop, hz1),
          rotPt(hx0, yTop, hz0)
        );

        // Pared exterior cilíndrica de la brida
        if (p0.isOuter && p1.isOuter) {
          mb.pushQuad(
            rotPt(p0.x, yBot, p0.z),
            rotPt(p0.x, yTop, p0.z),
            rotPt(p1.x, yTop, p1.z),
            rotPt(p1.x, yBot, p1.z)
          );
        }
      }

      // 3. 6 Nervios triangulares de refuerzo intercalados entre pernos
      const ribAng = secAng + Math.PI / bolts;
      const ca = Math.cos(ribAng), sa = Math.sin(ribAng);
      const px = -sa * 0.045, pz = ca * 0.045;
      const rNear = 0.44, rFar = 0.85;
      const yb = yTop, yt = 0.34;

      const n0L = [ca * rNear - px, yb, sa * rNear - pz];
      const n0R = [ca * rNear + px, yb, sa * rNear + pz];
      const nTL = [ca * rNear - px, yt, sa * rNear - pz];
      const nTR = [ca * rNear + px, yt, sa * rNear + pz];
      const f0L = [ca * rFar - px, yb, sa * rFar - pz];
      const f0R = [ca * rFar + px, yb, sa * rFar + pz];

      mb.pushQuad(nTL, nTR, f0R, f0L); // rampa inclinada del nervio
      mb.pushTri(n0R[0], n0R[1], n0R[2], f0R[0], f0R[1], f0R[2], nTR[0], nTR[1], nTR[2]);
      mb.pushTri(n0L[0], n0L[1], n0L[2], nTL[0], nTL[1], nTL[2], f0L[0], f0L[1], f0L[2]);
      mb.pushQuad(n0L, n0R, nTR, nTL);
    }

    return mb.toResult('Brida Mecánica CNC');
  }

  function buildHeatsinkPart() {
    const mb = new MeshBuilder();

    // 1. Bloque base frío (coldplate) + collar inferior circular
    mb.addBox(-0.92, -0.34, -0.92, 0.92, -0.14, 0.92);
    mb.addTubeSegment(0.0, 0.48, -0.46, -0.34, 40, 0, 0, true);

    // 2. 4 Torres de anclaje en las esquinas
    const corners = [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]];
    for (const [cx, cz] of corners) {
      const segs = 20;
      const rIn = 0.045, rOut = 0.11, y0 = -0.14, y1 = 0.02;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2;
        const a1 = ((s + 1) / segs) * Math.PI * 2;
        const c0 = Math.cos(a0), s0 = Math.sin(a0);
        const c1 = Math.cos(a1), s1 = Math.sin(a1);
        const o0b = [cx + c0 * rOut, y0, cz + s0 * rOut];
        const o1b = [cx + c1 * rOut, y0, cz + s1 * rOut];
        const o0t = [cx + c0 * rOut, y1, cz + s0 * rOut];
        const o1t = [cx + c1 * rOut, y1, cz + s1 * rOut];
        const i0t = [cx + c0 * rIn, y1, cz + s0 * rIn];
        const i1t = [cx + c1 * rIn, y1, cz + s1 * rIn];
        const i0b = [cx + c0 * rIn, y0, cz + s0 * rIn];
        const i1b = [cx + c1 * rIn, y0, cz + s1 * rIn];
        mb.pushQuad(o0b, o0t, o1t, o1b);
        mb.pushQuad(i1b, i1t, i0t, i0b);
        mb.pushQuad(i0t, i1t, o1t, o0t);
        mb.pushQuad(o0b, o1b, i1b, i0b);
      }
    }

    // 3. Matriz de 9 x 3 torres de aletas fresadas (perfil curvo escalonado)
    const nx = 9;
    const nz = 3;
    for (let ix = 0; ix < nx; ix++) {
      const fx = -0.68 + (ix / (nx - 1)) * 1.36;
      const distNorm = Math.abs(fx) / 0.7;
      const finHeight = 0.56 - distNorm * 0.16; // perfil parabólico en el centro
      for (let iz = 0; iz < nz; iz++) {
        const fz0 = -0.78 + iz * 0.55;
        const fz1 = fz0 + 0.46;
        mb.addBox(fx - 0.036, -0.14, fz0, fx + 0.036, finHeight, fz1);
      }
    }

    // 4. Puente central de sujeción (clip térmico)
    mb.addBox(-0.88, -0.14, -0.08, 0.88, 0.05, 0.08);

    return mb.toResult('Disipador Térmico CNC');
  }

  function buildTorusKnotPart() {
    const mb = new MeshBuilder();
    const steps = 220;
    const tubeSegs = 20;
    const p = 3;
    const q = 5;
    const R = 0.68;
    const rMod = 0.24;
    const tubeR = 0.125;

    function knotPoint(t) {
      const ct = Math.cos(p * t), st = Math.sin(p * t);
      const cq = Math.cos(q * t), sq = Math.sin(q * t);
      const rad = R + rMod * cq;
      return [rad * ct, rMod * sq * 1.3, rad * st];
    }

    const centers = [];
    const tangents = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * Math.PI * 2;
      const dt = 0.002;
      const p0 = knotPoint(t - dt);
      const p1 = knotPoint(t + dt);
      const c = knotPoint(t);
      const tx = p1[0] - p0[0], ty = p1[1] - p0[1], tz = p1[2] - p0[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      centers.push(c);
      tangents.push([tx / tl, ty / tl, tz / tl]);
    }

    // Marco paralelo de Bishop para evitar torsión en el cierre
    const rings = [];
    const ringNorms = [];
    let nx = 0, ny = 1, nz = 0;
    {
      const t = tangents[0];
      const dot = nx * t[0] + ny * t[1] + nz * t[2];
      nx -= dot * t[0]; ny -= dot * t[1]; nz -= dot * t[2];
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
    }

    const frames = [];
    for (let i = 0; i < steps; i++) {
      const t = tangents[i];
      if (i > 0) {
        const dot = nx * t[0] + ny * t[1] + nz * t[2];
        nx -= dot * t[0]; ny -= dot * t[1]; nz -= dot * t[2];
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
      const bx = t[1] * nz - t[2] * ny;
      const by = t[2] * nx - t[0] * nz;
      const bz = t[0] * ny - t[1] * nx;
      frames.push({ N: [nx, ny, nz], B: [bx, by, bz] });
    }

    // Corregir ángulo residual al cerrar el bucle 2π
    const f0 = frames[0].N;
    const fLast = frames[steps - 1].N;
    const t0 = tangents[0];
    const cosErr = Math.max(-1, Math.min(1, f0[0] * fLast[0] + f0[1] * fLast[1] + f0[2] * fLast[2]));
    const cross = [
      fLast[1] * f0[2] - fLast[2] * f0[1],
      fLast[2] * f0[0] - fLast[0] * f0[2],
      fLast[0] * f0[1] - fLast[1] * f0[0]
    ];
    const sign = (cross[0] * t0[0] + cross[1] * t0[1] + cross[2] * t0[2]) >= 0 ? 1 : -1;
    const totalTwist = sign * Math.acos(cosErr);

    for (let i = 0; i < steps; i++) {
      const c = centers[i];
      const { N, B } = frames[i];
      const twistFix = (i / steps) * totalTwist;
      const ring = [];
      const norms = [];
      for (let s = 0; s < tubeSegs; s++) {
        const a = (s / tubeSegs) * Math.PI * 2 + twistFix;
        const ca = Math.cos(a), sa = Math.sin(a);
        const vx = N[0] * ca + B[0] * sa;
        const vy = N[1] * ca + B[1] * sa;
        const vz = N[2] * ca + B[2] * sa;
        ring.push([c[0] + vx * tubeR, c[1] + vy * tubeR, c[2] + vz * tubeR]);
        norms.push([vx, vy, vz]);
      }
      rings.push(ring);
      ringNorms.push(norms);
    }

    for (let i = 0; i < steps; i++) {
      const next = (i + 1) % steps;
      const r0 = rings[i], r1 = rings[next];
      const n0 = ringNorms[i], n1 = ringNorms[next];
      for (let s = 0; s < tubeSegs; s++) {
        const sn = (s + 1) % tubeSegs;
        mb.pushQuad(r0[s], r0[sn], r1[sn], r1[s], [n0[s], n0[sn], n1[sn], n1[s]]);
      }
    }

    return mb.toResult('Nudo Toroidal (3,5)');
  }

  // --- PARSEADORES DE FICHEROS 3D EXTERNOS ---
  function parseSTL(buffer) {
    const view = new DataView(buffer);
    const byteLen = buffer.byteLength;
    let isBinary = false;

    if (byteLen >= 84) {
      const triCount = view.getUint32(80, true);
      if (84 + triCount * 50 === byteLen || Math.abs(84 + triCount * 50 - byteLen) <= 4) {
        isBinary = true;
      }
    }

    if (!isBinary) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer, 0, Math.min(byteLen, 512)));
      if (!/solid/i.test(text) || !/facet/i.test(text)) {
        if (byteLen >= 84) {
          const triCount = view.getUint32(80, true);
          if (triCount > 0 && 84 + triCount * 50 <= byteLen) {
            isBinary = true;
          }
        }
      }
    }

    if (isBinary) {
      const triCount = view.getUint32(80, true);
      if (triCount === 0 || 84 + triCount * 50 > byteLen) {
        throw new Error('Archivo STL binario inválido o vacío.');
      }
      const positions = new Float32Array(triCount * 9);
      const normals = new Float32Array(triCount * 9);
      let hasFileNormals = true;
      let zeroNormals = 0;

      let offset = 84;
      for (let t = 0; t < triCount; t++) {
        const nx = view.getFloat32(offset, true);
        const ny = view.getFloat32(offset + 4, true);
        const nz = view.getFloat32(offset + 8, true);
        if (nx * nx + ny * ny + nz * nz < 1e-8) zeroNormals++;

        const b = t * 9;
        for (let v = 0; v < 3; v++) {
          const vo = offset + 12 + v * 12;
          positions[b + v * 3] = view.getFloat32(vo, true);
          positions[b + v * 3 + 1] = view.getFloat32(vo + 4, true);
          positions[b + v * 3 + 2] = view.getFloat32(vo + 8, true);
          normals[b + v * 3] = nx;
          normals[b + v * 3 + 1] = ny;
          normals[b + v * 3 + 2] = nz;
        }
        offset += 50;
      }

      if (zeroNormals > triCount * 0.2) hasFileNormals = false;
      return { positions, normals: hasFileNormals ? normals : null, hasNormals: hasFileNormals, defaultZUp: true };
    }

    // ASCII STL
    const fullText = new TextDecoder().decode(buffer);
    const pos = [];
    const lines = fullText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('vertex ') || line.startsWith('vertex\t')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          pos.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
        }
      }
    }
    const usableFloats = Math.floor(pos.length / 9) * 9;
    if (usableFloats === 0) throw new Error('No se encontraron vértices válidos en el STL ASCII.');
    return {
      positions: new Float32Array(pos.slice(0, usableFloats)),
      normals: null,
      hasNormals: false,
      defaultZUp: true
    };
  }

  function parseOBJ(buffer) {
    const text = new TextDecoder().decode(buffer);
    const verts = [];
    const vnorms = [];
    const outPos = [];
    const outNorm = [];
    let hasAllNormals = true;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line[0] === '#') continue;
      const parts = line.split(/\s+/);
      const cmd = parts[0];

      if (cmd === 'v' && parts.length >= 4) {
        verts.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (cmd === 'vn' && parts.length >= 4) {
        vnorms.push(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3]));
      } else if (cmd === 'f' && parts.length >= 4) {
        const vCount = verts.length / 3;
        const nCount = vnorms.length / 3;
        const faceVerts = [];

        for (let k = 1; k < parts.length; k++) {
          const tok = parts[k].split('/');
          let vi = parseInt(tok[0], 10);
          if (isNaN(vi)) continue;
          if (vi < 0) vi = vCount + vi;
          else vi = vi - 1;

          let ni = -1;
          if (tok.length >= 3 && tok[2] !== '') {
            ni = parseInt(tok[2], 10);
            if (!isNaN(ni)) {
              if (ni < 0) ni = nCount + ni;
              else ni = ni - 1;
            } else {
              ni = -1;
            }
          }
          faceVerts.push({ vi, ni });
        }

        for (let k = 1; k + 1 < faceVerts.length; k++) {
          const tri = [faceVerts[0], faceVerts[k], faceVerts[k + 1]];
          if (tri.some(tv => tv.vi < 0 || tv.vi >= vCount)) continue;
          for (const tv of tri) {
            const vb = tv.vi * 3;
            outPos.push(verts[vb], verts[vb + 1], verts[vb + 2]);
            if (tv.ni >= 0 && tv.ni * 3 + 2 < vnorms.length) {
              const nb = tv.ni * 3;
              outNorm.push(vnorms[nb], vnorms[nb + 1], vnorms[nb + 2]);
            } else {
              hasAllNormals = false;
            }
          }
        }
      }
    }

    if (outPos.length < 9) throw new Error('Archivo OBJ sin geometría de caras.');
    return {
      positions: new Float32Array(outPos),
      normals: hasAllNormals && outNorm.length === outPos.length ? new Float32Array(outNorm) : null,
      hasNormals: hasAllNormals && outNorm.length === outPos.length,
      defaultZUp: false
    };
  }

  function parsePLY(buffer) {
    const bytes = new Uint8Array(buffer);
    // Encontrar fin de cabecera ("end_header\n")
    const decoder = new TextDecoder();
    const probe = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 8192)));
    const endIdx = probe.indexOf('end_header');
    if (endIdx < 0) throw new Error('Cabecera PLY no reconocida.');

    const nlPos = probe.indexOf('\n', endIdx);
    if (nlPos < 0) throw new Error('Cabecera PLY incompleta.');
    const headerText = probe.slice(0, nlPos);
    const headerEnd = new TextEncoder().encode(headerText + '\n').length;

    const lines = headerText.split(/\r?\n/);
    let format = 'ascii';
    let vertexCount = 0;
    let faceCount = 0;
    let currentEl = '';
    const vProps = [];
    let faceCountType = 'uchar';
    let faceIdxType = 'int';

    for (const raw of lines) {
      const p = raw.trim().split(/\s+/);
      if (p[0] === 'format') format = p[1];
      else if (p[0] === 'element') {
        currentEl = p[1];
        if (currentEl === 'vertex') vertexCount = parseInt(p[2], 10);
        else if (currentEl === 'face') faceCount = parseInt(p[2], 10);
      } else if (p[0] === 'property') {
        if (currentEl === 'vertex') {
          vProps.push({ type: p[1], name: p[2] });
        } else if (currentEl === 'face' && p[1] === 'list') {
          faceCountType = p[2];
          faceIdxType = p[3];
        }
      }
    }

    const verts = new Float32Array(vertexCount * 3);
    const ix = vProps.findIndex(p => p.name === 'x');
    const iy = vProps.findIndex(p => p.name === 'y');
    const iz = vProps.findIndex(p => p.name === 'z');
    const inx = vProps.findIndex(p => p.name === 'nx');
    const iny = vProps.findIndex(p => p.name === 'ny');
    const inz = vProps.findIndex(p => p.name === 'nz');
    const hasFileNormals = inx >= 0 && iny >= 0 && inz >= 0;
    const vnorms = hasFileNormals ? new Float32Array(vertexCount * 3) : null;

    const outPos = [];
    const outNorm = [];

    if (format === 'ascii') {
      const body = decoder.decode(bytes.subarray(headerEnd));
      const bodyLines = body.split(/\r?\n/);
      let li = 0;

      let vRead = 0;
      while (vRead < vertexCount && li < bodyLines.length) {
        const line = bodyLines[li++].trim();
        if (!line) continue;
        const p = line.split(/\s+/);
        verts[vRead * 3] = parseFloat(p[ix >= 0 ? ix : 0]);
        verts[vRead * 3 + 1] = parseFloat(p[iy >= 0 ? iy : 1]);
        verts[vRead * 3 + 2] = parseFloat(p[iz >= 0 ? iz : 2]);
        if (vnorms) {
          vnorms[vRead * 3] = parseFloat(p[inx]);
          vnorms[vRead * 3 + 1] = parseFloat(p[iny]);
          vnorms[vRead * 3 + 2] = parseFloat(p[inz]);
        }
        vRead++;
      }

      let fRead = 0;
      while (fRead < faceCount && li < bodyLines.length) {
        const line = bodyLines[li++].trim();
        if (!line) continue;
        const p = line.split(/\s+/);
        const cnt = parseInt(p[0], 10);
        for (let k = 1; k + 1 < cnt; k++) {
          const i0 = parseInt(p[1], 10);
          const i1 = parseInt(p[1 + k], 10);
          const i2 = parseInt(p[2 + k], 10);
          if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
          outPos.push(
            verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2],
            verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2],
            verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2]
          );
          if (vnorms) {
            outNorm.push(
              vnorms[i0 * 3], vnorms[i0 * 3 + 1], vnorms[i0 * 3 + 2],
              vnorms[i1 * 3], vnorms[i1 * 3 + 1], vnorms[i1 * 3 + 2],
              vnorms[i2 * 3], vnorms[i2 * 3 + 1], vnorms[i2 * 3 + 2]
            );
          }
        }
        fRead++;
      }
    } else {
      const le = format === 'binary_little_endian';
      const dv = new DataView(buffer);
      let off = headerEnd;

      const readVal = (t) => {
        let v = 0;
        switch (t) {
          case 'char': case 'int8': v = dv.getInt8(off); off += 1; break;
          case 'uchar': case 'uint8': v = dv.getUint8(off); off += 1; break;
          case 'short': case 'int16': v = dv.getInt16(off, le); off += 2; break;
          case 'ushort': case 'uint16': v = dv.getUint16(off, le); off += 2; break;
          case 'int': case 'int32': v = dv.getInt32(off, le); off += 4; break;
          case 'uint': case 'uint32': v = dv.getUint32(off, le); off += 4; break;
          case 'double': case 'float64': v = dv.getFloat64(off, le); off += 8; break;
          default: v = dv.getFloat32(off, le); off += 4; break;
        }
        return v;
      };

      for (let i = 0; i < vertexCount; i++) {
        for (const pr of vProps) {
          const val = readVal(pr.type);
          if (pr.name === 'x') verts[i * 3] = val;
          else if (pr.name === 'y') verts[i * 3 + 1] = val;
          else if (pr.name === 'z') verts[i * 3 + 2] = val;
          else if (vnorms && pr.name === 'nx') vnorms[i * 3] = val;
          else if (vnorms && pr.name === 'ny') vnorms[i * 3 + 1] = val;
          else if (vnorms && pr.name === 'nz') vnorms[i * 3 + 2] = val;
        }
      }

      for (let f = 0; f < faceCount; f++) {
        const cnt = readVal(faceCountType);
        const idxs = [];
        for (let k = 0; k < cnt; k++) idxs.push(readVal(faceIdxType));
        for (let k = 1; k + 1 < cnt; k++) {
          const i0 = idxs[0], i1 = idxs[k], i2 = idxs[k + 1];
          if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= vertexCount || i1 >= vertexCount || i2 >= vertexCount) continue;
          outPos.push(
            verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2],
            verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2],
            verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2]
          );
          if (vnorms) {
            outNorm.push(
              vnorms[i0 * 3], vnorms[i0 * 3 + 1], vnorms[i0 * 3 + 2],
              vnorms[i1 * 3], vnorms[i1 * 3 + 1], vnorms[i1 * 3 + 2],
              vnorms[i2 * 3], vnorms[i2 * 3 + 1], vnorms[i2 * 3 + 2]
            );
          }
        }
      }
    }

    if (outPos.length < 9) throw new Error('Archivo PLY sin triángulos válidos.');
    return {
      positions: new Float32Array(outPos),
      normals: vnorms && outNorm.length === outPos.length ? new Float32Array(outNorm) : null,
      hasNormals: Boolean(vnorms && outNorm.length === outPos.length),
      defaultZUp: true
    };
  }

  function gltfNodeMatrix(node) {
    if (node.matrix && node.matrix.length === 16) {
      return new Float32Array(node.matrix);
    }
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const qx = r[0], qy = r[1], qz = r[2], qw = r[3];
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    const m = new Float32Array(16);
    m[0] = (1 - (yy + zz)) * s[0];
    m[1] = (xy + wz) * s[0];
    m[2] = (xz - wy) * s[0];
    m[4] = (xy - wz) * s[1];
    m[5] = (1 - (xx + zz)) * s[1];
    m[6] = (yz + wx) * s[1];
    m[8] = (xz + wy) * s[2];
    m[9] = (yz - wx) * s[2];
    m[10] = (1 - (xx + yy)) * s[2];
    m[12] = t[0];
    m[13] = t[1];
    m[14] = t[2];
    m[15] = 1;
    return m;
  }

  function normalMatrix3FromMat4(m) {
    const a00 = m[0], a01 = m[1], a02 = m[2];
    const a10 = m[4], a11 = m[5], a12 = m[6];
    const a20 = m[8], a21 = m[9], a22 = m[10];
    const c00 = a11 * a22 - a12 * a21;
    const c01 = a12 * a20 - a10 * a22;
    const c02 = a10 * a21 - a11 * a20;
    const c10 = a21 * a02 - a22 * a01;
    const c11 = a22 * a00 - a20 * a02;
    const c12 = a20 * a01 - a21 * a00;
    const c20 = a01 * a12 - a02 * a11;
    const c21 = a02 * a10 - a00 * a12;
    const c22 = a00 * a11 - a01 * a10;
    const det = a00 * c00 + a01 * c01 + a02 * c02;
    const sign = det < 0 ? -1 : 1;
    return { mat3: [c00, c01, c02, c10, c11, c12, c20, c21, c22], mirrored: sign < 0 };
  }

  function parseGLTFOrGLB(buffer, isGlb) {
    let json = null;
    let binBuffer = null;

    if (isGlb) {
      const dv = new DataView(buffer);
      const magic = dv.getUint32(0, true);
      if (magic !== 0x46546C67) throw new Error('Cabecera GLB inválida.');
      let off = 12;
      while (off + 8 <= buffer.byteLength) {
        const chunkLen = dv.getUint32(off, true);
        const chunkType = dv.getUint32(off + 4, true);
        const dataSlice = buffer.slice(off + 8, off + 8 + chunkLen);
        if (chunkType === 0x4E4F534A) {
          json = JSON.parse(new TextDecoder().decode(dataSlice));
        } else if (chunkType === 0x004E4942) {
          binBuffer = dataSlice;
        }
        off += 8 + chunkLen;
      }
    } else {
      json = JSON.parse(new TextDecoder().decode(buffer));
    }

    if (!json || !json.meshes) throw new Error('El archivo glTF no contiene mallas.');

    const buffers = (json.buffers || []).map((b, idx) => {
      if (!b.uri && idx === 0 && binBuffer) return binBuffer;
      if (b.uri && b.uri.startsWith('data:')) {
        const b64 = b.uri.split(',')[1];
        const binStr = atob(b64);
        const arr = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) arr[i] = binStr.charCodeAt(i);
        return arr.buffer;
      }
      return null;
    });

    function readAccessor(accIdx) {
      const acc = json.accessors[accIdx];
      if (!acc || acc.bufferView === undefined) {
        throw new Error('El glTF usa atributos dispersos no soportados.');
      }
      const bv = json.bufferViews[acc.bufferView];
      const buf = buffers[bv.buffer || 0];
      if (!buf) throw new Error('El glTF referencia un archivo .bin externo no incluido. Usa formato .glb autocontenido.');
      const typeMap = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
      const comps = typeMap[acc.type] || 1;
      const count = acc.count * comps;
      const stride = bv.byteStride || 0;
      const dv = new DataView(buf);

      const compBytes = acc.componentType === 5126 ? 4 : acc.componentType === 5125 ? 4 : (acc.componentType === 5123 || acc.componentType === 5122) ? 2 : 1;
      const out = acc.componentType === 5126 ? new Float32Array(count) : new Uint32Array(count);

      const step = stride > 0 ? stride : comps * compBytes;
      for (let i = 0; i < acc.count; i++) {
        const base = (bv.byteOffset || 0) + (acc.byteOffset || 0) + i * step;
        for (let c = 0; c < comps; c++) {
          const p = base + c * compBytes;
          let val = 0;
          if (acc.componentType === 5126) val = dv.getFloat32(p, true);
          else if (acc.componentType === 5125) val = dv.getUint32(p, true);
          else if (acc.componentType === 5123) val = dv.getUint16(p, true);
          else if (acc.componentType === 5121) val = dv.getUint8(p);
          else if (acc.componentType === 5122) val = dv.getInt16(p, true);
          else if (acc.componentType === 5120) val = dv.getInt8(p);
          out[i * comps + c] = val;
        }
      }
      return { data: out, count: acc.count, comps };
    }

    const outPos = [];
    const outNorm = [];
    let hasAllNormals = true;

    function emitMesh(mesh, worldMat) {
      const nInfo = normalMatrix3FromMat4(worldMat);
      const nM = nInfo.mat3;
      const swapWinding = nInfo.mirrored;

      for (const prim of mesh.primitives || []) {
        const mode = prim.mode === undefined ? 4 : prim.mode;
        if (mode !== 4 && mode !== 5 && mode !== 6) continue;
        if (!prim.attributes || prim.attributes.POSITION === undefined) continue;

        const posAcc = readAccessor(prim.attributes.POSITION).data;
        const normAcc = prim.attributes.NORMAL !== undefined ? readAccessor(prim.attributes.NORMAL).data : null;
        if (!normAcc) hasAllNormals = false;

        const vIndices = [];
        if (prim.indices !== undefined) {
          const idxAcc = readAccessor(prim.indices).data;
          if (mode === 4) {
            for (let i = 0; i + 2 < idxAcc.length; i += 3) {
              vIndices.push(idxAcc[i], idxAcc[i + 1], idxAcc[i + 2]);
            }
          } else if (mode === 5) {
            for (let i = 0; i + 2 < idxAcc.length; i++) {
              if (i % 2 === 0) vIndices.push(idxAcc[i], idxAcc[i + 1], idxAcc[i + 2]);
              else vIndices.push(idxAcc[i + 1], idxAcc[i], idxAcc[i + 2]);
            }
          } else if (mode === 6) {
            for (let i = 1; i + 1 < idxAcc.length; i++) {
              vIndices.push(idxAcc[0], idxAcc[i], idxAcc[i + 1]);
            }
          }
        } else {
          const vTotal = Math.floor(posAcc.length / 3);
          if (mode === 4) {
            for (let i = 0; i + 2 < vTotal; i += 3) vIndices.push(i, i + 1, i + 2);
          } else if (mode === 5) {
            for (let i = 0; i + 2 < vTotal; i++) {
              if (i % 2 === 0) vIndices.push(i, i + 1, i + 2);
              else vIndices.push(i + 1, i, i + 2);
            }
          } else if (mode === 6) {
            for (let i = 1; i + 1 < vTotal; i++) vIndices.push(0, i, i + 1);
          }
        }

        for (let t = 0; t + 2 < vIndices.length; t += 3) {
          const i0 = vIndices[t];
          const i1 = swapWinding ? vIndices[t + 2] : vIndices[t + 1];
          const i2 = swapWinding ? vIndices[t + 1] : vIndices[t + 2];
          for (const id of [i0, i1, i2]) {
            const x = posAcc[id * 3] || 0;
            const y = posAcc[id * 3 + 1] || 0;
            const z = posAcc[id * 3 + 2] || 0;
            outPos.push(
              worldMat[0] * x + worldMat[4] * y + worldMat[8] * z + worldMat[12],
              worldMat[1] * x + worldMat[5] * y + worldMat[9] * z + worldMat[13],
              worldMat[2] * x + worldMat[6] * y + worldMat[10] * z + worldMat[14]
            );
            if (normAcc) {
              const nx = normAcc[id * 3] || 0;
              const ny = normAcc[id * 3 + 1] || 0;
              const nz = normAcc[id * 3 + 2] || 0;
              let tx = nM[0] * nx + nM[3] * ny + nM[6] * nz;
              let ty = nM[1] * nx + nM[4] * ny + nM[7] * nz;
              let tz = nM[2] * nx + nM[5] * ny + nM[8] * nz;
              const len = Math.hypot(tx, ty, tz) || 1;
              outNorm.push(tx / len, ty / len, tz / len);
            }
          }
        }
      }
    }

    if (json.nodes && json.nodes.length > 0) {
      const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      function visitNode(nodeIdx, parentMat) {
        const node = json.nodes[nodeIdx];
        if (!node) return;
        const localMat = gltfNodeMatrix(node);
        const worldMat = mat4Multiply(parentMat, localMat);
        if (node.mesh !== undefined && json.meshes[node.mesh]) {
          emitMesh(json.meshes[node.mesh], worldMat);
        }
        if (node.children) {
          for (const childIdx of node.children) visitNode(childIdx, worldMat);
        }
      }

      const scene = (json.scenes && json.scenes[json.scene || 0]) || (json.scenes && json.scenes[0]);
      if (scene && scene.nodes && scene.nodes.length > 0) {
        for (const rootIdx of scene.nodes) visitNode(rootIdx, identity);
      } else {
        const isChild = new Set();
        for (const n of json.nodes) {
          for (const c of n.children || []) isChild.add(c);
        }
        for (let i = 0; i < json.nodes.length; i++) {
          if (!isChild.has(i)) visitNode(i, identity);
        }
      }
    }

    // Respaldo si el glTF define mallas sueltas sin grafo de nodos
    if (outPos.length === 0) {
      const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      for (const mesh of json.meshes) emitMesh(mesh, identity);
    }

    if (outPos.length < 9) throw new Error('No se encontraron triángulos válidos en el glTF/GLB.');
    return {
      positions: new Float32Array(outPos),
      normals: hasAllNormals && outNorm.length === outPos.length ? new Float32Array(outNorm) : null,
      hasNormals: hasAllNormals && outNorm.length === outPos.length,
      defaultZUp: false
    };
  }

  // --- PROCESADO GEOMÉTRICO EN RUST WASM Y CARGA A GPU ---
  function analyzeAndUploadMesh(rawPositions, rawNormals, hasNormals, meta) {
    const t0 = performance.now();
    const triCount = Math.floor(rawPositions.length / 9);
    const totalFloats = triCount * 9;

    const normPositions = new Float32Array(totalFloats);
    const normNormals = hasNormals && rawNormals ? new Float32Array(rawNormals) : new Float32Array(totalFloats);
    const baryCoords = new Float32Array(totalFloats);

    for (let t = 0; t < triCount; t++) {
      const b = t * 9;
      baryCoords[b] = 1;
      baryCoords[b + 4] = 1;
      baryCoords[b + 8] = 1;
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let area = 0, vol = 0, cx = 0, cy = 0, cz = 0, scale = 1;

    if (wasm && wasmMemory) {
      wasm.begin_analysis();
      for (let offsetTri = 0; offsetTri < triCount; offsetTri += batchCapacity) {
        const count = Math.min(batchCapacity, triCount - offsetTri);
        const startF = offsetTri * 9;
        const lenF = count * 9;

        const wasmPos = new Float32Array(wasmMemory.buffer, posPtr, lenF);
        wasmPos.set(rawPositions.subarray(startF, startF + lenF));
        wasm.analyze_batch(count, hasNormals ? 0 : 1);

        if (!hasNormals) {
          const wasmNorm = new Float32Array(wasmMemory.buffer, normPtr, lenF);
          normNormals.set(wasmNorm, startF);
        }
      }

      wasm.finish_analysis();
      const stats = new Float32Array(wasmMemory.buffer, statsPtr, 16);
      minX = stats[0]; minY = stats[1]; minZ = stats[2];
      maxX = stats[3]; maxY = stats[4]; maxZ = stats[5];
      area = stats[6]; vol = stats[7];
      cx = stats[10]; cy = stats[11]; cz = stats[12];
      scale = stats[13] || 1;

      for (let offsetTri = 0; offsetTri < triCount; offsetTri += batchCapacity) {
        const count = Math.min(batchCapacity, triCount - offsetTri);
        const startF = offsetTri * 9;
        const lenF = count * 9;

        const wasmPos = new Float32Array(wasmMemory.buffer, posPtr, lenF);
        wasmPos.set(rawPositions.subarray(startF, startF + lenF));
        wasm.transform_batch(count, cx, cy, cz, scale);
        normPositions.set(new Float32Array(wasmMemory.buffer, posPtr, lenF), startF);
      }
    } else {
      // Fallback JS por si WASM aún está cargando en el primer instante
      let accVol = 0;
      for (let t = 0; t < triCount; t++) {
        const b = t * 9;
        const ax = rawPositions[b], ay = rawPositions[b + 1], az = rawPositions[b + 2];
        const bx = rawPositions[b + 3], by = rawPositions[b + 4], bz = rawPositions[b + 5];
        const dx = rawPositions[b + 6], dy = rawPositions[b + 7], dz = rawPositions[b + 8];
        minX = Math.min(minX, ax, bx, dx);
        minY = Math.min(minY, ay, by, dy);
        minZ = Math.min(minZ, az, bz, dz);
        maxX = Math.max(maxX, ax, bx, dx);
        maxY = Math.max(maxY, ay, by, dy);
        maxZ = Math.max(maxZ, az, bz, dz);

        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = dx - ax, e2y = dy - ay, e2z = dz - az;
        const nx = e1y * e2z - e1z * e2y;
        const ny = e1z * e2x - e1x * e2z;
        const nz = e1x * e2y - e1y * e2x;
        const l = Math.hypot(nx, ny, nz);
        area += 0.5 * l;
        accVol += (ax * (by * dz - bz * dy) + ay * (bz * dx - bx * dz) + az * (bx * dy - by * dx)) / 6;

        if (!hasNormals) {
          const inv = l > 1e-10 ? 1 / l : 0;
          const ux = nx * inv, uy = ny * inv, uz = nz * inv;
          for (let v = 0; v < 3; v++) {
            normNormals[b + v * 3] = ux;
            normNormals[b + v * 3 + 1] = uy;
            normNormals[b + v * 3 + 2] = uz;
          }
        }
      }
      vol = Math.abs(accVol);
      const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.0001);
      scale = 2.0 / maxDim;
      cx = (minX + maxX) * 0.5;
      cy = (minY + maxY) * 0.5;
      cz = (minZ + maxZ) * 0.5;
      for (let i = 0; i < totalFloats; i += 3) {
        normPositions[i] = (rawPositions[i] - cx) * scale;
        normPositions[i + 1] = (rawPositions[i + 1] - cy) * scale;
        normPositions[i + 2] = (rawPositions[i + 2] - cz) * scale;
      }
    }

    const t1 = performance.now();
    lastWasmMs = Math.max(0.01, t1 - t0);

    // Subir buffers a GPU
    if (gl && meshVao) {
      gl.bindVertexArray(meshVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posVbo);
      gl.bufferData(gl.ARRAY_BUFFER, normPositions, gl.STATIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, normVbo);
      gl.bufferData(gl.ARRAY_BUFFER, normNormals, gl.STATIC_DRAW);

      gl.bindBuffer(gl.ARRAY_BUFFER, baryVbo);
      gl.bufferData(gl.ARRAY_BUFFER, baryCoords, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }

    const rawDims = [
      Math.max(0, maxX - minX),
      Math.max(0, maxY - minY),
      Math.max(0, maxZ - minZ)
    ];

    const halfY = rawDims[1] * 0.5 * scale;
    const halfZ = rawDims[2] * 0.5 * scale;

    currentMeshInfo = {
      name: meta.name,
      sourceLabel: meta.sourceLabel,
      isExternal: Boolean(meta.isExternal),
      triCount,
      halfY,
      halfZ,
      rawDims,
      rawArea: area,
      rawVol: vol,
      rawPositions,
      normPositions,
      normNormals
    };

    updateInspectorUI();
  }

  function updateInspectorUI() {
    const info = currentMeshInfo;
    if (triStatEl) triStatEl.textContent = formatNumber(info.triCount);
    if (specTrisEl) specTrisEl.textContent = formatNumber(info.triCount);
    if (specVertsEl) specVertsEl.textContent = formatNumber(info.triCount * 3);
    if (partTitleEl) partTitleEl.textContent = info.name;
    if (partSourceBadgeEl) {
      partSourceBadgeEl.textContent = info.sourceLabel;
      partSourceBadgeEl.classList.toggle('external', info.isExternal);
    }
    if (specDimsEl) {
      const d = flipZtoY
        ? [info.rawDims[0], info.rawDims[2], info.rawDims[1]]
        : info.rawDims;
      specDimsEl.textContent = `${formatDim(d[0])} × ${formatDim(d[1])} × ${formatDim(d[2])}`;
    }
    if (specAreaEl) specAreaEl.textContent = formatDim(info.rawArea);
    if (specVolEl) specVolEl.textContent = formatDim(info.rawVol);
    const flipBtn = document.getElementById('flipUpBtn');
    if (flipBtn) flipBtn.classList.toggle('active', flipZtoY);
  }

  function loadPreset(key) {
    currentPresetKey = key;
    document.querySelectorAll('.preset-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.preset === key);
    });
    if (toastBanner && toastBanner.classList.contains('error')) {
      toastBanner.classList.add('hidden');
    }

    if (key === 'custom' && customModelCache) {
      flipZtoY = Boolean(customModelCache.defaultZUp);
      analyzeAndUploadMesh(
        customModelCache.positions,
        customModelCache.normals,
        customModelCache.hasNormals,
        {
          name: customModelCache.name,
          sourceLabel: `EXTERNO · ${customModelCache.format}`,
          isExternal: true
        }
      );
      resetCamera();
      return;
    }

    flipZtoY = false;
    let built;
    switch (key) {
      case 'turbine': built = buildTurbinePart(); break;
      case 'flange': built = buildFlangePart(); break;
      case 'heatsink': built = buildHeatsinkPart(); break;
      case 'knot': built = buildTorusKnotPart(); break;
      default: built = buildGearPart(); break;
    }

    analyzeAndUploadMesh(built.positions, built.normals, built.hasNormals, {
      name: built.name,
      sourceLabel: 'PIEZA POR DEFECTO',
      isExternal: false
    });
  }

  async function handleExternalFile(file) {
    if (!file) return;
    const fileName = file.name;
    const ext = fileName.split('.').pop().toLowerCase();
    const supported = ['stl', 'obj', 'ply', 'glb', 'gltf'];

    if (!supported.includes(ext)) {
      showToast(`Formato .${ext} no soportado. Usa .STL, .OBJ, .PLY, .GLB o .GLTF.`, true);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      let parsed;
      if (ext === 'stl') parsed = parseSTL(buffer);
      else if (ext === 'obj') parsed = parseOBJ(buffer);
      else if (ext === 'ply') parsed = parsePLY(buffer);
      else parsed = parseGLTFOrGLB(buffer, ext === 'glb');

      customModelCache = {
        name: fileName,
        format: ext.toUpperCase(),
        positions: parsed.positions,
        normals: parsed.normals,
        hasNormals: parsed.hasNormals,
        defaultZUp: parsed.defaultZUp
      };

      if (customPresetBtn) {
        customPresetBtn.classList.remove('hidden');
        customPresetBtn.textContent = fileName.length > 10 ? `${fileName.slice(0, 8)}…` : fileName;
        customPresetBtn.title = `Archivo externo: ${fileName}`;
      }
      if (presetCountLabelEl) presetCountLabelEl.textContent = '5 + externa';

      loadPreset('custom');
      showToast(`Pieza "${fileName}" cargada (${formatNumber(parsed.positions.length / 9)} triángulos).`);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'No se pudo leer el fichero 3D.', true);
    }
  }

  function exportCurrentStl() {
    const pos = currentMeshInfo.normPositions;
    const norm = currentMeshInfo.normNormals;
    if (!pos || pos.length < 9) return;
    const triCount = currentMeshInfo.triCount;
    const buffer = new ArrayBuffer(84 + triCount * 50);
    const dv = new DataView(buffer);

    const headerStr = `javiergalilea.es pr_visor3d - ${currentMeshInfo.name}`;
    for (let i = 0; i < Math.min(79, headerStr.length); i++) {
      dv.setUint8(i, headerStr.charCodeAt(i));
    }
    dv.setUint32(80, triCount, true);

    let off = 84;
    for (let t = 0; t < triCount; t++) {
      const b = t * 9;
      dv.setFloat32(off, norm[b], true);
      dv.setFloat32(off + 4, norm[b + 1], true);
      dv.setFloat32(off + 8, norm[b + 2], true);
      for (let v = 0; v < 3; v++) {
        const vo = off + 12 + v * 12;
        dv.setFloat32(vo, pos[b + v * 3] * 50, true);
        dv.setFloat32(vo + 4, pos[b + v * 3 + 1] * 50, true);
        dv.setFloat32(vo + 8, pos[b + v * 3 + 2] * 50, true);
      }
      dv.setUint16(off + 48, 0, true);
      off += 50;
    }

    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanName = currentMeshInfo.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    a.href = url;
    a.download = `${cleanName || 'pieza_3d'}.stl`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exportado ${a.download}`);
  }

  // --- CONTROL DE EXPLORACIÓN MANUAL & AUTOMÁTICA ---
  function syncExplorationUI() {
    document.querySelectorAll('.explore-btn').forEach(btn => {
      const isAutoBtn = btn.dataset.explore === 'auto';
      btn.classList.toggle('active', isAutoBtn === autoEnabled);
    });
    if (autoStyleGroup) {
      autoStyleGroup.classList.toggle('dimmed', !autoEnabled);
    }
    if (autoTopBtn && autoTopLabel) {
      autoTopBtn.classList.toggle('active', autoEnabled);
      autoTopLabel.textContent = autoEnabled ? '🤖 Auto: ON' : '🖐️ Manual';
    }
    if (exploreBadgeEl) {
      if (!autoEnabled) {
        exploreBadgeEl.textContent = 'MANUAL';
      } else {
        const labels = ['AUTO · ÓRBITA', 'AUTO · TOUR', 'AUTO · VISTAS'];
        exploreBadgeEl.textContent = labels[autoMode] || 'AUTO';
      }
    }
  }

  function setExplorationMode(enableAuto) {
    if (autoEnabled && !enableAuto) {
      // Sincronizar ángulos actuales al pasar a Manual para evitar saltos
      targetYaw = camState[0];
      targetPitch = camState[1];
      targetDist = camState[2];
      targetPanX = camState[3];
      targetPanY = camState[4];
      targetPanZ = camState[5];
    }
    autoEnabled = enableAuto;
    autoPauseUntil = 0;
    syncExplorationUI();
  }

  function snapToView(viewName) {
    setExplorationMode(false);
    targetPanX = 0;
    targetPanY = 0;
    targetPanZ = 0;
    targetDist = 3.15;

    document.querySelectorAll('.snap-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === viewName);
    });

    switch (viewName) {
      case 'front':
        targetYaw = 0.0;
        targetPitch = 0.02;
        break;
      case 'side':
        targetYaw = Math.PI * 0.5;
        targetPitch = 0.02;
        break;
      case 'top':
        targetYaw = 0.0;
        targetPitch = 1.48;
        break;
      case 'iso':
      default:
        targetYaw = 0.65;
        targetPitch = 0.44;
        break;
    }
  }

  function resetCamera() {
    targetYaw = 0.65;
    targetPitch = 0.44;
    targetDist = 3.2;
    targetPanX = 0.0;
    targetPanY = 0.0;
    targetPanZ = 0.0;
    document.querySelectorAll('.snap-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.view === 'iso');
    });
  }

  // --- GIZMO 3D DE EJES ---
  function drawAxisGizmo(yaw, pitch) {
    if (!gctx || !showAxes) return;
    const w = gizmoCanvas.width;
    const h = gizmoCanvas.height;
    gctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const len = w * 0.31;

    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const cpitch = Math.cos(pitch), spitch = Math.sin(pitch);

    function projectAxis(x, y, z) {
      // Rotación inversa de cámara para alinear con el mundo visto desde (yaw, pitch)
      const rx = x * cyaw - z * syaw;
      const rz1 = x * syaw + z * cyaw;
      const ry = y * cpitch - rz1 * spitch;
      const rz = y * spitch + rz1 * cpitch;
      return {
        sx: cx + rx * len,
        sy: cy - ry * len,
        z: rz
      };
    }

    const axes = [
      { label: 'X', col: '#f72585', p: projectAxis(1, 0, 0), view: 'side' },
      { label: 'Y', col: '#00f5d4', p: projectAxis(0, 1, 0), view: 'top' },
      { label: 'Z', col: '#3b82f6', p: projectAxis(0, 0, 1), view: 'front' }
    ].sort((a, b) => a.p.z - b.p.z);

    // Origen
    gctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    gctx.beginPath();
    gctx.arc(cx, cy, 3, 0, Math.PI * 2);
    gctx.fill();

    for (const ax of axes) {
      gctx.strokeStyle = ax.col;
      gctx.lineWidth = 2.2;
      gctx.beginPath();
      gctx.moveTo(cx, cy);
      gctx.lineTo(ax.p.sx, ax.p.sy);
      gctx.stroke();

      gctx.fillStyle = ax.col;
      gctx.beginPath();
      gctx.arc(ax.p.sx, ax.p.sy, 8.5, 0, Math.PI * 2);
      gctx.fill();

      gctx.fillStyle = '#05070c';
      gctx.font = '800 9.5px ui-monospace, Menlo, monospace';
      gctx.textAlign = 'center';
      gctx.textBaseline = 'middle';
      gctx.fillText(ax.label, ax.p.sx, ax.p.sy + 0.5);
    }

    gizmoCanvas._projectedAxes = axes;
  }

  // --- INTERACTIVIDAD Y EVENTOS ---
  function setupEvents() {
    // Ratón en lienzo 3D
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1 || e.shiftKey) {
        dragMode = 'pan';
      } else {
        dragMode = 'orbit';
      }
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      targetYaw = camState[0];
      targetPitch = camState[1];
      targetDist = camState[2];
      targetPanX = camState[3];
      targetPanY = camState[4];
      targetPanZ = camState[5];
      document.querySelectorAll('.snap-btn').forEach(b => b.classList.remove('active'));
      hideHintSoon();
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      if (dragMode === 'orbit') {
        targetYaw -= dx * 0.0085;
        targetPitch = Math.max(-1.50, Math.min(1.50, targetPitch + dy * 0.0075));
      } else {
        const panScale = camState[2] * 0.0016;
        const cy = Math.cos(camState[0]), sy = Math.sin(camState[0]);
        targetPanX -= dx * cy * panScale;
        targetPanZ += dx * sy * panScale;
        targetPanY += dy * panScale;
      }
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (autoEnabled) autoPauseUntil = performance.now() + 2000;
      }
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (autoEnabled && autoMode !== 0) {
        targetYaw = camState[0];
        targetPitch = camState[1];
        targetDist = camState[2];
        targetPanX = camState[3];
        targetPanY = camState[4];
        targetPanZ = camState[5];
      }
      const factor = e.deltaY > 0 ? 1.1 : 0.91;
      targetDist = Math.max(0.8, Math.min(11.5, targetDist * factor));
      if (autoEnabled) autoPauseUntil = performance.now() + 1800;
      hideHintSoon();
    }, { passive: false });

    canvas.addEventListener('dblclick', () => {
      resetCamera();
    });

    // Táctil
    canvas.addEventListener('touchstart', (e) => {
      targetYaw = camState[0];
      targetPitch = camState[1];
      targetDist = camState[2];
      targetPanX = camState[3];
      targetPanY = camState[4];
      targetPanZ = camState[5];
      if (e.touches.length === 1) {
        isDragging = true;
        dragMode = 'orbit';
        lastPointerX = e.touches[0].clientX;
        lastPointerY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        isDragging = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
        lastTouchMidX = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
        lastTouchMidY = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
      }
      hideHintSoon();
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - lastPointerX;
        const dy = e.touches[0].clientY - lastPointerY;
        lastPointerX = e.touches[0].clientX;
        lastPointerY = e.touches[0].clientY;
        targetYaw -= dx * 0.0085;
        targetPitch = Math.max(-1.50, Math.min(1.50, targetPitch + dy * 0.0075));
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastTouchDist > 0) {
          targetDist = Math.max(0.8, Math.min(11.5, targetDist * (lastTouchDist / dist)));
        }
        lastTouchDist = dist;

        const mx = (e.touches[0].clientX + e.touches[1].clientX) * 0.5;
        const my = (e.touches[0].clientY + e.touches[1].clientY) * 0.5;
        const panScale = camState[2] * 0.0016;
        const cy = Math.cos(camState[0]), sy = Math.sin(camState[0]);
        targetPanX -= (mx - lastTouchMidX) * cy * panScale;
        targetPanZ += (mx - lastTouchMidX) * sy * panScale;
        targetPanY += (my - lastTouchMidY) * panScale;
        lastTouchMidX = mx;
        lastTouchMidY = my;
      }
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        lastTouchDist = 0;
        if (autoEnabled) autoPauseUntil = performance.now() + 2000;
      }
    });

    // Click en gizmo 3D de ejes
    if (gizmoCanvas) {
      gizmoCanvas.addEventListener('click', (e) => {
        const rect = gizmoCanvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) * (gizmoCanvas.width / rect.width);
        const y = (e.clientY - rect.top) * (gizmoCanvas.height / rect.height);
        const axes = gizmoCanvas._projectedAxes || [];
        let best = null;
        let bestD = 18;
        for (const ax of axes) {
          const d = Math.hypot(x - ax.p.sx, y - ax.p.sy);
          if (d < bestD) {
            bestD = d;
            best = ax;
          }
        }
        if (best) {
          snapToView(best.view);
        } else {
          snapToView('iso');
        }
      });
    }

    // Selector de piezas por defecto
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        loadPreset(btn.dataset.preset);
      });
    });

    // Exploración Manual vs Automática
    document.querySelectorAll('.explore-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setExplorationMode(btn.dataset.explore === 'auto');
      });
    });

    if (autoTopBtn) {
      autoTopBtn.addEventListener('click', () => {
        setExplorationMode(!autoEnabled);
      });
    }

    // Sub-modos de exploración automática
    document.querySelectorAll('.automode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.automode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        autoMode = parseInt(btn.dataset.automode, 10);
        setExplorationMode(true);
      });
    });

    // Acabados / Shaders 3D
    document.querySelectorAll('.shade-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.shade-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const map = { solid: 0, titanium: 1, wireframe: 2, xray: 3 };
        shadeMode = map[btn.dataset.shade] ?? 0;
      });
    });

    // Vistas rápidas manuales CAD
    document.querySelectorAll('.snap-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        snapToView(btn.dataset.view);
      });
    });

    // Sliders
    if (speedSlider) {
      speedSlider.addEventListener('input', (e) => {
        autoSpeed = parseFloat(e.target.value);
        if (speedLabel) speedLabel.textContent = `${autoSpeed.toFixed(1)}×`;
      });
    }

    if (clipSlider) {
      clipSlider.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        clipFraction = pct / 100;
        if (clipLabel) clipLabel.textContent = `${pct}%`;
      });
    }

    // Botones del Inspector
    const flipUpBtn = document.getElementById('flipUpBtn');
    if (flipUpBtn) {
      flipUpBtn.addEventListener('click', () => {
        flipZtoY = !flipZtoY;
        updateInspectorUI();
        showToast(flipZtoY ? 'Orientación cambiada a Z-up (CAD)' : 'Orientación cambiada a Y-up');
      });
    }

    const exportStlBtn = document.getElementById('exportStlBtn');
    if (exportStlBtn) {
      exportStlBtn.addEventListener('click', exportCurrentStl);
    }

    const gridToggleBtn = document.getElementById('gridToggleBtn');
    if (gridToggleBtn) {
      gridToggleBtn.addEventListener('click', () => {
        showGrid = !showGrid;
        gridToggleBtn.classList.toggle('active', showGrid);
      });
    }

    const axesToggleBtn = document.getElementById('axesToggleBtn');
    if (axesToggleBtn) {
      axesToggleBtn.addEventListener('click', () => {
        showAxes = !showAxes;
        axesToggleBtn.classList.toggle('active', showAxes);
        if (gizmoCanvas) gizmoCanvas.classList.toggle('hidden', !showAxes);
      });
    }

    // Carga externa de archivo (Botón + Drag & Drop)
    if (openFileBtn && fileInput) {
      openFileBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleExternalFile(e.target.files[0]);
          fileInput.value = '';
        }
      });
    }

    let dragCounter = 0;
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      if (dropOverlay) dropOverlay.classList.remove('hidden');
    });
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0 && dropOverlay) dropOverlay.classList.add('hidden');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      if (dropOverlay) dropOverlay.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleExternalFile(e.dataTransfer.files[0]);
      }
    });

    // Barra superior estándar (Centrar, Modo Limpio, Fullscreen, Toggle HUD)
    const resetCamBtn = document.getElementById('resetCamBtn');
    if (resetCamBtn) resetCamBtn.addEventListener('click', resetCamera);

    const hudDock = document.getElementById('hudDock');
    const inspectorPanel = document.getElementById('inspectorPanel');
    const toggleHudBtn = document.getElementById('toggleHudBtn');
    if (toggleHudBtn && hudDock) {
      toggleHudBtn.addEventListener('click', () => {
        hudDock.classList.toggle('collapsed');
        if (inspectorPanel) inspectorPanel.classList.toggle('collapsed');
      });
    }

    const cleanModeBtn = document.getElementById('cleanModeBtn');
    const restoreUiBtn = document.getElementById('restoreUiBtn');
    if (cleanModeBtn) {
      cleanModeBtn.addEventListener('click', () => document.body.classList.add('clean-mode'));
    }
    if (restoreUiBtn) {
      restoreUiBtn.addEventListener('click', () => document.body.classList.remove('clean-mode'));
    }

    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
        else document.exitFullscreen().catch(() => {});
      });
    }

    // Atajos de teclado
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('clean-mode')) {
        document.body.classList.remove('clean-mode');
      } else if (e.key === ' ') {
        e.preventDefault();
        setExplorationMode(!autoEnabled);
      } else if (e.key === 'r' || e.key === 'R') {
        resetCamera();
      } else if (e.key === 'g' || e.key === 'G') {
        showGrid = !showGrid;
        if (gridToggleBtn) gridToggleBtn.classList.toggle('active', showGrid);
      } else if (e.key >= '1' && e.key <= '5') {
        const keys = ['gear', 'turbine', 'flange', 'heatsink', 'knot'];
        loadPreset(keys[parseInt(e.key, 10) - 1]);
      }
    });
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  // --- BUCLE PRINCIPAL DE RENDERIZADO ---
  function render(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    resizeCanvas();

    const userBusy = (isDragging || now < autoPauseUntil) ? 1 : 0;

    if (wasm && wasmMemory) {
      const t0 = performance.now();
      wasm.step_camera(
        dt,
        autoEnabled ? 1 : 0,
        autoMode,
        autoSpeed,
        userBusy,
        targetYaw,
        targetPitch,
        targetDist,
        targetPanX,
        targetPanY,
        targetPanZ
      );
      const t1 = performance.now();
      lastWasmMs = lastWasmMs * 0.85 + Math.max(0.01, t1 - t0) * 0.15;
      const viewCam = new Float32Array(wasmMemory.buffer, camPtr, 8);
      camState.set(viewCam);
    } else {
      // Fallback JS de cámara con los 3 modos automáticos y envoltura angular
      if (autoEnabled && !userBusy) {
        const t = camState[6] + dt * autoSpeed;
        camState[6] = t;
        if (autoMode === 1) {
          camState[0] += dt * autoSpeed * 0.48;
          const dp = 0.28 + Math.sin(t * 0.55) * 0.46 + Math.cos(t * 0.28) * 0.14;
          const dd = 2.95 + Math.sin(t * 0.42) * 0.65;
          camState[1] += (Math.max(-1.15, Math.min(1.25, dp)) - camState[1]) * 0.08;
          camState[2] += (dd - camState[2]) * 0.08;
        } else if (autoMode === 2) {
          const yaws = [0.68, 0.0, 1.5708, 0.0, -0.78];
          const pitches = [0.46, 0.04, 0.04, 1.38, -0.35];
          const dists = [3.15, 2.95, 2.95, 3.25, 2.85];
          const seg = 3.2;
          const ct = t % (seg * 5);
          const idx = Math.floor(ct / seg) % 5;
          const next = (idx + 1) % 5;
          const u = (ct - idx * seg) / seg;
          let blend = 0;
          if (u >= 0.55) {
            const s = Math.max(0, Math.min(1, (u - 0.55) / 0.45));
            blend = s * s * (3 - 2 * s);
          }
          let y1 = yaws[next];
          if (y1 - yaws[idx] > Math.PI) y1 -= Math.PI * 2;
          if (y1 - yaws[idx] < -Math.PI) y1 += Math.PI * 2;
          const gy = yaws[idx] + (y1 - yaws[idx]) * blend;
          let dy = gy - camState[0];
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          camState[0] += dy * 0.12;
          camState[1] += (pitches[idx] + (pitches[next] - pitches[idx]) * blend - camState[1]) * 0.12;
          camState[2] += (dists[idx] + (dists[next] - dists[idx]) * blend - camState[2]) * 0.12;
        } else {
          camState[0] += dt * autoSpeed * 0.58;
          camState[1] += (0.42 + Math.sin(t * 0.45) * 0.16 - camState[1]) * 0.08;
          camState[2] += (targetDist - camState[2]) * 0.08;
        }
      } else {
        let dy = targetYaw - camState[0];
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        camState[0] += dy * 0.15;
        camState[1] += (targetPitch - camState[1]) * 0.15;
        camState[2] += (targetDist - camState[2]) * 0.15;
        camState[3] += (targetPanX - camState[3]) * 0.15;
        camState[4] += (targetPanY - camState[4]) * 0.15;
        camState[5] += (targetPanZ - camState[5]) * 0.15;
      }
    }

    const yaw = camState[0];
    const pitch = camState[1];
    const dist = camState[2];
    const px = camState[3];
    const py = camState[4];
    const pz = camState[5];

    if (gl && meshProgram) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const eye = [
        px + dist * cp * sy,
        py + dist * sp,
        pz + dist * cp * cy
      ];

      const aspect = canvas.width / Math.max(1, canvas.height);
      const proj = mat4Perspective(Math.PI / 4, aspect, 0.05, 80.0);
      const view = mat4LookAt(eye, [px, py, pz], [0, 1, 0]);
      const viewProj = mat4Multiply(proj, view);

      const modelMat = flipZtoY
        ? mat4RotationX(-Math.PI * 0.5)
        : new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

      const halfHeight = flipZtoY ? currentMeshInfo.halfZ : currentMeshInfo.halfY;
      const floorY = -Math.max(0.1, halfHeight) - 0.015;
      const clipActive = clipFraction < 0.995 ? 1.0 : 0.0;
      const clipY = -halfHeight + (halfHeight * 2.0 + 0.04) * clipFraction;

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      // 1. Dibujar rejilla de referencia CAD
      if (showGrid && gridProgram && gridVao) {
        gl.useProgram(gridProgram);
        gl.uniformMatrix4fv(gridUniforms.uViewProj, false, viewProj);
        gl.uniform1f(gridUniforms.uFloorY, floorY);
        gl.bindVertexArray(gridVao);
        gl.drawArrays(gl.LINES, 0, gridVertexCount);
        gl.bindVertexArray(null);
      }

      // 2. Dibujar la pieza 3D
      if (currentMeshInfo.triCount > 0) {
        gl.useProgram(meshProgram);
        gl.uniformMatrix4fv(meshUniforms.uViewProj, false, viewProj);
        gl.uniformMatrix4fv(meshUniforms.uModel, false, modelMat);
        gl.uniform3f(meshUniforms.uCamPos, eye[0], eye[1], eye[2]);
        gl.uniform1i(meshUniforms.uShadeMode, shadeMode);
        gl.uniform1f(meshUniforms.uClipY, clipY);
        gl.uniform1f(meshUniforms.uClipActive, clipActive);

        if (shadeMode === 3) {
          gl.depthMask(false);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        } else {
          gl.depthMask(true);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        gl.bindVertexArray(meshVao);
        gl.drawArrays(gl.TRIANGLES, 0, currentMeshInfo.triCount * 3);
        gl.bindVertexArray(null);
        gl.depthMask(true);
      }
    }

    drawAxisGizmo(yaw, pitch);

    // Actualizar FPS y tiempo WASM
    frameCount++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      if (fpsEl) fpsEl.textContent = Math.round(frameCount / fpsTimer);
      if (wasmTimeEl) wasmTimeEl.textContent = lastWasmMs.toFixed(2);
      frameCount = 0;
      fpsTimer = 0;
    }

    requestAnimationFrame(render);
  }

  // --- CARGA DEL MOTOR RUST WASM ---
  async function initWasm() {
    try {
      let instance;
      if (typeof WebAssembly.instantiateStreaming === 'function') {
        try {
          const res = await WebAssembly.instantiateStreaming(fetch('engine.wasm'));
          instance = res.instance;
        } catch (_) {
          const res = await fetch('engine.wasm');
          const bytes = await res.arrayBuffer();
          instance = (await WebAssembly.instantiate(bytes)).instance;
        }
      } else {
        const res = await fetch('engine.wasm');
        const bytes = await res.arrayBuffer();
        instance = (await WebAssembly.instantiate(bytes)).instance;
      }

      wasm = instance.exports;
      wasmMemory = wasm.memory;
      posPtr = wasm.get_pos_ptr();
      normPtr = wasm.get_norm_ptr();
      statsPtr = wasm.get_stats_ptr();
      camPtr = wasm.get_cam_ptr();
      batchCapacity = wasm.get_batch_capacity();
      wasm.set_camera_immediate(targetYaw, targetPitch, targetDist, targetPanX, targetPanY, targetPanZ);

      // Re-analizar la pieza inicial ya con Rust WASM activo
      loadPreset(currentPresetKey);
    } catch (err) {
      console.warn('No se pudo cargar engine.wasm, usando respaldo JS:', err);
    }
  }

  // --- INICIO ---
  initWebGL();
  setupEvents();
  syncExplorationUI();
  loadPreset('gear');
  initWasm();
  requestAnimationFrame(render);
})();

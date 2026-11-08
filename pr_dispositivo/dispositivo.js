/**
 * Subproyecto #04: Diagnóstico y Telemetría de Dispositivo (Rust + WASM)
 * javiergalilea.es/pr_dispositivo/
 */

(function () {
  'use strict';

  let wasmInstance = null;

  // Elementos DOM
  const tierTitle = document.getElementById('tierTitle');
  const tierSummary = document.getElementById('tierSummary');
  const tierScore = document.getElementById('tierScore');
  const cpuCores = document.getElementById('cpuCores');
  const ramGb = document.getElementById('ramGb');
  const benchResult = document.getElementById('benchResult');
  const platformText = document.getElementById('platformText');
  const screenRes = document.getElementById('screenRes');
  const viewportRes = document.getElementById('viewportRes');
  const pixelRatio = document.getElementById('pixelRatio');
  const gpuRenderer = document.getElementById('gpuRenderer');
  const onlineStatus = document.getElementById('onlineStatus');
  const netType = document.getElementById('netType');
  const netDownlink = document.getElementById('netDownlink');
  const netRtt = document.getElementById('netRtt');
  const userLang = document.getElementById('userLang');
  const userTimezone = document.getElementById('userTimezone');
  const colorScheme = document.getElementById('colorScheme');
  const touchSupport = document.getElementById('touchSupport');
  const batteryLevel = document.getElementById('batteryLevel');
  const batteryCharging = document.getElementById('batteryCharging');
  const batteryTime = document.getElementById('batteryTime');
  const saveDataMode = document.getElementById('saveDataMode');
  const btnGeo = document.getElementById('btnGeo');
  const geoResult = document.getElementById('geoResult');
  const btnOrientation = document.getElementById('btnOrientation');
  const orientResult = document.getElementById('orientResult');
  const runBenchBtn = document.getElementById('runBenchBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // 1. Recolección de datos de hardware del navegador
  function inspectDevice() {
    const cores = navigator.hardwareConcurrency || 4;
    const ram = navigator.deviceMemory || 4;
    const sw = window.screen.width;
    const sh = window.screen.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 1 : 0;

    cpuCores.textContent = `${cores} núcleos lógicos`;
    ramGb.textContent = navigator.deviceMemory ? `≥ ${navigator.deviceMemory} GB` : 'No reportada por navegador';
    platformText.textContent = `${navigator.userAgentData?.platform || navigator.platform || 'Desconocido'}`;

    screenRes.textContent = `${sw} x ${sh} px`;
    viewportRes.textContent = `${vw} x ${vh} px`;
    pixelRatio.textContent = `${dpr}x (${Math.round(dpr * 96)} DPI aprox)`;

    // Detección GPU con WebGL
    try {
      const glCanvas = document.createElement('canvas');
      const gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          gpuRenderer.textContent = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        } else {
          gpuRenderer.textContent = gl.getParameter(gl.RENDERER) || 'Aceleración WebGL activa';
        }
      } else {
        gpuRenderer.textContent = 'Sin aceleración WebGL';
      }
    } catch (_) {
      gpuRenderer.textContent = 'GPU no identificable';
    }

    // Red
    onlineStatus.textContent = navigator.onLine ? 'En línea (Conectado)' : 'Desconectado';
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      netType.textContent = conn.effectiveType ? conn.effectiveType.toUpperCase() : 'Desconocido';
      netDownlink.textContent = conn.downlink ? `~${conn.downlink} Mbps` : 'No disponible';
      netRtt.textContent = conn.rtt ? `${conn.rtt} ms` : 'No disponible';
      saveDataMode.textContent = conn.saveData ? 'Activado' : 'Desactivado';
    } else {
      netType.textContent = 'API Network Information no soportada';
      netDownlink.textContent = 'N/D';
      netRtt.textContent = 'N/D';
      saveDataMode.textContent = 'N/D';
    }

    // Entorno
    userLang.textContent = `${navigator.language} (${(navigator.languages || []).join(', ')})`;
    try {
      userTimezone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local';
    } catch (_) {
      userTimezone.textContent = 'Zona local';
    }

    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    colorScheme.textContent = isDark ? 'Modo Oscuro (Dark)' : 'Modo Claro (Light)';
    touchSupport.textContent = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? `Sí (${navigator.maxTouchPoints || 1} puntos)` : 'No detectada';

    // Batería (si el navegador implementa Battery Status API)
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then(battery => {
        function updateBat() {
          batteryLevel.textContent = `${Math.round(battery.level * 100)}%`;
          batteryCharging.textContent = battery.charging ? 'Cargando ⚡' : 'En batería';
          if (battery.charging) {
            batteryTime.textContent = battery.chargingTime === Infinity ? 'Carga continua' : `Completa en ~${Math.round(battery.chargingTime / 60)} min`;
          } else {
            batteryTime.textContent = battery.dischargingTime === Infinity ? 'Calculando...' : `Restante ~${Math.round(battery.dischargingTime / 60)} min`;
          }
        }
        updateBat();
        battery.addEventListener('chargingchange', updateBat);
        battery.addEventListener('levelchange', updateBat);
      }).catch(() => {
        batteryLevel.textContent = 'No accesible';
      });
    } else {
      batteryLevel.textContent = 'API no permitida por navegador';
      batteryCharging.textContent = 'Privacidad activa';
      batteryTime.textContent = 'N/D';
    }

    // Calcular Puntuación de Hardware en Rust (WASM)
    if (wasmInstance) {
      const score = wasmInstance.exports.calculate_hardware_tier(
        cores,
        ram,
        sw,
        sh,
        dpr,
        isMobile
      );

      tierScore.textContent = score;

      if (score >= 90) {
        tierTitle.textContent = 'Estación de Trabajo / Gama Alta';
        tierSummary.textContent = 'Tu dispositivo cuenta con abundantes hilos de procesamiento, memoria y alta densidad gráfica. Ideal para cargas de cálculo masivas y gráficos 3D.';
      } else if (score >= 65) {
        tierTitle.textContent = 'Equipo Equilibrado / Gama Media-Alta';
        tierSummary.textContent = 'Configuración muy capaz para ejecución fluida de WebAssembly, gráficos en tiempo real y multitarea sin sobrecalentamiento.';
      } else {
        tierTitle.textContent = 'Dispositivo Portátil / Eficiente';
        tierSummary.textContent = 'Dispositivo optimizado para consumo ligero de batería y navegación ágil.';
      }
    }
  }

  // 2. Permiso interactivo: Geolocalización
  btnGeo.addEventListener('click', () => {
    if (!navigator.geolocation) {
      geoResult.textContent = 'Geolocalización no soportada en este navegador.';
      return;
    }
    geoResult.textContent = 'Solicitando acceso GPS al navegador...';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        geoResult.innerHTML = `✅ Lat: <strong>${latitude.toFixed(4)}</strong>, Lon: <strong>${longitude.toFixed(4)}</strong> (precisión: ±${Math.round(accuracy)}m)`;
      },
      (err) => {
        geoResult.textContent = `❌ Acceso denegado o no disponible (${err.message})`;
      },
      { timeout: 10000 }
    );
  });

  // 3. Permiso interactivo: Sensores de orientación / Giroscopio
  btnOrientation.addEventListener('click', () => {
    // En iOS 13+ se requiere pedir permiso explícito
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(state => {
        if (state === 'granted') {
          attachOrientation();
        } else {
          orientResult.textContent = 'Permiso denegado por el usuario.';
        }
      }).catch(err => {
        orientResult.textContent = `Error: ${err.message}`;
      });
    } else if ('ondeviceorientation' in window) {
      attachOrientation();
    } else {
      orientResult.textContent = 'Giroscopio no disponible en este hardware.';
    }
  });

  function attachOrientation() {
    orientResult.textContent = 'Giroscopio activo. Mueve tu dispositivo.';
    window.addEventListener('deviceorientation', (e) => {
      const alpha = e.alpha ? e.alpha.toFixed(1) : '0';
      const beta = e.beta ? e.beta.toFixed(1) : '0';
      const gamma = e.gamma ? e.gamma.toFixed(1) : '0';
      orientResult.textContent = `α: ${alpha}° | β: ${beta}° | γ: ${gamma}°`;
    });
  }

  // 4. Benchmark mononúcleo en Rust WASM
  runBenchBtn.addEventListener('click', () => {
    if (!wasmInstance) return;
    benchResult.textContent = 'Ejecutando prueba en Rust WASM...';
    runBenchBtn.disabled = true;

    setTimeout(() => {
      const ITERATIONS = 20000000;
      const t0 = performance.now();
      wasmInstance.exports.bench_cpu_single_thread(ITERATIONS);
      const t1 = performance.now();
      const ms = (t1 - t0).toFixed(1);

      benchResult.textContent = `20M ciclos en ${ms} ms (Rust WASM)`;
      runBenchBtn.disabled = false;
    }, 40);
  });

  // 5. Modo inmersivo y Pantalla completa
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

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // 6. Fondo ambiental de telemetría suave
  function initAmbientCanvas() {
    const canvas = document.getElementById('telemetryCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0;

    function resizeCanvas() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function draw(now) {
      ctx.clearRect(0, 0, w, h);
      const t = now * 0.001;
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.04)';
      ctx.lineWidth = 1;

      // Rejilla de diagnóstico sutil
      const step = 45;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  }

  // Carga WASM
  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      console.log('✅ dispositivo_engine.wasm cargado.');
      inspectDevice();
    } catch (e) {
      console.error('Error al cargar WASM:', e);
      inspectDevice();
    }
  }

  initAmbientCanvas();
  initWasm();
})();

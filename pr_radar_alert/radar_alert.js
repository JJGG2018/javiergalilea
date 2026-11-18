/**
 * Subproyecto #14: Radar Alert Móvil & Tablet — Copiloto de Radares & Velocidad
 * Optimizado para smartphone y tableta en salpicadero (vertical, apaisado y HUD parabrisas)
 * Motor geodésico y direccional en Rust WebAssembly
 * javiergalilea.es/pr_radar_alert/
 */

(function () {
  'use strict';

  const CARTO_API_KEY = 'cb1_573d_1_8c20f8aa768b764e7c67f1c8';
  const MAX_GAUGE_SPEED = 200;

  // Datos y WASM
  let allRadars = [];
  let wasmInstance = null;
  let wasmMemory = null;
  let wasmLoaded = false;

  // Estado de conducción / telemetría
  let gpsActive = false;
  let demoActive = false;
  let geoWatchId = null;
  let demoTimerId = null;
  let wakeLockSentinel = null;

  let userCoords = null; // { lat, lng, accuracy }
  let lastGeoFix = null; // { lat, lng, time }
  let currentSpeedKmh = 0;
  let smoothedSpeedKmh = 0;
  let userHeadingDeg = 0;
  let hasHeading = false;

  // Preferencias de usuario
  let alertRadiusKm = 2.5;
  let audioMode = 'voice'; // 'voice' | 'beep' | 'mute'
  let coneMode = 'ahead';  // 'ahead' | 'all'
  let activeTacTab = 'sonar'; // 'sonar' | 'map'
  let autoCenterMap = true;
  let mirrorHud = false;

  // Estado de alertas / cooldowns
  let audioCtx = null;
  let lastBeepTime = 0;
  let lastVoiceTime = 0;
  let lastAnnouncedRadarId = null;
  let lastUrgentVoiceTime = 0;
  let lastVibrateTime = 0;

  // Estado del simulador Demo
  let demoSpeedKmh = 95;
  let demoWaypoints = [];
  let demoSegIdx = 0;
  let demoSegProgress = 0; // 0..1 dentro del segmento actual
  let demoLastTick = 0;

  // Leaflet
  let map = null;
  let mapInitialized = false;
  let mapRadarsLayer = null;
  let userMarker = null;
  let userPulseRing = null;

  // Sonar animación
  let sonarSweepAngle = 0;
  let sonarRafId = null;
  let lastComputedNearest = null;
  let lastTopFive = [];
  let lastInZoneCount = 0;

  // DOM
  const body = document.body;
  const cockpitMain = document.getElementById('cockpitMain');
  const gpsStatusPill = document.getElementById('gpsStatusPill');
  const gpsDot = document.getElementById('gpsDot');
  const gpsStatusText = document.getElementById('gpsStatusText');
  const wakePill = document.getElementById('wakePill');
  const wasmPill = document.getElementById('wasmPill');

  const demoBar = document.getElementById('demoBar');
  const demoRouteSelect = document.getElementById('demoRouteSelect');
  const demoSpeedSlider = document.getElementById('demoSpeedSlider');
  const demoSpeedReadout = document.getElementById('demoSpeedReadout');

  const gaugeFillArc = document.getElementById('gaugeFillArc');
  const speedNumber = document.getElementById('speedNumber');
  const headingBadge = document.getElementById('headingBadge');
  const accuracyBadge = document.getElementById('accuracyBadge');
  const limitCaption = document.getElementById('limitCaption');
  const activeLimitValue = document.getElementById('activeLimitValue');
  const speedDeltaBadge = document.getElementById('speedDeltaBadge');

  const nearestKindPill = document.getElementById('nearestKindPill');
  const nearestRoadPill = document.getElementById('nearestRoadPill');
  const nearestPkPill = document.getElementById('nearestPkPill');
  const nearestDirArrow = document.getElementById('nearestDirArrow');
  const nearestDirText = document.getElementById('nearestDirText');
  const nearestDistValue = document.getElementById('nearestDistValue');
  const nearestSubInfo = document.getElementById('nearestSubInfo');
  const nearestEtaValue = document.getElementById('nearestEtaValue');
  const approachBarFill = document.getElementById('approachBarFill');
  const nearestProvDir = document.getElementById('nearestProvDir');
  const radarsInZoneCount = document.getElementById('radarsInZoneCount');

  const tabSonarBtn = document.getElementById('tabSonarBtn');
  const tabMapBtn = document.getElementById('tabMapBtn');
  const sonarView = document.getElementById('sonarView');
  const mapView = document.getElementById('mapView');
  const sonarCanvas = document.getElementById('sonarCanvas');
  const autoCenterBtn = document.getElementById('autoCenterBtn');
  const scopeRangeBadge = document.getElementById('scopeRangeBadge');

  const nearbyList = document.getElementById('nearbyList');
  const nearbyModeLabel = document.getElementById('nearbyModeLabel');

  const gpsToggleBtn = document.getElementById('gpsToggleBtn');
  const gpsBtnText = document.getElementById('gpsBtnText');
  const demoToggleBtn = document.getElementById('demoToggleBtn');
  const demoBtnText = document.getElementById('demoBtnText');
  const audioModeBtn = document.getElementById('audioModeBtn');
  const audioModeIcon = document.getElementById('audioModeIcon');
  const audioModeText = document.getElementById('audioModeText');
  const coneFilterBtn = document.getElementById('coneFilterBtn');
  const coneFilterText = document.getElementById('coneFilterText');
  const radiusSelect = document.getElementById('radiusSelect');
  const mirrorHudBtn = document.getElementById('mirrorHudBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Inicializar longitud del arco SVG del velocímetro
  let gaugeTotalLen = 400;
  if (gaugeFillArc && typeof gaugeFillArc.getTotalLength === 'function') {
    gaugeTotalLen = gaugeFillArc.getTotalLength();
    gaugeFillArc.style.strokeDasharray = `${gaugeTotalLen} ${gaugeTotalLen}`;
    gaugeFillArc.style.strokeDashoffset = gaugeTotalLen;
  }

  // --- 1. INICIALIZACIÓN WASM Y DATOS DGT ---
  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      if (!res.ok) throw new Error('No se pudo cargar engine.wasm');
      const bytes = await res.arrayBuffer();
      const mod = await WebAssembly.instantiate(bytes);
      wasmInstance = mod.instance;
      wasmMemory = wasmInstance.exports.memory;
      wasmLoaded = true;
      console.log('✅ radar_alert engine.wasm cargado.');
    } catch (err) {
      console.warn('WASM no disponible, usando cálculo geodésico JS:', err);
      wasmLoaded = false;
      if (wasmPill) wasmPill.style.display = 'none';
    }
  }

  async function loadRadars() {
    try {
      const res = await fetch('radares.json');
      if (!res.ok) throw new Error('Error leyendo radares.json');
      allRadars = await res.json();
      allRadars.forEach((r, idx) => {
        r._origIdx = idx;
      });
      if (wasmLoaded && wasmInstance) {
        const reg = wasmInstance.exports.register_radar;
        const n = Math.min(allRadars.length, 1024);
        for (let i = 0; i < n; i++) {
          const r = allRadars[i];
          reg(i, r.lat, r.lng, r.pk || 0, r.type === 'tramo' ? 1 : 0, r.limit || 120);
        }
      }
      if (mapInitialized) renderMapRadars();
    } catch (err) {
      console.error(err);
      nearestSubInfo.textContent = 'Error cargando la base oficial DGT.';
    }
  }

  // --- 2. UTILIDADES GEODÉSICAS (WASM + FALLBACK JS) ---
  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function jsBearingDeg(lat1, lon1, lat2, lon2) {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const y = Math.sin(dLon) * Math.cos(phi2);
    const x =
      Math.cos(phi1) * Math.sin(phi2) -
      Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
    let deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  function jsAngleDiffDeg(a, b) {
    let diff = b - a;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return diff;
  }

  function calcDistanceKm(lat1, lng1, lat2, lng2) {
    if (wasmLoaded && wasmInstance) {
      return wasmInstance.exports.distance_km(lat1, lng1, lat2, lng2);
    }
    return haversineKm(lat1, lng1, lat2, lng2);
  }

  function calcBearingDeg(lat1, lng1, lat2, lng2) {
    if (wasmLoaded && wasmInstance) {
      return wasmInstance.exports.bearing_deg(lat1, lng1, lat2, lng2);
    }
    return jsBearingDeg(lat1, lng1, lat2, lng2);
  }

  function calcAngleDiff(heading, bearing) {
    if (wasmLoaded && wasmInstance) {
      return wasmInstance.exports.angle_diff_deg(heading, bearing);
    }
    return jsAngleDiffDeg(heading, bearing);
  }

  function formatDistance(km) {
    if (km < 1) {
      const m = Math.max(5, Math.round((km * 1000) / 10) * 10);
      return `${m} m`;
    }
    return `${km.toFixed(2)} km`;
  }

  function formatEta(distKm, speedKmh) {
    const sec =
      wasmLoaded && wasmInstance
        ? wasmInstance.exports.eta_seconds(distKm, speedKmh)
        : distKm > 0 && speedKmh >= 5
        ? (distKm / speedKmh) * 3600
        : -1;
    if (sec < 0 || !isFinite(sec)) return '--';
    if (sec < 60) return `~${Math.max(1, Math.round(sec))} s`;
    const mins = Math.round(sec / 60);
    return `~${mins} min`;
  }

  function cardinalLabel(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
    return dirs[Math.round(((deg % 360) / 45)) % 8];
  }

  // --- 3. CÁLCULO PRINCIPAL DE PROXIMIDAD Y DIRECCIÓN ---
  function evaluateRadars() {
    if (!userCoords || allRadars.length === 0) return;

    const total = Math.min(allRadars.length, 1024);
    let sorted = [];
    let inZoneCount = 0;

    if (wasmLoaded && wasmInstance) {
      const exp = wasmInstance.exports;
      const n = exp.sort_by_proximity(userCoords.lat, userCoords.lng, total);
      const idxs = new Uint16Array(wasmMemory.buffer, exp.get_result_indices_ptr(), n);
      const dists = new Float32Array(wasmMemory.buffer, exp.get_result_distances_ptr(), n);
      const bears = new Float32Array(wasmMemory.buffer, exp.get_result_bearings_ptr(), n);
      inZoneCount = exp.count_radars_within_radius(
        userCoords.lat,
        userCoords.lng,
        total,
        alertRadiusKm
      );

      for (let i = 0; i < Math.min(n, 40); i++) {
        const origIdx = idxs[i];
        const r = allRadars[origIdx];
        const distKm = dists[origIdx];
        const bearing = bears[origIdx];
        const relAngle = hasHeading ? calcAngleDiff(userHeadingDeg, bearing) : 0;
        sorted.push({
          radar: r,
          distKm,
          bearing,
          relAngle,
          isAhead: !hasHeading || Math.abs(relAngle) <= 68
        });
      }
    } else {
      const list = allRadars.map(r => {
        const distKm = haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng);
        const bearing = jsBearingDeg(userCoords.lat, userCoords.lng, r.lat, r.lng);
        const relAngle = hasHeading ? jsAngleDiffDeg(userHeadingDeg, bearing) : 0;
        if (distKm <= alertRadiusKm) inZoneCount++;
        return {
          radar: r,
          distKm,
          bearing,
          relAngle,
          isAhead: !hasHeading || Math.abs(relAngle) <= 68
        };
      });
      list.sort((a, b) => a.distKm - b.distKm);
      sorted = list.slice(0, 40);
    }

    lastInZoneCount = inZoneCount;

    // Seleccionar radar protagonista según filtro (Adelante vs 360°)
    let primary = null;
    if (coneMode === 'ahead' && hasHeading) {
      primary = sorted.find(item => item.isAhead) || sorted[0] || null;
    } else {
      primary = sorted[0] || null;
    }

    // Top 5 para la lista (priorizando los de delante si el modo está activo)
    if (coneMode === 'ahead' && hasHeading) {
      const aheadOnes = sorted.filter(x => x.isAhead);
      const rest = sorted.filter(x => !x.isAhead);
      lastTopFive = [...aheadOnes, ...rest].slice(0, 5);
    } else {
      lastTopFive = sorted.slice(0, 5);
    }

    lastComputedNearest = primary;
    updateHudDisplay(primary, sorted);
    renderNearbyList();

    if (mapInitialized && activeTacTab === 'map') {
      updateUserOnMap();
    }
  }

  // --- 4. ACTUALIZACIÓN DEL HUD, VELOCÍMETRO Y ALERTAS ---
  function updateHudDisplay(primary, nearbyCandidates) {
    // 1. Velocímetro y arco SVG
    const dispSpeed = Math.round(smoothedSpeedKmh);
    speedNumber.textContent = dispSpeed;
    headingBadge.textContent = hasHeading
      ? `🧭 ${Math.round(userHeadingDeg)}° ${cardinalLabel(userHeadingDeg)}`
      : '🧭 ---°';

    if (demoActive) {
      accuracyBadge.textContent = '· Ruta simulada';
    } else if (userCoords && userCoords.accuracy) {
      accuracyBadge.textContent = `· ±${Math.round(userCoords.accuracy)}m`;
    }

    const activeLimit = primary ? primary.radar.limit || 120 : 120;
    activeLimitValue.textContent = activeLimit;
    limitCaption.textContent = primary ? `LÍMITE ${primary.radar.road}` : 'LÍMITE REF.';

    const inAlertZone = primary && primary.distKm <= alertRadiusKm;
    const isCriticalDist = primary && primary.distKm <= 0.5;
    const delta = dispSpeed - activeLimit;
    const isOverspeed = dispSpeed > activeLimit && (inAlertZone || dispSpeed > activeLimit + 5);

    // Estado visual global
    body.classList.remove('state-idle', 'state-safe', 'state-caution', 'state-danger');
    if (isOverspeed) {
      body.classList.add('state-danger');
      gaugeFillArc.setAttribute('stroke', 'url(#gaugeGradDanger)');
      speedDeltaBadge.className = 'speed-delta-badge danger';
      speedDeltaBadge.textContent = `+${delta} km/h ¡REDUCE!`;
    } else if (inAlertZone) {
      body.classList.add('state-caution');
      gaugeFillArc.setAttribute('stroke', 'url(#gaugeGradCaution)');
      speedDeltaBadge.className = 'speed-delta-badge caution';
      speedDeltaBadge.textContent =
        delta === 0 ? 'En el límite' : `${delta} km/h bajo límite`;
    } else {
      body.classList.add('state-safe');
      gaugeFillArc.setAttribute('stroke', 'url(#gaugeGradSafe)');
      speedDeltaBadge.className = 'speed-delta-badge safe';
      speedDeltaBadge.textContent =
        dispSpeed > 0 ? 'Velocidad segura ✅' : 'En espera';
    }

    const ratio = Math.max(0, Math.min(1, dispSpeed / MAX_GAUGE_SPEED));
    gaugeFillArc.style.strokeDashoffset = gaugeTotalLen * (1 - ratio);

    // 2. Tarjeta del radar más cercano
    radarsInZoneCount.textContent = `${lastInZoneCount} en radio (${alertRadiusKm} km)`;

    if (!primary) {
      nearestKindPill.textContent = '📡 BUSCANDO';
      nearestDistValue.textContent = '--';
      nearestSubInfo.textContent = 'Sin datos GPS activos.';
      nearestEtaValue.textContent = '--';
      approachBarFill.style.width = '0%';
      return;
    }

    const r = primary.radar;
    const isTramo = r.type === 'tramo';
    nearestKindPill.className = `radar-kind-pill ${isTramo ? 'tramo' : 'fixed'}`;
    nearestKindPill.textContent = isTramo ? '📏 RADAR TRAMO' : '📸 RADAR FIJO';
    nearestRoadPill.textContent = r.road || 'Vía';
    nearestPkPill.textContent = `PK ${r.pk}`;

    // Flecha relativa respecto al rumbo
    nearestDirArrow.style.transform = `rotate(${Math.round(primary.relAngle)}deg)`;
    if (!hasHeading) {
      nearestDirText.textContent = `${cardinalLabel(primary.bearing)}`;
    } else if (Math.abs(primary.relAngle) <= 45) {
      nearestDirText.textContent = 'DELANTE';
    } else if (Math.abs(primary.relAngle) <= 120) {
      nearestDirText.textContent = primary.relAngle > 0 ? 'DERECHA' : 'IZQUIERDA';
    } else {
      nearestDirText.textContent = 'DETRÁS';
    }

    nearestDistValue.textContent = formatDistance(primary.distKm);
    nearestEtaValue.textContent = formatEta(primary.distKm, dispSpeed);

    if (isOverspeed) {
      nearestSubInfo.innerHTML = `<strong style="color:#fca5a5;">¡EXCESO DE VELOCIDAD!</strong> Límite ${activeLimit} km/h · ${r.dir}`;
    } else if (inAlertZone) {
      nearestSubInfo.innerHTML = `<strong style="color:#fcd34d;">Cinemómetro próximo</strong> · Sentido ${r.dir}`;
    } else {
      nearestSubInfo.textContent = `Radar más cercano · Sentido ${r.dir}`;
    }

    nearestProvDir.textContent = `${r.prov} · ${isTramo ? 'Velocidad media de tramo' : 'Cabina / pórtico DGT'}`;

    // Barra de acercamiento (0% fuera de radio, 100% encima del radar)
    const maxTrackKm = Math.max(alertRadiusKm, 3);
    const pct = Math.max(0, Math.min(100, (1 - primary.distKm / maxTrackKm) * 100));
    approachBarFill.style.width = `${pct.toFixed(1)}%`;

    // 3. Disparar avisos sonoros, voz y hápticos
    triggerAlerts(primary, inAlertZone, isCriticalDist, isOverspeed, activeLimit);

    // Guardar candidatos para el Sonar Canvas
    window.__radarAlertCandidates = nearbyCandidates;
  }

  function renderNearbyList() {
    if (!lastTopFive || lastTopFive.length === 0) {
      nearbyList.innerHTML = `<li class="nearby-empty">No hay radares cargados todavía.</li>`;
      return;
    }

    nearbyList.innerHTML = lastTopFive
      .map((item, idx) => {
        const r = item.radar;
        const isTramo = r.type === 'tramo';
        const icon = isTramo ? '📏' : '📸';
        const rot = Math.round(item.relAngle);
        const relBadge = hasHeading
          ? Math.abs(item.relAngle) <= 68
            ? 'Delante'
            : 'Lateral/Atrás'
          : cardinalLabel(item.bearing);
        return `
          <li class="nearby-item ${idx === 0 ? 'is-closest' : ''}" data-radar-idx="${r._origIdx}">
            <div class="nearby-item-left">
              <div class="nearby-arrow-box" style="transform: rotate(${rot}deg);" title="Dirección relativa">▲</div>
              <div class="nearby-item-info">
                <div class="nearby-item-title">${icon} ${r.road} · PK ${r.pk} <span style="opacity:0.65;font-weight:500;">(${relBadge})</span></div>
                <div class="nearby-item-meta">${r.prov} · ${r.dir}</div>
              </div>
            </div>
            <div class="nearby-item-right">
              <div class="mini-limit-sign">${r.limit || 120}</div>
              <div class="nearby-item-dist">${formatDistance(item.distKm)}</div>
            </div>
          </li>
        `;
      })
      .join('');

    nearbyList.querySelectorAll('.nearby-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.radarIdx, 10);
        const radar = allRadars[idx];
        if (!radar) return;
        switchTacTab('map');
        autoCenterMap = false;
        autoCenterBtn.classList.remove('active');
        if (map) {
          map.flyTo([radar.lat, radar.lng], 14, { duration: 0.8 });
        }
      });
    });
  }

  // --- 5. AVISOS SONOROS (WEB AUDIO), VOZ (SPEECH API) Y VIBRACIÓN ---
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) audioCtx = new AudioCtx();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (e) {
      console.warn('AudioContext:', e);
    }
  }

  function playBeep(urgent) {
    if (audioMode === 'mute') return;
    const now = Date.now();
    const cooldown = urgent ? 3200 : 9000;
    if (now - lastBeepTime < cooldown) return;
    lastBeepTime = now;

    try {
      unlockAudio();
      if (!audioCtx) return;

      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      if (urgent) {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(1046, t);
        osc.frequency.setValueAtTime(1396, t + 0.11);
        osc.frequency.setValueAtTime(1046, t + 0.22);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.28, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.36);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.37);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(784, t);
        osc.frequency.exponentialRampToValueAtTime(1174, t + 0.14);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(0.2, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.28);
      }
    } catch (e) {
      console.warn('Beep error:', e);
    }
  }

  function speakAlert(text, urgent = false) {
    if (audioMode !== 'voice' || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (urgent) {
      if (now - lastUrgentVoiceTime < 8500) return;
      lastUrgentVoiceTime = now;
    } else {
      if (now - lastVoiceTime < 10000) return;
      lastVoiceTime = now;
    }

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'es-ES';
      utter.rate = urgent ? 1.08 : 1.02;
      utter.pitch = urgent ? 1.05 : 1.0;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn('SpeechSynthesis error:', e);
    }
  }

  function triggerAlerts(primary, inAlertZone, isCriticalDist, isOverspeed, limit) {
    const r = primary.radar;

    if (isOverspeed) {
      playBeep(true);
      speakAlert(`Atención, exceso de velocidad. Reduzca a ${limit}.`, true);
      if (navigator.vibrate && Date.now() - lastVibrateTime > 4000) {
        navigator.vibrate([160, 80, 160]);
        lastVibrateTime = Date.now();
      }
      return;
    }

    if (inAlertZone && (coneMode === 'all' || primary.isAhead)) {
      playBeep(isCriticalDist);
      if (lastAnnouncedRadarId !== r.id || isCriticalDist) {
        const distTxt =
          primary.distKm < 1
            ? `${Math.max(50, Math.round((primary.distKm * 1000) / 50) * 50)} metros`
            : `${primary.distKm.toFixed(1)} kilómetros`;
        const tipoTxt = r.type === 'tramo' ? 'radar de tramo' : 'radar fijo';
        if (lastAnnouncedRadarId !== r.id) {
          speakAlert(`Atención, ${tipoTxt} en ${r.road} a ${distTxt}, límite ${limit}.`, false);
          lastAnnouncedRadarId = r.id;
        }
      }
      if (isCriticalDist && navigator.vibrate && Date.now() - lastVibrateTime > 7000) {
        navigator.vibrate([120]);
        lastVibrateTime = Date.now();
      }
    } else if (primary.distKm > alertRadiusKm + 0.4) {
      lastAnnouncedRadarId = null;
    }
  }

  // --- 6. GPS REAL Y WAKE LOCK ---
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakePill.style.display = 'inline-flex';
      wakeLockSentinel.addEventListener('release', () => {
        wakePill.style.display = 'none';
      });
    } catch (e) {
      console.warn('WakeLock no disponible:', e);
    }
  }

  function releaseWakeLock() {
    if (wakeLockSentinel) {
      wakeLockSentinel.release().catch(() => {});
      wakeLockSentinel = null;
    }
    wakePill.style.display = 'none';
  }

  function handleGeoFix(pos) {
    const c = pos.coords;
    const now = Date.now();

    let rawSpeed = 0;
    if (c.speed !== null && !isNaN(c.speed) && c.speed >= 0) {
      rawSpeed = c.speed * 3.6;
    } else if (lastGeoFix) {
      const dt = (now - lastGeoFix.time) / 1000;
      if (dt >= 0.8 && dt <= 20) {
        const dKm = calcDistanceKm(lastGeoFix.lat, lastGeoFix.lng, c.latitude, c.longitude);
        const calc = (dKm / dt) * 3600;
        if (calc >= 3 && calc <= 250) rawSpeed = calc;
      }
    }

    // Suavizado exponencial (EMA) para evitar saltos en móvil
    currentSpeedKmh = rawSpeed;
    smoothedSpeedKmh =
      smoothedSpeedKmh === 0 ? rawSpeed : smoothedSpeedKmh * 0.45 + rawSpeed * 0.55;
    if (smoothedSpeedKmh < 2.5) smoothedSpeedKmh = 0;

    // Rumbo del vehículo
    if (c.heading !== null && !isNaN(c.heading) && c.heading >= 0 && rawSpeed >= 4) {
      userHeadingDeg = c.heading;
      hasHeading = true;
    } else if (lastGeoFix) {
      const movedKm = calcDistanceKm(lastGeoFix.lat, lastGeoFix.lng, c.latitude, c.longitude);
      if (movedKm > 0.012) {
        userHeadingDeg = calcBearingDeg(lastGeoFix.lat, lastGeoFix.lng, c.latitude, c.longitude);
        hasHeading = true;
      }
    }

    lastGeoFix = { lat: c.latitude, lng: c.longitude, time: now };
    userCoords = {
      lat: c.latitude,
      lng: c.longitude,
      accuracy: c.accuracy || 25
    };

    gpsDot.className = 'status-dot online';
    gpsStatusText.textContent = `GPS ±${Math.round(userCoords.accuracy)}m`;

    evaluateRadars();
  }

  function startGps() {
    if (!navigator.geolocation) {
      alert('Tu dispositivo o navegador no soporta geolocalización GPS.');
      return;
    }
    if (demoActive) stopDemo();

    unlockAudio();
    requestWakeLock();

    gpsActive = true;
    gpsToggleBtn.classList.add('gps-active');
    gpsBtnText.textContent = 'Pausar GPS';
    gpsDot.className = 'status-dot demo';
    gpsStatusText.textContent = 'Buscando señal...';

    geoWatchId = navigator.geolocation.watchPosition(
      handleGeoFix,
      err => {
        console.warn('Error GPS:', err.message);
        gpsDot.className = 'status-dot error';
        gpsStatusText.textContent = 'Sin permiso GPS';
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
  }

  function stopGps() {
    gpsActive = false;
    if (geoWatchId !== null) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }
    gpsToggleBtn.classList.remove('gps-active');
    gpsBtnText.textContent = 'Iniciar GPS';
    if (!demoActive) {
      releaseWakeLock();
      gpsDot.className = 'status-dot';
      gpsStatusText.textContent = 'GPS en espera';
    }
  }

  // --- 7. SIMULADOR DEMO EN RUTA (PARA PROBAR EN CASA / TABLET / DESKTOP) ---
  function buildDemoWaypoints(corridorKey) {
    let subset = [];
    if (corridorKey === 'a1') {
      subset = allRadars
        .filter(r => r.road === 'A-1' && r.prov.includes('MADRID'))
        .sort((a, b) => a.pk - b.pk);
    } else if (corridorKey === 'm40') {
      subset = allRadars.filter(r => r.road === 'M-40').sort((a, b) => a.pk - b.pk);
    } else if (corridorKey === 'a7') {
      subset = allRadars
        .filter(r => r.road === 'A-7' && r.prov.includes('MÁLAGA'))
        .sort((a, b) => a.pk - b.pk);
    } else if (corridorKey === 'z40') {
      subset = allRadars.filter(r => r.road === 'Z-40').sort((a, b) => a.pk - b.pk);
    }

    if (subset.length < 2) {
      subset = allRadars.slice(0, 6);
    }

    // Quitar duplicados exactamente iguales de coordenadas
    const unique = [];
    for (const r of subset) {
      const prev = unique[unique.length - 1];
      if (!prev || calcDistanceKm(prev.lat, prev.lng, r.lat, r.lng) > 0.25) {
        unique.push({ lat: r.lat, lng: r.lng });
      }
    }

    // Añadir punto de inicio 1.3 km antes del primer radar en dirección opuesta al primer tramo
    if (unique.length >= 2) {
      const p0 = unique[0];
      const p1 = unique[1];
      const dLat = p1.lat - p0.lat;
      const dLng = p1.lng - p0.lng;
      const dist = Math.max(0.01, calcDistanceKm(p0.lat, p0.lng, p1.lat, p1.lng));
      const factor = 1.3 / dist;
      unique.unshift({
        lat: p0.lat - dLat * factor,
        lng: p0.lng - dLng * factor
      });
    }
    return unique;
  }

  function tickDemo() {
    if (!demoActive || demoWaypoints.length < 2) return;
    const now = Date.now();
    const dtSec = Math.min(0.5, (now - demoLastTick) / 1000);
    demoLastTick = now;

    const pA = demoWaypoints[demoSegIdx];
    const pB = demoWaypoints[(demoSegIdx + 1) % demoWaypoints.length];
    const segKm = Math.max(0.05, calcDistanceKm(pA.lat, pA.lng, pB.lat, pB.lng));

    // Velocidad de demo en km/s
    const kmMoved = (demoSpeedKmh / 3600) * dtSec * 1.4; // ligero factor para fluidez de prueba
    demoSegProgress += kmMoved / segKm;

    if (demoSegProgress >= 1) {
      demoSegProgress = 0;
      demoSegIdx = (demoSegIdx + 1) % (demoWaypoints.length - 1);
    }

    const curA = demoWaypoints[demoSegIdx];
    const curB = demoWaypoints[demoSegIdx + 1];
    const lat = curA.lat + (curB.lat - curA.lat) * demoSegProgress;
    const lng = curA.lng + (curB.lng - curA.lng) * demoSegProgress;

    userHeadingDeg = calcBearingDeg(curA.lat, curA.lng, curB.lat, curB.lng);
    hasHeading = true;
    currentSpeedKmh = demoSpeedKmh;
    smoothedSpeedKmh = demoSpeedKmh;
    userCoords = { lat, lng, accuracy: 8 };

    evaluateRadars();
  }

  function startDemo() {
    if (allRadars.length === 0) return;
    if (gpsActive) stopGps();

    unlockAudio();
    requestWakeLock();

    demoWaypoints = buildDemoWaypoints(demoRouteSelect.value);
    demoSegIdx = 0;
    demoSegProgress = 0;
    demoLastTick = Date.now();
    demoActive = true;

    demoBar.style.display = 'flex';
    demoToggleBtn.classList.add('demo-active');
    demoBtnText.textContent = 'Parar Demo';
    gpsDot.className = 'status-dot demo';
    gpsStatusText.textContent = 'DEMO ACTIVA';

    tickDemo();
    demoTimerId = setInterval(tickDemo, 220);
  }

  function stopDemo() {
    demoActive = false;
    if (demoTimerId) {
      clearInterval(demoTimerId);
      demoTimerId = null;
    }
    demoBar.style.display = 'none';
    demoToggleBtn.classList.remove('demo-active');
    demoBtnText.textContent = 'Demo Ruta';
    if (!gpsActive) {
      releaseWakeLock();
      gpsDot.className = 'status-dot';
      gpsStatusText.textContent = 'GPS en espera';
    }
  }

  // --- 8. VISOR TÁCTICO 1: SONAR RADAR CANVAS (HEADING-UP) ---
  function drawSonarFrame() {
    if (activeTacTab === 'sonar' && sonarCanvas) {
      const rect = sonarCanvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(200, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));

      if (sonarCanvas.width !== w * dpr || sonarCanvas.height !== h * dpr) {
        sonarCanvas.width = w * dpr;
        sonarCanvas.height = h * dpr;
      }

      const ctx = sonarCanvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Fondo oscuro táctico
      ctx.fillStyle = '#04070e';
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.52;
      const maxR = Math.min(w, h) * 0.43;

      // Cono frontal de detección (136°)
      if (coneMode === 'ahead') {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        const startA = -Math.PI / 2 - (68 * Math.PI) / 180;
        const endA = -Math.PI / 2 + (68 * Math.PI) / 180;
        ctx.arc(cx, cy, maxR, startA, endA);
        ctx.closePath();
        const coneGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, maxR);
        coneGrad.addColorStop(0, 'rgba(0, 245, 212, 0.22)');
        coneGrad.addColorStop(1, 'rgba(0, 245, 212, 0.03)');
        ctx.fillStyle = coneGrad;
        ctx.fill();
        ctx.restore();
      }

      // Anillos de distancia concéntricos
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.16)';
      ctx.lineWidth = 1;
      for (const f of [0.33, 0.66, 1.0]) {
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * f, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ejes N/S/E/O relativos
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // Etiquetas de escala de distancia
      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.font = '600 10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      const maxScopeKm = Math.max(alertRadiusKm, 3.0);
      ctx.fillText(`${(maxScopeKm * 0.5).toFixed(1)} km`, cx + 4, cy - maxR * 0.5 + 3);
      ctx.fillText(`${maxScopeKm.toFixed(1)} km`, cx + 4, cy - maxR + 10);

      // Barrido rotatorio suave
      sonarSweepAngle = (sonarSweepAngle + 0.038) % (Math.PI * 2);
      const sweepGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      sweepGrad.addColorStop(0, 'rgba(0, 245, 212, 0.02)');
      sweepGrad.addColorStop(1, 'rgba(0, 245, 212, 0.2)');
      ctx.fillStyle = sweepGrad;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, sonarSweepAngle - 0.55, sonarSweepAngle);
      ctx.closePath();
      ctx.fill();

      // Blips de radares reales dentro del rango del sonar
      const candidates = window.__radarAlertCandidates || [];
      for (let i = 0; i < candidates.length; i++) {
        const item = candidates[i];
        if (item.distKm > maxScopeKm * 1.15) continue;

        const normDist = Math.min(1.0, item.distKm / maxScopeKm);
        const angleRad = ((item.relAngle - 90) * Math.PI) / 180;
        const bx = cx + Math.cos(angleRad) * (normDist * maxR);
        const by = cy + Math.sin(angleRad) * (normDist * maxR);

        const isTramo = item.radar.type === 'tramo';
        const isPrimary =
          lastComputedNearest && lastComputedNearest.radar.id === item.radar.id;
        const baseColor = isTramo ? '#f59e0b' : '#ef4444';

        if (isPrimary) {
          const pulse = 8 + Math.sin(Date.now() * 0.008) * 3;
          ctx.strokeStyle = isTramo ? 'rgba(245,158,11,0.65)' : 'rgba(239,68,68,0.75)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(bx, by, pulse, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(bx, by, isPrimary ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fill();

        // Etiqueta de vía + límite en radares muy próximos
        if (isPrimary || i < 4) {
          ctx.fillStyle = '#f8fafc';
          ctx.font = '700 10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(
            `${item.radar.road} (${item.radar.limit || 120})`,
            bx,
            by - 9
          );
        }
      }

      // Vehículo en el centro (triángulo apuntando hacia arriba)
      ctx.fillStyle = '#00f5d4';
      ctx.beginPath();
      ctx.moveTo(cx, cy - 8);
      ctx.lineTo(cx - 6, cy + 6);
      ctx.lineTo(cx + 6, cy + 6);
      ctx.closePath();
      ctx.fill();
    }

    sonarRafId = requestAnimationFrame(drawSonarFrame);
  }

  // --- 9. VISOR TÁCTICO 2: MAPA LIVE LEAFLET ---
  function initMap() {
    if (mapInitialized || typeof L === 'undefined') return;
    map = L.map('mapContainer', {
      center: userCoords ? [userCoords.lat, userCoords.lng] : [40.4168, -3.7038],
      zoom: userCoords ? 13 : 6,
      zoomControl: false,
      preferCanvas: true
    });

    const darkTiles = L.tileLayer(
      `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`,
      {
        attribution: '&copy; CARTO &copy; OSM · DGT',
        subdomains: 'abcd',
        maxNativeZoom: 20,
        maxZoom: 21
      }
    );

    const satTiles = L.tileLayer(
      'https://{s}.google.com/vt/lyrs=y&hl=es&x={x}&y={y}&z={z}',
      {
        attribution: '&copy; Google Satélite · DGT',
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        maxNativeZoom: 20,
        maxZoom: 21
      }
    );

    darkTiles.addTo(map);
    L.control.layers({ '🌃 Oscuro HD': darkTiles, '🛰️ Satélite': satTiles }, null, { position: 'topright' }).addTo(map);

    mapRadarsLayer = L.layerGroup().addTo(map);
    mapInitialized = true;
    renderMapRadars();
    updateUserOnMap();
  }

  function renderMapRadars() {
    if (!map || !mapRadarsLayer) return;
    mapRadarsLayer.clearLayers();

    allRadars.forEach(r => {
      const isTramo = r.type === 'tramo';
      if (isTramo && r.latEnd && r.lngEnd) {
        L.polyline(
          [
            [r.lat, r.lng],
            [r.latEnd, r.lngEnd]
          ],
          { color: '#f59e0b', weight: 4, opacity: 0.85, dashArray: '6, 6' }
        ).addTo(mapRadarsLayer);
      }
      const m = L.circleMarker([r.lat, r.lng], {
        radius: isTramo ? 5.5 : 6,
        fillColor: isTramo ? '#f59e0b' : '#ef4444',
        color: '#ffffff',
        weight: 1.5,
        fillOpacity: 0.9
      });
      m.bindPopup(
        `<strong>${isTramo ? '📏 Tramo' : '📸 Fijo'} ${r.road} PK ${r.pk}</strong><br>Límite: <strong>${r.limit || 120} km/h</strong> · ${r.dir}`
      );
      m.addTo(mapRadarsLayer);
    });
  }

  function updateUserOnMap() {
    if (!map || !userCoords) return;

    const arrowSvg = `
      <div class="user-heading-arrow" style="transform: rotate(${Math.round(userHeadingDeg)}deg);">
        <svg viewBox="0 0 32 32" width="28" height="28">
          <polygon points="16,2 27,28 16,22 5,28" fill="#00f5d4" stroke="#05070d" stroke-width="2"/>
        </svg>
      </div>
    `;
    const icon = L.divIcon({
      className: 'user-heading-marker',
      html: arrowSvg,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    if (!userMarker) {
      userMarker = L.marker([userCoords.lat, userCoords.lng], { icon, zIndexOffset: 2000 }).addTo(map);
    } else {
      userMarker.setLatLng([userCoords.lat, userCoords.lng]);
      userMarker.setIcon(icon);
    }

    if (!userPulseRing) {
      userPulseRing = L.circle([userCoords.lat, userCoords.lng], {
        radius: alertRadiusKm * 1000,
        color: '#00f5d4',
        fillColor: '#00f5d4',
        fillOpacity: 0.05,
        weight: 1.2,
        dashArray: '5, 5'
      }).addTo(map);
    } else {
      userPulseRing.setLatLng([userCoords.lat, userCoords.lng]);
      userPulseRing.setRadius(alertRadiusKm * 1000);
    }

    if (autoCenterMap) {
      map.setView([userCoords.lat, userCoords.lng], Math.max(map.getZoom(), 13), { animate: true });
    }
  }

  function switchTacTab(tab) {
    activeTacTab = tab;
    if (tab === 'sonar') {
      tabSonarBtn.classList.add('active');
      tabMapBtn.classList.remove('active');
      sonarView.style.display = 'flex';
      mapView.style.display = 'none';
    } else {
      tabMapBtn.classList.add('active');
      tabSonarBtn.classList.remove('active');
      sonarView.style.display = 'none';
      mapView.style.display = 'block';
      if (!mapInitialized) {
        initMap();
      } else {
        setTimeout(() => map.invalidateSize(), 120);
        updateUserOnMap();
      }
    }
  }

  // --- 10. EVENTOS DE INTERFAZ ---
  function setupEvents() {
    gpsToggleBtn.addEventListener('click', () => {
      if (gpsActive) stopGps();
      else startGps();
    });

    demoToggleBtn.addEventListener('click', () => {
      if (demoActive) stopDemo();
      else startDemo();
    });

    demoRouteSelect.addEventListener('change', () => {
      if (demoActive) {
        demoWaypoints = buildDemoWaypoints(demoRouteSelect.value);
        demoSegIdx = 0;
        demoSegProgress = 0;
        lastAnnouncedRadarId = null;
        tickDemo();
      }
    });

    demoSpeedSlider.addEventListener('input', () => {
      demoSpeedKmh = parseInt(demoSpeedSlider.value, 10) || 0;
      demoSpeedReadout.textContent = `${demoSpeedKmh} km/h`;
      if (demoActive) tickDemo();
    });

    audioModeBtn.addEventListener('click', () => {
      unlockAudio();
      if (audioMode === 'voice') {
        audioMode = 'beep';
        audioModeBtn.className = 'dock-btn audio-beep';
        audioModeIcon.textContent = '🔔';
        audioModeText.textContent = 'Solo Pitidos';
        playBeep(false);
      } else if (audioMode === 'beep') {
        audioMode = 'mute';
        audioModeBtn.className = 'dock-btn audio-muted';
        audioModeIcon.textContent = '🔇';
        audioModeText.textContent = 'Silencio';
      } else {
        audioMode = 'voice';
        audioModeBtn.className = 'dock-btn audio-voice';
        audioModeIcon.textContent = '🔊';
        audioModeText.textContent = 'Voz + Pitidos';
        speakAlert('Avisos por voz activados.', false);
      }
    });

    coneFilterBtn.addEventListener('click', () => {
      if (coneMode === 'ahead') {
        coneMode = 'all';
        coneFilterBtn.classList.remove('active-soft');
        coneFilterText.textContent = '360° Todos';
        nearbyModeLabel.textContent = 'Modo: 360° alrededor';
      } else {
        coneMode = 'ahead';
        coneFilterBtn.classList.add('active-soft');
        coneFilterText.textContent = 'Adelante';
        nearbyModeLabel.textContent = 'Prioridad: en tu sentido';
      }
      evaluateRadars();
    });

    radiusSelect.addEventListener('change', () => {
      alertRadiusKm = parseFloat(radiusSelect.value) || 2.5;
      scopeRangeBadge.textContent = `Radio ${alertRadiusKm} km`;
      evaluateRadars();
    });

    tabSonarBtn.addEventListener('click', () => switchTacTab('sonar'));
    tabMapBtn.addEventListener('click', () => switchTacTab('map'));

    autoCenterBtn.addEventListener('click', () => {
      autoCenterMap = !autoCenterMap;
      autoCenterBtn.classList.toggle('active', autoCenterMap);
      if (autoCenterMap && map && userCoords) {
        map.setView([userCoords.lat, userCoords.lng], 13);
      }
    });

    mirrorHudBtn.addEventListener('click', () => {
      mirrorHud = !mirrorHud;
      cockpitMain.classList.toggle('hud-mirror', mirrorHud);
      mirrorHudBtn.classList.toggle('active-soft', mirrorHud);
    });

    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (gpsActive || demoActive)) {
        requestWakeLock();
      }
    });
  }

  // --- 11. INSTALACIÓN COMO APP (PWA + SERVICE WORKER OFFLINE) ---
  function initPwaInstall() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('Service Worker no registrado:', err);
      });
    }

    const installAppBtn = document.getElementById('installAppBtn');
    const installModal = document.getElementById('installModal');
    const installModalBackdrop = document.getElementById('installModalBackdrop');
    const installModalCloseBtn = document.getElementById('installModalCloseBtn');
    const installModalBody = document.getElementById('installModalBody');

    if (!installAppBtn || !installModal) return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    if (isStandalone) {
      installAppBtn.style.display = 'none';
      return;
    }

    let deferredPrompt = null;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // En iOS/iPadOS Safari no existe beforeinstallprompt, mostramos el botón con guía directa
    if (isIos) {
      installAppBtn.style.display = 'inline-flex';
    }

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      installAppBtn.style.display = 'inline-flex';
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      installAppBtn.style.display = 'none';
      installModal.style.display = 'none';
    });

    function openInstallGuide() {
      if (isIos) {
        installModalBody.innerHTML = `
          <div class="install-step">
            <span class="install-step-num">1</span>
            <div>Pulsa el botón <strong>Compartir</strong> (cuadrado con flecha hacia arriba ⬆️) en la barra de Safari.</div>
          </div>
          <div class="install-step">
            <span class="install-step-num">2</span>
            <div>Desliza hacia abajo y toca <strong>«Añadir a pantalla de inicio»</strong> (o «Agregar a inicio»).</div>
          </div>
          <div class="install-step">
            <span class="install-step-num">3</span>
            <div>Ábrela desde el nuevo icono en tu iPhone o iPad: funcionará a pantalla completa e incluso sin cobertura.</div>
          </div>
        `;
      } else {
        installModalBody.innerHTML = `
          <div class="install-step">
            <span class="install-step-num">1</span>
            <div>Abre el menú del navegador (<strong>⋮</strong> en Chrome/Android o barra de direcciones en escritorio).</div>
          </div>
          <div class="install-step">
            <span class="install-step-num">2</span>
            <div>Selecciona <strong>«Instalar aplicación»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</div>
          </div>
        `;
      }
      installModal.style.display = 'flex';
    }

    installAppBtn.addEventListener('click', async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          installAppBtn.style.display = 'none';
        }
        deferredPrompt = null;
      } else {
        openInstallGuide();
      }
    });

    const closeInstallModal = () => {
      installModal.style.display = 'none';
    };
    if (installModalBackdrop) installModalBackdrop.addEventListener('click', closeInstallModal);
    if (installModalCloseBtn) installModalCloseBtn.addEventListener('click', closeInstallModal);
  }

  // Arranque
  setupEvents();
  initPwaInstall();
  drawSonarFrame();
  initWasm().then(loadRadars);
})();

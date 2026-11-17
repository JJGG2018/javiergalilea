/**
 * Subproyecto #13: Radares DGT & Cinemómetros en Tiempo Real
 * Localizador oficial de cinemómetros fijos y de tramo de la Dirección General de Tráfico
 * Motor espacial y detector de proximidad en Rust WebAssembly
 * javiergalilea.es/pr_radares/
 */

(function () {
  'use strict';

  const CARTO_API_KEY = 'cb1_573d_1_8c20f8aa768b764e7c67f1c8';

  // Variables de estado
  let allRadars = [];
  let filteredRadars = [];
  let displayedCount = 0;
  const PAGE_SIZE = 48;

  let currentCategory = 'all';
  let currentSort = 'road-pk';
  let userCoords = null; // { lat, lng, accuracy }
  let alertRadiusKm = 2.5;
  let soundEnabled = false;
  let audioCtx = null;
  let lastAudioAlertTime = 0;

  // Velocidad y telemetría GPS continua
  let currentSpeedKmh = 0;
  let lastGeoFix = null; // { lat, lng, time }
  let geoWatchId = null;
  let isFirstFix = true;

  // WebAssembly
  let wasmInstance = null;
  let wasmMemory = null;
  let wasmLoaded = false;

  // Leaflet
  let map = null;
  let mapMarkersLayer = null;
  let userMarker = null;
  let userAccuracyCircle = null;
  let mapInitialized = false;

  // Modal activo
  let activeModalRadar = null;

  // DOM
  const counterSpan = document.getElementById('counterSpan');
  const speedPill = document.getElementById('speedPill');
  const speedValue = document.getElementById('speedValue');
  const wasmStatusPill = document.getElementById('wasmStatusPill');
  const loadingBox = document.getElementById('loadingBox');
  const mapView = document.getElementById('mapView');
  const gridView = document.getElementById('gridView');
  const radarGrid = document.getElementById('radarGrid');
  const loadMoreBox = document.getElementById('loadMoreBox');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const loadMoreInfo = document.getElementById('loadMoreInfo');

  const viewMapBtn = document.getElementById('viewMapBtn');
  const viewGridBtn = document.getElementById('viewGridBtn');
  const geoBtn = document.getElementById('geoBtn');
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const soundIcon = document.getElementById('soundIcon');
  const soundLabel = document.getElementById('soundLabel');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  const proximityAlertBanner = document.getElementById('proximityAlertBanner');
  const alertDesc = document.getElementById('alertDesc');
  const dismissAlertBtn = document.getElementById('dismissAlertBtn');

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const provSelect = document.getElementById('provSelect');
  const roadSelect = document.getElementById('roadSelect');
  const sortSelect = document.getElementById('sortSelect');
  const alertRadiusSelect = document.getElementById('alertRadiusSelect');

  // Modal DOM
  const radarModal = document.getElementById('radarModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalTypeBadge = document.getElementById('modalTypeBadge');
  const modalRoad = document.getElementById('modalRoad');
  const modalPk = document.getElementById('modalPk');
  const modalSpeedSign = document.getElementById('modalSpeedSign');
  const modalIconBox = document.getElementById('modalIconBox');
  const modalTitle = document.getElementById('modalTitle');
  const modalDirText = document.getElementById('modalDirText');
  const modalProvText = document.getElementById('modalProvText');
  const modalDistText = document.getElementById('modalDistText');
  const modalId = document.getElementById('modalId');
  const modalCoords = document.getElementById('modalCoords');
  const modalTramoInfoRow = document.getElementById('modalTramoInfoRow');
  const modalTramoEnd = document.getElementById('modalTramoEnd');
  const modalLocateBtn = document.getElementById('modalLocateBtn');
  const modalMapsLink = document.getElementById('modalMapsLink');

  // Inicializar Rust WASM
  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      if (!res.ok) throw new Error('No se pudo cargar engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      wasmMemory = wasmInstance.exports.memory;
      wasmLoaded = true;
      wasmStatusPill.classList.add('online');
      console.log('✅ radares_engine.wasm (Rust) cargado con éxito.');
    } catch (e) {
      console.warn('WASM no disponible, usando fallback JS:', e);
      wasmStatusPill.style.display = 'none';
    }
  }

  // Registrar radares en la memoria del módulo Rust WASM
  function registerRadarsInWasm() {
    if (!wasmLoaded || !wasmInstance) return;
    const regFn = wasmInstance.exports.register_radar;
    const len = Math.min(allRadars.length, 1024);
    for (let i = 0; i < len; i++) {
      const r = allRadars[i];
      regFn(i, r.lat, r.lng, r.pk, r.type === 'tramo' ? 1 : 0);
    }
  }

  // Cargar base de datos oficial de radares DGT
  async function loadRadars() {
    try {
      const res = await fetch('radares.json');
      if (!res.ok) throw new Error('Error al leer radares.json');
      allRadars = await res.json();
      allRadars.forEach((r, idx) => { r._origIdx = idx; });

      populateSelectors();
      registerRadarsInWasm();
      applyFilters();

      loadingBox.style.display = 'none';
      initMap();
    } catch (err) {
      console.error(err);
      loadingBox.innerHTML = '<p style="color:#ef4444;">Error cargando los cinemómetros oficiales de la DGT.</p>';
    }
  }

  // Poblar selectores de provincias y vías principales
  function populateSelectors() {
    const provs = [...new Set(allRadars.map(r => r.prov).filter(Boolean))].sort();
    provs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      provSelect.appendChild(opt);
    });

    const roadCounts = {};
    allRadars.forEach(r => {
      if (r.road) roadCounts[r.road] = (roadCounts[r.road] || 0) + 1;
    });

    const roads = Object.keys(roadCounts).sort((a, b) => {
      const isRadA = a.match(/^A-[1-8]$/);
      const isRadB = b.match(/^A-[1-8]$/);
      if (isRadA && !isRadB) return -1;
      if (!isRadA && isRadB) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    roads.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `${r} (${roadCounts[r]} radares)`;
      roadSelect.appendChild(opt);
    });
  }

  // Detección de puertos de montaña
  function isMountainPass(r) {
    const road = r.road.toUpperCase();
    const pk = r.pk;
    const prov = (r.prov || '').toUpperCase();

    // Somosierra (A-1)
    if (road === 'A-1' && pk >= 80 && pk <= 110) return true;
    // Guadarrama / Alto del León (A-6, AP-6, N-6)
    if ((road === 'A-6' || road === 'AP-6' || road === 'N-6') && pk >= 45 && pk <= 68) return true;
    // Pajares / Huerna (N-630, A-66, AP-66)
    if ((road === 'N-630' || road.includes('66')) && (prov.includes('ASTURIAS') || prov.includes('LEÓN')) && pk >= 60 && pk <= 110) return true;
    // Reinosa / Pozazal (A-67)
    if (road === 'A-67' && pk >= 110 && pk <= 150) return true;
    // Manzanal (A-6)
    if (road === 'A-6' && pk >= 340 && pk <= 370) return true;
    // Despeñaperros (A-4)
    if (road === 'A-4' && pk >= 240 && pk <= 265) return true;
    // Monrepós (A-23)
    if (road === 'A-23' && pk >= 370 && pk <= 400) return true;

    return false;
  }

  // Aplicar filtros y ordenación
  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const selProv = provSelect.value;
    const selRoad = roadSelect.value;

    let list = allRadars.filter(r => {
      if (currentCategory === 'fijos' && r.type !== 'fijo') return false;
      if (currentCategory === 'tramos' && r.type !== 'tramo') return false;
      if (currentCategory === 'radiales') {
        if (!r.road.match(/^A-[1-8]$/) && !r.road.match(/^AP-[67]$/)) return false;
      } else if (currentCategory === 'circunvalacion') {
        if (!r.road.match(/^(M|SE|V|B|Z|MA)-[0-9]+/)) return false;
      } else if (currentCategory === 'puertos') {
        if (!isMountainPass(r)) return false;
      } else if (currentCategory === 'madrid') {
        if (!r.prov.includes('MADRID')) return false;
      } else if (currentCategory === 'andalucia') {
        const p = r.prov;
        if (!p.includes('SEVILLA') && !p.includes('MÁLAGA') && !p.includes('CÁDIZ') && !p.includes('CÓRDOBA') && !p.includes('GRANADA') && !p.includes('JAÉN') && !p.includes('HUELVA') && !p.includes('ALMERÍA')) return false;
      } else if (currentCategory === 'norte') {
        const p = r.prov;
        if (!p.includes('ASTURIAS') && !p.includes('CANTABRIA') && !p.includes('CORUÑA') && !p.includes('LUGO') && !p.includes('PONTEVEDRA') && !p.includes('OURENSE')) return false;
      }

      if (selProv !== 'all' && r.prov !== selProv) return false;
      if (selRoad !== 'all' && r.road !== selRoad) return false;

      if (query) {
        const text = `${r.road} ${r.prov} ${r.dir} PK ${r.pk} ${r.id} ${r.type}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    });

    if (currentSort === 'proximity' && userCoords) {
      sortByProximity(list);
    } else if (currentSort === 'pk-asc') {
      list.sort((a, b) => a.pk - b.pk);
    } else if (currentSort === 'pk-desc') {
      list.sort((a, b) => b.pk - a.pk);
    } else {
      list.sort((a, b) => {
        const cmp = a.road.localeCompare(b.road, undefined, { numeric: true });
        if (cmp !== 0) return cmp;
        return a.pk - b.pk;
      });
    }

    filteredRadars = list;
    counterSpan.textContent = filteredRadars.length.toLocaleString('es-ES');

    displayedCount = 0;
    radarGrid.innerHTML = '';
    renderBatch();

    if (mapInitialized) {
      updateMapMarkers();
    }

    checkProximityAlert();
  }

  // Ordenación por proximidad geográfica usando Rust WASM
  function sortByProximity(list) {
    if (!userCoords) return;

    if (wasmLoaded && wasmInstance) {
      const sortFn = wasmInstance.exports.sort_by_proximity;
      const ptrDist = wasmInstance.exports.get_result_distances_ptr();

      sortFn(userCoords.lat, userCoords.lng, allRadars.length);
      const f32Dist = new Float32Array(wasmMemory.buffer, ptrDist, allRadars.length);

      list.forEach(r => {
        r._distKm = Math.round(f32Dist[r._origIdx] * 10) / 10;
      });
      list.sort((a, b) => (a._distKm || 0) - (b._distKm || 0));
    } else {
      list.forEach(r => {
        r._distKm = Math.round(haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng) * 10) / 10;
      });
      list.sort((a, b) => (a._distKm || 0) - (b._distKm || 0));
    }
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Comprobar si hay algún radar dentro del radio de alerta configurado
  function checkProximityAlert() {
    if (!userCoords || allRadars.length === 0) {
      proximityAlertBanner.style.display = 'none';
      proximityAlertBanner.classList.remove('overspeed-alert');
      if (speedPill) speedPill.classList.remove('overspeed');
      return;
    }

    let nearestRadar = null;
    let nearestDist = Infinity;

    if (wasmLoaded && wasmInstance) {
      const nearIdx = wasmInstance.exports.find_nearest_radar(userCoords.lat, userCoords.lng, allRadars.length);
      if (nearIdx >= 0 && nearIdx < allRadars.length) {
        nearestRadar = allRadars[nearIdx];
        nearestDist = wasmInstance.exports.distance_km(userCoords.lat, userCoords.lng, nearestRadar.lat, nearestRadar.lng);
      }
    } else {
      for (const r of allRadars) {
        const d = haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng);
        if (d < nearestDist) {
          nearestDist = d;
          nearestRadar = r;
        }
      }
    }

    if (nearestRadar && nearestDist <= alertRadiusKm) {
      const distStr = nearestDist < 1 
        ? `${Math.round(nearestDist * 1000)} metros` 
        : `${nearestDist.toFixed(1)} km`;
      
      const tipoStr = nearestRadar.type === 'tramo' ? 'Radar de Tramo' : 'Radar Fijo';
      const limit = nearestRadar.limit || 120;
      const isOverspeed = currentSpeedKmh > limit;

      if (isOverspeed) {
        const exceso = currentSpeedKmh - limit;
        proximityAlertBanner.classList.add('overspeed-alert');
        if (speedPill) speedPill.classList.add('overspeed');
        alertDesc.innerHTML = `<span class="alert-overspeed-tag">🚨 ¡EXCESO DE VELOCIDAD!</span> <strong>${tipoStr} en ${nearestRadar.road} PK ${nearestRadar.pk}</strong> a <strong>${distStr}</strong>. Circulas a <strong>${currentSpeedKmh} km/h</strong> en tramo regulado a <span class="speed-sign" style="width:24px;height:24px;font-size:0.68rem;vertical-align:middle;margin:0 4px;">${limit}</span> (<strong>+${exceso} km/h</strong> de exceso).`;
        playAcousticChime(true);
      } else {
        proximityAlertBanner.classList.remove('overspeed-alert');
        if (speedPill) speedPill.classList.remove('overspeed');
        alertDesc.innerHTML = `<strong>${tipoStr} en ${nearestRadar.road} PK ${nearestRadar.pk}</strong> a <strong>${distStr}</strong> (${nearestRadar.dir}) en ${nearestRadar.prov} · Límite: <span class="speed-sign" style="width:24px;height:24px;font-size:0.68rem;vertical-align:middle;margin:0 4px;">${limit}</span>${currentSpeedKmh > 0 ? ` · Tu velocidad: <strong>${currentSpeedKmh} km/h</strong> (dentro del límite ✅)` : ''}`;
        playAcousticChime(false);
      }
      proximityAlertBanner.style.display = 'flex';
    } else {
      proximityAlertBanner.style.display = 'none';
      proximityAlertBanner.classList.remove('overspeed-alert');
      if (speedPill) speedPill.classList.remove('overspeed');
    }
  }

  // Reproducir aviso acústico sintetizado (Web Audio API)
  function playAcousticChime(isUrgent = false) {
    if (!soundEnabled) return;
    const now = Date.now();
    const minInterval = isUrgent ? 5000 : 12000;
    if (now - lastAudioAlertTime < minInterval) return;
    lastAudioAlertTime = now;

    try {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc1.type = isUrgent ? 'sawtooth' : 'sine';
      osc2.type = 'triangle';

      const t = audioCtx.currentTime;
      if (isUrgent) {
        // Tono bitonal urgente de exceso de velocidad: 980 Hz -> 1480 Hz
        osc1.frequency.setValueAtTime(980, t);
        osc1.frequency.exponentialRampToValueAtTime(1480, t + 0.12);
        osc1.frequency.setValueAtTime(980, t + 0.18);
        osc1.frequency.exponentialRampToValueAtTime(1480, t + 0.30);

        osc2.frequency.setValueAtTime(1960, t);
        osc2.frequency.exponentialRampToValueAtTime(2960, t + 0.12);

        gainNode.gain.setValueAtTime(0.001, t);
        gainNode.gain.linearRampToValueAtTime(0.35, t + 0.04);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      } else {
        // Tono de alerta suave 880 Hz -> 1174 Hz
        osc1.frequency.setValueAtTime(880, t);
        osc1.frequency.exponentialRampToValueAtTime(1174, t + 0.18);
        osc2.frequency.setValueAtTime(880 * 2, t);
        osc2.frequency.exponentialRampToValueAtTime(1174 * 2, t + 0.18);

        gainNode.gain.setValueAtTime(0.001, t);
        gainNode.gain.linearRampToValueAtTime(0.25, t + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
      }

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.4);
      osc2.stop(t + 0.4);
    } catch (e) {
      console.warn('AudioContext error:', e);
    }
  }

  // Renderizar fichas en la vista de Catálogo
  function renderBatch() {
    const toRender = filteredRadars.slice(displayedCount, displayedCount + PAGE_SIZE);
    if (toRender.length === 0 && displayedCount === 0) {
      radarGrid.innerHTML = `
        <div class="loading-state" style="grid-column: 1 / -1;">
          <p>No se encontraron cinemómetros con los filtros seleccionados.</p>
        </div>`;
      loadMoreBox.style.display = 'none';
      return;
    }

    const fragment = document.createDocumentFragment();

    toRender.forEach(r => {
      const card = document.createElement('article');
      card.className = 'radar-card';
      card.title = `Ver detalles de ${r.road} PK ${r.pk}`;

      const isTramo = r.type === 'tramo';
      const typeBadgeCls = isTramo ? 'type-tramo' : 'type-fijo';
      const typeText = isTramo ? '📏 TRAMO' : '📸 FIJO';
      const bigIcon = isTramo ? '📏' : '📸';
      const iconCls = isTramo ? 'icon-tramo' : 'icon-fijo';
      const titleText = isTramo ? 'Radar de Velocidad Media' : 'Cinemómetro en Cabina / Pórtico';
      const distInfo = r._distKm ? `<span class="radar-dist-tag">📍 a ${r._distKm} km</span>` : '';

      card.innerHTML = `
        <div class="radar-card-header">
          <div class="radar-badges-left">
            <span class="radar-type-badge ${typeBadgeCls}">${typeText}</span>
            <span class="cam-badge-road">${r.road || 'Vía'}</span>
            <span class="cam-badge-pk">PK ${r.pk}</span>
            <span class="speed-sign" title="Límite reglamentario DGT: ${r.limit || 120} km/h">${r.limit || 120}</span>
          </div>
          <span class="cam-badge-prov">${r.prov}</span>
        </div>
        <div class="radar-card-body">
          <div class="radar-big-icon ${iconCls}">${bigIcon}</div>
          <div class="radar-card-desc">
            <h4>${titleText}</h4>
            <p>Sentido: <strong>${r.dir}</strong></p>
            <p>Provincia: <strong>${r.prov}</strong></p>
            <p>Límite tramo: <strong style="color:#f87171;">${r.limit || 120} km/h</strong></p>
          </div>
        </div>
        <div class="radar-card-footer">
          <span>Identificador: <strong>${r.id}</strong></span>
          ${distInfo}
        </div>
      `;

      card.addEventListener('click', () => openModal(r));
      fragment.appendChild(card);
    });

    radarGrid.appendChild(fragment);
    displayedCount += toRender.length;

    if (displayedCount < filteredRadars.length) {
      loadMoreBox.style.display = 'flex';
      loadMoreInfo.textContent = `Mostrando ${displayedCount} de ${filteredRadars.length} cinemómetros`;
    } else {
      loadMoreBox.style.display = 'none';
    }
  }

  // Abrir Modal de Detalle
  function openModal(r) {
    activeModalRadar = r;
    const isTramo = r.type === 'tramo';

    modalTypeBadge.textContent = isTramo ? 'RADAR DE TRAMO' : 'RADAR FIJO';
    modalTypeBadge.className = `radar-type-badge ${isTramo ? 'type-tramo' : 'type-fijo'}`;
    modalRoad.textContent = r.road;
    modalPk.textContent = `PK ${r.pk}`;
    if (modalSpeedSign) modalSpeedSign.textContent = r.limit || 120;

    modalIconBox.textContent = isTramo ? '📏' : '📸';
    modalIconBox.style.background = isTramo ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)';

    modalTitle.textContent = isTramo ? 'Control de Velocidad Media de Tramo' : 'Cinemómetro Fijo en Cabina / Arcén';
    modalDirText.textContent = `Sentido: ${r.dir}`;
    modalProvText.textContent = `Provincia: ${r.prov}`;

    if (userCoords) {
      const d = r._distKm !== undefined ? r._distKm : Math.round(haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng) * 10) / 10;
      const speedPart = currentSpeedKmh > 0 ? ` · Tu velocidad: ${currentSpeedKmh} km/h` : '';
      modalDistText.textContent = `📍 Distancia a ti: ${d} km${speedPart}`;
    } else {
      modalDistText.textContent = '📍 Activa "Cerca de Mí" para calcular distancia';
    }

    modalId.textContent = r.id;
    modalCoords.textContent = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;

    if (isTramo && r.latEnd && r.lngEnd) {
      modalTramoInfoRow.style.display = 'flex';
      modalTramoEnd.textContent = `${r.latEnd.toFixed(5)}, ${r.lngEnd.toFixed(5)}`;
    } else {
      modalTramoInfoRow.style.display = 'none';
    }

    modalMapsLink.href = `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;

    radarModal.style.display = 'flex';
  }

  function closeModal() {
    radarModal.style.display = 'none';
    activeModalRadar = null;
  }

  // Inicializar Mapa Leaflet con Carto Dark HD y Satélite HD
  function initMap() {
    if (mapInitialized) return;

    map = L.map('mapContainer', {
      center: [40.4168, -3.7038], // Centro Peninsular (Madrid)
      zoom: 6,
      minZoom: 4,
      maxZoom: 21,
      zoomControl: true,
      preferCanvas: true
    });

    const baseLayers = {
      '🌃 Modo Oscuro (Carto HD)': L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${CARTO_API_KEY}`,
        {
          attribution: '&copy; OpenStreetMap &copy; CARTO · DGT',
          subdomains: 'abcd',
          maxNativeZoom: 20,
          maxZoom: 21
        }
      ),
      '🛰️ Satélite HD (Carreteras)': L.tileLayer(
        'https://{s}.google.com/vt/lyrs=y&hl=es&x={x}&y={y}&z={z}',
        {
          attribution: '&copy; Google Satellite HD &copy; OpenStreetMap · DGT',
          subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
          maxNativeZoom: 20,
          maxZoom: 21
        }
      )
    };

    baseLayers['🌃 Modo Oscuro (Carto HD)'].addTo(map);
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    mapMarkersLayer = L.layerGroup().addTo(map);
    mapInitialized = true;
    updateMapMarkers();
  }

  // Actualizar marcadores y polilíneas de tramos en el mapa
  function updateMapMarkers() {
    if (!map || !mapMarkersLayer) return;
    mapMarkersLayer.clearLayers();

    filteredRadars.forEach(r => {
      const isTramo = r.type === 'tramo';

      if (isTramo && r.latEnd && r.lngEnd) {
        // 1. Trazado iluminado del tramo
        const polyline = L.polyline([[r.lat, r.lng], [r.latEnd, r.lngEnd]], {
          color: '#f59e0b',
          weight: 5,
          opacity: 0.85,
          dashArray: '8, 8'
        });

        polyline.bindPopup(`
          <div class="map-popup-card">
            <div class="map-popup-header">
              <strong style="color:#f59e0b;">📏 Tramo ${r.road} · PK ${r.pk}</strong>
              <span class="speed-sign" style="width:24px; height:24px; font-size:0.68rem; border-width:2.5px;">${r.limit || 120}</span>
            </div>
            <div style="font-size:0.8rem; color:#f8fafc; margin-top:0.3rem;">
              Control de Velocidad Media · Límite: <strong>${r.limit || 120} km/h</strong><br>
              Sentido: <strong>${r.dir}</strong> · ${r.prov}
            </div>
            <div style="margin-top:0.4rem; text-align:right;">
              <button class="action-pill-btn" onclick="document.dispatchEvent(new CustomEvent('openRadarModal', { detail: '${r.id}' }))" style="padding:0.25rem 0.6rem; font-size:0.72rem;">Ver Ficha</button>
            </div>
          </div>
        `);
        mapMarkersLayer.addLayer(polyline);

        // Marcador de inicio
        const startMarker = L.circleMarker([r.lat, r.lng], {
          radius: 6,
          fillColor: '#f59e0b',
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.9
        });
        mapMarkersLayer.addLayer(startMarker);

        // Marcador de fin
        const endMarker = L.circleMarker([r.latEnd, r.lngEnd], {
          radius: 6,
          fillColor: '#f59e0b',
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.9,
          fillOpacity: 0.9
        });
        mapMarkersLayer.addLayer(endMarker);
      } else {
        // 2. Radar fijo
        const fixedMarker = L.circleMarker([r.lat, r.lng], {
          radius: 6.5,
          fillColor: '#ef4444',
          color: '#ffffff',
          weight: 1.5,
          opacity: 0.95,
          fillOpacity: 0.88
        });

        fixedMarker.bindPopup(`
          <div class="map-popup-card">
            <div class="map-popup-header">
              <strong style="color:#ef4444;">📸 Radar Fijo ${r.road} · PK ${r.pk}</strong>
              <span class="speed-sign" style="width:24px; height:24px; font-size:0.68rem; border-width:2.5px;">${r.limit || 120}</span>
            </div>
            <div style="font-size:0.8rem; color:#f8fafc; margin-top:0.3rem;">
              Cinemómetro en Cabina/Arcén · Límite: <strong>${r.limit || 120} km/h</strong><br>
              Sentido: <strong>${r.dir}</strong> · ${r.prov}
            </div>
            <div style="margin-top:0.4rem; text-align:right;">
              <button class="action-pill-btn" onclick="document.dispatchEvent(new CustomEvent('openRadarModal', { detail: '${r.id}' }))" style="padding:0.25rem 0.6rem; font-size:0.72rem;">Ver Ficha</button>
            </div>
          </div>
        `);
        mapMarkersLayer.addLayer(fixedMarker);
      }
    });

    drawUserPositionMarker();

    if (filteredRadars.length > 0 && currentCategory !== 'all') {
      const bounds = L.latLngBounds(filteredRadars.map(r => [r.lat, r.lng]));
      if (userCoords) bounds.extend([userCoords.lat, userCoords.lng]);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }

  // Pintar marcador animado GPS del usuario
  function drawUserPositionMarker() {
    if (!map || !userCoords) return;

    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    if (userAccuracyCircle) {
      map.removeLayer(userAccuracyCircle);
      userAccuracyCircle = null;
    }

    const accuracyRadius = Math.max(150, Math.min(userCoords.accuracy || 1200, 4000));

    userAccuracyCircle = L.circle([userCoords.lat, userCoords.lng], {
      radius: accuracyRadius,
      color: '#00f5d4',
      fillColor: '#00f5d4',
      fillOpacity: 0.1,
      weight: 1.5,
      dashArray: '4, 6'
    }).addTo(map);

    const userIcon = L.divIcon({
      className: 'user-location-marker',
      html: `
        <div class="user-pulse-beacon">
          <div class="pulse-ring"></div>
          <div class="pulse-dot"></div>
        </div>
      `,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });

    userMarker = L.marker([userCoords.lat, userCoords.lng], {
      icon: userIcon,
      zIndexOffset: 1500
    }).addTo(map);

    userMarker.bindPopup(`
      <div class="map-popup-card" style="width: 220px; text-align: center;">
        <div class="map-popup-header" style="justify-content: center; margin-bottom: 0.35rem;">
          <strong style="color: #00f5d4; font-size: 0.95rem;">📍 Tu Posición Actual</strong>
        </div>
        <p style="font-size: 0.88rem; color: #f8fafc; margin: 0.3rem 0; font-weight:700;">
          🚗 Velocidad: <span style="color:#00f5d4; font-size:1.05rem;">${currentSpeedKmh}</span> km/h
        </p>
        <p style="font-size: 0.76rem; color: #94a3b8; margin: 0.2rem 0;">
          Lat: ${userCoords.lat.toFixed(4)} · Lng: ${userCoords.lng.toFixed(4)}
        </p>
        <div style="font-size: 0.74rem; color: #00f5d4; font-weight: 600; margin-top: 0.35rem;">
          Distancias y proximidad en Rust WASM
        </div>
      </div>
    `);
  }

  // Manejar posición GPS y telemetría de velocidad instantánea
  function handleGeoPosition(pos) {
    const coords = pos.coords;
    const now = Date.now();

    // 1. Calcular velocidad en km/h
    let speedKmh = 0;
    if (coords.speed !== null && !isNaN(coords.speed) && coords.speed >= 0) {
      // coords.speed viene en m/s desde el sensor GPS
      speedKmh = Math.round(coords.speed * 3.6);
    } else if (lastGeoFix) {
      // Fallback geodésico: calcular distancia entre los dos últimos fixes en el tiempo
      const dtSec = (now - lastGeoFix.time) / 1000;
      if (dtSec >= 1 && dtSec <= 30) {
        const dKm = wasmLoaded && wasmInstance
          ? wasmInstance.exports.distance_km(lastGeoFix.lat, lastGeoFix.lng, coords.latitude, coords.longitude)
          : haversineKm(lastGeoFix.lat, lastGeoFix.lng, coords.latitude, coords.longitude);
        speedKmh = Math.round((dKm / dtSec) * 3600);
        if (speedKmh < 3) speedKmh = 0; // filtrar jitter en reposo
        if (speedKmh > 260) speedKmh = currentSpeedKmh; // filtrar lecturas erráticas
      }
    }

    lastGeoFix = { lat: coords.latitude, lng: coords.longitude, time: now };
    currentSpeedKmh = speedKmh;

    if (speedValue) {
      speedValue.textContent = currentSpeedKmh;
    }

    userCoords = {
      lat: coords.latitude,
      lng: coords.longitude,
      accuracy: coords.accuracy || 1200
    };

    geoBtn.innerHTML = '<span>📍 Cerca de Mí (Activo)</span>';
    geoBtn.style.background = 'rgba(0, 245, 212, 0.3)';

    if (currentSort === 'proximity') {
      applyFilters();
    } else {
      checkProximityAlert();
    }

    if (mapInitialized && map) {
      drawUserPositionMarker();
      if (isFirstFix) {
        map.flyTo([userCoords.lat, userCoords.lng], 12, { duration: 1.2 });
        if (userMarker) setTimeout(() => userMarker.openPopup(), 1250);
        isFirstFix = false;
      }
    }
  }

  // Solicitar ubicación GPS e iniciar escucha continua de velocidad (watchPosition)
  function requestUserLocation() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización GPS.');
      return;
    }

    geoBtn.innerHTML = '<span>⏳ Obteniendo GPS...</span>';

    if (geoWatchId !== null) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }

    geoWatchId = navigator.geolocation.watchPosition(
      handleGeoPosition,
      err => {
        console.warn('watchPosition fallido, intentando getCurrentPosition:', err.message);
        navigator.geolocation.getCurrentPosition(
          handleGeoPosition,
          e => {
            console.warn('getCurrentPosition fallido:', e.message);
            geoBtn.innerHTML = '<span>📍 Cerca de Mí</span>';
            alert('No se pudo acceder a tu ubicación GPS. Comprueba los permisos de tu navegador.');
          },
          { timeout: 10000, enableHighAccuracy: true }
        );
      },
      { timeout: 15000, enableHighAccuracy: true, maximumAge: 2000 }
    );
  }

  // Event Listeners
  function setupEvents() {
    // Cambio de Vistas
    viewMapBtn.addEventListener('click', () => {
      viewMapBtn.classList.add('active');
      viewGridBtn.classList.remove('active');
      mapView.style.display = 'block';
      gridView.style.display = 'none';

      if (!mapInitialized) {
        initMap();
      } else {
        setTimeout(() => map.invalidateSize(), 150);
        updateMapMarkers();
      }

      if (userCoords && map) {
        setTimeout(() => {
          map.setView([userCoords.lat, userCoords.lng], 11);
          if (userMarker) userMarker.openPopup();
        }, 220);
      }
    });

    viewGridBtn.addEventListener('click', () => {
      viewGridBtn.classList.add('active');
      viewMapBtn.classList.remove('active');
      gridView.style.display = 'block';
      mapView.style.display = 'none';
    });

    // Píldoras de Categoría
    document.querySelectorAll('.cat-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCategory = btn.dataset.cat;
        applyFilters();
      });
    });

    // Búsqueda de texto
    searchInput.addEventListener('input', () => {
      clearSearchBtn.style.display = searchInput.value ? 'block' : 'none';
      applyFilters();
    });

    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.style.display = 'none';
      applyFilters();
    });

    // Selectores
    provSelect.addEventListener('change', applyFilters);
    roadSelect.addEventListener('change', applyFilters);

    sortSelect.addEventListener('change', e => {
      currentSort = e.target.value;
      if (currentSort === 'proximity' && !userCoords) {
        requestUserLocation();
      } else {
        applyFilters();
      }
    });

    alertRadiusSelect.addEventListener('change', e => {
      alertRadiusKm = parseFloat(e.target.value) || 2.5;
      checkProximityAlert();
    });

    // Sonido
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      if (soundEnabled) {
        soundToggleBtn.classList.add('sound-on');
        soundIcon.textContent = '🔊';
        soundLabel.textContent = 'Avisador ON';
        playAcousticChime();
      } else {
        soundToggleBtn.classList.remove('sound-on');
        soundIcon.textContent = '🔇';
        soundLabel.textContent = 'Avisador OFF';
      }
    });

    // Botones de acción
    geoBtn.addEventListener('click', requestUserLocation);
    loadMoreBtn.addEventListener('click', renderBatch);
    dismissAlertBtn.addEventListener('click', () => {
      proximityAlertBanner.style.display = 'none';
    });

    // Pantalla completa
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    // Modal
    modalCloseBtn.addEventListener('click', closeModal);
    modalBackdrop.addEventListener('click', closeModal);
    modalLocateBtn.addEventListener('click', () => {
      if (!activeModalRadar) return;
      closeModal();
      viewMapBtn.click();
      if (map) {
        map.setView([activeModalRadar.lat, activeModalRadar.lng], 14);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && radarModal.style.display !== 'none') {
        closeModal();
      }
    });

    // Evento personalizado desde popups del mapa
    document.addEventListener('openRadarModal', e => {
      const radarId = e.detail;
      const found = allRadars.find(r => r.id === radarId);
      if (found) openModal(found);
    });
  }

  // Inicialización
  setupEvents();
  initWasm().then(() => {
    loadRadars();
  });
})();

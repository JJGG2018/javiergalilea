/**
 * Subproyecto #12: Cámaras DGT en Tiempo Real
 * Visor de casi 2.000 cámaras oficiales de la Dirección General de Tráfico
 * Motor geodésico y de proximidad en Rust WebAssembly
 * javiergalilea.es/pr_camaras/
 */

(function () {
  'use strict';

  // Variables de estado
  let allCameras = [];
  let filteredCameras = [];
  let displayedCount = 0;
  const PAGE_SIZE = 48;

  let currentCategory = 'all';
  let currentSort = 'road-pk';
  let userCoords = null; // { lat, lng }
  let autoRefreshTimer = null;
  let refreshIntervalMs = 120000; // 2 min por defecto
  let currentTimestamp = Date.now();

  // Modal activo
  let activeModalCamera = null;
  let modalCountdownSec = 120;
  let modalTimer = null;

  // WebAssembly
  let wasmInstance = null;
  let wasmMemory = null;
  let wasmLoaded = false;

  // Mapa Leaflet
  let map = null;
  let mapMarkersLayer = null;
  let mapInitialized = false;

  // Elementos DOM
  const counterSpan = document.getElementById('counterSpan');
  const wasmStatusPill = document.getElementById('wasmStatusPill');
  const loadingBox = document.getElementById('loadingBox');
  const gridView = document.getElementById('gridView');
  const mapView = document.getElementById('mapView');
  const camGrid = document.getElementById('camGrid');
  const loadMoreBox = document.getElementById('loadMoreBox');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const loadMoreInfo = document.getElementById('loadMoreInfo');

  const viewGridBtn = document.getElementById('viewGridBtn');
  const viewMapBtn = document.getElementById('viewMapBtn');
  const geoBtn = document.getElementById('geoBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const provSelect = document.getElementById('provSelect');
  const roadSelect = document.getElementById('roadSelect');
  const sortSelect = document.getElementById('sortSelect');
  const refreshRateSelect = document.getElementById('refreshRateSelect');

  // Modal DOM
  const camModal = document.getElementById('camModal');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalCloseBtn = document.getElementById('modalCloseBtn');
  const modalRoad = document.getElementById('modalRoad');
  const modalPk = document.getElementById('modalPk');
  const modalProv = document.getElementById('modalProv');
  const modalDest = document.getElementById('modalDest');
  const modalCoords = document.getElementById('modalCoords');
  const modalImg = document.getElementById('modalImg');
  const modalCountdown = document.getElementById('modalCountdown');
  const modalRefreshBtn = document.getElementById('modalRefreshBtn');
  const modalOpenDirectBtn = document.getElementById('modalOpenDirectBtn');

  // Inicializar WebAssembly (Rust)
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
      console.log('✅ camaras_engine.wasm (Rust) cargado con éxito.');
    } catch (e) {
      console.warn('WASM no disponible, usando fallback JavaScript:', e);
      wasmStatusPill.style.display = 'none';
    }
  }

  // Registrar cámaras en el buffer de memoria Rust WASM
  function registerCamerasInWasm() {
    if (!wasmLoaded || !wasmInstance) return;
    const regFn = wasmInstance.exports.register_camera;
    const len = Math.min(allCameras.length, 2048);
    for (let i = 0; i < len; i++) {
      const c = allCameras[i];
      regFn(i, c.lat, c.lng, c.pk);
    }
  }

  // Cargar base de datos de cámaras (JSON oficial DGT)
  async function loadCameras() {
    try {
      const res = await fetch('camaras.json');
      if (!res.ok) throw new Error('Error al leer camaras.json');
      allCameras = await res.json();
      allCameras.forEach((c, idx) => { c._origIdx = idx; });

      populateSelectors();
      registerCamerasInWasm();
      applyFilters();

      loadingBox.style.display = 'none';
    } catch (err) {
      console.error(err);
      loadingBox.innerHTML = '<p style="color:#ef4444;">Error cargando las cámaras de la DGT. Por favor, recarga la página.</p>';
    }
  }

  // Poblar selectores de provincias y carreteras principales
  function populateSelectors() {
    // Provincias
    const provs = [...new Set(allCameras.map(c => c.prov).filter(Boolean))].sort();
    provs.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      provSelect.appendChild(opt);
    });

    // Carreteras principales con más de 5 cámaras
    const roadCounts = {};
    allCameras.forEach(c => {
      if (c.road) roadCounts[c.road] = (roadCounts[c.road] || 0) + 1;
    });

    const roads = Object.keys(roadCounts).sort((a, b) => {
      // Priorizar autovías radiales A-1 a A-8
      const isRadA = a.match(/^A-[1-8]$/);
      const isRadB = b.match(/^A-[1-8]$/);
      if (isRadA && !isRadB) return -1;
      if (!isRadA && isRadB) return 1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    roads.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `${r} (${roadCounts[r]} cámaras)`;
      roadSelect.appendChild(opt);
    });
  }

  // Clasificador temático de puertos de montaña y tramos de nieve
  function isMountainPass(c) {
    const r = c.road.toUpperCase();
    const pk = c.pk;
    const dest = (c.dest || '').toUpperCase();
    const prov = (c.prov || '').toUpperCase();

    // Somosierra (A-1)
    if (r === 'A-1' && pk >= 80 && pk <= 110) return true;
    // Guadarrama / Alto del León (A-6, AP-6, N-6)
    if ((r === 'A-6' || r === 'AP-6' || r === 'N-6') && pk >= 45 && pk <= 68) return true;
    // Navacerrada / Cotos (M-601, M-604, CL-601)
    if (r.includes('601') || r.includes('604')) return true;
    // Pajares / Huerna (N-630, A-66, AP-66 en Asturias/León)
    if ((r === 'N-630' || r.includes('66')) && (prov.includes('ASTURIAS') || prov.includes('LEÓN')) && pk >= 60 && pk <= 110) return true;
    // Reinosa / Pozazal (A-67)
    if (r === 'A-67' && pk >= 110 && pk <= 150) return true;
    // Manzanal (A-6 en León)
    if (r === 'A-6' && pk >= 340 && pk <= 370) return true;
    // Pedrafita do Cebreiro (A-6 Lugo/León)
    if (r === 'A-6' && pk >= 415 && pk <= 445) return true;
    // Monrepós (A-23 Huesca)
    if (r === 'A-23' && pk >= 370 && pk <= 400) return true;
    // Despeñaperros (A-4 Jaén/Ciudad Real)
    if (r === 'A-4' && pk >= 240 && pk <= 265) return true;
    // Béjar (A-66 Salamanca)
    if (r === 'A-66' && pk >= 400 && pk <= 430) return true;
    // Pirineos y Cantábrico (A-136, N-330, N-260, etc.)
    if (r === 'A-136' || (dest.includes('FRANCIA') && pk > 50)) return true;

    return false;
  }

  // Filtrado y ordenación
  function applyFilters() {
    const query = searchInput.value.trim().toLowerCase();
    const selProv = provSelect.value;
    const selRoad = roadSelect.value;

    let list = allCameras.filter(c => {
      // 1. Filtro por Categoría / Píldora
      if (currentCategory === 'radiales') {
        if (!c.road.match(/^A-[1-8]$/) && !c.road.match(/^AP-[67]$/)) return false;
      } else if (currentCategory === 'circunvalacion') {
        if (!c.road.match(/^(M|SE|V|B|Z|MA)-[0-9]+/)) return false;
      } else if (currentCategory === 'puertos') {
        if (!isMountainPass(c)) return false;
      } else if (currentCategory === 'madrid') {
        if (!c.prov.includes('MADRID')) return false;
      } else if (currentCategory === 'norte') {
        const p = c.prov;
        if (!p.includes('ASTURIAS') && !p.includes('CANTABRIA') && !p.includes('CORUÑA') && !p.includes('LUGO') && !p.includes('PONTEVEDRA') && !p.includes('OURENSE')) return false;
      } else if (currentCategory === 'sur') {
        const p = c.prov;
        if (!p.includes('SEVILLA') && !p.includes('MÁLAGA') && !p.includes('CÁDIZ') && !p.includes('CÓRDOBA') && !p.includes('GRANADA') && !p.includes('JAÉN') && !p.includes('HUELVA') && !p.includes('ALMERÍA')) return false;
      } else if (currentCategory === 'mediterraneo') {
        if (!c.road.includes('A-7') && !c.road.includes('AP-7')) return false;
      }

      // 2. Filtro Provincia
      if (selProv !== 'all' && c.prov !== selProv) return false;

      // 3. Filtro Carretera
      if (selRoad !== 'all' && c.road !== selRoad) return false;

      // 4. Búsqueda de texto
      if (query) {
        const text = `${c.road} ${c.dest} ${c.prov} PK ${c.pk} ${c.id}`.toLowerCase();
        if (!text.includes(query)) return false;
      }

      return true;
    });

    // Ordenación
    if (currentSort === 'proximity' && userCoords) {
      sortByProximity(list);
    } else if (currentSort === 'pk-asc') {
      list.sort((a, b) => a.pk - b.pk);
    } else if (currentSort === 'pk-desc') {
      list.sort((a, b) => b.pk - a.pk);
    } else {
      // road-pk por defecto
      list.sort((a, b) => {
        const cmpRoad = a.road.localeCompare(b.road, undefined, { numeric: true });
        if (cmpRoad !== 0) return cmpRoad;
        return a.pk - b.pk;
      });
    }

    filteredCameras = list;
    counterSpan.textContent = filteredCameras.length.toLocaleString('es-ES');

    displayedCount = 0;
    camGrid.innerHTML = '';
    renderBatch();

    if (mapInitialized && mapView.style.display !== 'none') {
      updateMapMarkers();
    }
  }

  // Ordenación por proximidad geográfica usando Rust WASM
  function sortByProximity(list) {
    if (!userCoords) return;

    if (wasmLoaded && wasmInstance) {
      // Copiar subconjunto a memoria WASM temporalmente si queremos ordenación global
      const sortFn = wasmInstance.exports.sort_by_proximity;
      const ptrDist = wasmInstance.exports.get_result_distances_ptr();

      const n = sortFn(userCoords.lat, userCoords.lng, allCameras.length);
      const f32Dist = new Float32Array(wasmMemory.buffer, ptrDist, allCameras.length);

      // Asignar distancia calculada a cada cámara
      list.forEach(c => {
        c._distKm = Math.round(f32Dist[c._origIdx] * 10) / 10;
      });
      list.sort((a, b) => (a._distKm || 0) - (b._distKm || 0));
    } else {
      // Fallback JS
      list.forEach(c => {
        c._distKm = Math.round(haversineKm(userCoords.lat, userCoords.lng, c.lat, c.lng) * 10) / 10;
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

  // Estilo visual del distintivo según el tipo de carretera
  function getRoadClass(road) {
    const r = road.toUpperCase();
    if (r.startsWith('A-') || r.startsWith('AP-')) return 'road-autovia';
    if (r.startsWith('M-') || r.startsWith('SE-') || r.startsWith('V-') || r.startsWith('B-') || r.startsWith('Z-')) return 'road-circunvalacion';
    if (r.startsWith('N-')) return 'road-nacional';
    return '';
  }

  // Construir la URL del fotograma oficial de la DGT
  function getCameraImageUrl(id) {
    return `https://etraffic.dgt.es/camarasEtraffic/${id}.jpg?t=${currentTimestamp}`;
  }

  // Renderizar un lote de tarjetas en el Muro
  function renderBatch() {
    const toRender = filteredCameras.slice(displayedCount, displayedCount + PAGE_SIZE);
    if (toRender.length === 0 && displayedCount === 0) {
      camGrid.innerHTML = `
        <div class="loading-state" style="grid-column: 1 / -1;">
          <p>No se encontraron cámaras con los filtros seleccionados.</p>
        </div>`;
      loadMoreBox.style.display = 'none';
      return;
    }

    const fragment = document.createDocumentFragment();

    toRender.forEach(c => {
      const card = document.createElement('article');
      card.className = 'cam-card';
      card.title = `Clic para ver ${c.road} PK ${c.pk} en grande`;

      const roadCls = getRoadClass(c.road);
      const imgUrl = getCameraImageUrl(c.id);
      const distInfo = c._distKm ? `<span class="cam-dist-tag">📍 a ${c._distKm} km</span>` : '';

      card.innerHTML = `
        <div class="cam-card-header">
          <div class="cam-badges-left">
            <span class="cam-badge-road ${roadCls}">${c.road || 'DGT'}</span>
            <span class="cam-badge-pk">PK ${c.pk}</span>
          </div>
          <span class="cam-badge-prov">${c.prov}</span>
        </div>
        <div class="cam-img-box">
          <img class="cam-img" src="${imgUrl}" alt="Cámara ${c.road} PK ${c.pk}" loading="lazy" 
               onerror="this.onerror=null; this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22><rect width=%22100%%22 height=%22100%%22 fill=%22%230d111a%22/><text x=%2250%%22 y=%2250%%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2364748b%22 font-family=%22sans-serif%22 font-size=%2216%22>📹 Cámara sin señal temporal</text></svg>';">
        </div>
        <div class="cam-card-footer">
          <span class="cam-dest-info">Hacia: <strong>${c.dest || 'Vía principal'}</strong></span>
          ${distInfo}
        </div>
      `;

      card.addEventListener('click', () => openModal(c));
      fragment.appendChild(card);
    });

    camGrid.appendChild(fragment);
    displayedCount += toRender.length;

    if (displayedCount < filteredCameras.length) {
      loadMoreBox.style.display = 'flex';
      loadMoreInfo.textContent = `Mostrando ${displayedCount} de ${filteredCameras.length} cámaras`;
    } else {
      loadMoreBox.style.display = 'none';
    }
  }

  // Abrir Modal de Cámara en Alta Definición con refresco automático
  function openModal(c) {
    activeModalCamera = c;
    modalRoad.textContent = c.road;
    modalRoad.className = `cam-badge-road ${getRoadClass(c.road)}`;
    modalPk.textContent = `PK ${c.pk}`;
    modalProv.textContent = c.prov;
    modalDest.textContent = `Sentido: ${c.dest || 'Tramo principal'}`;
    modalCoords.textContent = `Lat: ${c.lat.toFixed(4)} · Lng: ${c.lng.toFixed(4)} (ID: ${c.id})`;

    const directUrl = `https://etraffic.dgt.es/camarasEtraffic/${c.id}.jpg`;
    modalOpenDirectBtn.href = directUrl;

    refreshModalImage();
    camModal.style.display = 'flex';

    // Iniciar cuenta atrás para refresco
    modalCountdownSec = Math.round(refreshIntervalMs / 1000) || 120;
    updateModalCountdownText();

    if (modalTimer) clearInterval(modalTimer);
    modalTimer = setInterval(() => {
      modalCountdownSec--;
      if (modalCountdownSec <= 0) {
        refreshModalImage();
        modalCountdownSec = Math.round(refreshIntervalMs / 1000) || 120;
      }
      updateModalCountdownText();
    }, 1000);
  }

  function updateModalCountdownText() {
    modalCountdown.innerHTML = `Próximo refresco: <strong>${modalCountdownSec}s</strong>`;
  }

  function refreshModalImage() {
    if (!activeModalCamera) return;
    const ts = Date.now();
    modalImg.src = `https://etraffic.dgt.es/camarasEtraffic/${activeModalCamera.id}.jpg?t=${ts}`;
  }

  function closeModal() {
    camModal.style.display = 'none';
    activeModalCamera = null;
    if (modalTimer) {
      clearInterval(modalTimer);
      modalTimer = null;
    }
  }

  const CARTO_API_KEY = 'cb1_573d_1_8c20f8aa768b764e7c67f1c8';

  // Inicializar Mapa Leaflet con CartoDB Dark Matter y Satélite HD
  function initMap() {
    if (mapInitialized) return;

    map = L.map('mapContainer', {
      center: [40.4168, -3.7038], // Madrid / Centro de la Península
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
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> · DGT',
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

    // Añadir capa oscura por defecto con la clave autorizada de CARTO
    baseLayers['🌃 Modo Oscuro (Carto HD)'].addTo(map);

    // Selector de capas interactivo en el mapa
    L.control.layers(baseLayers, null, { position: 'topright' }).addTo(map);

    mapMarkersLayer = L.layerGroup().addTo(map);
    mapInitialized = true;
    updateMapMarkers();
  }

  // Actualizar marcadores en el mapa Leaflet
  function updateMapMarkers() {
    if (!map || !mapMarkersLayer) return;
    mapMarkersLayer.clearLayers();

    const camerasToShow = filteredCameras.slice(0, 500); // Top 500 para máximo rendimiento fluido

    camerasToShow.forEach(c => {
      const roadColor = c.road.startsWith('A-') ? '#3b82f6' : (c.road.startsWith('M-') ? '#10b981' : '#f59e0b');

      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 6,
        fillColor: roadColor,
        color: '#ffffff',
        weight: 1.5,
        opacity: 0.9,
        fillOpacity: 0.85
      });

      const popupHtml = `
        <div class="map-popup-card">
          <div class="map-popup-header">
            <strong style="color:#00f5d4;">${c.road} · PK ${c.pk}</strong>
            <span style="font-size:0.75rem; color:#94a3b8;">${c.prov}</span>
          </div>
          <img class="map-popup-img" src="${getCameraImageUrl(c.id)}" alt="${c.road} PK ${c.pk}" loading="lazy">
          <div class="map-popup-footer">
            <span>Sentido: <strong>${c.dest || 'Vía'}</strong></span>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      mapMarkersLayer.addLayer(marker);
    });

    if (camerasToShow.length > 0 && currentCategory !== 'all') {
      const bounds = L.latLngBounds(camerasToShow.map(c => [c.lat, c.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
  }

  // Refrescar todas las imágenes incrementando el timestamp de caché
  function refreshAllImages() {
    currentTimestamp = Date.now();
    document.querySelectorAll('.cam-img').forEach(img => {
      const baseSrc = img.src.split('?')[0];
      img.src = `${baseSrc}?t=${currentTimestamp}`;
    });
    if (activeModalCamera) refreshModalImage();
  }

  // Configurar temporizador de auto-refresco
  function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    if (refreshIntervalMs > 0) {
      autoRefreshTimer = setInterval(refreshAllImages, refreshIntervalMs);
    }
  }

  // Obtener geolocalización del usuario
  function requestUserLocation() {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización GPS.');
      return;
    }

    geoBtn.innerHTML = '<span>⏳ Obteniendo GPS...</span>';

    navigator.geolocation.getCurrentPosition(
      pos => {
        userCoords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        geoBtn.innerHTML = '<span>📍 Cerca de Mí (Activo)</span>';
        geoBtn.style.background = 'rgba(0, 245, 212, 0.3)';
        sortSelect.value = 'proximity';
        currentSort = 'proximity';
        applyFilters();

        if (mapInitialized && map) {
          map.setView([userCoords.lat, userCoords.lng], 10);
        }
      },
      err => {
        console.warn('Geolocalización denegada o fallida:', err.message);
        geoBtn.innerHTML = '<span>📍 Cerca de Mí</span>';
        alert('No se pudo acceder a tu ubicación. Comprueba los permisos de tu navegador.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // Event Listeners
  function setupEvents() {
    // Cambio de Vistas: Muro vs Mapa
    viewGridBtn.addEventListener('click', () => {
      viewGridBtn.classList.add('active');
      viewMapBtn.classList.remove('active');
      gridView.style.display = 'block';
      mapView.style.display = 'none';
    });

    viewMapBtn.addEventListener('click', () => {
      viewMapBtn.classList.add('active');
      viewGridBtn.classList.remove('active');
      gridView.style.display = 'none';
      mapView.style.display = 'block';

      if (!mapInitialized) {
        initMap();
      } else {
        setTimeout(() => map.invalidateSize(), 150);
        updateMapMarkers();
      }
    });

    // Píldoras de categoría
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

    refreshRateSelect.addEventListener('change', e => {
      refreshIntervalMs = parseInt(e.target.value, 10);
      setupAutoRefresh();
    });

    // Botones de acción
    geoBtn.addEventListener('click', requestUserLocation);
    refreshBtn.addEventListener('click', refreshAllImages);

    loadMoreBtn.addEventListener('click', renderBatch);

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
    modalRefreshBtn.addEventListener('click', refreshModalImage);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && camModal.style.display !== 'none') {
        closeModal();
      }
    });
  }

  // Inicialización global
  setupEvents();
  setupAutoRefresh();
  initWasm().then(() => {
    loadCameras();
  });
})();

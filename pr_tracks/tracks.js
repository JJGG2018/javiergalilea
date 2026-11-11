/**
 * Subproyecto #09: Radar & Tracks Multiusuario (3 Letras) — Javier Galilea (Rust + WebAssembly)
 * javiergalilea.es/pr_tracks/
 *
 * Solo aparecen en el mapa los usuarios reales que se dan de alta en la sala con su código de 3 letras.
 */

(function () {
  'use strict';

  const MAX_TRACK_POINTS = 2048;

  // --- 1. ESTADO DEL MOTOR GEODÉSICO RUST WEBASSEMBLY ---
  let wasmExports = null;
  let wasmMemory = null;
  let trackPointsPtr = 0;
  let lastWasmMs = 0.04;

  // --- 2. PARÁMETROS INICIALES Y PERSISTENCIA ---
  const urlParams = new URLSearchParams(window.location.search);
  const savedCallsign = (urlParams.get('id') || localStorage.getItem('jg_tracks_callsign') || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
  const savedColor = localStorage.getItem('jg_tracks_color') || '#00f5d4';
  const savedRoom = (urlParams.get('room') || localStorage.getItem('jg_tracks_room') || 'SALA-JG1')
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, '')
    .slice(0, 14) || 'SALA-JG1';

  let maxTrailPoints = 300;
  let mapStyle = 'cyber'; // 'cyber' | 'night' | 'sat' | 'grid'
  let moveMode = 'gps';   // 'gps' | 'manual'
  let gpsWatchId = null;

  // Vista inicial del mapa (Madrid por defecto hasta que el GPS centre la cámara)
  let centerLat = 40.4168;
  let centerLon = -3.7038;

  // Usuario local (solo se pinta y transmite cuando isRegistered === true)
  const sessionUid = 'u_' + Math.random().toString(36).slice(2, 9);
  const localUser = {
    uid: sessionUid,
    id: savedCallsign.length === 3 ? savedCallsign : 'JGG',
    color: savedColor,
    lat: centerLat,
    lon: centerLon,
    targetLat: null,
    targetLon: null,
    heading: 0,
    speed: 0,
    totalDistM: 0,
    isLocal: true,
    isRegistered: false,
    lastSeen: Date.now(),
    trail: []
  };

  // Usuarios remotos dados de alta en la sala actual
  const remoteUsers = new Map();

  // --- 3. ELEMENTOS DOM ---
  const mapContainer = document.getElementById('mapContainer');
  const canvas = document.getElementById('tracksCanvas');
  const ctx = canvas.getContext('2d');

  const userCountEl = document.getElementById('userCount');
  const pointCountEl = document.getElementById('pointCount');
  const myDistStatEl = document.getElementById('myDistStat');
  const wasmTimeEl = document.getElementById('wasmTime');
  const netStatusDot = document.getElementById('netStatusDot');
  const netProviderLabel = document.getElementById('netProviderLabel');

  const registerTopBtn = document.getElementById('registerTopBtn');
  const registerTopBtnLabel = document.getElementById('registerTopBtnLabel');
  const leaveRoomBtn = document.getElementById('leaveRoomBtn');

  const callsignInput = document.getElementById('callsignInput');
  const callsignPreview = document.getElementById('callsignPreview');
  const roomInput = document.getElementById('roomInput');
  const roomBadge = document.getElementById('roomBadge');
  const rosterList = document.getElementById('rosterList');
  const canvasHint = document.getElementById('canvasHint');
  const trailSlider = document.getElementById('trailSlider');
  const trailLabel = document.getElementById('trailLabel');
  const gpsBtn = document.getElementById('gpsBtn');

  const registerModal = document.getElementById('registerModal');
  const registerForm = document.getElementById('registerForm');
  const regCallsignInput = document.getElementById('regCallsignInput');
  const regRoomInput = document.getElementById('regRoomInput');
  const regFeedback = document.getElementById('regFeedback');

  // --- 4. MAPA CARTOGRÁFICO (LEAFLET + FALLBACK MERCATOR) ---
  let map = null;
  let tileLayer = null;
  let fallbackZoom = 15;

  const TILE_URLS = {
    cyber: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    night: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
    sat: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  };

  function initMap() {
    mapContainer.className = 'style-' + mapStyle;

    if (typeof window.L !== 'undefined') {
      map = window.L.map('mapContainer', {
        center: [centerLat, centerLon],
        zoom: 15,
        zoomControl: false,
        attributionControl: true
      });

      tileLayer = window.L.tileLayer(TILE_URLS.cyber, {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap &copy; CARTO'
      }).addTo(map);

      // Click en el mapa para situar o mover tu baliza cuando estás dado de alta
      map.on('click', function (e) {
        if (!localUser.isRegistered) {
          return;
        }
        if (moveMode === 'gps') {
          setMoveMode('manual');
        }
        if (localUser.trail.length === 0) {
          localUser.lat = e.latlng.lat;
          localUser.lon = e.latlng.lng;
          localUser.trail.push({ lat: localUser.lat, lon: localUser.lon, ts: Date.now() });
          broadcastPosition(true);
        } else {
          localUser.targetLat = e.latlng.lat;
          localUser.targetLon = e.latlng.lng;
        }
        if (canvasHint) canvasHint.classList.add('fade-out');
      });
    } else {
      mapContainer.addEventListener('pointerdown', function (e) {
        if (!localUser.isRegistered) return;
        const pt = screenToLatLon(e.clientX, e.clientY);
        localUser.targetLat = pt.lat;
        localUser.targetLon = pt.lon;
      });
    }
  }

  function setMapStyle(style) {
    mapStyle = style;
    mapContainer.className = 'style-' + style;
    if (map && tileLayer && TILE_URLS[style]) {
      tileLayer.setUrl(TILE_URLS[style]);
    }
  }

  function latLonToScreen(lat, lon) {
    if (map) {
      const pt = map.latLngToContainerPoint([lat, lon]);
      return { x: pt.x, y: pt.y };
    }
    const scale = (Math.pow(2, fallbackZoom) * 256) / 360;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const x = canvas.width * 0.5 + (lon - centerLon) * scale * cosLat;
    const y = canvas.height * 0.5 - (lat - centerLat) * scale;
    return { x, y };
  }

  function screenToLatLon(x, y) {
    if (map) {
      const ll = map.containerPointToLatLng([x, y]);
      return { lat: ll.lat, lon: ll.lng };
    }
    const scale = (Math.pow(2, fallbackZoom) * 256) / 360;
    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const lon = centerLon + (x - canvas.width * 0.5) / (scale * cosLat);
    const lat = centerLat - (y - canvas.height * 0.5) / scale;
    return { lat, lon };
  }

  // --- 5. FUNCIONES GEODÉSICAS (RUST WASM + FALLBACK JS) ---
  function haversineMeters(lat1, lon1, lat2, lon2) {
    if (wasmExports && wasmExports.haversine_meters) {
      return wasmExports.haversine_meters(lat1, lon1, lat2, lon2);
    }
    const R = 6371000;
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
      Math.sin(dLat * 0.5) ** 2 +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon * 0.5) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function computeBearing(lat1, lon1, lat2, lon2) {
    if (wasmExports && wasmExports.compute_bearing) {
      return wasmExports.compute_bearing(lat1, lon1, lat2, lon2);
    }
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x =
      Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
      Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    return (Math.atan2(y, x) * toDeg + 360) % 360;
  }

  function appendTrackPoint(user, lat, lon, minStepMeters = 2.0) {
    const trail = user.trail;
    const now = Date.now();
    if (trail.length === 0) {
      trail.push({ lat, lon, ts: now });
      return true;
    }
    const last = trail[trail.length - 1];
    const dist = haversineMeters(last.lat, last.lon, lat, lon);
    if (dist >= minStepMeters) {
      user.heading = computeBearing(last.lat, last.lon, lat, lon);
      user.totalDistM += dist;
      trail.push({ lat, lon, ts: now });
      while (trail.length > maxTrailPoints) {
        trail.shift();
      }
      return true;
    }
    return false;
  }

  // --- 6. ALTA Y BAJA DE USUARIO EN EL MAPA ---
  function registerLocalUser(callsign3, colorHex, roomCode, initialMode) {
    const cleanId = String(callsign3 || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3);
    if (cleanId.length !== 3) {
      if (regFeedback) regFeedback.textContent = '⚠️ Introduce exactamente 3 letras o números (ej. JGG)';
      return false;
    }

    const cleanRoom = String(roomCode || 'SALA-JG1')
      .toUpperCase()
      .replace(/[^A-Z0-9-_]/g, '')
      .slice(0, 14) || 'SALA-JG1';

    const roomChanged = cleanRoom !== currentRoom;
    currentRoom = cleanRoom;

    localUser.id = cleanId;
    localUser.color = colorHex || localUser.color;
    localUser.isRegistered = true;
    localUser.lastSeen = Date.now();

    if (map) {
      const c = map.getCenter();
      localUser.lat = c.lat;
      localUser.lon = c.lng;
      centerLat = c.lat;
      centerLon = c.lng;
    }

    localUser.targetLat = null;
    localUser.targetLon = null;
    localUser.totalDistM = 0;
    localUser.trail = [{ lat: localUser.lat, lon: localUser.lon, ts: Date.now() }];

    // Guardar preferencias
    localStorage.setItem('jg_tracks_callsign', localUser.id);
    localStorage.setItem('jg_tracks_color', localUser.color);
    localStorage.setItem('jg_tracks_room', currentRoom);

    // Sincronizar UI del dock y barra superior
    callsignInput.value = localUser.id;
    callsignPreview.textContent = localUser.id;
    roomInput.value = currentRoom;
    roomBadge.textContent = currentRoom;
    registerTopBtnLabel.textContent = '🟢 Alta: ' + localUser.id;
    leaveRoomBtn.classList.remove('hidden');

    document.querySelectorAll('.swatch-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.color === localUser.color);
    });

    if (roomChanged) {
      remoteUsers.clear();
      connectRealtimeBackend();
    }

    setMoveMode(initialMode || 'gps');
    broadcastPosition(true);
    renderRoster();

    if (canvasHint) {
      canvasHint.textContent =
        initialMode === 'gps'
          ? `🛰️ Dado de alta como [${localUser.id}] con GPS Real · También puedes hacer clic en el mapa para moverte`
          : `🛰️ Dado de alta como [${localUser.id}] · Haz clic en cualquier calle del mapa o usa WASD/Flechas para pintar tu track`;
    }

    registerModal.classList.add('hidden');
    return true;
  }

  function unregisterLocalUser() {
    if (!localUser.isRegistered) return;
    stopRealGps();
    sendLeavePacket();

    localUser.isRegistered = false;
    localUser.trail = [];
    localUser.totalDistM = 0;
    localUser.targetLat = null;
    localUser.targetLon = null;

    callsignPreview.textContent = '---';
    registerTopBtnLabel.textContent = '➕ Darme de Alta';
    leaveRoomBtn.classList.add('hidden');
    renderRoster();
  }

  // --- 7. GESTOR HÍBRIDO DE SINCRONIZACIÓN Y BACKENDS EXTERNOS ---
  let backendConfig = {
    provider: localStorage.getItem('jg_tracks_provider') || 'builtin',
    sbUrl: localStorage.getItem('jg_tracks_sb_url') || '',
    sbKey: localStorage.getItem('jg_tracks_sb_key') || '',
    fbUrl: localStorage.getItem('jg_tracks_fb_url') || '',
    fbSecret: localStorage.getItem('jg_tracks_fb_secret') || '',
    wsUrl: localStorage.getItem('jg_tracks_ws_url') || ''
  };

  let currentRoom = savedRoom;
  let broadcastChan = null;
  let activeSocket = null;
  let fbPollInterval = null;
  let lastBroadcastTs = 0;

  function setNetStatus(state, label) {
    if (!netStatusDot || !netProviderLabel) return;
    netStatusDot.className = 'status-dot ' + state;
    netProviderLabel.textContent = label;
  }

  function buildStatePacket() {
    return {
      type: 'track_pos',
      room: currentRoom,
      uid: localUser.uid,
      id: localUser.id,
      color: localUser.color,
      lat: Number(localUser.lat.toFixed(6)),
      lon: Number(localUser.lon.toFixed(6)),
      heading: Math.round(localUser.heading),
      speed: Number(localUser.speed.toFixed(1)),
      dist: Math.round(localUser.totalDistM),
      trail: localUser.trail.slice(-100).map(p => [Number(p.lat.toFixed(5)), Number(p.lon.toFixed(5))]),
      ts: Date.now()
    };
  }

  function sendRawPacket(pkt) {
    if (broadcastChan) {
      try { broadcastChan.postMessage(pkt); } catch (_) {}
    }

    const provider = backendConfig.provider;
    if (provider === 'builtin' && activeSocket && activeSocket.readyState === 1) {
      try {
        const topic = 'javiergalilea/pr_tracks/' + currentRoom;
        activeSocket.send(buildMqttPublish(topic, JSON.stringify(pkt)));
      } catch (_) {}
    } else if (provider === 'supabase' && activeSocket && activeSocket.readyState === 1) {
      activeSocket.send(
        JSON.stringify({
          topic: 'realtime:tracks_' + currentRoom,
          event: 'broadcast',
          payload: { type: 'broadcast', event: 'pos', payload: pkt },
          ref: String(Date.now())
        })
      );
    } else if (provider === 'custom_ws' && activeSocket && activeSocket.readyState === 1) {
      activeSocket.send(JSON.stringify(pkt));
    } else if (provider === 'firebase' && backendConfig.fbUrl && pkt.type === 'track_pos') {
      const baseUrl = backendConfig.fbUrl.replace(/\/+$/, '');
      const authParam = backendConfig.fbSecret
        ? '?auth=' + encodeURIComponent(backendConfig.fbSecret)
        : '';
      fetch(
        `${baseUrl}/rooms/${encodeURIComponent(currentRoom)}/users/${encodeURIComponent(localUser.id + '_' + localUser.uid)}.json${authParam}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pkt)
        }
      ).catch(function () {});
    }
  }

  function sendSyncRequest() {
    sendRawPacket({
      type: 'track_sync_req',
      room: currentRoom,
      uid: localUser.uid,
      ts: Date.now()
    });
  }

  function sendLeavePacket() {
    sendRawPacket({
      type: 'track_leave',
      room: currentRoom,
      uid: localUser.uid,
      id: localUser.id,
      ts: Date.now()
    });

    if (backendConfig.provider === 'firebase' && backendConfig.fbUrl) {
      const baseUrl = backendConfig.fbUrl.replace(/\/+$/, '');
      const authParam = backendConfig.fbSecret
        ? '?auth=' + encodeURIComponent(backendConfig.fbSecret)
        : '';
      fetch(
        `${baseUrl}/rooms/${encodeURIComponent(currentRoom)}/users/${encodeURIComponent(localUser.id + '_' + localUser.uid)}.json${authParam}`,
        { method: 'DELETE' }
      ).catch(function () {});
    }
  }

  function handleIncomingPacket(pkt) {
    if (!pkt || typeof pkt !== 'object') return;
    if (pkt.room && pkt.room !== currentRoom) return;
    if (pkt.uid === localUser.uid) return;

    // Si otro navegador entra a la sala y pide sincronización, responder con nuestra posición si estamos dados de alta
    if (pkt.type === 'track_sync_req') {
      if (localUser.isRegistered) {
        broadcastPosition(true);
      }
      return;
    }

    // Si un usuario se da de baja de la sala, eliminarlo del mapa inmediatamente
    if (pkt.type === 'track_leave') {
      if (pkt.uid && remoteUsers.has(pkt.uid)) {
        remoteUsers.delete(pkt.uid);
        renderRoster();
      }
      return;
    }

    if (pkt.type !== 'track_pos') return;

    const cleanId = String(pkt.id || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 3);
    if (cleanId.length !== 3) return;

    const key = pkt.uid || ('rem_' + cleanId);
    let rUser = remoteUsers.get(key);

    if (!rUser) {
      rUser = {
        uid: key,
        id: cleanId,
        color: pkt.color || '#38bdf8',
        lat: Number(pkt.lat) || centerLat,
        lon: Number(pkt.lon) || centerLon,
        heading: Number(pkt.heading) || 0,
        speed: Number(pkt.speed) || 0,
        totalDistM: Number(pkt.dist) || 0,
        isLocal: false,
        lastSeen: Date.now(),
        trail: []
      };
      if (Array.isArray(pkt.trail) && pkt.trail.length > 0) {
        rUser.trail = pkt.trail.map(pair => ({
          lat: Number(pair[0]),
          lon: Number(pair[1]),
          ts: Date.now()
        }));
      } else {
        rUser.trail.push({ lat: rUser.lat, lon: rUser.lon, ts: Date.now() });
      }
      remoteUsers.set(key, rUser);
      renderRoster();
    } else {
      rUser.id = cleanId;
      rUser.color = pkt.color || rUser.color;
      rUser.lat = Number(pkt.lat);
      rUser.lon = Number(pkt.lon);
      rUser.heading = Number(pkt.heading) || rUser.heading;
      rUser.speed = Number(pkt.speed) || 0;
      rUser.totalDistM = Number(pkt.dist) || rUser.totalDistM;
      rUser.lastSeen = Date.now();
      appendTrackPoint(rUser, rUser.lat, rUser.lon, 1.5);
    }
  }

  function disconnectBackends() {
    if (broadcastChan) {
      broadcastChan.close();
      broadcastChan = null;
    }
    if (activeSocket) {
      try { activeSocket.close(); } catch (_) {}
      activeSocket = null;
    }
    if (fbPollInterval) {
      clearInterval(fbPollInterval);
      fbPollInterval = null;
    }
  }

  function encodeMqttUtf8(str) {
    const bytes = new TextEncoder().encode(str);
    const out = new Uint8Array(2 + bytes.length);
    out[0] = (bytes.length >> 8) & 0xff;
    out[1] = bytes.length & 0xff;
    out.set(bytes, 2);
    return out;
  }

  function encodeMqttRemainingLength(len) {
    const out = [];
    do {
      let digit = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) digit |= 0x80;
      out.push(digit);
    } while (len > 0);
    return new Uint8Array(out);
  }

  function buildMqttPublish(topic, jsonStr) {
    const tBytes = encodeMqttUtf8(topic);
    const pBytes = new TextEncoder().encode(jsonStr);
    const rem = encodeMqttRemainingLength(tBytes.length + pBytes.length);
    const pkt = new Uint8Array(1 + rem.length + tBytes.length + pBytes.length);
    pkt[0] = 0x30;
    pkt.set(rem, 1);
    pkt.set(tBytes, 1 + rem.length);
    pkt.set(pBytes, 1 + rem.length + tBytes.length);
    return pkt;
  }

  function connectBuiltinMqttRelay() {
    setNetStatus('online', 'LIVE · ' + currentRoom);
    try {
      const ws = new WebSocket('wss://broker.emqx.io:8084/mqtt', 'mqtt');
      ws.binaryType = 'arraybuffer';
      activeSocket = ws;
      const topic = 'javiergalilea/pr_tracks/' + currentRoom;

      ws.onopen = function () {
        const proto = new Uint8Array([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c]);
        const cid = encodeMqttUtf8('jg_' + localUser.uid);
        const rem = encodeMqttRemainingLength(proto.length + cid.length);
        const connPkt = new Uint8Array(1 + rem.length + proto.length + cid.length);
        connPkt[0] = 0x10;
        connPkt.set(rem, 1);
        connPkt.set(proto, 1 + rem.length);
        connPkt.set(cid, 1 + rem.length + proto.length);
        ws.send(connPkt);

        const subTopic = encodeMqttUtf8(topic);
        const subRem = encodeMqttRemainingLength(2 + subTopic.length + 1);
        const subPkt = new Uint8Array(1 + subRem.length + 2 + subTopic.length + 1);
        subPkt[0] = 0x82;
        subPkt.set(subRem, 1);
        subPkt[1 + subRem.length] = 0x00;
        subPkt[2 + subRem.length] = 0x01;
        subPkt.set(subTopic, 3 + subRem.length);
        subPkt[subPkt.length - 1] = 0x00;
        ws.send(subPkt);

        setNetStatus('online', 'LIVE · ' + currentRoom);
        sendSyncRequest();
        if (localUser.isRegistered) {
          broadcastPosition(true);
        }
      };

      ws.onmessage = function (ev) {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const buf = new Uint8Array(ev.data);
        if (buf.length < 4 || (buf[0] & 0xf0) !== 0x30) return;
        let idx = 1;
        while (idx < buf.length && (buf[idx] & 0x80) !== 0) idx++;
        idx++;
        if (idx + 2 > buf.length) return;
        const topicLen = (buf[idx] << 8) | buf[idx + 1];
        const payloadStart = idx + 2 + topicLen;
        if (payloadStart >= buf.length) return;
        try {
          const jsonStr = new TextDecoder().decode(buf.subarray(payloadStart));
          handleIncomingPacket(JSON.parse(jsonStr));
        } catch (_) {}
      };

      ws.onerror = function () {
        setNetStatus('online', 'LOCAL · ' + currentRoom);
      };
    } catch (_) {
      setNetStatus('online', 'LOCAL · ' + currentRoom);
    }
  }

  function connectRealtimeBackend() {
    disconnectBackends();

    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChan = new BroadcastChannel('jg_tracks_room_' + currentRoom);
      broadcastChan.onmessage = function (ev) {
        handleIncomingPacket(ev.data);
      };
      sendSyncRequest();
    }

    const provider = backendConfig.provider;

    if (provider === 'supabase' && backendConfig.sbUrl && backendConfig.sbKey) {
      connectSupabaseRealtime();
    } else if (provider === 'firebase' && backendConfig.fbUrl) {
      connectFirebaseRTDB();
    } else if (provider === 'custom_ws' && backendConfig.wsUrl) {
      connectCustomWebSocket(backendConfig.wsUrl, 'WS PROPIO');
    } else {
      connectBuiltinMqttRelay();
    }
  }

  function connectCustomWebSocket(wsUrl, badgeText) {
    setNetStatus('connecting', 'CONECTANDO...');
    try {
      const ws = new WebSocket(wsUrl);
      activeSocket = ws;
      ws.onopen = function () {
        setNetStatus('online', badgeText);
        sendSyncRequest();
        if (localUser.isRegistered) broadcastPosition(true);
      };
      ws.onmessage = function (ev) {
        try {
          handleIncomingPacket(JSON.parse(ev.data));
        } catch (_) {}
      };
      ws.onerror = function () {
        setNetStatus('connecting', 'LOCAL · ' + currentRoom);
      };
      ws.onclose = function () {
        setNetStatus('connecting', 'LOCAL · ' + currentRoom);
      };
    } catch (_) {
      setNetStatus('connecting', 'LOCAL · ' + currentRoom);
    }
  }

  function connectSupabaseRealtime() {
    setNetStatus('connecting', 'SUPABASE...');
    try {
      const cleanUrl = backendConfig.sbUrl.replace(/\/+$/, '');
      const wsEndpoint =
        cleanUrl.replace(/^http/, 'ws') +
        '/realtime/v1/websocket?apikey=' +
        encodeURIComponent(backendConfig.sbKey) +
        '&vsn=1.0.0';

      const ws = new WebSocket(wsEndpoint);
      activeSocket = ws;
      const topic = 'realtime:tracks_' + currentRoom;

      ws.onopen = function () {
        setNetStatus('online', 'SUPABASE RT');
        ws.send(
          JSON.stringify({
            topic: topic,
            event: 'phx_join',
            payload: { config: { broadcast: { self: false } } },
            ref: '1'
          })
        );
        setTimeout(function () {
          sendSyncRequest();
          if (localUser.isRegistered) broadcastPosition(true);
        }, 300);
      };

      ws.onmessage = function (ev) {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.event === 'broadcast' && msg.payload && msg.payload.payload) {
            handleIncomingPacket(msg.payload.payload);
          }
        } catch (_) {}
      };

      ws.onerror = function () {
        setNetStatus('connecting', 'SB ERROR');
      };
    } catch (_) {
      setNetStatus('connecting', 'SB ERROR');
    }
  }

  function connectFirebaseRTDB() {
    setNetStatus('connecting', 'FIREBASE...');
    const baseUrl = backendConfig.fbUrl.replace(/\/+$/, '');
    const authParam = backendConfig.fbSecret
      ? '?auth=' + encodeURIComponent(backendConfig.fbSecret)
      : '';

    async function syncFirebaseRoom() {
      try {
        const res = await fetch(
          `${baseUrl}/rooms/${encodeURIComponent(currentRoom)}/users.json${authParam}`
        );
        if (!res.ok) return;
        setNetStatus('online', 'FIREBASE DB');
        const usersObj = await res.json();
        if (!usersObj || typeof usersObj !== 'object') return;
        for (const key of Object.keys(usersObj)) {
          handleIncomingPacket(usersObj[key]);
        }
      } catch (_) {}
    }

    syncFirebaseRoom();
    fbPollInterval = setInterval(syncFirebaseRoom, 1500);
  }

  function broadcastPosition(force = false) {
    if (!localUser.isRegistered) return;
    const now = Date.now();
    if (!force && now - lastBroadcastTs < 180) return;
    lastBroadcastTs = now;
    sendRawPacket(buildStatePacket());
  }

  // Heartbeat periódico para que los usuarios dados de alta mantengan presencia viva en la sala
  setInterval(function () {
    if (localUser.isRegistered) {
      broadcastPosition(true);
    }
  }, 3500);

  window.addEventListener('beforeunload', function () {
    if (localUser.isRegistered) {
      sendLeavePacket();
    }
  });

  // --- 8. CONTROLES DE TECLADO Y MODOS DE POSICIÓN ---
  const keysPressed = { up: false, down: false, left: false, right: false };

  window.addEventListener('keydown', function (e) {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      return;
    }
    if (e.key === 'Escape') {
      document.body.classList.remove('clean-mode');
      document.getElementById('backendModal').classList.add('hidden');
      registerModal.classList.add('hidden');
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') keysPressed.up = true;
    if (k === 's' || e.key === 'ArrowDown') keysPressed.down = true;
    if (k === 'a' || e.key === 'ArrowLeft') keysPressed.left = true;
    if (k === 'd' || e.key === 'ArrowRight') keysPressed.right = true;
  });

  window.addEventListener('keyup', function (e) {
    const k = e.key.toLowerCase();
    if (k === 'w' || e.key === 'ArrowUp') keysPressed.up = false;
    if (k === 's' || e.key === 'ArrowDown') keysPressed.down = false;
    if (k === 'a' || e.key === 'ArrowLeft') keysPressed.left = false;
    if (k === 'd' || e.key === 'ArrowRight') keysPressed.right = false;
  });

  function setMoveMode(mode) {
    moveMode = mode;
    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (mode === 'gps' && localUser.isRegistered) {
      startRealGps();
    } else {
      stopRealGps();
    }
  }

  function startRealGps() {
    if (!navigator.geolocation) {
      setMoveMode('manual');
      return;
    }
    stopRealGps();
    gpsBtn.classList.add('active');
    let firstFix = true;

    gpsWatchId = navigator.geolocation.watchPosition(
      function (pos) {
        if (!localUser.isRegistered) return;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const prevLat = localUser.lat;
        const prevLon = localUser.lon;
        localUser.lat = lat;
        localUser.lon = lon;

        if (firstFix) {
          firstFix = false;
          localUser.trail = [{ lat, lon, ts: Date.now() }];
          centerLat = lat;
          centerLon = lon;
          if (map) map.flyTo([lat, lon], 16, { duration: 0.8 });
        } else {
          if (pos.coords.speed !== null && !isNaN(pos.coords.speed)) {
            localUser.speed = pos.coords.speed * 3.6;
          } else {
            const d = haversineMeters(prevLat, prevLon, lat, lon);
            localUser.speed = Math.min(160, d * 3.6);
          }
          appendTrackPoint(localUser, lat, lon, 1.5);
        }
        broadcastPosition(true);
      },
      function () {
        gpsBtn.classList.remove('active');
        setMoveMode('manual');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  function stopRealGps() {
    gpsBtn.classList.remove('active');
    if (gpsWatchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
  }

  // --- 9. ACTUALIZACIÓN FÍSICA & TELEMETRÍA EN CADA FRAME ---
  function formatDistance(meters) {
    if (meters >= 1000) {
      return (meters / 1000).toFixed(2) + ' km';
    }
    return Math.round(meters) + ' m';
  }

  function updateSimulation(dt) {
    const t0 = performance.now();

    if (localUser.isRegistered) {
      const stepDeg = 0.00045 * dt * 60;
      let movedByKeys = false;
      let dLat = 0;
      let dLon = 0;

      if (keysPressed.up) { dLat += stepDeg; movedByKeys = true; }
      if (keysPressed.down) { dLat -= stepDeg; movedByKeys = true; }
      if (keysPressed.left) { dLon -= stepDeg * 1.25; movedByKeys = true; }
      if (keysPressed.right) { dLon += stepDeg * 1.25; movedByKeys = true; }

      if (movedByKeys) {
        localUser.targetLat = null;
        localUser.targetLon = null;
        const nextLat = localUser.lat + dLat;
        const nextLon = localUser.lon + dLon;
        const dist = haversineMeters(localUser.lat, localUser.lon, nextLat, nextLon);
        localUser.heading = computeBearing(localUser.lat, localUser.lon, nextLat, nextLon);
        localUser.speed = (dist / Math.max(0.008, dt)) * 3.6;
        localUser.lat = nextLat;
        localUser.lon = nextLon;
        appendTrackPoint(localUser, nextLat, nextLon, 2.0);
        broadcastPosition();
      } else if (moveMode === 'manual' && localUser.targetLat !== null && localUser.targetLon !== null) {
        const distToTarget = haversineMeters(
          localUser.lat,
          localUser.lon,
          localUser.targetLat,
          localUser.targetLon
        );
        if (distToTarget > 3.5) {
          const moveRatio = Math.min(1, (dt * 120) / Math.max(15, distToTarget));
          const nextLat = localUser.lat + (localUser.targetLat - localUser.lat) * moveRatio;
          const nextLon = localUser.lon + (localUser.targetLon - localUser.lon) * moveRatio;
          const stepM = haversineMeters(localUser.lat, localUser.lon, nextLat, nextLon);
          localUser.heading = computeBearing(localUser.lat, localUser.lon, nextLat, nextLon);
          localUser.speed = Math.min(120, (stepM / Math.max(0.008, dt)) * 3.6);
          localUser.lat = nextLat;
          localUser.lon = nextLon;
          appendTrackPoint(localUser, nextLat, nextLon, 2.0);
          broadcastPosition();
        } else {
          localUser.targetLat = null;
          localUser.targetLon = null;
          localUser.speed *= 0.8;
        }
      } else {
        localUser.speed *= 0.9;
      }

      // Analizar track del usuario local en el motor Rust WASM
      if (wasmExports && wasmMemory && trackPointsPtr && localUser.trail.length > 1) {
        const count = Math.min(MAX_TRACK_POINTS, localUser.trail.length);
        const tView = new Float32Array(wasmMemory.buffer, trackPointsPtr, count * 4);
        for (let i = 0; i < count; i++) {
          const pt = localUser.trail[i];
          tView[i * 4] = pt.lat;
          tView[i * 4 + 1] = pt.lon;
          tView[i * 4 + 2] = pt.ts * 0.001;
        }
        wasmExports.analyze_track(count);
      }
    }

    lastWasmMs = performance.now() - t0;
  }

  // --- 10. RENDERIZADO DEL LIENZO TÁCTICO Y TRACKS NEÓN (SOLO DADOS DE ALTA) ---
  function getAllRegisteredUsers() {
    const now = Date.now();
    const list = [];
    if (localUser.isRegistered) {
      list.push(localUser);
    }
    remoteUsers.forEach(function (u, key) {
      if (now - u.lastSeen < 60000) {
        list.push(u);
      } else {
        remoteUsers.delete(key);
      }
    });
    return list;
  }

  function renderCanvas(nowMs) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const nowSec = nowMs * 0.001;
    const users = getAllRegisteredUsers();

    // Si estamos en modo Radar Puro o hay un usuario local dado de alta, dibujar rejilla sutil
    if (mapStyle === 'grid' || localUser.isRegistered) {
      const refPt = localUser.isRegistered
        ? latLonToScreen(localUser.lat, localUser.lon)
        : { x: w * 0.5, y: h * 0.5 };

      ctx.save();
      ctx.strokeStyle = mapStyle === 'grid' ? 'rgba(0, 245, 212, 0.12)' : 'rgba(0, 245, 212, 0.04)';
      ctx.lineWidth = 1;
      const gridStep = 90;
      for (let x = (refPt.x % gridStep + gridStep) % gridStep; x < w; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = (refPt.y % gridStep + gridStep) % gridStep; y < h; y += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    let totalPoints = 0;

    // 1. Pintar el track (estela luminosa) de cada usuario dado de alta
    for (const u of users) {
      const trail = u.trail;
      totalPoints += trail.length;
      if (trail.length < 2) continue;

      const screenPts = trail.map(p => latLonToScreen(p.lat, p.lon));

      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = u.color;
      ctx.shadowColor = u.color;
      ctx.shadowBlur = 14;
      ctx.globalAlpha = u.isLocal ? 0.45 : 0.35;
      ctx.lineWidth = u.isLocal ? 7 : 5.5;
      ctx.beginPath();
      for (let i = 0; i < screenPts.length; i++) {
        if (i === 0) ctx.moveTo(screenPts[i].x, screenPts[i].y);
        else ctx.lineTo(screenPts[i].x, screenPts[i].y);
      }
      ctx.stroke();

      // Núcleo nítido del track
      ctx.shadowBlur = 4;
      ctx.globalAlpha = u.isLocal ? 0.95 : 0.88;
      ctx.lineWidth = u.isLocal ? 2.8 : 2.4;
      ctx.stroke();

      // Punto de inicio del track
      const startPt = screenPts[0];
      ctx.fillStyle = u.color;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(startPt.x, startPt.y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Pulso de energía viajando por el track
      if (screenPts.length >= 3) {
        const pulseFloat = ((nowSec * 1.4) % 1) * (screenPts.length - 1);
        const pIdx = Math.floor(pulseFloat);
        const frac = pulseFloat - pIdx;
        const p1 = screenPts[pIdx];
        const p2 = screenPts[Math.min(screenPts.length - 1, pIdx + 1)];
        const px = p1.x + (p2.x - p1.x) * frac;
        const py = p1.y + (p2.y - p1.y) * frac;

        ctx.globalAlpha = 0.95;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 2. Si el usuario local tiene un destino marcado con click, dibujar línea guía
    if (localUser.isRegistered && moveMode === 'manual' && localUser.targetLat !== null && localUser.targetLon !== null) {
      const meScreen = latLonToScreen(localUser.lat, localUser.lon);
      const targetScreen = latLonToScreen(localUser.targetLat, localUser.targetLon);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = localUser.color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(meScreen.x, meScreen.y);
      ctx.lineTo(targetScreen.x, targetScreen.y);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(targetScreen.x, targetScreen.y, 5 + Math.sin(nowSec * 6) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Pintar la baliza actual y la etiqueta de 3 LETRAS de cada usuario dado de alta
    for (const u of users) {
      const pos = latLonToScreen(u.lat, u.lon);
      const radHeading = ((u.heading - 90) * Math.PI) / 180;

      ctx.save();

      // Cono direccional de rumbo
      ctx.translate(pos.x, pos.y);
      ctx.rotate(radHeading);
      const coneGrad = ctx.createLinearGradient(0, 0, 28, 0);
      coneGrad.addColorStop(0, u.color);
      coneGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coneGrad;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 28, -0.38, 0.38);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Halo pulsante
      ctx.save();
      const pulseR = (u.isLocal ? 14 : 11) + Math.sin(nowSec * 4.2 + u.id.charCodeAt(0)) * 3.5;
      ctx.strokeStyle = u.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pulseR, 0, Math.PI * 2);
      ctx.stroke();

      // Punto central luminoso
      ctx.shadowColor = u.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = u.color;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, u.isLocal ? 6.5 : 5.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#05070c';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2.3, 0, Math.PI * 2);
      ctx.fill();

      // Etiqueta táctica con las 3 letras (ej. [JGG])
      const labelY = pos.y - 24;
      const badgeW = 48;
      const badgeH = 20;
      const badgeX = pos.x - badgeW * 0.5;

      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
      ctx.fillStyle = 'rgba(8, 12, 21, 0.92)';
      ctx.strokeStyle = u.color;
      ctx.lineWidth = u.isLocal ? 1.8 : 1.4;
      ctx.beginPath();
      ctx.roundRect(badgeX, labelY - badgeH * 0.5, badgeW, badgeH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = u.isLocal ? '#ffffff' : u.color;
      ctx.font = '800 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(u.id, pos.x, labelY + 0.5);

      if (u.totalDistM > 5) {
        ctx.fillStyle = 'rgba(226, 232, 240, 0.88)';
        ctx.font = '600 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.fillText(formatDistance(u.totalDistM), pos.x, labelY - 15);
      }

      ctx.restore();
    }

    // Actualizar contadores de la barra superior
    if (userCountEl) userCountEl.textContent = String(users.length);
    if (pointCountEl) pointCountEl.textContent = String(totalPoints);
    if (myDistStatEl) myDistStatEl.textContent = formatDistance(localUser.totalDistM);
    if (wasmTimeEl) wasmTimeEl.textContent = lastWasmMs.toFixed(2);
  }

  // --- 11. ACTUALIZAR PANEL LATERAL DE USUARIOS DADOS DE ALTA ---
  function renderRoster() {
    if (!rosterList) return;
    const users = getAllRegisteredUsers();
    rosterList.innerHTML = '';

    if (users.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'roster-empty';
      emptyLi.innerHTML = 'Ningún usuario dado de alta en esta sala.<br>Pulsa <strong>«➕ Darme de Alta»</strong> para entrar con tus 3 letras.';
      rosterList.appendChild(emptyLi);
      return;
    }

    for (const u of users) {
      const li = document.createElement('li');
      li.className = 'roster-item' + (u.isLocal ? ' is-me' : '');
      const roleTag = u.isLocal ? 'Tú (Dado de alta)' : 'Usuario en vivo';

      li.innerHTML = `
        <div class="roster-user-left">
          <span class="callsign-pill" style="background:${u.color}">${u.id}</span>
          <div class="roster-meta">
            <span class="roster-role">${roleTag}</span>
            <span class="roster-coords">${u.lat.toFixed(4)}, ${u.lon.toFixed(4)}</span>
          </div>
        </div>
        <div class="roster-stats">
          <span class="roster-dist">${formatDistance(u.totalDistM)}</span>
          <span class="roster-speed">${Math.round(u.speed)} km/h</span>
        </div>
      `;

      li.addEventListener('click', function () {
        centerLat = u.lat;
        centerLon = u.lon;
        if (map) map.flyTo([u.lat, u.lon], Math.max(map.getZoom(), 15), { duration: 0.7 });
      });

      rosterList.appendChild(li);
    }
  }

  // --- 12. EXPORTACIÓN DE TRACKS A GPX ---
  function exportTracksToGpx() {
    const users = getAllRegisteredUsers();
    const isoNow = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    gpx += `<gpx version="1.1" creator="javiergalilea.es/pr_tracks" xmlns="http://www.topografix.com/GPX/1/1">\n`;
    gpx += `  <metadata><name>Tracks Sala ${currentRoom}</name><time>${isoNow}</time></metadata>\n`;

    for (const u of users) {
      gpx += `  <trk>\n    <name>${u.id}</name>\n    <trkseg>\n`;
      for (const pt of u.trail) {
        const t = new Date(pt.ts).toISOString();
        gpx += `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lon.toFixed(6)}"><time>${t}</time></trkpt>\n`;
      }
      gpx += `    </trkseg>\n  </trk>\n`;
    }
    gpx += `</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracks_${currentRoom}_${localUser.id || 'sala'}.gpx`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- 13. EVENTOS DE INTERFAZ Y MODALES ---
  function bindUiEvents() {
    let regSelectedColor = localUser.color;
    let regSelectedMode = 'gps';

    // Inicializar campos del modal de Alta
    regCallsignInput.value = savedCallsign || '';
    regRoomInput.value = currentRoom;
    roomInput.value = currentRoom;
    roomBadge.textContent = currentRoom;

    regCallsignInput.addEventListener('input', function () {
      regCallsignInput.value = regCallsignInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3);
    });

    document.querySelectorAll('.reg-swatch-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.color === regSelectedColor);
      btn.addEventListener('click', function () {
        document.querySelectorAll('.reg-swatch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        regSelectedColor = btn.dataset.color;
      });
    });

    document.querySelectorAll('.reg-mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.reg-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        regSelectedMode = btn.dataset.mode;
      });
    });

    registerForm.addEventListener('submit', function (e) {
      e.preventDefault();
      registerLocalUser(
        regCallsignInput.value,
        regSelectedColor,
        regRoomInput.value,
        regSelectedMode
      );
    });

    document.getElementById('closeRegisterBtn').addEventListener('click', function () {
      registerModal.classList.add('hidden');
    });

    document.getElementById('watchOnlyBtn').addEventListener('click', function () {
      registerModal.classList.add('hidden');
    });

    registerTopBtn.addEventListener('click', function () {
      regCallsignInput.value = localUser.isRegistered ? localUser.id : (savedCallsign || '');
      regRoomInput.value = currentRoom;
      registerModal.classList.remove('hidden');
      regCallsignInput.focus();
    });

    leaveRoomBtn.addEventListener('click', function () {
      unregisterLocalUser();
    });

    // Swatches de color del dock inferior
    document.querySelectorAll('.swatch-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.color === localUser.color);
      btn.addEventListener('click', function () {
        document.querySelectorAll('.swatch-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        localUser.color = btn.dataset.color;
        regSelectedColor = localUser.color;
        localStorage.setItem('jg_tracks_color', localUser.color);
        if (localUser.isRegistered) {
          broadcastPosition(true);
          renderRoster();
        }
      });
    });

    // Input de 3 letras en el dock inferior
    callsignInput.addEventListener('input', function () {
      const cleaned = callsignInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 3);
      callsignInput.value = cleaned;
      if (cleaned.length === 3) {
        if (!localUser.isRegistered) {
          registerLocalUser(cleaned, localUser.color, currentRoom, moveMode);
        } else {
          localUser.id = cleaned;
          callsignPreview.textContent = localUser.id;
          registerTopBtnLabel.textContent = '🟢 Alta: ' + localUser.id;
          localStorage.setItem('jg_tracks_callsign', localUser.id);
          broadcastPosition(true);
          renderRoster();
        }
      }
    });

    function applyRoomChange() {
      const cleaned = roomInput.value
        .toUpperCase()
        .replace(/[^A-Z0-9-_]/g, '')
        .slice(0, 14) || 'SALA-JG1';
      if (localUser.isRegistered && cleaned !== currentRoom) {
        sendLeavePacket();
      }
      roomInput.value = cleaned;
      currentRoom = cleaned;
      roomBadge.textContent = currentRoom;
      localStorage.setItem('jg_tracks_room', currentRoom);
      remoteUsers.clear();
      connectRealtimeBackend();
      renderRoster();
    }

    document.getElementById('joinRoomBtn').addEventListener('click', applyRoomChange);
    roomInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') applyRoomChange();
    });

    // Modos de posición
    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setMoveMode(btn.dataset.mode);
      });
    });

    gpsBtn.addEventListener('click', function () {
      if (!localUser.isRegistered) {
        registerModal.classList.remove('hidden');
        return;
      }
      if (moveMode === 'gps') {
        setMoveMode('manual');
      } else {
        setMoveMode('gps');
      }
    });

    // Estilos de mapa
    document.querySelectorAll('.mapstyle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.mapstyle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        setMapStyle(btn.dataset.style);
      });
    });

    // Saltos rápidos de vista de ciudad
    document.querySelectorAll('.city-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.city-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const lat = parseFloat(btn.dataset.lat);
        const lon = parseFloat(btn.dataset.lon);
        centerLat = lat;
        centerLon = lon;
        if (map) map.flyTo([lat, lon], 15, { duration: 0.9 });
      });
    });

    // Longitud de estela
    trailSlider.addEventListener('input', function () {
      maxTrailPoints = parseInt(trailSlider.value, 10);
      trailLabel.textContent = maxTrailPoints + ' pts';
    });

    // Centrar en mí e Invitar
    document.getElementById('centerMeBtn').addEventListener('click', function () {
      if (!localUser.isRegistered) {
        registerModal.classList.remove('hidden');
        return;
      }
      if (map) map.flyTo([localUser.lat, localUser.lon], 16, { duration: 0.6 });
    });

    document.getElementById('shareRoomBtn').addEventListener('click', function (e) {
      const shareUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(currentRoom)}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shareUrl);
      }
      const btn = e.currentTarget;
      const orig = btn.textContent;
      btn.textContent = '✓ Enlace copiado';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    });

    // Limpiar tracks y Exportar GPX
    document.getElementById('clearTracksBtn').addEventListener('click', function () {
      if (localUser.isRegistered) {
        localUser.trail = [{ lat: localUser.lat, lon: localUser.lon, ts: Date.now() }];
        localUser.totalDistM = 0;
        broadcastPosition(true);
      }
      remoteUsers.forEach(function (u) {
        u.trail = [{ lat: u.lat, lon: u.lon, ts: Date.now() }];
        u.totalDistM = 0;
      });
    });

    document.getElementById('exportGpxBtn').addEventListener('click', exportTracksToGpx);

    // Controles de HUD / Modo limpio / Pantalla completa
    const hudDock = document.getElementById('hudDock');
    document.getElementById('toggleHudBtn').addEventListener('click', function () {
      hudDock.classList.toggle('collapsed');
    });

    document.getElementById('cleanModeBtn').addEventListener('click', function () {
      document.body.classList.add('clean-mode');
    });

    document.getElementById('restoreUiBtn').addEventListener('click', function () {
      document.body.classList.remove('clean-mode');
    });

    document.getElementById('fullscreenBtn').addEventListener('click', function () {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(function () {});
      } else {
        document.exitFullscreen().catch(function () {});
      }
    });

    // Modal de Backend / Base de datos
    const backendModal = document.getElementById('backendModal');
    const sbUrlInput = document.getElementById('sbUrlInput');
    const sbKeyInput = document.getElementById('sbKeyInput');
    const fbUrlInput = document.getElementById('fbUrlInput');
    const fbSecretInput = document.getElementById('fbSecretInput');
    const wsUrlInput = document.getElementById('wsUrlInput');
    const modalConnStatus = document.getElementById('modalConnStatus');

    let selectedProvider = backendConfig.provider;

    function selectProviderTab(prov) {
      selectedProvider = prov;
      document.querySelectorAll('.provider-tab').forEach(function (tab) {
        tab.classList.toggle('active', tab.dataset.provider === prov);
      });
      document.querySelectorAll('.provider-pane').forEach(function (pane) {
        pane.classList.toggle('hidden', pane.dataset.pane !== prov);
      });
    }

    document.getElementById('backendBtn').addEventListener('click', function () {
      sbUrlInput.value = backendConfig.sbUrl;
      sbKeyInput.value = backendConfig.sbKey;
      fbUrlInput.value = backendConfig.fbUrl;
      fbSecretInput.value = backendConfig.fbSecret;
      wsUrlInput.value = backendConfig.wsUrl;
      selectProviderTab(backendConfig.provider);
      modalConnStatus.textContent = 'Proveedor activo: ' + backendConfig.provider.toUpperCase();
      backendModal.classList.remove('hidden');
    });

    document.querySelectorAll('.provider-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        selectProviderTab(tab.dataset.provider);
      });
    });

    document.getElementById('closeModalBtn').addEventListener('click', function () {
      backendModal.classList.add('hidden');
    });

    document.getElementById('cancelBackendBtn').addEventListener('click', function () {
      backendModal.classList.add('hidden');
    });

    document.getElementById('saveBackendBtn').addEventListener('click', function () {
      backendConfig.provider = selectedProvider;
      backendConfig.sbUrl = sbUrlInput.value.trim();
      backendConfig.sbKey = sbKeyInput.value.trim();
      backendConfig.fbUrl = fbUrlInput.value.trim();
      backendConfig.fbSecret = fbSecretInput.value.trim();
      backendConfig.wsUrl = wsUrlInput.value.trim();

      localStorage.setItem('jg_tracks_provider', backendConfig.provider);
      localStorage.setItem('jg_tracks_sb_url', backendConfig.sbUrl);
      localStorage.setItem('jg_tracks_sb_key', backendConfig.sbKey);
      localStorage.setItem('jg_tracks_fb_url', backendConfig.fbUrl);
      localStorage.setItem('jg_tracks_fb_secret', backendConfig.fbSecret);
      localStorage.setItem('jg_tracks_ws_url', backendConfig.wsUrl);

      connectRealtimeBackend();
      modalConnStatus.textContent = '✓ Guardado y reconectado';
      setTimeout(function () {
        backendModal.classList.add('hidden');
      }, 450);
    });
  }

  // --- 14. REDIMENSIONADO Y BUCLE PRINCIPAL ---
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (map) map.invalidateSize();
  }

  window.addEventListener('resize', resizeCanvas);

  async function loadWasmEngine() {
    try {
      const response = await fetch('engine.wasm');
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasmExports = instance.exports;
      wasmMemory = wasmExports.memory;
      trackPointsPtr = wasmExports.get_track_points_ptr();
    } catch (_) {
      wasmExports = null;
    }
  }

  let lastFrameTime = performance.now();
  let lastRosterUpdate = 0;

  function mainLoop(now) {
    const dt = Math.min(0.1, (now - lastFrameTime) * 0.001);
    lastFrameTime = now;

    updateSimulation(dt);
    renderCanvas(now);

    if (now - lastRosterUpdate > 600) {
      lastRosterUpdate = now;
      renderRoster();
    }

    requestAnimationFrame(mainLoop);
  }

  // Inicialización general (0 demos, solo altas reales)
  resizeCanvas();
  initMap();
  bindUiEvents();
  renderRoster();
  loadWasmEngine().then(function () {
    connectRealtimeBackend();
    requestAnimationFrame(mainLoop);
  });
})();

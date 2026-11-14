/**
 * Subproyecto #11: Escáner de Red, Monitor Ping & Identificador LAN (Rust WASM)
 * javiergalilea.es/pr_red/
 */

(function () {
  'use strict';

  const ALIAS_STORAGE_KEY = 'pr_red_aliases_v1';
  const AGENT_URL_STORAGE_KEY = 'pr_red_agent_url_v1';

  const PORT_CATALOG = {
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    53: 'DNS',
    80: 'HTTP',
    139: 'NetBIOS',
    443: 'HTTPS',
    445: 'SMB',
    554: 'RTSP',
    631: 'IPP',
    1883: 'MQTT',
    3389: 'RDP',
    5000: 'UPnP/DSM',
    5001: 'DSM HTTPS',
    5353: 'mDNS',
    5900: 'VNC',
    8006: 'Proxmox',
    8008: 'Cast HTTP',
    8009: 'Cast',
    8080: 'HTTP Alt',
    8443: 'HTTPS Alt',
    9100: 'JetDirect',
    62078: 'iOS Sync',
  };

  const PORT_MASK_MAP = {
    22: 1 << 0,
    23: 1 << 1,
    53: 1 << 2,
    80: 1 << 3,
    443: 1 << 4,
    445: 1 << 5,
    554: 1 << 6,
    631: 1 << 7,
    1883: 1 << 8,
    3389: 1 << 9,
    5000: 1 << 10,
    5001: 1 << 10,
    5353: 1 << 11,
    8008: 1 << 12,
    8009: 1 << 12,
    8080: 1 << 13,
    8443: 1 << 13,
    9100: 1 << 14,
    8006: 1 << 15,
    62078: 1 << 16,
    5900: 1 << 17,
  };

  const CATEGORY_META = {
    0: { label: 'Desconocido', group: 'client', icon: '❔', color: '#94a3b8' },
    1: { label: 'Router / Gateway', group: 'infra', icon: '🌐', color: '#3b82f6' },
    2: { label: 'Switch / Punto Acceso', group: 'infra', icon: '📶', color: '#60a5fa' },
    3: { label: 'NAS / Almacenamiento', group: 'server', icon: '🗄️', color: '#00f5d4' },
    4: { label: 'Servidor / VM / SBC', group: 'server', icon: '🖥️', color: '#2dd4bf' },
    5: { label: 'Ordenador / Workstation', group: 'client', icon: '💻', color: '#38bdf8' },
    6: { label: 'Móvil / Tablet', group: 'client', icon: '📱', color: '#a855f7' },
    7: { label: 'Impresora / Escáner', group: 'media', icon: '🖨️', color: '#fbbf24' },
    8: { label: 'Smart TV / Multimedia', group: 'media', icon: '📺', color: '#c084fc' },
    9: { label: 'Domótica / IoT', group: 'iot', icon: '💡', color: '#34d399' },
    10: { label: 'Cámara IP / Seguridad', group: 'iot', icon: '📷', color: '#f472b6' },
  };

  const OS_LABELS = {
    0: 'Indeterminado',
    1: 'Linux / Unix / Android',
    2: 'Microsoft Windows',
    3: 'Apple macOS / iOS',
    4: 'Firmware Router / Red',
    5: 'RTOS / Embebido IoT',
    6: 'Hipervisor / Virtual NIC',
  };

  const SCOPE_LABELS = {
    0: 'IP Pública Global',
    1: 'RFC1918 (10/8)',
    2: 'RFC1918 (172.16/12)',
    3: 'RFC1918 (192.168/16)',
    4: 'Loopback (127/8)',
    5: 'Link-Local (169.254/16)',
    6: 'CGNAT (100.64/10)',
    7: 'Multicast / Reservada',
  };

  // --- Estado global ---
  let wasm = null;
  const textDecoder = new TextDecoder('utf-8');

  let discoveryMode = 'web'; // 'web' | 'agent' | 'import' | 'sample'
  let agentUrl = 'http://127.0.0.1:8781';
  let agentConnected = false;
  let agentInfo = null;

  let devices = [];
  let selectedDeviceIp = null;
  let activeCategoryFilter = 'all';
  let sortField = 'ip';
  let sortAsc = true;
  let radarOnlyOnline = false;
  let radarHoveredDevice = null;
  let radarNodePositions = [];

  let scanning = false;
  let scanAbortCtrl = null;
  let radarSweepAngle = 0;

  // Ping continuo
  let pingActive = true;
  let pingTimer = null;
  let pingSeq = 0;
  const pingHistory = []; // { seq, ok, rtt, ttl, note }
  const MAX_PING_HISTORY = 72;

  let aliases = {};
  try {
    aliases = JSON.parse(localStorage.getItem(ALIAS_STORAGE_KEY) || '{}') || {};
    const savedAgentUrl = localStorage.getItem(AGENT_URL_STORAGE_KEY);
    if (savedAgentUrl) agentUrl = savedAgentUrl;
  } catch (_) {}

  // --- Referencias DOM ---
  const el = {
    modeStatusDot: document.getElementById('modeStatusDot'),
    modeStatusLabel: document.getElementById('modeStatusLabel'),
    nodeCountStat: document.getElementById('nodeCountStat'),
    liveRttStat: document.getElementById('liveRttStat'),
    wasmTimeStat: document.getElementById('wasmTimeStat'),
    scanPrimaryBtn: document.getElementById('scanPrimaryBtn'),
    agentModalBtn: document.getElementById('agentModalBtn'),
    agentBtnLabel: document.getElementById('agentBtnLabel'),
    importModalBtn: document.getElementById('importModalBtn'),
    cleanModeBtn: document.getElementById('cleanModeBtn'),
    restoreUiBtn: document.getElementById('restoreUiBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),

    cidrInput: document.getElementById('cidrInput'),
    cidrMetaReadout: document.getElementById('cidrMetaReadout'),
    sourceModeGroup: document.getElementById('sourceModeGroup'),
    sampleBannerPill: document.getElementById('sampleBannerPill'),
    modeHelperText: document.getElementById('modeHelperText'),
    scanSummaryText: document.getElementById('scanSummaryText'),
    startScanBtn: document.getElementById('startScanBtn'),
    stopScanBtn: document.getElementById('stopScanBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    scanProgressWrap: document.getElementById('scanProgressWrap'),
    scanProgressFill: document.getElementById('scanProgressFill'),
    scanProgressDetail: document.getElementById('scanProgressDetail'),
    scanProgressPct: document.getElementById('scanProgressPct'),

    radarCanvas: document.getElementById('radarCanvas'),
    radarStage: document.getElementById('radarStage'),
    radarTooltip: document.getElementById('radarTooltip'),
    radarOnlyOnlineBtn: document.getElementById('radarOnlyOnlineBtn'),

    pingWaveCanvas: document.getElementById('pingWaveCanvas'),
    pingTargetInput: document.getElementById('pingTargetInput'),
    pingIntervalSelect: document.getElementById('pingIntervalSelect'),
    pingToggleBtn: document.getElementById('pingToggleBtn'),
    pingResetBtn: document.getElementById('pingResetBtn'),
    pingQualityBadge: document.getElementById('pingQualityBadge'),
    pingLogFeed: document.getElementById('pingLogFeed'),
    pmMin: document.getElementById('pmMin'),
    pmAvg: document.getElementById('pmAvg'),
    pmMax: document.getElementById('pmMax'),
    pmJitter: document.getElementById('pmJitter'),
    pmP95: document.getElementById('pmP95'),
    pmLoss: document.getElementById('pmLoss'),

    searchDeviceInput: document.getElementById('searchDeviceInput'),
    categoryFilters: document.getElementById('categoryFilters'),
    devicesTableBody: document.getElementById('devicesTableBody'),
    filteredCountBadge: document.getElementById('filteredCountBadge'),
    emptyInventoryState: document.getElementById('emptyInventoryState'),
    emptyWebScanBtn: document.getElementById('emptyWebScanBtn'),
    emptyAgentBtn: document.getElementById('emptyAgentBtn'),
    emptyImportBtn: document.getElementById('emptyImportBtn'),
    emptySampleBtn: document.getElementById('emptySampleBtn'),

    inspectorPlaceholder: document.getElementById('inspectorPlaceholder'),
    inspectorContent: document.getElementById('inspectorContent'),
    inspSourceTag: document.getElementById('inspSourceTag'),
    inspIcon: document.getElementById('inspIcon'),
    inspCategory: document.getElementById('inspCategory'),
    inspMainTitle: document.getElementById('inspMainTitle'),
    inspSubtitle: document.getElementById('inspSubtitle'),
    aliasInput: document.getElementById('aliasInput'),
    saveAliasBtn: document.getElementById('saveAliasBtn'),
    inspIp: document.getElementById('inspIp'),
    inspScope: document.getElementById('inspScope'),
    inspMac: document.getElementById('inspMac'),
    inspVendor: document.getElementById('inspVendor'),
    inspOs: document.getElementById('inspOs'),
    inspConf: document.getElementById('inspConf'),
    inspRttTtl: document.getElementById('inspRttTtl'),
    inspHostname: document.getElementById('inspHostname'),
    inspPortsWrap: document.getElementById('inspPortsWrap'),
    inspFingerprintNotes: document.getElementById('inspFingerprintNotes'),
    inspPingBtn: document.getElementById('inspPingBtn'),
    inspCopyJsonBtn: document.getElementById('inspCopyJsonBtn'),

    clientOnlineStat: document.getElementById('clientOnlineStat'),
    clientLinkStat: document.getElementById('clientLinkStat'),
    clientWebrtcStat: document.getElementById('clientWebrtcStat'),
    clientWasmStat: document.getElementById('clientWasmStat'),

    agentModal: document.getElementById('agentModal'),
    agentUrlInput: document.getElementById('agentUrlInput'),
    testAgentConnBtn: document.getElementById('testAgentConnBtn'),
    agentModalStatus: document.getElementById('agentModalStatus'),
    copyCmdUnixBtn: document.getElementById('copyCmdUnixBtn'),
    cmdUnixText: document.getElementById('cmdUnixText'),

    importModal: document.getElementById('importModal'),
    importTextarea: document.getElementById('importTextarea'),
    importFileInput: document.getElementById('importFileInput'),
    pickImportFileBtn: document.getElementById('pickImportFileBtn'),
    pasteExampleImportBtn: document.getElementById('pasteExampleImportBtn'),
    parseImportBtn: document.getElementById('parseImportBtn'),

    toastBanner: document.getElementById('toastBanner'),
  };

  if (el.agentUrlInput) el.agentUrlInput.value = agentUrl;

  // --- Utilidades IP / MAC / Formato ---
  function parseIpv4ToU32(ip) {
    if (!ip) return null;
    const parts = String(ip).trim().split('.');
    if (parts.length !== 4) return null;
    let out = 0;
    for (let i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return null;
      const n = Number(parts[i]);
      if (n < 0 || n > 255) return null;
      out = ((out << 8) | n) >>> 0;
    }
    return out;
  }

  function u32ToIpv4(val) {
    const v = val >>> 0;
    return `${(v >>> 24) & 255}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`;
  }

  function normalizeMac(raw) {
    if (!raw) return null;
    const hex = String(raw).replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (hex.length !== 12) return null;
    if (hex === 'FFFFFFFFFFFF' || hex === '000000000000') return null;
    return hex.match(/.{2}/g).join(':');
  }

  function parseMacBytes(mac) {
    const norm = normalizeMac(mac);
    if (!norm) return null;
    const p = norm.split(':').map((h) => parseInt(h, 16));
    return p;
  }

  function showToast(msg, isError = false) {
    if (!el.toastBanner) return;
    el.toastBanner.textContent = msg;
    el.toastBanner.classList.toggle('error', Boolean(isError));
    el.toastBanner.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      el.toastBanner.classList.add('hidden');
    }, 3400);
  }

  // --- Integración Rust WebAssembly ---
  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const t0 = performance.now();
      const { instance } = await WebAssembly.instantiate(bytes);
      wasm = instance.exports;
      const dt = Math.max(0.01, performance.now() - t0);
      el.wasmTimeStat.textContent = dt.toFixed(2);
      el.clientWasmStat.textContent = `Activo (${(bytes.byteLength / 1024).toFixed(1)} KB)`;
      updateCidrPreview();
      return true;
    } catch (err) {
      console.error('Error cargando engine.wasm:', err);
      el.clientWasmStat.textContent = 'Respaldo JS (WASM no disponible)';
      updateCidrPreview();
      return false;
    }
  }

  function parseCidrSpec(raw) {
    const clean = String(raw || '').trim();
    const m = clean.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/);
    if (!m) return null;
    const ipU32 = parseIpv4ToU32(m[1]);
    if (ipU32 === null) return null;
    const prefix = m[2] !== undefined ? Number(m[2]) : 24;
    if (prefix < 0 || prefix > 32) return null;

    if (wasm) {
      const mask = wasm.ipv4_mask_from_prefix(prefix) >>> 0;
      const net = wasm.cidr_network_addr(ipU32, prefix) >>> 0;
      const bcast = wasm.cidr_broadcast_addr(ipU32, prefix) >>> 0;
      const hostCount = wasm.cidr_host_count(prefix) >>> 0;
      const scopeId = wasm.classify_ipv4_scope(ipU32);
      return {
        ipU32,
        prefix,
        maskStr: u32ToIpv4(mask),
        netStr: u32ToIpv4(net),
        bcastStr: u32ToIpv4(bcast),
        hostCount,
        scopeLabel: SCOPE_LABELS[scopeId] || 'Privada',
      };
    }

    const mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
    const net = (ipU32 & mask) >>> 0;
    const bcast = (net | (~mask)) >>> 0;
    const hostCount = prefix >= 32 ? 1 : prefix === 31 ? 2 : Math.max(0, (1 << (32 - prefix)) - 2);
    return {
      ipU32,
      prefix,
      maskStr: u32ToIpv4(mask),
      netStr: u32ToIpv4(net),
      bcastStr: u32ToIpv4(bcast),
      hostCount,
      scopeLabel: 'IPv4',
    };
  }

  function enumerateCidrHosts(spec, maxHosts = 254) {
    const count = Math.min(spec.hostCount, maxHosts);
    const list = [];
    for (let i = 0; i < count; i++) {
      const addr = wasm
        ? wasm.cidr_nth_host(spec.ipU32, spec.prefix, i) >>> 0
        : (parseIpv4ToU32(spec.netStr) + (spec.prefix >= 31 ? i : i + 1)) >>> 0;
      list.push(u32ToIpv4(addr));
    }
    return list;
  }

  function updateCidrPreview() {
    const spec = parseCidrSpec(el.cidrInput.value);
    if (!spec) {
      el.cidrMetaReadout.textContent = 'CIDR inválido (ej. 192.168.1.0/24)';
      return null;
    }
    el.cidrMetaReadout.textContent = `${spec.hostCount} hosts · ${spec.maskStr} · ${spec.scopeLabel}`;
    return spec;
  }

  function computePortMask(ports) {
    let mask = 0;
    if (!Array.isArray(ports)) return 0;
    for (const p of ports) {
      if (PORT_MASK_MAP[p]) mask |= PORT_MASK_MAP[p];
    }
    return mask >>> 0;
  }

  function identifyDeviceWithWasm(raw) {
    const ip = String(raw.ip || '').trim();
    const mac = normalizeMac(raw.mac);
    const macBytes = parseMacBytes(mac);
    const ports = Array.isArray(raw.ports)
      ? Array.from(new Set(raw.ports.map(Number).filter((p) => p > 0 && p <= 65535))).sort((a, b) => a - b)
      : [];
    const ttl = Number.isFinite(Number(raw.ttl)) ? Number(raw.ttl) : 0;
    const lastOctet = Number(ip.split('.')[3] || 0);
    const hasExplicitGateway = typeof raw.is_gateway === 'boolean' || typeof raw.isGateway === 'boolean';
    const isGateway = hasExplicitGateway
      ? Boolean(raw.is_gateway ?? raw.isGateway)
      : Boolean(!raw.is_self && !ip.startsWith('127.') && (lastOctet === 1 || lastOctet === 254));
    const portMask = computePortMask(ports);

    let vendor = raw.vendor_sys || raw.vendor || '';
    let isRandomMac = false;
    let catId = 0;
    let osId = 0;
    let conf = 45;
    let scopeLabel = 'IPv4';

    const t0 = performance.now();
    if (wasm) {
      const ipU32 = parseIpv4ToU32(ip);
      if (ipU32 !== null) {
        scopeLabel = SCOPE_LABELS[wasm.classify_ipv4_scope(ipU32)] || 'IPv4';
      }

      const b0 = macBytes ? macBytes[0] : 0;
      const b1 = macBytes ? macBytes[1] : 0;
      const b2 = macBytes ? macBytes[2] : 0;
      const hasMac = macBytes ? 1 : 0;

      if (macBytes) {
        isRandomMac = wasm.is_mac_locally_administered(b0) === 1;
        const len = wasm.lookup_oui_vendor(b0, b1, b2);
        if (len > 0) {
          const ptr = wasm.get_result_ptr();
          const wasmVendor = textDecoder.decode(new Uint8Array(wasm.memory.buffer, ptr, len));
          if (!vendor || isRandomMac) {
            vendor = wasmVendor;
          }
        }
      }

      catId = wasm.fingerprint_device(b0, b1, b2, portMask, ttl, isGateway ? 1 : 0, hasMac);
      osId = wasm.get_fp_out(1);
      conf = wasm.get_fp_out(2);
    }
    const elapsed = performance.now() - t0;
    if (elapsed > 0) {
      el.wasmTimeStat.textContent = Math.max(0.01, elapsed).toFixed(2);
    }

    // Ajustes semánticos adicionales por nombre/banner si el navegador o nmap aportaron pista extra
    const hostHint = `${raw.hostname || ''} ${raw.banner || ''} ${vendor || ''}`.toLowerCase();
    if (catId === 0 || conf < 75) {
      if (/fritz|router|gateway|mikrotik|openwrt|tplink|ubnt|unifi/.test(hostHint)) {
        catId = isGateway ? 1 : 2;
        conf = Math.max(conf, 84);
      } else if (/synology|qnap|truenas|nas/.test(hostHint)) {
        catId = 3;
        conf = Math.max(conf, 88);
      } else if (/proxmox|pve|esxi|server|ubuntu|debian|pi|docker/.test(hostHint)) {
        catId = 4;
        osId = osId || 1;
        conf = Math.max(conf, 85);
      } else if (/iphone|ipad|android|pixel|galaxy|xiaomi/.test(hostHint)) {
        catId = 6;
        conf = Math.max(conf, 82);
      } else if (/printer|brother|epson|hp|canon|ricoh|cups/.test(hostHint)) {
        catId = 7;
        conf = Math.max(conf, 86);
      } else if (/bravia|webos|lg|tizen|appletv|chromecast|sonos|tv/.test(hostHint)) {
        catId = 8;
        conf = Math.max(conf, 84);
      } else if (/cam|rtsp|hikvision|dahua|reolink/.test(hostHint)) {
        catId = 10;
        conf = Math.max(conf, 88);
      } else if (/shelly|tasmota|esp|hue|alexa|echo|homeassistant/.test(hostHint)) {
        catId = 9;
        conf = Math.max(conf, 85);
      }
    }

    const catMeta = CATEGORY_META[catId] || CATEGORY_META[0];
    const osLabel = raw.os_override || OS_LABELS[osId] || 'Indeterminado';
    const aliasKey = mac || ip;
    const alias = aliases[aliasKey] || '';

    const reasonParts = [];
    if (vendor) reasonParts.push(`OUI: ${vendor}`);
    if (isRandomMac) reasonParts.push('Bit LAA activo (MAC aleatoria)');
    if (ports.length) reasonParts.push(`Puertos [${ports.join(', ')}]`);
    if (ttl > 0) reasonParts.push(`TTL=${ttl}`);
    if (raw.banner) reasonParts.push(`Banner: ${raw.banner}`);
    const fingerprintNotes = reasonParts.length
      ? `${reasonParts.join(' · ')} → ${catMeta.label}`
      : `Identificación básica por respuesta en subred (${raw.source || 'WEB'})`;

    return {
      ip,
      ipNum: parseIpv4ToU32(ip) || 0,
      mac,
      isRandomMac,
      vendor: vendor || (mac ? 'OUI no listado en tabla local' : 'No expuesta por navegador'),
      hostname: raw.hostname || null,
      alias,
      alive: raw.alive !== false,
      rttMs: raw.rtt_ms !== undefined && raw.rtt_ms !== null ? Number(raw.rtt_ms) : null,
      ttl: ttl || null,
      ports,
      banner: raw.banner || null,
      isGateway,
      isSelf: Boolean(raw.is_self),
      catId,
      catMeta,
      osLabel,
      confidence: conf,
      scopeLabel,
      source: raw.source || 'SONDA_WEB',
      fingerprintNotes,
    };
  }

  // --- Gestión de Modos y Estado Visual ---
  function setMode(mode) {
    discoveryMode = mode;
    document.querySelectorAll('.source-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });

    el.sampleBannerPill.classList.toggle('hidden', mode !== 'sample');
    if (mode === 'sample' || mode === 'import') {
      el.scanProgressWrap.classList.add('hidden');
    }
    el.modeStatusDot.className = 'status-dot ' + (mode === 'agent' ? 'agent' : mode === 'sample' ? 'sample' : 'web');

    if (mode === 'agent') {
      el.modeStatusLabel.textContent = agentConnected ? 'AGENTE L2/L3' : 'AGENTE (OFF)';
      el.modeHelperText.innerHTML = agentConnected
        ? `Conectado a <code>${agentUrl}</code> · Ping ICMP real, tabla ARP completa, MACs OUI y escaneo de puertos TCP.`
        : 'Ejecuta <code>javier_lan_agent.py</code> en tu PC y conéctalo para desbloquear ICMP, MACs OUI y puertos.';
    } else if (mode === 'import') {
      el.modeStatusLabel.textContent = 'IMPORTAR ARP/NMAP';
      el.modeHelperText.innerHTML = 'Analiza localmente salidas de <code>arp -a</code>, <code>ip neigh</code> o <code>nmap -oX</code> con el motor OUI en Rust WASM.';
    } else if (mode === 'sample') {
      el.modeStatusLabel.textContent = 'MUESTRA LAB';
      el.modeHelperText.textContent = 'Topología simulada de laboratorio para explorar el radar, filtros e identificador OUI (no representa tu red real).';
    } else {
      el.modeStatusLabel.textContent = 'SONDA WEB';
      const protoNote = location.protocol === 'https:'
        ? 'Desde HTTPS el navegador sondea servicios HTTPS locales (<code>:443/:8443/:8006</code>) por temporización.'
        : 'Desde origen HTTP el navegador sondea puertos web locales (<code>:80/:8080</code>) en la subred.';
      el.modeHelperText.innerHTML = `${protoNote} Para ver MACs OUI y todo el hardware, usa Agente L2/L3 o importa <code>arp -a</code>.`;
    }
  }

  // --- Descubrimiento 1: Sonda Web Directa desde el Navegador ---
  async function probeSingleHostWeb(ip, signal) {
    const useHttpsOnly = location.protocol === 'https:';
    const candidates = useHttpsOnly
      ? [`https://${ip}:443/`, `https://${ip}:8443/`, `https://${ip}:8006/`]
      : [`http://${ip}:80/`, `https://${ip}:443/`];

    const t0 = performance.now();
    // Probar puerto principal; en redes locales si el host existe responde RST/TLS rápido (<250ms) frente al timeout
    const url = candidates[0];
    const localCtrl = new AbortController();
    const timer = setTimeout(() => localCtrl.abort(), 520);
    const onAbort = () => localCtrl.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: localCtrl.signal });
      const rtt = Math.max(0.5, performance.now() - t0);
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const port = url.includes(':8443') ? 8443 : url.includes(':8006') ? 8006 : url.startsWith('https') ? 443 : 80;
      return { alive: true, rtt_ms: Number(rtt.toFixed(1)), ports: [port] };
    } catch (err) {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      const elapsed = performance.now() - t0;
      // Si el navegador rechazó/completó handshake o RST antes del timeout (sin ser abort), el host existe en la LAN
      if (!localCtrl.signal.aborted && !signal.aborted && elapsed < 380) {
        return { alive: true, rtt_ms: Number(elapsed.toFixed(1)), ports: [] };
      }
      return { alive: false, rtt_ms: null, ports: [] };
    }
  }

  async function runWebSubnetScan() {
    const spec = updateCidrPreview();
    if (!spec) {
      showToast('Introduce un rango CIDR válido (ej. 192.168.1.0/24)', true);
      return;
    }

    const targets = enumerateCidrHosts(spec, 254);
    scanning = true;
    scanAbortCtrl = new AbortController();
    el.startScanBtn.classList.add('hidden');
    el.stopScanBtn.classList.remove('hidden');
    el.scanProgressWrap.classList.remove('hidden');
    el.scanSummaryText.textContent = 'Sondeando...';

    const found = [];
    let completed = 0;
    const total = targets.length;
    let cursor = 0;
    const CONCURRENCY = 16;

    async function worker() {
      while (cursor < total && !scanAbortCtrl.signal.aborted) {
        const idx = cursor++;
        const ip = targets[idx];
        const res = await probeSingleHostWeb(ip, scanAbortCtrl.signal);
        if (res.alive) {
          found.push(identifyDeviceWithWasm({
            ip,
            alive: true,
            rtt_ms: res.rtt_ms,
            ports: res.ports,
            source: 'SONDA_WEB',
          }));
        }
        completed++;
        const pct = Math.round((completed / total) * 100);
        el.scanProgressFill.style.width = `${pct}%`;
        el.scanProgressPct.textContent = `${pct}%`;
        el.scanProgressDetail.textContent = `Sondeando ${ip} (${completed}/${total}) · ${found.length} activos`;
        if (completed % 12 === 0 || res.alive) {
          devices = found.slice();
          refreshAllViews();
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

    scanning = false;
    el.startScanBtn.classList.remove('hidden');
    el.stopScanBtn.classList.add('hidden');
    devices = found.sort((a, b) => a.ipNum - b.ipNum);
    refreshAllViews();

    if (devices.length === 0) {
      el.scanSummaryText.textContent = '0 respuestas HTTP/HTTPS directas';
      showToast('El navegador no detectó servicios web abiertos en ese rango. Prueba Agente Local o Importar arp -a.');
    } else {
      el.scanSummaryText.textContent = `${devices.length} nodos detectados`;
      showToast(`Sonda Web completada: ${devices.length} nodos activos encontrados.`);
    }
  }

  // --- Descubrimiento 2: Agente Local L2/L3 ---
  async function connectLocalAgent(quiet = false) {
    const candidate = (el.agentUrlInput?.value || agentUrl).trim().replace(/\/+$/, '');
    agentUrl = candidate;
    try {
      localStorage.setItem(AGENT_URL_STORAGE_KEY, agentUrl);
    } catch (_) {}

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2200);
    try {
      const res = await fetch(`${agentUrl}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      agentConnected = true;
      agentInfo = data;
      el.agentModalBtn.classList.add('connected');
      el.agentBtnLabel.textContent = '🟢 Agente L2/L3 OK';
      el.agentModalStatus.className = 'agent-status-box ok';
      el.agentModalStatus.textContent = `Conectado (${data.platform} · ${data.hostname}) · IP ${data.local_ip} · Gateway ${data.gateway || 'N/D'} · OUI Sistema: ${data.oui_entries || 0}`;
      if (data.suggested_cidr) {
        el.cidrInput.value = data.suggested_cidr;
        updateCidrPreview();
      }
      setMode('agent');
      if (!quiet) showToast(`Agente conectado en ${data.local_ip} (${data.suggested_cidr})`);
      return true;
    } catch (_) {
      clearTimeout(timer);
      agentConnected = false;
      el.agentModalBtn.classList.remove('connected');
      el.agentBtnLabel.textContent = '🔌 Agente Local';
      el.agentModalStatus.className = 'agent-status-box';
      el.agentModalStatus.textContent = `No se encontró agente escuchando en ${agentUrl}. Ejecuta javier_lan_agent.py y vuelve a probar.`;
      if (!quiet) showToast('Agente Local no detectado. Revisa las instrucciones del modal.', true);
      return false;
    }
  }

  async function runAgentSubnetScan() {
    if (!agentConnected) {
      const ok = await connectLocalAgent(true);
      if (!ok) {
        openModal('agentModal');
        return;
      }
    }
    const spec = updateCidrPreview();
    if (!spec) {
      showToast('Subred CIDR inválida', true);
      return;
    }

    scanning = true;
    el.startScanBtn.classList.add('hidden');
    el.stopScanBtn.classList.remove('hidden');
    el.scanProgressWrap.classList.remove('hidden');
    el.scanProgressFill.style.width = '38%';
    el.scanProgressPct.textContent = 'ICMP + ARP...';
    el.scanProgressDetail.textContent = `Agente local barriendo ${el.cidrInput.value} (Ping ICMP, caché ARP, PTR y puertos TCP)...`;
    el.scanSummaryText.textContent = 'Escaneando vía Agente...';

    scanAbortCtrl = new AbortController();
    try {
      const res = await fetch(`${agentUrl}/scan?cidr=${encodeURIComponent(el.cidrInput.value.trim())}`, {
        signal: scanAbortCtrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error en agente');
      devices = (data.devices || []).map(identifyDeviceWithWasm);
      el.scanProgressFill.style.width = '100%';
      el.scanProgressPct.textContent = '100%';
      el.scanProgressDetail.textContent = `Completado en ${data.duration_ms} ms · ${devices.length} dispositivos identificados`;
      el.scanSummaryText.textContent = `${devices.length} nodos (${data.duration_ms} ms)`;
      refreshAllViews();
      showToast(`Escaneo L2/L3 completo: ${devices.length} equipos detectados.`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast(`Error del agente: ${err.message}`, true);
        el.scanSummaryText.textContent = 'Error de escaneo';
      }
    } finally {
      scanning = false;
      el.startScanBtn.classList.remove('hidden');
      el.stopScanBtn.classList.add('hidden');
    }
  }

  // --- Descubrimiento 3: Parseo Real de Salidas (arp -a / ip neigh / nmap XML / txt / CSV) ---
  function parseImportedText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return [];

    // 1. Nmap XML (-oX)
    if (trimmed.includes('<nmaprun')) {
      try {
        const doc = new DOMParser().parseFromString(trimmed, 'text/xml');
        const hosts = Array.from(doc.querySelectorAll('host'));
        const out = [];
        for (const h of hosts) {
          const ipv4Node = h.querySelector('address[addrtype="ipv4"]');
          if (!ipv4Node) continue;
          const ip = ipv4Node.getAttribute('addr');
          if (parseIpv4ToU32(ip) === null) continue;
          const macNode = h.querySelector('address[addrtype="mac"]');
          const mac = macNode ? macNode.getAttribute('addr') : null;
          const vendor = macNode ? macNode.getAttribute('vendor') : null;
          const hostNode = h.querySelector('hostnames hostname');
          const hostname = hostNode ? hostNode.getAttribute('name') : null;
          const statusNode = h.querySelector('status');
          const alive = statusNode ? statusNode.getAttribute('state') === 'up' : true;
          const openPorts = Array.from(h.querySelectorAll('ports port'))
            .filter((p) => p.querySelector('state')?.getAttribute('state') === 'open')
            .map((p) => Number(p.getAttribute('portid')))
            .filter(Boolean);
          const osMatch = h.querySelector('os osmatch')?.getAttribute('name') || null;
          out.push(identifyDeviceWithWasm({
            ip,
            mac,
            vendor_sys: vendor,
            hostname,
            alive,
            ports: openPorts,
            os_override: osMatch,
            source: 'NMAP_XML',
          }));
        }
        if (out.length) return out;
      } catch (_) {}
    }

    // 2. JSON exportado previamente
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : parsed.devices || [];
        if (Array.isArray(arr) && arr.length) {
          return arr.filter((x) => parseIpv4ToU32(x.ip) !== null).map((x) =>
            identifyDeviceWithWasm({ ...x, source: 'IMPORT_JSON' })
          );
        }
      } catch (_) {}
    }

    // 3. Texto de terminal: arp -a (Windows/macOS/Linux), ip neigh, o nmap -sn/-sV
    const byIp = new Map();
    let currentNmapIp = null;
    const lines = trimmed.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Encabezado de informe Nmap: "Nmap scan report for router.lan (192.168.1.1)" o "Nmap scan report for 192.168.1.25"
      const nmapHost = line.match(/^Nmap scan report for\s+(?:([^\s(]+)\s+\()?((?:\d{1,3}\.){3}\d{1,3})\)?/i);
      if (nmapHost) {
        currentNmapIp = nmapHost[2];
        const prev = byIp.get(currentNmapIp) || { ip: currentNmapIp, ports: [], alive: true, source: 'NMAP_TXT' };
        if (nmapHost[1]) prev.hostname = nmapHost[1];
        byIp.set(currentNmapIp, prev);
        continue;
      }

      if (currentNmapIp) {
        const nmapMac = line.match(/^MAC Address:\s*([0-9A-Fa-f:.-]{17})(?:\s+\(([^)]+)\))?/i);
        if (nmapMac) {
          const dev = byIp.get(currentNmapIp);
          dev.mac = nmapMac[1];
          if (nmapMac[2] && nmapMac[2] !== 'Unknown') dev.vendor_sys = nmapMac[2];
          continue;
        }
        const nmapPort = line.match(/^(\d{1,5})\/tcp\s+open\s+([^\s]+)(?:\s+(.*))?/i);
        if (nmapPort) {
          const dev = byIp.get(currentNmapIp);
          dev.ports.push(Number(nmapPort[1]));
          if (nmapPort[3]) dev.banner = nmapPort[3].trim().slice(0, 64);
          continue;
        }
        const nmapLat = line.match(/Host is up\s*\(([0-9.]+)s latency\)/i);
        if (nmapLat) {
          const dev = byIp.get(currentNmapIp);
          dev.rtt_ms = Number((Number(nmapLat[1]) * 1000).toFixed(1));
          continue;
        }
      }

      // Líneas arp -a / ip neigh / DHCP CSV
      const ipMatch = line.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
      if (!ipMatch || parseIpv4ToU32(ipMatch[1]) === null) continue;
      const ip = ipMatch[1];
      if (ip.startsWith('224.') || ip.startsWith('239.') || ip.endsWith('.255') || line.toLowerCase().startsWith('interfaz:') || line.toLowerCase().startsWith('interface:')) {
        continue;
      }
      const macMatch = line.match(/\b((?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2})\b/);
      const mac = macMatch ? normalizeMac(macMatch[1]) : null;
      const isFailed = /FAILED|INCOMPLETE/i.test(line);
      if (!mac && isFailed) continue;

      const prev = byIp.get(ip) || { ip, ports: [], alive: !isFailed, source: 'IMPORT_ARP' };
      if (mac) prev.mac = mac;
      if (!isFailed) prev.alive = true;

      // Posible hostname antes de "(192.168..." en macOS/Linux arp -a
      const arpHostMatch = line.match(/^([^\s?]+)\s+\(\d{1,3}\./);
      if (arpHostMatch) prev.hostname = arpHostMatch[1];

      byIp.set(ip, prev);
    }

    return Array.from(byIp.values()).map(identifyDeviceWithWasm);
  }

  // --- Descubrimiento 4: Topología de Muestra Explícita (Etiquetada) ---
  function loadSampleTopology() {
    setMode('sample');
    const sampleRaw = [
      { ip: '192.168.1.1', mac: 'C0:25:06:8A:12:40', hostname: 'fritz.box', rtt_ms: 1.4, ttl: 64, ports: [53, 80, 443], banner: 'FRITZ!OS Router Gateway', is_gateway: true, source: 'MUESTRA' },
      { ip: '192.168.1.2', mac: '78:8A:20:41:9B:10', hostname: 'u6-pro-salon.lan', rtt_ms: 2.1, ttl: 64, ports: [22, 443], banner: 'UniFi AP U6-Pro', source: 'MUESTRA' },
      { ip: '192.168.1.10', mac: '00:11:32:9E:44:21', hostname: 'ds920-nas.lan', rtt_ms: 1.8, ttl: 64, ports: [22, 80, 443, 445, 5000, 5001], banner: 'Synology DiskStation', source: 'MUESTRA' },
      { ip: '192.168.1.15', mac: 'B8:27:EB:51:C2:08', hostname: 'pihole-node.lan', rtt_ms: 2.6, ttl: 64, ports: [22, 53, 80], banner: 'Pi-hole Admin LTE', source: 'MUESTRA' },
      { ip: '192.168.1.20', mac: '52:54:00:A4:31:77', hostname: 'pve-homelab.lan', rtt_ms: 1.2, ttl: 64, ports: [22, 8006], banner: 'Proxmox Virtual Environment', source: 'MUESTRA' },
      { ip: '192.168.1.32', mac: 'A4:5E:60:11:7A:C4', hostname: 'macbook-pro.lan', rtt_ms: 6.4, ttl: 64, ports: [5353], source: 'MUESTRA' },
      { ip: '192.168.1.38', mac: '48:51:B7:33:E1:90', hostname: 'workstation-win.lan', rtt_ms: 3.9, ttl: 128, ports: [445, 3389], source: 'MUESTRA' },
      { ip: '192.168.1.54', mac: '4A:91:22:0B:7E:3C', hostname: 'iphone-movil.lan', rtt_ms: 18.5, ttl: 64, ports: [62078], source: 'MUESTRA' },
      { ip: '192.168.1.70', mac: '00:1B:A9:74:22:19', hostname: 'brother-mfc.lan', rtt_ms: 9.2, ttl: 64, ports: [80, 631, 9100], banner: 'Brother MFC-L2710DW', source: 'MUESTRA' },
      { ip: '192.168.1.85', mac: '34:4D:F7:19:A0:02', hostname: 'lg-oled-c3.lan', rtt_ms: 14.3, ttl: 64, ports: [8008, 8009], banner: 'LG webOS TV', source: 'MUESTRA' },
      { ip: '192.168.1.112', mac: '24:0A:C4:90:14:F8', hostname: 'shelly-salondom.lan', rtt_ms: 27.6, ttl: 64, ports: [80, 1883], banner: 'ESP32 MQTT Sensor', source: 'MUESTRA' },
      { ip: '192.168.1.140', mac: '28:57:BE:63:08:51', hostname: 'cam-terraza.lan', rtt_ms: 12.1, ttl: 64, ports: [80, 554, 8000], banner: 'IP Camera RTSP Stream', source: 'MUESTRA' },
    ];
    devices = sampleRaw.map(identifyDeviceWithWasm);
    el.cidrInput.value = '192.168.1.0/24';
    updateCidrPreview();
    el.scanSummaryText.textContent = `${devices.length} nodos de muestra`;
    selectedDeviceIp = devices.length ? devices[0].ip : null;
    refreshAllViews();
    showToast('Topología de muestra cargada (etiquetada como Muestra de Laboratorio).');
  }

  // --- Ping Continuo & Osciloscopio ---
  function resolveBrowserPingUrl(target) {
    const clean = String(target || '').trim();
    if (!clean || clean === 'javiergalilea.es' || clean === location.hostname || clean === 'localhost') {
      return { url: `engine.wasm?p=${Date.now()}`, mode: 'same-origin', displayHost: location.hostname || 'javiergalilea.es' };
    }
    if (clean === '1.1.1.1') {
      return { url: `https://1.1.1.1/cdn-cgi/trace?t=${Date.now()}`, mode: 'no-cors', displayHost: '1.1.1.1' };
    }
    if (clean === '8.8.8.8') {
      return { url: `https://dns.google/resolve?name=javiergalilea.es&type=A&t=${Date.now()}`, mode: 'cors', displayHost: '8.8.8.8' };
    }
    if (/^https?:\/\//i.test(clean)) {
      return { url: clean, mode: 'no-cors', displayHost: clean };
    }
    const proto = location.protocol === 'https:' ? 'https' : 'http';
    return { url: `${proto}://${clean}/`, mode: 'no-cors', displayHost: clean };
  }

  async function executeSinglePing() {
    const target = el.pingTargetInput.value.trim() || 'javiergalilea.es';
    pingSeq++;
    const seq = pingSeq;
    let ok = false;
    let rtt = -1;
    let ttl = null;
    let method = 'WEB';

    if (discoveryMode === 'sample') {
      const sampleDev = devices.find((d) => d.ip === target || d.hostname === target);
      if (sampleDev) {
        const base = sampleDev.rttMs || 5;
        rtt = Number(Math.max(0.4, base + (Math.random() - 0.35) * (base * 0.4)).toFixed(2));
        ttl = sampleDev.ttl || 64;
        ok = Math.random() > 0.02;
        method = 'MUESTRA';
      }
    }

    if (method === 'WEB' && agentConnected) {
      method = 'ICMP';
      try {
        const res = await fetch(`${agentUrl}/ping?host=${encodeURIComponent(target)}`);
        const data = await res.json();
        ok = Boolean(data.ok);
        rtt = ok ? Number(data.rtt_ms) : -1;
        ttl = data.ttl || null;
        method = data.method || 'ICMP';
      } catch (_) {
        ok = false;
      }
    } else if (method === 'WEB') {
      const spec = resolveBrowserPingUrl(target);
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1400);
      try {
        await fetch(spec.url, {
          method: spec.mode === 'same-origin' ? 'HEAD' : 'GET',
          mode: spec.mode === 'same-origin' ? 'same-origin' : spec.mode,
          cache: 'no-store',
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        rtt = Number(Math.max(0.2, performance.now() - t0).toFixed(2));
        ok = true;
        method = spec.mode === 'same-origin' ? 'HTTP-200' : 'HTTPS';
      } catch (_) {
        clearTimeout(timer);
        const dt = performance.now() - t0;
        if (!ctrl.signal.aborted && dt < 750 && !spec.url.startsWith('engine.wasm')) {
          rtt = Number(dt.toFixed(2));
          ok = true;
          method = 'TIMING';
        } else {
          ok = false;
          rtt = -1;
        }
      }
    }

    pingHistory.push({ seq, target, ok, rtt: ok ? rtt : -1, ttl, method });
    if (pingHistory.length > MAX_PING_HISTORY) pingHistory.shift();

    updatePingTelemetry();
    drawPingWaveform();
  }

  function updatePingTelemetry() {
    if (!pingHistory.length) return;
    const latest = pingHistory[pingHistory.length - 1];
    el.liveRttStat.textContent = latest.ok ? latest.rtt.toFixed(1) : 'TIMEOUT';

    let quality = 0;
    let minV = 0, avgV = 0, maxV = 0, jitterV = 0, p95V = 0, lossV = 0;

    if (wasm) {
      const n = Math.min(pingHistory.length, 512);
      const ptr = wasm.get_ping_buf_ptr();
      const buf = new Float32Array(wasm.memory.buffer, ptr, n);
      for (let i = 0; i < n; i++) {
        buf[i] = pingHistory[i].ok ? pingHistory[i].rtt : -1.0;
      }
      quality = wasm.analyze_ping_series(n);
      lossV = wasm.get_ping_metric(2);
      minV = wasm.get_ping_metric(3);
      avgV = wasm.get_ping_metric(4);
      maxV = wasm.get_ping_metric(5);
      jitterV = wasm.get_ping_metric(6);
      p95V = wasm.get_ping_metric(7);
    } else {
      const valid = pingHistory.filter((x) => x.ok).map((x) => x.rtt);
      lossV = ((pingHistory.length - valid.length) / pingHistory.length) * 100;
      if (valid.length) {
        minV = Math.min(...valid);
        maxV = Math.max(...valid);
        avgV = valid.reduce((a, b) => a + b, 0) / valid.length;
        p95V = maxV;
        quality = Math.max(0, Math.round(100 - lossV * 2));
      }
    }

    el.pmMin.textContent = minV > 0 ? `${minV.toFixed(1)} ms` : '-- ms';
    el.pmAvg.textContent = avgV > 0 ? `${avgV.toFixed(1)} ms` : '-- ms';
    el.pmMax.textContent = maxV > 0 ? `${maxV.toFixed(1)} ms` : '-- ms';
    el.pmJitter.textContent = `${jitterV.toFixed(2)} ms`;
    el.pmP95.textContent = p95V > 0 ? `${p95V.toFixed(1)} ms` : '-- ms';
    el.pmLoss.textContent = `${lossV.toFixed(0)}%`;

    el.pingQualityBadge.textContent = `CALIDAD ${quality}/100`;
    el.pingQualityBadge.classList.remove('warn', 'bad');
    if (quality < 55) el.pingQualityBadge.classList.add('bad');
    else if (quality < 82) el.pingQualityBadge.classList.add('warn');

    // Añadir línea al log sin inyectar HTML no escapado
    const lineEl = document.createElement('div');
    lineEl.className = 'ping-log-line';
    const span = document.createElement('span');
    span.className = latest.ok ? 'ok' : 'err';
    const ttlStr = latest.ttl ? ` ttl=${latest.ttl}` : '';
    span.textContent = latest.ok
      ? `seq=${latest.seq} [${latest.method}] ${latest.target} rtt=${latest.rtt.toFixed(2)} ms${ttlStr}`
      : `seq=${latest.seq} [${latest.method}] ${latest.target} · sin respuesta / bloqueado`;
    lineEl.appendChild(span);
    el.pingLogFeed.appendChild(lineEl);
    while (el.pingLogFeed.children.length > 24) {
      el.pingLogFeed.removeChild(el.pingLogFeed.firstChild);
    }
    el.pingLogFeed.scrollTop = el.pingLogFeed.scrollHeight;
  }

  function schedulePingLoop() {
    clearInterval(pingTimer);
    if (!pingActive) return;
    const intervalMs = Number(el.pingIntervalSelect.value || 1000);
    pingTimer = setInterval(executeSinglePing, intervalMs);
  }

  function drawPingWaveform() {
    const canvas = el.pingWaveCanvas;
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(100, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Rejilla horizontal
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let g = 1; g <= 3; g++) {
      const y = (h / 4) * g;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (!pingHistory.length) return;
    const valids = pingHistory.filter((p) => p.ok).map((p) => p.rtt);
    const maxScale = Math.max(20, (valids.length ? Math.max(...valids) : 30) * 1.25);
    const padX = 10;
    const padY = 14;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;
    const count = pingHistory.length;
    const stepX = count > 1 ? plotW / (MAX_PING_HISTORY - 1) : 0;
    const startX = w - padX - (count - 1) * stepX;

    // Relleno de área bajo curva
    const pts = [];
    for (let i = 0; i < count; i++) {
      const p = pingHistory[i];
      const x = startX + i * stepX;
      if (!p.ok) {
        ctx.fillStyle = 'rgba(247, 37, 133, 0.35)';
        ctx.fillRect(x - 2, padY, 4, plotH);
        pts.push(null);
      } else {
        const norm = Math.min(1, p.rtt / maxScale);
        const y = h - padY - norm * plotH;
        pts.push({ x, y, rtt: p.rtt });
      }
    }

    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    for (const pt of pts) {
      if (!pt) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(pt.x, pt.y);
        started = true;
      } else {
        ctx.lineTo(pt.x, pt.y);
      }
    }
    ctx.stroke();

    // Puntos sobre la curva
    for (let i = 0; i < pts.length; i++) {
      const pt = pts[i];
      if (!pt) continue;
      ctx.fillStyle = i === pts.length - 1 ? '#ffffff' : '#00f5d4';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, i === pts.length - 1 ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Etiqueta de escala máxima
    ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(`${maxScale.toFixed(0)} ms`, 8, 12);
    ctx.fillText('0 ms', 8, h - 5);
  }

  // --- Radar Topológico de Red ---
  function drawRadar(now) {
    const canvas = el.radarCanvas;
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(240, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.52;
    const maxR = Math.min(w, h) * 0.42;

    // Anillos concéntricos
    const rings = [0.28, 0.54, 0.78, 1.0];
    ctx.lineWidth = 1;
    for (let i = 0; i < rings.length; i++) {
      const r = maxR * rings[i];
      ctx.strokeStyle = i === 0 ? 'rgba(59, 130, 246, 0.25)' : 'rgba(0, 245, 212, 0.11)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ejes radiales
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * maxR, cy - Math.sin(ang) * maxR);
      ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
      ctx.stroke();
    }

    // Haz de barrido del radar
    radarSweepAngle = (radarSweepAngle + (scanning ? 0.055 : 0.014)) % (Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, maxR);
    grad.addColorStop(0, 'rgba(0, 245, 212, 0.02)');
    grad.addColorStop(1, scanning ? 'rgba(0, 245, 212, 0.22)' : 'rgba(0, 245, 212, 0.09)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, radarSweepAngle - 0.55, radarSweepAngle);
    ctx.closePath();
    ctx.fill();

    const visibleDevices = radarOnlyOnline ? devices.filter((d) => d.alive) : devices;
    radarNodePositions = [];

    // Mostrar guías de anillos solo cuando el radar está vacío para no ensuciar etiquetas de nodos
    if (visibleDevices.length === 0) {
      ctx.fillStyle = 'rgba(100, 116, 139, 0.72)';
      ctx.font = '600 9.5px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GATEWAY', cx, cy - maxR * 0.28 + 11);
      ctx.fillText('INFRA / <15ms', cx, cy - maxR * 0.54 + 11);
      ctx.fillText('CLIENTES / LAN', cx, cy - maxR * 0.78 + 11);
    }

    // Colocar nodo central (Gateway o núcleo)
    const gw = visibleDevices.find((d) => d.isGateway) || null;
    const satellites = visibleDevices.filter((d) => d !== gw);

    if (gw) {
      radarNodePositions.push({ device: gw, x: cx, y: cy, r: 9 });
    } else {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.35)';
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cada satélite recibe su propio sector angular único, manteniendo el radio según rol/latencia
    for (let i = 0; i < satellites.length; i++) {
      const d = satellites[i];
      const ang = -Math.PI * 0.42 + (i / Math.max(1, satellites.length)) * Math.PI * 2;
      let radialFrac = 0.76 + ((i % 2) * 0.07);
      if (!d.alive) {
        radialFrac = 0.94;
      } else if (d.catId === 2 || d.catId === 3 || d.catId === 4) {
        radialFrac = 0.44 + ((i % 2) * 0.05);
      } else if (d.rttMs !== null && d.rttMs > 20) {
        radialFrac = 0.9;
      }
      const dist = maxR * radialFrac;
      radarNodePositions.push({
        device: d,
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        r: 6.5,
      });
    }

    // Líneas de enlace hacia el centro
    for (const np of radarNodePositions) {
      if (np.x === cx && np.y === cy) continue;
      const isSel = np.device.ip === selectedDeviceIp;
      ctx.strokeStyle = isSel
        ? 'rgba(0, 245, 212, 0.65)'
        : np.device.alive
          ? 'rgba(59, 130, 246, 0.18)'
          : 'rgba(100, 116, 139, 0.14)';
      ctx.lineWidth = isSel ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(np.x, np.y);
      ctx.stroke();
    }

    // Dibujar nodos
    const pulse = (Math.sin(now * 0.005) + 1) * 0.5;
    for (const np of radarNodePositions) {
      const d = np.device;
      const isSel = d.ip === selectedDeviceIp;
      const isHover = radarHoveredDevice && radarHoveredDevice.ip === d.ip;

      let color = '#00f5d4';
      if (!d.alive) color = '#64748b';
      else if (d.isGateway || d.catId === 1 || d.catId === 2) color = '#3b82f6';
      else if (d.rttMs !== null && d.rttMs > 25) color = '#ffbe0b';
      else if (d.catId === 9 || d.catId === 10) color = '#10b981';

      if (isSel || isHover) {
        ctx.strokeStyle = '#00f5d4';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(np.x, np.y, np.r + 5 + pulse * 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(np.x, np.y, np.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#05070c';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Etiqueta compacta junto al nodo (arriba en hemisferio superior, abajo en inferior)
      const shortLabel = d.alias
        ? d.alias.slice(0, 12)
        : d.hostname
          ? d.hostname.split('.')[0].slice(0, 11)
          : `.${d.ip.split('.')[3]}`;
      ctx.fillStyle = isSel ? '#00f5d4' : 'rgba(226, 232, 240, 0.88)';
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      const labelY = np.y > cy + 12 ? np.y + np.r + 12 : np.y - np.r - 6;
      ctx.fillText(shortLabel, np.x, labelY);
    }

    requestAnimationFrame(drawRadar);
  }

  // --- Inventario, Filtros e Inspector ---
  function getFilteredAndSortedDevices() {
    const q = (el.searchDeviceInput.value || '').trim().toLowerCase();
    const list = devices.filter((d) => {
      if (activeCategoryFilter !== 'all' && d.catMeta.group !== activeCategoryFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        d.ip,
        d.mac || '',
        d.vendor || '',
        d.hostname || '',
        d.alias || '',
        d.catMeta.label,
        d.osLabel,
        d.banner || '',
        d.ports.join(' '),
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'ip') cmp = a.ipNum - b.ipNum;
      else if (sortField === 'status') cmp = (b.alive ? 1 : 0) - (a.alive ? 1 : 0);
      else if (sortField === 'rtt') cmp = (a.rttMs ?? 99999) - (b.rttMs ?? 99999);
      else if (sortField === 'name') {
        const na = (a.alias || a.hostname || a.ip).toLowerCase();
        const nb = (b.alias || b.hostname || b.ip).toLowerCase();
        cmp = na.localeCompare(nb);
      } else if (sortField === 'mac') {
        cmp = (a.mac || 'ZZ').localeCompare(b.mac || 'ZZ');
      }
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }

  function renderDevicesTable() {
    const filtered = getFilteredAndSortedDevices();
    el.nodeCountStat.textContent = String(devices.length);
    el.filteredCountBadge.textContent = `${filtered.length} de ${devices.length}`;
    el.emptyInventoryState.classList.toggle('hidden', devices.length > 0);
    el.devicesTableBody.innerHTML = '';

    const frag = document.createDocumentFragment();
    for (const d of filtered) {
      const tr = document.createElement('tr');
      if (d.ip === selectedDeviceIp) tr.classList.add('selected');
      tr.addEventListener('click', () => selectDevice(d.ip));

      // Columna 1: Estado
      const tdStatus = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = `status-badge${d.alive ? '' : ' offline'}`;
      badge.textContent = d.alive ? '● ON' : '○ CACHÉ';
      tdStatus.appendChild(badge);
      tr.appendChild(tdStatus);

      // Columna 2: IPv4
      const tdIp = document.createElement('td');
      tdIp.className = 'ip-mono';
      tdIp.textContent = d.ip + (d.isGateway ? ' ★' : '');
      tr.appendChild(tdIp);

      // Columna 3: Equipo / Hostname
      const tdName = document.createElement('td');
      const titleDiv = document.createElement('div');
      titleDiv.className = 'host-cell-title';
      titleDiv.textContent = `${d.catMeta.icon} ${d.alias || d.hostname || d.catMeta.label}`;
      const subDiv = document.createElement('div');
      subDiv.className = 'host-cell-sub';
      subDiv.textContent = d.hostname && d.alias ? `${d.hostname} · ${d.catMeta.label}` : `${d.catMeta.label} · ${d.osLabel}`;
      tdName.appendChild(titleDiv);
      tdName.appendChild(subDiv);
      tr.appendChild(tdName);

      // Columna 4: MAC & Fabricante
      const tdMac = document.createElement('td');
      const macDiv = document.createElement('div');
      macDiv.className = 'mac-mono';
      macDiv.textContent = d.mac || '—';
      if (d.isRandomMac) {
        const rnd = document.createElement('span');
        rnd.className = 'random-mac-badge';
        rnd.textContent = 'ALEATORIA';
        macDiv.appendChild(rnd);
      }
      const venDiv = document.createElement('div');
      venDiv.className = 'vendor-text';
      venDiv.textContent = d.vendor;
      tdMac.appendChild(macDiv);
      tdMac.appendChild(venDiv);
      tr.appendChild(tdMac);

      // Columna 5: Latencia
      const tdRtt = document.createElement('td');
      tdRtt.className = 'rtt-mono';
      tdRtt.textContent = d.rttMs !== null ? `${d.rttMs.toFixed(1)} ms` : '—';
      tr.appendChild(tdRtt);

      // Columna 6: Servicios
      const tdPorts = document.createElement('td');
      if (d.ports.length === 0) {
        tdPorts.textContent = '—';
      } else {
        const slice = d.ports.slice(0, 4);
        for (const p of slice) {
          const sp = document.createElement('span');
          sp.className = 'port-chip';
          sp.textContent = PORT_CATALOG[p] ? `${p} ${PORT_CATALOG[p]}` : `${p}`;
          tdPorts.appendChild(sp);
        }
        if (d.ports.length > 4) {
          const more = document.createElement('span');
          more.className = 'port-chip';
          more.textContent = `+${d.ports.length - 4}`;
          tdPorts.appendChild(more);
        }
      }
      tr.appendChild(tdPorts);

      frag.appendChild(tr);
    }
    el.devicesTableBody.appendChild(frag);
  }

  function selectDevice(ip) {
    selectedDeviceIp = ip;
    const d = devices.find((item) => item.ip === ip);
    renderDevicesTable();
    if (!d) {
      el.inspectorPlaceholder.classList.remove('hidden');
      el.inspectorContent.classList.add('hidden');
      el.inspSourceTag.textContent = 'SIN SELECCIÓN';
      return;
    }

    el.inspectorPlaceholder.classList.add('hidden');
    el.inspectorContent.classList.remove('hidden');
    el.inspSourceTag.textContent = d.source;
    el.inspIcon.textContent = d.catMeta.icon;
    el.inspCategory.textContent = d.catMeta.label;
    el.inspMainTitle.textContent = d.alias || d.hostname || d.ip;
    el.inspSubtitle.textContent = `${d.ip} · ${d.alive ? 'Activo' : 'En caché ARP'}`;
    el.aliasInput.value = d.alias || '';

    el.inspIp.textContent = d.ip + (d.isGateway ? ' (Gateway)' : d.isSelf ? ' (Este equipo)' : '');
    el.inspScope.textContent = d.scopeLabel;
    el.inspMac.textContent = d.mac ? `${d.mac}${d.isRandomMac ? ' · Bit LAA (Privada)' : ' · IEEE Global'}` : 'No expuesta por el navegador';
    el.inspVendor.textContent = d.vendor;
    el.inspOs.textContent = d.osLabel;
    el.inspConf.textContent = `${d.confidence}%`;
    el.inspRttTtl.textContent = `${d.rttMs !== null ? d.rttMs.toFixed(1) + ' ms' : '--'} / TTL ${d.ttl || '--'}`;
    el.inspHostname.textContent = d.hostname || 'No resuelto';
    el.inspFingerprintNotes.textContent = d.fingerprintNotes;

    el.inspPortsWrap.innerHTML = '';
    if (!d.ports.length) {
      const empty = document.createElement('span');
      empty.className = 'port-chip';
      empty.textContent = 'Sin puertos TCP sondeados/abiertos';
      el.inspPortsWrap.appendChild(empty);
    } else {
      for (const p of d.ports) {
        const svc = PORT_CATALOG[p] || 'TCP';
        if ([80, 443, 631, 5000, 5001, 8006, 8080, 8443].includes(p)) {
          const a = document.createElement('a');
          const proto = [443, 5001, 8006, 8443].includes(p) ? 'https' : 'http';
          a.href = `${proto}://${d.ip}:${p}`;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.className = 'port-chip link';
          a.textContent = `${p} ${svc} ↗`;
          el.inspPortsWrap.appendChild(a);
        } else {
          const s = document.createElement('span');
          s.className = 'port-chip';
          s.textContent = `${p} ${svc}`;
          el.inspPortsWrap.appendChild(s);
        }
      }
    }
  }

  function refreshAllViews() {
    if (devices.length === 0) {
      selectedDeviceIp = null;
      selectDevice(null);
      return;
    }
    if (!selectedDeviceIp || !devices.some((d) => d.ip === selectedDeviceIp)) {
      selectedDeviceIp = devices[0].ip;
    }
    selectDevice(selectedDeviceIp);
  }

  // --- Telemetría Real del Navegador & WebRTC ---
  function inspectClientEnvironment() {
    el.clientOnlineStat.textContent = navigator.onLine ? 'En línea (Online)' : 'Sin conexión';
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      const type = conn.effectiveType ? conn.effectiveType.toUpperCase() : 'Estándar';
      const down = conn.downlink ? `~${conn.downlink} Mbps` : '';
      const rtt = conn.rtt ? ` · RTT ${conn.rtt}ms` : '';
      el.clientLinkStat.textContent = `${type} ${down}${rtt}`.trim();
    } else {
      el.clientLinkStat.textContent = 'Network Info API restringida';
    }

    // Sondeo WebRTC local (sin servidores STUN externos)
    if (typeof RTCPeerConnection !== 'function') {
      el.clientWebrtcStat.textContent = 'WebRTC no soportado';
      return;
    }

    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('lan-probe');
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          el.clientWebrtcStat.textContent = 'Protegido por mDNS del navegador';
          try { pc.close(); } catch (_) {}
        }
      }, 1500);

      pc.onicecandidate = (ev) => {
        if (!ev || !ev.candidate || resolved) return;
        const cand = ev.candidate.candidate || '';
        const ipM = cand.match(/\b((?:\d{1,3}\.){3}\d{1,3})\b/);
        const mdnsM = cand.match(/([a-f0-9-]+\.local)/i);
        if (ipM && !ipM[1].startsWith('127.')) {
          resolved = true;
          clearTimeout(timer);
          el.clientWebrtcStat.textContent = `IP Local ICE: ${ipM[1]}`;
          const parts = ipM[1].split('.');
          el.cidrInput.value = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          updateCidrPreview();
          try { pc.close(); } catch (_) {}
        } else if (mdnsM) {
          resolved = true;
          clearTimeout(timer);
          el.clientWebrtcStat.textContent = `Alias mDNS: ${mdnsM[1]}`;
          try { pc.close(); } catch (_) {}
        }
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer);
          el.clientWebrtcStat.textContent = 'Restringido por política';
        });
    } catch (_) {
      el.clientWebrtcStat.textContent = 'No disponible';
    }
  }

  // --- Exportación ---
  function triggerDownload(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    if (!devices.length) {
      showToast('No hay dispositivos detectados para exportar.', true);
      return;
    }
    const payload = {
      exported_at: new Date().toISOString(),
      cidr: el.cidrInput.value.trim(),
      mode: discoveryMode,
      count: devices.length,
      devices: devices.map((d) => ({
        ip: d.ip,
        mac: d.mac,
        vendor: d.vendor,
        hostname: d.hostname,
        alias: d.alias,
        category: d.catMeta.label,
        os_inferred: d.osLabel,
        confidence_pct: d.confidence,
        rtt_ms: d.rttMs,
        ttl: d.ttl,
        ports: d.ports,
        banner: d.banner,
        source: d.source,
      })),
    };
    triggerDownload('inventario_red_lan.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('Inventario exportado en formato JSON.');
  }

  function exportCsv() {
    if (!devices.length) {
      showToast('No hay dispositivos detectados para exportar.', true);
      return;
    }
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = ['IP,MAC,Fabricante,Hostname,Alias,Categoria,SO,ConfianzaPct,RTT_ms,TTL,Puertos,Origen'];
    for (const d of devices) {
      rows.push([
        d.ip,
        d.mac || '',
        d.vendor,
        d.hostname || '',
        d.alias || '',
        d.catMeta.label,
        d.osLabel,
        d.confidence,
        d.rttMs ?? '',
        d.ttl ?? '',
        d.ports.join(';'),
        d.source,
      ].map(esc).join(','));
    }
    triggerDownload('inventario_red_lan.csv', rows.join('\n'), 'text/csv;charset=utf-8');
    showToast('Inventario exportado en formato CSV.');
  }

  // --- Modales ---
  function openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  // --- Fondo Ambiental ---
  function initAmbientCanvas() {
    const canvas = document.getElementById('ambientNetCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.032)';
      ctx.lineWidth = 1;
      const step = 52;
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
    }
    window.addEventListener('resize', draw);
    draw();
  }

  // --- Eventos UI ---
  function bindEvents() {
    el.cidrInput.addEventListener('input', updateCidrPreview);

    document.querySelectorAll('[data-cidr]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-cidr]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        el.cidrInput.value = btn.dataset.cidr;
        updateCidrPreview();
      });
    });

    document.querySelectorAll('.source-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (mode === 'sample') {
          loadSampleTopology();
        } else if (mode === 'import') {
          setMode('import');
          openModal('importModal');
        } else if (mode === 'agent') {
          setMode('agent');
          if (!agentConnected) openModal('agentModal');
        } else {
          setMode('web');
        }
      });
    });

    function runActiveScan() {
      if (scanning) return;
      if (discoveryMode === 'agent') runAgentSubnetScan();
      else if (discoveryMode === 'import') openModal('importModal');
      else if (discoveryMode === 'sample') loadSampleTopology();
      else runWebSubnetScan();
    }

    el.startScanBtn.addEventListener('click', runActiveScan);
    el.scanPrimaryBtn.addEventListener('click', runActiveScan);
    el.stopScanBtn.addEventListener('click', () => {
      if (scanAbortCtrl) scanAbortCtrl.abort();
      scanning = false;
      el.startScanBtn.classList.remove('hidden');
      el.stopScanBtn.classList.add('hidden');
      el.scanSummaryText.textContent = 'Detenido por usuario';
    });

    el.exportJsonBtn.addEventListener('click', exportJson);
    el.exportCsvBtn.addEventListener('click', exportCsv);

    // Botones del estado vacío
    el.emptyWebScanBtn.addEventListener('click', () => {
      setMode('web');
      runWebSubnetScan();
    });
    el.emptyAgentBtn.addEventListener('click', () => openModal('agentModal'));
    el.emptyImportBtn.addEventListener('click', () => openModal('importModal'));
    el.emptySampleBtn.addEventListener('click', loadSampleTopology);

    // Radar interacción
    el.radarOnlyOnlineBtn.addEventListener('click', () => {
      radarOnlyOnline = !radarOnlyOnline;
      el.radarOnlyOnlineBtn.classList.toggle('active', radarOnlyOnline);
    });

    el.radarCanvas.addEventListener('mousemove', (e) => {
      const rect = el.radarCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      let hit = null;
      for (const np of radarNodePositions) {
        const dx = mx - np.x;
        const dy = my - np.y;
        if (dx * dx + dy * dy <= (np.r + 8) * (np.r + 8)) {
          hit = np;
          break;
        }
      }
      radarHoveredDevice = hit ? hit.device : null;
      if (hit) {
        const d = hit.device;
        el.radarTooltip.textContent = `${d.alias || d.hostname || d.ip} (${d.ip})\n${d.vendor}\n${d.rttMs !== null ? d.rttMs.toFixed(1) + ' ms' : 'ARP caché'}`;
        el.radarTooltip.style.whiteSpace = 'pre-line';
        el.radarTooltip.style.left = `${Math.min(rect.width - 190, Math.max(8, hit.x + 12))}px`;
        el.radarTooltip.style.top = `${Math.max(8, hit.y - 16)}px`;
        el.radarTooltip.classList.remove('hidden');
      } else {
        el.radarTooltip.classList.add('hidden');
      }
    });

    el.radarCanvas.addEventListener('mouseleave', () => {
      radarHoveredDevice = null;
      el.radarTooltip.classList.add('hidden');
    });

    el.radarCanvas.addEventListener('click', (e) => {
      const rect = el.radarCanvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const np of radarNodePositions) {
        const dx = mx - np.x;
        const dy = my - np.y;
        if (dx * dx + dy * dy <= (np.r + 9) * (np.r + 9)) {
          selectDevice(np.device.ip);
          break;
        }
      }
    });

    // Ping Monitor
    el.pingToggleBtn.addEventListener('click', () => {
      pingActive = !pingActive;
      el.pingToggleBtn.textContent = pingActive ? '⏸ Pausar' : '▶ Iniciar';
      if (pingActive) {
        executeSinglePing();
        schedulePingLoop();
      } else {
        clearInterval(pingTimer);
      }
    });

    el.pingResetBtn.addEventListener('click', () => {
      pingHistory.length = 0;
      pingSeq = 0;
      el.pingLogFeed.innerHTML = '';
      el.pmMin.textContent = '-- ms';
      el.pmAvg.textContent = '-- ms';
      el.pmMax.textContent = '-- ms';
      el.pmJitter.textContent = '-- ms';
      el.pmP95.textContent = '-- ms';
      el.pmLoss.textContent = '0%';
      el.pingQualityBadge.textContent = 'CALIDAD --/100';
      drawPingWaveform();
      if (pingActive) executeSinglePing();
    });

    el.pingIntervalSelect.addEventListener('change', schedulePingLoop);

    document.querySelectorAll('[data-ping-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ping-target]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        el.pingTargetInput.value = btn.dataset.pingTarget;
        el.pingResetBtn.click();
      });
    });

    // Búsqueda, Filtros y Ordenación
    el.searchDeviceInput.addEventListener('input', renderDevicesTable);
    el.categoryFilters.querySelectorAll('.cat-filter').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.categoryFilters.querySelectorAll('.cat-filter').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeCategoryFilter = btn.dataset.cat;
        renderDevicesTable();
      });
    });

    document.querySelectorAll('#devicesTable thead th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const f = th.dataset.sort;
        if (sortField === f) sortAsc = !sortAsc;
        else {
          sortField = f;
          sortAsc = true;
        }
        renderDevicesTable();
      });
    });

    // Inspector: Alias, Ping, Copiar JSON
    el.saveAliasBtn.addEventListener('click', () => {
      const d = devices.find((item) => item.ip === selectedDeviceIp);
      if (!d) return;
      const key = d.mac || d.ip;
      const val = el.aliasInput.value.trim();
      if (val) aliases[key] = val;
      else delete aliases[key];
      try {
        localStorage.setItem(ALIAS_STORAGE_KEY, JSON.stringify(aliases));
      } catch (_) {}
      d.alias = val;
      refreshAllViews();
      showToast(val ? `Alias «${val}» guardado para ${key}` : 'Alias eliminado');
    });

    el.inspPingBtn.addEventListener('click', () => {
      const d = devices.find((item) => item.ip === selectedDeviceIp);
      if (!d) return;
      el.pingTargetInput.value = d.ip;
      document.querySelectorAll('[data-ping-target]').forEach((b) => b.classList.remove('active'));
      if (!pingActive) {
        pingActive = true;
        el.pingToggleBtn.textContent = '⏸ Pausar';
        schedulePingLoop();
      }
      el.pingResetBtn.click();
      showToast(`Monitor Ping apuntando a ${d.ip}`);
    });

    el.inspCopyJsonBtn.addEventListener('click', () => {
      const d = devices.find((item) => item.ip === selectedDeviceIp);
      if (!d) return;
      navigator.clipboard?.writeText(JSON.stringify(d, null, 2))
        .then(() => showToast(`Ficha JSON de ${d.ip} copiada`))
        .catch(() => showToast('No se pudo copiar al portapapeles', true));
    });

    // Modales
    el.agentModalBtn.addEventListener('click', () => openModal('agentModal'));
    el.importModalBtn.addEventListener('click', () => openModal('importModal'));
    document.querySelectorAll('.modal-close').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    el.testAgentConnBtn.addEventListener('click', () => connectLocalAgent(false));
    el.copyCmdUnixBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(el.cmdUnixText.textContent.trim())
        .then(() => showToast('Comando copiado al portapapeles'))
        .catch(() => {});
    });

    el.pickImportFileBtn.addEventListener('click', () => el.importFileInput.click());
    el.importFileInput.addEventListener('change', async () => {
      const file = el.importFileInput.files?.[0];
      if (!file) return;
      el.importTextarea.value = await file.text();
    });

    el.pasteExampleImportBtn.addEventListener('click', () => {
      el.importTextarea.value =
`Interfaz: 192.168.1.35 --- 0x10
  Dirección de Internet          Dirección física      Tipo
  192.168.1.1           c0-25-06-8a-12-40     dinámico
  192.168.1.10          00-11-32-9e-44-21     dinámico
  192.168.1.15          b8-27-eb-51-c2-08     dinámico
  192.168.1.20          52-54-00-a4-31-77     dinámico
  192.168.1.54          4a-91-22-0b-7e-3c     dinámico
  192.168.1.70          00-1b-a9-74-22-19     dinámico
  192.168.1.112         24-0a-c4-90-14-f8     dinámico`;
    });

    el.parseImportBtn.addEventListener('click', () => {
      const parsed = parseImportedText(el.importTextarea.value);
      if (!parsed.length) {
        showToast('No se reconocieron direcciones IP/MAC en el texto aportado.', true);
        return;
      }
      setMode('import');
      devices = parsed.sort((a, b) => a.ipNum - b.ipNum);
      el.scanSummaryText.textContent = `${devices.length} importados`;
      closeModal('importModal');
      selectedDeviceIp = devices.length ? devices[0].ip : null;
      refreshAllViews();
      showToast(`Identificados ${devices.length} dispositivos desde el archivo/texto con Rust WASM.`);
    });

    // Modo inmersivo y Pantalla completa
    el.cleanModeBtn.addEventListener('click', () => document.body.classList.add('clean-mode'));
    el.restoreUiBtn.addEventListener('click', () => document.body.classList.remove('clean-mode'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.body.classList.remove('clean-mode');
        closeModal('agentModal');
        closeModal('importModal');
      }
    });

    el.fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      else document.exitFullscreen().catch(() => {});
    });

    window.addEventListener('resize', drawPingWaveform);
  }

  // --- Inicialización ---
  async function boot() {
    initAmbientCanvas();
    bindEvents();
    renderDevicesTable();
    await initWasm();
    inspectClientEnvironment();
    requestAnimationFrame(drawRadar);
    drawPingWaveform();
    executeSinglePing();
    schedulePingLoop();
  }

  boot();
})();

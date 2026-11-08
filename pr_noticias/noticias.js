/**
 * Subproyecto #07: Kiosco Dinámico de Prensa
 * Agregador aleatorio de prensa:
 * - Nacional: El Mundo, El País, El Confidencial, ABC
 * - Internacional: BBC News, The Guardian, The New York Times, TIME
 * Algoritmo de barajado pseudoaleatorio en Rust WebAssembly
 * javiergalilea.es/pr_noticias/
 */

(function () {
  'use strict';

  let wasmInstance = null;
  let wasmMemory = null;
  let shuffledPtr = 0;

  // Catálogo de periódicos (Nacionales e Internacionales)
  const SOURCES = [
    // 🇪🇸 Nacionales
    {
      id: 'elmundo',
      name: 'El Mundo',
      scope: 'nacional',
      tagClass: 'source-elmundo',
      url: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml'
    },
    {
      id: 'elpais',
      name: 'El País',
      scope: 'nacional',
      tagClass: 'source-elpais',
      url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada'
    },
    {
      id: 'elconfidencial',
      name: 'El Confidencial',
      scope: 'nacional',
      tagClass: 'source-elconfidencial',
      url: 'https://rss.elconfidencial.com/espana/'
    },
    {
      id: 'abc',
      name: 'ABC',
      scope: 'nacional',
      tagClass: 'source-abc',
      url: 'https://www.abc.es/rss/2.0/espana/'
    },

    // 🌍 Internacionales (English)
    {
      id: 'bbc',
      name: 'BBC News',
      scope: 'internacional',
      tagClass: 'source-bbc',
      url: 'https://feeds.bbci.co.uk/news/world/rss.xml'
    },
    {
      id: 'theguardian',
      name: 'The Guardian',
      scope: 'internacional',
      tagClass: 'source-guardian',
      url: 'https://www.theguardian.com/world/rss'
    },
    {
      id: 'nytimes',
      name: 'The New York Times',
      scope: 'internacional',
      tagClass: 'source-nytimes',
      url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml'
    },
    {
      id: 'time',
      name: 'TIME',
      scope: 'internacional',
      tagClass: 'source-time',
      url: 'https://time.com/feed/'
    }
  ];

  let allArticles = [];
  let currentScope = 'all'; // 'all' | 'nacional' | 'internacional'
  let currentSource = 'all'; // 'all' | source id

  // Elementos DOM
  const newsGrid = document.getElementById('newsGrid');
  const loadingBox = document.getElementById('loadingBox');
  const newsCounter = document.getElementById('newsCounter');
  const shuffleBtn = document.getElementById('shuffleBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');

  // Limpiar texto de etiquetas HTML
  function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim();
  }

  // Extraer la mejor imagen disponible según la estructura del feed
  function extractImage(item, sourceId) {
    // 1. Enclosure de rss2json / RSS clásico
    if (item.enclosure && item.enclosure.link && (item.enclosure.type?.includes('image') || item.enclosure.link.match(/\.(jpg|jpeg|png|webp)/i))) {
      return item.enclosure.link;
    }
    // 2. Thumbnail directo
    if (item.thumbnail && item.thumbnail.length > 5 && !item.thumbnail.includes('.gif')) {
      return item.thumbnail;
    }
    // 3. Propiedades estándar de JSON Feed (feed2json)
    if (item.image && typeof item.image === 'string' && item.image.length > 5) {
      return item.image;
    }
    if (item.banner_image && typeof item.banner_image === 'string' && item.banner_image.length > 5) {
      return item.banner_image;
    }
    if (Array.isArray(item.attachments)) {
      const imgAtt = item.attachments.find(a => a.mime_type?.startsWith('image') || a.url?.match(/\.(jpg|jpeg|png|webp)/i));
      if (imgAtt && imgAtt.url) return imgAtt.url;
    }
    // 4. Buscar etiqueta <img> en el contenido HTML
    const content = item.content_html || item.content || item.description || '';
    const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1] && !match[1].includes('imrworldwide') && !match[1].includes('.gif')) {
      return match[1];
    }
    // 5. Fotografía de prensa de alta calidad por medio
    const fallbacks = {
      elmundo: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=700&q=80',
      elpais: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=700&q=80',
      elconfidencial: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=700&q=80',
      abc: 'https://images.unsplash.com/photo-1523995462485-3d171b5c8fa9?w=700&q=80',
      bbc: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=700&q=80',
      theguardian: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=700&q=80',
      nytimes: 'https://images.unsplash.com/photo-1534270804882-6b5048b1c1fc?w=700&q=80',
      time: 'https://images.unsplash.com/photo-1476242906366-d8eb64c2f661?w=700&q=80'
    };
    return fallbacks[sourceId] || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=700&q=80';
  }

  // Parsear los ítems independientemente del formato (rss2json o feed2json)
  function parseFeedItems(items, source) {
    if (!Array.isArray(items)) return [];

    return items.map(item => {
      const rawText = item.description || item.summary || item.content_html || item.content || '';
      const cleanDesc = stripHtml(rawText)
        .replace(/Leer$/, '')
        .replace(/Seguir leyendo$/, '')
        .replace(/Continue reading\.\.\.$/, '')
        .trim();

      const pubDate = item.pubDate ? new Date(item.pubDate) : (item.date_published ? new Date(item.date_published) : new Date());

      return {
        sourceId: source.id,
        sourceName: source.name,
        sourceScope: source.scope,
        sourceTagClass: source.tagClass,
        title: item.title || '',
        link: item.link || item.url || item.guid || '#',
        date: isNaN(pubDate.getTime()) ? new Date() : pubDate,
        description: cleanDesc,
        image: extractImage(item, source.id)
      };
    }).filter(a => a.title.length > 0);
  }

  // Carga un feed individual con soporte para feed2json y rss2json
  async function fetchFeed(source) {
    // Si es internacional probamos feed2json primero (sin límites); si es nacional probamos rss2json primero
    const endpoints = source.scope === 'internacional'
      ? [
          `https://feed2json.org/convert?url=${encodeURIComponent(source.url)}`,
          `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`
        ]
      : [
          `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`,
          `https://feed2json.org/convert?url=${encodeURIComponent(source.url)}`
        ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) continue;
        const data = await res.json();

        // 1. Formato rss2json: { status: 'ok', items: [...] }
        if (data.status === 'ok' && Array.isArray(data.items)) {
          return parseFeedItems(data.items, source);
        }

        // 2. Formato JSON Feed (feed2json): { items: [...] }
        if (Array.isArray(data.items)) {
          return parseFeedItems(data.items, source);
        }
      } catch (err) {
        // Continuar al siguiente endpoint de respaldo
      }
    }

    console.warn(`No se pudo cargar el feed de ${source.name}`);
    return [];
  }

  // Barajar array usando Fisher-Yates en Rust WebAssembly
  function shuffleWithWasm(items) {
    if (!wasmInstance || items.length === 0) {
      return items.sort(() => Math.random() - 0.5);
    }

    const count = items.length;
    const seed = Math.floor(Math.random() * 1000000);
    const n = wasmInstance.exports.shuffle_news(count, seed);

    const u16 = new Uint16Array(wasmMemory.buffer, shuffledPtr, n);
    const result = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = items[u16[i]];
    }
    return result;
  }

  // Formato relativo de tiempo bilingüe
  function formatTimeAgo(date, isEn) {
    const diffMin = Math.floor((new Date() - date) / 60000);
    if (isNaN(diffMin) || diffMin < 1) return isEn ? 'Just now' : 'Hace un momento';
    if (diffMin < 60) return isEn ? `${diffMin}m ago` : `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return isEn ? `${diffH}h ago` : `Hace ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    return isEn ? `${diffD}d ago` : `Hace ${diffD} d`;
  }

  // Renderizar noticias con filtros aplicados
  function renderNews() {
    let filtered = allArticles;

    // Filtro por ámbito (Nacional / Internacional / Todos)
    if (currentScope !== 'all') {
      filtered = filtered.filter(a => a.sourceScope === currentScope);
    }

    // Filtro por cabecera individual
    if (currentSource !== 'all') {
      filtered = filtered.filter(a => a.sourceId === currentSource);
    }

    newsCounter.textContent = filtered.length;
    newsGrid.innerHTML = '';

    if (filtered.length === 0) {
      newsGrid.innerHTML = '<div class="loading-state"><p>No se encontraron noticias para esta selección en este momento.</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(art => {
      const isEn = art.sourceScope === 'internacional';
      const card = document.createElement('a');
      card.href = art.link;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'news-card';

      const timeAgo = formatTimeAgo(art.date, isEn);
      const readMoreText = isEn ? `Read full story on ${art.sourceName}` : `Leer noticia en ${art.sourceName}`;

      card.innerHTML = `
        <div class="news-img-box">
          <img class="news-img" src="${art.image}" alt="${art.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=700&q=80'">
          <span class="news-source-tag ${art.sourceTagClass}">${art.sourceName}</span>
        </div>
        <div class="news-content">
          <span class="news-time">🕒 ${timeAgo}</span>
          <h2 class="news-title">${art.title}</h2>
          <p class="news-desc">${art.description || (isEn ? 'Click to open the complete story...' : 'Haz clic para leer la noticia completa...')}</p>
          <div class="news-footer">
            <span>${readMoreText}</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      `;

      fragment.appendChild(card);
    });

    newsGrid.appendChild(fragment);
  }

  // Actualizar estado visual de los botones de filtro
  function updateFilterUI() {
    // 1. Ámbito
    document.querySelectorAll('.scope-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.scope === currentScope);
    });

    // 2. Cabeceras individuales
    document.querySelectorAll('.filter-pill').forEach(btn => {
      const src = btn.dataset.source;
      const scope = btn.dataset.scope;

      btn.classList.toggle('active', src === currentSource);

      // Atenuar si no pertenece al ámbito actual seleccionado
      if (currentScope !== 'all' && scope && scope !== currentScope) {
        btn.classList.add('dimmed');
      } else {
        btn.classList.remove('dimmed');
      }
    });
  }

  // Carga paralela de todas las fuentes
  async function loadAllNews() {
    loadingBox.style.display = 'flex';
    newsGrid.innerHTML = '';

    const promises = SOURCES.map(s => fetchFeed(s));
    const results = await Promise.all(promises);

    let combined = [];
    results.forEach(items => {
      combined = combined.concat(items);
    });

    // Barajamos aleatoriamente con Rust WASM para intercalar noticias
    allArticles = shuffleWithWasm(combined);

    loadingBox.style.display = 'none';
    renderNews();
  }

  function setupEvents() {
    // Filtros por Ámbito (Todos, Nacional, Internacional)
    document.querySelectorAll('.scope-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedScope = btn.dataset.scope;
        currentScope = selectedScope;

        // Si la cabecera actual no coincide con el nuevo ámbito, volver a 'all'
        if (currentSource !== 'all') {
          const srcObj = SOURCES.find(s => s.id === currentSource);
          if (srcObj && currentScope !== 'all' && srcObj.scope !== currentScope) {
            currentSource = 'all';
          }
        }

        updateFilterUI();
        renderNews();
      });
    });

    // Filtros por Cabecera individual
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const selectedSource = btn.dataset.source;
        currentSource = selectedSource;

        if (selectedSource === 'all') {
          // Mantener o resetear según contexto
        } else {
          // Auto-activar el ámbito correspondiente a la cabecera
          const srcObj = SOURCES.find(s => s.id === selectedSource);
          if (srcObj) {
            currentScope = srcObj.scope;
          }
        }

        updateFilterUI();
        renderNews();
      });
    });

    // Barajar
    shuffleBtn.addEventListener('click', () => {
      allArticles = shuffleWithWasm(allArticles);
      renderNews();
    });

    // Recargar
    refreshBtn.addEventListener('click', loadAllNews);

    // Pantalla completa
    fullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  async function initWasm() {
    try {
      const res = await fetch('engine.wasm');
      const bytes = await res.arrayBuffer();
      const module = await WebAssembly.instantiate(bytes);
      wasmInstance = module.instance;
      wasmMemory = wasmInstance.exports.memory;
      shuffledPtr = wasmInstance.exports.get_shuffled_ptr();
      console.log('✅ noticias_engine.wasm (Rust) listo.');
    } catch (e) {
      console.warn('WASM no disponible, usando fallback JS:', e);
    }
  }

  setupEvents();
  initWasm().then(() => {
    loadAllNews();
  });
})();

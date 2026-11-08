/**
 * Subproyecto #07: Kiosco Dinámico de Noticias
 * Agregador aleatorio de prensa: El Mundo, El País, El Confidencial y ABC
 * Algoritmo de barajado pseudoaleatorio en Rust WebAssembly
 * javiergalilea.es/pr_noticias/
 */

(function () {
  'use strict';

  let wasmInstance = null;
  let wasmMemory = null;
  let shuffledPtr = 0;

  // Feeds RSS de los 4 periódicos
  const SOURCES = [
    {
      id: 'elmundo',
      name: 'El Mundo',
      tagClass: 'source-elmundo',
      url: 'https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml'
    },
    {
      id: 'elpais',
      name: 'El País',
      tagClass: 'source-elpais',
      url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada'
    },
    {
      id: 'elconfidencial',
      name: 'El Confidencial',
      tagClass: 'source-elconfidencial',
      url: 'https://rss.elconfidencial.com/espana/'
    },
    {
      id: 'abc',
      name: 'ABC',
      tagClass: 'source-abc',
      url: 'https://www.abc.es/rss/2.0/espana/'
    }
  ];

  let allArticles = [];
  let currentFilter = 'all';

  // DOM
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
    return tmp.textContent || tmp.innerText || '';
  }

  // Extraer la mejor imagen disponible del ítem RSS
  function extractImage(item, sourceId) {
    if (item.enclosure && item.enclosure.link && (item.enclosure.type?.includes('image') || item.enclosure.link.match(/\.(jpg|jpeg|png|webp)/i))) {
      return item.enclosure.link;
    }
    if (item.thumbnail && item.thumbnail.length > 5 && !item.thumbnail.includes('gif')) {
      return item.thumbnail;
    }
    // Buscar en el contenido HTML
    const content = item.content || item.description || '';
    const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1] && !match[1].includes('imrworldwide') && !match[1].includes('.gif')) {
      return match[1];
    }
    // Imagen por defecto temática de prensa según el medio
    const fallbacks = {
      elmundo: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=700&q=80',
      elpais: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=700&q=80',
      elconfidencial: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=700&q=80',
      abc: 'https://images.unsplash.com/photo-1523995462485-3d171b5c8fa9?w=700&q=80'
    };
    return fallbacks[sourceId] || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=700&q=80';
  }

  // Cargar un feed individual a través de API proxy JSON
  async function fetchFeed(source) {
    try {
      const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(source.url)}`;
      const res = await fetch(apiUrl);
      if (!res.ok) return [];
      const data = await res.json();
      if (data.status !== 'ok' || !Array.isArray(data.items)) return [];

      return data.items.map(item => {
        const cleanDesc = stripHtml(item.description || item.content || '')
          .replace(/Leer$/, '')
          .replace(/Seguir leyendo$/, '')
          .trim();

        return {
          sourceId: source.id,
          sourceName: source.name,
          sourceTagClass: source.tagClass,
          title: item.title,
          link: item.link,
          date: item.pubDate ? new Date(item.pubDate) : new Date(),
          description: cleanDesc,
          image: extractImage(item, source.id)
        };
      });
    } catch (e) {
      console.warn(`Error cargando feed de ${source.name}:`, e);
      return [];
    }
  }

  // Barajar array usando el algoritmo Fisher-Yates compilado en Rust WASM
  function shuffleWithWasm(items) {
    if (!wasmInstance || items.length === 0) {
      // Fallback JS si WASM no está listo
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

  // Renderizar las tarjetas en la cuadrícula
  function renderNews() {
    let filtered = allArticles;
    if (currentFilter !== 'all') {
      filtered = allArticles.filter(a => a.sourceId === currentFilter);
    }

    newsCounter.textContent = filtered.length;
    newsGrid.innerHTML = '';

    if (filtered.length === 0) {
      newsGrid.innerHTML = '<div class="loading-state"><p>No se encontraron noticias para este medio en este momento.</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();

    filtered.forEach(art => {
      const card = document.createElement('a');
      card.href = art.link;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.className = 'news-card';

      const timeAgo = formatTimeAgo(art.date);

      card.innerHTML = `
        <div class="news-img-box">
          <img class="news-img" src="${art.image}" alt="${art.title}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=700&q=80'">
          <span class="news-source-tag ${art.sourceTagClass}">${art.sourceName}</span>
        </div>
        <div class="news-content">
          <span class="news-time">🕒 ${timeAgo}</span>
          <h2 class="news-title">${art.title}</h2>
          <p class="news-desc">${art.description}</p>
          <div class="news-footer">
            <span>Leer noticia en ${art.sourceName}</span>
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

  function formatTimeAgo(date) {
    const diffMin = Math.floor((new Date() - date) / 60000);
    if (isNaN(diffMin) || diffMin < 1) return 'Hace un momento';
    if (diffMin < 60) return `Hace ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Hace ${diffH} h`;
    return `Hace ${Math.floor(diffH / 24)} d`;
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
    // Filtros por periódico
    document.querySelectorAll('.filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.source;
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

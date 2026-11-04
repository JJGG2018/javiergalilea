# javiergalilea.xyz — WebAssembly Personal Home

Sitio web personal y carta de presentación para **[javiergalilea.xyz](https://javiergalilea.xyz)**, construido con arquitectura ultraligera sin frameworks pesados, impulsado por **WebAssembly (WASM)** y HTML5 Canvas.

---

## ⚡ Características

- **Motor WebAssembly Nativo (822 bytes):**
  - Físicas de partículas en tiempo real con memoria lineal directa.
  - Modos interactivos: **Atracción**, **Repulsión** y **Vórtice**.
  - Simulación fluida de hasta 8,000+ partículas a 60 FPS.
- **Benchmark Interactivo en Vivo:**
  - Comparativa de cálculo numérico en tiempo real (aproximación matemática Leibniz Pi con 5,000,000 iteraciones) ejecutada en paralelo: **WebAssembly vs JavaScript**.
- **Diseño Moderno & Responsivo:**
  - Estética oscura con tarjetas de cristal esmerilado (*glassmorphism*), degradados de neón y tipografía limpia.
  - Soporte completo para pantallas táctiles y Retina/HiDPI.
- **Sin Dependencias Externas:**
  - Código HTML5, CSS y JS puro que carga en milisegundos.

---

## 📁 Estructura del Proyecto

```text
javiergalilea/
├── index.html       # Estructura de la web, secciones y controles HUD
├── style.css        # Diseño, variables CSS y efectos visuales
├── app.js           # Integración con WebAssembly, renderizado en canvas y benchmark
├── engine.wasm      # Módulo binario WebAssembly (822 bytes)
├── build_wasm.py    # Script generador y compilador del binario WASM
├── serve.py         # Servidor local con cabeceras MIME y seguridad para WASM
└── README.md        # Documentación del proyecto
```

---

## 🚀 Cómo probarlo en local

Dado que los navegadores bloquean la carga de binarios WebAssembly bajo el protocolo `file://`, es necesario servirlo mediante HTTP:

### Opción 1: Con Python (Recomendada)
```bash
python serve.py
```
*Abrirá automáticamente tu navegador en `http://localhost:8080`.*

O de forma directa:
```bash
python -m http.server 8080
```

### Opción 2: Con Node.js
```bash
npx serve .
```

---

## 🛠️ Cómo recompilar o modificar el motor WebAssembly

El módulo `engine.wasm` se genera mediante el script independiente `build_wasm.py`, que ensambla el bytecode binario estándar de WebAssembly sin necesidad de instalar toolchains pesadas:

```bash
python build_wasm.py
```

Funciones exportadas por el módulo:
- `memory`: Buffer de memoria lineal compartida (Float32Array).
- `init(count, width, height)`: Inicializa partículas con posición y velocidad aleatoria.
- `update(count, width, height, mx, my, m_active, mode, dt)`: Ejecuta el paso de física.
- `get_memory_offset()`: Devuelve el puntero base en memoria.
- `benchmark_calc(iterations)`: Test intensivo de cálculo de punto flotante en WASM.

---

## 🌐 Publicación con tu dominio `javiergalilea.xyz`

Una vez tengas comprado el dominio `javiergalilea.xyz`, puedes alojar esta web de forma 100% gratuita con soporte HTTPS en cualquiera de estas plataformas:

### 1. Cloudflare Pages (Muy recomendado por su velocidad y DNS)
1. Sube este repositorio a GitHub.
2. En Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages**.
3. Selecciona tu repositorio y haz clic en **Deploy** (no requiere comando de build).
4. Añade tu dominio personalizado `javiergalilea.xyz`.

### 2. GitHub Pages
1. Sube los archivos a un repositorio llamado `javiergalilea.github.io` (o el nombre que prefieras).
2. En Settings -> **Pages** -> Source: `main` / root.
3. En **Custom domain**, introduce `javiergalilea.xyz`.
4. Añade los registros CNAME o IP en tu registrador de dominio.

### 3. Vercel o Netlify
- Solo arrastra esta carpeta o conecta el repositorio Git y vincula tu dominio en la configuración de DNS.

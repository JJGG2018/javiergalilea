# javiergalilea.es — Rust & WebAssembly Personal Home

Sitio web personal y carta de presentación para **[javiergalilea.es](https://javiergalilea.es)**, construido con arquitectura ultraligera sin frameworks pesados, impulsado por **Rust** compilado a **WebAssembly (WASM)** nativo y HTML5 Canvas.

---

## ⚡ Características

- **Motor programado en Rust (`no_std`) y compilado a WASM (1.1 KB):**
  - Físicas de partículas en tiempo real con memoria lineal directa (`Float32Array`).
  - Modos interactivos: **Atracción**, **Repulsión** y **Vórtice**.
  - Simulación fluida de hasta 8,000+ partículas a 60 FPS.
- **Benchmark Interactivo en Vivo:**
  - Comparativa de cálculo numérico en tiempo real (aproximación matemática Leibniz Pi con 5,000,000 iteraciones) ejecutada en paralelo: **Rust (WASM) vs JavaScript**.
- **Diseño Moderno & Responsivo:**
  - Estética oscura con tarjetas de cristal esmerilado (*glassmorphism*), degradados de neón y tipografía limpia.
  - Soporte completo para pantallas táctiles y Retina/HiDPI.
- **Sin Dependencias Externas:**
  - Código HTML5, CSS y JS puro que carga en milisegundos.

---

## 📁 Estructura del Proyecto

```text
javiergalilea/
├── wasm-engine/     # Crate de Rust (código fuente del motor)
│   ├── Cargo.toml   # Configuración de Cargo (crate-type cdylib, LTO, opt-level z)
│   └── src/
│       └── lib.rs   # Código Rust (física de partículas, LCG RNG, benchmark)
├── index.html       # Estructura de la web, secciones y controles HUD
├── style.css        # Diseño, variables CSS y efectos visuales
├── app.js           # Integración con WebAssembly, renderizado en canvas y benchmark
├── engine.wasm      # Binario WebAssembly compilado desde Rust (1.1 KB)
├── build_wasm.py    # Script de build para compilar Rust con Cargo y copiar el .wasm
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

## 🦀 Cómo compilar o modificar el código Rust

El código fuente del motor se encuentra en [`wasm-engine/src/lib.rs`](wasm-engine/src/lib.rs).

### Recompilar con Cargo directamente:
```bash
cargo build --manifest-path wasm-engine/Cargo.toml --target wasm32-unknown-unknown --release
copy wasm-engine\target\wasm32-unknown-unknown\release\engine.wasm .\engine.wasm
```

### O mediante el script automatizado:
```bash
python build_wasm.py
```

### Funciones exportadas en Rust:
- `get_memory_offset() -> *const Particle`: Puntero al array contiguo de partículas en la memoria lineal de WebAssembly.
- `init(count: i32, width: f32, height: f32) -> i32`: Inicializa las partículas con posiciones y velocidades aleatorias.
- `update(count: i32, width: f32, height: f32, mx: f32, my: f32, m_active: i32, mode: i32, dt: f32) -> i32`: Calcula la física y actualiza el estado.
- `benchmark_calc(iterations: i32) -> f32`: Test intensivo de cálculo numérico en Rust compilado a WASM.

---

## 🌐 Publicación con tu dominio `javiergalilea.es`

Una vez tengas comprado el dominio `javiergalilea.es`, puedes alojar esta web de forma 100% gratuita con soporte HTTPS en cualquiera de estas plataformas:

### 1. Cloudflare Pages (Muy recomendado para dominios .es)
1. Sube este repositorio a GitHub.
2. En Cloudflare Dashboard -> **Workers & Pages** -> **Create application** -> **Pages**.
3. Selecciona tu repositorio y haz clic en **Deploy** (no requiere comando de build, o puedes poner `cargo build --manifest-path wasm-engine/Cargo.toml --target wasm32-unknown-unknown --release && cp wasm-engine/target/wasm32-unknown-unknown/release/engine.wasm .` si configuras Rust).
4. Añade tu dominio personalizado `javiergalilea.es`.

### 2. GitHub Pages
1. Sube los archivos a un repositorio (por ejemplo `javiergalilea.github.io` o `javiergalilea-es`).
2. En Settings -> **Pages** -> Source: `main` / root.
3. En **Custom domain**, introduce `javiergalilea.es`.
4. Añade los registros CNAME o registros DNS tipo A (`185.199.108.153`, etc.) en tu registrador del dominio .es.

### 3. Vercel o Netlify
- Simplemente arrastra esta carpeta o conecta el repositorio Git y vincula `javiergalilea.es` en la configuración de DNS.

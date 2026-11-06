# javiergalilea.es — Rust & WebAssembly Personal Home

Sitio web personal y carta de presentación para **[javiergalilea.es](https://javiergalilea.es)**, construido con arquitectura ultraligera sin frameworks pesados, impulsado por **Rust** (`#![no_std]`) compilado a **WebAssembly (WASM)** nativo y HTML5 Canvas.

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
- **Sin Dependencias de Runtimes Externos:**
  - Solo Rust + Cargo para el motor y HTML5/CSS/JS nativo para la web.

---

## 📁 Estructura del Proyecto

```text
javiergalilea/
├── .cargo/
│   └── config.toml   # Configuración de compilación (target wasm32-unknown-unknown por defecto)
├── Cargo.toml        # Workspace de Cargo raíz con perfiles de optimización
├── engine/           # Crate de Rust (código fuente del motor WASM)
│   ├── Cargo.toml    # Definición de la biblioteca cdylib
│   └── src/
│       └── lib.rs    # Código Rust (física de partículas, LCG RNG, benchmark)
├── css/
│   └── style.css     # Estilos, variables CSS y diseño responsive
├── js/
│   └── app.js        # Integración de WASM, renderizado en canvas y benchmark
├── wasm/
│   └── engine.wasm   # Binario WebAssembly compilado desde Rust (1.1 KB)
├── CNAME             # Dominio personalizado para GitHub Pages (javiergalilea.es)
├── index.html        # Página web principal
├── .gitignore        # Exclusiones de Git (target de Rust, temporales, etc.)
└── README.md         # Documentación del proyecto
```

---

## 🦀 Compilación directa con Cargo

Gracias a la configuración de Cargo del repositorio, puedes compilar el motor WebAssembly desde la raíz con un solo comando:

```bash
cargo build --release
```

Y para copiar el binario generado a la carpeta web `wasm/`:

```powershell
Copy-Item target/wasm32-unknown-unknown/release/engine.wasm wasm/engine.wasm
```

### Funciones exportadas en Rust:
- `get_memory_offset() -> *const Particle`: Puntero al array contiguo de partículas en la memoria lineal de WebAssembly.
- `init(count: i32, width: f32, height: f32) -> i32`: Inicializa las partículas con posiciones y velocidades aleatorias.
- `update(count: i32, width: f32, height: f32, mx: f32, my: f32, m_active: i32, mode: i32, dt: f32) -> i32`: Calcula la física y actualiza el estado.
- `benchmark_calc(iterations: i32) -> f32`: Test intensivo de cálculo numérico en Rust compilado a WASM.

---

## 🚀 Cómo probar la web en local

Para servir los archivos estáticos en tu máquina (evitando las restricciones del protocolo `file://` para WebAssembly):

### Con Node / npx:
```bash
npx serve .
```

O cualquier otro servidor HTTP estático de tu preferencia.

---

## 🌐 Despliegue en Producción (`javiergalilea.es`)

El sitio se encuentra desplegado automáticamente mediante **GitHub Pages** con certificado SSL/HTTPS sobre el dominio **[javiergalilea.es](https://javiergalilea.es)** (configurado a través del archivo [`CNAME`](CNAME) en la raíz del repositorio y los registros DNS `A` y `CNAME` del dominio `.es`).

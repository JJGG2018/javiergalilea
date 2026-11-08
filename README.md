# javiergalilea.es — Espacio Creativo & Proyectos

Sitio web personal y portal de experimentos interactivos para **[javiergalilea.es](https://javiergalilea.es)**.

Cada subproyecto se encuentra **completamente encapsulado y aislado** en su propia carpeta, permitiendo que cada uno utilice la tecnología más adecuada (Rust/WebAssembly, Web Audio API, Canvas 2D/WebGL) de forma independiente.

---

## 📁 Arquitectura Encapsulada

```text
javiergalilea/
├── index.html            # Portal principal / Portada
├── css/style.css         # Estilos globales de la Home
├── js/app.js             # Vistas previas ligeras para las tarjetas
├── CNAME                 # Configuración de dominio para GitHub Pages
├── Cargo.toml            # Cargo Workspace raíz para proyectos Rust
│
├── pr_particulas/        # [Subproyecto 01: Físicas y Partículas]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── particulas.css    # Interfaz y dock de controles
│   ├── particulas.js     # Integración del motor
│   ├── engine.wasm       # Binario compilado
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── pr_automata/          # [Subproyecto 02: Autómatas & Vida Artificial]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── automata.css      # Interfaz y dock de controles
│   ├── automata.js       # Integración del motor
│   ├── engine.wasm       # Binario compilado
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── pr_ondas/             # [Subproyecto 03: Ondas & Audio]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── ondas.css         # Interfaz y dock de controles
│   ├── ondas.js          # Síntesis acústica Web Audio API y figuras
│   ├── engine.wasm       # Binario compilado
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── pr_dispositivo/       # [Subproyecto 04: Telemetría & Hardware]
│   ├── index.html        # Panel de auditoría de hardware y sensores
│   ├── dispositivo.css   # Estilos Bento Grid y HUD
│   ├── dispositivo.js    # Lectura de APIs nativas y permisos
│   ├── engine.wasm       # Motor de puntuación y benchmark en Rust
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── pr_fractales/         # [Subproyecto 05: Fractales & Caos]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── fractales.css     # Interfaz y dock de controles
│   ├── fractales.js      # Cámara compleja, zoom y renderizado RGBA
│   ├── engine.wasm       # Binario compilado (Mandelbrot, Julia, Ship, Tricorn)
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── pr_reloj/             # [Subproyecto 06: Reloj Cósmico & Túnel TV]
│   ├── index.html        # Experiencia a pantalla completa / modo salón
│   ├── reloj.css         # Tipografía digital y modo inmersivo limpio
│   ├── reloj.js          # Reloj en vivo y renderizado de anillos
│   ├── engine.wasm       # Motor analítico ultra-ligero (528 bytes)
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
└── pr_noticias/          # [Subproyecto 07: Kiosco Dinámico de Noticias]
    ├── index.html        # Kiosco dinámico de prensa
    ├── noticias.css      # Tarjetas con imagen y resumen
    ├── noticias.js       # Consumo RSS (El Mundo, El País, El Confidencial, ABC)
    ├── engine.wasm       # Barajado aleatorio Fisher-Yates (339 bytes)
    └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
```

---

## 🦀 Compilar subproyectos de Rust

Desde la raíz del repositorio, gracias al Cargo Workspace:

```bash
cargo build --release
```

Y para actualizar el binario en la carpeta del subproyecto:

```powershell
Copy-Item target/wasm32-unknown-unknown/release/engine.wasm particulas/engine.wasm
```

---

## 🌐 Despliegue

El sitio se despliega de forma continua y automática en **GitHub Pages** al hacer push a la rama `main`, con soporte HTTPS nativo bajo **https://javiergalilea.es**.

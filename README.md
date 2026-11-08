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
├── particulas/           # [Subproyecto 01: Físicas y Partículas]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── particulas.css    # Interfaz y dock de controles
│   ├── particulas.js     # Integración del motor
│   ├── engine.wasm       # Binario compilado
│   └── engine/           # Crate de Rust autónomo (lib.rs, Cargo.toml)
│
├── automata/             # [Subproyecto 02: Autómatas & Vida Artificial]
│   ├── index.html        # Experiencia a pantalla completa
│   ├── automata.css      # Interfaz y dock de controles
│   └── automata.js       # Motor de simulación celular y patrones
│
└── ondas/                # [Subproyecto 03: Ondas & Audio]
    ├── index.html        # Experiencia a pantalla completa
    ├── ondas.css         # Interfaz y dock de controles
    └── ondas.js          # Síntesis acústica Web Audio API y figuras de Lissajous
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

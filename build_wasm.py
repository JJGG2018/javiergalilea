"""
Script para compilar el motor WebAssembly desde Rust y copiarlo a la raíz del proyecto.
"""

import subprocess
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
CRATE_DIR = ROOT / "wasm-engine"
TARGET_WASM = CRATE_DIR / "target" / "wasm32-unknown-unknown" / "release" / "engine.wasm"
DEST_WASM = ROOT / "engine.wasm"

def build():
    print("[Rust] Compilando motor WebAssembly con Cargo...")
    cmd = [
        "cargo",
        "build",
        "--manifest-path",
        str(CRATE_DIR / "Cargo.toml"),
        "--target",
        "wasm32-unknown-unknown",
        "--release"
    ]
    
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print("[ERROR] Fallo al compilar con Cargo.", file=sys.stderr)
        sys.exit(res.returncode)

    if not TARGET_WASM.exists():
        print(f"[ERROR] No se encontro el binario generado en {TARGET_WASM}", file=sys.stderr)
        sys.exit(1)

    shutil.copy2(TARGET_WASM, DEST_WASM)
    size = DEST_WASM.stat().st_size
    print(f"[OK] Compilacion exitosa: '{DEST_WASM.name}' generado correctamente ({size:,} bytes).")

if __name__ == '__main__':
    build()

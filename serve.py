#!/usr/bin/env python3
"""
Servidor HTTP local rápido para probar javiergalilea.es con Rust y WebAssembly.
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080

class WasmHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Permite SharedArrayBuffer y optimizaciones de seguridad modernas
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

def run():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    WasmHandler.extensions_map['.wasm'] = 'application/wasm'

    port = PORT
    for p in [8080, 8000, 3000, 8888]:
        try:
            with socketserver.TCPServer(("", p), WasmHandler) as httpd:
                print(f"✨ Servidor local activo en: http://localhost:{p}")
                print("Pulsa Ctrl+C para detener el servidor.\n")
                webbrowser.open(f"http://localhost:{p}")
                httpd.serve_forever()
            break
        except OSError:
            continue

if __name__ == '__main__':
    try:
        run()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        sys.exit(0)


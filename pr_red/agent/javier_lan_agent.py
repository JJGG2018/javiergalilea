#!/usr/bin/env python3
"""
Agente Local L2/L3 (Zero-Config) para javiergalilea.es/pr_red/
Expone un puente HTTP estrictamente local (127.0.0.1:8781) con soporte CORS + PNA
para realizar Ping ICMP real, lectura de tabla ARP/MAC, resolución DNS/mDNS,
escaneo de puertos TCP y banners HTTP desde el navegador.

Sin dependencias externas (solo librería estándar de Python 3).
Uso: python3 javier_lan_agent.py
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
import argparse
import ipaddress
import json
import os
import platform
import re
import socket
import ssl
import subprocess
import sys
import time

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8781
DEFAULT_PORTS = [22, 23, 53, 80, 443, 445, 554, 631, 1883, 3389, 5000, 5001, 5900, 8006, 8008, 8080, 8443, 9100, 62078]

HOST_RE = re.compile(r"^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")
MAC_RE = re.compile(r"(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}")
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def load_system_oui_db():
    """Carga si existe un fichero OUI local de nmap/ieee-data en Linux/macOS."""
    db = {}
    candidates = [
        "/usr/share/nmap/nmap-mac-prefixes",
        "/usr/share/ieee-data/oui.txt",
        "/usr/share/hwdata/oui.txt",
        "/var/lib/ieee-data/oui.txt",
    ]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if "nmap-mac-prefixes" in path:
                        parts = line.split(None, 1)
                        if len(parts) == 2 and len(parts[0]) == 6:
                            db[parts[0].upper()] = parts[1].strip()[:64]
                    elif "(hex)" in line:
                        m = re.match(r"^([0-9A-Fa-f]{2}-[0-9A-Fa-f]{2}-[0-9A-Fa-f]{2})\s+\(hex\)\s+(.+)$", line)
                        if m:
                            db[m.group(1).replace("-", "").upper()] = m.group(2).strip()[:64]
            if db:
                return db, path
        except OSError:
            pass
    return db, None


OUI_DB, OUI_DB_PATH = load_system_oui_db()


def normalize_mac(raw):
    clean = re.sub(r"[^0-9a-fA-F]", "", raw or "")
    if len(clean) != 12:
        return None
    pairs = [clean[i:i + 2].upper() for i in range(0, 12, 2)]
    if "".join(pairs) in ("FFFFFFFFFFFF", "000000000000"):
        return None
    return ":".join(pairs)


def lookup_local_oui(mac):
    if not mac or not OUI_DB:
        return None
    prefix = mac.replace(":", "").upper()[:6]
    return OUI_DB.get(prefix)


def detect_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(0.3)
            s.connect(("192.0.2.1", 80))
            return s.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "192.168.1.10"


def detect_gateway():
    sys_name = platform.system().lower()
    try:
        if "linux" in sys_name:
            out = subprocess.check_output(["ip", "route", "show", "default"], text=True, timeout=1.5)
            m = re.search(r"default\s+via\s+(\d+\.\d+\.\d+\.\d+)", out)
            if m:
                return m.group(1)
        elif "darwin" in sys_name:
            out = subprocess.check_output(["route", "-n", "get", "default"], text=True, timeout=1.5)
            m = re.search(r"gateway:\s*(\d+\.\d+\.\d+\.\d+)", out)
            if m:
                return m.group(1)
        elif "windows" in sys_name:
            out = subprocess.check_output(["ipconfig"], text=True, errors="ignore", timeout=2.0)
            for line in out.splitlines():
                if "puerta de enlace" in line.lower() or "default gateway" in line.lower():
                    m = IPV4_RE.search(line)
                    if m:
                        return m.group(0)
    except Exception:
        pass
    return None


def is_valid_target(target):
    if not target or target.startswith("-"):
        return False
    try:
        ipaddress.ip_address(target)
        return True
    except ValueError:
        return bool(HOST_RE.match(target))


def icmp_ping_once(target, timeout_ms=850):
    if not is_valid_target(target):
        return {"ok": False, "error": "Objetivo inválido"}

    sys_name = platform.system().lower()
    if "windows" in sys_name:
        cmd = ["ping", "-n", "1", "-w", str(int(timeout_ms)), target]
    elif "darwin" in sys_name:
        cmd = ["ping", "-c", "1", "-W", str(int(timeout_ms)), target]
    else:
        sec = max(1, int(round(timeout_ms / 1000.0)))
        cmd = ["ping", "-c", "1", "-W", str(sec), target]

    t0 = time.perf_counter()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=(timeout_ms / 1000.0) + 1.5)
        elapsed = (time.perf_counter() - t0) * 1000.0
        out = (proc.stdout or "") + "\n" + (proc.stderr or "")
        ip_m = re.search(r"\((\d+\.\d+\.\d+\.\d+)\)", out) or IPV4_RE.search(target)
        resolved_ip = ip_m.group(1) if (ip_m and ip_m.lastindex) else (ip_m.group(0) if ip_m else target)

        if proc.returncode == 0:
            rtt_m = re.search(r"(?:time|tiempo)[=<]\s*([0-9]+(?:[.,][0-9]+)?)\s*ms", out, re.IGNORECASE)
            ttl_m = re.search(r"ttl[=:\s]+(\d+)", out, re.IGNORECASE)
            rtt_ms = float(rtt_m.group(1).replace(",", ".")) if rtt_m else round(elapsed, 2)
            ttl = int(ttl_m.group(1)) if ttl_m else None
            return {"ok": True, "ip": resolved_ip, "rtt_ms": round(rtt_ms, 2), "ttl": ttl, "method": "ICMP"}
    except Exception:
        pass

    return {"ok": False, "ip": target, "rtt_ms": None, "ttl": None, "method": "ICMP"}


def read_arp_table():
    entries = {}
    sys_name = platform.system().lower()

    if "linux" in sys_name:
        try:
            out = subprocess.check_output(["ip", "neigh", "show"], text=True, errors="ignore", timeout=2.0)
            for line in out.splitlines():
                ip_m = IPV4_RE.search(line)
                mac_m = MAC_RE.search(line)
                if ip_m and mac_m:
                    mac = normalize_mac(mac_m.group(0))
                    if mac:
                        entries[ip_m.group(0)] = {"mac": mac, "state": line.split()[-1]}
            if entries:
                return entries
        except Exception:
            pass

    try:
        out = subprocess.check_output(["arp", "-a"], text=True, errors="ignore", timeout=2.5)
        for line in out.splitlines():
            ip_m = IPV4_RE.search(line)
            mac_m = MAC_RE.search(line)
            if ip_m and mac_m:
                mac = normalize_mac(mac_m.group(0))
                if mac:
                    entries[ip_m.group(0)] = {"mac": mac, "state": "ARP"}
    except Exception:
        pass
    return entries


def probe_tcp_port(ip, port, timeout=0.25):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(timeout)
            return s.connect_ex((ip, port)) == 0
    except OSError:
        return False


def grab_http_banner(ip, open_ports):
    for port in (80, 8080, 443, 8443, 5000, 5001, 8006):
        if port not in open_ports:
            continue
        use_tls = port in (443, 8443, 5001, 8006)
        try:
            raw = socket.create_connection((ip, port), timeout=0.45)
            sock = raw
            if use_tls:
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                sock = ctx.wrap_socket(raw, server_hostname=ip)
            req = f"GET / HTTP/1.0\r\nHost: {ip}\r\nUser-Agent: javiergalilea-lan/1.0\r\n\r\n".encode("ascii")
            sock.sendall(req)
            data = sock.recv(2048).decode("utf-8", errors="ignore")
            sock.close()
            server_hdr = None
            for line in data.splitlines()[:20]:
                if line.lower().startswith("server:"):
                    server_hdr = line.split(":", 1)[1].strip()[:48]
                    break
            tm = TITLE_RE.search(data)
            title = re.sub(r"\s+", " ", tm.group(1)).strip()[:56] if tm else None
            if title or server_hdr:
                return f"{title or ''}{' · ' + server_hdr if server_hdr else ''}".strip(" ·")
        except Exception:
            pass
    return None


def resolve_hostname(ip):
    try:
        name, _, _ = socket.gethostbyaddr(ip)
        return name.rstrip(".")
    except OSError:
        return None


def scan_subnet(cidr_str, ports):
    t_start = time.perf_counter()
    net = ipaddress.ip_network(cidr_str, strict=False)
    if net.version != 4 or net.num_addresses > 1024:
        raise ValueError("Solo se permiten subredes IPv4 hasta /22 (máx. 1024 IPs)")

    hosts = [str(ip) for ip in net.hosts()] if net.prefixlen <= 30 else [str(net.network_address)]
    local_ip = detect_local_ip()
    gateway_ip = detect_gateway()

    alive = {}
    with ThreadPoolExecutor(max_workers=64) as pool:
        futures = {pool.submit(icmp_ping_once, ip, 650): ip for ip in hosts}
        for fut in as_completed(futures):
            ip = futures[fut]
            res = fut.result()
            if res.get("ok"):
                alive[ip] = res

    arp_map = read_arp_table()
    # Unir hosts que respondieron ICMP con vecinos presentes en caché ARP dentro de la subred
    candidate_ips = set(alive.keys())
    for arp_ip in arp_map:
        try:
            if ipaddress.ip_address(arp_ip) in net:
                candidate_ips.add(arp_ip)
        except ValueError:
            pass

    if local_ip in hosts:
        candidate_ips.add(local_ip)

    def inspect_host(ip):
        ping_info = alive.get(ip) or {"ok": False, "rtt_ms": None, "ttl": None}
        mac = (arp_map.get(ip) or {}).get("mac")
        open_ports = []
        with ThreadPoolExecutor(max_workers=10) as p_pool:
            pfut = {p_pool.submit(probe_tcp_port, ip, p, 0.24): p for p in ports}
            for f in as_completed(pfut):
                if f.result():
                    open_ports.append(pfut[f])
        open_ports.sort()
        hostname = resolve_hostname(ip)
        banner = grab_http_banner(ip, open_ports) if open_ports else None
        is_alive = bool(ping_info.get("ok") or open_ports or ip == local_ip)
        rtt = ping_info.get("rtt_ms")
        if rtt is None and ip == local_ip:
            rtt = 0.1

        return {
            "ip": ip,
            "mac": mac,
            "vendor_sys": lookup_local_oui(mac),
            "hostname": hostname or (socket.gethostname() if ip == local_ip else None),
            "alive": is_alive,
            "rtt_ms": rtt,
            "ttl": ping_info.get("ttl"),
            "ports": open_ports,
            "banner": banner,
            "is_gateway": ip == gateway_ip,
            "is_self": ip == local_ip,
            "source": "AGENT_L2_L3",
        }

    devices = []
    with ThreadPoolExecutor(max_workers=24) as pool:
        futs = [pool.submit(inspect_host, ip) for ip in sorted(candidate_ips, key=lambda x: tuple(int(p) for p in x.split(".")))]
        for fut in as_completed(futs):
            dev = fut.result()
            if dev["alive"] or dev["mac"]:
                devices.append(dev)

    devices.sort(key=lambda d: tuple(int(p) for p in d["ip"].split(".")))
    return {
        "cidr": str(net),
        "local_ip": local_ip,
        "gateway": gateway_ip,
        "duration_ms": round((time.perf_counter() - t_start) * 1000.0, 1),
        "count": len(devices),
        "devices": devices,
    }


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/health":
            local_ip = detect_local_ip()
            gw = detect_gateway()
            inferred_cidr = f"{'.'.join(local_ip.split('.')[:3])}.0/24" if "." in local_ip else "192.168.1.0/24"
            self._send_json(200, {
                "ok": True,
                "agent": "javier-lan-agent/1.0",
                "platform": platform.system(),
                "hostname": socket.gethostname(),
                "local_ip": local_ip,
                "gateway": gw,
                "suggested_cidr": inferred_cidr,
                "oui_db_loaded": bool(OUI_DB),
                "oui_entries": len(OUI_DB),
            })
            return

        if parsed.path == "/ping":
            host = (qs.get("host") or [""])[0].strip()
            res = icmp_ping_once(host, timeout_ms=950)
            if not res.get("ok") and is_valid_target(host):
                # Respaldo TCP rápido por si el firewall bloquea ICMP
                for p in (443, 80, 22, 53):
                    t0 = time.perf_counter()
                    if probe_tcp_port(host, p, 0.45):
                        res = {
                            "ok": True,
                            "ip": host,
                            "rtt_ms": round((time.perf_counter() - t0) * 1000.0, 2),
                            "ttl": None,
                            "method": f"TCP:{p}",
                        }
                        break
            self._send_json(200, res)
            return

        if parsed.path == "/scan":
            cidr = (qs.get("cidr") or ["192.168.1.0/24"])[0].strip()
            raw_ports = (qs.get("ports") or [""])[0].strip()
            ports = DEFAULT_PORTS
            if raw_ports:
                try:
                    ports = [max(1, min(65535, int(x))) for x in raw_ports.split(",") if x.strip()][:28]
                except ValueError:
                    ports = DEFAULT_PORTS
            try:
                res = scan_subnet(cidr, ports)
                self._send_json(200, res)
            except Exception as exc:
                self._send_json(400, {"ok": False, "error": str(exc)})
            return

        self._send_json(404, {"ok": False, "error": "Ruta no encontrada"})


def main():
    parser = argparse.ArgumentParser(description="Agente Local L2/L3 para javiergalilea.es/pr_red/")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    server = ThreadingHTTPServer((DEFAULT_HOST, args.port), AgentHandler)
    print(f"📡 Agente Local activo en http://{DEFAULT_HOST}:{args.port}")
    print(f"   IP local detectada: {detect_local_ip()} · Gateway: {detect_gateway() or 'N/D'}")
    if OUI_DB_PATH:
        print(f"   Base OUI del sistema cargada: {len(OUI_DB)} prefijos ({OUI_DB_PATH})")
    print("   Mantén esta terminal abierta y pulsa 'Conectar' en javiergalilea.es/pr_red/")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAgente detenido.")
        server.server_close()


if __name__ == "__main__":
    main()

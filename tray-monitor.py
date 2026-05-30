"""
tray-monitor.py — La Casita Deli
Monitor de bandeja del sistema para los 3 servicios del panel.
Requiere:  pip install pystray pillow
Ejecutar:  pythonw tray-monitor.py   (sin ventana de consola)
"""

import os
import sys
import socket
import threading
import time
import webbrowser
import subprocess

import pystray
from PIL import Image, ImageDraw

# ── Rutas ─────────────────────────────────────────────────────────────────────
APP_DIR  = os.path.dirname(os.path.abspath(sys.argv[0]))
LOGS_DIR = os.path.join(APP_DIR, "logs")

# ── Servicios a monitorear ────────────────────────────────────────────────────
SERVICES = [
    {"name": "Panel Admin",  "port": 3001, "url": "http://localhost:3001"},
    {"name": "API",          "port": 3002, "url": "http://localhost:3002/api/health"},
    {"name": "TC52 Bodega",  "port": 3003, "url": "http://localhost:3003"},
]

COLOR_GREEN  = (22,  163,  74)
COLOR_YELLOW = (234, 179,   8)
COLOR_RED    = (220,  38,  38)


# ── Helpers ───────────────────────────────────────────────────────────────────
def is_alive(port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            return s.connect_ex(("localhost", port)) == 0
    except Exception:
        return False


def make_icon(color: tuple) -> Image.Image:
    img  = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse([4, 4, 60, 60], fill=(*color, 255))
    return img


def get_status():
    results = [(s, is_alive(s["port"])) for s in SERVICES]
    n = sum(alive for _, alive in results)
    if n == len(SERVICES):
        return results, COLOR_GREEN,  "La Casita Deli — Todo activo"
    elif n > 0:
        return results, COLOR_YELLOW, f"La Casita Deli — Parcial ({n}/{len(SERVICES)})"
    else:
        return results, COLOR_RED,    "La Casita Deli — Detenido"


# ── Acciones del menu ─────────────────────────────────────────────────────────
def open_url(url: str):
    def action(icon, item):
        webbrowser.open(url)
    return action


def open_log(filename: str):
    def action(icon, item):
        path = os.path.join(LOGS_DIR, filename)
        if os.path.exists(path):
            os.startfile(path)
    return action


def stop_all(icon, item):
    subprocess.run(
        ["taskkill", "/F", "/IM", "node.exe"],
        creationflags=0x08000000,   # sin ventana de consola
        capture_output=True,
    )
    icon.stop()


# ── Texto dinamico por servicio (se llama cada vez que se abre el menu) ───────
def service_text(name: str, port: int):
    def text(item):
        return f"{'●' if is_alive(port) else '○'}  {name}   —   localhost:{port}"
    return text


# ── Construir menu ────────────────────────────────────────────────────────────
def build_menu() -> pystray.Menu:
    service_items = [
        pystray.MenuItem(
            service_text(svc["name"], svc["port"]),
            open_url(svc["url"]),
            default=(svc["port"] == 3001),  # doble clic abre el panel
        )
        for svc in SERVICES
    ]
    return pystray.Menu(
        pystray.MenuItem("La Casita Deli Admin", None, enabled=False),
        pystray.Menu.SEPARATOR,
        *service_items,
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Ver log API",  open_log("api.log")),
        pystray.MenuItem("Ver log Web",  open_log("web.log")),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Salir (detener servidor)", stop_all),
    )


# ── Loop: actualiza el icono cada 5 segundos ─────────────────────────────────
def update_loop(icon: pystray.Icon):
    while True:
        time.sleep(5)
        try:
            _, color, title = get_status()
            icon.icon  = make_icon(color)
            icon.title = title
        except Exception:
            pass


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    _, color, title = get_status()

    icon = pystray.Icon(
        name  = "lacasitadeli",
        icon  = make_icon(color),
        title = title,
        menu  = build_menu(),
    )

    t = threading.Thread(target=update_loop, args=(icon,), daemon=True)
    t.start()

    icon.run()


if __name__ == "__main__":
    main()

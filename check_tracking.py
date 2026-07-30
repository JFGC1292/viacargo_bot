"""
Recorre todas las guías pendientes en guias.json, revisa cada una en
viacargo.com.ar, avisa por Telegram las que llegaron y las saca de la lista.

Pensado para correr en GitHub Actions, disparado por el workflow
.github/workflows/tracking.yml
"""

import json
import os
import re
import sys
import time

import requests
from playwright.sync_api import sync_playwright

BASE_URL = "https://viacargo.com.ar/seguimiento-de-envio/"
DATA_FILE = "guias.json"

DATE_PATTERN = re.compile(r"\d{2}/\d{2}/\d{4}")

# Palabras clave que indican que el paquete llegó a destino.
DELIVERED_KEYWORDS = [
    "entregado",
    "entregada",
    "entrega realizada",
    "entrega exitosa",
    "envío entregado",
]

# User-agent de un Chrome de escritorio normal, para no parecer un bot
# desde el vamos.
REAL_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def load_guias() -> list[dict]:
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        content = f.read().strip()
        return json.loads(content) if content else []


def save_guias(items: list[dict]) -> None:
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
        f.write("\n")


def collect_all_frames_text(page) -> str:
    """Junta el texto de TODOS los frames de la página (por si el timeline
    del envío está dentro de un iframe embebido, no en el documento
    principal)."""
    chunks = []
    for frame in page.frames:
        try:
            chunks.append(frame.locator("body").inner_text(timeout=2000))
        except Exception:
            pass
    return "\n".join(chunks)


def check_one(page, numero: str) -> str:
    """Devuelve el texto renderizado (de todos los frames) de la página de
    seguimiento de una guía. Espera activamente a que aparezca una fecha
    con formato DD/MM/AAAA, señal de que el timeline real ya cargó."""
    url = f"{BASE_URL}{numero}"

    interesting_responses = []

    def log_response(response):
        try:
            ctype = response.headers.get("content-type", "")
            rtype = response.request.resource_type
            if rtype in ("xhr", "fetch") or "json" in ctype:
                short_url = response.url[:120] + ("…" if len(response.url) > 120 else "")
                interesting_responses.append(f"{response.status} {rtype} {short_url}")
        except Exception:
            pass

    page.on("response", log_response)
    page.goto(url, wait_until="domcontentloaded", timeout=60000)

    text = ""
    found = False
    for _ in range(20):
        text = collect_all_frames_text(page)
        if DATE_PATTERN.search(text):
            found = True
            break
        page.wait_for_timeout(1000)

    page.remove_listener("response", log_response)

    # Diagnóstico: qué llamadas de red a APIs/XHR se vieron durante la carga.
    if interesting_responses:
        print("  Llamadas de red detectadas:")
        for r in interesting_responses[:15]:
            print(f"    {r}")
    else:
        print("  (no se detectaron llamadas XHR/fetch/JSON durante la carga)")

    print(f"  Frames en la página: {len(page.frames)}")
    print(f"  ¿Se encontró una fecha en el texto?: {'sí' if found else 'no'}")

    return text


def _normalize(s: str) -> str:
    """minúsculas + sin acentos, para que no importe cómo esté escrito."""
    import unicodedata

    s = s.lower()
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c))


def is_delivered(text: str) -> bool:
    normalized_text = _normalize(text)
    return any(_normalize(keyword) in normalized_text for keyword in DELIVERED_KEYWORDS)


def send_telegram(message: str) -> None:
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    resp = requests.post(url, data={"chat_id": chat_id, "text": message}, timeout=15)
    if not resp.ok:
        # Mostramos el detalle que manda Telegram (ej: "chat not found",
        # "bot was blocked by the user") en vez de solo el código HTTP.
        raise RuntimeError(f"Telegram respondió {resp.status_code}: {resp.text}")


def main() -> None:
    guias = load_guias()

    if not guias:
        print("No hay guías pendientes en guias.json. Nada para chequear.")
        return

    print(f"Chequeando {len(guias)} guía(s) pendiente(s)...")

    still_pending = []
    delivered_now = []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            user_agent=REAL_USER_AGENT,
            locale="es-AR",
            viewport={"width": 1366, "height": 900},
        )
        # Le sacamos la marca de "navegador automatizado" más obvia.
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
        )
        page = context.new_page()

        webdriver_flag = page.evaluate("navigator.webdriver")
        print(f"navigator.webdriver reportado: {webdriver_flag!r}")

        for item in guias:
            numero = item.get("numero", "").strip()
            if not numero:
                continue
            print(f"--- Guía {numero} ---")
            try:
                text = check_one(page, numero)
            except Exception as e:
                print(f"  Error al revisar {numero}: {e}. Se mantiene pendiente.")
                still_pending.append(item)
                continue

            print("  Extracto:", " ".join(text.split())[:400])

            if is_delivered(text):
                print("  -> ENTREGADO")
                delivered_now.append(numero)
            else:
                print("  -> todavía en tránsito")
                still_pending.append(item)

            time.sleep(1)

        browser.close()

    if delivered_now:
        lines = "\n".join(f"• {n}" for n in delivered_now)
        plural = "s" if len(delivered_now) > 1 else ""
        try:
            send_telegram(f"📦 Guía{plural} entregada{plural} en Via Cargo:\n{lines}")
            print(f"Notificación enviada por {len(delivered_now)} guía(s) entregada(s).")
        except Exception as e:
            # Si Telegram falla, NO perdemos la detección: dejamos esas
            # guías en la lista de pendientes para reintentar el aviso en
            # la próxima corrida, en vez de cortar todo el script acá.
            print(f"No se pudo avisar por Telegram: {e}")
            print("Esas guías quedan pendientes para reintentar el aviso.")
            for item in guias:
                if item.get("numero", "").strip() in delivered_now:
                    still_pending.append(item)

    save_guias(still_pending)
    print(f"Guías que siguen pendientes: {len(still_pending)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error durante la ejecución: {e}", file=sys.stderr)
        sys.exit(1)

"""
Recorre todas las guías pendientes en guias.json, revisa cada una en
viacargo.com.ar, avisa por Telegram las que llegaron y las saca de la lista.

Pensado para correr en GitHub Actions, disparado por el workflow
.github/workflows/tracking.yml
"""

import json
import os
import sys
import time

import requests
from playwright.sync_api import sync_playwright

BASE_URL = "https://viacargo.com.ar/seguimiento-de-envio/"
DATA_FILE = "guias.json"

# Palabras clave que indican que el paquete llegó a destino.
# Ajustá esta lista según lo que veas en el log "Texto detectado" del
# primer run manual (workflow_dispatch) del workflow.
DELIVERED_KEYWORDS = [
    "entregado",
    "entregada",
    "entrega realizada",
    "entrega exitosa",
    "envío entregado",
    "ENTREGADO",
    "ENTREGADA",
]


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


def check_one(page, numero: str) -> str:
    """Devuelve el texto renderizado de la página de seguimiento de una guía.

    El menú/encabezado del sitio se estabiliza casi al instante, pero el
    timeline real del envío tarda más en aparecer. Por eso no alcanza con
    esperar a que el texto "deje de cambiar": hay que esperar a que
    aparezca algo que solo existe una vez cargado el historial real, como
    una fecha con formato DD/MM/AAAA (aparece en cada evento del timeline).
    """
    url = f"{BASE_URL}{numero}"
    page.goto(url, wait_until="domcontentloaded", timeout=60000)

    try:
        page.wait_for_function(
            "() => /\\d{2}\\/\\d{2}\\/\\d{4}/.test(document.body.innerText)",
            timeout=20000,
        )
    except Exception:
        # Si en 20s no apareció ninguna fecha, seguimos igual con lo que
        # haya en pantalla (probablemente un error real de la guía, o el
        # sitio tardó más de lo esperado).
        pass

    page.wait_for_timeout(800)  # margen chico extra por si sigue pintando
    return page.inner_text("body")


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
    resp.raise_for_status()


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
        page = browser.new_page()

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

            # Log corto de diagnóstico
            print("  Extracto:", " ".join(text.split())[:400])

            if is_delivered(text):
                print(f"  -> ENTREGADO")
                delivered_now.append(numero)
            else:
                print("  -> todavía en tránsito")
                still_pending.append(item)

            time.sleep(1)  # margen entre requests, prudente con el sitio

        browser.close()

    if delivered_now:
        lines = "\n".join(f"• {n}" for n in delivered_now)
        plural = "s" if len(delivered_now) > 1 else ""
        send_telegram(f"📦 Guía{plural} entregada{plural} en Via Cargo:\n{lines}")
        print(f"Notificación enviada por {len(delivered_now)} guía(s) entregada(s).")

    save_guias(still_pending)
    print(f"Guías que siguen pendientes: {len(still_pending)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Error durante la ejecución: {e}", file=sys.stderr)
        sys.exit(1)

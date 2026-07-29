# Panel de Guías — Via Cargo

Web + automatización para cargar números de guía, revisarlos automáticamente
en viacargo.com.ar, avisarte por Telegram cuando lleguen, y sacarlos solos
de la lista.

## Qué incluye

```
index.html, style.css, app.js   → el sitio (panel para cargar guías)
guias.json                      → la "base de datos" (un array simple)
check_tracking.py               → revisa cada guía pendiente en Via Cargo
.github/workflows/tracking.yml  → lo corre automáticamente cada 30 min
```

---

## 1. Crear el repositorio

1. Creá un repositorio nuevo en GitHub (puede ser público o privado).
2. Subí **todo** el contenido de esta carpeta manteniendo la estructura
   (incluida la carpeta oculta `.github/`).

## 2. Activar GitHub Pages (el sitio)

1. En el repo: **Settings → Pages**.
2. En "Build and deployment" elegí **Deploy from a branch**.
3. Rama: `main`, carpeta: `/ (root)`. Guardar.
4. En un par de minutos vas a tener tu sitio en
   `https://<tu-usuario>.github.io/<tu-repo>/`.

## 3. Crear el bot de Telegram

1. En Telegram, hablá con **@BotFather** → `/newbot` → seguí los pasos.
2. Guardá el **token** que te da (`TELEGRAM_BOT_TOKEN`).
3. Mandale cualquier mensaje a tu bot recién creado (para que quede
   "activa" la conversación).
4. Entrá en el navegador a:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
5. Buscá `"chat":{"id": ...}` → ese número es tu `TELEGRAM_CHAT_ID`.

## 4. Cargar los secrets del workflow

En el repo: **Settings → Secrets and variables → Actions → New repository
secret**. Creá:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

(El workflow ya tiene permiso para escribir en el repo — `contents: write`
— así que no hace falta ningún token extra para esta parte.)

## 5. Crear el token para el sitio web

El sitio necesita poder escribir `guias.json` en tu repo cuando cargás una
guía. Para eso usa un token tuyo, guardado **solo en tu navegador**:

1. Andá a **github.com → Settings (de tu cuenta) → Developer settings →
   Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access**: "Only select repositories" → elegí este repo.
3. **Permissions → Contents**: Read and write.
4. Generá el token y copialo (empieza con `github_pat_...`).

⚠️ Este token queda guardado en el `localStorage` de tu navegador, en tu
propia computadora — no se envía a ningún servidor más que a la API de
GitHub. Aun así, generalo con acceso **solo a este repositorio**, no a toda
tu cuenta, y no lo compartas.

## 6. Usar el sitio

1. Abrí `https://<tu-usuario>.github.io/<tu-repo>/`.
2. Tocá el ⚙ arriba a la derecha y cargá: tu usuario, el nombre del repo,
   la rama (`main`) y el token del paso 5. Guardar.
3. Escribí un número de guía y tocá "Sellar ▸". Se agrega a `guias.json`
   en tu repo al instante.
4. Cada 30 minutos, el workflow de GitHub Actions revisa todas las guías
   pendientes. Las que llegaron: te las avisa por Telegram (puede
   agrupar varias en un solo mensaje) y las borra de la lista. El sitio
   se actualiza solo la próxima vez que lo abras.

## Ajustar la detección de "entregado"

No pude ver el HTML final de Via Cargo (el estado se carga con
JavaScript), así que la lista `DELIVERED_KEYWORDS` en `check_tracking.py`
es una aproximación. Para afinarla:

1. En el repo, pestaña **Actions** → "Seguimiento Via Cargo" → **Run
   workflow** (con al menos una guía cargada).
2. Mirá el log del paso "Revisar guías pendientes": imprime un extracto
   del texto que detecta para cada guía.
3. Si la frase real de "entregado" no está en la lista, agregala en
   `check_tracking.py` y subí el cambio.

## Notas

- GitHub apaga los workflows `schedule` en repos sin actividad después de
  60 días. Un push o correrlo manual desde "Actions" lo reactiva.
- Podés borrar una guía manualmente desde el sitio con la ✕, sin esperar
  a que llegue.
- Si algún día querés dejar de rastrear todo, simplemente vaciá
  `guias.json` (dejalo como `[]`).

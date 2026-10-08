# Inventario por WS

App web (HTML + CSS + JS) para gestionar el stock de cada WS y registrar préstamos de materiales entre WS.
Los datos iniciales salen de `Inventario_por_WS_.xlsx` (ya cargados en `public/seed.js`).

## Cómo funciona
- `public/` → la interfaz (index.html, styles.css, app.js), las reglas compartidas (logic.js) y el inventario inicial (seed.js).
- `api/` → dos funciones serverless de Vercel (`/api/state` y `/api/action`).
- Los datos se guardan en **Upstash Redis** (gratis) para que todos los WS vean lo mismo.
- **Pedidos:** quien necesita material toca "Pedir" (en la fila del elemento) o "Pedir material a otro workshop". El pedido queda *pendiente* y le aparece al responsable del workshop dueño (número rojo en el menú y cartel azul arriba). Él lo **acepta o rechaza**; recién al aceptar se descuenta del stock disponible. Queda registrado quién pidió, quién aceptó y cuándo, y después la devolución.
- "Prestar" (botón secundario) sirve para registrar directo un préstamo que ya se entregó.
- Si rechazan un pedido, al workshop que lo pidió le aparece el aviso con el motivo.

## Publicar en Vercel
1. Subí esta carpeta a un repositorio de GitHub (o usá `vercel` desde la terminal dentro de la carpeta).
2. En vercel.com → *Add New Project* → importá el repo. Framework: **Other**. No hace falta configurar build.
3. En el proyecto → *Storage* (o *Marketplace*) → agregá **Upstash Redis** y conectalo al proyecto.
   Eso crea solas las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`.
4. (Opcional) En *Settings → Environment Variables* agregá `APP_PIN` con una clave. Si existe, la app la pide al entrar.
5. Hacé *Redeploy*. Listo.

La primera vez que se abre, la base se llena sola con el inventario del Excel.

## Probar en tu computadora (lo más simple)
Abrí la carpeta `public` con cualquier servidor de archivos (por ejemplo `python3 -m http.server` dentro de `public`, o Live Server)
y entrá a `http://127.0.0.1:8000`. Sin backend la app entra en **modo local**: carga sola el inventario del Excel y guarda
los cambios y préstamos en ese navegador (el botón "Restaurar datos del Excel" vuelve todo al inicio).
Para que varias personas compartan los datos hace falta publicarla en Vercel con Upstash (pasos de arriba).

## Probar con el backend en tu computadora
`npm i -g vercel` y luego `vercel dev` dentro de la carpeta. Sin Redis configurado funciona en "modo prueba":
los datos viven en memoria y se pierden al reiniciar.

## Si ya habías publicado la versión anterior
La base se llena con el Excel solo la primera vez. Para cargar esta versión (con faltantes, fichas y etiquetas), borrá la clave `inventario_ws_state` desde el panel de Upstash y recargá la app.

## Notas
- No hay usuarios con contraseña: cada persona escribe su nombre arriba a la izquierda y queda en el historial. Si necesitás más control, usá `APP_PIN`.
- Para volver a cargar los datos del Excel, borrá la clave `inventario_ws_state` desde el panel de Upstash.

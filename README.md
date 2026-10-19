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

## Confirmaciones de stock y responsable
A las **8:00, 10:00, 12:00, 16:00, 18:00 y 19:40 hs (hora de Argentina)** cada workshop tiene que confirmar el stock y quién está a cargo. Solo puede hacerlo el líder registrado de ese workshop.
- En la página de cada workshop aparece un cartel azul "Confirmación de las HH:00 pendiente" con el botón para confirmar.
- La pantalla **Confirmaciones** (menú lateral) muestra todos los workshops por horario del día: OK, Diferencias o Falta.
- Si hay diferencias de stock hay que escribir cuáles. Todo queda guardado en el Historial.
- Si elegís "Mi workshop" en el menú, el número rojo de Confirmaciones cuenta solo las de tu workshop.
- La app avisa solo mientras está abierta: no manda notificaciones al celular ni mails.

## Líderes de workshop y filas fijas
- Las filas que vienen de la planilla son **fijas**: no se puede editar la cantidad, el nombre ni borrarlas desde la app (solo cambian con la planilla).
- Cada líder de workshop tiene su **usuario y contraseña**. Solo un líder puede confirmar el stock, marcar faltantes (− / +), agregar elementos propios y editar la ficha **de su workshop** (un usuario puede ser líder de más de un workshop). Cualquiera puede seguir pidiendo y prestando material.
- Los usuarios los crea quien administra la app: menú lateral → **Administrar usuarios** (pide el código de administración). Ahí se crean usuarios, se les pone una contraseña inicial, se eligen sus workshops, se resetea una contraseña olvidada o se elimina un usuario. Cada persona puede cambiar su propia contraseña desde "Cambiar contraseña".
- **Obligatorio para crear usuarios:** en Vercel → Settings → Environment Variables agregá `ADMIN_PIN` con un código que solo tengas vos y hacé un Redeploy.
- Las contraseñas se guardan cifradas y nunca se envían a los navegadores. La sesión dura 30 días en ese navegador. Tras 5 intentos fallidos el usuario se bloquea 10 minutos.

## Actualización automática
Cada versión nueva de `public/seed.js` tiene un número de versión. Cuando alguien abre la app y ese número es distinto al de la base de datos,
la app aplica sola los datos de la planilla (una vez), sin tocar ningún botón. Para actualizar solo hay que subir los archivos a GitHub y abrir la app.

## Actualizar el inventario desde la planilla (manual)
`public/seed.js` tiene los datos de la planilla de Google Sheets "Inventario por WS" (leída el 09/10/2026). Después de subir una versión nueva
a GitHub, tocá **"Actualizar inventario desde la planilla"** en el menú lateral: trae cantidades, estados, comentarios y responsables
sin borrar préstamos, pedidos, faltantes ni elementos que hayas agregado a mano. También quita los workshops que ya no están en la planilla (LL y Stock Cables), salvo que tengan préstamos o pedidos sin cerrar.

**Faltantes:** al marcar un faltante con − / + , el *Total* de la tabla baja (se ve "15 de 17") y lo mismo pasa con "En el WS".

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

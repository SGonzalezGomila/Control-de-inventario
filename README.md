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
A las **8, 10, 12, 16, 18 y 20 hs (hora de Argentina)** cada workshop tiene que confirmar el stock y quién está a cargo.
- En la página de cada workshop aparece un cartel azul "Confirmación de las HH:00 pendiente" con el botón para confirmar.
- La pantalla **Confirmaciones** (menú lateral) muestra todos los workshops por horario del día: OK, Diferencias o Falta.
- Si hay diferencias de stock hay que escribir cuáles. Todo queda guardado en el Historial.
- Si elegís "Mi workshop" en el menú, el número rojo de Confirmaciones cuenta solo las de tu workshop.
- La app avisa solo mientras está abierta: no manda notificaciones al celular ni mails.

## Cambiar el nombre de un workshop
Tocá el lápiz al lado del nombre, arriba de la página del workshop. El inventario, los préstamos y el historial no cambian, y "Actualizar inventario desde la planilla" no pisa el nombre nuevo.

## Sumar o quitar unidades
En la columna **Total** de cada elemento hay botones − y +.
- **−** quita unidades que ya no están (se perdió, se rompió, se dio de baja). Ej: Teclados 19 → se pierde 1 → 18.
- **+** suma unidades nuevas (nos dieron nuevos, apareció uno, volvió de reparación). Ej: 18 → llega 1 → 19.
- Siempre se pide el motivo y queda en el Historial del workshop con quién lo hizo y el total antes y después.
- No deja quitar unidades que están prestadas o marcadas como faltantes.
- "Faltan" sigue sirviendo para lo que no está pero se espera que aparezca; "−" es una baja del total.

## Actualizar el inventario desde la planilla
`public/seed.js` tiene los datos del Excel "Inventario por WS" (cargado el 13/10/2026). Después de subir una versión nueva
a GitHub, tocá **"Actualizar inventario desde la planilla"** en el menú lateral: trae cantidades, estados, comentarios y responsables
sin borrar préstamos, pedidos, faltantes ni elementos que hayas agregado a mano.

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

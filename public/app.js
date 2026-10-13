'use strict';

// ---------- Estado y utilidades ----------
let S = null; // estado completo que manda el servidor
let pin = sessionStorage.getItem('pin') || '';
const $ = (id) => document.getElementById(id);
const main = $('main'), nav = $('nav'), dlg = $('dlg');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pending = (l) => l.qty - l.returned;
const fmt = (ts) => new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const space = (id) => S.spaces.find((s) => s.id === id);
const isActive = (l) => (l.status || 'active') === 'active';
const pendingReq = (l) => l.status === 'pending';
const lentOut = (itemId) => S.loans.filter((l) => l.itemId === itemId && isActive(l) && pending(l) > 0).reduce((a, l) => a + pending(l), 0);
const available = (it) => it.qty - (it.missing || 0) - lentOut(it.id);
const activeLoans = () => S.loans.filter((l) => isActive(l) && pending(l) > 0);
const confs = () => S.confirmations || [];
const confFor = (spaceId, date, slot) => confs().find((c) => c.spaceId === spaceId && c.date === date && c.slot === slot);
const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
const today = () => InvLogic.arParts(Date.now()).date;
const checkable = () => S.spaces.filter((x) => x.items.length);
function pendingChecks(spaceId) { // confirmaciones que faltan en el horario vigente
  const cur = InvLogic.currentSlot();
  if (!cur) return [];
  return checkable().filter((x) => (!spaceId || x.id === spaceId) && !confFor(x.id, cur.date, cur.slot));
}
const requestsFor = (spaceId) => S.loans.filter((l) => pendingReq(l) && l.fromSpaceId === spaceId);
const who = () => localStorage.getItem('who') || '';
const ICONS = {
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  out: '<path d="M7 17 17 7M9 7h8v8"/>',
  in: '<path d="M17 7 7 17M15 17H7V9"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8 2.3 2.3a4 4 0 0 0 2.4 2Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M7 7h13l-4-4M17 17H4l4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  empty: '<path d="M3 7h18v13H3zM3 7l3-4h12l3 4M9 12h6"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const catKey = (c) => String(c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const CAT_CLS = { tecnologia: 'c-tec', mobiliario: 'c-mob', libreria: 'c-lib', herramientas: 'c-her', cables: 'c-cab' };
const catCls = (c) => CAT_CLS[catKey(c)] || 'c-otr';
const emptyBox = (msg) => `<div class="table-wrap"><div class="empty">${icon('empty', 'big')}<p>${msg}</p></div></div>`;
const initials = (n) => { const m = String(n || '').match(/^WS\s*(\d+)/i); return m ? m[1] : String(n || '?').split(/[\s-]+/).filter((w) => /\w/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?'; };

function toast(msg, bad) {
  const t = $('toast');
  t.innerHTML = icon(bad ? 'alert' : 'check') + '<span></span>';
  t.lastChild.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.className = 'toast'), 3200);
}

// Si no hay backend (por ejemplo abriendo la carpeta con un servidor de archivos), la app
// trabaja en "modo local": carga el inventario del Excel y guarda los cambios en este navegador.
let localMode = false;
const LOCAL_KEY = 'inv_state_v2';
function localState() {
  try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return JSON.parse(raw); } catch (e) { /* se ignora */ }
  return JSON.parse(JSON.stringify(window.SEED));
}
function localApi(body) {
  const st = localState();
  let result;
  if (body) {
    try { result = InvLogic.applyAction(st, body); }
    catch (e) { throw new Error(e.message); }
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(st));
  return { ...st, persistent: false, local: true, result };
}

async function api(path, body) {
  if (!localMode) {
    let r, j;
    try {
      r = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json', 'x-app-pin': pin },
        body: body ? JSON.stringify(body) : undefined,
      });
      j = await r.json();
    } catch (e) { j = null; }
    if (j) {
      if (r.status === 401) {
        const p = prompt('Ingresá el PIN de acceso:');
        if (p === null) throw new Error('Hace falta el PIN.');
        pin = p; sessionStorage.setItem('pin', p);
        return api(path, body);
      }
      if (!r.ok) throw new Error(j.error || 'Error del servidor.');
      return j;
    }
    localMode = true; // no hay backend: seguimos sin él
  }
  return localApi(body);
}

// ---------- Avisos de movimientos (por WS) ----------
const seenKey = (id) => 'seen:' + id;
function initSeen() {
  S.spaces.forEach((s) => { if (!localStorage.getItem(seenKey(s.id))) localStorage.setItem(seenKey(s.id), String(Date.now())); });
}
function unseen(spaceId) {
  const since = Number(localStorage.getItem(seenKey(spaceId)) || 0);
  return S.log.filter((e) => {
    if (e.ts <= since || e.by === who()) return false;
    if (['lend', 'return', 'loan-removed', 'cancel-request'].includes(e.type)) return e.spaceIds[0] === spaceId;
    if (['accept', 'reject'].includes(e.type)) return e.spaceIds[1] === spaceId; // avisa al workshop que pidió
    return false;
  });
}
function markSeen(spaceId) { localStorage.setItem(seenKey(spaceId), String(Date.now())); render(); }

// ---------- Ruteo ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (h[0] === 'loans') return { view: 'loans' };
  if (h[0] === 'checks') return { view: 'checks' };
  const id = h[0] === 'ws' && space(h[1]) ? h[1] : S.spaces[0].id;
  const tab = ['stock', 'loans', 'log'].includes(h[2]) ? h[2] : 'stock';
  return { view: 'ws', id, tab };
}
window.addEventListener('hashchange', () => { if (S) render(); });

// ---------- Render ----------
function render() {
  const r = route();
  const hadFocus = document.activeElement && document.activeElement.id === 'filter';
  const selPos = hadFocus ? document.activeElement.selectionStart : 0;
  renderNav(r);
  if (r.view === 'loans') main.innerHTML = viewAllLoans();
  else if (r.view === 'checks') main.innerHTML = viewChecks();
  else main.innerHTML = viewSpace(space(r.id), r.tab);
  if (hadFocus) { const f = $('filter'); if (f) { f.focus(); f.setSelectionRange(selPos, selPos); } }
  fillMyWs();
  $('syncInfo').textContent = S.local
    ? 'Modo local: los cambios se guardan solo en este navegador. Para compartirlos entre WS, publicá la app en Vercel.'
    : S.persistent
      ? 'Se sincroniza solo cada pocos segundos.'
      : 'Modo prueba: los datos no se guardan al reiniciar el servidor.';
  $('syncInfo').className = 'sync ' + (S.local ? 'is-local' : S.persistent ? 'is-live' : 'is-test');
  $('resetBtn').hidden = !S.local;
  const mine = myWs();
  const n = (mine ? requestsFor(mine).length + pendingChecks(mine).length : 0);
  document.title = (n ? `(${n}) ` : '') + 'Inventario Workshops';
  const alerts = S.loans.filter(pendingReq).length + (myWs() ? pendingChecks(myWs()).length : 0);
  $('menuBadge').textContent = alerts; $('menuBadge').hidden = !alerts;
  $('topTitle').textContent = r.view === 'loans' ? 'Préstamos y pedidos' : r.view === 'checks' ? 'Confirmaciones' : space(r.id).name;
}

function renderNav(r) {
  const total = activeLoans().length;
  const chk = myWs() ? pendingChecks(myWs()).length : pendingChecks().length;
  let h = `<a href="#/loans" class="${r.view === 'loans' ? 'on' : ''}"><span>Préstamos y pedidos</span>${S.loans.some(pendingReq) ? `<span class="badge req" title="Pedidos pendientes">${S.loans.filter(pendingReq).length}</span>` : total ? `<span class="badge quiet">${total}</span>` : ''}</a><a href="#/checks" class="${r.view === 'checks' ? 'on' : ''}"><span>Confirmaciones</span>${chk ? `<span class="badge req" title="Confirmaciones pendientes">${chk}</span>` : ''}</a><div class="sep"></div>`;
  for (const s of S.spaces) {
    const n = unseen(s.id).length, req = requestsFor(s.id).length;
    const out = activeLoans().filter((l) => l.fromSpaceId === s.id).length;
    const b = req ? `<span class="badge req" title="Pedidos esperando respuesta">${req}</span>` : n ? `<span class="badge" title="Movimientos nuevos">${n}</span>` : out ? `<span class="badge quiet" title="Préstamos afuera">${out}</span>` : '';
    h += `<a href="#/ws/${s.id}" class="${r.view === 'ws' && r.id === s.id ? 'on' : ''}"><span>${esc(s.name)}</span>${b}</a>`;
  }
  nav.innerHTML = h;
}

function tabsHtml(s, tab) {
  const t = (k, label) => `<a href="#/ws/${s.id}/${k}" class="${tab === k ? 'on' : ''}">${label}</a>`;
  return `<div class="tabs">${t('stock', 'Inventario')}${t('loans', 'Préstamos')}${t('log', 'Historial')}</div>`;
}

const stat = (ic, n, label, tone) => `<div class="stat t-${tone} ${n ? '' : 'is-zero'}">${icon(ic)}<div><b>${n}</b><span>${label}</span></div></div>`;
function viewSpace(s, tab) {
  const out = activeLoans().filter((l) => l.fromSpaceId === s.id).reduce((a, l) => a + pending(l), 0);
  const inn = activeLoans().filter((l) => l.toSpaceId === s.id).reduce((a, l) => a + pending(l), 0);
  const fix = s.items.filter((i) => i.needsFix).length;
  const news = unseen(s.id);
  const miss = s.items.reduce((a, i) => a + (i.missing || 0), 0);
  let h = `<div class="head"><div class="title"><span class="mark">${esc(initials(s.name))}</span><div>
      <h1>${esc(s.name)}</h1>
      <div class="owner">Responsable: <b>${s.owner ? esc(s.owner) : 'sin asignar'}</b><button data-act="owner" data-id="${s.id}" type="button">cambiar</button>
        · Último relevamiento: <b>${s.checkedAt ? esc(s.checkedAt) : 'sin fecha'}</b><button data-act="info" data-id="${s.id}" type="button">editar ficha</button></div>
      ${(() => { const c = confs().find((x) => x.spaceId === s.id && x.date === today()); return c ? `<div class="owner">A cargo ahora: <b>${esc(c.owner)}</b> · confirmado a las ${hhmm(c.ts)} (turno de las ${c.slot}:00)${c.stockOk ? '' : ' · <span class="zero">con diferencias de stock</span>'}</div>` : ''; })()}
    </div></div>
    <div class="stats">
      ${stat('box', s.items.length, 'elementos', 'blue')}
      ${stat('alert', miss, 'unidades faltan', 'red')}
      ${stat('out', out, 'prestadas afuera', 'amber')}
      ${stat('in', inn, 'recibidas de otros', 'teal')}
      ${stat('wrench', fix, 'a arreglar', 'red')}
    </div></div>
    ${(s.labels || []).length ? `<details class="labels"><summary>Etiquetas faltantes (${s.labels.length})</summary><ul>${s.labels.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : ''}`;
  const cur = InvLogic.currentSlot();
  if (cur && s.items.length && !confFor(s.id, cur.date, cur.slot)) {
    h += `<div class="alert req">${icon('clock', 'al-ic')}<div class="al-body"><div class="row"><strong>Confirmación de las ${cur.slot}:00 pendiente</strong>
      <button class="btn" data-act="confirm" data-id="${s.id}" type="button">Confirmar stock y responsable</button></div>
      <div class="hint">Confirmá que el stock está completo y quién está a cargo del workshop en este horario.</div></div></div>`;
  }
  const reqs = requestsFor(s.id);
  if (reqs.length) {
    h += `<div class="alert req"><strong>${reqs.length === 1 ? '1 pedido espera' : reqs.length + ' pedidos esperan'} tu respuesta</strong><div class="tickets">${reqs.map((l) => ticket(l, s.id)).join('')}</div></div>`;
  }
  if (news.length) {
    h += `<div class="alert">${icon('bell', 'al-ic')}<div class="al-body"><div class="row"><strong>Movimientos nuevos en este workshop</strong>
      <button class="btn sm sec" data-act="seen" data-id="${s.id}" type="button">Entendido</button></div>
      <ul>${news.slice(0, 8).map((e) => `<li>${esc(e.text)} <span class="hint">(${fmt(e.ts)})</span></li>`).join('')}</ul></div></div>`;
  }
  h += tabsHtml(s, tab);
  if (tab === 'stock') h += stockTable(s);
  if (tab === 'loans') h += spaceLoans(s);
  if (tab === 'log') h += spaceLog(s);
  return h;
}

let filterText = '', filterCat = '';
function stockTable(s) {
  const q = catKey(filterText);
  const cats = [...new Set(s.items.map((i) => i.category))].sort();
  if (filterCat && !cats.includes(filterCat)) filterCat = '';
  const items = s.items.filter((i) => (!q || catKey(i.name + ' ' + i.category + ' ' + i.comment).includes(q)) && (!filterCat || i.category === filterCat));
  let h = `<div class="toolbar">
      <label class="search">${icon('search')}<input type="search" id="filter" placeholder="Buscar elemento" value="${esc(filterText)}" aria-label="Buscar elemento"></label>
      <button class="btn" data-act="request" data-to="${s.id}" type="button">${icon('swap')}Pedir a otro workshop</button>
      <button class="btn sec" data-act="addItem" data-id="${s.id}" type="button">${icon('plus')}Agregar elemento</button>
      <button class="btn sec" data-act="lend" data-from="${s.id}" type="button">Prestar directo</button>
    </div>`;
  if (cats.length > 1) h += `<div class="chips" role="group" aria-label="Filtrar por categoría"><button type="button" class="chip ${filterCat ? '' : 'on'}" data-act="cat" data-cat="">Todas <span>${s.items.length}</span></button>${cats.map((c) => `<button type="button" class="chip ${catCls(c)} ${filterCat === c ? 'on' : ''}" data-act="cat" data-cat="${esc(c)}">${esc(c)} <span>${s.items.filter((i) => i.category === c).length}</span></button>`).join('')}</div>`;
  if (!items.length) return h + emptyBox(s.items.length ? 'Ningún elemento coincide con la búsqueda.' : 'Este workshop todavía no tiene elementos. Agregá el primero.');
  h += `<div class="table-wrap"><table class="stock"><thead><tr><th>Elemento</th><th class="num">Total</th><th class="num">Faltan</th><th class="num">Prestados</th><th class="num">En el WS</th><th>Estado</th><th></th></tr></thead><tbody>`;
  for (const i of items) {
    const loans = activeLoans().filter((l) => l.itemId === i.id);
    const out = lentOut(i.id), miss = i.missing || 0, here = i.qty - miss - out;
    h += `<tr class="${here === 0 ? 'row-empty' : ''}"><td class="c-name"><span class="cat ${catCls(i.category)}">${esc(i.category)}</span><span class="nm">${esc(i.name)}</span>${i.comment ? `<div class="sub">${esc(i.comment)}</div>` : ''}${i.link ? `<div class="sub"><a href="${esc(i.link)}" target="_blank" rel="noopener">Ver link</a></div>` : ''}
        ${S.loans.filter((l) => pendingReq(l) && l.itemId === i.id).map((l) => `<div class="sub reqnote">Pedido pendiente: ${l.qty} para ${esc(space(l.toSpaceId)?.name || '?')} (${esc(l.person)})</div>`).join('')}
        ${loans.map((l) => `<div class="loanchip"><span>Prestado: <b>${pending(l)}</b> → <b>${esc(space(l.toSpaceId)?.name || '?')}</b> · lo llevó <b>${esc(l.person)}</b> · ${fmt(l.createdAt)}${l.acceptedBy ? ` · aceptó ${esc(l.acceptedBy)}` : ''}${l.note ? ` · ${esc(l.note)}` : ''}</span><button class="btn sm sec" data-act="return" data-loan="${l.id}" type="button">Devolver</button></div>`).join('')}</td>
      <td class="num" data-label="Total"><div class="stepper"><button type="button" aria-label="Quitar unidades" title="Quitar (se perdió, se rompió…)" data-act="qty" data-dir="-1" data-id="${s.id}" data-item="${i.id}" ${here > 0 ? '' : 'disabled'}>−</button><b>${i.qty}</b><button type="button" aria-label="Agregar unidades" title="Agregar (nos dieron nuevos…)" data-act="qty" data-dir="1" data-id="${s.id}" data-item="${i.id}">+</button></div></td>
      <td class="num" data-label="Faltan"><div class="stepper"><button type="button" aria-label="Menos faltantes" data-act="miss" data-id="${s.id}" data-item="${i.id}" data-to="${miss - 1}" ${miss <= 0 ? 'disabled' : ''}>−</button><b class="${miss ? 'zero' : ''}">${miss}</b><button type="button" aria-label="Más faltantes" data-act="miss" data-id="${s.id}" data-item="${i.id}" data-to="${miss + 1}" ${miss >= i.qty - out ? 'disabled' : ''}>+</button></div></td>
      <td class="num ${out ? 'out' : ''}" data-label="Prestados">${out || '–'}</td>
      <td class="num" data-label="En el WS"><span class="here ${here === 0 ? 'none' : ''}">${here}</span></td>
      <td data-label="Estado" class="c-state">${i.needsFix ? `<span class="pill bad">Arreglar</span>` : `<span class="pill ok">OK</span>`}${i.problem ? `<div class="sub">${esc(i.problem)}</div>` : ''}</td>
      <td class="c-acts"><div class="acts">
        <button class="btn sm" data-act="request" data-from="${s.id}" data-item="${i.id}" type="button" ${here > 0 ? '' : 'disabled'}>Pedir</button>
        <button class="btn sm sec" data-act="lend" data-from="${s.id}" data-item="${i.id}" type="button" ${here > 0 ? '' : 'disabled'}>Prestar</button>
        <button class="btn sm ghost" data-act="editItem" data-id="${s.id}" data-item="${i.id}" type="button" aria-label="Editar ${esc(i.name)}">${icon('edit')}<span>Editar</span></button>
      </div></td></tr>`;
  }
  h += '</tbody></table></div>';
  const inn = S.loans.filter((l) => l.toSpaceId === s.id && pending(l) > 0);
  if (inn.length) h += `<h2 class="sec-title">Material de otros workshops que está acá ahora</h2><div class="tickets">${inn.map((l) => ticket(l)).join('')}</div>`;
  return h;
}

function ticket(l, ctx = null, showActions = true) {
  const from = space(l.fromSpaceId), to = space(l.toSpaceId);
  const st = l.status || 'active';
  const done = st === 'active' && pending(l) === 0;
  const route = `<b>${esc(from ? from.name : '?')}</b> → <b>${esc(to ? to.name : '?')}</b> · lo lleva <b>${esc(l.person)}</b>`;
  let cls = st === 'pending' ? 'pending' : st === 'rejected' || st === 'cancelled' ? 'rejected' : done ? 'done' : '';
  let body = '', acts = '';
  if (st === 'pending') {
    body = `<div class="route">${route}</div><div class="sub">Pedido por ${esc(l.by)} el ${fmt(l.requestedAt)}${l.note ? ` · ${esc(l.note)}` : ''}</div>
      <div class="out">Esperando respuesta de ${esc(from?.owner || from?.name || 'el responsable')}</div>`;
    if (showActions) {
      const owner = ctx === null || ctx === l.fromSpaceId, asker = ctx === null || ctx === l.toSpaceId;
      acts = (owner ? `<button class="btn sm" data-act="accept" data-loan="${l.id}" type="button">Aceptar</button><button class="btn sm sec" data-act="reject" data-loan="${l.id}" type="button">Rechazar</button>` : '')
        + (asker ? `<button class="btn sm sec" data-act="cancel" data-loan="${l.id}" type="button">Cancelar pedido</button>` : '');
    }
  } else if (st === 'rejected') {
    body = `<div class="route">${route}</div><div class="sub">Pedido por ${esc(l.by)} el ${fmt(l.requestedAt)}</div>
      <div class="zero">Rechazado por ${esc(l.respondedBy)} el ${fmt(l.respondedAt)}${l.rejectReason ? ` · ${esc(l.rejectReason)}` : ''}</div>`;
  } else if (st === 'cancelled') {
    body = `<div class="route">${route}</div><div class="sub">Pedido por ${esc(l.by)} el ${fmt(l.requestedAt)}</div><div class="zero">Pedido cancelado</div>`;
  } else {
    const trace = l.requestedAt
      ? `Pedido por ${esc(l.by)} el ${fmt(l.requestedAt)} · Prestó <b>${esc(l.acceptedBy)}</b> el ${fmt(l.acceptedAt)}`
      : `Registrado por ${esc(l.acceptedBy || l.by)} el ${fmt(l.createdAt)}`;
    body = `<div class="route">${route}</div><div class="sub">${trace}${l.note ? ` · ${esc(l.note)}` : ''}</div>
      ${done ? `<div class="okk">Devuelto completo el ${fmt(l.returnedAt)}</div>` : `<div class="out">Pendiente de devolver: ${pending(l)}${l.returned ? ` (ya volvieron ${l.returned})` : ''}</div>`}`;
    if (showActions && !done) acts = `<button class="btn sm" data-act="return" data-loan="${l.id}" type="button">Registrar devolución</button>`;
  }
  return `<article class="ticket ${cls}"><div><h3>${l.qty} × ${esc(l.itemName)}</h3>${body}</div>${acts ? `<div class="acts">${acts}</div>` : ''}</article>`;
}

function spaceLoans(s) {
  const block = (arr, empty) => arr.length ? `<div class="tickets">${arr.map((l) => ticket(l, s.id)).join('')}</div>` : emptyBox(empty);
  const recent = (arr) => [...arr.filter((l) => pendingReq(l) || (isActive(l) && pending(l) > 0)), ...arr.filter((l) => !pendingReq(l) && !(isActive(l) && pending(l) > 0)).slice(0, 8)];
  const asOwner = S.loans.filter((l) => l.fromSpaceId === s.id);
  const asAsker = S.loans.filter((l) => l.toSpaceId === s.id);
  return `<h2 class="sec-title">Pedidos que esperan nuestra respuesta</h2>${block(asOwner.filter(pendingReq), 'No hay pedidos pendientes.')}
    <h2 class="sec-title">Lo nuestro que está en otros workshops</h2>${block(recent(asOwner.filter((l) => !pendingReq(l))), 'Nadie se llevó nada de este workshop.')}
    <h2 class="sec-title">Lo que pedimos o tenemos de otros workshops <button class="btn sm" data-act="request" data-to="${s.id}" type="button">Pedir material</button></h2>
    ${block(recent(asAsker), 'No hay pedidos ni material de otros workshops acá.')}`;
}

function spaceLog(s) {
  const ev = S.log.filter((e) => e.spaceIds.includes(s.id)).slice(0, 100);
  if (!ev.length) return emptyBox('Todavía no hay movimientos registrados.');
  return `<ul class="log">${ev.map((e) => `<li class="lg-${esc(e.type)}"><time>${fmt(e.ts)}${e.by ? ' · ' + esc(e.by) : ''}</time><span>${esc(e.text)}</span></li>`).join('')}</ul>`;
}

function viewChecks() {
  const cur = InvLogic.currentSlot(), d = today();
  const cell = (s, slot) => {
    const c = confFor(s.id, d, slot);
    if (c) return `<span class="ck ${c.stockOk ? 'ok' : 'warn'}" title="${esc(c.note || 'Stock completo')}">${c.stockOk ? 'OK' : 'Diferencias'} · ${esc(c.owner)} · ${hhmm(c.ts)}</span>`;
    if (!cur || slot > cur.slot) return '<span class="ck none">–</span>';
    if (slot === cur.slot) return `<button class="btn sm" data-act="confirm" data-id="${s.id}" type="button">Confirmar</button>`;
    return '<span class="ck miss">Falta</span>';
  };
  return `<div class="head"><div><h1>Confirmaciones de hoy</h1>
      <div class="owner">Cada workshop confirma el stock y quién está a cargo a las ${InvLogic.SLOTS.join(', ')} hs (hora de Argentina).</div></div></div>
    <div class="table-wrap"><table class="checks"><thead><tr><th>Workshop</th>${InvLogic.SLOTS.map((h) => `<th>${h}:00</th>`).join('')}</tr></thead><tbody>
    ${checkable().map((s) => `<tr><td><a href="#/ws/${s.id}">${esc(s.name)}</a></td>${InvLogic.SLOTS.map((h) => `<td data-label="${h}:00">${cell(s, h)}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <p class="hint">Las confirmaciones quedan guardadas con fecha, hora, responsable y estado del stock, y también aparecen en el Historial de cada workshop.</p>`;
}

function viewAllLoans() {
  const reqs = S.loans.filter(pendingReq), act = activeLoans();
  const done = S.loans.filter((l) => !pendingReq(l) && !(isActive(l) && pending(l) > 0)).slice(0, 15);
  const list = (arr) => `<div class="tickets">${arr.map((l) => ticket(l)).join('')}</div>`;
  return `<div class="head"><div><h1>Préstamos y pedidos</h1><div class="owner">Todo lo que está pedido o fuera de su workshop de origen</div></div>
    <button class="btn" data-act="request" type="button">Pedir material</button></div>
    ${reqs.length ? `<h2 class="sec-title">Pedidos esperando respuesta</h2>${list(reqs)}` : ''}
    <h2 class="sec-title">Préstamos activos</h2>
    ${act.length ? list(act) : emptyBox('No hay préstamos pendientes. Todo está en su lugar.')}
    ${done.length ? `<h2 class="sec-title">Historial reciente</h2><div class="tickets">${done.map((l) => ticket(l, null, false)).join('')}</div>` : ''}`;
}

// ---------- Acciones contra el servidor ----------
async function act(payload) {
  const j = await api('/api/action', { ...payload, by: who() });
  S = j; initSeen(); render();
  return j.result;
}

// ---------- Diálogos ----------
function openDialog(html, onSubmit) {
  dlg.innerHTML = `<form class="dlg" method="dialog">${html}</form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('click', (e) => { if (e.target.dataset.close !== undefined) dlg.close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]'), err = form.querySelector('.err');
    btn.disabled = true; err.textContent = '';
    try { await onSubmit(new FormData(form), form); dlg.close(); }
    catch (x) { err.textContent = x.message; }
    btn.disabled = false;
  });
  dlg.showModal();
  return form;
}
const opts = (arr, sel, label) => arr.map((o) => `<option value="${esc(o.id)}" ${o.id === sel ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
const foot = (ok) => `<div class="err" role="alert"></div><div class="foot"><button class="btn sec" type="button" data-close>Cancelar</button><button class="btn" type="submit">${ok}</button></div>`;

const myWs = () => localStorage.getItem('myWs') || '';
function openLend({ from, item, to, mode = 'lend' } = {}) {
  const req = mode === 'request';
  from = from || (route().view === 'ws' && route().id !== to ? route().id : S.spaces.find((x) => x.id !== (to || myWs())).id);
  if (!to) to = myWs() && myWs() !== from ? myWs() : S.spaces.find((x) => x.id !== from).id;
  const form = openDialog(`<h2>${req ? 'Pedir material prestado' : 'Registrar préstamo directo'}</h2>
    <p class="hint">${req ? 'Tu pedido le llega al responsable del workshop que tiene el material. Cuando lo acepte, queda registrado quién lo prestó y a quién.' : 'Usalo si el material ya se entregó y solo querés dejarlo registrado.'}</p>
    <label class="field"><span>${req ? 'Se lo pedís al workshop' : 'Sale del workshop'}</span><select name="from">${opts(S.spaces, from, (x) => x.name)}</select></label>
    <label class="field"><span>Elemento</span><select name="itemId" required></select></label>
    <div class="two">
      <label class="field"><span>${req ? 'Para el workshop' : 'Va al workshop'}</span><select name="to">${opts(S.spaces, to, (x) => x.name)}</select></label>
      <label class="field"><span>Cantidad</span><input name="qty" type="number" min="1" value="1" required></label>
    </div>
    <label class="field"><span>${req ? 'Quién lo va a retirar' : 'Quién se lo lleva'}</span><input name="person" value="${esc(who())}" maxlength="80" required placeholder="Nombre y apellido"></label>
    <label class="field"><span>Nota (opcional)</span><input name="note" maxlength="300" placeholder="Ej: lo necesito para la clase del jueves"></label>
    <div class="hint" id="avail"></div>${foot(req ? 'Enviar pedido' : 'Registrar préstamo')}`,
    async (fd) => {
      localStorage.setItem('who', fd.get('person'));
      $('whoInput').value = fd.get('person');
      await act({ type: req ? 'requestLoan' : 'lend', fromSpaceId: fd.get('from'), toSpaceId: fd.get('to'), itemId: fd.get('itemId'), qty: fd.get('qty'), person: fd.get('person'), note: fd.get('note') });
      toast(req ? 'Pedido enviado. Queda pendiente hasta que el responsable lo acepte.' : 'Préstamo registrado.');
    });
  const q = (n) => form.querySelector(`[name=${n}]`);
  const fFrom = q('from'), fItem = q('itemId'), fQty = q('qty');
  const upd = () => {
    const it = space(fFrom.value).items.find((i) => i.id === fItem.value);
    fQty.max = it ? available(it) : 1;
    if (it && Number(fQty.value) > available(it)) fQty.value = available(it);
    $('avail').textContent = it ? `Disponibles en ${space(fFrom.value).name}: ${available(it)} de ${it.qty}.` : '';
  };
  const fillItems = (keep) => {
    const list = space(fFrom.value).items.filter((i) => available(i) > 0);
    fItem.innerHTML = list.length ? opts(list, keep, (i) => `${i.name} (disponibles: ${available(i)})`) : '<option value="">No hay elementos disponibles</option>';
    upd();
  };
  fFrom.addEventListener('change', () => fillItems());
  fItem.addEventListener('change', upd);
  fillItems(item);
}

function needName() {
  if (who()) return false;
  toast('Escribí tu nombre en el menú para poder responder.', true);
  openMenu(true);
  $('whoInput').focus();
  return true;
}
function openConfirm(spaceId) {
  const cur = InvLogic.currentSlot();
  if (!cur) { toast('Todavía no es horario de confirmación: la primera es a las 8:00.', true); return; }
  const s = space(spaceId);
  const miss = s.items.reduce((a, i) => a + (i.missing || 0), 0);
  const out = activeLoans().filter((l) => l.fromSpaceId === s.id).reduce((a, l) => a + pending(l), 0);
  const prev = confFor(s.id, cur.date, cur.slot);
  const form = openDialog(`<h2>Confirmación de las ${cur.slot}:00</h2>
    <p><b>${esc(s.name)}</b><br><span class="hint">${s.items.length} elementos · ${miss} unidades marcadas como faltantes · ${out} prestadas afuera</span></p>
    <label class="field"><span>¿Quién está a cargo del workshop ahora?</span><input name="owner" value="${esc(prev?.owner || who() || s.owner)}" maxlength="80" required placeholder="Nombre"></label>
    <fieldset class="field" style="border:0;padding:0;margin:0"><span>¿El stock coincide con lo que figura en la página?</span>
      <label class="check"><input type="radio" name="stock" value="yes" required ${prev && prev.stockOk ? 'checked' : ''}> Sí, está completo y coincide</label>
      <label class="check"><input type="radio" name="stock" value="no" ${prev && !prev.stockOk ? 'checked' : ''}> No, hay diferencias</label></fieldset>
    <label class="field" id="noteBox" hidden><span>¿Qué diferencia hay?</span><textarea name="note" rows="3" maxlength="500" placeholder="Ej: faltan 2 mouses; la silla 4 está rota">${esc(prev?.note || '')}</textarea>
      <span class="hint">Después ajustá los faltantes con − / + en la tabla del inventario.</span></label>
    ${foot('Confirmar')}`,
    async (fd) => {
      localStorage.setItem('who', fd.get('owner') || who());
      await act({ type: 'confirmSlot', spaceId, owner: fd.get('owner'), stockOk: fd.get('stock') === 'yes', note: fd.get('note') });
      toast(`Confirmación de las ${cur.slot}:00 registrada.`);
    });
  const box = form.querySelector('#noteBox');
  const sync = () => { box.hidden = form.querySelector('[name=stock]:checked')?.value !== 'no'; };
  form.querySelectorAll('[name=stock]').forEach((r) => r.addEventListener('change', sync));
  sync();
}

function openReject(loanId) {
  const l = S.loans.find((x) => x.id === loanId);
  openDialog(`<h2>Rechazar pedido</h2>
    <p><b>${l.qty} × ${esc(l.itemName)}</b> para ${esc(space(l.toSpaceId)?.name)} (${esc(l.person)}).</p>
    <label class="field"><span>Motivo (opcional)</span><input name="reason" maxlength="300" placeholder="Ej: lo usamos esa semana"></label>
    ${foot('Rechazar pedido')}`,
    async (fd) => { await act({ type: 'respondLoan', loanId, decision: 'reject', reason: fd.get('reason') }); toast('Pedido rechazado.'); });
}

function openReturn(loanId) {
  const l = S.loans.find((x) => x.id === loanId);
  openDialog(`<h2>Registrar devolución</h2>
    <p><b>${esc(l.itemName)}</b> · lo llevó ${esc(l.person)} a ${esc(space(l.toSpaceId)?.name)}.<br>Pendiente: ${pending(l)} de ${l.qty}.</p>
    <label class="field"><span>Cantidad que vuelve</span><input name="qty" type="number" min="1" max="${pending(l)}" value="${pending(l)}" required></label>
    ${foot('Registrar devolución')}`,
    async (fd) => { await act({ type: 'returnLoan', loanId, qty: fd.get('qty') }); toast('Devolución registrada.'); });
}

function openItem(spaceId, itemId) {
  const s = space(spaceId), it = itemId ? s.items.find((i) => i.id === itemId) : { category: 'Tecnología', qty: 1 };
  const cats = [...new Set(S.spaces.flatMap((x) => x.items.map((i) => i.category)).concat(['Tecnología', 'Mobiliario', 'Herramientas', 'Librería']))].sort();
  const form = openDialog(`<h2>${itemId ? 'Editar elemento' : 'Agregar elemento'}</h2>
    <label class="field"><span>Nombre</span><input name="name" value="${esc(it.name)}" required maxlength="120"></label>
    <div class="two">
      <label class="field"><span>Categoría</span><input name="category" list="cats" value="${esc(it.category)}" required><datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Cantidad total</span><input name="qty" type="number" min="0" value="${it.qty}" required></label>
    </div>
    <label class="field"><span>Cuántos faltan</span><input name="missing" type="number" min="0" value="${it.missing || 0}" required></label>
    <label class="check"><input type="checkbox" name="needsFix" ${it.needsFix ? 'checked' : ''}> Necesita arreglo</label>
    <label class="field"><span>Problema</span><input name="problem" value="${esc(it.problem)}" maxlength="300" placeholder="Ej: 2 están rotos"></label>
    <label class="field"><span>Link (opcional)</span><input name="link" type="url" value="${esc(it.link || '')}" maxlength="500" placeholder="https://"></label>
    <label class="field"><span>Comentarios</span><textarea name="comment" rows="2" maxlength="500">${esc(it.comment)}</textarea></label>
    ${foot('Guardar')}${itemId ? '<button class="btn danger sm" type="button" data-del>Eliminar elemento</button>' : ''}`,
    async (fd) => {
      const item = { name: fd.get('name'), category: fd.get('category'), qty: fd.get('qty'), missing: fd.get('missing'), link: fd.get('link'), needsFix: fd.get('needsFix') === 'on', problem: fd.get('problem'), comment: fd.get('comment') };
      if (itemId) await act({ type: 'updateItem', spaceId, itemId, patch: item });
      else await act({ type: 'addItem', spaceId, item });
      toast('Guardado.');
    });
  const del = form.querySelector('[data-del]');
  if (del) del.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar "${it.name}" de ${s.name}?`)) return;
    try { await act({ type: 'deleteItem', spaceId, itemId }); dlg.close(); toast('Elemento eliminado.'); }
    catch (x) { form.querySelector('.err').textContent = x.message; }
  });
}

function openQty(spaceId, itemId, dir) {
  const s = space(spaceId), it = s.items.find((i) => i.id === itemId);
  const out = lentOut(it.id), here = it.qty - (it.missing || 0) - out;
  const add = dir > 0;
  const reasons = add ? ['Nos dieron nuevos', 'Apareció uno que faltaba', 'Volvió de reparación', 'Corrección de conteo'] : ['Se perdió', 'Se rompió', 'Se dio de baja', 'Corrección de conteo'];
  openDialog(`<h2>${add ? 'Agregar' : 'Quitar'} ${esc(it.name)}</h2>
    <p>${esc(s.name)} · Total actual: <b>${it.qty}</b>${add ? '' : ` · se pueden quitar hasta ${here}`}</p>
    <label class="field"><span>Cantidad</span><input name="n" type="number" min="1" ${add ? '' : `max="${here}"`} value="1" required></label>
    <label class="field"><span>Motivo</span><select name="reason">${reasons.map((r) => `<option>${r}</option>`).join('')}<option value="">Otro…</option></select></label>
    <label class="field"><span>Detalle (opcional)</span><input name="note" maxlength="150" placeholder="${add ? 'Ej: los trajo Mariano de depósito' : 'Ej: el n° 8 dejó de andar'}"></label>
    ${foot(add ? 'Agregar' : 'Quitar')}`,
    async (fd) => {
      const n = Number(fd.get('n')), note = String(fd.get('note') || '').trim();
      const reason = [fd.get('reason'), note].filter(Boolean).join(': ');
      if (!reason) throw new Error('Escribí el motivo en el detalle.');
      const r = await act({ type: 'adjustQty', spaceId, itemId, delta: add ? n : -n, reason });
      toast(`Listo. Ahora hay ${r.qty} ${it.name}.`);
    });
}

function openOwner(spaceId) {
  const s = space(spaceId);
  openDialog(`<h2>Responsable de ${esc(s.name)}</h2>
    <label class="field"><span>Nombre</span><input name="owner" value="${esc(s.owner)}" maxlength="80"></label>${foot('Guardar')}`,
    async (fd) => { await act({ type: 'setOwner', spaceId, owner: fd.get('owner') }); toast('Responsable actualizado.'); });
}

function openInfo(spaceId) {
  const s = space(spaceId);
  openDialog(`<h2>Ficha de ${esc(s.name)}</h2>
    <label class="field"><span>Fecha del último relevamiento</span><input name="checkedAt" value="${esc(s.checkedAt || '')}" maxlength="40" placeholder="Ej: 08/10/2026"></label>
    <label class="field"><span>Etiquetas faltantes (una por línea)</span><textarea name="labels" rows="5">${esc((s.labels || []).join('\n'))}</textarea></label>
    ${foot('Guardar')}`,
    async (fd) => { await act({ type: 'setInfo', spaceId, checkedAt: fd.get('checkedAt'), labels: fd.get('labels') }); toast('Ficha actualizada.'); });
}

function openNewSpace() {
  openDialog(`<h2>Nuevo workshop</h2>
    <label class="field"><span>Nombre</span><input name="name" required maxlength="80" placeholder="Ej: WS 9 - Fotografía"></label>
    <label class="field"><span>Responsable</span><input name="owner" maxlength="80"></label>${foot('Crear workshop')}`,
    async (fd) => { const r = await act({ type: 'addSpace', name: fd.get('name'), owner: fd.get('owner') }); location.hash = '#/ws/' + r.id; });
}

// ---------- Eventos ----------
main.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const d = b.dataset;
  if (d.act === 'lend') openLend({ from: d.from, item: d.item, to: d.to });
  if (d.act === 'request') openLend({ from: d.from, item: d.item, to: d.to, mode: 'request' });
  if (d.act === 'accept' && !needName()) act({ type: 'respondLoan', loanId: d.loan, decision: 'accept' }).then(() => toast('Pedido aceptado. Quedó registrado el préstamo.')).catch((x) => toast(x.message, true));
  if (d.act === 'reject' && !needName()) openReject(d.loan);
  if (d.act === 'cancel' && confirm('¿Cancelar este pedido?')) act({ type: 'cancelRequest', loanId: d.loan }).then(() => toast('Pedido cancelado.')).catch((x) => toast(x.message, true));
  if (d.act === 'return') openReturn(d.loan);
  if (d.act === 'addItem') openItem(d.id);
  if (d.act === 'editItem') openItem(d.id, d.item);
  if (d.act === 'owner') openOwner(d.id);
  if (d.act === 'confirm') openConfirm(d.id);
  if (d.act === 'info') openInfo(d.id);
  if (d.act === 'qty') openQty(d.id, d.item, Number(d.dir));
  if (d.act === 'miss') act({ type: 'setMissing', spaceId: d.id, itemId: d.item, missing: d.to }).catch((x) => toast(x.message, true));
  if (d.act === 'seen') markSeen(d.id);
  if (d.act === 'cat') { filterCat = d.cat; render(); }
});
main.addEventListener('input', (e) => {
  if (e.target.id !== 'filter') return;
  filterText = e.target.value;
  render();
});
$('newSpaceBtn').addEventListener('click', openNewSpace);
$('syncBtn').addEventListener('click', async () => {
  if (!confirm('Se traen los cambios de la planilla (cantidades, estados, comentarios y responsables). No se borran préstamos, pedidos ni faltantes. ¿Seguir?')) return;
  try {
    const r = await act({ type: 'syncSeed', ...(localMode ? { seed: window.SEED } : {}) });
    toast(`Inventario actualizado: ${r.updated} elementos modificados y ${r.added} nuevos.`);
  } catch (x) { toast(x.message, true); }
});
let lastSlotKey = '';
setInterval(() => {
  if (!S) return;
  const c = InvLogic.currentSlot(), k = c ? c.date + c.slot : '';
  if (k !== lastSlotKey) { lastSlotKey = k; if (!dlg.open) render(); }
}, 30000);
$('resetBtn').addEventListener('click', () => {
  if (!confirm('Se borran los cambios y préstamos de este navegador y se vuelve a cargar el inventario del Excel. ¿Seguir?')) return;
  localStorage.removeItem(LOCAL_KEY); S = null; refresh();
});
$('whoInput').value = who();
function fillMyWs() {
  const sel = $('myWs');
  const key = myWs() + '|' + S.spaces.map((x) => x.id + ':' + x.name).join(',');
  if (sel.dataset.key === key) return; // no rearmar el selector si no cambió (se cerraría si está abierto)
  sel.dataset.key = key;
  sel.innerHTML = '<option value="">(sin elegir)</option>' + S.spaces.map((x) => `<option value="${esc(x.id)}" ${x.id === myWs() ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
$('myWs').addEventListener('change', (e) => { localStorage.setItem('myWs', e.target.value); render(); });
$('whoInput').addEventListener('input', (e) => { localStorage.setItem('who', e.target.value.trim()); if (S) renderNav(route()); });

// ---------- Menú en celular ----------
function openMenu(open) {
  document.body.classList.toggle('menu-open', open);
  $('menuBtn').setAttribute('aria-expanded', String(open));
}
$('menuBtn').addEventListener('click', () => openMenu(!document.body.classList.contains('menu-open')));
$('scrim').addEventListener('click', () => openMenu(false));
nav.addEventListener('click', (e) => { if (e.target.closest('a')) openMenu(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('menu-open')) openMenu(false); });
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); });

// ---------- Carga y sincronización ----------
async function refresh(silent) {
  if (dlg.open) return; // no pisar lo que la persona está escribiendo
  try {
    const j = await api('/api/state');
    const changed = !S || j.rev !== S.rev;
    S = j; initSeen();
    if (changed) render();
  } catch (x) { if (!silent) main.innerHTML = `<div class="alert">${esc(x.message)}</div>`; }
}
refresh();
setInterval(() => refresh(true), 8000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });

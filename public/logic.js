// Reglas del inventario y préstamos. Se usa igual en el servidor (Vercel) y en el navegador (modo local).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const uid = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 8);
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const int = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};

function findSpace(state, id) {
  const s = state.spaces.find((x) => x.id === id);
  if (!s) throw new HttpError(404, 'No existe ese workshop.');
  return s;
}
function findItem(space, id) {
  const it = space.items.find((x) => x.id === id);
  if (!it) throw new HttpError(404, 'No existe ese elemento.');
  return it;
}
const pending = (l) => l.qty - l.returned;
const TZ = 'America/Argentina/Buenos_Aires';
const SLOTS = [480, 600, 720, 960, 1080, 1180]; // horarios de confirmación en minutos desde las 00:00 (8:00, 10:00, 12:00, 16:00, 18:00 y 19:40, hora de Argentina)
const slotMin = (v) => (v < 24 ? v * 60 : v); // las confirmaciones viejas guardaban solo la hora
const fmtSlot = (m) => `${Math.floor(slotMin(m) / 60)}:${String(slotMin(m) % 60).padStart(2, '0')}`;
function arParts(ts) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {};
  f.formatToParts(new Date(ts)).forEach((x) => { o[x.type] = x.value; });
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour), minute: Number(o.minute) };
}
// Horario de confirmación vigente: el último que ya empezó hoy (null antes de las 8:00).
function currentSlot(ts = Date.now()) {
  const { date, hour, minute } = arParts(ts);
  const now = hour * 60 + minute;
  let slot = null;
  SLOTS.forEach((m) => { if (now >= m) slot = m; });
  return slot === null ? null : { date, slot };
}
const isActive = (l) => (l.status || 'active') === 'active';
function lentOut(state, itemId) {
  return state.loans.filter((l) => l.itemId === itemId && isActive(l) && pending(l) > 0).reduce((a, l) => a + pending(l), 0);
}
function addLog(state, entry) {
  state.log.unshift({ id: uid(), ts: Date.now(), ...entry });
  state.log = state.log.slice(0, 500);
}
function cleanItem(raw, base = {}) {
  const qty = int(raw.qty ?? base.qty ?? 0);
  if (!(qty >= 0)) throw new HttpError(400, 'La cantidad tiene que ser un número entero, 0 o más.');
  const name = str(raw.name ?? base.name, 120);
  if (!name) throw new HttpError(400, 'Falta el nombre del elemento.');
  const missing = int(raw.missing ?? base.missing ?? 0);
  if (!(missing >= 0) || missing > qty) throw new HttpError(400, 'Los faltantes no pueden ser más que la cantidad total.');
  return {
    name,
    missing,
    link: str(raw.link ?? base.link, 500),
    category: str(raw.category ?? base.category ?? 'Otros', 60) || 'Otros',
    qty,
    needsFix: Boolean(raw.needsFix ?? base.needsFix),
    problem: str(raw.problem ?? base.problem, 300),
    comment: str(raw.comment ?? base.comment, 500),
  };
}

const actions = {
  addSpace(state, p) {
    const name = str(p.name, 80);
    if (!name) throw new HttpError(400, 'Falta el nombre del workshop.');
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid();
    if (state.spaces.some((s) => s.id === id)) id += '-' + uid().slice(0, 3);
    state.spaces.push({ id, name, owner: str(p.owner, 80), checkedAt: '', labels: [], items: [] });
    addLog(state, { type: 'space', by: str(p.by, 80), spaceIds: [id], text: `Se creó el workshop ${name}` });
    return { id };
  },
  setOwner(state, p) {
    const s = findSpace(state, p.spaceId);
    s.owner = str(p.owner, 80);
    addLog(state, { type: 'owner', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: responsable ahora es ${s.owner || 'nadie'}` });
  },
  addItem(state, p) {
    const s = findSpace(state, p.spaceId);
    const item = { id: uid(), ...cleanItem(p.item || {}) };
    s.items.push(item);
    addLog(state, { type: 'item', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: se agregó ${item.qty} × ${item.name}` });
    return { id: item.id };
  },
  updateItem(state, p) {
    const s = findSpace(state, p.spaceId);
    const it = findItem(s, p.itemId);
    if (it.preset) throw new HttpError(400, 'Este elemento viene de la planilla y no se puede editar. Solo se pueden marcar faltantes.');
    const next = cleanItem(p.patch || {}, it);
    const out = lentOut(state, it.id);
    if (next.qty - next.missing < out) throw new HttpError(400, `Hay ${out} prestados: la cantidad en el WS no puede ser menor.`);
    Object.assign(it, next);
    addLog(state, { type: 'item', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: se editó ${it.name} (total ${it.qty})` });
  },
  setMissing(state, p) {
    const s = findSpace(state, p.spaceId);
    const it = findItem(s, p.itemId);
    const n = int(p.missing);
    if (!(n >= 0) || n > it.qty) throw new HttpError(400, `Faltantes: entre 0 y ${it.qty}.`);
    if (it.qty - n < lentOut(state, it.id)) throw new HttpError(400, 'Hay más prestados que lo que quedaría en el WS.');
    it.missing = n;
    addLog(state, { type: 'missing', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: ${n ? `faltan ${n} de ${it.name}` : `${it.name} completo (no falta nada)`}` });
  },
  setInfo(state, p) {
    const s = findSpace(state, p.spaceId);
    s.checkedAt = str(p.checkedAt, 40);
    s.labels = str(p.labels, 1000).split('\n').map((x) => x.trim()).filter(Boolean);
    addLog(state, { type: 'info', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: se actualizó la ficha del workshop` });
  },
  deleteItem(state, p) {
    const s = findSpace(state, p.spaceId);
    const it = findItem(s, p.itemId);
    if (it.preset) throw new HttpError(400, 'Este elemento viene de la planilla y no se puede eliminar.');
    if (lentOut(state, it.id) > 0) throw new HttpError(400, 'Ese elemento tiene préstamos sin devolver.');
    state.loans.forEach((l) => { if (l.itemId === it.id && l.status === 'pending') l.status = 'cancelled'; });
    s.items = s.items.filter((x) => x.id !== it.id);
    addLog(state, { type: 'item', by: str(p.by, 80), spaceIds: [s.id], text: `${s.name}: se eliminó ${it.name}` });
  },
  lend(state, p) {
    const from = findSpace(state, p.fromSpaceId);
    const to = findSpace(state, p.toSpaceId);
    if (from.id === to.id) throw new HttpError(400, 'El origen y el destino son el mismo workshop.');
    const it = findItem(from, p.itemId);
    const qty = int(p.qty);
    const person = str(p.person, 80);
    if (!person) throw new HttpError(400, 'Indicá quién se lleva el material.');
    if (!(qty > 0)) throw new HttpError(400, 'La cantidad tiene que ser 1 o más.');
    const available = it.qty - (it.missing || 0) - lentOut(state, it.id);
    if (qty > available) throw new HttpError(400, `Solo hay ${available} disponibles de ${it.name}.`);
    const loan = {
      id: uid(), itemId: it.id, itemName: it.name, category: it.category,
      fromSpaceId: from.id, toSpaceId: to.id, qty, returned: 0,
      person, note: str(p.note, 300), by: str(p.by, 80) || person, createdAt: Date.now(), returnedAt: null,
      status: 'active', requestedAt: null, acceptedBy: str(p.by, 80) || person, acceptedAt: Date.now(),
    };
    state.loans.unshift(loan);
    addLog(state, {
      type: 'lend', by: loan.by, spaceIds: [from.id, to.id], loanId: loan.id,
      text: `${person} se llevó ${qty} × ${it.name} de ${from.name} a ${to.name}`,
    });
    return { id: loan.id };
  },
  returnLoan(state, p) {
    const loan = state.loans.find((l) => l.id === p.loanId);
    if (!loan) throw new HttpError(404, 'No existe ese préstamo.');
    if (!isActive(loan)) throw new HttpError(400, 'Ese préstamo todavía no fue aceptado.');
    const qty = int(p.qty ?? pending(loan));
    if (!(qty > 0) || qty > pending(loan)) throw new HttpError(400, `Se pueden devolver entre 1 y ${pending(loan)}.`);
    loan.returned += qty;
    if (pending(loan) === 0) loan.returnedAt = Date.now();
    const from = state.spaces.find((s) => s.id === loan.fromSpaceId);
    const to = state.spaces.find((s) => s.id === loan.toSpaceId);
    addLog(state, {
      type: 'return', by: str(p.by, 80), spaceIds: [loan.fromSpaceId, loan.toSpaceId], loanId: loan.id,
      text: `Se devolvieron ${qty} × ${loan.itemName} a ${from ? from.name : 'WS origen'} (venían de ${to ? to.name : 'WS destino'})`,
    });
  },
  requestLoan(state, p) {
    const from = findSpace(state, p.fromSpaceId);
    const to = findSpace(state, p.toSpaceId);
    if (from.id === to.id) throw new HttpError(400, 'El origen y el destino son el mismo workshop.');
    const it = findItem(from, p.itemId);
    const qty = int(p.qty);
    const person = str(p.person, 80);
    if (!person) throw new HttpError(400, 'Indicá quién va a retirar el material.');
    if (!(qty > 0)) throw new HttpError(400, 'La cantidad tiene que ser 1 o más.');
    const available = it.qty - (it.missing || 0) - lentOut(state, it.id);
    if (qty > available) throw new HttpError(400, `Hoy solo hay ${available} disponibles de ${it.name}.`);
    const now = Date.now();
    const loan = {
      id: uid(), itemId: it.id, itemName: it.name, category: it.category,
      fromSpaceId: from.id, toSpaceId: to.id, qty, returned: 0, person,
      note: str(p.note, 300), by: str(p.by, 80) || person, status: 'pending',
      requestedAt: now, createdAt: now, returnedAt: null,
    };
    state.loans.unshift(loan);
    addLog(state, {
      type: 'request', by: loan.by, spaceIds: [from.id, to.id], loanId: loan.id,
      text: `${person} (${to.name}) pidió ${qty} × ${it.name} a ${from.name}`,
    });
    return { id: loan.id };
  },
  respondLoan(state, p) {
    const loan = state.loans.find((l) => l.id === p.loanId);
    if (!loan) throw new HttpError(404, 'No existe ese pedido.');
    if (loan.status !== 'pending') throw new HttpError(400, 'Ese pedido ya fue respondido.');
    const by = str(p.by, 80);
    if (!by) throw new HttpError(400, 'Escribí tu nombre (arriba a la izquierda) para responder el pedido.');
    const from = state.spaces.find((s) => s.id === loan.fromSpaceId);
    const to = state.spaces.find((s) => s.id === loan.toSpaceId);
    const now = Date.now();
    if (p.decision === 'accept') {
      const it = from && from.items.find((i) => i.id === loan.itemId);
      if (!it) throw new HttpError(404, 'Ese elemento ya no existe.');
      const available = it.qty - (it.missing || 0) - lentOut(state, it.id);
      if (loan.qty > available) throw new HttpError(400, `Ya no alcanza: hoy hay ${available} disponibles de ${it.name}.`);
      loan.status = 'active'; loan.acceptedBy = by; loan.acceptedAt = now; loan.createdAt = now;
      addLog(state, {
        type: 'accept', by, spaceIds: [loan.fromSpaceId, loan.toSpaceId], loanId: loan.id,
        text: `${by} aceptó el pedido: ${loan.person} se lleva ${loan.qty} × ${loan.itemName} de ${from.name} a ${to ? to.name : '?'}`,
      });
    } else if (p.decision === 'reject') {
      loan.status = 'rejected'; loan.respondedBy = by; loan.respondedAt = now; loan.rejectReason = str(p.reason, 300);
      addLog(state, {
        type: 'reject', by, spaceIds: [loan.fromSpaceId, loan.toSpaceId], loanId: loan.id,
        text: `${by} rechazó el pedido de ${loan.person}: ${loan.qty} × ${loan.itemName}${loan.rejectReason ? ` (${loan.rejectReason})` : ''}`,
      });
    } else throw new HttpError(400, 'Respuesta no válida.');
  },
  cancelRequest(state, p) {
    const loan = state.loans.find((l) => l.id === p.loanId);
    if (!loan) throw new HttpError(404, 'No existe ese pedido.');
    if (loan.status !== 'pending') throw new HttpError(400, 'Ese pedido ya fue respondido.');
    loan.status = 'cancelled'; loan.respondedAt = Date.now(); loan.respondedBy = str(p.by, 80);
    addLog(state, { type: 'cancel-request', by: str(p.by, 80), spaceIds: [loan.fromSpaceId, loan.toSpaceId], loanId: loan.id, text: `Se canceló el pedido de ${loan.person}: ${loan.qty} × ${loan.itemName}` });
  },
  confirmSlot(state, p) {
    const s = findSpace(state, p.spaceId);
    const cur = currentSlot();
    if (!cur) throw new HttpError(400, 'Todavía no es horario de confirmación: la primera es a las 8:00.');
    const owner = str(p.owner, 80);
    if (!owner) throw new HttpError(400, 'Indicá quién está a cargo del workshop.');
    const stockOk = p.stockOk === true || p.stockOk === 'true';
    const note = str(p.note, 500);
    if (!stockOk && !note) throw new HttpError(400, 'Contá qué diferencia hay en el stock.');
    state.confirmations = (state.confirmations || []).filter((c) => !(c.spaceId === s.id && c.date === cur.date && slotMin(c.slot) === cur.slot));
    const by = str(p.by, 80) || owner;
    state.confirmations.unshift({ id: uid(), spaceId: s.id, date: cur.date, slot: cur.slot, owner, stockOk, note, by, ts: Date.now() });
    state.confirmations = state.confirmations.slice(0, 800);
    addLog(state, {
      type: 'check', by, spaceIds: [s.id],
      text: `${s.name}: confirmación de las ${fmtSlot(cur.slot)}. A cargo: ${owner}. Stock ${stockOk ? 'completo' : `con diferencias (${note})`}`,
    });
    return { date: cur.date, slot: cur.slot };
  },
  syncSeed(state, p) {
    const seed = p.seed;
    if (!seed || !Array.isArray(seed.spaces)) throw new HttpError(400, 'No hay datos del Excel para importar.');
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    const key = (i) => norm(i.category) + '|' + norm(i.name);
    let added = 0, updated = 0, newSpaces = 0;
    const removed = [], kept = [];
    for (const id of seed.removedSpaces || []) {
      const sp = state.spaces.find((x) => x.id === id);
      if (!sp) continue;
      const busy = state.loans.some((l) => (l.fromSpaceId === id || l.toSpaceId === id) && (l.status === 'pending' || ((l.status || 'active') === 'active' && l.qty - l.returned > 0)));
      if (busy) { kept.push(sp.name); continue; } // tiene préstamos o pedidos sin cerrar: no se borra
      state.spaces = state.spaces.filter((x) => x.id !== id);
      state.loans = state.loans.filter((l) => l.fromSpaceId !== id && l.toSpaceId !== id);
      state.confirmations = (state.confirmations || []).filter((c) => c.spaceId !== id);
      removed.push(sp.name);
    }
    for (const ss of seed.spaces) {
      let sp = state.spaces.find((x) => x.id === ss.id);
      if (!sp) {
        state.spaces.push(JSON.parse(JSON.stringify(ss)));
        newSpaces++; added += ss.items.length;
        continue;
      }
      if (ss.owner) sp.owner = ss.owner;
      if (ss.checkedAt) sp.checkedAt = ss.checkedAt;
      if (Array.isArray(ss.labels) && ss.labels.length) sp.labels = ss.labels.slice();
      const used = new Set();
      for (const si of ss.items) {
        const it = sp.items.find((x) => !used.has(x.id) && key(x) === key(si));
        if (!it) {
          sp.items.push({ id: uid(), name: si.name, category: si.category, qty: si.qty, missing: 0, needsFix: si.needsFix, problem: si.problem, comment: si.comment, link: si.link || '', preset: true });
          added++; continue;
        }
        used.add(it.id);
        if (!it.preset) { it.preset = true; updated++; }
        const minQty = lentOut(state, it.id) + (it.missing || 0);
        const next = { qty: Math.max(si.qty, minQty), needsFix: si.needsFix, problem: si.problem, comment: si.comment, link: si.link || '' };
        if (Object.keys(next).some((k) => it[k] !== next[k])) { Object.assign(it, next); updated++; }
      }
    }
    state.seedVersion = seed.version || 0;
    if (updated || added || newSpaces || removed.length) {
      addLog(state, { type: 'sync', by: str(p.by, 80), spaceIds: [], text: `Se actualizó el inventario desde la planilla${p.auto ? ' (automático)' : ''}: ${updated} elementos modificados, ${added} nuevos${newSpaces ? `, ${newSpaces} workshops nuevos` : ''}${removed.length ? `. Se quitaron: ${removed.join(', ')}` : ''}` });
    }
    return { added, updated, newSpaces, removed, kept };
  },
  deleteLoan(state, p) {
    const i = state.loans.findIndex((l) => l.id === p.loanId);
    if (i < 0) throw new HttpError(404, 'No existe ese préstamo.');
    const l = state.loans[i];
    state.loans.splice(i, 1);
    addLog(state, { type: 'loan-removed', by: str(p.by, 80), spaceIds: [l.fromSpaceId, l.toSpaceId], text: `Se anuló el préstamo de ${l.qty} × ${l.itemName}` });
  },
};


function applyAction(state, body) {
  const fn = actions[body.type];
  if (!fn) throw new HttpError(400, 'Acción desconocida.');
  const result = fn(state, body);
  state.rev = (state.rev || 0) + 1;
  return result;
}

return { actions, HttpError, applyAction, SLOTS, arParts, currentSlot, fmtSlot, slotMin };
});

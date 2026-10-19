// Lógica compartida del backend: almacenamiento (Upstash Redis) y acciones.
const crypto = require('crypto');
const seed = require('../public/seed.js');
const { actions, HttpError } = require('../public/logic.js');

const KEY = 'inventario_ws_state';
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = Boolean(URL && TOKEN);

async function redis(cmd) {
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

// Sin Redis (desarrollo local) los datos viven en memoria y se pierden al reiniciar.
const mem = (global.__inventarioMem = global.__inventarioMem || { raw: null });

async function loadRaw() {
  if (!HAS_REDIS) {
    if (!mem.raw) mem.raw = JSON.stringify(seed);
    return mem.raw;
  }
  let raw = await redis(['GET', KEY]);
  if (!raw) {
    await redis(['SET', KEY, JSON.stringify(seed), 'NX']);
    raw = await redis(['GET', KEY]);
  }
  return raw;
}

async function compareAndSet(oldRaw, newRaw) {
  if (!HAS_REDIS) {
    if (mem.raw !== oldRaw) return false;
    mem.raw = newRaw;
    return true;
  }
  const script =
    "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 else return 0 end";
  return (await redis(['EVAL', script, '1', KEY, oldRaw, newRaw])) === 1;
}

async function getState() {
  return JSON.parse(await loadRaw());
}

// Lee, aplica el cambio y guarda solo si nadie modificó el estado mientras tanto (reintenta si hubo choque).
async function mutate(fn) {
  for (let i = 0; i < 6; i++) {
    const raw = await loadRaw();
    const state = JSON.parse(raw);
    const result = fn(state);
    state.rev = (state.rev || 0) + 1;
    if (await compareAndSet(raw, JSON.stringify(state))) return { state, result };
  }
  throw new HttpError(409, 'Hubo muchos cambios al mismo tiempo. Probá de nuevo.');
}

// ---- Usuarios de los líderes: usuario + contraseña, sesión firmada ----
const SECRET = process.env.AUTH_SECRET || TOKEN || 'inventario-dev-secret';
const PROTECTED = ['confirmSlot', 'setMissing', 'setInfo', 'setOwner', 'addItem', 'updateItem', 'deleteItem'];
const USERNAME_RE = /^[a-z0-9_-]{3,30}$/;
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('hex');
function makeToken(username) {
  const body = `${username}.${Date.now() + 30 * 24 * 3600 * 1000}`; // dura 30 días
  return `${body}.${sign(body)}`;
}
// Devuelve el nombre de usuario si el token es válido y no venció.
function readToken(token) {
  if (typeof token !== 'string') return null;
  const [u, exp, sig] = token.split('.');
  if (!u || !exp || !sig || Number(exp) < Date.now()) return null;
  const want = sign(`${u}.${exp}`);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? u : null;
}
const hashPass = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
function samePass(pw, user) {
  const a = Buffer.from(hashPass(pw, user ? user.salt : 'sin-usuario'), 'hex');
  const b = Buffer.from(user ? user.hash : '0'.repeat(64), 'hex');
  return Boolean(user) && a.length === b.length && crypto.timingSafeEqual(a, b);
}
function newPassHash(pw) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { salt, hash: hashPass(pw, salt) };
}
// Lo que se manda al navegador: nunca usuarios, claves ni intentos fallidos.
function publicState(state) {
  const { users, loginFails, leaders, ...rest } = state;
  const lead = {};
  Object.values(users || {}).forEach((u) => (u.spaceIds || []).forEach((id) => { (lead[id] = lead[id] || []).push(u.name); }));
  return { ...rest, leaders: lead, persistent: HAS_REDIS, pinRequired: Boolean(process.env.APP_PIN), adminRequired: Boolean(process.env.ADMIN_PIN) };
}

function checkPin(req) {
  const pin = process.env.APP_PIN;
  if (pin && req.headers['x-app-pin'] !== pin) throw new HttpError(401, 'PIN incorrecto.');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

module.exports = { crypto, PROTECTED, USERNAME_RE, makeToken, readToken, samePass, newPassHash, publicState, seed, getState, mutate, actions, checkPin, send, HttpError, HAS_REDIS };

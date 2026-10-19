const { crypto, mutate, getState, checkPin, send, HttpError, USERNAME_RE, makeToken, readToken, samePass, newPassHash, publicState } = require('./_lib.js');

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const MIN_PASS = 6;
const logEntry = (s, by, spaceIds, text) => {
  s.log.unshift({ id: crypto.randomUUID().slice(0, 8), ts: Date.now(), type: 'user', by, spaceIds, text });
  s.log = s.log.slice(0, 500);
};
const session = (username, user) => ({ token: makeToken(username), username, name: user.name, spaceIds: user.spaceIds || [] });

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
    checkPin(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};

    // ---------- ingresar ----------
    if (body.type === 'login') {
      const username = clean(body.username, 40).toLowerCase();
      const state = await getState();
      const fail = (state.loginFails || {})[username];
      if (fail && fail.until > Date.now()) throw new HttpError(429, 'Demasiados intentos fallidos. Probá de nuevo en unos minutos.');
      const user = (state.users || {})[username];
      if (!samePass(String(body.password || ''), user)) {
        await mutate((s) => {
          s.loginFails = s.loginFails || {};
          const x = s.loginFails[username] || { n: 0 };
          x.n += 1;
          if (x.n >= 5) { x.until = Date.now() + 10 * 60 * 1000; x.n = 0; }
          s.loginFails[username] = x;
        });
        throw new HttpError(403, 'Usuario o contraseña incorrectos.');
      }
      if (fail) await mutate((s) => { delete (s.loginFails || {})[username]; });
      return send(res, 200, { ...publicState(state), ...session(username, user) });
    }

    // ---------- datos de mi sesión (se renueva al abrir la app) ----------
    if (body.type === 'me') {
      const username = readToken(body.token);
      const state = await getState();
      const user = username && (state.users || {})[username];
      if (!user) throw new HttpError(401, 'La sesión ya no es válida.');
      return send(res, 200, { ...publicState(state), ...session(username, user) });
    }

    // ---------- cambiar mi contraseña ----------
    if (body.type === 'changePassword') {
      const username = readToken(body.token);
      const state = await getState();
      const user = username && (state.users || {})[username];
      if (!user) throw new HttpError(401, 'Ingresá de nuevo con tu usuario.');
      if (!samePass(String(body.oldPassword || ''), user)) throw new HttpError(403, 'La contraseña actual no es correcta.');
      const pw = String(body.newPassword || '');
      if (pw.length < MIN_PASS) throw new HttpError(400, `La contraseña nueva tiene que tener al menos ${MIN_PASS} caracteres.`);
      const { state: next } = await mutate((s) => { Object.assign(s.users[username], newPassHash(pw)); logEntry(s, user.name, user.spaceIds || [], `${user.name} cambió su contraseña`); });
      return send(res, 200, { ...publicState(next), ...session(username, next.users[username]) });
    }

    // ---------- administración de usuarios (requiere el código ADMIN_PIN) ----------
    if (body.type === 'admin') {
      const adminPin = process.env.ADMIN_PIN;
      if (!adminPin) throw new HttpError(403, 'Para administrar usuarios hace falta configurar la variable ADMIN_PIN en Vercel (Settings → Environment Variables) y hacer un Redeploy.');
      if (body.adminPin !== adminPin) throw new HttpError(403, 'El código de administración no es correcto.');
      const list = (s) => Object.entries(s.users || {}).map(([username, u]) => ({ username, name: u.name, spaceIds: u.spaceIds || [] })).sort((a, b) => a.username.localeCompare(b.username));
      if (body.op === 'list') return send(res, 200, { users: list(await getState()) });

      const username = clean(body.username, 40).toLowerCase();
      const spaces = (s) => {
        const ids = Array.isArray(body.spaceIds) ? body.spaceIds : [];
        const ok = ids.filter((id) => s.spaces.some((x) => x.id === id));
        if (!ok.length) throw new HttpError(400, 'Elegí al menos un workshop.');
        return [...new Set(ok)];
      };
      const spaceNames = (s, ids) => ids.map((id) => (s.spaces.find((x) => x.id === id) || {}).name || id).join(', ');
      const { state } = await mutate((s) => {
        s.users = s.users || {};
        if (body.op === 'create') {
          const name = clean(body.name, 80), pw = String(body.password || '');
          if (!USERNAME_RE.test(username)) throw new HttpError(400, 'El usuario tiene que tener entre 3 y 30 caracteres: letras sin tildes, números, guion o guion bajo.');
          if (s.users[username]) throw new HttpError(400, 'Ese usuario ya existe.');
          if (name.length < 2) throw new HttpError(400, 'Escribí el nombre de la persona.');
          if (pw.length < MIN_PASS) throw new HttpError(400, `La contraseña tiene que tener al menos ${MIN_PASS} caracteres.`);
          const ids = spaces(s);
          s.users[username] = { name, spaceIds: ids, createdAt: Date.now(), ...newPassHash(pw) };
          logEntry(s, 'Administración', ids, `Se creó el usuario ${username} (${name}) como líder de ${spaceNames(s, ids)}`);
        } else {
          const u = s.users[username];
          if (!u) throw new HttpError(404, 'Ese usuario no existe.');
          if (body.op === 'resetPassword') {
            const pw = String(body.password || '');
            if (pw.length < MIN_PASS) throw new HttpError(400, `La contraseña tiene que tener al menos ${MIN_PASS} caracteres.`);
            Object.assign(u, newPassHash(pw));
            if (s.loginFails) delete s.loginFails[username];
            logEntry(s, 'Administración', u.spaceIds || [], `Se reseteó la contraseña de ${username}`);
          } else if (body.op === 'setSpaces') {
            u.spaceIds = spaces(s);
            logEntry(s, 'Administración', u.spaceIds, `${username} ahora es líder de ${spaceNames(s, u.spaceIds)}`);
          } else if (body.op === 'delete') {
            delete s.users[username];
            logEntry(s, 'Administración', u.spaceIds || [], `Se eliminó el usuario ${username}`);
          } else throw new HttpError(400, 'Operación desconocida.');
        }
      });
      return send(res, 200, { ...publicState(state), users: list(state) });
    }

    throw new HttpError(400, 'Acción desconocida.');
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
};

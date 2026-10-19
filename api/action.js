const { seed, mutate, getState, actions, checkPin, send, HttpError, PROTECTED, readToken, publicState } = require('./_lib.js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
    checkPin(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const fn = actions[body.type];
    if (!fn) throw new HttpError(400, 'Acción desconocida.');
    if (body.type === 'syncSeed') body.seed = seed; // siempre el inventario publicado, nunca uno enviado por el navegador
    if (PROTECTED.includes(body.type)) {
      // Solo un usuario líder de ese workshop puede confirmar o cambiar su inventario.
      const username = readToken(body.token);
      const user = username && ((await getState()).users || {})[username];
      if (!user) throw new HttpError(403, 'Tenés que ingresar con tu usuario para hacer esto.');
      if (!(user.spaceIds || []).includes(body.spaceId)) throw new HttpError(403, 'Tu usuario no es líder de este workshop.');
      body.by = user.name;
    }
    const { state, result } = await mutate((s) => fn(s, body));
    send(res, 200, { ...publicState(state), result });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
};

const { seed, mutate, actions, checkPin, send, HttpError, HAS_REDIS } = require('./_lib.js');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');
    checkPin(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (body.type === 'syncSeed') body.seed = seed; // siempre el inventario publicado, nunca uno enviado por el navegador
    const fn = actions[body.type];
    if (!fn) throw new HttpError(400, 'Acción desconocida.');
    const { state, result } = await mutate((s) => fn(s, body));
    send(res, 200, { ...state, persistent: HAS_REDIS, pinRequired: Boolean(process.env.APP_PIN), result });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
};

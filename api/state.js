const { getState, checkPin, send, HAS_REDIS } = require('./_lib.js');

module.exports = async (req, res) => {
  try {
    checkPin(req);
    const state = await getState();
    send(res, 200, { ...state, persistent: HAS_REDIS, pinRequired: Boolean(process.env.APP_PIN) });
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
};

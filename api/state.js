const { getState, publicState, checkPin, send } = require('./_lib.js');

module.exports = async (req, res) => {
  try {
    checkPin(req);
    send(res, 200, publicState(await getState()));
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
};

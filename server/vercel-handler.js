const { handleAPI } = require('./api-routes');

module.exports = async (req, res) => {
  try {
    await handleAPI(req, res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: e.message }));
  }
};

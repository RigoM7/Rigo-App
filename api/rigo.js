const { createServer } = require('../lib/server.cjs');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const result = await createServer().run(req);
    res.status(200).json(result);
  } catch (error) {
    res.status(error.status || 400).json({ error: error.status ? error.message : 'The request could not be completed. Refresh and try again.' });
  }
};

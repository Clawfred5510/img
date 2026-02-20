const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Proxy API calls to the bot (no path rewrite — bot serves at same paths)
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:4001',
  changeOrigin: true,
  timeout: 5000,
  onError: (err, req, res) => res.status(502).json({ error: 'Bot API unavailable' })
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IMG Dashboard running on http://0.0.0.0:${PORT}`);
});

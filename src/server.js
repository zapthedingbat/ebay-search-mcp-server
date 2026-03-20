import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import cors from 'cors';
import { Automation } from './automation.js';
import { createApiRouter } from './api-server.js';
import { createMcpRouter } from './mcp-server.js';
import { createOpenAiRouter } from './openai-server.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

const ebayConfig = {
  appId: process.env.EBAY_APP_ID ?? process.env.EBAY_CLIENT_ID,
  certId: process.env.EBAY_CERT_ID ?? process.env.EBAY_CLIENT_SECRET,
  sandbox: process.env.EBAY_SANDBOX === 'true',
  marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB',
};

const automation = new Automation(ebayConfig);

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT) || 3000;
const allowedHosts = process.env.MCP_ALLOWED_HOSTS
? process.env.MCP_ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
: ['localhost', '127.0.0.1', '[::1]'];

const app = createMcpExpressApp({ host: HOST, allowedHosts });

// Log method, path, and response status when the response is sent
app.use((req, res, next) => {
  res.on('finish', () => {
    log('Request: %s %s %d', req.method, req.url, res.statusCode);
  });
  next();
});

app.use(cors({ origin: true, credentials: true }));

app.use('/api', createApiRouter(automation));
app.use('/mcp', createMcpRouter(automation));
app.use('/openai', createOpenAiRouter(automation));

// Log eBay API errors with full response details (status + body)
app.use((err, req, res, next) => {
  if (err?.meta?.res) {
    log('eBay API error: %s %s', err.message, err.description || '');
    console.error('eBay response: %s %s', err.meta.res.status, JSON.stringify(err.meta.res.data || {}));
  } else {
    log('Error: %s', err.message);
    console.error(err);
  }
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

process.on('SIGTERM', async () => {
  await automation.close().catch(console.error);
  process.exit(0);
});

const server = app.listen(PORT, HOST, () => {
  console.log('eBay server on %s:%s', HOST, PORT);
  log('eBay server on %s:%s', HOST, PORT);
});

// Keep the server reference so the process stays alive (avoids exit on some environments)
server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

// If the process exits unexpectedly, this may fire (event loop empty)
process.on('beforeExit', (code) => {
  console.error('Process about to exit with code', code, '- event loop is empty');
});

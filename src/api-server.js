import express from 'express';
import { Automation, SEARCH_GUIDANCE } from './automation.js';
import { requireApiKey } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

/**
 * Create an Express router that serves the eBay REST API. Mount at /api.
 * Single search endpoint with query, filter, sort; UK/delivery options; and guidance.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createApiRouter(automation) {
  const router = express.Router();
  const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  router.get('/health', (_, res) =>
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  );

  router.use(requireApiKey);

  // GET /api/search?q=... & optional filter, sort, deliveryCountry, itemLocationCountry, limit, offset
  router.get('/search', asyncHandler(async (req, res) => {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({
        error: 'q or query required',
        guidance: SEARCH_GUIDANCE,
      });
    }

    const filter = req.query.filter;
    const sort = req.query.sort;
    const deliveryCountry = req.query.deliveryCountry ?? req.query.delivery_country ?? 'GB';
    const itemLocationCountry = req.query.itemLocationCountry ?? req.query.item_location_country;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;

    const result = await automation.search(query, {
      filter,
      sort,
      deliveryCountry: deliveryCountry || undefined,
      itemLocationCountry: itemLocationCountry || undefined,
      limit,
      offset,
    });

    res.json({
      ...result,
      guidance: SEARCH_GUIDANCE,
    });
  }));

  router.get('/item/:itemId', asyncHandler(async (req, res) => {
    const itemId = req.params.itemId;
    if (!itemId) return res.status(400).json({ error: 'itemId required' });
    const result = await automation.getItem(itemId);
    res.json(result);
  }));

  // ...existing code...

  router.use((_, res) => res.status(404).json({ error: 'Not found' }));
  router.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return router;
}

const isMain = process.argv[1]?.includes('api-server.js');
if (isMain) {
  const ebayConfig = {
    appId: process.env.EBAY_APP_ID,
    certId: process.env.EBAY_CERT_ID,
    sandbox: process.env.EBAY_SANDBOX === 'true',
    marketplaceId: process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB',
  };
  const automation = new Automation(ebayConfig);
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(automation));
  const PORT = process.env.PORT || 3000;
  process.on('SIGTERM', async () => {
    await automation.close().catch(console.error);
    process.exit(0);
  });
  app.listen(PORT, () => log('eBay API on port %s', PORT));
}

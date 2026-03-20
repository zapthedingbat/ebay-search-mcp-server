/**
 * OpenAI-compatible tools server. Exposes eBay tools for OpenAI Assistants / Chat Completions
 * function calling. Mount at /openai.
 *
 * GET  /openai/tools         – tool definitions (type: "function", function: { name, description, parameters })
 * POST /openai/tools/execute – execute a tool by name with arguments, returns { content }
 */

import express from 'express';

/** OpenAI-style function tool definitions (JSON Schema for parameters). */
const OPENAI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'ebay_search',
      description:
        'Search eBay with query, filter, and sort. Defaults to UK (deliveryCountry=GB). For indicative pricing use sort=newlyListed then average prices. For Buy It Now deals use filter=buyingOptions:{FIXED_PRICE}, sort=newlyListed. For auctions ending soon use filter=buyingOptions:{AUCTION}, sort=endingSoonest. Use itemLocationCountry=GB to limit to UK-based sellers.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keywords',
          },
          filter: {
            type: 'string',
            description: 'eBay filter, e.g. buyingOptions:{FIXED_PRICE}, price:[0..50]',
          },
          sort: {
            type: 'string',
            enum: ['price', '-price', 'newlyListed', 'endingSoonest'],
            description: 'Sort: price (low first), -price (high first), newlyListed, endingSoonest',
          },
          deliveryCountry: {
            type: 'string',
            description: 'Delivery country code (default GB for UK)',
          },
          itemLocationCountry: {
            type: 'string',
            description: 'Item location country, e.g. GB for UK sellers only',
          },
          limit: {
            type: 'number',
            description: 'Max results (default 50)',
            minimum: 1,
            maximum: 200,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ebay_get_item',
      description: 'Get full details for an eBay item by item ID (from search results).',
      parameters: {
        type: 'object',
        properties: {
          itemId: {
            type: 'string',
            description: 'eBay item ID (e.g. v1|123456|0)',
          },
        },
        required: ['itemId'],
      },
    },
  },
  // ...existing code...
];

/**
 * Create an Express router for OpenAI tools. Mount at /openai.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createOpenAiRouter(automation) {
  const router = express.Router();

  const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next);

  /** GET /openai/tools – return tool definitions for OpenAI API */
  router.get('/tools', (_, res) => {
    res.json({ tools: OPENAI_TOOLS });
  });

  /** POST /openai/tools/execute – execute one tool. Body: { name, arguments } where arguments is object or JSON string. */
  router.post(
    '/tools/execute',
    express.json(),
    asyncHandler(async (req, res) => {
      const { name, arguments: argsRaw } = req.body ?? {};
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid "name" in body' });
      }

      let args = argsRaw;
      if (typeof args === 'string') {
        try {
          args = JSON.parse(args);
        } catch {
          return res.status(400).json({ error: 'Invalid "arguments" JSON string' });
        }
      }
      if (args !== null && typeof args !== 'object') {
        args = {};
      }
      const params = args ?? {};

      if (name === 'ebay_search') {
        const query = params.query;
        if (!query) return res.status(400).json({ error: 'ebay_search requires "query" in arguments' });
        const result = await automation.search(query, {
          filter: params.filter,
          sort: params.sort,
          deliveryCountry: params.deliveryCountry || 'GB',
          itemLocationCountry: params.itemLocationCountry,
          limit: params.limit,
        });
        const lines = (result.itemSummaries || [])
          .slice(0, 25)
          .map(
            (i) =>
              `${i.title || 'N/A'} | ${i.price ? `${i.price.value} ${i.price.currency}` : 'N/A'} | ${i.itemWebUrl || i.itemId}`
          )
          .join('\n');
        const content =
          result.itemSummaries?.length
            ? `Total: ${result.total ?? result.itemSummaries.length}\n${lines}`
            : 'No items found.';
        return res.json({ content });
      }

      if (name === 'ebay_get_item') {
        const itemId = params.itemId;
        if (!itemId) return res.status(400).json({ error: 'ebay_get_item requires "itemId" in arguments' });
        const item = await automation.getItem(itemId);
        const content = [
          `Title: ${item.title || 'N/A'}`,
          item.price ? `Price: ${item.price.value} ${item.price.currency}` : '',
          item.condition ? `Condition: ${item.condition}` : '',
          item.itemWebUrl ? `URL: ${item.itemWebUrl}` : '',
          item.shortDescription ? `Description: ${item.shortDescription}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        return res.json({ content: content || 'Item not found.' });
      }

      // ...existing code...

      return res.status(404).json({ error: `Unknown tool: ${name}` });
    })
  );

  return router;
}

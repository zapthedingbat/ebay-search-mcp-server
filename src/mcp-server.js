/**
 * MCP route factory: returns an Express router that serves the eBay MCP endpoint. Mount at /mcp.
 * Supports Streamable HTTP (POST/GET/DELETE /mcp) and HTTP+SSE (GET /mcp/sse, POST /mcp/messages).
 */

import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as z from 'zod/v4';
import { requireApiKey } from './auth.js';
import { createLogger } from './logger.js';

const log = createLogger('mcp-server');

function sendJsonError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

const SEARCH_TOOL_DESCRIPTION = `Search eBay with query, filter, and sort. Defaults to UK (deliveryCountry=GB). For indicative pricing: sort=newlyListed then average prices. For Buy It Now deals: filter=buyingOptions:{FIXED_PRICE}, sort=newlyListed. For auctions ending soon: filter=buyingOptions:{AUCTION}, sort=endingSoonest. Use itemLocationCountry=GB to limit to UK-based sellers (avoid import).`;

/**
 * Create an Express router that serves the MCP endpoint. Mount at /mcp.
 * @param {import('./automation.js').Automation} automation
 * @returns {express.Router}
 */
export function createMcpRouter(automation) {
  const router = express.Router();

  /** Open WebUI (and similar clients) fetch /mcp/openapi.json for discovery. Return minimal OpenAPI 3 + CORS. */
  const OPENAPI_SPEC = {
    openapi: '3.0.0',
    info: { title: 'eBay Automation MCP', version: '1.0.0', description: 'MCP Streamable HTTP server for eBay search and item details.' },
    paths: {
      '/': {
        post: { summary: 'MCP Streamable HTTP (JSON-RPC)', description: 'POST JSON-RPC messages. Use Mcp-Session-Id for subsequent requests.' },
        get: { summary: 'Get session state', description: 'Requires Mcp-Session-Id header.' },
        delete: { summary: 'Close session', description: 'Requires Mcp-Session-Id header.' },
      },
      '/sse': { get: { summary: 'SSE transport', description: 'Establish SSE connection for MCP.' } },
      '/messages': { post: { summary: 'SSE message endpoint', description: 'POST with query sessionId for HTTP+SSE transport.' } },
    },
    servers: [{ url: '/mcp', description: 'MCP base path' }],
  };

  /** GET /mcp/openapi.json – OpenAPI spec for OpenWebUI / discovery */
  router.get('/openapi.json', (req, res) => {
    res.json(OPENAPI_SPEC);
  });

  /** Use requireApiKey middleware to authenticate all requests */
  router.use(requireApiKey);

  /** @type {Map<string, SSEServerTransport>} */
  const sseTransports = new Map();
  /** @type {Map<string, StreamableHTTPServerTransport>} */
  const streamableTransports = new Map();

  const SERVER_INFO = {
    name: 'ebay-automation',
    version: '1.0.0',
    instructions:
      'eBay search: use ebay_search with query, optional filter and sort. Default is UK delivery (GB). For market pricing use sort=newlyListed and average the prices. For deals use FIXED_PRICE+newlyListed or AUCTION+endingSoonest. Use ebay_get_item for full item details. Cart: use ebay_get_cart to list cart items, ebay_add_to_cart with itemId (from search) to add, ebay_remove_from_cart with cartItemId (from get_cart) to remove.',
  };

  function getMcpServer() {
    const server = new McpServer(
      {
        name: SERVER_INFO.name,
        version: SERVER_INFO.version,
        instructions: SERVER_INFO.instructions,
      },
      { capabilities: { logging: {} } }
    );

    const tools = [
      {
        name: 'ebay_search',
        title: 'Search eBay',
        description: SEARCH_TOOL_DESCRIPTION,
        inputSchema: {
          query: z.string().describe('Search keywords'),
          filter: z.string().optional().describe('eBay filter, e.g. buyingOptions:{FIXED_PRICE}, price:[0..50]'),
          sort: z
            .enum(['price', '-price', 'newlyListed', 'endingSoonest'])
            .optional()
            .describe('Sort: price (low first), -price (high first), newlyListed, endingSoonest'),
          deliveryCountry: z.string().optional().describe('Delivery country code (default GB for UK)'),
          itemLocationCountry: z.string().optional().describe('Item location country, e.g. GB for UK sellers only'),
          limit: z.number().min(1).max(200).optional().describe('Max results (default 50)'),
        },
        handler: async ({ query, filter, sort, deliveryCountry, itemLocationCountry, limit }) => {
          const result = await automation.search(query, {
            filter,
            sort,
            deliveryCountry: deliveryCountry || 'GB',
            itemLocationCountry: itemLocationCountry || undefined,
            limit,
          });
          const lines = (result.itemSummaries || [])
            .slice(0, 25)
            .map(
              (i) =>
                `${i.title || 'N/A'} | ${i.price ? `${i.price.value} ${i.price.currency}` : 'N/A'} | ${i.itemWebUrl || i.itemId}`
            )
            .join('\n');
          const summary = result.itemSummaries?.length
            ? `Total: ${result.total ?? result.itemSummaries.length}\n${lines}`
            : 'No items found.';
          const guidance = [
            'Scenarios: Indicative pricing → sort=newlyListed, then average prices. Buy It Now deals → filter=buyingOptions:{FIXED_PRICE}, sort=newlyListed. Auctions ending soon → filter=buyingOptions:{AUCTION}, sort=endingSoonest. UK only → deliveryCountry=GB, itemLocationCountry=GB.',
          ].join(' ');
          return {
            content: [
              { type: 'text', text: `${summary}\n\n${guidance}` },
            ],
          };
        },
      },
      {
        name: 'ebay_get_item',
        title: 'Get item details',
        description: 'Get full details for an eBay item by item ID (from search results).',
        inputSchema: {
          itemId: z.string().describe('eBay item ID (e.g. v1|123456|0)'),
        },
        handler: async ({ itemId }) => {
          const item = await automation.getItem(itemId);
          const text = [
            `Title: ${item.title || 'N/A'}`,
            item.price ? `Price: ${item.price.value} ${item.price.currency}` : '',
            item.condition ? `Condition: ${item.condition}` : '',
            item.itemWebUrl ? `URL: ${item.itemWebUrl}` : '',
            item.shortDescription ? `Description: ${item.shortDescription}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          return { content: [{ type: 'text', text: text || 'Item not found.' }] };
        },
      },
    ];

    for (const t of tools) {
      server.registerTool(
        t.name,
        {
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
        },
        t.handler
      );
    }
    return server;
  }

  // Streamable HTTP: POST/GET/DELETE /
  router.all('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? streamableTransports.get(sessionId) : undefined;
    try {
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!sessionId) {
          sendJsonError(res, 400, -32000, 'Mcp-Session-Id required for GET/DELETE.');
          return;
        }
        if (!transport) {
          sendJsonError(res, 404, -32000, 'Session not found.');
          return;
        }
        await transport.handleRequest(req, res, req.body);
        return;
      }
      if (req.method === 'POST') {
        if (transport) {
          if (isInitializeRequest(req.body)) {
            res.setHeader('mcp-session-id', sessionId);
            res.status(200).json({
              jsonrpc: '2.0',
              result: {
                protocolVersion: '2025-03-26',
                capabilities: { logging: {}, tools: { listChanged: true } },
                serverInfo: {
                  name: SERVER_INFO.name,
                  version: SERVER_INFO.version,
                },
                instructions: SERVER_INFO.instructions,
              },
              id: req.body.id ?? null,
            });
            return;
          }
          await transport.handleRequest(req, res, req.body);
          return;
        }
        if (sessionId) {
          sendJsonError(res, 400, -32000, 'Session uses different transport (use /mcp/messages for SSE).');
          return;
        }
        if (!isInitializeRequest(req.body)) {
          sendJsonError(res, 400, -32000, 'No valid session ID or initialize request.');
          return;
        }
        const server = getMcpServer();
        const newTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => streamableTransports.set(sid, newTransport),
        });
        newTransport.onclose = () => {
          const sid = newTransport.sessionId;
          if (sid && streamableTransports.get(sid) === newTransport) {
            streamableTransports.delete(sid);
            log('Streamable HTTP session closed: %s', sid);
          }
          newTransport.onclose = undefined;
          server.close();
        };
        await server.connect(newTransport);
        await newTransport.handleRequest(req, res, req.body);
        return;
      }
      sendJsonError(res, 405, -32000, 'Method not allowed.');
    } catch (err) {
      log('MCP request error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  router.get('/sse', async (req, res) => {
    try {
      const endpoint = `${req.baseUrl || '/mcp'}/messages`;
      const transport = new SSEServerTransport(endpoint, res);
      sseTransports.set(transport.sessionId, transport);
      transport.onclose = () => sseTransports.delete(transport.sessionId);
      await getMcpServer().connect(transport);
    } catch (err) {
      log('SSE session start error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  router.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
      sendJsonError(res, 400, -32000, 'Missing sessionId parameter');
      return;
    }
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      log('Session not found for sessionId: %s', sessionId);
      sendJsonError(res, 404, -32000, 'Session not found');
      return;
    }
    try {
      await transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      log('MCP SSE messages error: %s', err.message);
      sendJsonError(res, 500, -32603, err.message || 'Internal server error');
    }
  });

  return router;
}

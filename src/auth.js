/**
 * Shared auth middleware for API and MCP routes.
 * When EBAY_API_KEY is set, requires either:
 *   - Authorization: Bearer <EBAY_API_KEY>
 *   - X-API-Key: <EBAY_API_KEY>
 * When EBAY_API_KEY is unset, no auth is applied (development).
 */

import { createLogger } from './logger.js';

const log = createLogger('auth');

const SECRET_ENV = 'EBAY_API_KEY';

export function requireApiKey(req, res, next) {

  const secret = process.env[SECRET_ENV];
  if (!secret) {
    return next();
  }

  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  const provided =
    (authHeader && authHeader.startsWith('Bearer ') && authHeader.slice(7).trim()) ||
    (apiKeyHeader && apiKeyHeader.trim()) ||
    null;

  if (!provided || provided !== secret) {
    log('Unauthorized %s %s', req.method, req.path);
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid API key. Use Authorization: Bearer <key> or X-API-Key: <key>.',
    });
    return;
  }

  next();
}

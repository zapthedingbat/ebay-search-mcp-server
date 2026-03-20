/**
 * Create a namespaced debug logger. Each module should create its own logger and pass the name it chooses.
 *
 * Enable in the shell before running (nothing is logged until DEBUG is set):
 *   Unix:   DEBUG=ebay:* node -r dotenv/config src/api-server.js
 *   Win:    set DEBUG=ebay:* && node -r dotenv/config src/api-server.js
 *
 * @param {string} name - Namespace name (e.g. 'automation', 'api'). Becomes ebay:name.
 * @returns {function} - debug logger
 */
import createDebug from 'debug';

export function createLogger(name) {
  return createDebug(`ebay:${name}`);
}

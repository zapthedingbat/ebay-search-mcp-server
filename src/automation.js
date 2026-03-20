/**
 * eBay automation module. Exposes a simple search (and getItem) using the eBay Buy Browse API.
 * Supports UK-focused defaults (delivery to GB, items located in GB) to avoid import issues.
 */

import eBayApi from 'ebay-api';
import { createLogger } from './logger.js';

const log = createLogger('automation');

/** @typedef {import('ebay-api').AppConfig} AppConfig */

/**
 * Normalize price value from API (ConvertedAmount has value as string).
 * @param {{ value?: string; currency?: string } | undefined} amount
 * @returns {{ value: number; currency: string } | null}
 */
function parsePrice(amount) {
  if (!amount || amount.value == null) return null;
  const num = parseFloat(String(amount.value));
  if (Number.isNaN(num)) return null;
  return { value: num, currency: amount.currency || 'GBP' };
}

/**
 * Build a single filter string from user filter and location options.
 * eBay filter format: comma-separated key:value or key:[range], e.g. price:[10..50],deliveryCountry:GB
 * @param {string} [userFilter] - Optional user-supplied filter
 * @param {{ deliveryCountry?: string; itemLocationCountry?: string }} [location]
 * @returns {string} Combined filter string
 */
function buildFilter(userFilter, location = {}) {
  const parts = [];
  if (location.deliveryCountry) {
    parts.push(`deliveryCountry:${location.deliveryCountry}`);
  }
  if (location.itemLocationCountry) {
    parts.push(`itemLocationCountry:${location.itemLocationCountry}`);
  }
  if (userFilter && userFilter.trim()) {
    parts.push(userFilter.trim());
  }
  return parts.join(',') || undefined;
}

export class Automation {
  /**
   * @param {AppConfig & { appId?: string; certId?: string; sandbox?: boolean; marketplaceId?: string }} config - eBay API config. For UK use marketplaceId: 'EBAY_GB'. Env: EBAY_APP_ID, EBAY_CERT_ID, EBAY_SANDBOX, EBAY_MARKETPLACE_ID.
   */
  constructor(config = {}) {
    const appId = config.appId ?? process.env.EBAY_APP_ID;
    const certId = config.certId ?? process.env.EBAY_CERT_ID;
    const sandbox = config.sandbox ?? (process.env.EBAY_SANDBOX === 'true');

    if (!appId || !certId) {
      log('Missing appId or certId; create from env with EBAY_APP_ID and EBAY_CERT_ID');
    }

    this._config = {
      appId,
      certId,
      sandbox,
      ...config,
    };
    /** @type {import('ebay-api') | null} */
    this._api = null;
  }

  /** @returns {import('ebay-api')} */
  _getApi() {
    if (!this._api) {
      this._api = new eBayApi(this._config);
      log('eBay API instance created (sandbox=%s)', this._config.sandbox);
    }
    return this._api;
  }

  /**
   * Search for items.
   * @param {string} query - Search keywords
   * @param {{ limit?: number; offset?: number; sort?: string; filter?: string; deliveryCountry?: string; itemLocationCountry?: string }} [options]
   *   - sort: e.g. price (low→high), -price (high→low), newlyListed, endingSoonest
   *   - filter: eBay filter string, e.g. buyingOptions:{FIXED_PRICE}, price:[0..50]
   *   - deliveryCountry: limit to items that can be delivered to this country (e.g. GB for UK; avoids import from sellers who don't ship to UK)
   *   - itemLocationCountry: limit to items located in this country (e.g. GB = UK sellers only, helps avoid import tax)
   * @returns {Promise<{ itemSummaries: Array<{ itemId?: string; title?: string; price?: { value: number; currency: string }; itemWebUrl?: string; condition?: string }>; total?: number; limit?: number; offset?: number }>}
   */
  async search(query, options = {}) {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const params = { q: query, limit: String(limit), offset: String(offset) };

    if (options.sort) params.sort = options.sort;

    const filter = buildFilter(options.filter, {
      deliveryCountry: options.deliveryCountry,
      itemLocationCountry: options.itemLocationCountry,
    });
    if (filter) params.filter = filter;

    log('search q=%s limit=%s offset=%s sort=%s', query, limit, offset, options.sort || 'default');
    const result = await this._getApi().buy.browse.search(params);

    const itemSummaries = (result.itemSummaries || []).map((item) => ({
      itemId: item.itemId,
      title: item.title,
      price: parsePrice(item.price),
      itemWebUrl: item.itemWebUrl,
      condition: item.condition,
    }));

    return {
      itemSummaries,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  /**
   * Get full item details by item ID.
   * @param {string} itemId - eBay item ID (e.g. v1|123456|0)
   */
  async getItem(itemId) {
    log('getItem %s', itemId);
    const item = await this._getApi().buy.browse.getItem(itemId);
    return {
      itemId: item.itemId,
      title: item.title,
      price: parsePrice(item.price),
      itemWebUrl: item.itemWebUrl,
      condition: item.condition,
      shortDescription: item.shortDescription,
    };
  }

  // ...existing code...

  async close() {
    this._api = null;
    log('eBay automation closed');
  }
}

/** Guidance for common search scenarios (for API response or docs). */
export const SEARCH_GUIDANCE = {
  indicativePricing: {
    title: 'Indicative / market pricing',
    description: 'Get a sense of current market value from active listings.',
    steps: [
      'Search with your query (e.g. product name or category).',
      'Use sort=newlyListed to see most recently listed items (closest to “recent” activity).',
      'Compute the average of the returned prices from itemSummaries[].price.value.',
    ],
    note: 'The Browse API returns current (buyable) listings only. eBay does not offer a public API to list historical sold prices. Using current listings sorted by newlyListed is a practical proxy for recent asking prices.',
    example: { q: 'iphone 13', sort: 'newlyListed', deliveryCountry: 'GB' },
  },
  dealsBuyItNow: {
    title: 'Deals: recently listed Buy It Now',
    description: 'Find fixed-price (Buy It Now) items that were just listed.',
    steps: [
      'Use filter=buyingOptions:{FIXED_PRICE} to restrict to Buy It Now.',
      'Use sort=newlyListed so the newest listings appear first.',
    ],
    example: { q: 'laptop', filter: 'buyingOptions:{FIXED_PRICE}', sort: 'newlyListed', deliveryCountry: 'GB' },
  },
  dealsAuctionEndingSoon: {
    title: 'Deals: auctions ending soonest',
    description: 'Find auction listings that are about to end.',
    steps: [
      'Use filter=buyingOptions:{AUCTION} to show only auctions.',
      'Use sort=endingSoonest so items ending soonest appear first.',
    ],
    example: { q: 'vinyl records', filter: 'buyingOptions:{AUCTION}', sort: 'endingSoonest', deliveryCountry: 'GB' },
  },
  ukAndDelivery: {
    title: 'UK only and delivery (avoid import / collection-only)',
    description: 'Limit results to items you can get in the UK without import issues, and that offer delivery.',
    steps: [
      'Use deliveryCountry=GB so only items that can be delivered to the UK are returned (ensures delivery is available; excludes sellers who do not ship to the UK).',
      'Optionally use itemLocationCountry=GB (e.g. via filter or the itemLocationCountry option) to restrict to items located in the UK, reducing import tax and delay.',
    ],
    note: 'Do not use deliveryOptions:SELLER_ARRANGED_LOCAL_PICKUP if you want delivery; that filter returns collection-only items.',
    example: { q: 'camera', deliveryCountry: 'GB', itemLocationCountry: 'GB', sort: 'price' },
  },
  sortOptions: [
    'price – lowest total (price + shipping) first',
    '-price – highest price first',
    'newlyListed – most recently listed first',
    'endingSoonest – auctions/listings ending soonest first',
  ],
  filterExamples: [
    'buyingOptions:{FIXED_PRICE} – Buy It Now only',
    'buyingOptions:{AUCTION} – Auctions only',
    'price:[0..50] – Price between 0 and 50 (use with priceCurrency if needed)',
    'priceCurrency:GBP – When using price filter',
    'conditions:{NEW} or conditions:{USED}',
    'deliveryCountry:GB – Can be delivered to UK',
    'itemLocationCountry:GB – Item located in UK',
  ],
};

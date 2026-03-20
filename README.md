# eBay Automation

Node.js automation interface for eBay: a simple **search** endpoint with query, filter, and sort. Supports UK-focused defaults (delivery to GB, items located in GB) to avoid import tax and collection-only results.

## Features

- **Search** – Single endpoint with `q`, `filter`, `sort`; optional `deliveryCountry` (default GB), `itemLocationCountry`, `limit`, `offset`
- **Item details** – Get full item by ID
- **Guidance** – Response includes example scenarios (indicative pricing, Buy It Now deals, auctions ending soon, UK/delivery)

eBay functionality is exposed on an `Automation` instance, passed to the HTTP API and MCP server.

## Setup

1. **eBay Developer keys**  
   Create an app at [eBay Developer Keys](https://developer.ebay.com/my/keys) and get **Client ID** (App ID) and **Client Secret** (Cert ID).

2. **Environment**  
   Copy `.env.example` to `.env` and set:

   ```env
   EBAY_APP_ID=your-client-id
   EBAY_CERT_ID=your-client-secret
   EBAY_SANDBOX=true   # use false for production
   EBAY_MARKETPLACE_ID=EBAY_GB   # optional; default is UK
   ```

   Optional: `EBAY_API_KEY` to protect HTTP and MCP (Bearer or `X-API-Key` header).

## Scripts

- `npm start` – Single server (port 3000): REST at `/api`, MCP at `/mcp`
- `npm run dev` – Same with watch
- `npm run api-server` – API only (port 3000)
- `npm run mcp-server` – MCP only (port 3100)

## REST API (when using `npm start`, served at `/api`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/search?q=...` | Search. Params: `q` (required), `filter`, `sort`, `deliveryCountry` (default `GB`), `itemLocationCountry`, `limit`, `offset` |
| GET | `/api/item/:itemId` | Item details by ID |

Every search response includes a `guidance` object with example scenarios and filter/sort options.

### Search parameters (`/api/search`)

- **q** (required) – Search keywords
- **filter** – eBay filter string, e.g. `buyingOptions:{FIXED_PRICE}`, `price:[0..50]`, `conditions:{NEW}`
- **sort** – `price` (low first), `-price` (high first), `newlyListed`, `endingSoonest`
- **deliveryCountry** – Default `GB`. Only items that can be delivered to this country (avoids collection-only when you want delivery).
- **itemLocationCountry** – e.g. `GB` to restrict to items located in the UK (reduces import tax).
- **limit**, **offset** – Pagination (limit default 50, max 200).

### Example scenarios (guidance)

**Indicative / market pricing**  
Search with your query, use `sort=newlyListed` to get recently listed items, then average the `price.value` of the results. (Browse API returns current listings only; eBay does not provide a public API for historical sold prices.)

**Deals: recently listed Buy It Now**  
`filter=buyingOptions:{FIXED_PRICE}` and `sort=newlyListed`.

**Deals: auctions ending soon**  
`filter=buyingOptions:{AUCTION}` and `sort=endingSoonest`.

**UK only and delivery (avoid import / collection-only)**  
Use `deliveryCountry=GB` (default) so only items that can be delivered to the UK are returned. Add `itemLocationCountry=GB` to restrict to UK-based sellers. Do not use `deliveryOptions:SELLER_ARRANGED_LOCAL_PICKUP` if you want delivery (that filter returns collection-only items).

### Example requests

```text
GET /api/search?q=iphone%2013&sort=newlyListed&deliveryCountry=GB
GET /api/search?q=laptop&filter=buyingOptions:{FIXED_PRICE}&sort=newlyListed
GET /api/search?q=vinyl&filter=buyingOptions:{AUCTION}&sort=endingSoonest
GET /api/search?q=camera&deliveryCountry=GB&itemLocationCountry=GB&sort=price
```

## MCP (when using `npm start`, served at `/mcp`)

- **Streamable HTTP**: `POST /mcp` with JSON-RPC; use `Mcp-Session-Id` for GET/DELETE.
- **SSE**: `GET /mcp/sse` then `POST /mcp/messages?sessionId=...`.

Tools: **ebay_search** (query, filter, sort, deliveryCountry, itemLocationCountry, limit), **ebay_get_item** (itemId).

### Open WebUI (client-side MCP)

Open WebUI calls MCP **from the browser**, so the MCP URL must be one the **browser** can reach. The Docker hostname `ebay-automation` only resolves inside the Docker network and will not work from Open WebUI’s client-side connection.

- Use **`http://localhost:3000/mcp`** if the eBay app is on the same machine and port 3000 is exposed, or  
- Use **`http://YOUR_SERVER_IP:3000/mcp`** (e.g. `http://192.168.10.20:3000/mcp`) so the browser can reach the Docker host.

Ensure that host is allowed: set **MCP_ALLOWED_HOSTS** in `.env` to include it (e.g. `localhost,127.0.0.1,ebay-automation,192.168.10.20`). If you use an API key and Open WebUI cannot send headers, leave **EBAY_API_KEY** unset for MCP to work.

#### Making the model use eBay in Open WebUI

Adding the connection is not enough — the model must have the tools **enabled** for the chat and use **Native** function calling.

1. **Add the connection** (if not already):
   - **Settings → Connections**
   - Add **OpenAPI** (for this server's OpenAI-style tools) with URL:  
     `https://ebay-automation.bridgecottage.network`  
     (no path). Or add **MCP Streamable HTTP** with URL:  
     `https://ebay-automation.bridgecottage.network/mcp`
   - If you use **EBAY_API_KEY**, set **Bearer** and paste the key.

2. **Enable the tools for the chat** (pick one):
   - **Per chat:** In the message input area, click the **➕** (plus) icon and enable the eBay tools (e.g. "ebay-automation" / "ebay_search", "ebay_get_item") for that conversation.
   - **By default for a model:** **Workspace → Models** → click ✏️ on the model → scroll to **Tools** → check the eBay tools → **Save**.

3. **Use Native (Agentic) function calling**  
   Otherwise the model may say it "can't search eBay" instead of calling the tool:
   - **Admin Panel → Settings → Models** → open **Model Specific Settings** for your model → **Advanced Parameters** → set **Function Calling** to **Native**; or  
   - In a chat: **⚙️ Chat Controls** → **Advanced Params** → **Function Calling** → **Native**.

After this, prompts like "Search eBay for cheap CPUs" should trigger the **ebay_search** tool. Use a model that supports function calling (e.g. GPT-4o, Claude, Gemini).

## OpenAI tools (when using `npm start`, served at `/openai`)

For use with [OpenAI function calling](https://platform.openai.com/docs/guides/function-calling) or Assistants API:

**GET /openai/tools** – Returns tool definitions in OpenAI format (`{ tools: [ { type: "function", function: { name, description, parameters } } ] }`). Register these with the Chat Completions or Assistants API.
**POST /openai/tools/execute** – Execute a tool. Body: `{ "name": "ebay_search" | "ebay_get_item", "arguments": { ... } }`. `arguments` can be an object or a JSON string (as in OpenAI `tool_calls`). Returns `{ "content": "..." }` (the tool result string to send back to the model).

Tools: **ebay_search** (query, filter?, sort?, deliveryCountry?, itemLocationCountry?, limit?), **ebay_get_item** (itemId). Same behaviour as MCP/REST; use the same auth (Bearer or X-API-Key if `EBAY_API_KEY` is set).

## Project structure

- `src/server.js` – **Single entry point**: creates Automation, mounts `/api`, `/mcp`, and `/openai` on one Express app
`src/automation.js` – `Automation` class (search, getItem), `SEARCH_GUIDANCE`
- `src/api-server.js` – `createApiRouter(automation)` for REST (can still run standalone)
- `src/mcp-server.js` – `createMcpRouter(automation)` for MCP (can still run standalone)
- `src/openai-server.js` – `createOpenAiRouter(automation)` for OpenAI tools (GET /openai/tools, POST /openai/tools/execute)
- `src/auth.js` – Optional API key middleware
- `src/logger.js` – Debug logger (`DEBUG=ebay:*`)

## License

MIT

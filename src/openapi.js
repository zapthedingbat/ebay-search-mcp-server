/**
 * OpenAPI 3 spec for the OpenAI-compatible tools API.
 * Served at /openapi.json and under /openapi/* so OpenWebUI (and similar) discovery succeeds.
 */

export const OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'eBay Automation Tools',
    description: 'OpenAI-compatible function calling: list tools and execute (eBay search, get item, get cart, add/remove from cart).',
    version: '1.0.0',
  },
  servers: [{ url: '/', description: 'API root' }],
  paths: {
    '/openai/tools': {
      get: {
        summary: 'List tools',
        description: 'Returns OpenAI-style function tool definitions for ebay_search, ebay_get_item, ebay_get_cart, ebay_add_to_cart, ebay_remove_from_cart.',
        operationId: 'listTools',
        responses: {
          '200': {
            description: 'List of tools',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['tools'],
                  properties: {
                    tools: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/OpenAITool' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/openai/tools/execute': {
      post: {
        summary: 'Execute tool',
        description: 'Run a tool by name with arguments. Returns { content } (string).',
        operationId: 'executeTool',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string', enum: ['ebay_search', 'ebay_get_item', 'ebay_get_cart', 'ebay_add_to_cart', 'ebay_remove_from_cart'] },
                  arguments: {
                    oneOf: [
                      { type: 'object', additionalProperties: true },
                      { type: 'string', description: 'JSON string of arguments' },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Tool result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['content'],
                  properties: { content: { type: 'string' } },
                },
              },
            },
          },
          '400': { description: 'Bad request (missing/invalid name or arguments)' },
          '404': { description: 'Unknown tool name' },
        },
      },
    },
  },
  components: {
    schemas: {
      OpenAITool: {
        type: 'object',
        required: ['type', 'function'],
        properties: {
          type: { type: 'string', enum: ['function'] },
          function: {
            type: 'object',
            required: ['name', 'description', 'parameters'],
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              parameters: { type: 'object' },
            },
          },
        },
      },
    },
  },
};

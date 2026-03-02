/**
 * Ollama/OpenAI-style tool definitions for AI chat.
 * The model uses these to request workspace data (metrics, orders, products, RTO, ads, etc.).
 */

export const AI_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_workspace_metrics',
      description:
        'Get daily and summary metrics for the workspace (net sales, orders, AOV, CM1, CM2, CM3, ad spend, ROAS, RTO, etc.) for a date range. Use for summaries like "last 30 days CM1" or "how is ROAS trending".',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive)' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD (inclusive)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_orders_summary',
      description:
        'Get summary of Shopify orders in a date range: total count, total revenue, AOV, and optionally recent orders. Use when the user asks about orders, revenue, or sales.',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD' },
          limit: { type: 'number', description: 'Max recent orders to return (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_top_products',
      description:
        'Get top products by revenue (from Shopify line items) in a date range. Use when the user asks about best-selling products, top products, or product performance.',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD' },
          limit: { type: 'number', description: 'Max number of products to return (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_rto_summary',
      description:
        'Get RTO (return-to-origin / failed delivery) summary from Shiprocket for a date range: shipment counts, RTO count, RTO value, RTO percentage. Use when the user asks about RTO, returns, or delivery issues.',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_misc_expenses',
      description:
        'Get workspace misc expenses (recurring costs like rent, salaries). Optionally filter by date range for effective expenses. Use when the user asks about misc expenses or overhead.',
      parameters: {
        type: 'object' as const,
        required: [],
        properties: {
          from_date: { type: 'string', description: 'Optional start date YYYY-MM-DD to filter by effective start' },
          to_date: { type: 'string', description: 'Optional end date YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_workspace_costs',
      description:
        'Get workspace cost configuration (shipping, packaging, website, custom costs) with effective dates. Use when the user asks about cost structure or how costs are configured.',
      parameters: {
        type: 'object' as const,
        required: [],
        properties: {
          from_date: { type: 'string', description: 'Optional date YYYY-MM-DD to get costs effective on that date' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_ads_breakdown',
      description:
        'Get Meta and Google ads daily spend and totals for a date range. Use when the user asks about ad spend by channel, Meta vs Google, or advertising breakdown.',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_customers_summary',
      description:
        'Get customer summary: top customers by total spent, total customer count, and order counts. Use when the user asks about customers, repeat buyers, or LTV.',
      parameters: {
        type: 'object' as const,
        required: [],
        properties: {
          limit: { type: 'number', description: 'Max top customers to return (default 10)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_shopify_analytics_daily',
      description:
        'Get Shopify analytics by day (net sales, orders, AOV, sessions, conversion rate) for a date range. Use when the user asks about traffic, sessions, or conversion rate over time.',
      parameters: {
        type: 'object' as const,
        required: ['from_date', 'to_date'],
        properties: {
          from_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          to_date: { type: 'string', description: 'End date YYYY-MM-DD' },
        },
      },
    },
  },
]

export type ToolName = (typeof AI_TOOLS)[number]['function']['name']

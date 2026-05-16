/**
 * Hand-written gRPC client wrapper for analytics-service MetricsService.
 *
 * Uses @grpc/proto-loader to load protos/analytics/metrics.proto at runtime —
 * no TS codegen, no build step. We hand-write the typed wrapper for the
 * subset of RPCs the proxy uses (currently just GetPnL). When more RPCs
 * land, add them here.
 */
import { credentials, loadPackageDefinition } from "@grpc/grpc-js";
import { loadSync } from "@grpc/proto-loader";
import path from "node:path";

const PROTO_PATH = path.join(
  process.cwd(),
  "..",
  "..",
  "protos",
  "analytics",
  "metrics.proto"
);

const packageDef = loadSync(PROTO_PATH, {
  keepCase: false, // emits camelCase JS field names (matches Looqus response)
  longs: Number,
  enums: Number,
  defaults: true,
  oneofs: true,
});

const grpcObj = loadPackageDefinition(packageDef) as unknown as {
  brain: { analytics: { v1: { MetricsService: any } } };
};

const MetricsService = grpcObj.brain.analytics.v1.MetricsService;

const ANALYTICS_GRPC_URL =
  process.env.ANALYTICS_GRPC_URL ?? "127.0.0.1:50051";

let _client: any | null = null;
function getClient() {
  if (_client === null) {
    _client = new MetricsService(
      ANALYTICS_GRPC_URL,
      credentials.createInsecure()
    );
  }
  return _client;
}

// Typed response shape mirrors the Looqus /pnl JSON.
export type PnLRow = {
  bucketKey: string;
  label: string;
  grossSales: number;
  discounts: number;
  sales: number;
  netSales: number;
  productGross: number;
  shippingGross: number;
  productDiscount: number;
  shippingDiscount: number;
  productNet: number;
  shippingNet: number;
  refunds: number;
  productRefunds: number;
  shippingRefunds: number;
  returnFees: number;
  revenue: number;
  ncNetRevenue: number;
  ecNetRevenue: number;
  netRevenue: number;
  cogs: number;
  variableCosts: number;
  shippingCosts: number;
  returnsCosts: number;
  paymentCosts: number;
  customsCosts: number;
  otherVariable: number;
  adSpend: number;
  metaAdSpend: number;
  googleAdSpend: number;
  contributionMargin1: number;
  contributionMargin2: number;
  contributionMargin3: number;
  fixedCosts: number;
  founderSalaryAllocated: number;
  netProfit: number;
  ordersCount: number;
};

export type PnLResponse = { rows: PnLRow[]; currency: string };

export type GetPnLRequest = {
  workspaceId: string;
  fromDate: string;
  toDate: string;
  granularity: 0 | 1 | 2 | 3 | 4; // matches proto Granularity
};

export function getPnL(req: GetPnLRequest): Promise<PnLResponse> {
  return new Promise((resolve, reject) => {
    getClient().GetPnL(
      req,
      (err: Error | null, resp: PnLResponse) => {
        if (err) reject(err);
        else resolve(resp);
      }
    );
  });
}

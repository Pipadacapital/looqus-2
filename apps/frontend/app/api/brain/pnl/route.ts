/**
 * Brain analytics-service proxy for /pnl.
 *
 * - Validates Supabase auth + workspace membership + featureGuard (same
 *   gates as the Looqus /api/workspaces/[slug]/pnl route).
 * - Forwards the request to analytics-service over gRPC.
 * - Returns the response as JSON in the same shape Looqus returns today.
 *
 * Behind the NEXT_PUBLIC_BRAIN_PNL_ENABLED env var (Task 14) — off in
 * production, on in dev/staging once parity is green.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/server";
import { prisma } from "@/lib/prisma";
import { featureGuard } from "@/lib/features";
import { getPnL } from "@/lib/brain/grpc-client";

// Force the Node.js runtime (gRPC client uses fs + Node net stack — won't
// run on the Edge runtime). Default is already nodejs in Next.js 14+, but
// being explicit prevents any future regression if a parent layout opts
// into edge.
export const runtime = "nodejs";

const QuerySchema = z.object({
  slug: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["day", "week", "month", "quarter"]).default("day"),
});

const GRANULARITY_TO_PROTO: Record<string, 1 | 2 | 3 | 4> = {
  day: 1,
  week: 2,
  month: 3,
  quarter: 4,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parse = QuerySchema.safeParse({
    slug: searchParams.get("slug") ?? "",
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    granularity: searchParams.get("granularity") ?? "day",
  });
  if (!parse.success) {
    return NextResponse.json(
      { error: "Invalid query params", rows: [], currency: "USD" },
      { status: 400 }
    );
  }
  const { slug, from, to, granularity } = parse.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const guard = featureGuard(workspace.features as any, "pnl");
  if (guard) return guard;

  try {
    const resp = await getPnL({
      workspaceId: workspace.id,
      fromDate: from,
      toDate: to,
      granularity: GRANULARITY_TO_PROTO[granularity],
    });
    return NextResponse.json(resp);
  } catch (err) {
    return NextResponse.json(
      { error: "analytics-service unavailable", rows: [], currency: "USD" },
      { status: 502 }
    );
  }
}

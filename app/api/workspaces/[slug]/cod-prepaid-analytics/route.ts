import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { featureGuard } from '@/lib/features'
import { getCodPrepaidAnalytics } from '@/lib/workspace-metrics'

function parseNum(val: string | null, defaultVal: number): number {
  if (val == null) return defaultVal
  const n = parseFloat(val)
  return Number.isFinite(n) ? n : defaultVal
}

/**
 * GET /api/workspaces/[slug]/cod-prepaid-analytics
 * COD vs Prepaid analytics: realization rate, RTO rates, effective revenue, break-even.
 * Query: from, to, codFeePerOrder (₹/order), returnShippingPerRto (₹). Defaults: 0, 0.
 * Gateway fee % is sourced from latest WEBSITE cost in workspace costs (fallback 2%).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await context.params
  const { searchParams } = new URL(request.url)
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const codFeeParam = searchParams.get('codFeePerOrder')
  const returnShippingParam = searchParams.get('returnShippingPerRto')

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      shiprocketConnection: { select: { id: true, status: true } },
    },
  })

  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const guard = featureGuard(workspace.features as any, 'cod_prepaid')
  if (guard) return guard

  const srConn = workspace.shiprocketConnection?.status === 'CONNECTED'
    ? workspace.shiprocketConnection
    : null

  const today = new Date()
  today.setUTCHours(23, 59, 59, 999)
  const defaultFrom = new Date(today)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 89)
  defaultFrom.setUTCHours(0, 0, 0, 0)
  const fromStr = typeof fromParam === 'string' ? fromParam : defaultFrom.toISOString().slice(0, 10)
  const toStr = typeof toParam === 'string' ? toParam : today.toISOString().slice(0, 10)
  const fromDate = new Date(fromStr + 'T00:00:00.000Z')
  const toDate = new Date(toStr + 'T23:59:59.999Z')

  const codFeePerOrder = Math.max(0, parseNum(codFeeParam, 0))
  const websiteCost = await prisma.workspaceCost.findFirst({
    where: {
      workspaceId: workspace.id,
      costType: 'WEBSITE',
    },
    orderBy: { effectiveFrom: 'desc' },
  })
  const gatewayFeePercent = Math.min(
    100,
    Math.max(0, websiteCost ? Number(websiteCost.amount) : 2)
  )
  const returnShippingPerRto = Math.max(0, parseNum(returnShippingParam, 0))

  if (!srConn) {
    return NextResponse.json({
      from: fromStr,
      to: toStr,
      connected: false,
      codOrders: 0,
      prepaidOrders: 0,
      codRealizationRatePercent: null,
      codRtoRatePercent: null,
      prepaidRtoRatePercent: null,
      effectiveRevenueCod: 0,
      effectiveRevenuePrepaid: 0,
      prepaidPremium: 0,
      breakEvenCodRtoRatePercent: null,
      breakEvenNote: null,
      comparisonTable: [],
      averageOrderValue: null,
    })
  }

  const result = await getCodPrepaidAnalytics(
    prisma,
    srConn.id,
    fromDate,
    toDate,
    { codFeePerOrder, gatewayFeePercent, returnShippingPerRto }
  )

  return NextResponse.json({
    ...result,
    connected: true,
    feesUsed: { codFeePerOrder, gatewayFeePercent, returnShippingPerRto },
  })
}

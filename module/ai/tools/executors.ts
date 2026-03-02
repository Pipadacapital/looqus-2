import type { PrismaClient } from '@prisma/client'
import { loadWorkspaceMetricsFromDb } from '../context/from-db'
import type { ToolName } from './definitions'

const toNum = (v: unknown): number => (v != null ? Number(v) : 0)
const fmt = (n: number, decimals = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: decimals })

function parseDate(s: string): Date {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`)
  return d
}

export async function executeTool(
  prisma: PrismaClient,
  workspaceId: string,
  name: ToolName,
  args: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case 'get_workspace_metrics': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const ctx = await loadWorkspaceMetricsFromDb(prisma, workspaceId, from, to)
      if (!ctx.summary && ctx.daily.length === 0) {
        return `No workspace daily metrics for ${ctx.period.from} to ${ctx.period.to}.`
      }
      const s = ctx.summary!
      const sym = s.currency === 'INR' ? '₹' : '$'
      const lines = [
        `Period: ${ctx.period.from} to ${ctx.period.to} (${ctx.period.days} days, ${ctx.daily.length} days with data).`,
        `Summary: Net sales ${sym}${fmt(s.totalNetSales)} | Orders ${s.totalOrders} | AOV ${sym}${fmt(s.avgAov, 2)}`,
        `CM1: ${sym}${fmt(s.cm1)} | CM2: ${sym}${fmt(s.cm2)} | CM3: ${sym}${fmt(s.cm3)}`,
        `Ad spend: ${sym}${fmt(s.totalAdSpend)} (Meta ${sym}${fmt(s.totalMetaAdSpend)}, Google ${sym}${fmt(s.totalGoogleAdSpend)})`,
        `Blended ROAS: ${s.blendedRoas != null ? s.blendedRoas.toFixed(2) + 'x' : 'N/A'} | ACOS: ${s.acos != null ? s.acos.toFixed(1) + '%' : 'N/A'}`,
        s.rtoOrders != null ? `RTO: ${s.rtoOrders} orders, ${s.rtoPercent != null ? s.rtoPercent.toFixed(1) : 'N/A'}% of shipments` : '',
      ]
      if (ctx.daily.length > 0 && ctx.daily.length <= 31) {
        lines.push('Daily (date, net sales, orders, CM1, CM2, CM3):')
        for (const d of ctx.daily) {
          lines.push(`${d.date}: ${sym}${fmt(d.netSales)} | ${d.ordersCount} orders | CM1 ${sym}${fmt(d.cm1)} | CM2 ${sym}${fmt(d.cm2)} | CM3 ${sym}${fmt(d.cm3)}`)
        }
      } else if (ctx.daily.length > 31) {
        lines.push(`Daily: ${ctx.daily.length} days of data (omitted for length). Use summary above.`)
      }
      return lines.filter(Boolean).join('\n')
    }

    case 'get_orders_summary': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const limit = Math.min(50, Math.max(1, Number(args.limit) ?? 10))
      const connIds = await prisma.shopifyConnection.findMany({ where: { workspaceId }, select: { id: true } }).then((r) => r.map((c) => c.id))
      if (connIds.length === 0) return 'No Shopify connection for this workspace.'
      const toEnd = new Date(to)
      toEnd.setUTCHours(23, 59, 59, 999)
      const orders = await prisma.shopifyOrder.findMany({
        where: { connectionId: { in: connIds }, processedAt: { gte: from, lte: toEnd }, cancelledAt: null },
        orderBy: { processedAt: 'desc' },
        take: limit,
        select: { orderNumber: true, totalPrice: true, processedAt: true, financialStatus: true },
      })
      const agg = await prisma.shopifyOrder.aggregate({
        where: { connectionId: { in: connIds }, processedAt: { gte: from, lte: toEnd }, cancelledAt: null },
        _count: { id: true },
        _sum: { totalPrice: true },
      })
      const count = agg._count.id
      const total = toNum(agg._sum.totalPrice)
      const aov = count > 0 ? total / count : 0
      const lines = [`Orders (${from.toISOString().slice(0, 10)} to ${to}): ${count} orders, total revenue ₹${fmt(total)}, AOV ₹${fmt(aov, 2)}.`]
      if (orders.length > 0) {
        lines.push(`Recent ${orders.length} orders:`)
        for (const o of orders) {
          lines.push(`  #${o.orderNumber} ${o.processedAt.toISOString().slice(0, 10)} ₹${fmt(toNum(o.totalPrice))} (${o.financialStatus})`)
        }
      }
      return lines.join('\n')
    }

    case 'get_top_products': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const limit = Math.min(30, Math.max(1, Number(args.limit) ?? 10))
      const connIds = await prisma.shopifyConnection.findMany({ where: { workspaceId }, select: { id: true } }).then((r) => r.map((c) => c.id))
      if (connIds.length === 0) return 'No Shopify connection for this workspace.'
      const toEnd = new Date(to)
      toEnd.setUTCHours(23, 59, 59, 999)
      const orderIds = await prisma.shopifyOrder.findMany({
        where: { connectionId: { in: connIds }, processedAt: { gte: from, lte: toEnd }, cancelledAt: null },
        select: { id: true },
      }).then((r) => r.map((o) => o.id))
      if (orderIds.length === 0) return `No orders in ${from.toISOString().slice(0, 10)} to ${to}.`
      const items = await prisma.shopifyLineItem.findMany({
        where: { orderId: { in: orderIds } },
        select: { title: true, quantity: true, price: true },
      })
      const byTitle: Record<string, { revenue: number; quantity: number }> = {}
      for (const i of items) {
        const rev = toNum(i.price) * i.quantity
        const key = i.title
        if (!byTitle[key]) byTitle[key] = { revenue: 0, quantity: 0 }
        byTitle[key].revenue += rev
        byTitle[key].quantity += i.quantity
      }
      const sorted = Object.entries(byTitle)
        .map(([title, d]) => ({ title, ...d }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, limit)
      const lines = [`Top ${sorted.length} products by revenue (${from.toISOString().slice(0, 10)} to ${to}):`]
      sorted.forEach((p, i) => {
        lines.push(`${i + 1}. ${p.title}: ₹${fmt(p.revenue)} (${p.quantity} units)`)
      })
      return lines.join('\n')
    }

    case 'get_rto_summary': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const conn = await prisma.shiprocketConnection.findUnique({ where: { workspaceId }, select: { id: true } })
      if (!conn) return 'No Shiprocket connection for this workspace.'
      const toEnd = new Date(to)
      toEnd.setUTCHours(23, 59, 59, 999)
      const shipments = await prisma.shiprocketShipment.findMany({
        where: {
          connectionId: conn.id,
          shiprocketCreatedAt: { gte: from, lte: toEnd },
        },
        select: { status: true, trackingStatus: true, codAmount: true, rtoInitiatedAt: true },
      })
      const total = shipments.length
      const rto = shipments.filter((s) => s.rtoInitiatedAt != null || (s.trackingStatus && String(s.trackingStatus).toLowerCase().includes('rto'))).length
      const rtoValue = shipments
        .filter((s) => s.rtoInitiatedAt != null || (s.trackingStatus && String(s.trackingStatus).toLowerCase().includes('rto')))
        .reduce((sum, s) => sum + toNum(s.codAmount), 0)
      const pct = total > 0 ? (rto / total) * 100 : 0
      return `RTO summary (${from.toISOString().slice(0, 10)} to ${to}): Total shipments ${total}, RTO ${rto} (${pct.toFixed(1)}%), RTO value ₹${fmt(rtoValue)}.`
    }

    case 'get_misc_expenses': {
      const fromArg = args.from_date as string | undefined
      const toArg = args.to_date as string | undefined
      const where: { workspaceId: string; effectiveStartDate?: { gte?: Date; lte?: Date } } = { workspaceId }
      if (fromArg) where.effectiveStartDate = { ...where.effectiveStartDate, gte: parseDate(fromArg) }
      if (toArg) where.effectiveStartDate = { ...where.effectiveStartDate, lte: parseDate(toArg) }
      const list = await prisma.workspaceMiscExpense.findMany({
        where,
        orderBy: { effectiveStartDate: 'desc' },
        take: 50,
        select: { name: true, amount: true, currency: true, effectiveStartDate: true },
      })
      if (list.length === 0) return 'No misc expenses found for this workspace.'
      const lines = ['Misc expenses:']
      list.forEach((e) => {
        const sym = e.currency === 'INR' ? '₹' : '$'
        lines.push(`  ${e.name}: ${sym}${fmt(Number(e.amount))} (from ${e.effectiveStartDate.toISOString().slice(0, 10)})`)
      })
      return lines.join('\n')
    }

    case 'get_workspace_costs': {
      const fromArg = args.from_date as string | undefined
      const list = await prisma.workspaceCost.findMany({
        where: {
          workspaceId,
          ...(fromArg && {
            effectiveFrom: { lte: parseDate(fromArg) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: parseDate(fromArg) } }],
          }),
        },
        orderBy: { effectiveFrom: 'desc' },
        take: 50,
        select: { costType: true, name: true, amount: true, isPercent: true, effectiveFrom: true, effectiveTo: true, currency: true },
      })
      if (list.length === 0) return 'No workspace costs configured.'
      const lines = ['Workspace costs:']
      list.forEach((c) => {
        const sym = c.currency === 'INR' ? '₹' : '$'
        const amt = c.isPercent ? `${Number(c.amount)}%` : `${sym}${fmt(Number(c.amount))}`
        lines.push(`  ${c.costType}${c.name ? ` (${c.name})` : ''}: ${amt} (${c.effectiveFrom.toISOString().slice(0, 10)} to ${c.effectiveTo ? c.effectiveTo.toISOString().slice(0, 10) : 'now'})`)
      })
      return lines.join('\n')
    }

    case 'get_ads_breakdown': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const toEnd = new Date(to)
      toEnd.setUTCHours(23, 59, 59, 999)
      const [metaConn, googleConn] = await Promise.all([
        prisma.meta_ads_connections.findUnique({ where: { workspace_id: workspaceId }, select: { id: true } }),
        prisma.google_ads_connections.findUnique({ where: { workspace_id: workspaceId }, select: { id: true } }),
      ])
      const lines: string[] = []
      if (metaConn) {
        const metaAgg = await prisma.meta_ads_daily_metrics.aggregate({
          where: { connection_id: metaConn.id, date: { gte: from, lte: toEnd } },
          _sum: { spend: true },
          _count: { id: true },
        })
        const metaSpend = toNum(metaAgg._sum.spend)
        lines.push(`Meta ads (${from.toISOString().slice(0, 10)} to ${to}): spend ₹${fmt(metaSpend)}, ${metaAgg._count.id} daily records.`)
      } else {
        lines.push('Meta ads: not connected.')
      }
      if (googleConn) {
        const googleAgg = await prisma.google_ads_daily_metrics.aggregate({
          where: { connection_id: googleConn.id, date: { gte: from, lte: toEnd } },
          _sum: { spend: true },
          _count: { id: true },
        })
        const googleSpend = toNum(googleAgg._sum.spend)
        lines.push(`Google ads (${from.toISOString().slice(0, 10)} to ${to}): spend ₹${fmt(googleSpend)}, ${googleAgg._count.id} daily records.`)
      } else {
        lines.push('Google ads: not connected.')
      }
      if (!metaConn && !googleConn) return 'No Meta or Google Ads connections for this workspace.'
      return lines.join('\n')
    }

    case 'get_customers_summary': {
      const limit = Math.min(20, Math.max(1, Number(args.limit) ?? 10))
      const connIds = await prisma.shopifyConnection.findMany({ where: { workspaceId }, select: { id: true } }).then((r) => r.map((c) => c.id))
      if (connIds.length === 0) return 'No Shopify connection for this workspace.'
      const [count, top] = await Promise.all([
        prisma.shopifyCustomer.count({ where: { connectionId: { in: connIds } } }),
        prisma.shopifyCustomer.findMany({
          where: { connectionId: { in: connIds } },
          orderBy: { totalSpent: 'desc' },
          take: limit,
          select: { email: true, firstName: true, lastName: true, ordersCount: true, totalSpent: true },
        }),
      ])
      const lines = [`Total customers: ${count}. Top ${top.length} by total spent:`]
      top.forEach((c, i) => {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '—'
        lines.push(`${i + 1}. ${name}: ${c.ordersCount} orders, ₹${fmt(Number(c.totalSpent))}`)
      })
      return lines.join('\n')
    }

    case 'get_shopify_analytics_daily': {
      const from = parseDate(String(args.from_date ?? ''))
      const to = parseDate(String(args.to_date ?? ''))
      const toEnd = new Date(to)
      toEnd.setUTCHours(23, 59, 59, 999)
      const connIds = await prisma.shopifyConnection.findMany({ where: { workspaceId }, select: { id: true } }).then((r) => r.map((c) => c.id))
      if (connIds.length === 0) return 'No Shopify connection for this workspace.'
      const rows = await prisma.shopifyAnalyticsDaily.findMany({
        where: { connectionId: { in: connIds }, date: { gte: from, lte: toEnd } },
        orderBy: { date: 'asc' },
      })
      if (rows.length === 0) return `No Shopify analytics daily data for ${from.toISOString().slice(0, 10)} to ${to}.`
      const totalNet = rows.reduce((s, r) => s + toNum(r.netSales), 0)
      const totalOrders = rows.reduce((s, r) => s + r.ordersCount, 0)
      const aov = totalOrders > 0 ? totalNet / totalOrders : 0
      const sessions = rows.reduce((s, r) => s + (r.sessions ?? 0), 0)
      const convRates = rows.filter((r) => r.conversionRate != null).map((r) => Number(r.conversionRate))
      const avgConv = convRates.length > 0 ? convRates.reduce((a, b) => a + b, 0) / convRates.length : null
      const lines = [
        `Shopify analytics (${from.toISOString().slice(0, 10)} to ${to}): ${rows.length} days.`,
        `Total net sales ₹${fmt(totalNet)} | Orders ${totalOrders} | AOV ₹${fmt(aov, 2)}`,
        sessions > 0 ? `Sessions ${sessions}` : '',
        avgConv != null ? `Avg conversion rate ${(avgConv * 100).toFixed(2)}%` : '',
      ]
      if (rows.length <= 14) {
        lines.push('Daily:')
        rows.forEach((r) => {
          lines.push(`  ${r.date.toISOString().slice(0, 10)}: ₹${fmt(Number(r.netSales))} | ${r.ordersCount} orders | AOV ₹${fmt(Number(r.aov), 2)}${r.sessions != null ? ` | ${r.sessions} sessions` : ''}`)
        })
      }
      return lines.filter(Boolean).join('\n')
    }

    default:
      return `Unknown tool: ${name}`
  }
}

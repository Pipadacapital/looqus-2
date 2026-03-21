/**
 * Populate workspace_daily_metrics from live calculations (same logic as analytics).
 * Run with: npx tsx scripts/populate-workspace-daily-metrics.ts [--days=90] [--from=YYYY-MM-DD --to=YYYY-MM-DD]
 * Requires DATABASE_URL (and DIRECT_URL if using Prisma migrate) in .env.
 */
import 'dotenv/config'
import { eachDayOfInterval, subDays } from 'date-fns'
import { prisma } from '../lib/prisma'
import { computeWorkspaceDayMetrics, type WorkspaceForMetrics } from '../lib/workspace-metrics'

const DEFAULT_DAYS = 90

function parseArgs(): { from: Date; to: Date } {
  const args = process.argv.slice(2)
  const fromArg = args.find((a) => a.startsWith('--from='))?.split('=')[1]
  const toArg = args.find((a) => a.startsWith('--to='))?.split('=')[1]
  const daysArg = args.find((a) => a.startsWith('--days='))?.split('=')[1]

  if (fromArg && toArg) {
    const from = new Date(`${fromArg}T00:00:00.000Z`)
    const to = new Date(`${toArg}T23:59:59.999Z`)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      console.error('Invalid --from or --to. Use YYYY-MM-DD.')
      process.exit(1)
    }
    return { from, to }
  }

  const days = Math.min(365, Math.max(1, daysArg ? parseInt(daysArg, 10) : DEFAULT_DAYS))
  if (Number.isNaN(days)) {
    console.error('Invalid --days. Use a number.')
    process.exit(1)
  }
  const to = new Date()
  to.setUTCHours(23, 59, 59, 999)
  const from = subDays(to, days - 1)
  from.setUTCHours(0, 0, 0, 0)
  return { from, to }
}

async function main() {
  const { from, to } = parseArgs()
  const fromStr = from.toISOString().slice(0, 10)
  const toStr = to.toISOString().slice(0, 10)
  const dates = eachDayOfInterval({ start: from, end: to })

  console.log('[populate-workspace-daily-metrics] From', fromStr, 'to', toStr, '|', dates.length, 'days')

  const workspaces = await prisma.workspace.findMany({
    where: {
      shopifyConnections: {
        some: { status: 'CONNECTED' },
      },
    },
    select: {
      id: true,
      name: true,
      slug: true,
      shopifyConnections: {
        where: { status: 'CONNECTED' },
        take: 1,
        select: { id: true },
      },
      meta_ads_connections: {
        select: {
          id: true,
          selected_ad_account_ids: true,
          selected_ad_account_id: true,
        },
      },
      google_ads_connections: {
        select: {
          id: true,
          selected_customer_ids: true,
          selected_customer_id: true,
        },
      },
      shiprocketConnection: {
        select: { id: true, status: true },
      },
      cogsSettings: {
        select: {
          overrideAllCogsPercent: true,
          fallbackCogsPercent: true,
          cogsMarkupPercent: true,
        },
      },
      skipped_shopify_order_tags: true,
      skip_zero_sales_orders: true,
    },
  })

  if (workspaces.length === 0) {
    console.log('[populate-workspace-daily-metrics] No workspaces with connected Shopify. Exiting.')
    await prisma.$disconnect()
    return
  }

  console.log('[populate-workspace-daily-metrics] Workspaces:', workspaces.length)

  let upserted = 0
  let errors = 0

  for (const ws of workspaces) {
    const workspace: WorkspaceForMetrics = {
      id: ws.id,
      shopifyConnections: ws.shopifyConnections,
      cogsSettings: ws.cogsSettings ?? undefined,
      meta_ads_connections: ws.meta_ads_connections,
      google_ads_connections: ws.google_ads_connections,
      shiprocketConnection: ws.shiprocketConnection,
      skippedShopifyOrderTags: ws.skipped_shopify_order_tags ?? undefined,
      skipZeroSalesOrders: ws.skip_zero_sales_orders ?? undefined,
    }

    for (const date of dates) {
      try {
        const row = await computeWorkspaceDayMetrics(prisma, workspace, date)
        if (!row) continue

        await prisma.workspaceDailyMetrics.upsert({
          where: {
            workspaceId_date: { workspaceId: ws.id, date: row.date },
          },
          create: {
            workspaceId: row.workspaceId,
            date: row.date,
            netSales: row.netSales,
            grossSales: row.grossSales,
            totalTax: row.totalTax,
            totalDiscount: row.totalDiscount,
            ordersCount: row.ordersCount,
            aov: row.aov,
            currency: row.currency,
            cogs: row.cogs,
            shipping: row.shipping,
            packaging: row.packaging,
            websiteCharges: row.websiteCharges,
            cm1: row.cm1,
            metaAdSpend: row.metaAdSpend,
            googleAdSpend: row.googleAdSpend,
            totalAdSpend: row.totalAdSpend,
            cm2: row.cm2,
            miscExpensesProrated: row.miscExpensesProrated,
            cm3: row.cm3,
            acos: row.acos,
            blendedRoas: row.blendedRoas,
            sessions: row.sessions,
            conversionRate: row.conversionRate,
            rtoOrders: row.rtoOrders,
            rtoValue: row.rtoValue,
            rtoPercent: row.rtoPercent,
            rtoMapped: row.rtoMapped,
            rtoUnmapped: row.rtoUnmapped,
            totalShipments: row.totalShipments,
            prepaidOrdersCount: row.prepaidOrdersCount,
            prepaidPercentage: row.prepaidPercentage,
          },
          update: {
            netSales: row.netSales,
            grossSales: row.grossSales,
            totalTax: row.totalTax,
            totalDiscount: row.totalDiscount,
            ordersCount: row.ordersCount,
            aov: row.aov,
            currency: row.currency,
            cogs: row.cogs,
            shipping: row.shipping,
            packaging: row.packaging,
            websiteCharges: row.websiteCharges,
            cm1: row.cm1,
            metaAdSpend: row.metaAdSpend,
            googleAdSpend: row.googleAdSpend,
            totalAdSpend: row.totalAdSpend,
            cm2: row.cm2,
            miscExpensesProrated: row.miscExpensesProrated,
            cm3: row.cm3,
            acos: row.acos,
            blendedRoas: row.blendedRoas,
            sessions: row.sessions,
            conversionRate: row.conversionRate,
            rtoOrders: row.rtoOrders,
            rtoValue: row.rtoValue,
            rtoPercent: row.rtoPercent,
            rtoMapped: row.rtoMapped,
            rtoUnmapped: row.rtoUnmapped,
            totalShipments: row.totalShipments,
            prepaidOrdersCount: row.prepaidOrdersCount,
            prepaidPercentage: row.prepaidPercentage,
          },
        })
        upserted++
      } catch (e) {
        errors++
        console.error(
          `[populate-workspace-daily-metrics] Error ${ws.slug} ${date.toISOString().slice(0, 10)}:`,
          e instanceof Error ? e.message : e
        )
      }
    }
  }

  console.log('[populate-workspace-daily-metrics] Done. Upserted:', upserted, '| Errors:', errors)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('[populate-workspace-daily-metrics] Fatal:', e)
  process.exit(1)
})

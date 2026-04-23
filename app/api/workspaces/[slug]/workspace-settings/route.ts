import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { hasRole, type WorkspaceRole } from '@/lib/features'
import { z } from 'zod'

const updateWorkspaceSettingsSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine(isValidTimeZone, 'Invalid timezone')
    .optional(),
  taxPercent: z.coerce.number().min(0).max(100).optional(),
  skippedShopifyOrderTags: z.array(z.string()).optional(),
  skipZeroSalesOrders: z.boolean().optional(),
})

function isValidTimeZone(value: string) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

async function getWorkspaceAndMembership(slug: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: { where: { userId } },
    },
  })

  if (!workspace || workspace.members.length === 0) return null
  return workspace
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await getWorkspaceAndMembership(slug, user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const skippedTags = workspace.skipped_shopify_order_tags ?? []
  const skipZero = workspace.skip_zero_sales_orders ?? false
  return NextResponse.json({
    timezone: workspace.timezone,
    taxPercent: Number(workspace.taxPercent),
    skippedShopifyOrderTags: skippedTags,
    skipZeroSalesOrders: skipZero,
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspace = await getWorkspaceAndMembership(slug, user.id)
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const role = workspace.members[0].role as WorkspaceRole
  if (!hasRole(role, 'ADMIN')) {
    return NextResponse.json(
      { error: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  try {
    const json = await request.json()
    const body = updateWorkspaceSettingsSchema.parse(json)

    const data: Parameters<typeof prisma.workspace.update>[0]['data'] = {}
    if (body.timezone !== undefined) data.timezone = body.timezone
    if (body.taxPercent !== undefined) data.taxPercent = body.taxPercent
    if (body.skippedShopifyOrderTags !== undefined) {
      data.skipped_shopify_order_tags = body.skippedShopifyOrderTags
    }
    if (body.skipZeroSalesOrders !== undefined) {
      data.skip_zero_sales_orders = body.skipZeroSalesOrders
    }

    const updatedWorkspace = await prisma.workspace.update({
      where: { id: workspace.id },
      data,
    })

    const skippedTags = updatedWorkspace.skipped_shopify_order_tags ?? []
    const skipZero = updatedWorkspace.skip_zero_sales_orders ?? false
    return NextResponse.json({
      timezone: updatedWorkspace.timezone,
      taxPercent: Number(updatedWorkspace.taxPercent),
      skippedShopifyOrderTags: skippedTags,
      skipZeroSalesOrders: skipZero,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

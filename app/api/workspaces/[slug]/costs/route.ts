import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { WorkspaceCostType } from '@prisma/client'
import { z } from 'zod'

const createCostSchema = z.object({
  costType: z.nativeEnum(WorkspaceCostType),
  name: z.string().optional(),
  amount: z.number(),
  effectiveFrom: z.string().transform((str) => new Date(str)),
  effectiveTo: z.string().optional().transform((str) => str ? new Date(str) : null),
  currency: z.string().default('USD'),
})

export async function GET(
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

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId: user.id },
      },
    },
  })

  if (!workspace || workspace.members.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const costs = await prisma.workspaceCost.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { effectiveFrom: 'desc' },
  })

  return NextResponse.json({ costs })
}

export async function POST(
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

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: {
        where: { userId: user.id },
      },
    },
  })

  if (!workspace || workspace.members.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Only owners and admins can manage costs
  const role = workspace.members[0].role
  if (role !== 'OWNER' && role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const body = createCostSchema.parse(json)

    // Close previous active cost of the same type (and name if custom)
    const previousCost = await prisma.workspaceCost.findFirst({
      where: {
        workspaceId: workspace.id,
        costType: body.costType,
        name: body.costType === 'CUSTOM' ? body.name : undefined,
        effectiveTo: null,
      },
      orderBy: { effectiveFrom: 'desc' },
    })

    if (previousCost) {
      await prisma.workspaceCost.update({
        where: { id: previousCost.id },
        data: { effectiveTo: body.effectiveFrom },
      })
    }

    const cost = await prisma.workspaceCost.create({
      data: {
        workspaceId: workspace.id,
        costType: body.costType,
        name: body.name,
        amount: body.amount,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        currency: body.currency,
      },
    })

    return NextResponse.json({ cost })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

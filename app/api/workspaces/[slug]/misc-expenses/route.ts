export const runtime = 'nodejs'

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

async function getWorkspaceAndRole(slug: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: { members: { where: { userId: user.id } } },
  })

  if (!workspace || workspace.members.length === 0) {
    return { error: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  }

  return { workspace, role: workspace.members[0].role }
}

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  amount: z.number().min(0),
  currency: z.string().default('INR'),
  effectiveStartDate: z.string().transform((s) => new Date(s)),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  amount: z.number().min(0).optional(),
  currency: z.string().optional(),
  effectiveStartDate: z.string().transform((s) => new Date(s)).optional(),
})

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  const expenses = await prisma.workspaceMiscExpense.findMany({
    where: { workspaceId: result.workspace.id },
    orderBy: { effectiveStartDate: 'desc' },
  })

  return NextResponse.json({ expenses })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  if (result.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only owners can manage misc expenses.' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const body = createSchema.parse(json)

    const expense = await prisma.workspaceMiscExpense.create({
      data: {
        workspaceId: result.workspace.id,
        name: body.name,
        amount: body.amount,
        currency: body.currency,
        effectiveStartDate: body.effectiveStartDate,
      },
    })

    return NextResponse.json({ expense })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  if (result.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only owners can manage misc expenses.' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const body = updateSchema.parse(json)

    const existing = await prisma.workspaceMiscExpense.findFirst({
      where: { id: body.id, workspaceId: result.workspace.id },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Expense not found' }, { status: 404 })
    }

    const expense = await prisma.workspaceMiscExpense.update({
      where: { id: body.id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.amount !== undefined && { amount: body.amount }),
        ...(body.currency !== undefined && { currency: body.currency }),
        ...(body.effectiveStartDate !== undefined && { effectiveStartDate: body.effectiveStartDate }),
      },
    })

    return NextResponse.json({ expense })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  if (result.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only owners can manage misc expenses.' }, { status: 403 })
  }

  const { id } = (await request.json()) as { id: string }
  if (!id) {
    return NextResponse.json({ error: 'Missing expense id' }, { status: 400 })
  }

  await prisma.workspaceMiscExpense.deleteMany({
    where: { id, workspaceId: result.workspace.id },
  })

  return NextResponse.json({ success: true })
}

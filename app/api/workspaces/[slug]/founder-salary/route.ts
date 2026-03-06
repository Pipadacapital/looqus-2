import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateSchema = z.object({
  monthlyAmount: z.number().min(0),
  currency: z.string().length(3).default('INR'),
})

async function getWorkspaceAndRole(slug: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) as const }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: { members: { where: { userId: user.id } } },
  })

  if (!workspace || workspace.members.length === 0) {
    return { error: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) as const }
  }

  return { workspace, role: workspace.members[0].role } as const
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  const monthly = result.workspace.founderSalaryMonthly
  const currency = result.workspace.founderSalaryCurrency

  return NextResponse.json({
    monthlyAmount: monthly != null ? Number(monthly) : null,
    currency: currency ?? 'INR',
  })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  const result = await getWorkspaceAndRole(slug)
  if ('error' in result) return result.error

  if (result.role !== 'OWNER') {
    return NextResponse.json({ error: 'Only owners can edit founder salary.' }, { status: 403 })
  }

  try {
    const json = await request.json()
    const body = updateSchema.parse(json)

    await prisma.workspace.update({
      where: { id: result.workspace.id },
      data: {
        founderSalaryMonthly: body.monthlyAmount,
        founderSalaryCurrency: body.currency,
      },
    })

    return NextResponse.json({
      monthlyAmount: body.monthlyAmount,
      currency: body.currency,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

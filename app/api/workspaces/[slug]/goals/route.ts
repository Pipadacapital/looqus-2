import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { hasRole, type WorkspaceRole } from '@/lib/features'
import { goalPeriodAnchor } from '@/lib/metrics/goals'
import { GOAL_METRIC_IDS, isGoalMetricId } from '@/lib/metrics/goal-metrics-registry'
import type { WorkspaceGoalPeriodType, WorkspaceGoalValueType } from '@prisma/client'

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const goals = await prisma.workspaceMetricGoal.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ periodStart: 'desc' }, { metricName: 'asc' }],
  })

  return NextResponse.json({
    goals: goals.map((g) => ({
      id: g.id,
      metricName: g.metricName,
      periodType: g.periodType,
      periodStart: g.periodStart.toISOString().slice(0, 10),
      goalValue: Number(g.goalValue),
      goalType: g.goalType,
      updatedAt: g.updatedAt.toISOString(),
    })),
    metricIds: [...GOAL_METRIC_IDS],
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!hasRole(membership.role as WorkspaceRole, 'ADMIN')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  if (!hasRole(membership.role as WorkspaceRole, 'ADMIN')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: {
    metricName?: string
    periodType?: WorkspaceGoalPeriodType
    periodStart?: string
    goalValue?: number
    goalType?: WorkspaceGoalValueType
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { metricName, periodType, periodStart, goalValue, goalType } = body
  if (
    !metricName ||
    !periodType ||
    !periodStart ||
    typeof goalValue !== 'number' ||
    !goalType ||
    !['DAILY', 'WEEKLY', 'MONTHLY'].includes(periodType) ||
    !['MINIMUM', 'MAXIMUM', 'TARGET'].includes(goalType)
  ) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!isGoalMetricId(metricName)) {
    return NextResponse.json({ error: 'Unknown metric' }, { status: 400 })
  }

  const ref = new Date(`${periodStart.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(ref.getTime())) {
    return NextResponse.json({ error: 'Invalid periodStart' }, { status: 400 })
  }
  const normalizedStart = goalPeriodAnchor(periodType, ref)

  const row = await prisma.workspaceMetricGoal.upsert({
    where: {
      workspaceId_metricName_periodType_periodStart: {
        workspaceId: workspace.id,
        metricName,
        periodType,
        periodStart: normalizedStart,
      },
    },
    create: {
      workspaceId: workspace.id,
      metricName,
      periodType,
      periodStart: normalizedStart,
      goalValue,
      goalType,
    },
    update: {
      goalValue,
      goalType,
    },
  })

  return NextResponse.json({
    goal: {
      id: row.id,
      metricName: row.metricName,
      periodType: row.periodType,
      periodStart: row.periodStart.toISOString().slice(0, 10),
      goalValue: Number(row.goalValue),
      goalType: row.goalType,
    },
  })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id },
    },
  })
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const existing = await prisma.workspaceMetricGoal.findFirst({
    where: { id, workspaceId: workspace.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.workspaceMetricGoal.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

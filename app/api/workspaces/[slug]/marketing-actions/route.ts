import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  isMarketingActionType,
  MARKETING_ACTION_TYPES,
} from '@/lib/metrics/calendar-report'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { slug } = await context.params
  const from = new URL(request.url).searchParams.get('from')
  const to = new URL(request.url).searchParams.get('to')

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

  const where: { workspaceId: string; actionDate?: { gte: Date; lte: Date } } = {
    workspaceId: workspace.id,
  }
  if (from && to) {
    where.actionDate = {
      gte: new Date(from + 'T00:00:00.000Z'),
      lte: new Date(to + 'T23:59:59.999Z'),
    }
  }

  const actions = await prisma.marketingAction.findMany({
    where,
    orderBy: [{ actionDate: 'desc' }, { createdAt: 'desc' }],
  })

  return NextResponse.json({
    actions: actions.map((a) => ({
      id: a.id,
      actionDate: a.actionDate.toISOString().slice(0, 10),
      actionType: a.actionType,
      actionName: a.actionName,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    actionTypes: [...MARKETING_ACTION_TYPES],
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

  let body: {
    actionDate?: string
    actionType?: string
    actionName?: string
    notes?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { actionDate, actionType, actionName, notes } = body
  if (!actionDate || !actionType || !actionName?.trim()) {
    return NextResponse.json({ error: 'actionDate, actionType, actionName required' }, { status: 400 })
  }
  if (!isMarketingActionType(actionType)) {
    return NextResponse.json({ error: 'Invalid actionType' }, { status: 400 })
  }

  const d = new Date(actionDate.slice(0, 10) + 'T12:00:00.000Z')
  if (Number.isNaN(d.getTime())) {
    return NextResponse.json({ error: 'Invalid actionDate' }, { status: 400 })
  }

  const row = await prisma.marketingAction.create({
    data: {
      workspaceId: workspace.id,
      actionDate: new Date(actionDate.slice(0, 10) + 'T00:00:00.000Z'),
      actionType,
      actionName: actionName.trim().slice(0, 256),
      notes: notes?.trim() || null,
      createdById: user.id,
    },
  })

  return NextResponse.json({
    action: {
      id: row.id,
      actionDate: row.actionDate.toISOString().slice(0, 10),
      actionType: row.actionType,
      actionName: row.actionName,
      notes: row.notes,
    },
  })
}

export async function PATCH(
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

  const existing = await prisma.marketingAction.findFirst({
    where: { id, workspaceId: workspace.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: {
    actionDate?: string
    actionType?: string
    actionName?: string
    notes?: string | null
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const data: {
    actionDate?: Date
    actionType?: string
    actionName?: string
    notes?: string | null
  } = {}
  if (body.actionDate != null) {
    const d = new Date(body.actionDate.slice(0, 10) + 'T00:00:00.000Z')
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    data.actionDate = d
  }
  if (body.actionType != null) {
    if (!isMarketingActionType(body.actionType)) {
      return NextResponse.json({ error: 'Invalid actionType' }, { status: 400 })
    }
    data.actionType = body.actionType
  }
  if (body.actionName != null) data.actionName = body.actionName.trim().slice(0, 256)
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null

  const row = await prisma.marketingAction.update({
    where: { id },
    data,
  })

  return NextResponse.json({
    action: {
      id: row.id,
      actionDate: row.actionDate.toISOString().slice(0, 10),
      actionType: row.actionType,
      actionName: row.actionName,
      notes: row.notes,
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

  const existing = await prisma.marketingAction.findFirst({
    where: { id, workspaceId: workspace.id },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.marketingAction.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}

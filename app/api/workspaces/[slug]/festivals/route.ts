import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { seedFestivalsForWorkspace } from '@/lib/festivals/seed-festivals'

async function getWorkspaceAndMembership(slug: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  if (!workspace) return { error: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }) }
  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: workspace.id },
    },
    select: { role: true },
  })
  if (!membership) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { workspace }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug } = await context.params
  const gate = await getWorkspaceAndMembership(slug, user.id)
  if ('error' in gate) return gate.error

  const yearParam = request.nextUrl.searchParams.get('year')
  const where: { workspaceId: string; startDate?: { gte: Date; lt: Date } } = {
    workspaceId: gate.workspace.id,
  }
  if (yearParam) {
    const y = Number(yearParam)
    if (Number.isFinite(y)) {
      where.startDate = {
        gte: new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0)),
        lt: new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0, 0)),
      }
    }
  }

  const festivals = await prisma.workspaceFestival.findMany({
    where,
    orderBy: { startDate: 'asc' },
  })
  return NextResponse.json({ festivals })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug } = await context.params
  const gate = await getWorkspaceAndMembership(slug, user.id)
  if ('error' in gate) return gate.error

  const body = await request.json().catch(() => null)
  if (body?.resetDefaults === true) {
    await seedFestivalsForWorkspace(prisma, gate.workspace.id)
    return NextResponse.json({ success: true })
  }
  if (!body?.name || !body?.startDate || !body?.endDate) {
    return NextResponse.json({ error: 'name, startDate and endDate are required' }, { status: 400 })
  }

  const festival = await prisma.workspaceFestival.create({
    data: {
      workspaceId: gate.workspace.id,
      name: String(body.name),
      startDate: new Date(String(body.startDate)),
      endDate: new Date(String(body.endDate)),
      color: body.color ? String(body.color) : '#F59E0B',
      expectedMultiplier: body.expectedMultiplier != null ? Number(body.expectedMultiplier) : 1.5,
      regions: Array.isArray(body.regions) ? body.regions.map(String) : [],
      categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
      isTemplate: false,
      isActive: true,
    },
  })

  return NextResponse.json({ festival })
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug } = await context.params
  const gate = await getWorkspaceAndMembership(slug, user.id)
  if ('error' in gate) return gate.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const existing = await prisma.workspaceFestival.findFirst({
    where: { id, workspaceId: gate.workspace.id },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Festival not found' }, { status: 404 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const allowed = new Set(['name', 'startDate', 'endDate', 'color', 'expectedMultiplier', 'regions', 'categories', 'isActive'])
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (!allowed.has(k)) continue
    if (k === 'startDate' || k === 'endDate') data[k] = new Date(String(v))
    else if (k === 'expectedMultiplier') data[k] = Number(v)
    else if (k === 'regions' || k === 'categories') data[k] = Array.isArray(v) ? v.map(String) : []
    else data[k] = v
  }

  const festival = await prisma.workspaceFestival.update({
    where: { id },
    data,
  })
  return NextResponse.json({ festival })
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { slug } = await context.params
  const gate = await getWorkspaceAndMembership(slug, user.id)
  if ('error' in gate) return gate.error

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const f = await prisma.workspaceFestival.findFirst({
    where: { id, workspaceId: gate.workspace.id },
    select: { isTemplate: true },
  })
  if (!f) return NextResponse.json({ error: 'Festival not found' }, { status: 404 })
  if (f.isTemplate) {
    return NextResponse.json(
      { error: 'Template festivals cannot be deleted — deactivate them instead' },
      { status: 403 }
    )
  }
  await prisma.workspaceFestival.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

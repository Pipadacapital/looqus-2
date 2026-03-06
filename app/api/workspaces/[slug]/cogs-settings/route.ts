import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateCogsSettingsSchema = z.object({
  overrideAllCogsPercent: z.coerce.number().min(0).max(100),
  fallbackCogsPercent: z.coerce.number().min(0).max(100),
  cogsMarkupPercent: z.coerce.number().min(0).max(100),
})

async function getWorkspaceAndMembership(slug: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: { where: { userId } },
      cogsSettings: true,
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

  const settings = workspace.cogsSettings
  return NextResponse.json({
    overrideAllCogsPercent: settings ? Number(settings.overrideAllCogsPercent) : 0,
    fallbackCogsPercent: settings ? Number(settings.fallbackCogsPercent) : 0,
    cogsMarkupPercent: settings ? Number(settings.cogsMarkupPercent) : 0,
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

  const role = workspace.members[0].role
  if (role !== 'OWNER') {
    return NextResponse.json(
      { error: 'Only workspace owners can update COGS settings.' },
      { status: 403 }
    )
  }

  try {
    const json = await request.json()
    const body = updateCogsSettingsSchema.parse(json)

    const settings = await prisma.workspaceCogsSettings.upsert({
      where: { workspaceId: workspace.id },
      create: {
        workspaceId: workspace.id,
        overrideAllCogsPercent: body.overrideAllCogsPercent,
        fallbackCogsPercent: body.fallbackCogsPercent,
        cogsMarkupPercent: body.cogsMarkupPercent,
      },
      update: {
        overrideAllCogsPercent: body.overrideAllCogsPercent,
        fallbackCogsPercent: body.fallbackCogsPercent,
        cogsMarkupPercent: body.cogsMarkupPercent,
      },
    })

    return NextResponse.json({
      overrideAllCogsPercent: Number(settings.overrideAllCogsPercent),
      fallbackCogsPercent: Number(settings.fallbackCogsPercent),
      cogsMarkupPercent: Number(settings.cogsMarkupPercent),
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

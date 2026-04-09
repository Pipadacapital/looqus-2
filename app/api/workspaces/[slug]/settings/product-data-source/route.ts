import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

const patchSchema = z.object({
  productDataSource: z.enum(['SHOPIFY', 'UNICOMMERCE']),
})

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

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    include: {
      members: { where: { userId: user.id } },
      unicommerceConnection: {
        select: { id: true, status: true },
      },
    },
  })

  if (!workspace || workspace.members.length === 0) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  const role = workspace.members[0].role
  if (!['OWNER', 'ADMIN'].includes(role)) {
    return NextResponse.json(
      { error: 'Only workspace owner/admin can update product data source.' },
      { status: 403 }
    )
  }

  try {
    const json = await request.json()
    const body = patchSchema.parse(json)

    if (
      body.productDataSource === 'UNICOMMERCE' &&
      (!workspace.unicommerceConnection ||
        workspace.unicommerceConnection.status !== 'CONNECTED')
    ) {
      return NextResponse.json(
        { error: 'Connect Unicommerce first before switching data source.' },
        { status: 400 }
      )
    }

    const updated = await prisma.workspace.update({
      where: { id: workspace.id },
      data: { productDataSource: body.productDataSource },
      select: { productDataSource: true },
    })

    return NextResponse.json({
      success: true,
      productDataSource: updated.productDataSource,
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

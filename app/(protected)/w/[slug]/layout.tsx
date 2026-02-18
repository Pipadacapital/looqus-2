import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import { WorkspaceProvider } from '@/hooks/use-workspace'
import { AppSidebar } from '@/components/app-sidebar'
import { SiteHeader } from '@/components/site-header'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import React from 'react'

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const workspace = await prisma.workspace.findUnique({
    where: { slug },
  })

  if (!workspace) {
    notFound()
  }

  const membership = await prisma.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
  })

  if (!membership) {
    notFound()
  }

  const allMemberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    include: {
      workspace: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          plan: true,
        },
      },
    },
    orderBy: { joinedAt: 'asc' },
  })

  const workspaceContextValue = {
    current: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      logoUrl: workspace.logoUrl,
      plan: workspace.plan,
    },
    role: membership.role,
    all: allMemberships.map((m) => ({
      role: m.role,
      workspace: {
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        logoUrl: m.workspace.logoUrl,
        plan: m.workspace.plan,
      },
    })),
  }

  return (
    <WorkspaceProvider value={workspaceContextValue}>
      <SidebarProvider
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <div className="flex flex-1 flex-col">
            <div className="@container/main p-4 flex flex-1 flex-col gap-2">
              {children}
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </WorkspaceProvider>
  )
}

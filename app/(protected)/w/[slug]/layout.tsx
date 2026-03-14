import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCachedUser, getCachedWorkspace } from '@/lib/server-cache'
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

  // getCachedUser() makes one remote Supabase call per request;
  // subsequent calls from page.tsx return the cached result instantly.
  const user = await getCachedUser()

  if (!user) {
    redirect('/auth/login')
  }

  // getCachedWorkspace() deduplicates the DB lookup across layout + page.
  const workspace = await getCachedWorkspace(slug)

  if (!workspace) {
    notFound()
  }

  // Fetch membership and all memberships in parallel — they're independent.
  const [membership, allMemberships] = await Promise.all([
    prisma.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id,
        },
      },
    }),
    prisma.workspaceMember.findMany({
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
    }),
  ])

  if (!membership) {
    notFound()
  }

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

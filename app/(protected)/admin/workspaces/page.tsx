import Link from 'next/link'
import { IconArrowLeft } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'

export default async function AdminWorkspacesPage() {
  const workspaces = await prisma.workspace.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      createdAt: true,
      _count: { select: { members: true, shopifyConnections: true } },
      google_ads_connections: { select: { id: true } },
      meta_ads_connections: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin">
              <IconArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">All workspaces</h1>
            <p className="text-sm text-muted-foreground">
              Every workspace in the system ({workspaces.length} total)
            </p>
          </div>
        </div>

        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Name</th>
                <th className="text-left p-3 font-medium">Slug</th>
                <th className="text-left p-3 font-medium">Plan</th>
                <th className="text-left p-3 font-medium">Members</th>
                <th className="text-left p-3 font-medium">Shopify</th>
                <th className="text-left p-3 font-medium">Google Ads</th>
                <th className="text-left p-3 font-medium">Meta Ads</th>
                <th className="text-left p-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id} className="border-b last:border-0">
                  <td className="p-3 font-medium">{w.name}</td>
                  <td className="p-3">
                    <Link
                      href={`/w/${w.slug}/dashboard`}
                      className="text-primary underline underline-offset-2"
                    >
                      {w.slug}
                    </Link>
                  </td>
                  <td className="p-3">{w.plan}</td>
                  <td className="p-3">{w._count.members}</td>
                  <td className="p-3">{w._count.shopifyConnections}</td>
                  <td className="p-3">{w.google_ads_connections ? 'Yes' : '—'}</td>
                  <td className="p-3">{w.meta_ads_connections ? 'Yes' : '—'}</td>
                  <td className="p-3 text-muted-foreground">
                    {new Date(w.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

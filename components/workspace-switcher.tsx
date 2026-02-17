'use client'

import { useRouter } from 'next/navigation'
import { IconSelector, IconCheck, IconPlus } from '@tabler/icons-react'
import { useWorkspace } from '@/hooks/use-workspace'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

export function WorkspaceSwitcher() {
  const { current, all } = useWorkspace()
  const { isMobile } = useSidebar()
  const router = useRouter()

  const switchWorkspace = (slug: string) => {
    router.push(`/w/${slug}/dashboard`)
  }

  const initials = current.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                {current.logoUrl ? (
                  <img
                    src={current.logoUrl}
                    alt={current.name}
                    className="size-8 rounded-lg object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{current.name}</span>
                <span className="truncate text-xs text-muted-foreground capitalize">
                  {current.plan.toLowerCase()} plan
                </span>
              </div>
              <IconSelector className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Workspaces
            </DropdownMenuLabel>
            {all.map((membership) => (
              <DropdownMenuItem
                key={membership.workspace.id}
                onClick={() => switchWorkspace(membership.workspace.slug)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground text-[10px] font-bold">
                  {membership.workspace.name
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2)}
                </div>
                <span className="flex-1 truncate">{membership.workspace.name}</span>
                {membership.workspace.id === current.id && (
                  <IconCheck className="size-4 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push('/onboarding')}
              className="gap-2 p-2"
            >
              <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                <IconPlus className="size-4" />
              </div>
              <span className="text-muted-foreground">Create workspace</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

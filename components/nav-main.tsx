"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { IconCirclePlusFilled, IconMail, type Icon } from "@tabler/icons-react"
import { useWorkspace } from "@/hooks/use-workspace"
import { cn } from "@/lib/utils"
import type { SidebarNavSection } from "@/constants/sidebar-menu"

import { Button } from "@/components/ui/button"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavMain({
  sections,
}: {
  sections: SidebarNavSection[]
}) {
  const { current } = useWorkspace()
  const pathname = usePathname()

  return (
    <>
      {sections.map((section, sectionIdx) => (
        <SidebarGroup key={section.title ?? sectionIdx}>
          {section.title ? (
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
          ) : null}
          <SidebarGroupContent className="flex flex-col gap-2">
            <SidebarMenu>
              {sectionIdx === 0 && (
                <SidebarMenuItem className="flex items-center gap-2">
                  <SidebarMenuButton
                    tooltip="Quick Create"
                    className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
                  >
                    <IconCirclePlusFilled />
                    <span>Quick Create</span>
                  </SidebarMenuButton>
                  <Button
                    size="icon"
                    className="size-8 group-data-[collapsible=icon]:opacity-0"
                    variant="outline"
                  >
                    <IconMail />
                    <span className="sr-only">Inbox</span>
                  </Button>
                </SidebarMenuItem>
              )}
              {section.items.map((item) => {
                const href = `/w/${current.slug}/${item.path}`
                const isActive = pathname === href
                return (
                  <SidebarMenuItem key={item.path}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      className={cn(isActive && "bg-accent text-accent-foreground")}
                    >
                      <Link href={href}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

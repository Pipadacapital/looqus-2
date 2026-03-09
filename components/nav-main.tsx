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

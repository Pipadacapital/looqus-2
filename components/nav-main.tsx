"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useWorkspace } from "@/hooks/use-workspace"
import { can, hasRole, isFeatureEnabled } from "@/lib/features"
import { cn } from "@/lib/utils"
import type { SidebarNavSection } from "@/constants/sidebar-menu"
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
      {sections.map((section, sectionIdx) => {
        if (section.title === 'Settings' && !can.viewSettings(current.userRole)) {
          return null
        }
        const visibleItems = section.items.filter((item) => {
          if (item.featureKey && !isFeatureEnabled(current.features, item.featureKey)) return false
          if (item.minRole && !hasRole(current.userRole, item.minRole)) return false
          return true
        })
        if (visibleItems.length === 0) return null
        return (
          <SidebarGroup key={section.title ?? sectionIdx}>
            {section.title ? (
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            ) : null}
            <SidebarGroupContent className="flex flex-col gap-2">
              <SidebarMenu>
                {visibleItems.map((item) => {
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
        )
      })}
    </>
  )
}

import {
  IconChartLine,
  IconClock,
  IconCurrencyDollar,
  IconDashboard,
  IconDatabase,
  IconFileWord,
  IconPlugConnected,
  IconReport,
  IconSettings,
  IconUsers,
  IconBuildingStore,
  IconBrandGoogle,
  IconBrandMeta,
  IconReceipt,
  IconTruck,
  IconBrain,
  IconPackage,
  IconShoppingBag,
  IconRefresh,
} from "@tabler/icons-react"

export type SidebarNavItem = {
  title: string
  path: string
  icon: typeof IconDashboard
}

export type SidebarNavSection = {
  /** Optional group heading (non-clickable) */
  title?: string
  items: SidebarNavItem[]
}

/** Main nav as sections: Dashboard, Data Points (group), main pages, Settings (group). */
export const sidebarNavSections: SidebarNavSection[] = [
  {
    items: [
      { title: "Dashboard", path: "dashboard", icon: IconDashboard },
    ],
  },
  {
    title: "Data Points",
    items: [
      { title: "Store", path: "store", icon: IconBuildingStore },
      { title: "Meta Ads", path: "meta-ads", icon: IconBrandMeta },
      { title: "Google Ads", path: "google-ads", icon: IconBrandGoogle },
      { title: "Shiprocket", path: "shiprocket", icon: IconTruck },
      { title: "Store Analytics", path: "analytics", icon: IconBuildingStore },
    ],
  },
  {
    items: [
      { title: "P&L", path: "pnl", icon: IconCurrencyDollar },
      { title: "Products", path: "products", icon: IconShoppingBag },
      { title: "Lifetime Value", path: "lifetime-value", icon: IconReport },
      { title: "Cohorts", path: "cohorts", icon: IconChartLine },
      { title: "Timing", path: "timings", icon: IconClock },
      { title: "Inventory", path: "inventory", icon: IconPackage },
      { title: "Costs", path: "settings/costs", icon: IconReceipt },
      { title: "AI", path: "ai-2", icon: IconBrain },
      { title: "Team", path: "team", icon: IconUsers },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "General", path: "settings", icon: IconSettings },
      { title: "Integrations", path: "settings/integrations", icon: IconPlugConnected },
      { title: "Backfill", path: "settings/ads-backfill", icon: IconRefresh },
    ],
  },
]

/** Flat list for any consumer that still expects navMain (e.g. active state). */
export const sidebarMenuData = {
  navMain: sidebarNavSections.flatMap((s) => s.items),
  navSecondary: [] as SidebarNavItem[],
  documents: [
    { name: "Data Library", path: "data-library", icon: IconDatabase },
    { name: "Reports", path: "reports", icon: IconReport },
    { name: "Word Assistant", path: "word-assistant", icon: IconFileWord },
  ],
}

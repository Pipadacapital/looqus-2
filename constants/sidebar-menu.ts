import {
  IconChartBar,
  IconChartLine,
  IconClock,
  IconCurrencyDollar,
  IconDashboard,
  IconDatabase,
  IconFileWord,
  IconHelp,
  IconRefresh,
  IconReport,
  IconSearch,
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
} from "@tabler/icons-react"

export const sidebarMenuData = {
  navMain: [
    {
      title: "Dashboard",
      path: "dashboard",
      icon: IconDashboard,
    },
    {
      title: "Store",
      path: "store",
      icon: IconBuildingStore,
    },
    {
      title: "Google Ads",
      path: "google-ads",
      icon: IconBrandGoogle,
    },
    {
      title: "Meta Ads",
      path: "meta-ads",
      icon: IconBrandMeta,
    },
    {
      title: "Analytics",
      path: "analytics",
      icon: IconChartBar,
    },
    {
      title: "P&L",
      path: "pnl",
      icon: IconCurrencyDollar,
    },
    {
      title: "Cohorts",
      path: "cohorts",
      icon: IconChartLine,
    },
    {
      title: "Lifetime Value",
      path: "lifetime-value",
      icon: IconReport,
    },
    {
      title: "Products",
      path: "products",
      icon: IconShoppingBag,
    },
    {
      title: "Timings",
      path: "timings",
      icon: IconClock,
    },
    {
      title: "Inventory",
      path: "inventory",
      icon: IconPackage,
    },
    {
      title: "AI",
      path: "ai-2",
      icon: IconBrain,
    },
    {
      title: "Shiprocket",
      path: "shiprocket",
      icon: IconTruck,
    },
    {
      title: "Costs",
      path: "settings/costs",
      icon: IconReceipt,
    },
    {
      title: "Team",
      path: "team",
      icon: IconUsers,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      path: "settings",
      icon: IconSettings,
    },
    {
      title: "Ads Backfill",
      path: "settings/ads-backfill",
      icon: IconRefresh,
    },

 
  ],
  documents: [
    {
      name: "Data Library",
      path: "data-library",
      icon: IconDatabase,
    },
    {
      name: "Reports",
      path: "reports",
      icon: IconReport,
    },
    {
      name: "Word Assistant",
      path: "word-assistant",
      icon: IconFileWord,
    },
  ],
}

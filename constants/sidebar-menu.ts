import {
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileWord,
  IconHelp,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
  IconBuildingStore,
  IconBrandGoogle,
  IconBrandMeta,
  IconReceipt,
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
      title: "Get Help",
      url: "#",
      icon: IconHelp,
    },
    {
      title: "Search",
      url: "#",
      icon: IconSearch,
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

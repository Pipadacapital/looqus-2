import {
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileWord,
  IconHelp,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react"

export const sidebarMenuData = {
  navMain: [
    {
      title: "Dashboard",
      path: "dashboard",
      icon: IconDashboard,
    },
    {
      title: "Lifecycle",
      path: "lifecycle",
      icon: IconListDetails,
    },
    {
      title: "Analytics",
      path: "analytics",
      icon: IconChartBar,
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

import {
  IconChartBar,
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
  IconSpeakerphone,
  IconActivity,
  IconRoute,
  IconTarget,
  IconCalendar,
  IconMail,
} from "@tabler/icons-react"
import type { FeatureKey, WorkspaceRole } from '@/lib/features'

export type SidebarNavItem = {
  title: string
  path: string
  icon: typeof IconDashboard
  featureKey?: FeatureKey
  minRole?: WorkspaceRole
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
      { title: "Meta Ads", path: "meta-ads", icon: IconBrandMeta, featureKey: 'meta_ads' },
      { title: "Google Ads", path: "google-ads", icon: IconBrandGoogle, featureKey: 'google_ads' },
      { title: "Shiprocket", path: "shiprocket", icon: IconTruck, featureKey: 'shiprocket' },
      { title: "Logistics", path: "logistics", icon: IconPackage, featureKey: 'logistics' },
      { title: "RTO Analytics", path: "rto-analytics", icon: IconReport, featureKey: 'rto_analytics' },
      { title: "COD vs Prepaid", path: "cod-prepaid", icon: IconCurrencyDollar, featureKey: 'cod_prepaid' },
      { title: "Pincode Intelligence", path: "pincode-intelligence", icon: IconRoute, featureKey: 'pincode_intelligence' },
      { title: "Store Analytics", path: "analytics", icon: IconBuildingStore, featureKey: 'store_analytics' },
    ],
  },
  {
    items: [
      { title: "P&L", path: "pnl", icon: IconCurrencyDollar, featureKey: 'pnl' },
      { title: "Waterfall", path: "waterfall", icon: IconChartBar, featureKey: 'waterfall' },
      { title: "Products", path: "products", icon: IconShoppingBag, featureKey: 'products' },
      { title: "First product cascade", path: "first-product-cascade", icon: IconRoute, featureKey: 'first_product_cascade' },
      { title: "Lifetime Value", path: "lifetime-value", icon: IconReport, featureKey: 'lifetime_value' },
      { title: "Cohorts", path: "cohorts", icon: IconChartLine, featureKey: 'cohorts' },
      { title: "Customer lifecycle", path: "customer-lifecycle", icon: IconActivity, featureKey: 'customer_lifecycle' },
      { title: "Acquisition", path: "acquisition", icon: IconSpeakerphone, featureKey: 'acquisition' },
      { title: "Calendar", path: "calendar", icon: IconCalendar, featureKey: 'calendar' },
      { title: "Email & SMS", path: "email-sms", icon: IconMail, featureKey: 'email_sms' },
      { title: "Distributions", path: "distributions", icon: IconChartBar, featureKey: 'distributions' },
      { title: "Timing", path: "timings", icon: IconClock, featureKey: 'timings' },
      { title: "Inventory", path: "inventory", icon: IconPackage, featureKey: 'inventory' },
      { title: "Costs", path: "settings/costs", icon: IconReceipt, minRole: 'ANALYST' },
      { title: "AI", path: "ai-2", icon: IconBrain, featureKey: 'ai' },
      { title: "Team", path: "team", icon: IconUsers, minRole: 'ANALYST' },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "General", path: "settings", icon: IconSettings, minRole: 'ANALYST' },
      { title: "Integrations", path: "settings/integrations", icon: IconPlugConnected, minRole: 'MANAGER' },
      { title: "Backfill", path: "settings/ads-backfill", icon: IconRefresh, minRole: 'MANAGER' },
      { title: "Festivals", path: "settings/festivals", icon: IconCalendar, featureKey: 'festivals', minRole: 'ANALYST' },
      { title: "Ad campaigns", path: "settings/ad-campaigns", icon: IconBrandMeta, featureKey: 'ad_campaigns', minRole: 'ANALYST' },
      { title: "Goals", path: "settings/goals", icon: IconTarget, featureKey: 'goals', minRole: 'ANALYST' },
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

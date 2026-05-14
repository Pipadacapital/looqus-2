import { NextResponse } from 'next/server'

// All available feature keys in the app
export type FeatureKey =
  | 'pnl'
  | 'waterfall'
  | 'products'
  | 'first_product_cascade'
  | 'lifetime_value'
  | 'cohorts'
  | 'customer_lifecycle'
  | 'acquisition'
  | 'timings'
  | 'distributions'
  | 'inventory'
  | 'store_analytics'
  | 'meta_ads'
  | 'google_ads'
  | 'shiprocket'
  | 'logistics'
  | 'rto_analytics'
  | 'cod_prepaid'
  | 'pincode_intelligence'
  | 'email_sms'
  | 'calendar'
  | 'ai'
  | 'ai_insights'
  | 'goals'
  | 'festivals'
  | 'ad_campaigns'

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ANALYST' | 'VIEWER'

// Role hierarchy — higher number = more access
const ROLE_LEVEL: Record<WorkspaceRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  ANALYST: 2,
  VIEWER: 1,
}

// Check if a role has at least the required level
export function hasRole(
  userRole: WorkspaceRole | null | undefined,
  requiredRole: WorkspaceRole
): boolean {
  if (!userRole) return false
  return ROLE_LEVEL[userRole] >= ROLE_LEVEL[requiredRole]
}

// Specific permission checks — named clearly for readability
export const can = {
  // Can view founder salary in Costs page
  viewFounderSalary: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'OWNER'),

  // Can connect/disconnect/sync integrations
  manageIntegrations: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'ADMIN'),

  // Can change any settings (save buttons, input changes)
  changeSettings: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'ADMIN'),

  // Can change Meta/Google ad accounts
  changeAdAccounts: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'ADMIN'),

  // Can view integrations page (see what's connected)
  viewIntegrations: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'MANAGER'),

  // Can see Settings section in nav at all
  viewSettings: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'ANALYST'),

  // Can perform any write action (buttons that mutate data)
  performActions: (role: WorkspaceRole | null | undefined) =>
    hasRole(role, 'ANALYST'),
}

// Default: all features enabled when not explicitly set
// A feature is disabled ONLY when explicitly set to false in the features JSON
export function isFeatureEnabled(
  features: Record<string, boolean> | null | undefined,
  key: FeatureKey
): boolean {
  if (!features) return true
  if (typeof features[key] === 'boolean') return features[key]
  return true // not mentioned = enabled
}

// Get all disabled features for a workspace
export function getDisabledFeatures(
  features: Record<string, boolean> | null | undefined
): FeatureKey[] {
  if (!features) return []
  return (Object.entries(features) as [FeatureKey, boolean][])
    .filter(([, enabled]) => enabled === false)
    .map(([key]) => key)
}

export function featureGuard(
  features: Record<string, boolean> | null | undefined,
  key: FeatureKey
): NextResponse | null {
  if (!isFeatureEnabled(features, key)) {
    return NextResponse.json(
      { error: 'This feature is not available for your workspace' },
      { status: 403 }
    )
  }
  return null
}

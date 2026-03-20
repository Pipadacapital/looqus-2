/**
 * Shared constants for workspace daily metrics and Shiprocket/logistics.
 * Single source of truth for Shiprocket status codes used across sync, analytics, and UI.
 * All amounts are in INR (rupees) — no exchange rate conversion.
 */

/** Shiprocket tracking status codes that indicate RTO (Return to Origin). */
export const RTO_STATUS_CODES = [9, 10, 14, 20, 40, 41, 46] as const

/** Shiprocket terminal statuses — no need to re-fetch tracking for these. */
export const TERMINAL_STATUS_CODES = [7, 8, 10, 12] as const

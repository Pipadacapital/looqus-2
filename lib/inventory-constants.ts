/**
 * Inventory status classification thresholds.
 * Tune these constants to adjust status labels without code changes.
 */

/** Days-of-coverage thresholds for inventory status */
export const INVENTORY_THRESHOLDS = {
    /** Coverage >= this many days → "Severely Overstocked" */
    SEVERELY_OVERSTOCKED_DAYS: 365,
    /** Coverage >= this many days → "Overstocked" */
    OVERSTOCKED_DAYS: 180,
    /** Number of days used to compute average daily sales rate */
    SALES_WINDOW_DAYS: 360,
    /** Sentinel for "infinite" days left */
    INFINITE_DAYS: 999999,
} as const

export type InventoryStatus =
    | 'Severely Overstocked'
    | 'Overstocked'
    | 'Healthy'
    | 'Out of stock'

/**
 * Classify a product's inventory status.
 */
export function classifyInventoryStatus(
    currentInventory: number,
    salesL360: number
): InventoryStatus {
    if (currentInventory <= 0) return 'Out of stock'
    if (salesL360 === 0) return 'Severely Overstocked'

    const avgDaily = salesL360 / INVENTORY_THRESHOLDS.SALES_WINDOW_DAYS
    const daysLeft = Math.ceil(currentInventory / Math.max(avgDaily, 1e-9))

    if (daysLeft >= INVENTORY_THRESHOLDS.SEVERELY_OVERSTOCKED_DAYS)
        return 'Severely Overstocked'
    if (daysLeft >= INVENTORY_THRESHOLDS.OVERSTOCKED_DAYS)
        return 'Overstocked'
    return 'Healthy'
}

/**
 * Compute estimated days left of stock.
 */
export function computeDaysLeft(
    currentInventory: number,
    salesL360: number
): number {
    if (currentInventory <= 0) return 0
    if (salesL360 === 0) return INVENTORY_THRESHOLDS.INFINITE_DAYS

    const avgDaily = salesL360 / INVENTORY_THRESHOLDS.SALES_WINDOW_DAYS
    return Math.ceil(currentInventory / Math.max(avgDaily, 1e-9))
}

/**
 * Compute sell-through percentage.
 * sellThrough = sales365 / (sales365 + currentInventory) * 100
 */
export function computeSellThrough(
    currentInventory: number,
    sales365: number
): number {
    const denom = sales365 + currentInventory
    if (denom <= 0) return 0
    return Math.round((sales365 / denom) * 1000) / 10 // 1 decimal
}

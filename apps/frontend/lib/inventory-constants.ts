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
    /** Days of stock < this → "Restock Soon" */
    RESTOCK_SOON_DAYS: 21,
    /** Sentinel for "infinite" days left (no recent sales velocity) */
    INFINITE_DAYS: 999999,
} as const

export type InventoryStatus =
    | 'Severely Overstocked'
    | 'Overstocked'
    | 'Healthy'
    | 'Restock Soon'
    | 'Out of stock'

/**
 * Compute estimated days left of stock using most relevant recent sales velocity.
 * Prefer L30 → L90 → L180 → L360; if no sales in any window and quantity > 0, return INFINITE_DAYS.
 */
export function computeDaysLeft(
    currentInventory: number,
    qtyL30: number,
    qtyL90: number,
    qtyL180: number,
    qtyL360: number
): number {
    if (currentInventory <= 0) return 0

    let avgDailySales = 0
    if (qtyL30 > 0) avgDailySales = qtyL30 / 30
    else if (qtyL90 > 0) avgDailySales = qtyL90 / 90
    else if (qtyL180 > 0) avgDailySales = qtyL180 / 180
    else if (qtyL360 > 0) avgDailySales = qtyL360 / 360

    if (avgDailySales <= 0) return INVENTORY_THRESHOLDS.INFINITE_DAYS
    const raw = currentInventory / avgDailySales
    return Math.round(raw) // stable, clean integer
}

/**
 * Classify a product's inventory status.
 * Priority: Out of stock → Restock Soon (< 21 days) → Severely Overstocked / Overstocked / Healthy by days.
 */
export function classifyInventoryStatus(
    currentInventory: number,
    daysOfStock: number
): InventoryStatus {
    if (currentInventory <= 0) return 'Out of stock'
    if (daysOfStock < INVENTORY_THRESHOLDS.RESTOCK_SOON_DAYS) return 'Restock Soon'
    if (daysOfStock >= INVENTORY_THRESHOLDS.SEVERELY_OVERSTOCKED_DAYS)
        return 'Severely Overstocked'
    if (daysOfStock >= INVENTORY_THRESHOLDS.OVERSTOCKED_DAYS)
        return 'Overstocked'
    return 'Healthy'
}

/**
 * Compute sell-through percentage.
 * Formula: sellThrough = soldLast365 / (soldLast365 + currentInventory) * 100.
 * (Page uses L360 as soldLast365.) If denominator is 0, returns 0.
 */
export function computeSellThrough(
    currentInventory: number,
    sales365: number
): number {
    const denom = sales365 + currentInventory
    if (denom <= 0) return 0
    return Math.round((sales365 / denom) * 1000) / 10 // 1 decimal
}

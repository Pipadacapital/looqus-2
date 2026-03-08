/** Group-by dimension for the Products analytics table */
export type ProductsGroupBy =
  | 'product'
  | 'variant'
  | 'collection'
  | 'vendor'
  | 'type'
  | 'product_tags'
  | 'order_tags'
  | 'discount_codes'

/** Sortable column id (must match API and UI) */
export type ProductsSortColumn =
  | 'label'
  | 'pareto_grade'
  | 'cm1'
  | 'cm1_pct'
  | 'cm1_total'
  | 'sales'
  | 'refunds'
  | 'revenue'
  | 'sold'
  | 'refunded'
  | 'net_quantity'
  | 'return_rate'
  | 'nc_return_rate'
  | 'ec_return_rate'
  | 'orders'
  | 'nc_orders'
  | 'ec_orders'
  | 'aov'
  | 'nc_aov'
  | 'ec_aov'

export interface ProductsRow {
  label: string
  paretoGrade: 'A' | 'B' | 'C' | 'F'
  cm1: number
  cm1Pct: number
  cm1Total: number
  sales: number
  refunds: number
  revenue: number
  sold: number
  refunded: number
  netQuantity: number
  returnRate: number
  ncReturnRate: number
  ecReturnRate: number
  orders: number
  ncOrders: number
  ecOrders: number
  aov: number
  ncAov: number
  ecAov: number
}

export interface ProductsResponse {
  rows: ProductsRow[]
  totalRows: number
  currency: string
}

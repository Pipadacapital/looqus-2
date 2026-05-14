import { InventoryTable } from './inventory-table'

export const metadata = {
    title: 'Inventory',
    description: 'Product inventory analysis',
}

export default function InventoryPage() {
    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
            <InventoryTable />
        </div>
    )
}

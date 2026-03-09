/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck

'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { CalendarIcon, Plus, Trash2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { WorkspaceCostType } from '@prisma/client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { toast } from 'sonner'
import { Label } from "@/components/ui/label"

// ─── Costs form schema ──────────────────────────────────────────────────────

const costFormSchema = z.object({
  costType: z.nativeEnum(WorkspaceCostType),
  name: z.string().optional(),
  amount: z.coerce.number().min(0, 'Amount must be positive'),
  isPercent: z.boolean().default(false),
  effectiveFrom: z.date(),
  currency: z.string().default('USD'),
  billingMode: z.enum(['monthly', 'per_order']).default('monthly'),
}).superRefine((data, ctx) => {
  if (data.costType === 'WEBSITE' && data.amount > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: 100, inclusive: true, type: 'number', path: ['amount'], message: 'Percentage must be 0–100' })
  }
})

// ─── Misc expense form schema ───────────────────────────────────────────────

const miscFormSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount: z.coerce.number().min(0, 'Amount must be positive'),
  currency: z.string().default('INR'),
  effectiveStartDate: z.date(),
})

// ─── Types ──────────────────────────────────────────────────────────────────

type Cost = {
  id: string
  costType: WorkspaceCostType
  name: string | null
  amount: number
  isPercent: boolean
  effectiveFrom: string
  effectiveTo: string | null
  currency: string | null
  billingMode: 'monthly' | 'per_order' | null
}

type MiscExpense = {
  id: string
  name: string
  amount: number
  currency: string
  effectiveStartDate: string
}

// ─── Component ──────────────────────────────────────────────────────────────

export function CostsContent({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const [costs, setCosts] = useState<Cost[]>([])
  const [miscExpenses, setMiscExpenses] = useState<MiscExpense[]>([])
  const [loading, setLoading] = useState(true)
  const [miscLoading, setMiscLoading] = useState(true)
  const [costDialogOpen, setCostDialogOpen] = useState(false)
  const [miscDialogOpen, setMiscDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [founderSalary, setFounderSalary] = useState<{ monthlyAmount: number | null; currency: string }>({ monthlyAmount: null, currency: 'INR' })
  const [founderSalaryLoading, setFounderSalaryLoading] = useState(true)
  const [founderSalarySaving, setFounderSalarySaving] = useState(false)
  const [founderSalaryInput, setFounderSalaryInput] = useState('')
  const router = useRouter()

  // ─── Cost form ──────────────────────────────────────────────────────────

  const costForm = useForm<z.infer<typeof costFormSchema>>({
    resolver: zodResolver(costFormSchema),
    defaultValues: {
      costType: WorkspaceCostType.SHIPPING,
      amount: 0,
      isPercent: false,
      effectiveFrom: new Date(),
      currency: 'USD',
      billingMode: 'monthly',
    },
  })

  const watchedCostType = costForm.watch('costType')
  const watchedBillingMode = costForm.watch('billingMode')
  const isWebsite = watchedCostType === 'WEBSITE'
  const isShippingOrPackaging = watchedCostType === 'SHIPPING' || watchedCostType === 'PACKAGING'

  useEffect(() => {
    costForm.setValue('isPercent', isWebsite)
  }, [isWebsite, costForm])

  // ─── Misc expense form ─────────────────────────────────────────────────

  const miscForm = useForm<z.infer<typeof miscFormSchema>>({
    resolver: zodResolver(miscFormSchema),
    defaultValues: {
      name: '',
      amount: 0,
      currency: 'INR',
      effectiveStartDate: new Date(),
    },
  })

  // ─── Data fetching ─────────────────────────────────────────────────────

  const fetchCosts = async () => {
    try {
      const res = await fetch(`/api/workspaces/${slug}/costs`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setCosts(data.costs)
    } catch {
      toast.error('Failed to load costs')
    } finally {
      setLoading(false)
    }
  }

  const fetchMiscExpenses = async () => {
    try {
      const res = await fetch(`/api/workspaces/${slug}/misc-expenses`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMiscExpenses(data.expenses)
    } catch {
      toast.error('Failed to load misc expenses')
    } finally {
      setMiscLoading(false)
    }
  }

  const fetchFounderSalary = async () => {
    try {
      const res = await fetch(`/api/workspaces/${slug}/founder-salary`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setFounderSalary({ monthlyAmount: data.monthlyAmount, currency: data.currency ?? 'INR' })
      setFounderSalaryInput(data.monthlyAmount != null ? String(data.monthlyAmount) : '')
    } catch {
      toast.error('Failed to load founder salary')
    } finally {
      setFounderSalaryLoading(false)
    }
  }

  useEffect(() => {
    fetchCosts()
    fetchMiscExpenses()
    fetchFounderSalary()
  }, [slug])

  // ─── Handlers ──────────────────────────────────────────────────────────

  const onCostSubmit = async (values: z.infer<typeof costFormSchema>) => {
    try {
      const res = await fetch(`/api/workspaces/${slug}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (res.status === 403) {
        toast.error('Only owners can edit costs.')
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Cost added successfully')
      setCostDialogOpen(false)
      costForm.reset()
      fetchCosts()
      router.refresh()
    } catch {
      toast.error('Failed to add cost')
    }
  }

  const onDeleteCost = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/workspaces/${slug}/costs`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.status === 403) {
        toast.error('Only owners can delete costs.')
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Cost deleted')
      fetchCosts()
    } catch {
      toast.error('Failed to delete cost')
    } finally {
      setDeleting(null)
    }
  }

  const onMiscSubmit = async (values: z.infer<typeof miscFormSchema>) => {
    try {
      const res = await fetch(`/api/workspaces/${slug}/misc-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (res.status === 403) {
        toast.error('Only owners can manage misc expenses.')
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Expense added')
      setMiscDialogOpen(false)
      miscForm.reset()
      fetchMiscExpenses()
    } catch {
      toast.error('Failed to add expense')
    }
  }

  const onDeleteMisc = async (id: string) => {
    setDeleting(id)
    try {
      const res = await fetch(`/api/workspaces/${slug}/misc-expenses`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.status === 403) {
        toast.error('Only owners can delete misc expenses.')
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Expense deleted')
      fetchMiscExpenses()
    } catch {
      toast.error('Failed to delete expense')
    } finally {
      setDeleting(null)
    }
  }

  const onSaveFounderSalary = async () => {
    const amount = parseFloat(founderSalaryInput)
    if (Number.isNaN(amount) || amount < 0) {
      toast.error('Enter a valid amount')
      return
    }
    setFounderSalarySaving(true)
    try {
      const res = await fetch(`/api/workspaces/${slug}/founder-salary`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyAmount: amount, currency: founderSalary.currency }),
      })
      if (res.status === 403) {
        toast.error('Only owners can edit founder salary.')
        return
      }
      if (!res.ok) throw new Error()
      toast.success('Founder salary updated')
      setFounderSalary({ monthlyAmount: amount, currency: founderSalary.currency })
      router.refresh()
    } catch {
      toast.error('Failed to update founder salary')
    } finally {
      setFounderSalarySaving(false)
    }
  }

  // ─── Labels ────────────────────────────────────────────────────────────

  const costTypeLabels: Record<WorkspaceCostType, string> = {
    SHIPPING: 'Shipping',
    PACKAGING: 'Packaging',
    WEBSITE: 'Website Charges (%)',
    CUSTOM: 'Custom',
  }

  // ─── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-10">
      {/* ═══ Operational Costs ═══ */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Costs & Charges</h2>
            <p className="text-muted-foreground">
              Manage your shipping, packaging, and other operational costs.
            </p>
          </div>
          {isOwner && (
            <Dialog open={costDialogOpen} onOpenChange={setCostDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Add Cost
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Cost</DialogTitle>
                  <DialogDescription>
                    Set a new cost effective from a specific date.
                  </DialogDescription>
                </DialogHeader>
                <Form {...costForm}>
                  <form onSubmit={costForm.handleSubmit(onCostSubmit)} className="space-y-4">
                    <FormField
                      control={costForm.control}
                      name="costType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a cost type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(WorkspaceCostType).map((type) => (
                                <SelectItem key={type} value={type}>
                                  {costTypeLabels[type]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {costForm.watch('costType') === 'CUSTOM' && (
                      <FormField
                        control={costForm.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Storage Fee" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {isShippingOrPackaging && (
                      <FormField
                        control={costForm.control}
                        name="billingMode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Billing</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="monthly">Monthly</SelectItem>
                                <SelectItem value="per_order">Per order</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                              {field.value === 'monthly' ? 'Flat amount per month (allocated by day).' : 'Charged per order in profitability calculations.'}
                            </p>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <div className={isWebsite ? '' : 'grid grid-cols-2 gap-4'}>
                      <FormField
                        control={costForm.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {isWebsite
                                ? 'Website Charges (%)'
                                : isShippingOrPackaging
                                  ? watchedBillingMode === 'per_order'
                                    ? 'Per-order amount'
                                    : 'Monthly amount'
                                  : 'Amount'}
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                min={0}
                                max={isWebsite ? 100 : undefined}
                                placeholder={isWebsite ? 'e.g. 2.5' : undefined}
                                {...field}
                              />
                            </FormControl>
                            {isWebsite && (
                              <p className="text-xs text-muted-foreground">
                                Calculated as % of Gross Sales
                              </p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {!isWebsite && (
                        <FormField
                          control={costForm.control}
                          name="currency"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Currency</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select currency" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="INR">INR (₹)</SelectItem>
                                  <SelectItem value="USD">USD ($)</SelectItem>
                                  <SelectItem value="EUR">EUR (€)</SelectItem>
                                  <SelectItem value="GBP">GBP (£)</SelectItem>
                                  <SelectItem value="AUD">AUD (A$)</SelectItem>
                                  <SelectItem value="CAD">CAD (C$)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}
                    </div>
                    <FormField
                      control={costForm.control}
                      name="effectiveFrom"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Effective From</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={'outline'}
                                  className={cn(
                                    'w-full pl-3 text-left font-normal',
                                    !field.value && 'text-muted-foreground'
                                  )}
                                >
                                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date('1900-01-01')}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="submit">Save Cost</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Effective From</TableHead>
                <TableHead>Effective To</TableHead>
                {isOwner && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 6 : 5} className="h-24 text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : costs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 6 : 5} className="h-24 text-center">
                    No costs found. {isOwner ? 'Add one to get started.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                costs.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell className="font-medium">
                      {costTypeLabels[cost.costType]}
                    </TableCell>
                    <TableCell>{cost.name || '-'}</TableCell>
                    <TableCell>
                      {cost.isPercent
                        ? `${cost.amount}%`
                        : (() => {
                            const formatted = new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: cost.currency || 'USD',
                            }).format(cost.amount)
                            const mode = (cost as Cost).billingMode ?? 'monthly'
                            if (cost.costType === 'SHIPPING' || cost.costType === 'PACKAGING') {
                              return `${formatted} (${mode === 'per_order' ? 'per order' : 'monthly'})`
                            }
                            return formatted
                          })()}
                    </TableCell>
                    <TableCell>{format(new Date(cost.effectiveFrom), 'PPP')}</TableCell>
                    <TableCell>
                      {cost.effectiveTo
                        ? format(new Date(cost.effectiveTo), 'PPP')
                        : 'Present'}
                    </TableCell>
                    {isOwner && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDeleteCost(cost.id)}
                          disabled={deleting === cost.id}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ═══ Miscellaneous Expenses ═══ */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Miscellaneous Expenses</h2>
            <p className="text-muted-foreground">
              Add recurring business expenses (salaries, rent, tools, etc.) to calculate CM3.
            </p>
          </div>
          {isOwner && (
            <Dialog open={miscDialogOpen} onOpenChange={setMiscDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" /> Add Expense
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Miscellaneous Expense</DialogTitle>
                  <DialogDescription>
                    This expense will be included in CM3 calculation for any analytics date range that overlaps.
                  </DialogDescription>
                </DialogHeader>
                <Form {...miscForm}>
                  <form onSubmit={miscForm.handleSubmit(onMiscSubmit)} className="space-y-4">
                    <FormField
                      control={miscForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Expense Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Office Rent, Employee Salary" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={miscForm.control}
                        name="amount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Amount</FormLabel>
                            <FormControl>
                              <Input type="number" step="0.01" min={0} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={miscForm.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Currency</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Currency" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="INR">INR (₹)</SelectItem>
                                <SelectItem value="USD">USD ($)</SelectItem>
                                <SelectItem value="EUR">EUR (€)</SelectItem>
                                <SelectItem value="GBP">GBP (£)</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={miscForm.control}
                      name="effectiveStartDate"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Effective Start Date</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant={'outline'}
                                  className={cn(
                                    'w-full pl-3 text-left font-normal',
                                    !field.value && 'text-muted-foreground'
                                  )}
                                >
                                  {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={field.value}
                                onSelect={field.onChange}
                                disabled={(date) => date < new Date('1900-01-01')}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button type="submit">Save Expense</Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          )}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Effective From</TableHead>
                {isOwner && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {miscLoading ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 4 : 3} className="h-24 text-center">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : miscExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isOwner ? 4 : 3} className="h-24 text-center">
                    No miscellaneous expenses. {isOwner ? 'Add one to include in CM3.' : ''}
                  </TableCell>
                </TableRow>
              ) : (
                miscExpenses.map((exp) => (
                  <TableRow key={exp.id}>
                    <TableCell className="font-medium">{exp.name}</TableCell>
                    <TableCell>
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: exp.currency || 'INR',
                      }).format(exp.amount)}
                    </TableCell>
                    <TableCell>{format(new Date(exp.effectiveStartDate), 'PPP')}</TableCell>
                    {isOwner && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onDeleteMisc(exp.id)}
                          disabled={deleting === exp.id}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* ═══ Founder's salary (used in P&L Net Profit) ═══ */}
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Founder&apos;s salary</h2>
          <p className="text-muted-foreground">
            Monthly amount allocated in P&L Net Profit. Owner-only editable.
          </p>
        </div>
        <div className="rounded-md border p-4">
          {founderSalaryLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {isOwner ? (
                <>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="founder-salary-amount" className="text-sm">Monthly amount</Label>
                    <Input
                      id="founder-salary-amount"
                      type="number"
                      min={0}
                      step={0.01}
                      value={founderSalaryInput}
                      onChange={(e) => setFounderSalaryInput(e.target.value)}
                      className="w-36"
                    />
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {founderSalary.currency}
                  </span>
                  <Button
                    onClick={onSaveFounderSalary}
                    disabled={founderSalarySaving}
                  >
                    {founderSalarySaving ? 'Saving...' : 'Save'}
                  </Button>
                </>
              ) : (
                <p className="text-sm">
                  {founderSalary.monthlyAmount != null
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: founderSalary.currency }).format(founderSalary.monthlyAmount) + ' / month'
                    : 'Not set'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangleIcon } from 'lucide-react'

import { useWorkspace } from '@/hooks/use-workspace'
import { can } from '@/lib/features'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type WorkspaceSettings = {
  timezone: string
  taxPercent: number
}

const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
]

function formatPercent(value: number) {
  return value.toFixed(2)
}

function parsePercent(str: string) {
  const value = parseFloat(str)
  return Number.isFinite(value) ? value : 0
}

function getSupportedTimeZones() {
  const intlWithSupportedValues = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[]
  }

  return intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? FALLBACK_TIMEZONES
}

export function WorkspaceSettingsContent() {
  const { current } = useWorkspace()
  const slug = current.slug
  const canChange = can.changeSettings(current.userRole)
  const queryClient = useQueryClient()

  const [timezone, setTimezone] = useState('UTC')
  const [taxPercent, setTaxPercent] = useState('0.00')

  const { data, isLoading } = useQuery<WorkspaceSettings>({
    queryKey: ['workspace-settings', slug],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${slug}/workspace-settings`)
      if (!res.ok) throw new Error('Failed to load workspace settings')
      return res.json()
    },
  })

  useEffect(() => {
    if (data) {
      setTimezone(data.timezone)
      setTaxPercent(formatPercent(data.taxPercent))
    }
  }, [data])

  const timezoneOptions = useMemo(() => {
    const available = getSupportedTimeZones()
    return Array.from(new Set([timezone, ...available])).sort()
  }, [timezone])

  const mutation = useMutation({
    mutationFn: async (payload: WorkspaceSettings) => {
      const res = await fetch(`/api/workspaces/${slug}/workspace-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to save')
      }

      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings', slug] })
      toast.success('Workspace settings saved')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })


  const handleSave = () => {
    mutation.mutate({
      timezone,
      taxPercent: parsePercent(taxPercent),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 md:items-start">
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the workspace timezone and store the default tax percentage.
        </p>
      </div>

      <Card className="w-full max-w-lg flex-1 bg-muted/30">
        <CardHeader>
          <CardTitle className="sr-only">Workspace configuration</CardTitle>
          <CardDescription className="sr-only">
            Workspace timezone and default tax percentage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <Field>
            <FieldLabel>Timezone</FieldLabel>
            <FieldContent>
              <Select value={timezone} onValueChange={setTimezone} disabled={!canChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a timezone" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {timezoneOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Used as the default timezone for workspace-level reporting and date
                selection.
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>Tax %</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                disabled={!canChange}
                className="max-w-[140px]"
                aria-label="Workspace tax percentage"
              />
              <FieldDescription>
                Default tax percentage saved for this workspace. Set to 0 if tax
                should not be applied by default.
              </FieldDescription>
            </FieldContent>
          </Field>

          <div className="pt-2">
            <Button onClick={handleSave} disabled={!canChange || mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export function DeleteWorkspaceCard() {
  const { current } = useWorkspace()
  const slug = current.slug
  const isOwner = current.userRole === 'OWNER'
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const deleteWorkspaceMutation = useMutation({
    mutationFn: async (payload: { password: string }) => {
      const res = await fetch(`/api/workspaces/${slug}/workspace-settings`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Failed to delete workspace')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Workspace deleted')
      window.location.href = '/dashboard'
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleDeleteWorkspace = () => {
    if (!deletePassword.trim()) {
      toast.error('Please enter your password')
      return
    }
    deleteWorkspaceMutation.mutate({ password: deletePassword })
  }

  if (!isOwner) return null

  return (
    <Card className="w-full max-w-lg border-destructive/40 bg-destructive/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangleIcon className="size-5" />
          Delete Workspace
        </CardTitle>
        <CardDescription>
          This action permanently deletes this workspace and all workspace data. Your profile
          account will not be deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Delete workspace</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this workspace permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the workspace and all workspace data. This cannot be
                undone. Enter your password to confirm.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="workspace-delete-password">
                Password
              </label>
              <Input
                id="workspace-delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your password"
                disabled={deleteWorkspaceMutation.isPending}
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteWorkspaceMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault()
                  handleDeleteWorkspace()
                }}
                variant="destructive"
                disabled={deleteWorkspaceMutation.isPending}
              >
                {deleteWorkspaceMutation.isPending ? 'Deleting…' : 'Delete workspace'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  )
}

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { IconLoader2, IconRefresh } from '@tabler/icons-react'
import { toast } from 'sonner'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface AdsBackfillClientProps {
  workspaceId: string
  workspaceName: string
  isOwner: boolean
}

export function AdsBackfillClient({
  workspaceId,
  workspaceName,
  isOwner,
}: AdsBackfillClientProps) {
  const [loading, setLoading] = useState(false)

  async function handleBackfill() {
    if (!isOwner) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/integrations/ads/backfill?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Backfill failed')
        return
      }
      const metaRows = data.meta?.rowsSynced ?? 0
      const googleRows = data.google?.rowsSynced ?? 0
      toast.success(
        `Backfill complete: Meta ${metaRows} rows, Google ${googleRows} rows`
      )
    } catch {
      toast.error('Backfill failed')
    } finally {
      setLoading(false)
    }
  }

  if (!isOwner) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button disabled variant="outline">
                Backfill Meta+Google (2 years)
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Owner only</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fetches up to 2 years of daily Meta and Google Ads metrics (spend, impressions,
        clicks, etc.) into this workspace. Use after connecting Meta and Google Ads, or to
        refresh historical data.
      </p>
      <Button
        onClick={handleBackfill}
        disabled={loading}
        className="gap-2"
      >
        {loading ? (
          <>
            <IconLoader2 className="h-4 w-4 animate-spin" />
            Backfilling…
          </>
        ) : (
          <>
            <IconRefresh className="h-4 w-4" />
            Backfill Meta+Google (2 years)
          </>
        )}
      </Button>
    </div>
  )
}

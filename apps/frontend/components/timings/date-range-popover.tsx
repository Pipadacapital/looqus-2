'use client'

import { useState } from 'react'
import { format, subDays } from 'date-fns'
import { IconCalendar } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const RANGE_PRESETS = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
  { label: '1Y', days: 365 },
  { label: 'Two years back', days: 730 },
]

export interface TimingsDateRangePopoverProps {
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  onRangeChange?: (range: { from: string; to: string }) => void
}

function getPresetLabel(from: string, to: string): string {
  const toDate = new Date(to)
  const fromDate = new Date(from)
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
  const preset = RANGE_PRESETS.find((p) => Math.abs(p.days - days) <= 2)
  return preset?.label ?? `${format(fromDate, 'MMM d')} – ${format(toDate, 'MMM d')}`
}

export function TimingsDateRangePopover({
  from,
  to,
  onFromChange,
  onToChange,
  onRangeChange,
}: TimingsDateRangePopoverProps) {
  const [open, setOpen] = useState(false)

  const applyPreset = (preset: (typeof RANGE_PRESETS)[number]) => {
    const toDate = new Date()
    const fromDate = subDays(toDate, preset.days - 1)
    const nextRange = {
      from: format(fromDate, 'yyyy-MM-dd'),
      to: format(toDate, 'yyyy-MM-dd'),
    }

    if (onRangeChange) {
      onRangeChange(nextRange)
    } else {
      onFromChange(nextRange.from)
      onToChange(nextRange.to)
    }
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <IconCalendar className="h-4 w-4" />
          {getPresetLabel(from, to)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 p-2">
        <div className="flex flex-col gap-0.5">
          {RANGE_PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

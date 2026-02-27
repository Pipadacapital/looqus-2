'use client'

import { format, subDays } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const RANGE_PRESETS = [
  { type: 'range' as const, label: '7D', days: 7 },
  { type: 'range' as const, label: '30D', days: 30 },
  { type: 'range' as const, label: '90D', days: 90 },
]

const SINGLE_DAY_PRESETS = [
  { type: 'single' as const, label: 'Yesterday', daysAgo: 1 },
  // { type: 'single' as const, label: '2 days ago', daysAgo: 2 },
  // { type: 'single' as const, label: '3 days ago', daysAgo: 3 },
]

const PRESETS = [...SINGLE_DAY_PRESETS, ...RANGE_PRESETS]

type Preset = (typeof PRESETS)[number]

export interface DateRangeFilterProps {
  from: string
  to: string
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
  fromId?: string
  toId?: string
  className?: string
}

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  fromId = 'analytics-from',
  toId = 'analytics-to',
  className,
}: DateRangeFilterProps) {
  const applyPreset = (preset: Preset) => {
    if (preset.type === 'single') {
      const d = subDays(new Date(), preset.daysAgo)
      const dateStr = format(d, 'yyyy-MM-dd')
      onFromChange(dateStr)
      onToChange(dateStr)
    } else {
      const toDate = new Date()
      const fromDate = subDays(toDate, preset.days - 1)
      onFromChange(format(fromDate, 'yyyy-MM-dd'))
      onToChange(format(toDate, 'yyyy-MM-dd'))
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Label htmlFor={fromId} className="text-xs whitespace-nowrap">
            From
          </Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
            className="w-[140px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor={toId} className="text-xs whitespace-nowrap">
            To
          </Label>
          <Input
            id={toId}
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
            className="w-[140px]"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

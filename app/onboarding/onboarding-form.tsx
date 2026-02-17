'use client'

import { useState, useEffect, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  IconUser,
  IconBuildingStore,
  IconPlugConnected,
  IconArrowRight,
  IconArrowLeft,
  IconCheck,
 
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { completeOnboarding } from './actions'

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const STEPS = [
  { id: 'profile', label: 'Your profile', icon: IconUser },
  { id: 'brand', label: 'Your brand', icon: IconBuildingStore },
  { id: 'connect', label: 'Connect store', icon: IconPlugConnected },
] as const

const ROLES = [
  { value: 'founder', label: 'Founder / CEO', description: 'I run the business' },
  { value: 'marketing', label: 'Marketing', description: 'I manage growth & ads' },
  { value: 'analyst', label: 'Data / Analytics', description: 'I analyze performance' },
  { value: 'developer', label: 'Developer', description: 'I build & integrate' },
  { value: 'agency', label: 'Agency', description: 'I manage client brands' },
  { value: 'other', label: 'Other', description: 'Something else' },
]

const INDUSTRIES = [
  'Fashion & Apparel',
  'Beauty & Cosmetics',
  'Health & Wellness',
  'Food & Beverage',
  'Home & Garden',
  'Electronics',
  'Sports & Outdoors',
  'Toys & Games',
  'Pet Supplies',
  'Other',
]

const REVENUE_RANGES = [
  { value: 'pre-revenue', label: 'Pre-revenue' },
  { value: '0-10k', label: '$0 – $10K/mo' },
  { value: '10k-50k', label: '$10K – $50K/mo' },
  { value: '50k-200k', label: '$50K – $200K/mo' },
  { value: '200k-1m', label: '$200K – $1M/mo' },
  { value: '1m+', label: '$1M+/mo' },
]

interface OnboardingFormProps {
  defaultFullName: string
  email: string
}

export function OnboardingForm({ defaultFullName, email }: OnboardingFormProps) {
  const [step, setStep] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [fullName, setFullName] = useState(defaultFullName)
  const [role, setRole] = useState('')
  const [brandName, setBrandName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [industry, setIndustry] = useState('')
  const [monthlyRevenue, setMonthlyRevenue] = useState('')
  const [storeUrl, setStoreUrl] = useState('')

  useEffect(() => {
    if (!slugTouched) {
      setSlug(toSlug(brandName))
    }
  }, [brandName, slugTouched])

  const canProceed = () => {
    if (step === 0) return fullName.trim().length > 0 && role.length > 0
    if (step === 1) return brandName.trim().length > 0 && slug.trim().length > 0
    return true
  }

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1)
      setError(null)
    }
  }

  const handleBack = () => {
    if (step > 0) {
      setStep(step - 1)
      setError(null)
    }
  }

  const handleSubmit = () => {
    setError(null)
    startTransition(async () => {
      const result = await completeOnboarding({
        fullName: fullName.trim(),
        role,
        brandName: brandName.trim(),
        slug: slug.trim().toLowerCase(),
        industry,
        monthlyRevenue,
        storeUrl: storeUrl.trim(),
      })
      if (result?.error) {
        setError(result.error)
        if (result.error.includes('URL')) {
          setStep(1)
        }
      }
    })
  }

  return (
    <div className="w-full">
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const isActive = i === step
          const isCompleted = i < step
          return (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={cn(
                    'h-px w-8 transition-colors',
                    isCompleted ? 'bg-primary' : 'bg-border'
                  )}
                />
              )}
              <button
                type="button"
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className={cn(
                  'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive && 'bg-primary text-primary-foreground',
                  isCompleted && 'bg-primary/10 text-primary cursor-pointer',
                  !isActive && !isCompleted && 'bg-muted text-muted-foreground'
                )}
              >
                {isCompleted ? (
                  <IconCheck className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            </div>
          )
        })}
      </div>

      {/* Step content */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {/* Step 1: Profile */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Tell us about yourself</h2>
              <p className="text-sm text-muted-foreground">
                This helps us personalize your experience.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="fullName">Full name</Label>
              <Input
                id="fullName"
                placeholder="John Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={email}
                disabled
                className="text-muted-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label>What&apos;s your role?</Label>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    className={cn(
                      'flex flex-col items-start rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                      role === r.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border'
                    )}
                  >
                    <span className="text-sm font-medium">{r.label}</span>
                    <span className="text-xs text-muted-foreground">{r.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Brand */}
        {step === 1 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Set up your brand</h2>
              <p className="text-sm text-muted-foreground">
                We&apos;ll create a workspace for your brand&apos;s analytics.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="brandName">
                Brand name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="brandName"
                placeholder="Acme Inc."
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">
                Workspace URL <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center">
                <span className="flex h-9 items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                  app/
                </span>
                <Input
                  id="slug"
                  placeholder="acme-inc"
                  className="rounded-l-none"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="industry">Industry</Label>
              <div className="flex flex-wrap gap-1.5">
                {INDUSTRIES.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => setIndustry(industry === ind ? '' : ind)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:bg-accent',
                      industry === ind
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    {ind}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Monthly revenue</Label>
              <div className="grid grid-cols-3 gap-2">
                {REVENUE_RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() =>
                      setMonthlyRevenue(monthlyRevenue === r.value ? '' : r.value)
                    }
                    className={cn(
                      'rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent',
                      monthlyRevenue === r.value
                        ? 'border-primary bg-primary/5 text-primary ring-1 ring-primary'
                        : 'border-border text-muted-foreground'
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Connect Shopify */}
        {step === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Connect your Shopify store</h2>
              <p className="text-sm text-muted-foreground">
                Enter your Shopify store URL to start syncing your data.
                You can also do this later from settings.
              </p>
            </div>

            <div className="rounded-lg border-2 border-dashed p-6">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#96bf48]/10">
                 
                </div>
                <div>
                  <p className="font-medium">Shopify Store</p>
                  <p className="text-sm text-muted-foreground">
                    Connect your store to pull in orders, products, and customer data.
                  </p>
                </div>
                <div className="w-full max-w-sm">
                  <div className="flex items-center">
                    <Input
                      placeholder="your-store"
                      value={storeUrl}
                      onChange={(e) => setStoreUrl(e.target.value)}
                      className="rounded-r-none"
                    />
                    <span className="flex h-9 items-center rounded-r-md border border-l-0 bg-muted px-3 text-sm text-muted-foreground">
                      .myshopify.com
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground">
              Don&apos;t worry — you can connect your store anytime from your workspace settings.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          {step > 0 ? (
            <Button variant="ghost" onClick={handleBack} disabled={isPending}>
              <IconArrowLeft className="mr-1.5 h-4 w-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          {step < STEPS.length - 1 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Continue
              <IconArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Setting up...' : storeUrl ? 'Connect & launch' : 'Skip & launch'}
              <IconArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

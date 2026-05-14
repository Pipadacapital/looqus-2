'use client'

import { useState, useTransition } from 'react'
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
  IconShoppingCart,
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
  { id: 'platform', label: 'Platform', icon: IconShoppingCart },
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
  isNewWorkspace?: boolean
}

export function OnboardingForm({
  defaultFullName,
  email,
  isNewWorkspace = false,
}: OnboardingFormProps) {
  const [step, setStep] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const stepsToShow = isNewWorkspace ? STEPS.slice(1) : STEPS
  const contentStep = isNewWorkspace ? step + 1 : step

  const [fullName, setFullName] = useState(defaultFullName)
  const [role, setRole] = useState('')
  const [brandName, setBrandName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [industry, setIndustry] = useState('')
  const [monthlyRevenue, setMonthlyRevenue] = useState('')

  // platform + store connect state
  const [platform, setPlatform] = useState<'shopify' | 'woocommerce' | ''>('')
  const [storeUrl, setStoreUrl] = useState('')       // Shopify handle
  const [wcStoreUrl, setWcStoreUrl] = useState('')   // WooCommerce full URL
  const [wcConsumerKey, setWcConsumerKey] = useState('')
  const [wcConsumerSecret, setWcConsumerSecret] = useState('')

  const effectiveSlug = slugTouched ? slug : toSlug(brandName)

  const canProceed = () => {
    if (isNewWorkspace) {
      if (step === 0) return brandName.trim().length > 0 && effectiveSlug.trim().length > 0
      if (step === 1) return platform !== '' // platform step
      return true
    }
    if (step === 0) return fullName.trim().length > 0 && role.length > 0
    if (step === 1) return brandName.trim().length > 0 && effectiveSlug.trim().length > 0
    if (step === 2) return platform !== '' // platform step
    return true
  }

  const handleNext = () => {
    if (step < stepsToShow.length - 1) {
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

  const handleSubmit = (connect: boolean) => {
    setError(null)
    startTransition(async () => {
      const result = await completeOnboarding({
        fullName: fullName.trim(),
        role,
        brandName: brandName.trim(),
        slug: effectiveSlug.trim().toLowerCase(),
        industry,
        monthlyRevenue,
        platform: platform as 'shopify' | 'woocommerce',
        // Shopify fields
        storeUrl: storeUrl.trim(),
        connectShopify: platform === 'shopify' && connect,
        // WooCommerce fields
        wcStoreUrl: wcStoreUrl.trim(),
        wcConsumerKey: wcConsumerKey.trim(),
        wcConsumerSecret: wcConsumerSecret.trim(),
      })
      if (result?.shopifyAuthUrl) {
        window.location.href = result.shopifyAuthUrl
        return
      }
      if (result?.redirectTo) {
        window.location.href = result.redirectTo
        return
      }
      if (result?.error) {
        setError(result.error)
        if (result.error.includes('URL')) {
          setStep(isNewWorkspace ? 0 : 1)
        }
      }
    })
  }

  const hasWcCredentials =
    wcStoreUrl.trim().length > 0 &&
    wcConsumerKey.trim().length > 0 &&
    wcConsumerSecret.trim().length > 0

  return (
    <div className="w-full">
      {/* Step indicator */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {stepsToShow.map((s, i) => {
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
        {contentStep === 0 && (
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
        {contentStep === 1 && (
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
                  value={effectiveSlug}
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

        {/* Step 3: Platform selection */}
        {contentStep === 2 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">What platform is your store on?</h2>
              <p className="text-sm text-muted-foreground">
                Choose your ecommerce platform to connect your store.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setPlatform('shopify')}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors hover:bg-accent',
                  platform === 'shopify'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary'
                    : 'border-border'
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#96bf48]/10">
                  <svg className="h-7 w-7" viewBox="0 0 256 292" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M223.773 55.382c-.221-1.591-1.591-2.519-2.740-2.630-.037-.003-8.063-.154-8.063-.154s-6.364-6.250-7.024-6.910c-.660-.659-1.981-.459-2.491-.300-.030.009-1.383.428-3.691 1.142-2.196-6.321-6.067-12.138-12.855-12.138-.188 0-.38.007-.572.017-1.879-2.487-4.204-3.578-6.209-3.578-15.388 0-22.724 19.229-25.026 29.011-5.973 1.851-10.218 3.163-10.773 3.335-3.339 1.048-3.441 1.149-3.875 4.299-.326 2.371-9.021 69.576-9.021 69.576l67.419 11.670 36.609-7.901c-.001 0-12.404-95.388-12.688-97.439z" fill="#95BF47"/>
                    <path d="M200.995 46.153c-.188 0-.377.007-.566.017-1.567-2.075-3.476-3.312-5.412-3.578 0 0-15.388 0-15.388 19.229-4.975 1.540-8.505 2.634-8.505 2.634l33.987 5.878c-.001 0-3.438-24.180-4.116-24.180z" fill="#5E8E3E"/>
                    <path d="M128.046 177.031l-16.959 5.053s-2.511-13.268-5.622-29.607c6.617-.994 12.621-1.960 18.028-2.861 2.234 11.758 4.553 27.415 4.553 27.415z" fill="#FFFFFF"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold">Shopify</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Connect via custom app token</p>
                </div>
                {platform === 'shopify' && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setPlatform('woocommerce')}
                className={cn(
                  'flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-colors hover:bg-accent',
                  platform === 'woocommerce'
                    ? 'border-primary bg-primary/5 ring-2 ring-primary'
                    : 'border-border'
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#7F54B3]/10">
                  <svg className="h-7 w-7" viewBox="0 0 256 154" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M23.759 0h208.482C244.886 0 256 11.114 256 24.759v104.482C256 142.886 244.886 154 231.241 154H23.759C10.114 154 0 142.886 0 129.241V24.759C0 11.114 11.114 0 23.759 0z" fill="#7F54B3"/>
                    <path d="M14.578 23.759c1.743-2.323 4.356-3.776 7.546-4.065 6.124-.58 9.61 2.614 10.455 9.61l8.994 60.038 19.795-37.811c1.744-3.195 3.922-4.937 6.7-5.082 3.922-.29 6.535 2.034 7.67 6.99 2.903 14.52 6.825 26.934 11.472 37.521l11.762-113.98c.58-4.647 2.903-6.99 6.99-6.99 2.034 0 4.067.869 5.52 2.323 1.453 1.453 2.323 3.486 2.033 5.52l-16.01 148.51c-.58 5.227-3.195 7.96-7.67 8.25-4.647.29-7.67-2.034-9.414-7.26l-14.52-38.099-13.651 26.353c-2.034 3.776-4.357 5.81-7.26 5.81-4.067 0-6.535-2.323-7.67-7.26L20.099 44.423c-.29-2.034 0-4.067.58-6.1l-6.101-14.564z" fill="#FFFFFF"/>
                  </svg>
                </div>
                <div>
                  <p className="font-semibold">WooCommerce</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">WordPress / WooCommerce</p>
                </div>
                {platform === 'woocommerce' && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Connect store (Shopify) */}
        {contentStep === 3 && platform === 'shopify' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Connect your Shopify store</h2>
              <p className="text-sm text-muted-foreground">
                Enter your Shopify store URL now. You can connect from Integrations
                using your custom app Admin API token after launch.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="onb-store-handle">Store URL</Label>
                <div className="flex items-center">
                  <Input
                    id="onb-store-handle"
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

            <p className="text-center text-xs text-muted-foreground">
              Don&apos;t worry — you can connect your store anytime from your workspace settings.
            </p>
          </div>
        )}

        {/* Step 4: Connect store (WooCommerce) */}
        {contentStep === 3 && platform === 'woocommerce' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Connect your WooCommerce store</h2>
              <p className="text-sm text-muted-foreground">
                Enter your store URL and REST API credentials.
              </p>
            </div>

            <div className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="wc-store-url">Store URL</Label>
                <Input
                  id="wc-store-url"
                  placeholder="https://mybrand.com"
                  value={wcStoreUrl}
                  onChange={(e) => setWcStoreUrl(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wc-consumer-key">Consumer Key</Label>
                <Input
                  id="wc-consumer-key"
                  placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={wcConsumerKey}
                  onChange={(e) => setWcConsumerKey(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="wc-consumer-secret">Consumer Secret</Label>
                <Input
                  id="wc-consumer-secret"
                  type="password"
                  placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={wcConsumerSecret}
                  onChange={(e) => setWcConsumerSecret(e.target.value)}
                />
              </div>
            </div>

            <p className="rounded-lg bg-muted px-4 py-3 text-xs text-muted-foreground">
              Generate API keys in your WordPress dashboard under{' '}
              <strong>WooCommerce → Settings → Advanced → REST API</strong>.
              Set permissions to <strong>Read</strong>.
            </p>

            <p className="text-center text-xs text-muted-foreground">
              You can also connect your store anytime from workspace settings.
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

          {step < stepsToShow.length - 1 ? (
            <Button onClick={handleNext} disabled={!canProceed()}>
              Continue
              <IconArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              {/* Shopify: skip + connect */}
              {platform === 'shopify' && (
                <>
                  <Button
                    onClick={() => handleSubmit(false)}
                    disabled={isPending}
                  >
                    {isPending ? 'Setting up...' : 'Launch workspace'}
                    <IconArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </>
              )}

              {/* WooCommerce: connect or skip */}
              {platform === 'woocommerce' && (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => handleSubmit(false)}
                    disabled={isPending}
                  >
                    Skip for now
                  </Button>
                  <Button
                    onClick={() => handleSubmit(true)}
                    disabled={isPending || (!hasWcCredentials)}
                  >
                    {isPending ? 'Connecting...' : 'Connect & launch'}
                    <IconArrowRight className="ml-1.5 h-4 w-4" />
                  </Button>
                </>
              )}

              {/* Fallback if no platform chosen yet (shouldn't happen) */}
              {platform === '' && (
                <Button onClick={() => handleSubmit(false)} disabled={isPending}>
                  Launch
                  <IconArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

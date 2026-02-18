'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'

export type OnboardingResult = {
  error?: string
  shopifyAuthUrl?: string
}

export async function completeOnboarding(data: {
  fullName: string
  role: string
  brandName: string
  slug: string
  industry: string
  monthlyRevenue: string
  storeUrl: string
  connectShopify: boolean
}): Promise<OnboardingResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const { fullName, role, brandName, slug, industry, monthlyRevenue, storeUrl, connectShopify } =
    data

  if (!brandName.trim()) {
    return { error: 'Brand name is required.' }
  }

  if (!slug.trim()) {
    return { error: 'Workspace URL is required.' }
  }

  const normalizedSlug = slug.trim().toLowerCase()

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalizedSlug)) {
    return {
      error:
        'URL must start and end with a letter or number, and can only contain lowercase letters, numbers, and hyphens.',
    }
  }

  const existingWorkspace = await prisma.workspace.findUnique({
    where: { slug: normalizedSlug },
  })

  if (existingWorkspace) {
    return { error: 'This workspace URL is already taken. Please choose another.' }
  }

  const normalizedStoreUrl = storeUrl
    ? storeUrl.replace(/\.myshopify\.com$/i, '').trim().toLowerCase()
    : null

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        fullName: fullName || undefined,
        jobRole: role || undefined,
      },
    })

    const workspace = await tx.workspace.create({
      data: {
        name: brandName.trim(),
        slug: normalizedSlug,
        industry: industry || null,
        monthlyRevenue: monthlyRevenue || null,
        storeUrl: normalizedStoreUrl
          ? `${normalizedStoreUrl}.myshopify.com`
          : null,
        createdById: user.id,
      },
    })

    await tx.workspaceMember.create({
      data: {
        userId: user.id,
        workspaceId: workspace.id,
        role: 'OWNER',
      },
    })
  })

  // If user wants to connect Shopify, return the OAuth initiation URL
  // instead of redirecting to the dashboard
  if (connectShopify && normalizedStoreUrl) {
    const shopDomain = `${normalizedStoreUrl}.myshopify.com`
    const shopifyAuthUrl = `/api/shopify/auth?shop=${encodeURIComponent(shopDomain)}&workspaceSlug=${encodeURIComponent(normalizedSlug)}`
    return { shopifyAuthUrl }
  }

  redirect(`/w/${normalizedSlug}/dashboard`)
}

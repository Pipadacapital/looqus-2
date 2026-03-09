'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'
import { prisma } from '@/lib/prisma'
import {
  normalizeShopDomain,
  generateNonce,
  buildAuthUrl,
} from '@/lib/shopify/client'

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
  shopifyClientId: string
  shopifyClientSecret: string
  connectShopify: boolean
}): Promise<OnboardingResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const {
    fullName,
    role,
    brandName,
    slug,
    industry,
    monthlyRevenue,
    storeUrl,
    shopifyClientId,
    shopifyClientSecret,
    connectShopify,
  } = data

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

  const wantsShopify =
    connectShopify && normalizedStoreUrl && shopifyClientId && shopifyClientSecret

  const shopDomain = normalizedStoreUrl
    ? normalizeShopDomain(normalizedStoreUrl)
    : null

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: user.id },
      update: {
        fullName: fullName || undefined,
        jobRole: role || undefined,
      },
      create: {
        id: user.id,
        email: user.email!,
        fullName: fullName || null,
        jobRole: role || null,
        avatarUrl:
          user.user_metadata?.avatar_url ??
          user.user_metadata?.picture ??
          null,
      },
    })

    const workspace = await tx.workspace.create({
      data: {
        name: brandName.trim(),
        slug: normalizedSlug,
        industry: industry || null,
        monthlyRevenue: monthlyRevenue || null,
        storeUrl: shopDomain ?? null,
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

    // If connecting Shopify, save a pending connection with credentials (upsert so retries are safe)
    if (wantsShopify && shopDomain) {
      await tx.shopifyConnection.upsert({
        where: {
          workspaceId_shopDomain: {
            workspaceId: workspace.id,
            shopDomain,
          },
        },
        create: {
          workspaceId: workspace.id,
          shopDomain,
          clientId: shopifyClientId,
          clientSecret: shopifyClientSecret,
          scopes: [],
          status: 'DISCONNECTED',
        },
        update: {
          clientId: shopifyClientId,
          clientSecret: shopifyClientSecret,
          status: 'DISCONNECTED',
        },
      })
    }
  })

  // If user wants to connect Shopify, set OAuth state cookie and return the auth URL
  if (wantsShopify && shopDomain) {
    const nonce = generateNonce()
    const authUrl = buildAuthUrl(shopDomain, shopifyClientId, nonce)

    const oauthState = JSON.stringify({
      nonce,
      workspaceSlug: normalizedSlug,
      userId: user.id,
      shopDomain,
    })

    const cookieStore = await cookies()
    cookieStore.set('shopify_oauth_state', oauthState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })

    return { shopifyAuthUrl: authUrl }
  }

  redirect(`/w/${normalizedSlug}/dashboard`)
}

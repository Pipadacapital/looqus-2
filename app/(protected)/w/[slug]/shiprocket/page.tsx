import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getCachedWorkspace } from '@/lib/server-cache'
import { ShiprocketLoader } from './shiprocket-loader'
import Loading from './loading'

export type ShipmentData = {
  id: string
  shipmentId: string
  channelOrderId: string | null
  orderId: string | null
  awbCode: string | null
  courierName: string | null
  status: string | null
  statusCode: number | null
  trackingStatusCode: number | null
  trackingStatus: string | null
  paymentMethod: string | null
  shopifyOrderName: string | null
  isCod: boolean
  shippedAt: string | null
  shiprocketCreatedAt: string | null
  syncedAt: string
  rawJson: unknown
}

export default async function ShiprocketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { slug } = await params
  const sp = await searchParams

  const workspace = await getCachedWorkspace(slug)
  if (!workspace) redirect('/')

  return (
    <Suspense fallback={<Loading />}>
      <ShiprocketLoader slug={slug} sp={sp} />
    </Suspense>
  )
}

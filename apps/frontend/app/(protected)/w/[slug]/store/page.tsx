import { Suspense } from 'react'
import { StoreLoader } from './store-loader'
import Loading from './loading'

export default async function StorePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  return (
    <Suspense fallback={<Loading />}>
      <StoreLoader slug={slug} />
    </Suspense>
  )
}

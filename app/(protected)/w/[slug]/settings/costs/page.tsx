import { CostsContent } from './costs-content'

export default async function CostsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <CostsContent slug={slug} />
}

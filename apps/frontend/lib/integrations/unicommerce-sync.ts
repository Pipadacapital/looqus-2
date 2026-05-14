import { prisma } from '@/lib/prisma'
import {
  createInventoryExportJob,
  downloadAndParseInventoryCsv,
  fetchItemDetails,
  getInventorySnapshot,
  getValidToken,
  pollExportJobUntilDone,
  searchFacilities,
} from '@/lib/integrations/unicommerce'

export async function syncUnicommerceProducts(connectionId: string): Promise<{
  synced: number
  errors: number
  totalSkus: number
  facilities: number
}> {
  const connection = await prisma.unicommerceConnection.findUnique({
    where: { id: connectionId },
  })
  if (!connection) throw new Error('Connection not found')

  const token = await getValidToken(connection)
  await prisma.unicommerceConnection.update({
    where: { id: connectionId },
    data: { accessToken: token, tokenObtainedAt: new Date() },
  })

  let facilityCodes = connection.facilityCodes
  if (facilityCodes.length === 0) {
    try {
      facilityCodes = await searchFacilities(connection.tenant, token)
      await prisma.unicommerceConnection.update({
        where: { id: connectionId },
        data: { facilityCodes },
      })
    } catch {
      throw new Error('No facility codes found. Check Unicommerce account access.')
    }
  }

  const skuInventoryMap = new Map<string, number>()
  const skuFacilityMap = new Map<string, string>()

  for (const facilityCode of facilityCodes) {
    try {
      // Step 1: Create export job
      const jobCode = await createInventoryExportJob(
        connection.tenant,
        token,
        facilityCode
      )

      // Step 2: Poll until done (up to 2 min)
      const filePath = await pollExportJobUntilDone(
        connection.tenant,
        token,
        jobCode
      )

      // Step 3: Download and parse CSV
      const skus = await downloadAndParseInventoryCsv(filePath)

      for (const s of skus) {
        const existing = skuInventoryMap.get(s.skuCode) ?? 0
        skuInventoryMap.set(s.skuCode, existing + s.inventory)
        if (!skuFacilityMap.has(s.skuCode)) {
          skuFacilityMap.set(s.skuCode, facilityCode)
        }
      }
    } catch (e) {
      console.warn(`[UC sync] Export job failed for facility ${facilityCode}:`, e)

      // Fallback: use 24h inventory snapshot if export job fails
      try {
        const snapshots = await getInventorySnapshot(
          connection.tenant,
          token,
          facilityCode,
          undefined,
          1440
        )
        for (const s of snapshots) {
          const existing = skuInventoryMap.get(s.skuCode) ?? 0
          skuInventoryMap.set(s.skuCode, existing + s.inventory)
          if (!skuFacilityMap.has(s.skuCode)) {
            skuFacilityMap.set(s.skuCode, facilityCode)
          }
        }
      } catch (fallbackErr) {
        console.warn(`[UC sync] Fallback snapshot also failed:`, fallbackErr)
      }
    }
  }

  const allSkus = Array.from(skuInventoryMap.keys())

  let synced = 0
  let errors = 0
  const DELAY_MS = 100
  const defaultFacility = facilityCodes[0]

  for (let i = 0; i < allSkus.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS))
    const skuCode = allSkus[i]
    const facilityCode = skuFacilityMap.get(skuCode) ?? defaultFacility

    try {
      const item = await fetchItemDetails(
        connection.tenant,
        token,
        facilityCode,
        skuCode
      )

      await prisma.unicommerceProduct.upsert({
        where: {
          connectionId_skuCode: {
            connectionId: connection.id,
            skuCode,
          },
        },
        create: {
          connectionId: connection.id,
          skuCode,
          name: item?.name ?? skuCode,
          brand: item.brand ?? null,
          mrp: item?.maxRetailPrice ?? item?.basePrice ?? null,
          imageUrl: item.imageUrl ?? null,
          enabled: item.enabled ?? true,
          inventory: skuInventoryMap.get(skuCode) ?? null,
          rawJson: item ?? {},
          syncedAt: new Date(),
        },
        update: {
          name: item?.name ?? skuCode,
          brand: item?.brand ?? null,
          mrp: item?.maxRetailPrice ?? item?.basePrice ?? null,
          imageUrl: item?.imageUrl ?? null,
          enabled: item?.enabled ?? true,
          inventory: skuInventoryMap.get(skuCode) ?? undefined,
          rawJson: item ?? undefined,
          syncedAt: new Date(),
        },
      })
      synced++
    } catch {
      errors++
    }
  }

  await prisma.unicommerceConnection.update({
    where: { id: connectionId },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: errors > 0 ? `${errors} of ${allSkus.length} items failed` : null,
    },
  })

  return {
    synced,
    errors,
    totalSkus: allSkus.length,
    facilities: facilityCodes.length,
  }
}

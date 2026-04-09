const UNICOMMERCE_CLIENT_ID = 'my-trusted-client'

export function getUnicommerceBaseUrl(tenant: string): string {
  return `https://${tenant}.unicommerce.com`
}

export async function getUnicommerceToken(
  tenant: string,
  username: string,
  password: string
): Promise<{ accessToken: string; tokenType: string }> {
  const url =
    `${getUnicommerceBaseUrl(tenant)}/oauth/token` +
    `?grant_type=password` +
    `&client_id=${UNICOMMERCE_CLIENT_ID}` +
    `&username=${encodeURIComponent(username)}` +
    `&password=${encodeURIComponent(password)}`

  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`Unicommerce auth failed: ${res.status}`)
  const data = await res.json()
  if (!data.access_token) throw new Error('No access_token in response')
  return { accessToken: data.access_token, tokenType: data.token_type ?? 'bearer' }
}

export async function getValidToken(connection: {
  tenant: string
  username: string
  password: string
  accessToken: string | null
  tokenObtainedAt: Date | null
}): Promise<string> {
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000)
  if (
    connection.accessToken &&
    connection.tokenObtainedAt &&
    connection.tokenObtainedAt > eightHoursAgo
  ) {
    return connection.accessToken
  }

  const { accessToken } = await getUnicommerceToken(
    connection.tenant,
    connection.username,
    connection.password
  )
  return accessToken
}

export async function searchFacilities(
  tenant: string,
  accessToken: string
): Promise<string[]> {
  const url = `${getUnicommerceBaseUrl(tenant)}/services/rest/v1/facility/search`
  const now = new Date().toISOString()
  const past = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      facilityStatus: 'ALL',
      fromDate: past,
      toDate: now,
      dateType: 'UPDATED',
    }),
  })
  if (!res.ok) throw new Error(`Facility search failed: ${res.status}`)
  const data = await res.json()
  if (!data.successful)
    throw new Error(`Facility search error: ${data.errors?.[0]?.message}`)
  return (data.parties ?? []).map((p: any) => p.facilityCode).filter(Boolean)
}

export async function getInventorySnapshot(
  tenant: string,
  accessToken: string,
  facilityCode: string,
  skuCodes?: string[],
  updatedSinceInMinutes?: number
): Promise<Array<{ skuCode: string; inventory: number }>> {
  const url = `${getUnicommerceBaseUrl(tenant)}/services/rest/v1/inventory/inventorySnapshot/get`
  const body: any = {}
  if (skuCodes && skuCodes.length > 0) body.itemTypeSKUs = skuCodes
  if (updatedSinceInMinutes) {
    body.updatedSinceInMinutes = Math.min(updatedSinceInMinutes, 1440)
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Facility: facilityCode,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Inventory snapshot failed (${facilityCode}): ${res.status}`)
  }
  const data = await res.json()
  return (data.inventorySnapshots ?? []).map((s: any) => ({
    skuCode: s.itemTypeSKU,
    inventory: s.inventory ?? 0,
  }))
}

// Step 1: Create an export job for Inventory Snapshot
export async function createInventoryExportJob(
  tenant: string,
  accessToken: string,
  facilityCode: string
): Promise<string> {
  const url = `${getUnicommerceBaseUrl(tenant)}/services/rest/v1/export/job/create`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Facility: facilityCode,
    },
    body: JSON.stringify({
      exportJobTypeName: 'Inventory Snapshot',
      exportColums: [],
      reportName: 'Brain-Inventory-Sync',
    }),
  })
  const rawBody = await res.text()
  let data: any = null
  try {
    data = JSON.parse(rawBody)
  } catch {
    data = { rawBody }
  }
  console.log('[UC export job] response:', JSON.stringify(data))
  if (!res.ok) throw new Error(`Export job create failed: ${res.status}`)
  if (!data.successful)
    throw new Error(`Export job error: ${data.errors?.[0]?.message}`)
  const jobCode = data.jobCode ?? data.exportJobId
  if (!jobCode) throw new Error('No jobCode in export job response')
  return jobCode
}

// Step 2: Poll export job status until SUCCESSFUL
export async function pollExportJobUntilDone(
  tenant: string,
  accessToken: string,
  jobCode: string,
  maxWaitMs = 120000
): Promise<string> {
  const url = `${getUnicommerceBaseUrl(tenant)}/services/rest/v1/export/job/status`
  const pollIntervalMs = 3000
  const maxAttempts = Math.ceil(maxWaitMs / pollIntervalMs)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ jobCode }),
    })
    if (!res.ok) throw new Error(`Export job status failed: ${res.status}`)
    const data = await res.json()

    if (data.status === 'SUCCESSFUL' && data.filePath) {
      return data.filePath
    }
    if (data.status === 'FAILED') {
      throw new Error('Export job failed')
    }
  }
  throw new Error('Export job timed out after 2 minutes')
}

// Step 3: Download and parse the CSV file
// Returns array of { skuCode, name, inventory } from the CSV
export async function downloadAndParseInventoryCsv(
  filePath: string
): Promise<Array<{ skuCode: string; inventory: number }>> {
  const res = await fetch(filePath)
  if (!res.ok) throw new Error(`CSV download failed: ${res.status}`)
  const text = await res.text()

  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0]
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/"/g, ''))
  const skuIdx = headers.findIndex(
    (h) => h.includes('sku') || h.includes('item type sku')
  )
  const invIdx = headers.findIndex(
    (h) =>
      h.includes('inventory') ||
      h.includes('open quantity') ||
      h.includes('available')
  )

  if (skuIdx === -1) throw new Error('SKU column not found in CSV')

  const results: Array<{ skuCode: string; inventory: number }> = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/"/g, ''))
    const skuCode = cols[skuIdx]
    if (!skuCode) continue
    const inventory = invIdx !== -1 ? parseInt(cols[invIdx]) || 0 : 0
    results.push({ skuCode, inventory })
  }
  return results
}

export async function fetchItemDetails(
  tenant: string,
  accessToken: string,
  facilityCode: string,
  skuCode: string
): Promise<any | null> {
  const url = `${getUnicommerceBaseUrl(tenant)}/services/rest/v1/catalog/itemType/get`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      Facility: facilityCode,
    },
    body: JSON.stringify({ skuCode }),
  })

  if (!res.ok) return null
  const data = await res.json()
  if (!data.successful) return null
  return data.itemTypeDTO ?? data.itemType ?? null
}

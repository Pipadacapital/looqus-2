import type { Prisma, PrismaClient } from '@prisma/client'
import { INDIA_FESTIVAL_TEMPLATES } from './india-festival-calendar'

export async function seedFestivalsForWorkspace(
  prisma: PrismaClient | Prisma.TransactionClient,
  workspaceId: string
) {
  for (const f of INDIA_FESTIVAL_TEMPLATES) {
    await prisma.workspaceFestival.upsert({
      where: {
        workspaceId_name_startDate: {
          workspaceId,
          name: f.name,
          startDate: new Date(`${f.startDate}T00:00:00.000Z`),
        },
      },
      create: {
        workspaceId,
        name: f.name,
        startDate: new Date(`${f.startDate}T00:00:00.000Z`),
        endDate: new Date(`${f.endDate}T23:59:59.999Z`),
        color: f.color,
        expectedMultiplier: f.expectedMultiplier,
        regions: f.regions,
        categories: f.categories,
        isTemplate: true,
        isActive: true,
      },
      update: {
        name: f.name,
        endDate: new Date(`${f.endDate}T23:59:59.999Z`),
        color: f.color,
        expectedMultiplier: f.expectedMultiplier,
        regions: f.regions,
        categories: f.categories,
        isTemplate: true,
      },
    })
  }
}

export interface FestivalTemplate {
  name: string
  year: number
  startDate: string
  endDate: string
  color: string
  expectedMultiplier: number
  regions: string[]
  categories: string[]
}

export const INDIA_FESTIVAL_TEMPLATES: FestivalTemplate[] = [
  // 2024
  { name: "Makar Sankranti", year: 2024, startDate: "2024-01-14", endDate: "2024-01-14", color: "#F59E0B", expectedMultiplier: 1.3, regions: [], categories: ["all"] },
  { name: "Republic Day Sale", year: 2024, startDate: "2024-01-24", endDate: "2024-01-26", color: "#3B82F6", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Valentine's Week", year: 2024, startDate: "2024-02-07", endDate: "2024-02-14", color: "#EC4899", expectedMultiplier: 1.5, regions: [], categories: ["beauty", "fashion", "gifting"] },
  { name: "Holi", year: 2024, startDate: "2024-03-24", endDate: "2024-03-25", color: "#EC4899", expectedMultiplier: 1.8, regions: [], categories: ["beauty", "fashion", "skincare"] },
  { name: "Gudi Padwa / Ugadi", year: 2024, startDate: "2024-04-09", endDate: "2024-04-09", color: "#10B981", expectedMultiplier: 1.4, regions: ["Maharashtra", "Karnataka", "Andhra Pradesh", "Telangana"], categories: ["home", "fashion"] },
  { name: "Eid ul-Fitr", year: 2024, startDate: "2024-04-10", endDate: "2024-04-11", color: "#10B981", expectedMultiplier: 2.0, regions: [], categories: ["fashion", "beauty", "food", "gifting"] },
  { name: "Akshaya Tritiya", year: 2024, startDate: "2024-05-10", endDate: "2024-05-10", color: "#F59E0B", expectedMultiplier: 1.6, regions: [], categories: ["jewelry", "home", "gifting"] },
  { name: "Mother's Day", year: 2024, startDate: "2024-05-12", endDate: "2024-05-12", color: "#EC4899", expectedMultiplier: 1.4, regions: [], categories: ["beauty", "gifting", "fashion"] },
  { name: "Eid ul-Adha", year: 2024, startDate: "2024-06-17", endDate: "2024-06-19", color: "#10B981", expectedMultiplier: 1.6, regions: [], categories: ["fashion", "food", "gifting"] },
  { name: "Independence Day Sale", year: 2024, startDate: "2024-08-13", endDate: "2024-08-15", color: "#F97316", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Onam", year: 2024, startDate: "2024-09-05", endDate: "2024-09-15", color: "#8B5CF6", expectedMultiplier: 2.2, regions: ["Kerala"], categories: ["all"] },
  { name: "Navratri", year: 2024, startDate: "2024-10-03", endDate: "2024-10-12", color: "#EF4444", expectedMultiplier: 1.8, regions: ["Gujarat", "Maharashtra", "Rajasthan"], categories: ["fashion", "beauty", "jewelry", "footwear"] },
  { name: "Dussehra", year: 2024, startDate: "2024-10-12", endDate: "2024-10-12", color: "#EF4444", expectedMultiplier: 2.0, regions: [], categories: ["all"] },
  { name: "Karwa Chauth", year: 2024, startDate: "2024-10-20", endDate: "2024-10-20", color: "#EC4899", expectedMultiplier: 1.5, regions: [], categories: ["beauty", "jewelry", "fashion"] },
  { name: "Dhanteras", year: 2024, startDate: "2024-10-29", endDate: "2024-10-30", color: "#F59E0B", expectedMultiplier: 3.0, regions: [], categories: ["jewelry", "electronics", "home", "kitchenware"] },
  { name: "Diwali", year: 2024, startDate: "2024-10-29", endDate: "2024-11-02", color: "#F59E0B", expectedMultiplier: 4.0, regions: [], categories: ["all"] },
  { name: "Wedding Season (Winter)", year: 2024, startDate: "2024-11-15", endDate: "2025-02-15", color: "#8B5CF6", expectedMultiplier: 1.6, regions: [], categories: ["fashion", "beauty", "jewelry", "gifting"] },
  { name: "Christmas & New Year", year: 2024, startDate: "2024-12-20", endDate: "2025-01-05", color: "#3B82F6", expectedMultiplier: 1.4, regions: [], categories: ["all"] },

  // 2025
  { name: "Makar Sankranti", year: 2025, startDate: "2025-01-14", endDate: "2025-01-14", color: "#F59E0B", expectedMultiplier: 1.3, regions: [], categories: ["all"] },
  { name: "Republic Day Sale", year: 2025, startDate: "2025-01-24", endDate: "2025-01-26", color: "#3B82F6", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Valentine's Week", year: 2025, startDate: "2025-02-07", endDate: "2025-02-14", color: "#EC4899", expectedMultiplier: 1.5, regions: [], categories: ["beauty", "fashion", "gifting"] },
  { name: "Holi", year: 2025, startDate: "2025-03-13", endDate: "2025-03-14", color: "#EC4899", expectedMultiplier: 1.8, regions: [], categories: ["beauty", "fashion", "skincare"] },
  { name: "Gudi Padwa / Ugadi", year: 2025, startDate: "2025-03-30", endDate: "2025-03-30", color: "#10B981", expectedMultiplier: 1.4, regions: ["Maharashtra", "Karnataka", "Andhra Pradesh", "Telangana"], categories: ["home", "fashion"] },
  { name: "Eid ul-Fitr", year: 2025, startDate: "2025-03-30", endDate: "2025-04-01", color: "#10B981", expectedMultiplier: 2.0, regions: [], categories: ["fashion", "beauty", "food", "gifting"] },
  { name: "Akshaya Tritiya", year: 2025, startDate: "2025-04-30", endDate: "2025-04-30", color: "#F59E0B", expectedMultiplier: 1.6, regions: [], categories: ["jewelry", "home", "gifting"] },
  { name: "Mother's Day", year: 2025, startDate: "2025-05-11", endDate: "2025-05-11", color: "#EC4899", expectedMultiplier: 1.4, regions: [], categories: ["beauty", "gifting", "fashion"] },
  { name: "Eid ul-Adha", year: 2025, startDate: "2025-06-07", endDate: "2025-06-09", color: "#10B981", expectedMultiplier: 1.6, regions: [], categories: ["fashion", "food", "gifting"] },
  { name: "Independence Day Sale", year: 2025, startDate: "2025-08-13", endDate: "2025-08-15", color: "#F97316", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Onam", year: 2025, startDate: "2025-08-25", endDate: "2025-09-04", color: "#8B5CF6", expectedMultiplier: 2.2, regions: ["Kerala"], categories: ["all"] },
  { name: "Navratri", year: 2025, startDate: "2025-09-22", endDate: "2025-10-02", color: "#EF4444", expectedMultiplier: 1.8, regions: ["Gujarat", "Maharashtra", "Rajasthan"], categories: ["fashion", "beauty", "jewelry", "footwear"] },
  { name: "Dussehra", year: 2025, startDate: "2025-10-02", endDate: "2025-10-02", color: "#EF4444", expectedMultiplier: 2.0, regions: [], categories: ["all"] },
  { name: "Karwa Chauth", year: 2025, startDate: "2025-10-20", endDate: "2025-10-20", color: "#EC4899", expectedMultiplier: 1.5, regions: [], categories: ["beauty", "jewelry", "fashion"] },
  { name: "Dhanteras", year: 2025, startDate: "2025-10-20", endDate: "2025-10-21", color: "#F59E0B", expectedMultiplier: 3.0, regions: [], categories: ["jewelry", "electronics", "home", "kitchenware"] },
  { name: "Diwali", year: 2025, startDate: "2025-10-20", endDate: "2025-10-24", color: "#F59E0B", expectedMultiplier: 4.0, regions: [], categories: ["all"] },
  { name: "Bhai Dooj", year: 2025, startDate: "2025-10-26", endDate: "2025-10-26", color: "#F59E0B", expectedMultiplier: 1.5, regions: [], categories: ["gifting"] },
  { name: "Wedding Season (Winter)", year: 2025, startDate: "2025-11-15", endDate: "2026-02-15", color: "#8B5CF6", expectedMultiplier: 1.6, regions: [], categories: ["fashion", "beauty", "jewelry", "gifting"] },
  { name: "Christmas & New Year", year: 2025, startDate: "2025-12-20", endDate: "2026-01-05", color: "#3B82F6", expectedMultiplier: 1.4, regions: [], categories: ["all"] },

  // 2026
  { name: "Makar Sankranti", year: 2026, startDate: "2026-01-14", endDate: "2026-01-14", color: "#F59E0B", expectedMultiplier: 1.3, regions: [], categories: ["all"] },
  { name: "Republic Day Sale", year: 2026, startDate: "2026-01-24", endDate: "2026-01-26", color: "#3B82F6", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Valentine's Week", year: 2026, startDate: "2026-02-07", endDate: "2026-02-14", color: "#EC4899", expectedMultiplier: 1.5, regions: [], categories: ["beauty", "fashion", "gifting"] },
  { name: "Holi", year: 2026, startDate: "2026-03-03", endDate: "2026-03-04", color: "#EC4899", expectedMultiplier: 1.8, regions: [], categories: ["beauty", "fashion", "skincare"] },
  { name: "Gudi Padwa / Ugadi", year: 2026, startDate: "2026-03-19", endDate: "2026-03-19", color: "#10B981", expectedMultiplier: 1.4, regions: ["Maharashtra", "Karnataka", "Andhra Pradesh", "Telangana"], categories: ["home", "fashion"] },
  { name: "Eid ul-Fitr", year: 2026, startDate: "2026-03-20", endDate: "2026-03-21", color: "#10B981", expectedMultiplier: 2.0, regions: [], categories: ["fashion", "beauty", "food", "gifting"] },
  { name: "Akshaya Tritiya", year: 2026, startDate: "2026-04-19", endDate: "2026-04-19", color: "#F59E0B", expectedMultiplier: 1.6, regions: [], categories: ["jewelry", "home", "gifting"] },
  { name: "Mother's Day", year: 2026, startDate: "2026-05-10", endDate: "2026-05-10", color: "#EC4899", expectedMultiplier: 1.4, regions: [], categories: ["beauty", "gifting", "fashion"] },
  { name: "Independence Day Sale", year: 2026, startDate: "2026-08-13", endDate: "2026-08-15", color: "#F97316", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Onam", year: 2026, startDate: "2026-09-13", endDate: "2026-09-23", color: "#8B5CF6", expectedMultiplier: 2.2, regions: ["Kerala"], categories: ["all"] },
  { name: "Navratri", year: 2026, startDate: "2026-10-11", endDate: "2026-10-21", color: "#EF4444", expectedMultiplier: 1.8, regions: ["Gujarat", "Maharashtra", "Rajasthan"], categories: ["fashion", "beauty", "jewelry", "footwear"] },
  { name: "Dussehra", year: 2026, startDate: "2026-10-21", endDate: "2026-10-21", color: "#EF4444", expectedMultiplier: 2.0, regions: [], categories: ["all"] },
  { name: "Dhanteras", year: 2026, startDate: "2026-11-07", endDate: "2026-11-08", color: "#F59E0B", expectedMultiplier: 3.0, regions: [], categories: ["jewelry", "electronics", "home"] },
  { name: "Diwali", year: 2026, startDate: "2026-11-08", endDate: "2026-11-12", color: "#F59E0B", expectedMultiplier: 4.0, regions: [], categories: ["all"] },
  { name: "Wedding Season (Winter)", year: 2026, startDate: "2026-11-20", endDate: "2027-02-15", color: "#8B5CF6", expectedMultiplier: 1.6, regions: [], categories: ["fashion", "beauty", "jewelry", "gifting"] },
  { name: "Christmas & New Year", year: 2026, startDate: "2026-12-20", endDate: "2027-01-05", color: "#3B82F6", expectedMultiplier: 1.4, regions: [], categories: ["all"] },

  // 2027
  { name: "Makar Sankranti", year: 2027, startDate: "2027-01-14", endDate: "2027-01-14", color: "#F59E0B", expectedMultiplier: 1.3, regions: [], categories: ["all"] },
  { name: "Republic Day Sale", year: 2027, startDate: "2027-01-24", endDate: "2027-01-26", color: "#3B82F6", expectedMultiplier: 1.5, regions: [], categories: ["all"] },
  { name: "Holi", year: 2027, startDate: "2027-03-22", endDate: "2027-03-23", color: "#EC4899", expectedMultiplier: 1.8, regions: [], categories: ["beauty", "fashion", "skincare"] },
  { name: "Diwali", year: 2027, startDate: "2027-10-29", endDate: "2027-11-02", color: "#F59E0B", expectedMultiplier: 4.0, regions: [], categories: ["all"] },
]

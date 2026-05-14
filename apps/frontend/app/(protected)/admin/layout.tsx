import { redirect } from 'next/navigation'
import { getCurrentUserRole } from '@/lib/require-superadmin'
import React from 'react'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const role = await getCurrentUserRole()
  if (role !== 'SUPERADMIN') {
    redirect('/')
  }

  return <>{children}</>
}

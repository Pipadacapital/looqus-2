'use client'

import { createContext, useContext } from 'react'

export type WorkspaceData = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  plan: string
}

export type WorkspaceMembership = {
  role: string
  workspace: WorkspaceData
}

type WorkspaceContextValue = {
  current: WorkspaceData
  role: string
  all: WorkspaceMembership[]
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({
  children,
  value,
}: {
  children: React.ReactNode
  value: WorkspaceContextValue
}) {
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}

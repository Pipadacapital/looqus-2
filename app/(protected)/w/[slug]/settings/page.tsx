import { createClient } from '@/lib/server'
import { redirect } from 'next/navigation'
import { CogsSettingsContent } from './cogs-settings-content'
import { WorkspaceSettingsContent } from './workspace-settings-content'

export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  return (
    <div className="mx-auto flex w-full justify-center items-center flex-col gap-10 py-4 md:py-6">
      <WorkspaceSettingsContent />
      <CogsSettingsContent />
    </div>
  )
}

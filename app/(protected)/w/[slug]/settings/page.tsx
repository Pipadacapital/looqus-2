import { CogsSettingsContent } from './cogs-settings-content'
import { FiltersSettingsContent } from './filters-settings-content'
import { WorkspaceSettingsContent } from './workspace-settings-content'

// Layout already validates auth — no duplicate check needed here.
export default async function SettingsPage() {
  return (
    <div className="mx-auto flex w-full justify-center items-center flex-col gap-10 py-4 md:py-6">
      <WorkspaceSettingsContent />
      <FiltersSettingsContent />
      <CogsSettingsContent />
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  IconArrowLeft,
  IconDeviceLaptop,
  IconLoader2,
  IconShieldLock,
  IconTrash,
  IconUser,
} from '@tabler/icons-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/client'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

type AccountUser = {
  id: string
  email: string
  fullName: string
  jobRole: string
  avatarUrl: string | null
  createdAt: string
}

interface AccountContentProps {
  user: AccountUser
  hasPassword: boolean
  isGoogleAuth: boolean
  backSlug: string | null
}

function getInitials(name: string, email: string) {
  if (name.trim()) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }
  return email[0]?.toUpperCase() ?? 'U'
}

export function AccountContent({ user, hasPassword, isGoogleAuth, backSlug }: AccountContentProps) {
  const router = useRouter()

  // Profile state
  const [fullName, setFullName] = useState(user.fullName)
  const [jobRole, setJobRole] = useState(user.jobRole)
  const [savingProfile, setSavingProfile] = useState(false)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  // Sessions state
  const [signingOut, setSigningOut] = useState(false)

  // Delete state
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const backHref = backSlug ? `/w/${backSlug}/dashboard` : '/'
  const initials = getInitials(fullName || user.fullName, user.email)

  // ── Profile ────────────────────────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!fullName.trim()) {
      toast.error('Full name is required')
      return
    }
    setSavingProfile(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, jobRole }),
      })
      if (!res.ok) throw new Error()
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  // ── Password ───────────────────────────────────────────────────────────────
  const handleChangePassword = async () => {
    if (!newPassword) {
      toast.error('New password is required')
      return
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setSavingPassword(true)
    try {
      const supabase = createClient()

      // If user has a password, re-authenticate first
      if (hasPassword && currentPassword) {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        })
        if (signInErr) {
          toast.error('Current password is incorrect')
          return
        }
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      toast.success('Password updated successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      toast.error('Failed to update password')
    } finally {
      setSavingPassword(false)
    }
  }

  // ── Sessions ───────────────────────────────────────────────────────────────
  const handleSignOutOtherSessions = async () => {
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut({ scope: 'others' })
      toast.success('Signed out of all other devices')
    } catch {
      toast.error('Failed to sign out other sessions')
    } finally {
      setSigningOut(false)
    }
  }

  // ── Delete account ─────────────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== user.email) return
    setDeleting(true)
    try {
      const res = await fetch('/api/user/account', { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Account deleted')
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/auth/login')
    } catch {
      toast.error('Failed to delete account. Please contact support.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="mx-auto max-w-2xl px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild className="h-8 w-8">
            <Link href={backHref}>
              <IconArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <span className="text-sm font-medium text-muted-foreground">
            Account Settings
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-2xl px-4 py-8 flex flex-col gap-6">
        {/* Page title + avatar */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-xl">
            <AvatarImage src={user.avatarUrl ?? ''} alt={fullName} />
            <AvatarFallback className="rounded-xl text-lg font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {fullName || user.email}
            </h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconUser className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Profile</CardTitle>
            </div>
            <CardDescription>
              {isGoogleAuth
                ? 'Your name and email are managed by your Google account.'
                : 'Update your display name and role visible to teammates.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="fullName">Full name</Label>
              {isGoogleAuth ? (
                <p id="fullName" className="text-sm py-2 px-3 rounded-md bg-muted/50">
                  {user.fullName || user.email}
                </p>
              ) : (
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={user.email} disabled />
              <p className="text-xs text-muted-foreground">
                {isGoogleAuth
                  ? 'Email is managed by your Google account.'
                  : 'Contact support to change your email address.'}
              </p>
            </div>
            {!isGoogleAuth && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="jobRole">Job role</Label>
                  <Input
                    id="jobRole"
                    value={jobRole}
                    onChange={(e) => setJobRole(e.target.value)}
                    placeholder="e.g. Head of Growth"
                  />
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleSaveProfile} disabled={savingProfile}>
                    {savingProfile && (
                      <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Save profile
                  </Button>
                </div>
              </>
            )}
            {isGoogleAuth && user.jobRole && (
              <div className="grid gap-2">
                <Label>Job role</Label>
                <p className="text-sm py-2 px-3 rounded-md bg-muted/50">
                  {user.jobRole}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Security (hidden for Google sign-in) ─────────────────────────── */}
        {!isGoogleAuth && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <IconShieldLock className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Password</CardTitle>
              </div>
              <CardDescription>
                Change your account password. Must be at least 8 characters.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {hasPassword && (
                <div className="grid gap-2">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    autoComplete="current-password"
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={handleChangePassword} disabled={savingPassword}>
                  {savingPassword && (
                    <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Update password
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Sessions ────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconDeviceLaptop className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Sessions</CardTitle>
            </div>
            <CardDescription>
              You&apos;re currently signed in on this device. Sign out of all
              other active sessions if you suspect unauthorized access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Current session</p>
                <p className="text-xs text-muted-foreground">
                  This device — active now
                </p>
              </div>
              <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full font-medium">
                Active
              </span>
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="outline"
                onClick={handleSignOutOtherSessions}
                disabled={signingOut}
              >
                {signingOut && (
                  <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Sign out other devices
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Danger zone ──────────────────────────────────────────────────── */}
        <Card className="border-destructive/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <IconTrash className="h-4 w-4 text-destructive" />
              <CardTitle className="text-base text-destructive">
                Danger Zone
              </CardTitle>
            </div>
            <CardDescription>
              Permanently delete your account and all associated data. This
              cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Delete account
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="flex flex-col gap-3">
                      <p>
                        This will permanently delete your account, remove you
                        from all workspaces, and erase all associated data.
                        This action <strong>cannot be undone</strong>.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Type <strong>{user.email}</strong> to confirm.
                      </p>
                      <Input
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={user.email}
                        className="mt-1"
                      />
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel onClick={() => setDeleteConfirmText('')}>
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteAccount}
                    disabled={deleteConfirmText !== user.email || deleting}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {deleting && (
                      <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Delete my account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-4">
          Member since{' '}
          {new Date(user.createdAt).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          })}
        </p>
      </div>
    </div>
  )
}

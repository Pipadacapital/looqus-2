'use client'

import { useState, useTransition } from 'react'
import {
  IconUserPlus,
  IconDotsVertical,
  IconTrash,
  IconClock,
  IconX,
  IconMail,
} from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  revokeInvitation,
  transferOwnership,
} from './actions'

const ROLES = [
  { value: 'ADMIN', label: 'Admin', description: 'Full access except billing' },
  { value: 'MANAGER', label: 'Manager', description: 'Manage team and data' },
  { value: 'ANALYST', label: 'Analyst', description: 'View and analyze data' },
  { value: 'VIEWER', label: 'Viewer', description: 'Read-only access' },
]

const ROLE_COLORS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  OWNER: 'default',
  ADMIN: 'secondary',
  MANAGER: 'secondary',
  ANALYST: 'outline',
  VIEWER: 'outline',
}

type Member = {
  id: string
  role: string
  joinedAt: string
  user: {
    id: string
    email: string
    fullName: string | null
    avatarUrl: string | null
  }
}

type PendingInvitation = {
  id: string
  email: string
  role: string
  expiresAt: string
  invitedBy: string
}

interface TeamContentProps {
  workspaceId: string
  workspaceSlug: string
  members: Member[]
  pendingInvitations: PendingInvitation[]
  canManage: boolean
  currentUserId: string
  currentUserRole: string
}

export function TeamContent({
  workspaceId,
  workspaceSlug,
  members,
  pendingInvitations,
  canManage,
  currentUserId,
  currentUserRole,
}: TeamContentProps) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('VIEWER')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleInvite = () => {
    if (!inviteEmail.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await inviteMember({
        workspaceId,
        workspaceSlug,
        email: inviteEmail.trim(),
        role: inviteRole,
      })
      if (result.error) {
        setError(result.error)
      } else {
        setInviteEmail('')
        setInviteRole('VIEWER')
        setInviteOpen(false)
      }
    })
  }

  const handleRoleChange = (memberId: string, newRole: string) => {
    startTransition(async () => {
      const result = await updateMemberRole({
        memberId,
        workspaceId,
        workspaceSlug,
        newRole,
      })
      if (result.error) setError(result.error)
    })
  }

  const handleRemove = (memberId: string) => {
    startTransition(async () => {
      const result = await removeMember({
        memberId,
        workspaceId,
        workspaceSlug,
      })
      if (result.error) setError(result.error)
    })
  }

  const handleRevoke = (invitationId: string) => {
    startTransition(async () => {
      const result = await revokeInvitation({
        invitationId,
        workspaceId,
        workspaceSlug,
      })
      if (result.error) setError(result.error)
    })
  }

  const handleTransferOwnership = (targetMemberId: string) => {
    startTransition(async () => {
      const result = await transferOwnership({
        targetMemberId,
        workspaceId,
        workspaceSlug,
      })
      if (result.error) setError(result.error)
    })
  }

  function getInitials(name: string | null, email: string) {
    if (name) {
      return name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    return email[0].toUpperCase()
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="text-sm text-muted-foreground">
            Manage members and their roles in this workspace.
          </p>
        </div>
        {canManage && (
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <IconUserPlus className="mr-1.5 h-4 w-4" />
                Invite member
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Invite team member</DialogTitle>
                <DialogDescription>
                  Send an invitation to join this workspace. They&apos;ll
                  receive an email with a link to accept.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          <div className="flex flex-col">
                            <span>{r.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {r.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setInviteOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={isPending || !inviteEmail.trim()}>
                  {isPending ? 'Sending...' : 'Send invitation'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {error && !inviteOpen && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Members table */}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="hidden md:table-cell">Joined</TableHead>
              {canManage && <TableHead className="w-12" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((member) => {
              const isCurrentUser = member.user.id === currentUserId
              const isOwner = member.role === 'OWNER'
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage
                          src={member.user.avatarUrl ?? undefined}
                          alt={member.user.fullName ?? member.user.email}
                        />
                        <AvatarFallback className="text-xs">
                          {getInitials(member.user.fullName, member.user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.user.fullName ?? member.user.email.split('@')[0]}
                          {isCurrentUser && (
                            <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {member.user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={ROLE_COLORS[member.role] ?? 'outline'}>
                      {member.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {new Date(member.joinedAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {!isCurrentUser && !isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <IconDotsVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger>Change role</DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {ROLES.map((r) => (
                                  <DropdownMenuItem
                                    key={r.value}
                                    onClick={() => handleRoleChange(member.id, r.value)}
                                    disabled={member.role === r.value}
                                  >
                                    <div className="flex flex-col">
                                      <span>{r.label}</span>
                                      <span className="text-xs text-muted-foreground">
                                        {r.description}
                                      </span>
                                    </div>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuSeparator />
                            {currentUserRole === 'OWNER' && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => handleTransferOwnership(member.id)}
                                  disabled={isPending}
                                >
                                  Transfer ownership
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            <DropdownMenuItem
                              onClick={() => handleRemove(member.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <IconTrash className="mr-2 h-4 w-4" />
                              Remove member
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pending invitations */}
      {pendingInvitations.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Pending invitations</h2>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Invited by</TableHead>
                  <TableHead className="hidden md:table-cell">Expires</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingInvitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                          <IconMail className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <span className="text-sm">{inv.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{inv.role}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {inv.invitedBy}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <IconClock className="h-3.5 w-3.5" />
                        {new Date(inv.expiresAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRevoke(inv.id)}
                          disabled={isPending}
                        >
                          <IconX className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}

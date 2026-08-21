'use client'

import { useEffect, useState } from 'react'
import {
  Users,
  Copy,
  Check,
  X,
  Crown,
  Shield,
  PencilSimple,
  Eye,
  Trash,
} from '@phosphor-icons/react'
import { useBlocksStore } from '@/store/useBlocksStore'
import type { WorkspaceMember, WorkspaceRole } from '@/lib/workspace'

const ROLE_LABELS: Record<WorkspaceRole, { label: string; icon: React.ElementType }> = {
  owner: { label: 'Chủ sở hữu', icon: Crown },
  admin: { label: 'Quản trị', icon: Shield },
  editor: { label: 'Biên tập', icon: PencilSimple },
  viewer: { label: 'Xem', icon: Eye },
}

const ROLE_OPTIONS: WorkspaceRole[] = ['admin', 'editor', 'viewer']

export default function WorkspaceSharing() {
  const workspaces = useBlocksStore((s) => s.workspaces)
  const activeWorkspaceId = useBlocksStore((s) => s.activeWorkspaceId)

  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('editor')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)

  useEffect(() => {
    if (!activeWorkspaceId) return
    // Load members (placeholder — real implementation uses Supabase)
    setMembers([])
  }, [activeWorkspaceId])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !activeWorkspaceId) return
    setLoading(true)
    // Placeholder: generate invite code locally
    const code = Math.random().toString(36).substring(2, 10).toUpperCase()
    setInviteCode(code)
    setLoading(false)
    setInviteEmail('')
  }

  const copyInviteCode = () => {
    if (!inviteCode) return
    navigator.clipboard.writeText(inviteCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const updateRole = (userId: string, newRole: WorkspaceRole) => {
    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m)),
    )
  }

  const removeMember = (userId: string) => {
    if (!window.confirm('Xóa thành viên này khỏi workspace?')) return
    setMembers((prev) => prev.filter((m) => m.user_id !== userId))
  }

  return (
    <div className="space-y-4">
      {/* Workspace info */}
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-accent" />
          <h3 className="text-[13px] font-semibold text-zinc-100">
            {activeWorkspace?.name ?? 'Workspace'}
          </h3>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          Chia sẻ workspace với team của bạn
        </p>
      </div>

      {/* Invite form */}
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <h4 className="mb-2 text-[12px] font-semibold text-zinc-200">Mời thành viên</h4>
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-accent"
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
            className="rounded-lg border border-border-subtle bg-background px-2 py-1.5 text-[11px] text-zinc-300 outline-none focus:border-accent"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleInvite}
            disabled={!inviteEmail.trim() || loading}
            className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            Mời
          </button>
        </div>

        {inviteCode && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
            <code className="flex-1 font-mono text-[13px] text-accent">{inviteCode}</code>
            <button
              type="button"
              onClick={copyInviteCode}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-accent"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
      </div>

      {/* Members list */}
      <div className="rounded-xl border border-border-subtle bg-surface p-4">
        <h4 className="mb-2 text-[12px] font-semibold text-zinc-200">
          Thành viên ({members.length})
        </h4>
        {members.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-zinc-500">
            Chưa có thành viên nào
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              const roleInfo = ROLE_LABELS[member.role]
              const RoleIcon = roleInfo.icon
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-border-subtle px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <RoleIcon size={14} className="text-zinc-500" />
                    <div>
                      <p className="text-[12px] text-zinc-200">{member.email}</p>
                      <p className="text-[10px] text-zinc-500">{roleInfo.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {member.role !== 'owner' && (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) => updateRole(member.user_id, e.target.value as WorkspaceRole)}
                          className="rounded border border-border-subtle bg-background px-1.5 py-0.5 text-[10px] text-zinc-400 outline-none"
                        >
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role].label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeMember(member.user_id)}
                          className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 hover:text-red-400"
                        >
                          <Trash size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { create } from 'zustand'

interface WorkspaceState {
  // Layout state (phục vụ cho animation GSAP sau này)
  isSidebarOpen: boolean
  activeRightPane: 'none' | 'editor' | 'preview' // Quản lý Split Screen
  selectedBlockId: string | null

  // Actions
  setSidebarOpen: (open: boolean) => void
  setActiveRightPane: (pane: 'none' | 'editor' | 'preview') => void
  setSelectedBlock: (id: string | null) => void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  // Khởi tạo mặc định
  isSidebarOpen: true,
  activeRightPane: 'none',
  selectedBlockId: null,

  // Hàm update state
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  setActiveRightPane: (pane) => set({ activeRightPane: pane }),
  setSelectedBlock: (id) => set({ selectedBlockId: id }),
}))
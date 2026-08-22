'use client'

import { useEffect } from 'react'
import { useBlocksStore } from '@/store/useBlocksStore'
import PWARegister from '@/components/PWARegister'

export default function WorkspaceRoot({ children }: { children: React.ReactNode }) {
  const loadBlocks = useBlocksStore((state) => state.loadBlocks)

  useEffect(() => {
    loadBlocks()
  }, [loadBlocks])

  return (
    <>
      <PWARegister />
      {children}
    </>
  )
}

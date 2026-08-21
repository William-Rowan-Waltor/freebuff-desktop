import { redirect } from 'next/navigation'
import Sidebar from '@/components/layout/Sidebar'
import MainWorkspace from '@/components/layout/MainWorkspace'
import WorkspaceRoot from '@/components/layout/WorkspaceRoot'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <WorkspaceRoot>
      <div className="flex h-[100dvh] w-screen overflow-hidden bg-background">
        <Sidebar />
        <MainWorkspace />
      </div>
    </WorkspaceRoot>
  )
}

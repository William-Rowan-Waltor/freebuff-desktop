'use client'

import { CheckCircle } from '@phosphor-icons/react'

/**
 * Small `☑ done/total` badge for blocks containing task lists. Turns green
 * when every checkbox is checked. Rendered only when `total > 0`.
 */
export default function TodoChip({ done, total }: { done: number; total: number }) {
  const complete = total > 0 && done === total
  return (
    <span
      title={`${done}/${total} việc đã hoàn thành`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] leading-none ${
        complete
          ? 'bg-emerald-500/15 text-emerald-400'
          : 'bg-zinc-800 text-zinc-400'
      }`}
    >
      <CheckCircle size={11} weight={complete ? 'fill' : 'regular'} />
      {done}/{total}
    </span>
  )
}

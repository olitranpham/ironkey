'use client'

import { useSearchParams } from 'next/navigation'

/** Return page for a trainer's card-setup link (lib/trainerBilling createCardSetupLink). */
export default function CardSavedPage() {
  const canceled = useSearchParams().get('canceled') === '1'
  return (
    <div className="min-h-screen bg-[#292929] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#1c1c1c] border border-white/10 rounded-2xl p-7 text-center flex flex-col gap-2">
        <h1 className="text-lg font-bold text-white">{canceled ? 'no card saved' : 'card saved'}</h1>
        <p className="text-sm text-neutral-400">
          {canceled ? 'open the link again whenever you’re ready.' : 'thanks — your card is on file for monthly trainer billing. you can close this tab.'}
        </p>
      </div>
    </div>
  )
}

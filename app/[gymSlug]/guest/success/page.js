'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

export default function GuestSuccessPage() {
  const { gymSlug } = useParams()
  const [gymName, setGymName] = useState('')

  useEffect(() => {
    fetch(`/api/${gymSlug}/guest`)
      .then(r => r.json())
      .then(({ gym }) => setGymName(gym?.name ?? gymSlug))
      .catch(() => {})
  }, [gymSlug])

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#1c1c1c] border border-neutral-800 rounded-2xl p-8 flex flex-col items-center text-center gap-5 shadow-2xl">

        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 size={28} className="text-emerald-400" />
        </div>

        <div>
          <h1 className="text-xl font-bold text-white">you're all set!</h1>
          <p className="text-sm text-neutral-400 mt-1">
            Welcome to {gymName || gymSlug}.
          </p>
        </div>

        <div className="w-full bg-neutral-900 rounded-xl p-4 text-left space-y-2">
          <p className="text-xs text-neutral-400 flex items-start gap-2">
            <span className="text-emerald-400 font-bold shrink-0">✓</span>
            Your guest pass is now active.
          </p>
          <p className="text-xs text-neutral-400 flex items-start gap-2">
            <span className="text-emerald-400 font-bold shrink-0">✓</span>
            Your access code will be sent to your email shortly.
          </p>
          <p className="text-xs text-neutral-400 flex items-start gap-2">
            <span className="text-emerald-400 font-bold shrink-0">✓</span>
            A receipt has been sent from Stripe.
          </p>
        </div>

        <p className="text-[11px] text-neutral-600">
          Questions? Contact {gymName || 'the gym'} directly.
        </p>

      </div>

      <p className="mt-6 text-[11px] text-neutral-700">
        powered by <span className="text-neutral-600 font-medium">ironkey</span>
      </p>
    </div>
  )
}

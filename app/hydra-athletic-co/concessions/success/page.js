'use client'

import { useState, useEffect } from 'react'

export default function ConcessionsSuccessPage() {
  const [gymLogo, setGymLogo] = useState(null)

  useEffect(() => {
    fetch('/api/hydra-athletic-co/concessions/items')
      .then(r => r.json())
      .then(({ gym }) => setGymLogo(gym?.logoUrl ?? null))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#1c1c1c] border border-neutral-800 rounded-2xl px-10 py-12 flex flex-col items-center text-center gap-6 shadow-2xl">
        {gymLogo && (
          <img src={gymLogo} alt="hydra athletic co" className="w-24 h-24 object-contain" />
        )}
        <div>
          <h1 className="text-3xl font-bold text-white">order placed!</h1>
          <p className="text-neutral-400 mt-2">enjoy.</p>
        </div>
      </div>

      <p className="mt-6 text-[11px] text-neutral-700">
        powered by <span className="text-neutral-600 font-medium">ironkey</span>
      </p>
    </div>
  )
}

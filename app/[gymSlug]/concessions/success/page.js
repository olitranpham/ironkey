'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

export default function ConcessionsSuccessPage() {
  const { gymSlug } = useParams()
  const [gymName, setGymName] = useState('')
  const [gymLogo, setGymLogo] = useState(null)

  useEffect(() => {
    fetch(`/api/${gymSlug}/concessions/items`)
      .then(r => r.json())
      .then(({ gym }) => {
        setGymName((gym?.name ?? gymSlug).replace(/-/g, ' '))
        setGymLogo(gym?.logoUrl ?? null)
      })
      .catch(() => {})
  }, [gymSlug])

  return (
    <div className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md bg-[#1c1c1c] border border-neutral-800 rounded-2xl px-10 py-12 flex flex-col items-center text-center gap-6 shadow-2xl">
        {gymLogo && (
          <img src={gymLogo} alt={gymName} className="w-24 h-24 object-contain" />
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

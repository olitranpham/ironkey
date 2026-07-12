'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function JoinSuccessPage() {
  const { gymSlug } = useParams()
  const [gymName, setGymName] = useState('')

  useEffect(() => {
    fetch(`/api/${gymSlug}/join`)
      .then(r => r.json())
      .then(({ gym }) => setGymName(gym?.name ?? gymSlug))
      .catch(() => {})
  }, [gymSlug])

  return (
    <div
      className="min-h-screen bg-[#292929] flex flex-col items-center justify-center px-4"
      style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <style>{`
        @keyframes circleIn {
          0%   { transform: scale(0);   opacity: 0; }
          60%  { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
        @keyframes fadeUp {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .check-anim {
          animation: circleIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .content-anim {
          animation: fadeUp 0.4s ease forwards;
          animation-delay: 0.55s;
          opacity: 0;
        }
        .item-anim-1 {
          animation: fadeUp 0.35s ease forwards;
          animation-delay: 0.75s;
          opacity: 0;
        }
        .item-anim-2 {
          animation: fadeUp 0.35s ease forwards;
          animation-delay: 0.90s;
          opacity: 0;
        }
        .contact-anim {
          animation: fadeUp 0.35s ease forwards;
          animation-delay: 1.05s;
          opacity: 0;
        }
      `}</style>

      <div className="w-full max-w-lg bg-[#1c1c1c] border border-neutral-800 rounded-2xl px-10 py-12 flex flex-col items-center text-center gap-8 shadow-2xl">

        {/* Animated checkmark + heading */}
        <div className="flex flex-col items-center gap-0">
          <span className="check-anim" style={{ display: 'inline-block', fontSize: '88px', color: '#ffffff' }}>✓</span>
          <div className="content-anim flex flex-col gap-2">
            <h1 className="text-6xl font-bold text-white tracking-tight">you're in.</h1>
            {gymName && (
              <p className="text-xl text-neutral-400 font-medium">
                welcome to {gymName}.
              </p>
            )}
          </div>
        </div>

        {/* Checklist */}
        <div className="w-full flex flex-col gap-3">
          <div className="item-anim-1 w-full bg-white/5 rounded-full px-5 py-3 flex items-center gap-3 text-left">
            <span className="text-sm text-white shrink-0">—</span>
            <span className="text-sm text-gray-400">your membership is now active</span>
          </div>
          <div className="item-anim-2 w-full bg-white/5 rounded-full px-5 py-3 flex items-center gap-3 text-left">
            <span className="text-sm text-white shrink-0">—</span>
            <span className="text-sm text-gray-400">your access code will be sent to your email shortly</span>
          </div>
        </div>

        {/* Contact */}
        <p className="contact-anim text-xs text-neutral-600">
          questions? contact <span className="text-neutral-500">admin@ironkeyentry.com</span>
        </p>

      </div>

      <p className="mt-6 text-[11px] text-neutral-700">
        powered by <span className="text-neutral-600 font-medium">ironkey</span>
      </p>
    </div>
  )
}

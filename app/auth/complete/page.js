'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function AuthComplete() {
  const router       = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('ik_token')
    const gym   = searchParams.get('ik_gym')
    const role  = searchParams.get('ik_role')
    const err   = searchParams.get('error')

    if (err || !token || !gym) {
      router.replace(`/login${err ? `?error=${err}` : ''}`)
      return
    }

    try {
      const gymObj = JSON.parse(gym)
      localStorage.setItem('ik_token', token)
      localStorage.setItem('ik_gym',   JSON.stringify(gymObj))
      localStorage.setItem('ik_role',  role ?? '')
      router.replace(`/${gymObj.slug}/dashboard`)
    } catch {
      router.replace('/login?error=invalid_session')
    }
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#292929]">
      <p className="text-sm text-neutral-500">signing you in…</p>
    </div>
  )
}

export default function AuthCompletePage() {
  return (
    <Suspense>
      <AuthComplete />
    </Suspense>
  )
}

'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'

export default function AccessRedirect() {
  const { gymSlug } = useParams()
  const router      = useRouter()

  useEffect(() => {
    router.replace(`/${gymSlug}/guest-passes`)
  }, [gymSlug, router])

  return null
}

'use client'

import { useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'

/**
 * The open member drawer lives in the URL — ?member=<id>&tab=<tab> — so a
 * link or a refresh reopens the same member on the same tab. `defaultTab`
 * is the page's tab when the URL doesn't name one (it's then left out of the URL).
 */
export function useMemberParam(defaultTab = 'overview') {
  const router   = useRouter()
  const pathname = usePathname()
  const params   = useSearchParams()
  const memberId = params.get('member')
  const tab      = params.get('tab') || defaultTab

  const update = useCallback(next => {
    const q = new URLSearchParams(params.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value == null || (key === 'tab' && value === defaultTab)) q.delete(key)
      else q.set(key, value)
    }
    const qs = q.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [params, pathname, router, defaultTab])

  return {
    memberId,
    tab,
    openMember: useCallback((id, t = defaultTab) => update({ member: id, tab: t }), [update, defaultTab]),
    setTab:     useCallback(t => update({ tab: t }), [update]),
    close:      useCallback(() => update({ member: null, tab: null }), [update]),
  }
}

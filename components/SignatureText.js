import { Dancing_Script } from 'next/font/google'

const signatureFont = Dancing_Script({ subsets: ['latin'], weight: ['500'], display: 'swap' })

/** A typed signature rendered in the cursive signature font. */
export function SignatureText({ children, className = '' }) {
  return <span className={`${signatureFont.className} ${className}`}>{children}</span>
}

import './globals.css'

export const metadata = {
  title: 'triumph barbell - staff portal',
  description: 'gym management platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

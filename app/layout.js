import './globals.css'

export const metadata = {
  title: 'Ironkey',
  description: 'Gym management platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

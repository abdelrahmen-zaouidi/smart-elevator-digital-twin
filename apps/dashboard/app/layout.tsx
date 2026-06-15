import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ElevatorOS SCADA Platform',
  description: 'Professional industrial SCADA command center for digital twin elevator systems with AI analytics and predictive maintenance',
  generator: 'self-hosted',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="font-sans antialiased bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  )
}

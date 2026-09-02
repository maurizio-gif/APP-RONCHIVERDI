import { Jost, Cormorant_Garamond } from 'next/font/google'
import './globals.css'

// Gli stessi due caratteri del sito: Jost per l'interfaccia, Cormorant
// Garamond per i titoli. Sul sito arrivano da @fontsource, qui da next/font,
// che li serve dal nostro dominio e li carica senza flash di testo.
const jost = Jost({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-jost',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-cormorant',
})

export const metadata = {
  title: 'Pannello Ronchiverdi',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  // Permette "Aggiungi a Home" su iOS: si apre a schermo intero, come
  // un'app installata, che è come la segreteria lo usa dal telefono per
  // timbrare il cartellino.
  appleWebApp: {
    capable: true,
    title: 'Ronchiverdi',
    statusBarStyle: 'default',
  },
}

export const viewport = {
  themeColor: '#1c1c18',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${jost.variable} ${cormorant.variable}`}>
      <body>{children}</body>
    </html>
  )
}

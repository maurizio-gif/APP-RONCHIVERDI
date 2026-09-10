import { Jost, Cormorant_Garamond } from 'next/font/google'
import './globals.css'
import { SCRIPT_TEMA } from '@/lib/tema'

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
  title: 'CRM Ronchiverdi',
  icons: {
    icon: '/favicon.png',
    apple: '/apple-touch-icon.png',
  },
  // Permette "Aggiungi a Home" su iOS: si apre a schermo intero, come
  // un'app installata, che è come la segreteria lo usa dal telefono per
  // timbrare il cartellino.
  appleWebApp: {
    capable: true,
    // Etichetta sotto l'icona quando iOS salva l'app sulla Home: deve restare
    // allineata a name/short_name del manifest (app/manifest.ts), che è quello
    // che usa Android.
    title: 'CRM Ronchiverdi',
    statusBarStyle: 'default',
  },
}

export const viewport = {
  // Un valore solo, a differenza del pannello Athlon: qui la barra di sistema
  // affianca la topbar, che è il nero caldo della sidebar in tutti e due i
  // temi. Dichiararne due su `prefers-color-scheme` legherebbe il colore
  // all'impostazione del telefono, che con il tema scelto qui dentro non
  // c'entra niente — e sposterebbe quel nero di tre punti.
  themeColor: '#1c1c18',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${jost.variable} ${cormorant.variable}`}>
      <head>
        {/* Prima di qualunque cosa disegni: vedi il commento in lib/tema.ts.
            Un componente React girerebbe dopo il primo disegno, e per un
            istante si vedrebbe la pagina chiara prima che diventi scura. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  )
}

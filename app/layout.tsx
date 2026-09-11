import { Jost, Cormorant_Garamond } from 'next/font/google'
import './globals.css'
import { SCRIPT_TEMA } from '@/lib/tema'

// Gli stessi due caratteri del sito: Jost per l'interfaccia, Cormorant
// Garamond per i titoli. Sul sito arrivano da @fontsource, qui da next/font,
// che li serve dal nostro dominio e li carica senza flash di testo.
//
// Sono caratteri editoriali, e a misure piccole si rileggono: la leggibilità
// del pannello si è sistemata dove andava sistemata — la **scala** (il
// gradino più basso è 0.8rem, non gli 11.5px di prima), il **contrasto** dei
// grigi smorzati e dei bordi, e il peso 300 che non si usa più. Vedi il
// blocco dei token in app/globals.css. Il carattere resta quello del sito:
// il pannello deve sembrare la stessa casa vista da dietro.
const jost = Jost({
  subsets: ['latin'],
  // Niente 300: il fondo chiaro del pannello è crema, non bianco, e un peso
  // sottile su quel fondo perde il poco contrasto che ha.
  weight: ['400', '500', '600'],
  variable: '--font-jost',
})

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  // Il 600 in più: i titoli in Cormorant a 400 sono un filo grigio, e su
  // misure ora più grandi il peso medio regge meglio il fondo crema.
  weight: ['400', '500', '600'],
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

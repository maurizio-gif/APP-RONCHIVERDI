import type { MetadataRoute } from 'next'

// Il manifest è quello che decide se l'icona salvata sulla Home apre il
// pannello a schermo intero o dentro un browser con la barra dell'indirizzo.
// Su iOS il vecchio meta apple-mobile-web-app-capable (impostato nel layout)
// non basta più da solo sulle versioni recenti di Safari: serve un manifest
// con display "standalone".
//
// start_url punta a /dashboard perché è la schermata da cui la segreteria
// parte sempre; senza sessione valida il middleware rimanda a /login.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pannello Ronchiverdi',
    short_name: 'Ronchiverdi',
    description: 'Richieste dal sito, trattative e agenda del Ronchiverdi Sport Club.',
    lang: 'it',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f4ec',
    theme_color: '#1c1c18',
    // Ritagliate da design/icona-crm-2048.jpeg con lo script di quel commit:
    // la variante maskable è rimpicciolita perché Android ritaglia in tondo e
    // taglierebbe la scritta "Ronchiverdi CRM".
    icons: [
      {
        src: '/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/favicon.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

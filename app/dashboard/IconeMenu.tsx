// Le icone del menu laterale.
//
// SVG scritti a mano e non una libreria: servono quindici glifi, e react-icons
// o simili porterebbero un pacchetto intero — con il suo aggiornamento da
// seguire — per una barra laterale. Tutte a tratto, `currentColor`, così
// seguono da sole il colore della voce: grigio chiaro a riposo, oro quando la
// sezione è attiva, senza una regola CSS in più.
//
// Stanno qui e non in lib/auth/sezioni.ts perché quello è un file di soli
// dati, importato anche da Gestione utenti per le caselle dei permessi: il
// disegno è una questione del menu.

const COMUNI = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  className: 'nav-icona',
}

const DISEGNI: Record<string, React.ReactNode> = {
  // Dashboard: i riquadri del riepilogo.
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  agenda: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  // Club e Family: la stella dell'abbonamento, la voce di punta.
  'richieste-club': <path d="M12 3.5l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" />,
  // Tennis: la palla con la cucitura.
  'richieste-tennis-scuola': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5 5.5c3.5 2 5 5 5 6.5s-1.5 4.5-5 6.5M19 5.5c-3.5 2-5 5-5 6.5s1.5 4.5 5 6.5" />
    </>
  ),
  // Competizione: la stessa palla con la coppa accanto, cioè un trofeo.
  'richieste-tennis-competizione': (
    <>
      <path d="M7 4h10v4a5 5 0 0 1-10 0z" />
      <path d="M7 5H4.5v2a3 3 0 0 0 3 3M17 5h2.5v2a3 3 0 0 1-3 3" />
      <path d="M12 13v4M8.5 21h7l-.7-4h-5.6z" />
    </>
  ),
  // Nuoto: l'onda.
  'richieste-nuoto': <path d="M2 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0" />,
  // Triathlon: il fulmine dello sforzo su tre discipline.
  'richieste-triathlon': <path d="M13.5 2.5 5 13.5h5.5L9.5 21.5l8.5-11h-5.5z" />,
  // Summer camp: il sole.
  'richieste-summer-camp': (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </>
  ),
  // Chinesis: il tracciato del battito, il lavoro sul corpo.
  'richieste-chinesis': <path d="M2.5 12h4l2.5-6.5 4 13 2.5-6.5h6" />,
  // Padel: la racchetta piena, diversa dalla palla del tennis.
  'richieste-padel': (
    <>
      <path d="M12 2.5c4.1 0 7 3 7 6.8s-2.9 6.7-7 6.7-7-2.9-7-6.7 2.9-6.8 7-6.8z" />
      <path d="M12 16v5.5M10 21.5h4" />
    </>
  ),
  // Contatti: l'anagrafica, più persone.
  persone: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6" />
      <path d="M16.2 5.1a3.4 3.4 0 0 1 0 5.8M18.4 14.9c1.7.8 2.8 2.4 2.8 5.1" />
    </>
  ),
  analytics: (
    <>
      <path d="M3 21h18" />
      <path d="M6.5 21V12M12 21V5M17.5 21v-6" />
    </>
  ),
  // Visite al sito: il mondo da cui arriva il traffico.
  'visite-sito': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <path d="M12 3c-2.4 2.4-3.6 5.4-3.6 9s1.2 6.6 3.6 9c2.4-2.4 3.6-5.4 3.6-9S14.4 5.4 12 3z" />
    </>
  ),
  // Voucher: il tagliando con lo strappo.
  voucher: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 3v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-3z" />
      <path d="M14 7.5v1.5M14 11.2v1.6M14 15v1.5" />
    </>
  ),
  // Timbra cartellino: l'orologio.
  timbratura: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.5l3.5 2" />
    </>
  ),
  // Gestione utenti: la persona con lo scudo dei permessi.
  utenti: (
    <>
      <circle cx="10" cy="7.5" r="3.4" />
      <path d="M3.5 20c0-3.5 2.9-5.8 6.5-5.8" />
      <path d="M17 12.2l3.5 1.4v3.1c0 2-1.6 3.5-3.5 4.3-1.9-.8-3.5-2.3-3.5-4.3v-3.1z" />
    </>
  ),
  // Controllo operatori: il registro delle azioni.
  'log-operatori': (
    <>
      <path d="M5 3.5h14v17H5z" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
}

/** L'icona della voce di menu, o niente se quella chiave non ne ha una. */
export function IconaMenu({ chiave }: { chiave: string }) {
  const disegno = DISEGNI[chiave]
  if (!disegno) return null
  return <svg {...COMUNI}>{disegno}</svg>
}

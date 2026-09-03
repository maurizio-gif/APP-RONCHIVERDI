// Solo dati puri (nessun import server-only): importato sia da Server
// Component sia da componenti client (Sidebar, SezioniToggle). La logica che
// legge il permesso da Supabase sta in sezioni-server.ts.
//
// Il Riepilogo (/dashboard) è sempre visibile a chi è autenticato: non ha una
// chiave qui, solo le altre sezioni sono restringibili per utente.
//
// "gruppo" organizza il menu laterale; una voce senza gruppo resta in cima.
// "inArrivo" marca le sezioni il cui modulo non è ancora costruito: il
// permesso è già assegnabile da Gestione utenti, ma la voce di menu appare
// disattivata invece di portare a una pagina che non esiste. Quando il modulo
// arriva basta togliere il flag.
const DEFINIZIONI = [
  // "Core" sono le tre voci che si usano ogni giorno: la Dashboard (aggiunta
  // dalla Sidebar, non è una sezione assegnabile), l'agenda e le richieste
  // Club e Family. Stanno insieme in cima perché sono il lavoro corrente;
  // gli altri canali restano nel loro gruppo, che si consulta quando serve.
  //
  // La pagina che una persona della segreteria tiene aperta durante la
  // giornata: appuntamenti e cose da fare.
  { chiave: 'agenda', label: 'Agenda', href: '/dashboard/agenda', gruppo: 'Core' },
  // Le richieste dal form del sito, instradate al responsabile: una sezione
  // per canale, così ciascuno vede le proprie e non legge i contatti degli
  // altri. Le chiavi e i responsabili stanno in lib/richieste.ts — aggiungere
  // un corso significa aggiungere una voce là e una riga qui.
  //
  // Club e Family sta in Core e non fra i canali: è l'unico che passa dalla
  // segreteria e che alimenta agenda e trattative.
  {
    chiave: 'richieste-club',
    label: 'Abbonamento Club e Family',
    href: '/dashboard/richieste/richieste-club',
    gruppo: 'Core',
  },
  {
    chiave: 'richieste-tennis-scuola',
    label: 'Young School Tennis — Scuola',
    href: '/dashboard/richieste/richieste-tennis-scuola',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-tennis-competizione',
    label: 'Young School Tennis — Competizione',
    href: '/dashboard/richieste/richieste-tennis-competizione',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-nuoto',
    label: 'Young School Nuoto',
    href: '/dashboard/richieste/richieste-nuoto',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-triathlon',
    label: 'Young School Triathlon',
    href: '/dashboard/richieste/richieste-triathlon',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-summer-camp',
    label: 'Summer Camp',
    href: '/dashboard/richieste/richieste-summer-camp',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-chinesis',
    label: 'Chinesis',
    href: '/dashboard/richieste/richieste-chinesis',
    gruppo: 'Richieste dal sito',
  },
  {
    chiave: 'richieste-padel',
    label: 'Corsi Padel',
    href: '/dashboard/richieste/richieste-padel',
    gruppo: 'Richieste dal sito',
  },
  // Anagrafica deduplicata: una scheda per persona con tutte le sue richieste.
  // La chiave resta 'persone' — è il permesso salvato in staff_users e la
  // rotta: rinominarla vorrebbe dire migrare i permessi di tutti per un
  // cambio di etichetta.
  { chiave: 'persone', label: 'Contatti', href: '/dashboard/persone', gruppo: 'Anagrafica' },
  // Sessioni e campagne raccolte da /api/track sul sito.
  { chiave: 'analytics', label: 'Analytics', href: '/dashboard/analytics', gruppo: 'Amministrazione' },
  { chiave: 'visite-sito', label: 'Visite al sito', href: '/dashboard/visite', gruppo: 'Amministrazione' },
  { chiave: 'timbratura', label: 'Timbra cartellino', href: '/dashboard/timbratura', gruppo: 'Amministrazione' },
  { chiave: 'utenti', label: 'Gestione utenti', href: '/dashboard/utenti', gruppo: 'Amministrazione' },
  { chiave: 'log-operatori', label: 'Controllo operatori', href: '/dashboard/log-operatori', gruppo: 'Amministrazione' },
] as const

export type SezioneChiave = (typeof DEFINIZIONI)[number]['chiave']

export type Sezione = {
  chiave: SezioneChiave
  label: string
  href: string
  gruppo?: string
  inArrivo?: boolean
}

// L'array è dichiarato `as const` per ricavarne l'unione delle chiavi, ma
// esposto come readonly Sezione[]: senza l'annotazione, TypeScript tipizza
// ogni voce col suo letterale esatto e `s.inArrivo` non esisterebbe sulle
// voci che non lo hanno, rendendo impossibile filtrarci sopra.
export const SEZIONI: readonly Sezione[] = DEFINIZIONI

// Tutte le chiavi esistenti: è quello che si assegna a un nuovo invitato.
export const CHIAVI_SEZIONI: readonly SezioneChiave[] = SEZIONI.map((s) => s.chiave)

// Header con cui il middleware propaga al layout l'email già validata: il
// nome è specifico dell'app per non confondersi con quello di altri pannelli
// dello stesso gruppo (il CRM TCA usa x-tca-user-email).
//
// ATTENZIONE: lo stesso valore è ripetuto in middleware.ts, che lo scrive.
// Non può importarlo da qui — gira sull'Edge runtime e Vercel rifiuta il
// bundle di un'Edge Function che referenzia un modulo locale — quindi se
// cambia qui va cambiato anche là.
export const HEADER_EMAIL = 'x-rv-user-email'

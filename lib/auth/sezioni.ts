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
  // La pagina che una persona della segreteria tiene aperta durante la
  // giornata: appuntamenti e cose da fare.
  { chiave: 'agenda', label: 'Agenda', href: '/dashboard/agenda', inArrivo: true },
  // I lead che il sito raccoglie in form_contatti, con la loro provenienza
  // (UTM e sessione) e lo stato di lavorazione.
  { chiave: 'enquiries', label: 'Enquiries', href: '/dashboard/enquiries', gruppo: 'Moduli', inArrivo: true },
  // Anagrafica deduplicata: una scheda per persona con tutte le sue richieste.
  { chiave: 'persone', label: 'Persone', href: '/dashboard/persone', gruppo: 'Moduli', inArrivo: true },
  // Sessioni e campagne raccolte da /api/track sul sito.
  { chiave: 'visite-sito', label: 'Visite al sito', href: '/dashboard/visite', gruppo: 'Amministrazione', inArrivo: true },
  { chiave: 'timbratura', label: 'Timbra cartellino', href: '/dashboard/timbratura', gruppo: 'Amministrazione' },
  { chiave: 'utenti', label: 'Gestione utenti', href: '/dashboard/utenti', gruppo: 'Amministrazione' },
  { chiave: 'log-operatori', label: 'Controllo operatori', href: '/dashboard/log-operatori', gruppo: 'Amministrazione', inArrivo: true },
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
export const HEADER_EMAIL = 'x-rv-user-email'

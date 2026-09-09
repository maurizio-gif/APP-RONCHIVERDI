// Da quanto tempo una cosa aspetta, e quanto è grave che aspetti.
//
// Un CRM di lavoro non si legge per capire *cosa* c'è, ma per capire *cosa
// fare adesso*: e la differenza fra una richiesta arrivata stamattina e una
// ferma da dieci giorni è l'informazione che decide chi si chiama prima. In
// elenco quel dato non c'era: c'era la data d'arrivo, che va sottratta a
// mente, riga per riga.
//
// Le soglie sono quelle della segreteria del club: entro un giorno si
// risponde, entro tre si è ancora in tempo, dopo una settimana la richiesta
// è vecchia e chi chiama deve saperlo prima di parlare.
//
// Nessun import server-only: usato sia dai Server Component sia dai client.

/** Quanto sta aspettando, in quattro gradini che diventano quattro colori. */
export type Urgenza = 'oggi' | 'recente' | 'attesa' | 'ferma'

/** Il giorno in cui si passa al gradino successivo. */
export const SOGLIE_ATTESA = { recente: 1, attesa: 3, ferma: 7 } as const

/** Giorni interi passati da un timestamp ISO. Mai negativo. */
export function giorniDa(iso: string | null | undefined, adesso: number = Date.now()): number | null {
  if (!iso) return null
  const quando = new Date(iso).getTime()
  if (Number.isNaN(quando)) return null
  return Math.max(0, Math.floor((adesso - quando) / 86_400_000))
}

export function urgenzaAttesa(giorni: number): Urgenza {
  if (giorni < SOGLIE_ATTESA.recente) return 'oggi'
  if (giorni < SOGLIE_ATTESA.attesa) return 'recente'
  if (giorni < SOGLIE_ATTESA.ferma) return 'attesa'
  return 'ferma'
}

/**
 * La classe del colore. Non è un semaforo per bellezza: verde/neutro sta per
 * «sei in tempo», ambra per «guardala», rosso per «è ferma da troppo».
 */
export const CLASSE_URGENZA: Record<Urgenza, string> = {
  oggi: 'attesa-oggi',
  recente: 'attesa-recente',
  attesa: 'attesa-media',
  ferma: 'attesa-ferma',
}

/**
 * «oggi», «ieri», «3 giorni», «2 settimane»: si legge senza fare i conti, ed
 * è più corto della data completa — che resta nei dettagli, per chi la vuole.
 */
export function etichettaAttesa(giorni: number): string {
  if (giorni <= 0) return 'oggi'
  if (giorni === 1) return 'ieri'
  if (giorni < 14) return `${giorni} giorni`
  const settimane = Math.floor(giorni / 7)
  if (settimane < 9) return `${settimane} settimane`
  const mesi = Math.floor(giorni / 30)
  return mesi <= 1 ? '1 mese' : `${mesi} mesi`
}

/**
 * La frase completa per un'attesa che pesa: «ferma da 9 giorni». Su una cosa
 * arrivata oggi non si dice niente di allarmante — «da oggi» sarebbe rumore.
 *
 * `arrivata` cambia col soggetto: una richiesta *arriva*, una trattativa si
 * *apre*. Sopra la soglia «ferma» la parola diventa la stessa per tutti,
 * perché è lo stato che conta, non da dove viene la riga.
 */
export function fraseAttesa(giorni: number, arrivata = 'arrivata'): string {
  const urgenza = urgenzaAttesa(giorni)
  if (urgenza === 'oggi') return `${arrivata} oggi`
  if (urgenza === 'ferma') return `ferma da ${etichettaAttesa(giorni)}`
  return `${arrivata} da ${etichettaAttesa(giorni)}`
}

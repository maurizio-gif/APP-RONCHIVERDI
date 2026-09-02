// Solo dati e logica pura (nessun import server-only): importato sia dalla
// Server Action che valida davvero — mai fidarsi delle coordinate che arrivano
// dal browser — sia dai componenti client, per dare un riscontro immediato
// prima di inviare.

/**
 * Centro della zona valida per timbrare: il Ronchiverdi Sport Club, Corso
 * Moncalieri 466, Torino.
 *
 * Le coordinate sono il centro dell'area che OpenStreetMap mappa come il club
 * (way 387746357, leisure=sports_centre), non il civico: il civico cade sul
 * fronte strada, un centinaio di metri a est, e usarlo avrebbe spostato tutto
 * il cerchio verso il corso.
 *
 * Raggio 250 m contro i 100 m del Tennis Club Ambrosiano: qui la proprietà è
 * di 35.000 mq — l'area mappata misura 286 x 167 m, quindi servono già 166 m
 * per coprirne gli angoli dal centro — e il resto è margine per l'errore del
 * GPS di un telefono, che all'aperto sta comunemente sui 10-50 m. Con 100 m
 * chi timbra dai campi esterni o dalla piscina risulterebbe fuori zona.
 *
 * Da correggere qui e solo qui se un pin preciso su Maps dà un centro diverso.
 */
export const ZONA_TIMBRATURA = {
  lat: 45.0207018,
  lng: 7.6751422,
  raggioMetri: 250,
}

export type TipoTimbratura = 'entrata' | 'uscita'

/**
 * Formula dell'emisenoverso (haversine): distanza in metri fra due punti
 * lat/lng sulla superficie terrestre, precisa a sufficienza per un raggio di
 * poche centinaia di metri.
 */
export function distanzaMetri(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const raggioTerra = 6371000
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return raggioTerra * c
}

export function dentroZona(lat: number, lng: number): { dentro: boolean; distanza: number } {
  const distanza = distanzaMetri(lat, lng, ZONA_TIMBRATURA.lat, ZONA_TIMBRATURA.lng)
  return { dentro: distanza <= ZONA_TIMBRATURA.raggioMetri, distanza }
}

/**
 * Giorno (YYYY-MM-DD) nel fuso di Roma. created_at è un timestamp UTC: senza
 * convertire, un'entrata di poco dopo la mezzanotte finirebbe sul giorno
 * sbagliato, e in inverno anche una di poco dopo le 23.
 */
export function giornoRoma(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
}

/** Ora e minuti nel fuso di Roma, per le righe dell'elenco. */
export function oraRoma(iso: string): string {
  return new Date(iso).toLocaleTimeString('it-IT', {
    timeZone: 'Europe/Rome',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Data lunga in italiano ("lunedì 2 settembre"), per le intestazioni. */
export function dataLungaRoma(giorno: string): string {
  // giorno è YYYY-MM-DD: lo interpretiamo a mezzogiorno UTC così nessun fuso
  // lo fa scivolare al giorno prima o dopo.
  return new Date(`${giorno}T12:00:00Z`).toLocaleDateString('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function minutiTra(inizioIso: string, fineIso: string): number {
  return Math.max(0, Math.round((new Date(fineIso).getTime() - new Date(inizioIso).getTime()) / 60000))
}

/** "7h 30m", oppure "45m" se sotto l'ora. */
export function formattaDurata(minuti: number): string {
  const ore = Math.floor(minuti / 60)
  const min = minuti % 60
  if (ore === 0) return `${min}m`
  return `${ore}h ${String(min).padStart(2, '0')}m`
}

export type Timbratura = {
  id: number
  created_at: string
  email: string
  tipo: TipoTimbratura
  distanza_metri: number | null
}

export type Turno = {
  entrata: Timbratura | null
  uscita: Timbratura | null
  minuti: number | null
}

/**
 * Accoppia le timbrature di una giornata in turni entrata → uscita.
 *
 * Non diamo per scontato che si alternino: un'uscita senza entrata (turno
 * iniziato il giorno prima, o entrata dimenticata) e un'entrata senza uscita
 * (turno ancora aperto, o uscita dimenticata) devono comparire come sono,
 * mezzi turni, invece di essere scartate o accoppiate a caso. Le ore di un
 * mezzo turno non si possono calcolare: restano null e non entrano nel totale,
 * così un turno da chiudere si vede subito.
 *
 * `timbrature` va passata in ordine cronologico.
 */
export function accoppiaTurni(timbrature: Timbratura[]): Turno[] {
  const turni: Turno[] = []
  let aperto: Timbratura | null = null

  for (const t of timbrature) {
    if (t.tipo === 'entrata') {
      // Due entrate di fila: la prima resta un turno senza uscita.
      if (aperto) turni.push({ entrata: aperto, uscita: null, minuti: null })
      aperto = t
    } else {
      if (aperto) {
        turni.push({ entrata: aperto, uscita: t, minuti: minutiTra(aperto.created_at, t.created_at) })
        aperto = null
      } else {
        turni.push({ entrata: null, uscita: t, minuti: null })
      }
    }
  }

  if (aperto) turni.push({ entrata: aperto, uscita: null, minuti: null })
  return turni
}

/** Minuti lavorati in una giornata, contando solo i turni completi. */
export function minutiTotali(turni: Turno[]): number {
  return turni.reduce((somma, t) => somma + (t.minuti ?? 0), 0)
}

/**
 * Cosa deve fare il prossimo tocco: se l'ultima timbratura è un'entrata si
 * esce, altrimenti si entra. Guardiamo l'ultima in assoluto e non solo quelle
 * di oggi, altrimenti un turno a cavallo della mezzanotte proporrebbe di
 * entrare una seconda volta.
 */
export function prossimoTipo(ultima: Timbratura | null | undefined): TipoTimbratura {
  return ultima?.tipo === 'entrata' ? 'uscita' : 'entrata'
}

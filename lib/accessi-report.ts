// Il report degli accessi per ingresso (varco) e per nominativo: tipi, lettura
// dei parametri dell'URL e tabelle da scaricare. Niente import server-only:
// li usa anche la pagina. Le letture dal database stanno in
// lib/accessi-report-server.ts, i file (CSV, Excel, PDF) in
// lib/accessi-report-file.ts.
//
// «Passaggi» sono i passaggi ai varchi (Info4U non dice se sono entrate o
// uscite); «teste» sono le persone diverse, contate una volta nel giorno e
// una volta nel periodo. Vedi scripts/sql/2026-10-29-accessi-report.sql.

import { giornoPiu } from '@/lib/agenda'
import { GIORNI_SETTIMANA, etichettaIntervallo, leggiChiaveVarco, numero } from '@/lib/accessi'

/** Quante persone diverse al massimo nella tabella «per nominativo» di un file. */
export const MASSIMO_PERSONE_FILE = 20000
/** Quante ne mostra la pagina: le prime per passaggi, il resto è nel file. */
export const PERSONE_A_SCHERMO = 100

export type TotaliReport = {
  passaggi: number
  teste: number
  visite: number
  giorniAperti: number
}

export type RigaGiornoReport = { giorno: string; passaggi: number; teste: number }

export type RigaVarcoReport = {
  chiave: string
  descrizione: string
  gruppo: string | null
  passaggi: number
  teste: number
}

export type RigaPersonaReport = {
  utente: number
  /** La scheda in anagrafica, se il numero utente è collegato a una persona. */
  personaId: string | null
  nome: string
  passaggi: number
  giorni: number
  varchi: number
}

export type RigaDettaglioReport = {
  nome: string
  giorno: string
  ingresso: string
  passaggi: number
}

export type PersonaScelta = { id: string; nome: string; utente: number | null }

export type ReportAccessi = {
  dal: string
  al: string
  /** Le chiavi dei varchi scelti, o null = tutti. */
  varchiScelti: string[] | null
  /** I nomi dei varchi scelti, per dirlo in testa ai file. */
  nomiVarchiScelti: string[]
  /** Le persone scelte, o null = tutte. */
  persone: PersonaScelta[] | null
  totali: TotaliReport
  giorni: RigaGiornoReport[]
  perVarco: RigaVarcoReport[]
  perPersona: RigaPersonaReport[]
  /** Ci sono più persone di quelle elencate in perPersona. */
  personeTroncate: boolean
  /** Giorno per giorno e varco per varco, solo se si sono scelte delle persone. */
  dettaglio: RigaDettaglioReport[] | null
}

// ───────────────────────────────────────────────────────── parametri URL

export type ParametriReport = {
  dal?: string | string[]
  al?: string | string[]
  varco?: string | string[]
  persona?: string | string[]
  q?: string | string[]
}

export function primo(valore: string | string[] | undefined): string | undefined {
  return Array.isArray(valore) ? valore[0] : valore
}

export function tutti(valore: string | string[] | undefined): string[] {
  return valore === undefined ? [] : Array.isArray(valore) ? valore : [valore]
}

/** Le chiavi dei varchi ben formate, senza doppioni. */
export function varchiDaParametri(valore: string | string[] | undefined): string[] {
  return [...new Set(tutti(valore).filter((v) => leggiChiaveVarco(v) !== null))]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function personeDaParametri(valore: string | string[] | undefined): string[] {
  return [...new Set(tutti(valore).filter((v) => UUID.test(v)))].slice(0, 200)
}

/** Senza date, gli ultimi sette giorni: oggi compreso. */
export function intervalloPredefinito(oggi: string): { dal: string; al: string } {
  return { dal: giornoPiu(oggi, -6), al: oggi }
}

/** I parametri dell'URL per i link (pagina ed esportazione): ripetuti per varco e persona. */
export function queryReport(p: {
  dal: string
  al: string
  varchi: string[]
  persone: string[]
  extra?: Record<string, string | undefined>
}): string {
  const q = new URLSearchParams()
  q.set('dal', p.dal)
  q.set('al', p.al)
  for (const v of p.varchi) q.append('varco', v)
  for (const id of p.persone) q.append('persona', id)
  for (const [k, v] of Object.entries(p.extra ?? {})) if (v) q.set(k, v)
  return q.toString()
}

// ───────────────────────────────────────────────────────────── tabelle

export type Cella = string | number | null

/** Una tabella del report: la stessa per lo schermo, l'Excel, il CSV e il PDF. */
export type Foglio = {
  /** Il nome della scheda Excel (al massimo 31 caratteri, senza : \ / ? * [ ]). */
  nome: string
  titolo: string
  intestazioni: string[]
  righe: Cella[][]
  /** Pesi relativi delle colonne, per Excel e PDF. */
  larghezze: number[]
  /** Una riga di commento sotto la tabella (spiega i totali). */
  nota?: string
}

function dataIt(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

export function nomeGiornoSettimana(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`)
  return GIORNI_SETTIMANA[(d.getUTCDay() + 6) % 7]
}

export function descriviIngressi(r: ReportAccessi): string {
  return r.varchiScelti === null ? 'Tutti gli ingressi' : r.nomiVarchiScelti.join(', ')
}

export function descriviNominativi(r: ReportAccessi): string {
  return r.persone === null ? 'Tutti i nominativi' : r.persone.map((p) => p.nome).join(', ')
}

/** Il nome del file da scaricare, senza estensione. */
export function nomeFileReportAccessi(r: ReportAccessi): string {
  return r.dal === r.al ? `ingressi_${r.dal}` : `ingressi_${r.dal}_${r.al}`
}

/** Le tabelle del report, nell'ordine in cui compaiono nei file. */
export function fogliDelReport(r: ReportAccessi): Foglio[]  {
  const fogli: Foglio[] = []

  fogli.push({
    nome: 'Riepilogo',
    titolo: 'Riepilogo',
    intestazioni: ['Voce', 'Valore'],
    larghezze: [3, 7],
    righe: [
      ['Periodo', etichettaIntervallo(r.dal, r.al)],
      ['Ingressi', descriviIngressi(r)],
      ['Nominativi', descriviNominativi(r)],
      ['Passaggi totali', r.totali.passaggi],
      ['Teste (persone diverse nel periodo)', r.totali.teste],
      ['Visite (persona × giorno)', r.totali.visite],
      ['Giorni con passaggi', r.totali.giorniAperti],
    ],
    nota:
      'I passaggi sono tutti i passaggi ai varchi (il sistema non distingue entrate e uscite). Le teste sono le persone diverse: una persona che passa più volte conta una volta.',
  })

  fogli.push({
    nome: 'Per giorno',
    titolo: 'Per giorno',
    intestazioni: ['Giorno', 'Giorno della settimana', 'Passaggi', 'Teste'],
    larghezze: [2, 3, 2, 2],
    righe: [
      ...r.giorni.map((g): Cella[] => [dataIt(g.giorno), nomeGiornoSettimana(g.giorno), g.passaggi, g.teste]),
      ['Totale periodo', '', r.totali.passaggi, r.totali.teste],
    ],
    nota: 'Nella riga del totale le teste sono le persone diverse nell\'intero periodo, non la somma dei giorni.',
  })

  fogli.push({
    nome: 'Per ingresso',
    titolo: 'Per ingresso',
    intestazioni: ['Ingresso', 'Gruppo', 'Passaggi', 'Teste'],
    larghezze: [5, 3, 2, 2],
    righe: [
      ...r.perVarco.map((v): Cella[] => [v.descrizione, v.gruppo ?? '', v.passaggi, v.teste]),
      ['Totale', '', r.totali.passaggi, r.totali.teste],
    ],
    nota: 'Nella riga del totale le teste sono le persone diverse su tutti gli ingressi scelti: chi passa da più ingressi conta una volta.',
  })

  fogli.push({
    nome: 'Per nominativo',
    titolo: 'Per nominativo',
    intestazioni: ['Nominativo', 'N. utente', 'Passaggi', 'Giorni di presenza', 'Ingressi diversi'],
    larghezze: [4, 2, 2, 3, 2],
    righe: r.perPersona.map((p): Cella[] => [p.nome, p.utente, p.passaggi, p.giorni, p.varchi]),
    nota: r.personeTroncate ? `Elenco limitato alle prime ${numero(r.perPersona.length)} persone per passaggi.` : undefined,
  })

  if (r.dettaglio) {
    fogli.push({
      nome: 'Dettaglio nominativo',
      titolo: 'Dettaglio per nominativo, giorno e ingresso',
      intestazioni: ['Nominativo', 'Giorno', 'Ingresso', 'Passaggi'],
      larghezze: [4, 2, 5, 2],
      righe: r.dettaglio.map((d): Cella[] => [d.nome, dataIt(d.giorno), d.ingresso, d.passaggi]),
    })
  }

  return fogli
}

import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { oggiRoma } from '@/lib/agenda'
import {
  ScriptAccessiMancante,
  caricaGruppiAccessi,
  caricaVarchi,
  personeDegliUtenti,
  ricercaAccessi,
  risolviRicerca,
  type ParametriRicerca,
} from '@/lib/accessi-server'

export const dynamic = 'force-dynamic'

const MASSIMO = 20000
const BLOCCO = 1000

// Il CSV della ricerca sugli accessi, con gli stessi filtri della pagina
// (vedi risolviRicerca). PostgREST dà al massimo 1000 righe per richiesta:
// si legge a blocchi. Separatore «;» e BOM, perché Excel in italiano apra
// il file con le colonne e gli accenti giusti.
function cella(valore: string | number | null | undefined): string {
  const testo = valore == null ? '' : String(valore)
  // Un testo che comincia con = + - @ Excel lo legge come formula: nomi e
  // descrizioni sono testo libero.
  const sicuro = /^[=+\-@]/.test(testo) && typeof valore === 'string' ? `'${testo}` : testo
  return /[";\n\r]/.test(sicuro) ? `"${sicuro.replace(/"/g, '""')}"` : sicuro
}

export async function GET(richiesta: Request) {
  if (!(await utenteHaSezione('accessi'))) return new NextResponse('Non autorizzato', { status: 403 })

  const parametri: ParametriRicerca = Object.fromEntries(new URL(richiesta.url).searchParams.entries())
  const db = createSupabaseServiceClient()
  try {
    const [gruppi, varchi] = await Promise.all([caricaGruppiAccessi(db), caricaVarchi(db)])
    const { filtri, candidate, nessunaPersona, periodo } = await risolviRicerca(db, parametri, oggiRoma(), varchi, gruppi)
    if (candidate.length > 0 || nessunaPersona) {
      return new NextResponse('Scegli prima una persona dalla pagina di ricerca.', { status: 400 })
    }

    const righe = []
    for (let da = 0; da < MASSIMO; da += BLOCCO) {
      const blocco = await ricercaAccessi(db, filtri, da, BLOCCO)
      righe.push(...blocco.righe)
      if (!blocco.ceAltro) break
    }
    const [persone, esiti] = await Promise.all([
      personeDegliUtenti(db, righe.map((r) => r.utente).filter((u): u is number => u != null)),
      db.from('esiti_accesso').select('numero_esito, descrizione'),
    ])
    const nomeEsito = new Map((esiti.data ?? []).map((e) => [e.numero_esito as number, e.descrizione as string]))
    const varcoDi = new Map(varchi.map((v) => [v.chiave, v]))
    const gruppoDi = new Map(gruppi.map((g) => [g.id, g.nome]))
    const quando = (iso: string) =>
      new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium' }).replace(',', '')

    const linee = [
      ['Data e ora', 'Persona', 'N. utente', 'Varco', 'Gruppo', 'Esito'].join(';'),
      ...righe.map((r) => {
        const v = varcoDi.get(r.varcoChiave)
        return [
          cella(quando(r.quando)),
          cella(r.utente != null ? persone.get(r.utente)?.nome : ''),
          cella(r.utente),
          cella(v?.descrizione ?? `Varco ${r.varcoChiave}`),
          cella(v?.gruppoId ? gruppoDi.get(v.gruppoId) : ''),
          cella(nomeEsito.get(r.esito) ?? `Esito ${r.esito}`),
        ].join(';')
      }),
    ]
    return new NextResponse('﻿' + linee.join('\r\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="accessi_${periodo.dal}_${periodo.al}.csv"`,
      },
    })
  } catch (e) {
    if (e instanceof ScriptAccessiMancante) return new NextResponse(e.message, { status: 500 })
    throw e
  }
}

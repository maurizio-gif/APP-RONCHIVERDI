// Helper per la dashboard direzionale (/dashboard/direzione): i range di
// date MTD/YTD "a parità di giorni" e la classificazione del canale di
// acquisizione di una vendita.
//
// Il confronto "a parità di giorni" fra anni è lo stesso principio già usato
// in app/dashboard/abbonamenti/page.tsx: un mese o un anno non ancora finiti
// si confrontano solo fino allo stesso giorno dell'anno prima, altrimenti un
// 18 settembre di quest'anno batterebbe sempre un settembre intero dello
// scorso.

import { giornoPiu, mezzanotteRoma, oggiRoma, ultimoDelMese } from '@/lib/agenda'
import { provenienzaDiOrigine, type ChiaveProvenienza, type Provenienza } from '@/lib/provenienza'

/**
 * Un range di date, in due forme — servono entrambe:
 *  - `giornoDa`/`giornoA` ('YYYY-MM-DD', inclusivi): per le viste che
 *    espongono una colonna `date` (`abbonamenti_giornalieri*`), con `.gte()`/`.lte()`.
 *  - `da`/`a` (istanti ISO, `a` esclusivo): per la RPC `statistiche_richieste`
 *    e ogni colonna `timestamptz`.
 */
export type RangePeriodo = { giornoDa: string; giornoA: string; da: string; a: string }

/** L'ultimo giorno valido di un mese, in un anno qualunque. */
function ultimoGiornoDelMese(anno: number, mese: number): number {
  const mm = String(mese).padStart(2, '0')
  return Number(ultimoDelMese(`${anno}-${mm}-01`).slice(8, 10))
}

/** Il giorno di oggi, clampato all'ultimo giorno valido di quel mese in un altro anno (29 febbraio compreso). */
function giornoFineParita(anno: number, mese: number, giornoCorrente: number): string {
  const giorno = Math.min(giornoCorrente, ultimoGiornoDelMese(anno, mese))
  return String(giorno).padStart(2, '0')
}

function costruisciRange(giornoDa: string, giornoA: string): RangePeriodo {
  return {
    giornoDa,
    giornoA,
    da: mezzanotteRoma(giornoDa),
    // Mezzanotte del giorno DOPO: RPC e colonne timestamptz filtrano con
    // `< a`, così l'ultimo giorno del range ci sta dentro per intero.
    a: mezzanotteRoma(giornoPiu(giornoA, 1)),
  }
}

/**
 * Dal primo del mese corrente a oggi, in un anno qualunque — per il confronto
 * MTD a parità di giorni con l'anno prima.
 */
export function rangeMTD(anno: number): RangePeriodo {
  const oggi = oggiRoma()
  const mese = Number(oggi.slice(5, 7))
  const mm = String(mese).padStart(2, '0')
  const giornoFine = giornoFineParita(anno, mese, Number(oggi.slice(8, 10)))
  return costruisciRange(`${anno}-${mm}-01`, `${anno}-${mm}-${giornoFine}`)
}

/** Dal 1 gennaio a oggi, in un anno qualunque — stesso principio di rangeMTD. */
export function rangeYTD(anno: number): RangePeriodo {
  const oggi = oggiRoma()
  const mese = Number(oggi.slice(5, 7))
  const mm = String(mese).padStart(2, '0')
  const giornoFine = giornoFineParita(anno, mese, Number(oggi.slice(8, 10)))
  return costruisciRange(`${anno}-01-01`, `${anno}-${mm}-${giornoFine}`)
}

/**
 * Come Provenienza, ma con una chiave in più: "non-attribuito" non è un
 * canale che lib/provenienza.ts conosce (quel file parla di trattative, non
 * di vendite storiche senza lead), quindi non estende ChiaveProvenienza —
 * resta un concetto locale a questa dashboard.
 */
export type ProvenienzaVendita = Omit<Provenienza, 'chiave'> & { chiave: ChiaveProvenienza | 'non-attribuito' }

/**
 * Una vendita senza nessuna richiesta collegata alla persona: un rinnovo o un
 * acquisto in reception senza un lead nel CRM dietro. È la maggioranza dello
 * storico (vedi abbonamenti_mensili_canale) — non attribuirla a "Sito" per
 * default sarebbe inventare un canale che non ha mai visto nessuno.
 */
export const NON_ATTRIBUITO: ProvenienzaVendita = {
  chiave: 'non-attribuito',
  etichetta: 'Non attribuito',
  classe: 'da-non-attribuito',
  spiegazione:
    'Nessuna richiesta collegata a questa persona: un rinnovo o un acquisto in reception senza un lead nel CRM dietro.',
}

/**
 * Il canale di una vendita, dal primo contatto mai avuto dalla persona che
 * l'ha fatta (vedi la vista persone_primo_canale). `haRichiesta` falso — la
 * persona non ha mai avuto una richiesta — e `primaOrigine` null perché quella
 * richiesta aveva un'origine non tracciata sono due cose diverse: solo la
 * prima è "Non attribuito", la seconda è "Sito" a tutti gli effetti (vedi
 * provenienzaDiOrigine in lib/provenienza.ts).
 */
export function canaleVendita({
  haRichiesta,
  primaOrigine,
}: {
  haRichiesta: boolean
  primaOrigine: string | null
}): ProvenienzaVendita {
  if (!haRichiesta) return NON_ATTRIBUITO
  return provenienzaDiOrigine(primaOrigine)
}

'use client'

import { useState, useTransition } from 'react'
import { DOMANDA_MOTIVO, chiedeValore, motivoDi, valoreDaTesto, type StatoTrattativa } from '@/lib/pipeline'
import { cambiaStato } from './trattativa-actions'
import type { DatiTrattativa } from './Trattativa'

// La domanda "nota + eventuale valore, poi cambiaStato" che sia la tendina
// di Trattativa che i pulsanti di ChiusuraTrattativa fanno alla persona.
// Le due UI restano diverse — una tendina dove c'è già il resto della
// pipeline intorno, tre pulsanti dove non c'è — ma la validazione e il
// salvataggio erano la stessa logica scritta due volte, ed è lì che sarebbe
// bastato dimenticare di aggiornarne una per farle divergere.
export function useChiusuraTrattativa(t: DatiTrattativa) {
  const [chiedo, setChiedo] = useState<StatoTrattativa | null>(null)
  const [motivo, setMotivo] = useState('')
  // Testo e non numero: un campo controllato che rifiuta i caratteri mentre
  // si digita non lascia scrivere «1080,», cioè il passaggio obbligato per
  // arrivare a «1080,50». Si normalizza al salvataggio (valoreDaTesto).
  const [valore, setValore] = useState('')
  // Solo per la vinta: si riparte da quello che c'era già, come per nota e
  // valore — correggere una vinta non deve far perdere la spunta.
  const [triplePack, setTriplePack] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function avvia(stato: StatoTrattativa) {
    setErrore(null)
    setMotivo(motivoDi({ ...t, stato }) ?? '')
    setValore(stato === 'vinto' && t.valore_euro != null ? String(t.valore_euro) : '')
    setTriplePack(stato === 'vinto' ? !!t.triple_pack : false)
    setChiedo(stato)
  }

  function lasciaStare() {
    setChiedo(null)
    setMotivo('')
    setValore('')
    setTriplePack(false)
    setErrore(null)
  }

  function conferma() {
    if (!chiedo) return

    // L'obbligo è detto qui prima che parta la richiesta: il server rifiuta
    // comunque (vedi cambiaStato), ma scoprirlo dopo un giro di rete su un
    // campo che si ha davanti sembra un guasto.
    if (!motivo.trim()) {
      setErrore(`Scrivi la nota. ${DOMANDA_MOTIVO[chiedo]}`)
      return
    }

    const importo = chiedeValore(chiedo) ? valoreDaTesto(valore) : null
    if (chiedeValore(chiedo) && importo === null) {
      setErrore(
        valore.trim()
          ? 'Il valore non si capisce: scrivi solo cifre, con la virgola per i centesimi. Es. 1080 o 1080,50'
          : 'Scrivi quanto vale il contratto, in euro.'
      )
      return
    }

    setErrore(null)
    startTransition(async () => {
      const esito = await cambiaStato(t.id, chiedo, motivo, importo, chiedeValore(chiedo) ? triplePack : false)
      if (esito.ok) lasciaStare()
      else setErrore(esito.errore)
    })
  }

  return {
    chiedo,
    motivo,
    setMotivo,
    valore,
    setValore,
    triplePack,
    setTriplePack,
    errore,
    inCorso,
    avvia,
    lasciaStare,
    conferma,
  }
}

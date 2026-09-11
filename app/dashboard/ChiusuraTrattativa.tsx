'use client'

import { useState, useTransition } from 'react'
import {
  CLASSE_BADGE_STATO,
  CONFERMA_MOTIVO,
  DOMANDA_MOTIVO,
  ETICHETTE_STATO,
  chiedeValore,
  eChiusa,
  euro,
  motivoDi,
  puoAnnullare,
  puoAssegnare,
  valoreDaTesto,
} from '@/lib/pipeline'
import { nomeDiEmail } from '@/lib/staff'
import { cambiaStato } from './richieste/trattativa-actions'
import type { DatiTrattativa } from './richieste/Trattativa'

// Come è finita la trattativa, dalla gestione dell'evento.
//
// Chiudere l'evento e chiudere la trattativa sono due cose diverse — «la
// telefonata è andata» non è «si è iscritto» — e restano due gesti. Ma
// arrivano nello stesso momento: si telefona, la persona dice sì, e in quel
// minuto si sanno entrambe le cose. Finora la seconda stava solo nella
// tendina degli stati del blocco Trattativa, cioè in dashboard sulle righe
// delle trattative e in Eventi Core: chi chiudeva una telefonata dall'elenco
// degli eventi doveva cambiare elenco per dire com'era finita.
//
// Tre pulsanti e non la tendina degli stati: da qui si **chiude**. Rimettere
// in gestione o riaprire una chiusa è un'altra cosa — una correzione di
// percorso — e resta dove c'è la pipeline intorno.
//
// Tutte e tre chiedono una nota, **vinta compresa**: era l'unico esito che
// produce fatturato e non lasciava traccia di cosa fosse. Le tre domande sono
// diverse e stanno in lib/pipeline.ts, così il pannello, la tendina di
// Trattativa e il server chiedono e rifiutano la stessa cosa.
//
// I diritti sono gli stessi del server (cambiaStato in
// richieste/trattativa-actions.ts): vinta e persa le muove chi la ha in mano,
// annullare lo può fare qualsiasi commerciale anche su quella di un collega,
// perché non è un giudizio sul suo lavoro — è dire che quella riga non è mai
// stata una trattativa.

type Chiusura = 'vinto' | 'perso' | 'annullato'

const PULSANTI: { stato: Chiusura; etichetta: string; classe: string }[] = [
  { stato: 'vinto', etichetta: 'Vinta', classe: 'btn-sm' },
  { stato: 'perso', etichetta: 'Persa', classe: 'btn-sm btn-ghost' },
  { stato: 'annullato', etichetta: 'Annulla la trattativa', classe: 'btn-sm btn-ghost' },
]

export function ChiusuraTrattativa({
  t,
  io,
  sonoCommerciale,
  possoRiassegnare,
  conIntestazione = true,
  nomiStaff = {},
}: {
  t: DatiTrattativa
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  /**
   * Se mostrare titolo, stato e assegnatario sopra i pulsanti.
   *
   * Falso dove sopra c'è già il blocco Trattativa, che dice le stesse tre
   * cose: ripeterle a due centimetri di distanza fa dubitare che siano la
   * stessa trattativa. Là restano solo i pulsanti, che sono la cosa che
   * quel blocco non ha.
   */
  conIntestazione?: boolean
  nomiStaff?: Record<string, string>
}) {
  const [chiedo, setChiedo] = useState<Chiusura | null>(null)
  const [motivo, setMotivo] = useState('')
  // Il valore resta **testo** nello stato del componente e si normalizza al
  // salvataggio: un input numerico controllato che rifiuta i caratteri
  // mentre si digita non lascia scrivere «1080,» — cioè il passaggio
  // obbligato per arrivare a «1080,50».
  const [valore, setValore] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const diritti = { assegnatoA: t.assegnato_a, io, sonoCommerciale, possoRiassegnare }
  const possoChiudere = puoAssegnare(diritti)
  const possoAnnullarla = puoAnnullare(diritti)

  function esegui(stato: Chiusura) {
    // L'obbligo è detto qui prima che parta la richiesta: il server rifiuta
    // comunque (vedi cambiaStato), ma scoprirlo dopo un giro di rete su un
    // campo che si ha davanti sembra un guasto.
    if (!motivo.trim()) {
      return setErrore(`Scrivi la nota. ${DOMANDA_MOTIVO[stato]}`)
    }

    const importo = chiedeValore(stato) ? valoreDaTesto(valore) : null
    if (chiedeValore(stato) && importo === null) {
      return setErrore(
        valore.trim()
          ? 'Il valore non si capisce: scrivi solo cifre, con la virgola per i centesimi. Es. 1080 o 1080,50'
          : 'Scrivi quanto vale il contratto, in euro.'
      )
    }

    setErrore(null)
    startTransition(async () => {
      const esito = await cambiaStato(t.id, stato, motivo, importo)
      if (esito.ok) {
        setChiedo(null)
        setMotivo('')
        setValore('')
      } else setErrore(esito.errore)
    })
  }

  return (
    <div className="chiusura-trattativa">
      {conIntestazione ? (
        <>
          <p className="op-gestione-titolo">La trattativa</p>
          <div className="chiusura-riga">
            <span className={`badge badge-stato badge-punto ${CLASSE_BADGE_STATO[t.stato]}`}>
              {ETICHETTE_STATO[t.stato]}
            </span>
            <span className="muted chiusura-chi">
              {t.assegnato_a
                ? t.assegnato_a === io
                  ? 'la segui tu'
                  : `la segue ${nomeDiEmail(t.assegnato_a, nomiStaff)}`
                : 'nessun assegnatario'}
            </span>
          </div>
        </>
      ) : (
        <p className="op-gestione-titolo">Come è finita</p>
      )}

      {/* Già chiusa: il motivo, non i pulsanti. Riaprirla è una correzione di
          percorso e si fa dove c'è la pipeline intorno — qui offrirla
          accanto a «Vinta» vorrebbe dire quattro pulsanti per quattro
          direzioni diverse sotto la chiusura di una telefonata. */}
      {eChiusa(t.stato) ? (
        <p className="muted chiusura-motivo">
          {motivoDi(t) ?? 'Chiusa senza nota. Si riapre da Eventi Core.'}
          {/* Il valore accanto a cosa è stato venduto: sono la stessa frase
              detta in due campi, e separarli a schermo li fa cercare due
              volte. */}
          {t.stato === 'vinto' && euro(t.valore_euro) && (
            <strong className="chiusura-valore"> · {euro(t.valore_euro)}</strong>
          )}
        </p>
      ) : chiedo ? (
        <div className="chiusura-motivo-campo">
          <label className="chiusura-etichetta" htmlFor={`motivo-${t.id}`}>
            Nota <span aria-hidden="true">*</span>
          </label>
          <input
            id={`motivo-${t.id}`}
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={DOMANDA_MOTIVO[chiedo]}
            autoFocus
          />

          {/* Il valore del contratto, solo sulla vinta: è l'unica chiusura
              che produce fatturato. In un campo suo e non dentro la nota,
              perché è la differenza fra un dato leggibile e un dato che si
              somma. */}
          {chiedeValore(chiedo) && (
            <>
              <label className="chiusura-etichetta" htmlFor={`valore-${t.id}`}>
                Valore del contratto <span aria-hidden="true">*</span>
              </label>
              <div className="chiusura-valore-campo">
                <input
                  id={`valore-${t.id}`}
                  type="text"
                  inputMode="decimal"
                  value={valore}
                  onChange={(e) => setValore(e.target.value)}
                  placeholder="1080"
                  aria-describedby={`valore-aiuto-${t.id}`}
                />
                <span aria-hidden="true">€</span>
              </div>
              <p className="field-hint" id={`valore-aiuto-${t.id}`}>
                Solo cifre, virgola per i centesimi. Niente punti delle migliaia: «1.080» e
                «1080» si leggerebbero diversi.
              </p>
            </>
          )}
          <div className="chiusura-azioni">
            <button
              type="button"
              className="btn btn-sm"
              disabled={inCorso}
              onClick={() => esegui(chiedo)}
            >
              {inCorso ? 'Un attimo…' : CONFERMA_MOTIVO[chiedo]}
            </button>
            {/* «Lascia stare» e non «Annulla»: accanto a un pulsante che
                annulla la trattativa, due «annulla» che fanno cose opposte
                sono il modo di premere quello sbagliato. */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={inCorso}
              onClick={() => {
                setChiedo(null)
                setMotivo('')
                setErrore(null)
              }}
            >
              Lascia stare
            </button>
          </div>
        </div>
      ) : (
        <div className="chiusura-azioni">
          {PULSANTI.map(({ stato, etichetta, classe }) => {
            const permesso = stato === 'annullato' ? possoAnnullarla : possoChiudere
            if (!permesso) return null
            return (
              <button
                key={stato}
                type="button"
                className={`btn ${classe}`}
                disabled={inCorso}
                onClick={() => {
                  setErrore(null)
                  // Anche vinta chiede la nota: è l'unico esito che produce
                  // fatturato, e «Vinta» da sola non dice che abbonamento è
                  // stato fatto né quanto vale.
                  setMotivo(motivoDi({ ...t, stato }) ?? '')
                  setChiedo(stato)
                }}
              >
                {etichetta}
              </button>
            )
          })}
          {!possoChiudere && !possoAnnullarla && (
            <p className="muted chiusura-motivo">
              {t.assegnato_a
                ? `La segue ${nomeDiEmail(t.assegnato_a, nomiStaff)}: solo chi la ha in mano può chiuderla.`
                : 'Serve il diritto commerciale per chiuderla.'}
            </p>
          )}
        </div>
      )}

      {errore && <p className="op-errore">{errore}</p>}
    </div>
  )
}

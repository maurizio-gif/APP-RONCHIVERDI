'use client'

import { useState, useTransition } from 'react'
import {
  AZIONE_STATO,
  CLASSE_BADGE_STATO,
  CLASSE_RIGA_STATO,
  CONFERMA_MOTIVO,
  DOMANDA_MOTIVO,
  ETICHETTE_STATO,
  OPZIONI_STATO,
  PASSI_AVANZAMENTO,
  chiedeMotivo,
  chiedeValore,
  eChiusa,
  euro,
  motivoDi,
  valoreDaTesto,
  puoAnnullare,
  puoAssegnare,
  type StatoTrattativa,
} from '@/lib/pipeline'
import { nomeDiEmail } from '@/lib/staff'
import { assegnaTrattativa, cambiaStato, prendiInCarico } from './trattativa-actions'

export type DatiTrattativa = {
  id: string
  stato: StatoTrattativa
  assegnato_a: string | null
  motivo_perso: string | null
  /** Perché non andava creata: doppione, errore al banco, prova. */
  motivo_annullato: string | null
  /** Quale abbonamento è stato venduto. */
  motivo_vinto?: string | null
  /** Quanto vale il contratto, in euro. Solo sulle vinte. */
  valore_euro?: number | null
}

// Il blocco trattativa che compare sulla riga di una richiesta Club/Family.
// La trattativa è della persona: se ha scritto tre volte, le tre righe
// mostrano la stessa e agire su una vale per tutte — è il punto del modello.
export function Trattativa({
  t,
  io,
  sonoCommerciale,
  possoRiassegnare,
  commerciali,
  nomiStaff = {},
}: {
  t: DatiTrattativa
  io: string | null
  sonoCommerciale: boolean
  possoRiassegnare: boolean
  commerciali: string[]
  /**
   * Email → "Nome Cognome". L'email resta il valore che si salva — è la
   * chiave di staff_users — ma non è il modo in cui si chiama un collega: in
   * una tendina di sei indirizzi @ronchiverdi.it la parte che li distingue è
   * anche quella che si legge peggio.
   */
  nomiStaff?: Record<string, string>
}) {
  const [errore, setErrore] = useState<string | null>(null)
  // Quale chiusura sta chiedendo la nota: null = nessuna. La chiedono tutte
  // e tre — vinta, persa, annullata — e la domanda non è la stessa, quindi il
  // riquadro deve sapere quale delle tre sta raccogliendo.
  const [chiedoMotivo, setChiedoMotivo] = useState<StatoTrattativa | null>(null)
  const [motivo, setMotivo] = useState('')
  // Testo e non numero: un campo controllato che rifiuta i caratteri mentre
  // si digita non lascia scrivere «1080,», cioè il passaggio obbligato per
  // arrivare a «1080,50». Si normalizza al salvataggio (valoreDaTesto).
  const [valore, setValore] = useState('')
  const [inCorso, startTransition] = useTransition()

  const diritti = { assegnatoA: t.assegnato_a, io, sonoCommerciale, possoRiassegnare }
  const modificabile = puoAssegnare(diritti)

  // Annullare si può sempre, da commerciale, anche sulla trattativa di un
  // collega (vedi puoAnnullare): non è un giudizio sul suo lavoro, è dire
  // che quella riga non è mai stata una trattativa. Chi ha già la tendina
  // degli stati ce l'ha lì dentro; a chi non ce l'ha serve un comando suo,
  // o si accorgerebbe del doppione senza poterlo togliere.
  const possoAnnullare = puoAnnullare(diritti)
  const annullaAParte = possoAnnullare && !modificabile && t.stato !== 'annullato'

  function esegui(azione: () => Promise<{ ok: true } | { ok: false; errore: string }>) {
    setErrore(null)
    startTransition(async () => {
      const esito = await azione()
      if (!esito.ok) setErrore(esito.errore)
      else {
        setChiedoMotivo(null)
        setMotivo('')
      }
    })
  }

  // Dove si trova nel percorso buono: da prendere → in gestione → vinta.
  // Persa è un'uscita laterale e non ha un passo, quindi non ha nemmeno la
  // barra: al suo posto si legge il motivo.
  const passo = PASSI_AVANZAMENTO.indexOf(t.stato)

  return (
    <div className={`trattativa ${CLASSE_RIGA_STATO[t.stato]}`}>
      {/* Il badge da solo ("In gestione") non dice di cosa: la riga è una
          richiesta, questo blocco è l'opportunità della persona, che vale per
          tutte le sue richieste. */}
      <span className="trattativa-etichetta">Trattativa</span>
      <span className={`badge badge-stato badge-punto ${CLASSE_BADGE_STATO[t.stato]}`}>
        {ETICHETTE_STATO[t.stato]}
      </span>

      {/* Tre trattini: quanti passi sono fatti e quale è quello di adesso. Un
          badge dice dove sei; questo dice anche quanto manca, che su una
          pipeline è metà dell'informazione — e si legge senza parole. */}
      {passo >= 0 && (
        <span
          className="pipeline-passi"
          role="img"
          aria-label={`Passo ${passo + 1} di ${PASSI_AVANZAMENTO.length}: ${ETICHETTE_STATO[t.stato]}`}
        >
          {PASSI_AVANZAMENTO.map((x, i) => (
            <span
              key={x}
              className={`pipeline-passo${i < passo ? ' is-fatto' : ''}${i === passo ? ' is-adesso' : ''}`}
            />
          ))}
        </span>
      )}

      <span className="trattativa-chi muted">
        {t.assegnato_a
          ? t.assegnato_a === io
            ? 'la segui tu'
            : `la segue ${nomeDiEmail(t.assegnato_a, nomiStaff)}`
          : 'nessun assegnatario'}
      </span>

      {!t.assegnato_a && sonoCommerciale && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={inCorso}
          onClick={() => esegui(() => prendiInCarico(t.id))}
        >
          Prendi in carico
        </button>
      )}

      {modificabile && (
        <>
          {/* L'elenco contiene solo i commerciali: assegnare a un
              responsabile di corso vorrebbe dire metterlo in una lista che
              non guarda mai. */}
          <select
            className="trattativa-select"
            value={t.assegnato_a ?? ''}
            disabled={inCorso}
            onChange={(e) => esegui(() => assegnaTrattativa(t.id, e.target.value || null))}
            aria-label="Assegnata a"
          >
            <option value="">— nessuno —</option>
            {commerciali.map((c) => (
              <option key={c} value={c}>
                {c === io ? `${nomeDiEmail(c, nomiStaff)} (tu)` : nomeDiEmail(c, nomiStaff)}
              </option>
            ))}
          </select>

          <select
            className="trattativa-select"
            value={t.stato}
            disabled={inCorso}
            onChange={(e) => {
              const nuovo = e.target.value as StatoTrattativa
              // Le tre chiusure chiedono la nota prima di chiudere. Una persa
              // senza motivo non insegna niente al prossimo che la guarda;
              // una annullata senza motivo è una riga sparita dalla pipeline
              // che fra un mese nessuno sa più perché non c'è più; e una
              // vinta senza nota non dice che abbonamento è stato fatto.
              if (chiedeMotivo(nuovo)) {
                setErrore(null)
                setMotivo(motivoDi({ ...t, stato: nuovo }) ?? '')
                setValore(
                  nuovo === 'vinto' && t.valore_euro != null ? String(t.valore_euro) : ''
                )
                setChiedoMotivo(nuovo)
              } else esegui(() => cambiaStato(t.id, nuovo))
            }}
            aria-label="Stato"
          >
            {OPZIONI_STATO.map((o) => (
              <option key={o.valore} value={o.valore}>
                {o.etichetta}
              </option>
            ))}
          </select>
        </>
      )}

      {/* Discreto e in fondo: è una correzione dei dati, non un passo della
          pipeline, e su una trattativa che sta lavorando un collega non deve
          somigliare a un comando da usare per abitudine. */}
      {annullaAParte && !chiedoMotivo && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={inCorso}
          onClick={() => {
            setErrore(null)
            setMotivo('')
            setChiedoMotivo('annullato')
          }}
        >
          Annulla la trattativa
        </button>
      )}

      {chiedoMotivo && (
        <span className="trattativa-motivo">
          <input
            type="text"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={DOMANDA_MOTIVO[chiedoMotivo]}
            autoFocus
          />

          {/* Il valore, solo sulla vinta: è l'unica chiusura che produce
              fatturato, e dentro la nota non si sommerebbe. */}
          {chiedeValore(chiedoMotivo) && (
            <span className="trattativa-valore-campo">
              <input
                type="text"
                inputMode="decimal"
                value={valore}
                onChange={(e) => setValore(e.target.value)}
                placeholder="1080"
                aria-label="Valore del contratto in euro"
              />
              <span aria-hidden="true">€</span>
            </span>
          )}

          <button
            type="button"
            className="btn btn-sm"
            // Nota e valore sono obbligatori anche di qua, non solo sul
            // server: un pulsante che si preme e risponde con un errore è
            // peggio di uno che dice prima che non è pronto.
            disabled={
              inCorso ||
              !motivo.trim() ||
              (chiedeValore(chiedoMotivo) && valoreDaTesto(valore) === null)
            }
            onClick={() =>
              esegui(() =>
                cambiaStato(
                  t.id,
                  chiedoMotivo,
                  motivo,
                  chiedeValore(chiedoMotivo) ? valoreDaTesto(valore) : null
                )
              )
            }
          >
            {CONFERMA_MOTIVO[chiedoMotivo]}
          </button>
          {/* "Lascia stare" e non "Annulla": accanto a un pulsante che
              annulla la trattativa, due «annulla» che fanno cose opposte
              sono il modo di premere quello sbagliato. */}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChiedoMotivo(null)}>
            Lascia stare
          </button>
        </span>
      )}

      {/* La nota della chiusura, sotto gli occhi. Un'annullata senza il
          perché è una riga sparita dalla pipeline senza spiegazione; una
          vinta senza nota non dice cosa è stato venduto. */}
      {!chiedoMotivo && eChiusa(t.stato) && motivoDi(t) && (
        <span className="trattativa-chi muted">
          {t.stato === 'vinto' ? 'venduto: ' : t.stato === 'annullato' ? 'annullata: ' : 'motivo: '}
          {motivoDi(t)}
          {t.stato === 'vinto' && euro(t.valore_euro) && ` · ${euro(t.valore_euro)}`}
        </span>
      )}

      {eChiusa(t.stato) && !modificabile && (
        <span className="trattativa-chi muted">chiusa</span>
      )}

      {/* Cosa chiede lo stato (AZIONE_STATO in lib/pipeline.ts): il badge dice
          dov'è la trattativa, questa riga dice cosa farne. Su una persa il
          motivo qui sopra è già la spiegazione, e ripeterlo sarebbe rumore. */}
      {!(eChiusa(t.stato) && motivoDi(t)) && (
        <p className="trattativa-azione">{AZIONE_STATO[t.stato]}</p>
      )}

      {errore && (
        <span className="field-hint" style={{ color: 'var(--error)', flexBasis: '100%' }}>
          {errore}
        </span>
      )}
    </div>
  )
}

'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  DURATA_PREDEFINITA,
  OPZIONI_TIPO,
  OPZIONI_TIPO_PROGRAMMABILI,
  eAppuntamentoVero,
  eSoloRegistrato,
  eTipoValido,
} from '@/lib/agenda'
import { ETICHETTE_MODO, MODI, SPIEGAZIONI_MODO, type ModoEvento } from '@/lib/eventi'
import { nomePersona, testoRicerca } from '@/lib/persone'
import { useGiornoSelezionato } from '@/components/CalendarioAgenda'
import { creaVoce } from './actions'

/** I contatti fra cui scegliere: l'anagrafica deduplicata. */
export type ContattoScegliibile = {
  id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
}

// Il form si apre solo su richiesta: l'agenda si guarda molto più spesso di
// quanto ci si aggiunga qualcosa, e un form sempre aperto in cima ruberebbe
// lo spazio alla giornata.
export function NuovaVoce({
  giornoPredefinito,
  operatori,
  contatti,
  contattiTroncati = false,
}: {
  giornoPredefinito: string
  operatori: string[]
  contatti: ContattoScegliibile[]
  /** Vero se l'elenco è stato tagliato: si dice, non si nasconde. */
  contattiTroncati?: boolean
}) {
  const [aperto, setAperto] = useState(false)
  // Dentro il calendario vince il giorno che si sta guardando: chi clicca su
  // una casella e poi "Aggiungi" intende quel giorno, non oggi.
  const giornoDalCalendario = useGiornoSelezionato()
  const giorno = giornoDalCalendario ?? giornoPredefinito
  const [modo, setModo] = useState<ModoEvento>('programma')
  const [tipo, setTipo] = useState('appuntamento_in_sede')
  const [filtro, setFiltro] = useState('')
  const [personaId, setPersonaId] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  const durataSuggerita = eTipoValido(tipo) ? DURATA_PREDEFINITA[tipo] : 10
  const conOrario = eTipoValido(tipo) && eAppuntamentoVero(tipo)

  // Email e WhatsApp non si programmano (vedi TIPI_SOLO_REGISTRATI): si
  // mandano e si registrano. Scegliendoli, il modo passa a «Registra» e
  // l'altro pulsante sparisce, invece di restare lì a promettere qualcosa che
  // il server rifiuterebbe.
  const soloRegistrabile = eTipoValido(tipo) && eSoloRegistrato(tipo)
  const modoEffettivo: ModoEvento = soloRegistrabile ? 'registra' : modo
  const tipiOfferti = modoEffettivo === 'registra' ? OPZIONI_TIPO : OPZIONI_TIPO_PROGRAMMABILI

  // Un campo di ricerca sopra la tendina invece di una tendina lunghissima:
  // i contatti crescono con le richieste dal sito, e scorrerne trecento per
  // trovarne uno è peggio di scriverne tre lettere.
  const contattiFiltrati = useMemo(() => {
    const cercato = filtro.trim().toLowerCase()
    const elenco = cercato
      ? contatti.filter((c) => testoRicerca(c).includes(cercato))
      : contatti
    return elenco
  }, [contatti, filtro])

  function invia(formData: FormData) {
    setErrore(null)
    startTransition(async () => {
      const esito = await creaVoce(formData)
      if (esito.ok) {
        setAperto(false)
        setPersonaId('')
        setFiltro('')
        setModo('programma')
      } else {
        setErrore(esito.errore)
      }
    })
  }

  if (!aperto) {
    return (
      <button type="button" className="btn" onClick={() => setAperto(true)}>
        Aggiungi in agenda
      </button>
    )
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Nuova voce</h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAperto(false)}>
          Chiudi
        </button>
      </div>

      {errore && <p className="error-banner">{errore}</p>}

      <form action={invia}>
        {/* Programma o registra, dichiarato invece che indovinato dalla data:
            prima una telefonata appena fatta e annotata per il giorno dopo
            restava «da fare», e un impegno fissato per stamattina nasceva
            già chiuso. */}
        <input type="hidden" name="modo" value={modoEffettivo} />
        <div className="modo-evento">
          <div className="esito-gruppi" role="group" aria-label="Programma o registra">
            {MODI.filter((m) => !(soloRegistrabile && m === 'programma')).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm${modoEffettivo === m ? '' : ' btn-ghost'}`}
                aria-pressed={modoEffettivo === m}
                onClick={() => setModo(m)}
              >
                {ETICHETTE_MODO[m]}
              </button>
            ))}
          </div>
          <p className="field-hint">{SPIEGAZIONI_MODO[modoEffettivo]}</p>
        </div>

        {/* Il contatto è obbligatorio: una voce senza contatto non compare
            nella scheda di nessuno, e in agenda è un titolo senza il perché.
            Si ritrovava solo per caso, scorrendo il giorno giusto. */}
        <div className="form-row">
          <div className="field">
            <label htmlFor="cerca-contatto">Cerca il contatto</label>
            <input
              id="cerca-contatto"
              type="search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Nome, email o cellulare"
              autoComplete="off"
            />
            {contattiTroncati && !filtro.trim() && (
              <p className="field-hint">
                Elenco parziale: sono i contatti più recenti. Cerca per nome per trovare gli altri.
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="persona_id">
              Contatto <span aria-hidden="true">*</span>
            </label>
            <select
              id="persona_id"
              name="persona_id"
              required
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
            >
              <option value="">— scegli —</option>
              {contattiFiltrati.map((c) => (
                <option key={c.id} value={c.id}>
                  {nomePersona(c)}
                  {c.email ? ` · ${c.email}` : c.cellulare ? ` · ${c.cellulare}` : ''}
                </option>
              ))}
            </select>
            {contattiFiltrati.length === 0 && (
              <p className="field-hint">
                Nessun contatto con questo testo. I contatti nascono dalle richieste del sito.
              </p>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="field" style={{ flexBasis: '100%' }}>
            <label htmlFor="titolo">Titolo</label>
            <input id="titolo" name="titolo" type="text" required autoComplete="off" />
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="tipo">Tipo</label>
            <select id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {tipiOfferti.map((o) => (
                <option key={o.valore} value={o.valore}>
                  {o.etichetta}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="data">Giorno</label>
            <input id="data" name="data" type="date" required key={giorno} defaultValue={giorno} />
          </div>
          {/* Ora e durata solo per gli appuntamenti veri: sono i soli che
              prendono un impegno a un'orario preciso e che togliono uno slot
              al sito. Per un'email o una cosa da fare basta il giorno, e un
              campo ora lì inviterebbe a occupare una fascia per niente. */}
          {conOrario && (
            <>
              <div className="field">
                <label htmlFor="ora">Ora</label>
                <input id="ora" name="ora" type="time" />
                <p className="field-hint">Vuota = entro la giornata, senza occupare uno slot.</p>
              </div>
              <div className="field">
                <label htmlFor="durata_minuti">Durata (min)</label>
                <input
                  id="durata_minuti"
                  name="durata_minuti"
                  type="number"
                  min={5}
                  max={480}
                  step={5}
                  key={tipo}
                  defaultValue={durataSuggerita}
                />
              </div>
            </>
          )}
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="assegnato_a">Assegnata a</label>
            <input
              id="assegnato_a"
              name="assegnato_a"
              type="text"
              list="elenco-operatori"
              placeholder="lascia vuoto per te"
              autoComplete="off"
            />
            <datalist id="elenco-operatori">
              {operatori.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
          <div className="field" style={{ flexBasis: '100%' }}>
            <label htmlFor="note">Note</label>
            <input id="note" name="note" type="text" autoComplete="off" />
          </div>
        </div>

        {/* Registrare è chiudere: servono l'esito e la nota, gli stessi che
            chiede «Chiudi con esito». Un evento nato chiuso senza il perché
            fra un mese non si rilegge. */}
        {modoEffettivo === 'registra' && (
          <div className="form-row">
            <div className="field">
              <label htmlFor="esito">Com&apos;è andata</label>
              <select id="esito" name="esito" defaultValue="eseguita">
                <option value="eseguita">Eseguita</option>
                <option value="fallita">Fallita</option>
              </select>
            </div>
            <div className="field" style={{ flexBasis: '100%' }}>
              <label htmlFor="nota_esito">
                Nota <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="nota_esito"
                name="nota_esito"
                rows={2}
                required
                placeholder="Cosa è stato detto e cosa succede adesso"
              />
            </div>
          </div>
        )}

        <button type="submit" className="btn" disabled={inCorso}>
          {inCorso ? 'Salvataggio…' : `${ETICHETTE_MODO[modoEffettivo]} in agenda`}
        </button>
      </form>
    </div>
  )
}

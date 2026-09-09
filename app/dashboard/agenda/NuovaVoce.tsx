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
import { nomePersona, testoRicerca, validaNuovoContatto } from '@/lib/persone'
import { dividiTestoContatto } from './nuovo-contatto'
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
  // Elenco o contatto nuovo: due strade dichiarate, non un campo che cambia
  // significato. Chi arriva qui sta quasi sempre scegliendo dall'elenco — il
  // contatto nuovo è l'eccezione, e si chiede.
  const [contattoNuovo, setContattoNuovo] = useState(false)
  const [nuovo, setNuovo] = useState({ nome: '', cognome: '', email: '', cellulare: '' })
  const [errore, setErrore] = useState<string | null>(null)
  const [avviso, setAvviso] = useState<string | null>(null)
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

  /**
   * Passa a «Nuovo contatto» portandosi dietro quello che era stato scritto
   * nella ricerca: chi ha appena cercato «Mario Rossi» o un numero, e non lo
   * ha trovato, non deve riscriverlo nel campo accanto.
   */
  function passaANuovo() {
    setContattoNuovo(true)
    setPersonaId('')
    setErrore(null)
    setNuovo((precedente) =>
      // Solo sui campi ancora vuoti: se si torna indietro e si riparte, non
      // si sovrascrive quello che era già stato scritto a mano.
      precedente.nome || precedente.cognome || precedente.email || precedente.cellulare
        ? precedente
        : { ...precedente, ...dividiTestoContatto(filtro) }
    )
  }

  function invia(formData: FormData) {
    setErrore(null)
    setAvviso(null)

    // La stessa regola del server, chiesta prima di partire: «serve l'email o
    // il cellulare» detto subito costa un colpo d'occhio, detto dopo il giro
    // costa un form che si è già svuotato a metà. La funzione è una sola
    // (lib/persone.ts), quindi le due risposte non possono divergere.
    if (contattoNuovo) {
      const validato = validaNuovoContatto(nuovo)
      if ('errore' in validato) {
        setErrore(validato.errore)
        return
      }
    }

    startTransition(async () => {
      const esito = await creaVoce(formData)
      if (esito.ok) {
        setAperto(false)
        setPersonaId('')
        setFiltro('')
        setModo('programma')
        setContattoNuovo(false)
        setNuovo({ nome: '', cognome: '', email: '', cellulare: '' })
        // Un contatto «nuovo» che in anagrafica c'era già va detto: la voce è
        // salvata, ma sulla scheda di quella persona lì.
        setAvviso(esito.avviso ?? null)
      } else {
        setErrore(esito.errore)
      }
    })
  }

  if (!aperto) {
    return (
      <>
        {/* L'avviso sopravvive alla chiusura del form: è la sola traccia di
            un contatto «nuovo» finito su una scheda che esisteva già, e
            sparendo col form non lo leggerebbe nessuno. */}
        {avviso && (
          <p className="info-banner" role="status">
            {avviso}{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAvviso(null)}>
              Ho capito
            </button>
          </p>
        )}
        <button type="button" className="btn" onClick={() => setAperto(true)}>
          Aggiungi in agenda
        </button>
      </>
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
            Si ritrovava solo per caso, scorrendo il giorno giusto.

            E se non c'è si crea qui: al telefono o al banco arriva gente che
            non ha mai compilato un form, e prima l'unico modo di fissarle un
            appuntamento era mandarla sul sito a scrivere una richiesta. */}
        <input type="hidden" name="contatto_modo" value={contattoNuovo ? 'nuovo' : 'elenco'} />
        <div className="modo-evento">
          <div className="esito-gruppi" role="group" aria-label="Contatto in elenco o nuovo">
            <button
              type="button"
              className={`btn btn-sm${contattoNuovo ? ' btn-ghost' : ''}`}
              aria-pressed={!contattoNuovo}
              onClick={() => {
                setContattoNuovo(false)
                setErrore(null)
              }}
            >
              Dall&apos;elenco
            </button>
            <button
              type="button"
              className={`btn btn-sm${contattoNuovo ? '' : ' btn-ghost'}`}
              aria-pressed={contattoNuovo}
              onClick={passaANuovo}
            >
              Nuovo contatto
            </button>
          </div>
          <p className="field-hint">
            {contattoNuovo
              ? 'Entra in anagrafica adesso, segnato come inserito a mano. Se ci fosse già — stessa email o stesso numero — la voce va sulla scheda che c’è, senza doppioni.'
              : 'Il contatto a cui agganciare la voce. Se non è in elenco, creane uno nuovo.'}
          </p>
        </div>

        {contattoNuovo ? (
          <div className="form-row">
            <div className="field">
              <label htmlFor="nuovo_nome">
                Nome <span aria-hidden="true">*</span>
              </label>
              <input
                id="nuovo_nome"
                name="nuovo_nome"
                type="text"
                required
                value={nuovo.nome}
                onChange={(e) => setNuovo({ ...nuovo, nome: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="nuovo_cognome">Cognome</label>
              <input
                id="nuovo_cognome"
                name="nuovo_cognome"
                type="text"
                value={nuovo.cognome}
                onChange={(e) => setNuovo({ ...nuovo, cognome: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="nuovo_email">Email</label>
              <input
                id="nuovo_email"
                name="nuovo_email"
                type="email"
                value={nuovo.email}
                onChange={(e) => setNuovo({ ...nuovo, email: e.target.value })}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="nuovo_cellulare">Cellulare</label>
              <input
                id="nuovo_cellulare"
                name="nuovo_cellulare"
                type="tel"
                value={nuovo.cellulare}
                onChange={(e) => setNuovo({ ...nuovo, cellulare: e.target.value })}
                autoComplete="off"
              />
              {/* Una delle due chiavi serve davvero: sono quelle con cui il
                  database riconosce la persona quando torna (vedi
                  validaNuovoContatto). E un appuntamento con qualcuno che non
                  si può né chiamare né avvisare è un appuntamento a metà. */}
              <p className="field-hint">
                Serve l&apos;email o il cellulare: è così che lo ritroviamo quando torna.
              </p>
            </div>
          </div>
        ) : (
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
                  Elenco parziale: sono i contatti più recenti. Cerca per nome per trovare gli
                  altri.
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
              {/* La ricerca a vuoto era un vicolo cieco: diceva che i
                  contatti nascono dalle richieste del sito, e chi aveva la
                  persona al telefono restava lì. Adesso da qui si crea. */}
              {contattiFiltrati.length === 0 && (
                <p className="field-hint">
                  Nessun contatto con questo testo.{' '}
                  <button type="button" className="link-testo" onClick={passaANuovo}>
                    Crealo adesso
                  </button>
                  .
                </p>
              )}
            </div>
          </div>
        )}

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

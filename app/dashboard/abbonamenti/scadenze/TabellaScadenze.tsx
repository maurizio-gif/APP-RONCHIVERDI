'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react'
import { testoRicerca, dataBreve as dataBreveAnno, dataOra } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import { NON_CATEGORIZZATO, type Gruppo } from '@/lib/abbonamenti'
import { nomeDiEmail } from '@/lib/staff'
import { SelettoreAssegnatario } from '@/components/SelettoreAssegnatario'
import { IconaNuovaScheda } from '@/components/IconaNuovaScheda'
import {
  aggiungiNotaScadenza,
  assegnaScadenza,
  impostaEsclusoReport,
  impostaStatoManuale,
  salvaMotivoNonRinnovo,
  type StatoManuale,
} from './actions'
import { MOTIVI_NON_RINNOVO } from './motivi'
import type { NotaScadenza, TipoNota } from './note'
import { etichettaDurata, giorniDurata } from './durata'

export type RigaScadenza = {
  id: string
  persona_id: string | null
  abbonamento: string | null
  gruppo_id: string | null
  data_inizio: string | null
  data_fine: string
  totale: number | null
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  rinnovato: boolean
  rinnovo_id: string | null
  rinnovo_abbonamento: string | null
  rinnovo_data_inizio: string | null
  rinnovo_data_fine: string | null
  rinnovo_totale: number | null
  venditore_nome: string | null
  // Lavorazione manuale del rinnovo: nessuna sincronizzazione la scrive, la
  // imposta solo chi lavora la scadenza — vedi actions.ts e
  // abbonamenti_scadenze_lavorazione. null = ancora da valutare.
  stato_manuale: StatoManuale
  motivo_non_rinnovo: string | null
  note_non_rinnovo: string | null
  nota: string | null
  assegnato_a: string | null
  escluso_da_report: boolean
  // Durata venduta, da Info4U (vedi durata.ts): 12 + 'M' = annuale.
  durata: number | null
  periodo: string | null
  rinnovo_durata: number | null
  rinnovo_periodo: string | null
}

type Colonna =
  | 'persona'
  | 'prodotto'
  | 'gruppo'
  | 'data_inizio'
  | 'data_fine'
  | 'totale'
  | 'rinnovato'
  | 'stato'
  | 'motivo'
  | 'assegnatario'
  | 'rinnovo_abbonamento'
  | 'rinnovo_data_inizio'
  | 'rinnovo_data_fine'
  | 'rinnovo_totale'
  | 'venditore'

// ISO 'YYYY-MM-DD' ordina correttamente anche come testo: nessun bisogno di
// passare da Date per le colonne data. rinnovato diventa 0/1 per stare nello
// stesso confronto numerico delle altre colonne di importo.
const TIPO_COLONNA: Record<Colonna, 'testo' | 'numero'> = {
  persona: 'testo',
  prodotto: 'testo',
  gruppo: 'testo',
  data_inizio: 'testo',
  data_fine: 'testo',
  totale: 'numero',
  rinnovato: 'numero',
  stato: 'testo',
  motivo: 'testo',
  assegnatario: 'testo',
  rinnovo_abbonamento: 'testo',
  rinnovo_data_inizio: 'testo',
  rinnovo_data_fine: 'testo',
  rinnovo_totale: 'numero',
  venditore: 'testo',
}

function confronta(a: string | number | null, b: string | number | null, tipo: 'testo' | 'numero'): number {
  // I valori mancanti vanno sempre in fondo, qualunque sia il verso
  // dell'ordinamento: un "non ancora rinnovato" senza data non deve saltare
  // in cima solo perché si è invertito il verso.
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (tipo === 'numero') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), 'it')
}

function valoreColonna(
  r: RigaScadenza,
  colonna: Colonna,
  nomeGruppo: Map<string, string>,
  nomiStaff: Record<string, string>
): string | number | null {
  switch (colonna) {
    case 'persona':
      return [r.cognome, r.nome].filter(Boolean).join(' ') || null
    case 'prodotto':
      return r.abbonamento
    case 'gruppo':
      return r.gruppo_id ? (nomeGruppo.get(r.gruppo_id) ?? null) : 'Non categorizzato'
    case 'data_inizio':
      return r.data_inizio
    case 'data_fine':
      return r.data_fine
    case 'totale':
      return r.totale
    case 'rinnovato':
      return r.rinnovato ? 1 : 0
    case 'stato':
      return r.stato_manuale
    case 'motivo':
      return r.motivo_non_rinnovo
    case 'assegnatario':
      return nomeDiEmail(r.assegnato_a, nomiStaff)
    case 'rinnovo_abbonamento':
      return r.rinnovo_abbonamento
    case 'rinnovo_data_inizio':
      return r.rinnovo_data_inizio
    case 'rinnovo_data_fine':
      return r.rinnovo_data_fine
    case 'rinnovo_totale':
      return r.rinnovo_totale
    case 'venditore':
      return r.venditore_nome
  }
}

type Filtri = {
  persona: string
  prodotto: string
  gruppo: string
  dataInizioDa: string
  dataInizioA: string
  dataFineDa: string
  dataFineA: string
  totaleMin: string
  totaleMax: string
  rinnovato: '' | 'si' | 'no' | 'escluso'
  // L'etichetta (es. "Annuale"), non il numero: è quello che si sceglie.
  durata: string
  stato: '' | 'vuoto' | 'in_trattativa' | 'perso'
  assegnatario: string
  rinnovoAbbonamento: string
  rinnovoDataInizioDa: string
  rinnovoDataInizioA: string
  rinnovoDataFineDa: string
  rinnovoDataFineA: string
  rinnovoTotaleMin: string
  rinnovoTotaleMax: string
  venditore: string
}

const FILTRI_VUOTI: Filtri = {
  persona: '',
  prodotto: '',
  gruppo: '',
  dataInizioDa: '',
  dataInizioA: '',
  dataFineDa: '',
  dataFineA: '',
  totaleMin: '',
  totaleMax: '',
  rinnovato: '',
  durata: '',
  rinnovoAbbonamento: '',
  rinnovoDataInizioDa: '',
  rinnovoDataInizioA: '',
  rinnovoDataFineDa: '',
  rinnovoDataFineA: '',
  rinnovoTotaleMin: '',
  rinnovoTotaleMax: '',
  venditore: '',
  stato: '',
  assegnatario: '',
}

function filtriAttivi(f: Filtri): boolean {
  return Object.values(f).some((v) => v !== '')
}

function corrisponde(r: RigaScadenza, f: Filtri): boolean {
  if (f.persona) {
    const testo = testoRicerca({ nome: r.nome, cognome: r.cognome, email: r.email, cellulare: r.cellulare })
    if (!testo.includes(f.persona.trim().toLowerCase())) return false
  }
  if (f.prodotto && !(r.abbonamento ?? '').toLowerCase().includes(f.prodotto.trim().toLowerCase())) return false
  if (f.gruppo && (r.gruppo_id ?? NON_CATEGORIZZATO) !== f.gruppo) return false
  if (f.dataInizioDa && (!r.data_inizio || r.data_inizio < f.dataInizioDa)) return false
  if (f.dataInizioA && (!r.data_inizio || r.data_inizio > f.dataInizioA)) return false
  if (f.dataFineDa && r.data_fine < f.dataFineDa) return false
  if (f.dataFineA && r.data_fine > f.dataFineA) return false
  if (f.totaleMin && (r.totale === null || Number(r.totale) < Number(f.totaleMin))) return false
  if (f.totaleMax && (r.totale === null || Number(r.totale) > Number(f.totaleMax))) return false
  // Escluso è un terzo stato a sé, alternativo a rinnovato/non rinnovato — non
  // un sottoinsieme di "non ancora rinnovato" — quindi "Rinnovato" e "Non
  // ancora rinnovato" qui sotto lo escludono esplicitamente.
  if (f.durata && (etichettaDurata(r.durata, r.periodo) ?? 'Non indicata') !== f.durata) return false
  if (f.rinnovato === 'si' && (!r.rinnovato || r.escluso_da_report)) return false
  if (f.rinnovato === 'no' && (r.rinnovato || r.escluso_da_report)) return false
  if (f.rinnovato === 'escluso' && !r.escluso_da_report) return false
  if (f.stato === 'vuoto' && r.stato_manuale) return false
  if (f.stato === 'in_trattativa' && r.stato_manuale !== 'in_trattativa') return false
  if (f.stato === 'perso' && r.stato_manuale !== 'perso') return false
  if (f.assegnatario === 'nessuno' && r.assegnato_a) return false
  if (f.assegnatario && f.assegnatario !== 'nessuno' && r.assegnato_a !== f.assegnatario) return false
  if (
    f.rinnovoAbbonamento &&
    !(r.rinnovo_abbonamento ?? '').toLowerCase().includes(f.rinnovoAbbonamento.trim().toLowerCase())
  )
    return false
  if (f.rinnovoDataInizioDa && (!r.rinnovo_data_inizio || r.rinnovo_data_inizio < f.rinnovoDataInizioDa)) return false
  if (f.rinnovoDataInizioA && (!r.rinnovo_data_inizio || r.rinnovo_data_inizio > f.rinnovoDataInizioA)) return false
  if (f.rinnovoDataFineDa && (!r.rinnovo_data_fine || r.rinnovo_data_fine < f.rinnovoDataFineDa)) return false
  if (f.rinnovoDataFineA && (!r.rinnovo_data_fine || r.rinnovo_data_fine > f.rinnovoDataFineA)) return false
  if (f.rinnovoTotaleMin && (r.rinnovo_totale === null || Number(r.rinnovo_totale) < Number(f.rinnovoTotaleMin)))
    return false
  if (f.rinnovoTotaleMax && (r.rinnovo_totale === null || Number(r.rinnovo_totale) > Number(f.rinnovoTotaleMax)))
    return false
  if (f.venditore && r.venditore_nome !== f.venditore) return false
  return true
}

function CampoTesto({
  label,
  valore,
  onCambia,
  placeholder,
}: {
  label: string
  valore: string
  onCambia: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input type="search" value={valore} onChange={(e) => onCambia(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function CampoIntervallo({
  label,
  tipo,
  da,
  a,
  onDa,
  onA,
}: {
  label: string
  tipo: 'date' | 'number'
  da: string
  a: string
  onDa: (v: string) => void
  onA: (v: string) => void
}) {
  return (
    <div className={`field field-intervallo${tipo === 'date' ? ' is-date' : ''}`}>
      <label>{label}</label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input
          type={tipo}
          value={da}
          onChange={(e) => onDa(e.target.value)}
          placeholder="Da"
          aria-label={`${label} da`}
          step={tipo === 'number' ? '0.01' : undefined}
          style={{ flex: 1 }}
        />
        <input
          type={tipo}
          value={a}
          onChange={(e) => onA(e.target.value)}
          placeholder="A"
          aria-label={`${label} a`}
          step={tipo === 'number' ? '0.01' : undefined}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  )
}

/**
 * Lo stato manuale del rinnovo — vuoto, in trattativa o perso — a tendina
 * invece che una spunta sola: da quando "perso" è un terzo stato a sé (non
 * più solo l'assenza del flag "in trattativa"), un singolo checkbox non
 * basta più a rappresentarlo. Salvataggio ottimistico come altrove in questa
 * tabella: cambia subito, torna indietro da solo se il server rifiuta.
 * Disabilitato quando la riga è già rinnovata: a quel punto il fatto vero
 * (esiste un nuovo abbonamento) ha già risposto alla domanda, e uno stato
 * manuale che lo contraddicesse sarebbe un dato che mente.
 */
function CellaStato({
  abbonamentoId,
  valoreIniziale,
  disabilitato,
  onCambiato,
}: {
  abbonamentoId: string
  valoreIniziale: StatoManuale
  disabilitato: boolean
  // Le colonne Motivo e Note non rinnovo hanno senso solo su un rinnovo
  // perso, non su uno ancora in trattativa: la riga deve saperlo subito,
  // in ottimistico, per mostrarle o nasconderle senza aspettare il giro
  // sul server.
  onCambiato?: (nuovo: StatoManuale) => void
}) {
  const [valore, setValore] = useState(valoreIniziale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function alCambio(nuovo: StatoManuale) {
    const precedente = valore
    setValore(nuovo)
    onCambiato?.(nuovo)
    setErrore(null)
    startTransition(async () => {
      const esito = await impostaStatoManuale(abbonamentoId, nuovo)
      if (!esito.ok) {
        setValore(precedente)
        onCambiato?.(precedente)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <>
      <select
        className="trattativa-select"
        value={valore ?? ''}
        disabled={disabilitato || inCorso}
        onChange={(e) => alCambio((e.target.value || null) as StatoManuale)}
        aria-label="Stato"
      >
        <option value="">— vuoto —</option>
        <option value="in_trattativa">In trattativa</option>
        <option value="perso">Perso</option>
      </select>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </>
  )
}

/**
 * Il motivo del mancato rinnovo, a elenco fisso (vedi MOTIVI_NON_RINNOVO):
 * stesso principio di CellaStato, disabilitato quando la riga è già
 * rinnovata — un motivo di non rinnovo su un rinnovo avvenuto non
 * significherebbe niente.
 */
function CellaMotivoNonRinnovo({
  abbonamentoId,
  valoreIniziale,
  disabilitato,
}: {
  abbonamentoId: string
  valoreIniziale: string | null
  disabilitato: boolean
}) {
  const [valore, setValore] = useState(valoreIniziale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function alCambio(nuovo: string | null) {
    const precedente = valore
    setValore(nuovo)
    setErrore(null)
    startTransition(async () => {
      const esito = await salvaMotivoNonRinnovo(abbonamentoId, nuovo)
      if (!esito.ok) {
        setValore(precedente)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <>
      <select
        className="trattativa-select"
        value={valore ?? ''}
        disabled={disabilitato || inCorso}
        onChange={(e) => alCambio(e.target.value || null)}
        aria-label="Motivo non rinnovo"
      >
        <option value="">— nessuno —</option>
        {MOTIVI_NON_RINNOVO.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </>
  )
}

/**
 * A chi è affidato il rinnovo: la stessa tendina usata per le trattative
 * commerciali (SelettoreAssegnatario), ma con l'elenco degli operatori di
 * segreteria al posto dei commerciali — sono due gruppi di persone diversi,
 * vedi assegnaScadenza in actions.ts. Salvataggio ottimistico come le altre
 * celle di questa tabella: cambia subito, torna indietro da sola se il
 * server rifiuta (es. l'email non è (più) un operatore di segreteria).
 */
function CellaAssegnatario({
  abbonamentoId,
  valoreIniziale,
  operatori,
  nomiStaff,
  io,
  possoRiassegnare,
}: {
  abbonamentoId: string
  valoreIniziale: string | null
  operatori: string[]
  nomiStaff: Record<string, string>
  io: string | null
  possoRiassegnare: boolean
}) {
  const [valore, setValore] = useState(valoreIniziale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function alCambio(nuovo: string | null) {
    const precedente = valore
    setValore(nuovo)
    setErrore(null)
    startTransition(async () => {
      const esito = await assegnaScadenza(abbonamentoId, nuovo)
      if (!esito.ok) {
        setValore(precedente)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <>
      <SelettoreAssegnatario
        value={valore}
        onChange={alCambio}
        operatori={operatori}
        nomiStaff={nomiStaff}
        io={io}
        disabled={inCorso || (!!valore && valore !== io && !possoRiassegnare)}
        ariaLabel="Assegnatario"
      />
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </>
  )
}

/**
 * Le note di una scadenza — di gestione o sul mancato rinnovo, secondo
 * `tipo` — sul modello delle note sulle disdette di Athlon: si scrive in un campo libero, si invia, e la nota entra nello
 * storico con nome e orario di chi l'ha scritta — il campo si svuota, pronto
 * per la prossima. Niente più un testo unico riscritto a ogni salvataggio:
 * chi richiama il socio legge cosa si è detto le volte prima, e chi.
 *
 * La riga della tabella deve restare stretta qualunque sia il numero di
 * note: in cella c'è solo l'ultima, troncata su una riga, e il campo per la
 * prossima, anch'esso su una riga. Lo storico completo si legge in un
 * pannello laterale (StoricoNote), che si apre dall'anteprima o dal
 * contatore e lascia la tabella a vista dietro di sé.
 */
function CellaNote({
  abbonamentoId,
  tipo,
  titolo,
  persona,
  noteIniziali,
  nomiStaff,
  disabilitato = false,
}: {
  abbonamentoId: string
  tipo: TipoNota
  // Il titolo del pannello dello storico: "Note di gestione", "Note non rinnovo".
  titolo: string
  persona: string
  noteIniziali: NotaScadenza[]
  nomiStaff: Record<string, string>
  // Lo storico resta leggibile, ma non si scrive: es. una nota sul mancato
  // rinnovo di un abbonamento che nel frattempo è stato rinnovato.
  disabilitato?: boolean
}) {
  const [note, setNote] = useState(noteIniziali)
  const [storicoAperto, setStoricoAperto] = useState(false)

  const ultima = note[0]

  return (
    <div className="note-gestione">
      {ultima && (
        <button
          type="button"
          className="note-ultima"
          onClick={() => setStoricoAperto(true)}
          title="Apri lo storico delle note"
        >
          <span className="note-ultima-meta">
            {autoreNota(ultima, nomiStaff)} · {dataOra(ultima.creato_il)} —{' '}
          </span>
          {ultima.testo}
        </button>
      )}
      <div className="note-gestione-riga">
        {!disabilitato && (
          <CampoNuovaNota
            abbonamentoId={abbonamentoId}
            tipo={tipo}
            compatto
            onInviata={(n) => setNote((v) => [n, ...v])}
          />
        )}
        {note.length > 0 && (
          <button
            type="button"
            className="note-contatore"
            onClick={() => setStoricoAperto(true)}
            aria-label={`Storico note (${note.length})`}
            title="Apri lo storico delle note"
          >
            Storico ({note.length})
          </button>
        )}
      </div>
      {storicoAperto && (
        <StoricoNote
          abbonamentoId={abbonamentoId}
          tipo={tipo}
          titolo={titolo}
          disabilitato={disabilitato}
          persona={persona}
          note={note}
          nomiStaff={nomiStaff}
          onInviata={(n) => setNote((v) => [n, ...v])}
          onChiudi={() => setStoricoAperto(false)}
        />
      )}
    </div>
  )
}

function autoreNota(n: NotaScadenza, nomiStaff: Record<string, string>): string {
  return n.autore ? (nomeDiEmail(n.autore, nomiStaff) ?? n.autore) : 'Prima dello storico'
}

/**
 * Il campo per una nota nuova: Invia (o Cmd/Ctrl + Invio) la aggiunge allo
 * storico e svuota il campo. In cella è compatto — una riga, che si allarga
 * solo mentre ci si scrive — nel pannello dello storico è un'area piena.
 */
function CampoNuovaNota({
  abbonamentoId,
  tipo,
  compatto = false,
  onInviata,
}: {
  abbonamentoId: string
  tipo: TipoNota
  compatto?: boolean
  onInviata: (nota: NotaScadenza) => void
}) {
  const [testo, setTesto] = useState('')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()
  const scritta = testo.trim() !== ''

  function invia() {
    if (!scritta || inCorso) return
    setErrore(null)
    startTransition(async () => {
      const esito = await aggiungiNotaScadenza(abbonamentoId, tipo, testo)
      if (esito.ok) {
        onInviata(esito.nota)
        setTesto('')
      } else {
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div className={`note-nuova${compatto ? ' is-compatta' : ''}${scritta ? ' is-scritta' : ''}`}>
      <textarea
        className="textarea-inline"
        rows={compatto && !scritta ? 1 : 3}
        value={testo}
        placeholder="Nuova nota…"
        onChange={(e) => setTesto(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl + Invio invia, come in una chat: Invio da solo resta un
          // a capo, perché una nota può essere di più righe.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            invia()
          }
        }}
        disabled={inCorso}
        aria-label="Nuova nota"
      />
      {scritta && (
        <div className="note-gestione-azioni">
          <button type="button" className="btn btn-sm" onClick={invia} disabled={inCorso}>
            {inCorso ? 'Invio…' : 'Invia'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTesto('')} disabled={inCorso}>
            Annulla
          </button>
        </div>
      )}
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}

/**
 * Lo storico completo delle note di una scadenza, in un pannello che scorre
 * da destra sopra la pagina: un <dialog> nativo, quindi Esc chiude, il focus
 * resta dentro e la tabella sotto non si muove — si chiude e si è dove si
 * era. La più recente in cima, testo intero, e il campo per aggiungerne una.
 */
function StoricoNote({
  abbonamentoId,
  tipo,
  titolo,
  disabilitato,
  persona,
  note,
  nomiStaff,
  onInviata,
  onChiudi,
}: {
  abbonamentoId: string
  tipo: TipoNota
  titolo: string
  disabilitato: boolean
  persona: string
  note: NotaScadenza[]
  nomiStaff: Record<string, string>
  onInviata: (nota: NotaScadenza) => void
  onChiudi: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="pannello-note"
      onClose={onChiudi}
      onClick={(e) => {
        // Clic sullo sfondo (fuori dal contenuto) chiude, come altrove.
        if (e.target === e.currentTarget) ref.current?.close()
      }}
      aria-label={`${titolo} — ${persona}`}
    >
      <div className="pannello-note-corpo">
        <div className="pannello-note-testa">
          <div>
            <p className="eyebrow">{titolo}</p>
            <h3 className="pannello-note-titolo">{persona}</h3>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()}>
            Chiudi
          </button>
        </div>
        {!disabilitato && <CampoNuovaNota abbonamentoId={abbonamentoId} tipo={tipo} onInviata={onInviata} />}
        {note.length === 0 ? (
          <p className="muted">Ancora nessuna nota.</p>
        ) : (
          <ul className="note-storico">
            {note.map((n) => (
              <li key={n.id}>
                <span className="note-storico-meta">
                  {autoreNota(n, nomiStaff)} · {dataOra(n.creato_il)}
                </span>
                <p className="note-storico-testo">{n.testo}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  )
}

/**
 * Fuori dal conteggio di rinnovi/trattative — un caso non pertinente, non un
 * rinnovato né un non-rinnovato — ma non nascosto: la riga resta in tabella e
 * nel grafico, come terza fetta a sé (vedi GraficoRinnovi), sempre
 * verificabile da chi vuole controllare cosa è stato escluso e perché.
 * Salvataggio ottimistico come le altre celle di questa tabella.
 */
function CellaEscludiReport({
  abbonamentoId,
  valoreIniziale,
  onCambiato,
}: {
  abbonamentoId: string
  valoreIniziale: boolean
  // Il badge Rinnovo (Rinnovato/Non ancora rinnovato/Escluso, sulla stessa
  // riga) deve saperlo subito, in ottimistico: è un terzo stato alternativo
  // agli altri due, non un dettaglio a parte.
  onCambiato?: (nuovo: boolean) => void
}) {
  const [valore, setValore] = useState(valoreIniziale)
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function alCambio(nuovo: boolean) {
    const precedente = valore
    setValore(nuovo)
    onCambiato?.(nuovo)
    setErrore(null)
    startTransition(async () => {
      const esito = await impostaEsclusoReport(abbonamentoId, nuovo)
      if (!esito.ok) {
        setValore(precedente)
        onCambiato?.(precedente)
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div className="cella-centrata">
      <input
        type="checkbox"
        checked={valore}
        disabled={inCorso}
        onChange={(e) => alCambio(e.target.checked)}
        aria-label="Escludi da report"
      />
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
  )
}

/**
 * La durata venduta sotto il nome del prodotto ("Annuale", "Mensile"…): il
 * nome da solo non la dice, lo stesso prodotto esiste in più durate.
 */
function EtichettaDurata({ durata, periodo }: { durata: number | null; periodo: string | null }) {
  const etichetta = etichettaDurata(durata, periodo)
  if (!etichetta) return null
  return <span className="badge-durata">{etichetta}</span>
}

/**
 * Una riga della tabella. Isolata in un componente proprio (e non inline
 * dentro il .map della tabella) solo per poter tenere lo stato locale
 * dell'ultimo valore scelto in Trattativa: Motivo e Note non rinnovo
 * compaiono soltanto quando è "Perso" — non su un rinnovo ancora in
 * trattativa, dove il motivo del mancato rinnovo non è ancora un fatto — e
 * devono aggiornarsi in ottimistico, appena si cambia la tendina, non solo
 * dopo il giro sul server.
 */
function RigaTabella({
  r,
  note,
  nascondiGruppo,
  nomeGruppo,
  operatoriSegreteria,
  nomiStaff,
  io,
  possoRiassegnare,
}: {
  r: RigaScadenza
  note: NotaScadenza[]
  nascondiGruppo: boolean
  nomeGruppo: Map<string, string>
  operatoriSegreteria: string[]
  nomiStaff: Record<string, string>
  io: string | null
  possoRiassegnare: boolean
}) {
  const [statoAttuale, setStatoAttuale] = useState<StatoManuale>(r.stato_manuale)
  const [esclusoAttuale, setEsclusoAttuale] = useState(r.escluso_da_report)
  const perso = statoAttuale === 'perso'
  const persona = [r.cognome, r.nome].filter(Boolean).join(' ') || 'Senza nome'
  const noteGestione = useMemo(() => note.filter((n) => n.tipo === 'gestione'), [note])
  const noteNonRinnovo = useMemo(() => note.filter((n) => n.tipo === 'non_rinnovo'), [note])

  return (
    <tr>
      <td className="cella-persona">
        {r.persona_id ? (
          // In una tab nuova: chi lavora i rinnovi apre la scheda per
          // controllare e torna alla tabella, senza perdere scorrimento,
          // filtri e ordinamento (tutto stato client, non nell'URL).
          <Link
            href={`/dashboard/persone/${r.persona_id}`}
            className="cella-nowrap link-nuova-scheda"
            target="_blank"
            rel="noopener"
          >
            {r.cognome} {r.nome}
            <IconaNuovaScheda />
          </Link>
        ) : (
          '—'
        )}
        {r.cellulare && (
          <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
            {r.cellulare}
          </div>
        )}
        {r.email && (
          <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
            {r.email}
          </div>
        )}
      </td>
      <td className="cella-nowrap">
        <CellaAssegnatario
          abbonamentoId={r.id}
          valoreIniziale={r.assegnato_a}
          operatori={operatoriSegreteria}
          nomiStaff={nomiStaff}
          io={io}
          possoRiassegnare={possoRiassegnare}
        />
      </td>
      <td className="cella-prodotto">
        {r.abbonamento ?? '—'}
        <EtichettaDurata durata={r.durata} periodo={r.periodo} />
      </td>
      {!nascondiGruppo && <td>{r.gruppo_id ? (nomeGruppo.get(r.gruppo_id) ?? '—') : 'Non categorizzato'}</td>}
      <td className="cella-nowrap">{dataBreveAnno(r.data_inizio)}</td>
      <td className="cella-nowrap">{dataBreveAnno(r.data_fine)}</td>
      <td className="cella-nowrap">{euro(r.totale) ?? '—'}</td>
      <td>{r.venditore_nome ?? '—'}</td>
      <td className="cella-nowrap">
        {esclusoAttuale ? (
          <span className="badge badge-off">Escluso</span>
        ) : r.rinnovato ? (
          <span className="badge badge-ok">Rinnovato</span>
        ) : (
          <span className="badge badge-warn">Non ancora rinnovato</span>
        )}
      </td>
      <td className="cella-nota cella-nota-larga">
        <CellaNote
          abbonamentoId={r.id}
          tipo="gestione"
          titolo="Note di gestione"
          persona={persona}
          noteIniziali={noteGestione}
          nomiStaff={nomiStaff}
        />
      </td>
      <td className="cella-nowrap">
        <CellaStato
          abbonamentoId={r.id}
          valoreIniziale={r.stato_manuale}
          disabilitato={r.rinnovato}
          onCambiato={setStatoAttuale}
        />
      </td>
      <td className="cella-nowrap">
        {perso ? (
          <CellaMotivoNonRinnovo abbonamentoId={r.id} valoreIniziale={r.motivo_non_rinnovo} disabilitato={r.rinnovato} />
        ) : (
          '—'
        )}
      </td>
      <td className={perso ? 'cella-nota cella-nota-larga' : undefined}>
        {perso ? (
          <CellaNote
            abbonamentoId={r.id}
            tipo="non_rinnovo"
            titolo="Note non rinnovo"
            persona={persona}
            noteIniziali={noteNonRinnovo}
            nomiStaff={nomiStaff}
            disabilitato={r.rinnovato}
          />
        ) : (
          '—'
        )}
      </td>
      <td className="cella-prodotto">
        {r.rinnovo_id ? (
          <>
            {r.rinnovo_abbonamento ?? '—'}
            <EtichettaDurata durata={r.rinnovo_durata} periodo={r.rinnovo_periodo} />
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="cella-nowrap">{r.rinnovo_id ? dataBreveAnno(r.rinnovo_data_inizio) : '—'}</td>
      <td className="cella-nowrap">{r.rinnovo_id ? dataBreveAnno(r.rinnovo_data_fine) : '—'}</td>
      <td className="cella-nowrap">{r.rinnovo_id ? (euro(r.rinnovo_totale) ?? '—') : '—'}</td>
      <td className="cella-centrata">
        <CellaEscludiReport
          abbonamentoId={r.id}
          valoreIniziale={r.escluso_da_report}
          onCambiato={setEsclusoAttuale}
        />
      </td>
    </tr>
  )
}

const NESSUNA_NOTA: NotaScadenza[] = []

type GruppoColonne = 'persona' | 'scadenza' | 'lavorazione' | 'rinnovo'

// I quattro blocchi in cui si legge la riga, nell'ordine delle colonne: chi
// lavora i rinnovi salta dall'uno all'altro (di solito dritto a
// "Lavorazione", dove si scrive), non scorre colonna per colonna.
const GRUPPI_COLONNE: { chiave: GruppoColonne; label: string }[] = [
  { chiave: 'persona', label: 'Persona' },
  { chiave: 'scadenza', label: 'Scadenza' },
  { chiave: 'lavorazione', label: 'Lavorazione' },
  { chiave: 'rinnovo', label: 'Nuovo abbonamento' },
]

/**
 * Il contenitore che scorre della tabella scadenze: diciotto colonne non
 * entrano in nessuno schermo, e con un mouse da computer fisso la rotellina
 * scorre solo in verticale — la barra orizzontale, in fondo a 350+ righe,
 * era di fatto irraggiungibile. Qui il contenitore è alto al più quanto la
 * finestra, così entrambe le barre restano sempre a vista; intestazione e
 * colonna Persona restano ferme (CSS, .tabella-scorri); sopra, i pulsanti
 * ◀ ▶ e i salti per blocco di colonne fanno quello che altrimenti
 * richiederebbe Shift + rotellina o un trackpad. Le ombre ai bordi dicono
 * da che parte c'è ancora tabella.
 */
function ScorrimentoTabella({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [bordi, setBordi] = useState({ sinistra: false, destra: false })
  const [attivo, setAttivo] = useState<GruppoColonne>('persona')

  const aggiorna = useCallback(() => {
    const el = ref.current
    if (!el) return
    const sinistra = el.scrollLeft > 1
    const destra = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setBordi((b) => (b.sinistra === sinistra && b.destra === destra ? b : { sinistra, destra }))

    // Il blocco "attivo" è l'ultimo la cui prima colonna è già arrivata al
    // bordo destro della colonna Persona, che resta ferma.
    const persona = el.querySelector<HTMLElement>('th[data-ancora="persona"]')
    const soglia = el.scrollLeft + (persona?.offsetWidth ?? 0) + 8
    let corrente: GruppoColonne = 'persona'
    for (const g of GRUPPI_COLONNE) {
      const th = el.querySelector<HTMLElement>(`th[data-ancora="${g.chiave}"]`)
      if (th && th.offsetLeft <= soglia) corrente = g.chiave
    }
    if (!destra) corrente = GRUPPI_COLONNE[GRUPPI_COLONNE.length - 1].chiave
    setAttivo(corrente)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    aggiorna()
    const osservatore = new ResizeObserver(aggiorna)
    osservatore.observe(el)
    if (el.firstElementChild) osservatore.observe(el.firstElementChild)
    return () => osservatore.disconnect()
  }, [aggiorna])

  function scorriDi(verso: 1 | -1) {
    const el = ref.current
    if (!el) return
    const persona = el.querySelector<HTMLElement>('th[data-ancora="persona"]')
    const visibile = el.clientWidth - (persona?.offsetWidth ?? 0)
    el.scrollBy({ left: verso * Math.max(visibile * 0.8, 200), behavior: 'smooth' })
  }

  function vaiA(gruppo: GruppoColonne) {
    const el = ref.current
    if (!el) return
    const th = el.querySelector<HTMLElement>(`th[data-ancora="${gruppo}"]`)
    const persona = el.querySelector<HTMLElement>('th[data-ancora="persona"]')
    if (!th) return
    const left = gruppo === 'persona' ? 0 : th.offsetLeft - (persona?.offsetWidth ?? 0)
    el.scrollTo({ left, behavior: 'smooth' })
  }

  const scorrevole = bordi.sinistra || bordi.destra

  return (
    <>
      {scorrevole && (
        <div className="tabella-scorri-barra">
          <div className="tabella-scorri-salti" role="group" aria-label="Vai alle colonne">
            {GRUPPI_COLONNE.map((g) => (
              <button
                key={g.chiave}
                type="button"
                className={`tabella-scorri-salto${attivo === g.chiave ? ' is-attivo' : ''}`}
                aria-pressed={attivo === g.chiave}
                onClick={() => vaiA(g.chiave)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <span className="muted tabella-scorri-aiuto">Shift + rotellina per scorrere di lato</span>
          <div className="tabella-scorri-frecce">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => scorriDi(-1)}
              disabled={!bordi.sinistra}
              aria-label="Colonne precedenti"
            >
              ◀
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => scorriDi(1)}
              disabled={!bordi.destra}
              aria-label="Colonne successive"
            >
              ▶
            </button>
          </div>
        </div>
      )}
      <div
        className={`tabella-scorri${bordi.sinistra ? ' ombra-sinistra' : ''}${bordi.destra ? ' ombra-destra' : ''}`}
      >
        <div ref={ref} className="tabella-scorri-area" onScroll={aggiorna}>
          {children}
        </div>
      </div>
    </>
  )
}

// Quali filtri stanno in ciascuna delle due sezioni apribili. Un intervallo
// (da/a) conta come un filtro solo: chi legge "2 attivi" pensa a due campi,
// non a quattro caselle.
const CHIAVI_SCADENZA: (keyof Filtri | [keyof Filtri, keyof Filtri])[] = [
  'persona',
  'prodotto',
  'durata',
  'gruppo',
  'venditore',
  ['dataInizioDa', 'dataInizioA'],
  ['dataFineDa', 'dataFineA'],
  ['totaleMin', 'totaleMax'],
]
const CHIAVI_RINNOVO: (keyof Filtri | [keyof Filtri, keyof Filtri])[] = [
  'rinnovoAbbonamento',
  ['rinnovoDataInizioDa', 'rinnovoDataInizioA'],
  ['rinnovoDataFineDa', 'rinnovoDataFineA'],
  ['rinnovoTotaleMin', 'rinnovoTotaleMax'],
]

function contaAttivi(f: Filtri, chiavi: (keyof Filtri | [keyof Filtri, keyof Filtri])[]): number {
  return chiavi.filter((k) => (Array.isArray(k) ? k.some((c) => f[c] !== '') : f[k] !== '')).length
}

/**
 * Una sezione di filtri che si apre e si chiude: un riquadro con una testata
 * cliccabile per intero — freccia che ruota, titolo, i campi che contiene,
 * e "Mostra filtri"/"Nascondi" scritto per esteso — invece di una scritta
 * minuscola con un "+" in coda, che non si capiva fosse un comando. Il
 * conteggio dei filtri attivi resta a vista anche da chiusa: un filtro
 * nascosto che restringe la tabella senza che si veda è il modo più sicuro
 * per credere che manchino delle righe.
 */
function SezioneFiltri({
  titolo,
  campi,
  attivi,
  aperta,
  onCambia,
  children,
}: {
  titolo: string
  campi: string
  attivi: number
  aperta: boolean
  onCambia: (aperta: boolean) => void
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <div className={`filtri-sezione${aperta ? ' is-aperta' : ''}`}>
      <button
        type="button"
        className="filtri-sezione-testa"
        aria-expanded={aperta}
        aria-controls={id}
        onClick={() => onCambia(!aperta)}
      >
        <svg
          className="filtri-sezione-freccia"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="filtri-sezione-testi">
          <span className="filtri-sezione-titolo">Filtri — {titolo}</span>
          <span className="filtri-sezione-campi">{campi}</span>
        </span>
        {attivi > 0 && (
          <span className="filtri-sezione-attivi">
            {attivi} {attivi === 1 ? 'attivo' : 'attivi'}
          </span>
        )}
        <span className="filtri-sezione-azione">{aperta ? 'Nascondi' : 'Mostra filtri'}</span>
      </button>
      {aperta && (
        <div id={id} className="filtri-sezione-corpo">
          {children}
        </div>
      )}
    </div>
  )
}

/**
 * L'elenco delle scadenze di un mese, con ordinamento per colonna (clic
 * sull'intestazione) e un filtro per colonna — in memoria, come in
 * ElencoRichieste: righeGrezze arriva già completo dal server (paginato lì
 * per aggirare il limite di 1000 righe di PostgREST), al più qualche
 * migliaio di righe anche nel mese di punta, e ordinare/filtrare mentre si
 * digita non giustifica un giro sul server.
 */
export function TabellaScadenze({
  righe,
  noteScadenze,
  gruppi,
  nascondiGruppo = false,
  operatoriSegreteria,
  nomiStaff,
  io,
  possoRiassegnare = false,
}: {
  righe: RigaScadenza[]
  // Lo storico delle note di gestione per abbonamento (vedi note.ts), la più
  // recente in cima. Una scadenza senza note semplicemente non c'è.
  noteScadenze: Record<string, NotaScadenza[]>
  gruppi: Gruppo[]
  // Vero sulla pagina Rinnovi (fissa sul gruppo Core, vedi
  // /dashboard/abbonamenti/rinnovi): il filtro e la colonna Gruppo
  // mostrerebbero sempre lo stesso valore, quindi sono solo rumore.
  nascondiGruppo?: boolean
  // Le email tra cui scegliere per "Assegnatario": solo chi ha
  // staff_users.operatore_segreteria — chi lavora davvero i rinnovi, non
  // tutto lo staff (vedi SelettoreAssegnatario).
  operatoriSegreteria: string[]
  // Tutto lo staff, non solo la segreteria: una nota di gestione può
  // scriverla anche chi entra da Abbonamenti (direzione), e va firmata col
  // suo nome.
  nomiStaff: Record<string, string>
  io: string | null
  // Chi può spostare un rinnovo già assegnato ad altri (la responsabile).
  possoRiassegnare?: boolean
}) {
  const nomeGruppo = useMemo(() => new Map(gruppi.map((g) => [g.id, g.nome])), [gruppi])

  // Chiuse di default: due sezioni di filtri raramente usate insieme (chi
  // cerca una persona non sta anche escludendo per importo di rinnovo), e
  // aperte entrambe la card più lunga della pagina era il primo blocco visto
  // scendendo. Stato/Trattativa/Assegnatario invece stanno fuori da queste
  // due sezioni, sempre visibili: sono i tre filtri che la responsabile usa
  // ogni giorno per vedere "cosa resta da fare e a chi", non un dettaglio da
  // aprire all'occorrenza.
  const [apertoScadenza, setApertoScadenza] = useState(false)
  const [apertoRinnovo, setApertoRinnovo] = useState(false)

  const [ordineColonna, setOrdineColonna] = useState<Colonna>('rinnovato')
  const [ordineDirezione, setOrdineDirezione] = useState<'asc' | 'desc'>('asc')
  const [filtri, setFiltri] = useState<Filtri>(FILTRI_VUOTI)

  function alClickColonna(colonna: Colonna) {
    if (colonna === ordineColonna) {
      setOrdineDirezione((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setOrdineColonna(colonna)
      setOrdineDirezione('asc')
    }
  }

  function aggiornaFiltro<K extends keyof Filtri>(chiave: K, valore: Filtri[K]) {
    setFiltri((f) => ({ ...f, [chiave]: valore }))
  }

  // Le durate presenti nel mese, dalla più breve alla più lunga: l'elenco
  // fisso di tutte quelle possibili offrirebbe scelte che non trovano niente.
  const venditoriDisponibili = useMemo(
    () =>
      [...new Set(righe.map((r) => r.venditore_nome).filter((n): n is string => !!n))].sort((a, b) =>
        a.localeCompare(b, 'it')
      ),
    [righe]
  )
  const durateDisponibili = useMemo(() => {
    const perEtichetta = new Map<string, number>()
    for (const r of righe) {
      const etichetta = etichettaDurata(r.durata, r.periodo) ?? 'Non indicata'
      if (!perEtichetta.has(etichetta)) perEtichetta.set(etichetta, giorniDurata(r.durata, r.periodo))
    }
    return [...perEtichetta.entries()].sort((a, b) => a[1] - b[1]).map(([etichetta]) => etichetta)
  }, [righe])

  const righeFiltrate = useMemo(() => righe.filter((r) => corrisponde(r, filtri)), [righe, filtri])

  const righeOrdinate = useMemo(() => {
    const copia = [...righeFiltrate]
    const tipo = TIPO_COLONNA[ordineColonna]
    copia.sort((ra, rb) => {
      const principale =
        confronta(
          valoreColonna(ra, ordineColonna, nomeGruppo, nomiStaff),
          valoreColonna(rb, ordineColonna, nomeGruppo, nomiStaff),
          tipo
        ) * (ordineDirezione === 'asc' ? 1 : -1)
      if (principale !== 0) return principale
      const secondario = confronta(ra.data_fine, rb.data_fine, 'testo')
      if (secondario !== 0) return secondario
      return ra.id.localeCompare(rb.id)
    })
    return copia
  }, [righeFiltrate, ordineColonna, ordineDirezione, nomeGruppo])

  function Intestazione({
    colonna,
    ancora,
    children,
  }: {
    colonna: Colonna
    ancora?: GruppoColonne
    children: React.ReactNode
  }) {
    const attiva = ordineColonna === colonna
    return (
      <th data-ancora={ancora}>
        <button type="button" className="th-ordina" onClick={() => alClickColonna(colonna)}>
          {children}
          {attiva && (
            <span className="th-ordina-freccia" aria-hidden="true">
              {ordineDirezione === 'asc' ? '▲' : '▼'}
            </span>
          )}
        </button>
      </th>
    )
  }

  const attivi = filtriAttivi(filtri)

  return (
    <>
      <div className="card">
        <p className="filtri-titolo">Stato, trattativa e assegnatario</p>
        <div className="form-row">
          <div className="field">
            <label>Stato</label>
            <select
              value={filtri.rinnovato}
              onChange={(e) => aggiornaFiltro('rinnovato', e.target.value as Filtri['rinnovato'])}
            >
              <option value="">Tutti</option>
              <option value="si">Rinnovato</option>
              <option value="no">Non ancora rinnovato</option>
              <option value="escluso">Escluso</option>
            </select>
          </div>
          <div className="field">
            <label>Trattativa</label>
            <select value={filtri.stato} onChange={(e) => aggiornaFiltro('stato', e.target.value as Filtri['stato'])}>
              <option value="">Tutti</option>
              <option value="vuoto">Vuoto</option>
              <option value="in_trattativa">In trattativa</option>
              <option value="perso">Perso</option>
            </select>
          </div>
          <div className="field">
            <label>Assegnatario</label>
            <select value={filtri.assegnatario} onChange={(e) => aggiornaFiltro('assegnatario', e.target.value)}>
              <option value="">Tutti</option>
              <option value="nessuno">Non assegnato</option>
              {operatoriSegreteria.map((email) => (
                <option key={email} value={email}>
                  {nomeDiEmail(email, nomiStaff)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SezioneFiltri
          titolo="Abbonamento in scadenza"
          campi={`Persona, prodotto, durata${nascondiGruppo ? '' : ', gruppo'}, venditore, date e importo`}
          attivi={contaAttivi(filtri, CHIAVI_SCADENZA)}
          aperta={apertoScadenza}
          onCambia={setApertoScadenza}
        >
          <div className="form-row">
            <CampoTesto
              label="Persona"
              valore={filtri.persona}
              onCambia={(v) => aggiornaFiltro('persona', v)}
              placeholder="Nome, cognome, email o cellulare"
            />
            <CampoTesto
              label="Prodotto"
              valore={filtri.prodotto}
              onCambia={(v) => aggiornaFiltro('prodotto', v)}
            />
            <div className="field">
              <label>Durata</label>
              <select value={filtri.durata} onChange={(e) => aggiornaFiltro('durata', e.target.value)}>
                <option value="">Tutte</option>
                {durateDisponibili.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            {!nascondiGruppo && (
              <div className="field">
                <label>Gruppo</label>
                <select value={filtri.gruppo} onChange={(e) => aggiornaFiltro('gruppo', e.target.value)}>
                  <option value="">Tutti</option>
                  {gruppi.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nome}
                    </option>
                  ))}
                  <option value={NON_CATEGORIZZATO}>Non categorizzato</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Venditore</label>
              <select value={filtri.venditore} onChange={(e) => aggiornaFiltro('venditore', e.target.value)}>
                <option value="">Tutti</option>
                {venditoriDisponibili.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <CampoIntervallo
              label="Data inizio"
              tipo="date"
              da={filtri.dataInizioDa}
              a={filtri.dataInizioA}
              onDa={(v) => aggiornaFiltro('dataInizioDa', v)}
              onA={(v) => aggiornaFiltro('dataInizioA', v)}
            />
            <CampoIntervallo
              label="Scadenza"
              tipo="date"
              da={filtri.dataFineDa}
              a={filtri.dataFineA}
              onDa={(v) => aggiornaFiltro('dataFineDa', v)}
              onA={(v) => aggiornaFiltro('dataFineA', v)}
            />
            <CampoIntervallo
              label="Importo (€)"
              tipo="number"
              da={filtri.totaleMin}
              a={filtri.totaleMax}
              onDa={(v) => aggiornaFiltro('totaleMin', v)}
              onA={(v) => aggiornaFiltro('totaleMax', v)}
            />
          </div>
        </SezioneFiltri>

        <SezioneFiltri
          titolo="Abbonamento rinnovato"
          campi="Nuovo abbonamento, nuove date e nuovo importo"
          attivi={contaAttivi(filtri, CHIAVI_RINNOVO)}
          aperta={apertoRinnovo}
          onCambia={setApertoRinnovo}
        >
          <div className="form-row">
            <CampoTesto
              label="Nuovo abbonamento"
              valore={filtri.rinnovoAbbonamento}
              onCambia={(v) => aggiornaFiltro('rinnovoAbbonamento', v)}
            />
            <CampoIntervallo
              label="Nuova data inizio"
              tipo="date"
              da={filtri.rinnovoDataInizioDa}
              a={filtri.rinnovoDataInizioA}
              onDa={(v) => aggiornaFiltro('rinnovoDataInizioDa', v)}
              onA={(v) => aggiornaFiltro('rinnovoDataInizioA', v)}
            />
            <CampoIntervallo
              label="Nuova scadenza"
              tipo="date"
              da={filtri.rinnovoDataFineDa}
              a={filtri.rinnovoDataFineA}
              onDa={(v) => aggiornaFiltro('rinnovoDataFineDa', v)}
              onA={(v) => aggiornaFiltro('rinnovoDataFineA', v)}
            />
          </div>
          <div className="form-row">
            <CampoIntervallo
              label="Nuovo importo (€)"
              tipo="number"
              da={filtri.rinnovoTotaleMin}
              a={filtri.rinnovoTotaleMax}
              onDa={(v) => aggiornaFiltro('rinnovoTotaleMin', v)}
              onA={(v) => aggiornaFiltro('rinnovoTotaleMax', v)}
            />
          </div>
        </SezioneFiltri>

        {attivi && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: '0.75rem' }}
            onClick={() => setFiltri(FILTRI_VUOTI)}
          >
            Cancella filtri
          </button>
        )}
      </div>

      <div className="card">
        {attivi && (
          <p className="muted" style={{ marginTop: 0 }}>
            {righeOrdinate.length} di {righe.length} {righe.length === 1 ? 'abbonamento' : 'abbonamenti'}
          </p>
        )}

        {righeOrdinate.length === 0 ? (
          <p className="vuoto">Nessun abbonamento corrisponde ai filtri.</p>
        ) : (
          <ScorrimentoTabella>
            <table className="tabella tabella-scadenze">
              <thead>
                <tr>
                  <Intestazione colonna="persona" ancora="persona">Persona</Intestazione>
                  <Intestazione colonna="assegnatario">Assegnatario</Intestazione>
                  <Intestazione colonna="prodotto">Prodotto</Intestazione>
                  {!nascondiGruppo && <Intestazione colonna="gruppo">Gruppo</Intestazione>}
                  <Intestazione colonna="data_inizio" ancora="scadenza">Inizio</Intestazione>
                  <Intestazione colonna="data_fine">Scadenza</Intestazione>
                  <Intestazione colonna="totale">Importo</Intestazione>
                  <Intestazione colonna="venditore">
                    <span style={{ display: 'block', textAlign: 'left' }}>
                      Venditore
                      <small style={{ display: 'block', fontWeight: 400 }}>abbonamento in scadenza</small>
                    </span>
                  </Intestazione>
                  <Intestazione colonna="rinnovato">Rinnovo</Intestazione>
                  <th data-ancora="lavorazione">Note di gestione</th>
                  <Intestazione colonna="stato">Trattativa</Intestazione>
                  <Intestazione colonna="motivo">Motivo non rinnovo</Intestazione>
                  <th>Note non rinnovo</th>
                  <Intestazione colonna="rinnovo_abbonamento" ancora="rinnovo">
                    Nuovo abbonamento
                  </Intestazione>
                  <Intestazione colonna="rinnovo_data_inizio">Nuovo inizio</Intestazione>
                  <Intestazione colonna="rinnovo_data_fine">Nuova scadenza</Intestazione>
                  <Intestazione colonna="rinnovo_totale">Nuovo importo</Intestazione>
                  <th>Escludi da report</th>
                </tr>
              </thead>
              <tbody>
                {righeOrdinate.map((r) => (
                  <RigaTabella
                    key={r.id}
                    r={r}
                    note={noteScadenze[r.id] ?? NESSUNA_NOTA}
                    nascondiGruppo={nascondiGruppo}
                    nomeGruppo={nomeGruppo}
                    operatoriSegreteria={operatoriSegreteria}
                    nomiStaff={nomiStaff}
                    io={io}
                    possoRiassegnare={possoRiassegnare}
                  />
                ))}
              </tbody>
            </table>
          </ScorrimentoTabella>
        )}
      </div>
    </>
  )
}

'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { testoRicerca, dataBreve as dataBreveAnno } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import { NON_CATEGORIZZATO, type Gruppo } from '@/lib/abbonamenti'
import { nomeDiEmail } from '@/lib/staff'
import { SelettoreAssegnatario } from '@/components/SelettoreAssegnatario'
import {
  assegnaScadenza,
  impostaEsclusoReport,
  impostaStatoManuale,
  salvaMotivoNonRinnovo,
  salvaNoteNonRinnovo,
  salvaNotaScadenza,
  type StatoManuale,
} from './actions'
import { MOTIVI_NON_RINNOVO } from './motivi'

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
  operatore_nome: string | null
  // Lavorazione manuale del rinnovo: nessuna sincronizzazione la scrive, la
  // imposta solo chi lavora la scadenza — vedi actions.ts e
  // abbonamenti_scadenze_lavorazione. null = ancora da valutare.
  stato_manuale: StatoManuale
  motivo_non_rinnovo: string | null
  note_non_rinnovo: string | null
  nota: string | null
  assegnato_a: string | null
  escluso_da_report: boolean
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
  | 'operatore'

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
  operatore: 'testo',
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
    case 'operatore':
      return r.operatore_nome
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
  stato: '' | 'vuoto' | 'in_trattativa' | 'perso'
  assegnatario: string
  rinnovoAbbonamento: string
  rinnovoDataInizioDa: string
  rinnovoDataInizioA: string
  rinnovoDataFineDa: string
  rinnovoDataFineA: string
  rinnovoTotaleMin: string
  rinnovoTotaleMax: string
  operatore: string
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
  rinnovoAbbonamento: '',
  rinnovoDataInizioDa: '',
  rinnovoDataInizioA: '',
  rinnovoDataFineDa: '',
  rinnovoDataFineA: '',
  rinnovoTotaleMin: '',
  rinnovoTotaleMax: '',
  operatore: '',
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
  if (f.operatore && !(r.operatore_nome ?? '').toLowerCase().includes(f.operatore.trim().toLowerCase())) return false
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
    <div className="field">
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
}: {
  abbonamentoId: string
  valoreIniziale: string | null
  operatori: string[]
  nomiStaff: Record<string, string>
  io: string | null
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
        disabled={inCorso}
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
 * Un campo di testo libero che si salva da solo quando si esce dal campo
 * (come una cella di foglio elettronico — niente pulsante "Salva" da
 * ricordarsi di cliccare su una tabella dove le righe sono decine), solo se
 * il testo è davvero cambiato dall'ultimo salvataggio riuscito. Generico
 * sull'azione di salvataggio: la stessa forma serve sia per "Note non
 * rinnovo" sia per "Note di gestione", cambia solo quale action chiamare.
 */
function CellaTestoLungo({
  abbonamentoId,
  valoreIniziale,
  placeholder,
  salva,
  disabilitato,
}: {
  abbonamentoId: string
  valoreIniziale: string
  placeholder: string
  salva: (abbonamentoId: string, testo: string) => Promise<{ ok: true } | { ok: false; errore: string }>
  disabilitato?: boolean
}) {
  const [testo, setTesto] = useState(valoreIniziale)
  const [ultimoSalvato, setUltimoSalvato] = useState(valoreIniziale)
  const [stato, setStato] = useState<'inattivo' | 'salvata'>('inattivo')
  const [errore, setErrore] = useState<string | null>(null)
  const [inCorso, startTransition] = useTransition()

  function alBlur() {
    if (testo === ultimoSalvato) return
    setErrore(null)
    startTransition(async () => {
      const esito = await salva(abbonamentoId, testo)
      if (esito.ok) {
        setUltimoSalvato(testo)
        setStato('salvata')
      } else {
        setErrore(esito.errore)
      }
    })
  }

  return (
    <div className="cella-nota-campo">
      <textarea
        className="textarea-inline"
        rows={2}
        value={testo}
        placeholder={placeholder}
        onChange={(e) => {
          setTesto(e.target.value)
          setStato('inattivo')
        }}
        onBlur={alBlur}
        disabled={inCorso || disabilitato}
      />
      {inCorso && <span className="muted cella-nota-stato">Salvataggio…</span>}
      {!inCorso && stato === 'salvata' && <span className="muted cella-nota-stato">Salvato</span>}
      {errore && (
        <p className="field-hint" style={{ color: 'var(--error)' }}>
          {errore}
        </p>
      )}
    </div>
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
  nascondiGruppo,
  nomeGruppo,
  operatoriSegreteria,
  nomiStaff,
  io,
}: {
  r: RigaScadenza
  nascondiGruppo: boolean
  nomeGruppo: Map<string, string>
  operatoriSegreteria: string[]
  nomiStaff: Record<string, string>
  io: string | null
}) {
  const [statoAttuale, setStatoAttuale] = useState<StatoManuale>(r.stato_manuale)
  const [esclusoAttuale, setEsclusoAttuale] = useState(r.escluso_da_report)
  const perso = statoAttuale === 'perso'

  return (
    <tr>
      <td className="cella-persona">
        {r.persona_id ? (
          <Link href={`/dashboard/persone/${r.persona_id}`} className="cella-nowrap">
            {r.cognome} {r.nome}
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
        />
      </td>
      <td>{r.abbonamento ?? '—'}</td>
      {!nascondiGruppo && <td>{r.gruppo_id ? (nomeGruppo.get(r.gruppo_id) ?? '—') : 'Non categorizzato'}</td>}
      <td className="cella-nowrap">{dataBreveAnno(r.data_inizio)}</td>
      <td className="cella-nowrap">{dataBreveAnno(r.data_fine)}</td>
      <td className="cella-nowrap">{euro(r.totale) ?? '—'}</td>
      <td>{r.operatore_nome ?? '—'}</td>
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
        <CellaTestoLungo
          abbonamentoId={r.id}
          valoreIniziale={r.nota ?? ''}
          placeholder="Note di gestione…"
          salva={salvaNotaScadenza}
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
      <td className={perso ? 'cella-nota' : undefined}>
        {perso ? (
          <CellaTestoLungo
            abbonamentoId={r.id}
            valoreIniziale={r.note_non_rinnovo ?? ''}
            placeholder="Note sul mancato rinnovo…"
            salva={salvaNoteNonRinnovo}
            disabilitato={r.rinnovato}
          />
        ) : (
          '—'
        )}
      </td>
      <td>{r.rinnovo_id ? (r.rinnovo_abbonamento ?? '—') : '—'}</td>
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
  gruppi,
  nascondiGruppo = false,
  operatoriSegreteria,
  nomiStaff,
  io,
}: {
  righe: RigaScadenza[]
  gruppi: Gruppo[]
  // Vero sulla pagina Rinnovi (fissa sul gruppo Core, vedi
  // /dashboard/abbonamenti/rinnovi): il filtro e la colonna Gruppo
  // mostrerebbero sempre lo stesso valore, quindi sono solo rumore.
  nascondiGruppo?: boolean
  // Le email tra cui scegliere per "Assegnatario": solo chi ha
  // staff_users.operatore_segreteria — chi lavora davvero i rinnovi, non
  // tutto lo staff (vedi SelettoreAssegnatario).
  operatoriSegreteria: string[]
  nomiStaff: Record<string, string>
  io: string | null
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

  function Intestazione({ colonna, children }: { colonna: Colonna; children: React.ReactNode }) {
    const attiva = ordineColonna === colonna
    return (
      <th>
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

        <button
          type="button"
          className="filtri-titolo filtri-titolo-toggle"
          aria-expanded={apertoScadenza}
          onClick={() => setApertoScadenza((v) => !v)}
        >
          Filtro — abbonamento in scadenza {apertoScadenza ? '−' : '+'}
        </button>
        {apertoScadenza && (
          <>
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
              <CampoTesto
                label="Operatore"
                valore={filtri.operatore}
                onCambia={(v) => aggiornaFiltro('operatore', v)}
              />
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
          </>
        )}

        <button
          type="button"
          className="filtri-titolo filtri-titolo-toggle"
          aria-expanded={apertoRinnovo}
          onClick={() => setApertoRinnovo((v) => !v)}
        >
          Filtro — abbonamento rinnovato {apertoRinnovo ? '−' : '+'}
        </button>
        {apertoRinnovo && (
          <>
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
          </>
        )}

        {attivi && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFiltri(FILTRI_VUOTI)}>
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
          <div className="tabella-wrap">
            <table className="tabella tabella-scadenze">
              <thead>
                <tr>
                  <Intestazione colonna="persona">Persona</Intestazione>
                  <Intestazione colonna="assegnatario">Assegnatario</Intestazione>
                  <Intestazione colonna="prodotto">Prodotto</Intestazione>
                  {!nascondiGruppo && <Intestazione colonna="gruppo">Gruppo</Intestazione>}
                  <Intestazione colonna="data_inizio">Inizio</Intestazione>
                  <Intestazione colonna="data_fine">Scadenza</Intestazione>
                  <Intestazione colonna="totale">Importo</Intestazione>
                  <Intestazione colonna="operatore">Operatore</Intestazione>
                  <Intestazione colonna="rinnovato">Rinnovo</Intestazione>
                  <th>Note di gestione</th>
                  <Intestazione colonna="stato">Trattativa</Intestazione>
                  <Intestazione colonna="motivo">Motivo non rinnovo</Intestazione>
                  <th>Note non rinnovo</th>
                  <Intestazione colonna="rinnovo_abbonamento">Nuovo abbonamento</Intestazione>
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
                    nascondiGruppo={nascondiGruppo}
                    nomeGruppo={nomeGruppo}
                    operatoriSegreteria={operatoriSegreteria}
                    nomiStaff={nomiStaff}
                    io={io}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

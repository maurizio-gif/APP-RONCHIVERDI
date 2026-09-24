'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { testoRicerca, dataBreve as dataBreveAnno } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import { NON_CATEGORIZZATO, type Gruppo } from '@/lib/abbonamenti'

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
  venditore_nome: string | null
}

type Colonna =
  | 'persona'
  | 'prodotto'
  | 'gruppo'
  | 'data_inizio'
  | 'data_fine'
  | 'totale'
  | 'rinnovato'
  | 'rinnovo_abbonamento'
  | 'rinnovo_data_inizio'
  | 'rinnovo_data_fine'
  | 'rinnovo_totale'
  | 'operatore'
  | 'venditore'

// ISO 'YYYY-MM-DD' ordina correttamente anche come testo: nessun bisogno di
// passare da Date per le colonne data. rinnovato diventa 0/1 per stare nello
// stesso confronto numerico delle altre colonne di stato/importo.
const TIPO_COLONNA: Record<Colonna, 'testo' | 'numero'> = {
  persona: 'testo',
  prodotto: 'testo',
  gruppo: 'testo',
  data_inizio: 'testo',
  data_fine: 'testo',
  totale: 'numero',
  rinnovato: 'numero',
  rinnovo_abbonamento: 'testo',
  rinnovo_data_inizio: 'testo',
  rinnovo_data_fine: 'testo',
  rinnovo_totale: 'numero',
  operatore: 'testo',
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

function valoreColonna(r: RigaScadenza, colonna: Colonna, nomeGruppo: Map<string, string>): string | number | null {
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
  rinnovato: '' | 'si' | 'no'
  rinnovoAbbonamento: string
  rinnovoDataInizioDa: string
  rinnovoDataInizioA: string
  rinnovoDataFineDa: string
  rinnovoDataFineA: string
  rinnovoTotaleMin: string
  rinnovoTotaleMax: string
  operatore: string
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
  rinnovoAbbonamento: '',
  rinnovoDataInizioDa: '',
  rinnovoDataInizioA: '',
  rinnovoDataFineDa: '',
  rinnovoDataFineA: '',
  rinnovoTotaleMin: '',
  rinnovoTotaleMax: '',
  operatore: '',
  venditore: '',
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
  if (f.rinnovato === 'si' && !r.rinnovato) return false
  if (f.rinnovato === 'no' && r.rinnovato) return false
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
  if (f.venditore && !(r.venditore_nome ?? '').toLowerCase().includes(f.venditore.trim().toLowerCase())) return false
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
 * L'elenco delle scadenze di un mese, con ordinamento per colonna (clic
 * sull'intestazione) e un filtro per colonna — in memoria, come in
 * ElencoRichieste: righeGrezze arriva già completo dal server (paginato lì
 * per aggirare il limite di 1000 righe di PostgREST), al più qualche
 * migliaio di righe anche nel mese di punta, e ordinare/filtrare mentre si
 * digita non giustifica un giro sul server.
 */
export function TabellaScadenze({ righe, gruppi }: { righe: RigaScadenza[]; gruppi: Gruppo[] }) {
  const nomeGruppo = useMemo(() => new Map(gruppi.map((g) => [g.id, g.nome])), [gruppi])

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
        confronta(valoreColonna(ra, ordineColonna, nomeGruppo), valoreColonna(rb, ordineColonna, nomeGruppo), tipo) *
        (ordineDirezione === 'asc' ? 1 : -1)
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
        <p className="filtri-titolo">Filtro — abbonamento in scadenza</p>
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
          <CampoTesto
            label="Operatore"
            valore={filtri.operatore}
            onCambia={(v) => aggiornaFiltro('operatore', v)}
          />
          <CampoTesto
            label="Venditore"
            valore={filtri.venditore}
            onCambia={(v) => aggiornaFiltro('venditore', v)}
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

        <p className="filtri-titolo">Filtro — rinnovo</p>
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
            </select>
          </div>
          <CampoTesto
            label="Nuovo abbonamento"
            valore={filtri.rinnovoAbbonamento}
            onCambia={(v) => aggiornaFiltro('rinnovoAbbonamento', v)}
          />
        </div>
        <div className="form-row">
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
          <CampoIntervallo
            label="Nuovo importo (€)"
            tipo="number"
            da={filtri.rinnovoTotaleMin}
            a={filtri.rinnovoTotaleMax}
            onDa={(v) => aggiornaFiltro('rinnovoTotaleMin', v)}
            onA={(v) => aggiornaFiltro('rinnovoTotaleMax', v)}
          />
        </div>

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
            <table className="tabella">
              <thead>
                <tr>
                  <Intestazione colonna="persona">Persona</Intestazione>
                  <Intestazione colonna="prodotto">Prodotto</Intestazione>
                  <Intestazione colonna="gruppo">Gruppo</Intestazione>
                  <Intestazione colonna="data_inizio">Inizio</Intestazione>
                  <Intestazione colonna="data_fine">Scadenza</Intestazione>
                  <Intestazione colonna="totale">Importo</Intestazione>
                  <Intestazione colonna="operatore">Operatore</Intestazione>
                  <Intestazione colonna="venditore">Venditore</Intestazione>
                  <Intestazione colonna="rinnovato">Rinnovo</Intestazione>
                  <Intestazione colonna="rinnovo_abbonamento">Nuovo abbonamento</Intestazione>
                  <Intestazione colonna="rinnovo_data_inizio">Nuovo inizio</Intestazione>
                  <Intestazione colonna="rinnovo_data_fine">Nuova scadenza</Intestazione>
                  <Intestazione colonna="rinnovo_totale">Nuovo importo</Intestazione>
                </tr>
              </thead>
              <tbody>
                {righeOrdinate.map((r) => (
                  <tr key={r.id}>
                    <td className="cella-nowrap">
                      {r.persona_id ? (
                        <Link href={`/dashboard/persone/${r.persona_id}`}>
                          {r.cognome} {r.nome}
                        </Link>
                      ) : (
                        '—'
                      )}
                      {(r.cellulare || r.email) && (
                        <div className="muted" style={{ fontSize: 'var(--text-2xs)' }}>
                          {r.cellulare || r.email}
                        </div>
                      )}
                    </td>
                    <td>{r.abbonamento ?? '—'}</td>
                    <td>{r.gruppo_id ? (nomeGruppo.get(r.gruppo_id) ?? '—') : 'Non categorizzato'}</td>
                    <td className="cella-nowrap">{dataBreveAnno(r.data_inizio)}</td>
                    <td className="cella-nowrap">{dataBreveAnno(r.data_fine)}</td>
                    <td className="cella-nowrap">{euro(r.totale) ?? '—'}</td>
                    <td>{r.operatore_nome ?? '—'}</td>
                    <td>{r.venditore_nome ?? '—'}</td>
                    <td className="cella-nowrap">
                      {r.rinnovato ? (
                        <span className="badge badge-ok">Rinnovato</span>
                      ) : (
                        <span className="badge badge-warn">Non ancora rinnovato</span>
                      )}
                    </td>
                    <td>{r.rinnovo_id ? (r.rinnovo_abbonamento ?? '—') : '—'}</td>
                    <td className="cella-nowrap">{r.rinnovo_id ? dataBreveAnno(r.rinnovo_data_inizio) : '—'}</td>
                    <td className="cella-nowrap">{r.rinnovo_id ? dataBreveAnno(r.rinnovo_data_fine) : '—'}</td>
                    <td className="cella-nowrap">{r.rinnovo_id ? (euro(r.rinnovo_totale) ?? '—') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

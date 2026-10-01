'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

// La lista degli abbonamenti attivi oggi: ricerca, ordinamento e download
// nel browser, sulle righe che il server manda una volta (sono poche
// migliaia: rifare la query a ogni lettera digitata costerebbe più di così).
// Il CSV scarica esattamente quello che si vede: filtri e ordine compresi.

export type RigaAttivo = {
  id: string
  persona_id: string
  nome: string | null
  cognome: string | null
  email: string | null
  cellulare: string | null
  abbonamento: string | null
  gruppo: string
  data_inizio: string
  data_fine: string | null
  totale: number | null
}

type Colonna = 'nominativo' | 'email' | 'cellulare' | 'abbonamento' | 'gruppo' | 'data_inizio' | 'data_fine' | 'totale'

const nominativo = (r: RigaAttivo) => `${r.cognome ?? ''} ${r.nome ?? ''}`.trim()
const minuscolo = (v: string | null) => (v ?? '').toLowerCase()
const soloCifre = (v: string | null) => (v ?? '').replace(/\D/g, '')

function valore(r: RigaAttivo, c: Colonna): string | number {
  if (c === 'nominativo') return nominativo(r)
  if (c === 'totale') return r.totale ?? -1
  return r[c] ?? ''
}

function data(giorno: string | null): string {
  if (!giorno) return '—'
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

const euro = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

function cellaCsv(v: string | number | null): string {
  const s = v == null ? '' : String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function ElencoAttivi({ righe, gruppi }: { righe: RigaAttivo[]; gruppi: string[] }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [cellulare, setCellulare] = useState('')
  const [prodotto, setProdotto] = useState('')
  const [gruppo, setGruppo] = useState('')
  const [ordine, setOrdine] = useState<{ colonna: Colonna; asc: boolean }>({ colonna: 'nominativo', asc: true })

  const visibili = useMemo(() => {
    const n = minuscolo(nome).trim()
    const e = minuscolo(email).trim()
    const c = soloCifre(cellulare)
    const p = minuscolo(prodotto).trim()
    const filtrate = righe.filter((r) => {
      // Nome e cognome in qualunque ordine: «rossi mario» e «mario rossi».
      if (n) {
        const pieno = minuscolo(`${r.nome ?? ''} ${r.cognome ?? ''} ${r.nome ?? ''}`)
        if (!n.split(/\s+/).every((parola) => pieno.includes(parola))) return false
      }
      if (e && !minuscolo(r.email).includes(e)) return false
      if (c && !soloCifre(r.cellulare).includes(c)) return false
      if (p && !minuscolo(r.abbonamento).includes(p)) return false
      if (gruppo && r.gruppo !== gruppo) return false
      return true
    })
    const verso = ordine.asc ? 1 : -1
    return filtrate.sort((a, b) => {
      const va = valore(a, ordine.colonna)
      const vb = valore(b, ordine.colonna)
      const confronto =
        typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va).localeCompare(String(vb), 'it', { sensitivity: 'base' })
      return confronto * verso || nominativo(a).localeCompare(nominativo(b), 'it')
    })
  }, [righe, nome, email, cellulare, prodotto, gruppo, ordine])

  const persone = new Set(visibili.map((r) => r.persona_id)).size
  const filtrato = !!(nome || email || cellulare || prodotto || gruppo)

  function ordina(colonna: Colonna) {
    setOrdine((o) => ({ colonna, asc: o.colonna === colonna ? !o.asc : true }))
  }

  function scarica() {
    const intestazione = ['Cognome', 'Nome', 'Email', 'Cellulare', 'Abbonamento', 'Gruppo', 'Inizio', 'Scadenza', 'Totale']
    const corpo = visibili.map((r) =>
      [r.cognome, r.nome, r.email, r.cellulare, r.abbonamento, r.gruppo, data(r.data_inizio), data(r.data_fine),
        r.totale == null ? '' : String(r.totale).replace('.', ',')]
        .map(cellaCsv)
        .join(';')
    )
    // Punto e virgola e BOM: Excel in italiano lo apre già a colonne, con gli accenti giusti.
    const blob = new Blob(['﻿' + [intestazione.join(';'), ...corpo].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `abbonamenti-attivi-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function Th({ colonna, children }: { colonna: Colonna; children: React.ReactNode }) {
    return (
      <th aria-sort={ordine.colonna === colonna ? (ordine.asc ? 'ascending' : 'descending') : undefined}>
        <button type="button" className="th-ordina" onClick={() => ordina(colonna)}>
          {children}
          {ordine.colonna === colonna && (
            <span className="th-ordina-freccia" aria-hidden="true">
              {ordine.asc ? '▲' : '▼'}
            </span>
          )}
        </button>
      </th>
    )
  }

  return (
    <>
      <div className="filtri">
        <div className="filtri-testa">
          <span className="filtri-titolo">Cerca nell&apos;elenco</span>
          {filtrato && (
            <button
              type="button"
              className="link-testo filtri-azzera"
              onClick={() => {
                setNome('')
                setEmail('')
                setCellulare('')
                setProdotto('')
                setGruppo('')
              }}
            >
              Azzera
            </button>
          )}
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="f-nome">Nome e cognome</label>
            <input id="f-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-email">Email</label>
            <input id="f-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-cell">Cellulare</label>
            <input id="f-cell" inputMode="tel" value={cellulare} onChange={(e) => setCellulare(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-prod">Prodotto</label>
            <input id="f-prod" value={prodotto} onChange={(e) => setProdotto(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="f-gruppo">Gruppo</label>
            <select id="f-gruppo" value={gruppo} onChange={(e) => setGruppo(e.target.value)}>
              <option value="">Tutti</option>
              {gruppi.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <p className="muted" style={{ margin: 0 }}>
            <strong>{visibili.length}</strong> abbonamenti · <strong>{persone}</strong> persone
            {filtrato && ` (su ${righe.length})`}
          </p>
          <button type="button" className="btn btn-sm" onClick={scarica} disabled={visibili.length === 0}>
            Scarica CSV
          </button>
        </div>
        {visibili.length === 0 ? (
          <p className="vuoto">Nessun abbonamento attivo con questi filtri.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <Th colonna="nominativo">Cognome e nome</Th>
                  <Th colonna="email">Email</Th>
                  <Th colonna="cellulare">Cellulare</Th>
                  <Th colonna="abbonamento">Abbonamento</Th>
                  <Th colonna="gruppo">Gruppo</Th>
                  <Th colonna="data_inizio">Inizio</Th>
                  <Th colonna="data_fine">Scadenza</Th>
                  <Th colonna="totale">Totale</Th>
                </tr>
              </thead>
              <tbody>
                {visibili.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/dashboard/persone/${r.persona_id}`} className="cella-nowrap">
                        {nominativo(r) || '—'}
                      </Link>
                    </td>
                    <td>{r.email ?? '—'}</td>
                    <td className="cella-nowrap">{r.cellulare ?? '—'}</td>
                    <td>{r.abbonamento ?? '—'}</td>
                    <td>{r.gruppo}</td>
                    <td className="cella-nowrap">{data(r.data_inizio)}</td>
                    <td className="cella-nowrap">{data(r.data_fine)}</td>
                    <td className="cella-nowrap">{euro(r.totale)}</td>
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

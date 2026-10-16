'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ETICHETTE_TIPO, FASCE_RICHIAMO, etichettaStato, type TipoVoce, type VoceAgenda } from '@/lib/agenda'

// La nuova agenda a calendario (vedi page.tsx): la griglia delle ore di un
// giorno, per operatore o tutti insieme, o di una settimana. Ogni voce ha
// uno di tre stati, a colpo d'occhio:
//
//   da fare     — il colore del suo tipo, cerchio vuoto
//   in ritardo  — l'ora (o la fascia del Richiamami) è passata senza esito:
//                 bordo e targa rossi, finché qualcuno non la chiude
//   fatta       — fondo neutro, spunta verde, l'esito al posto dell'orario
//
// Il pannello laterale è in sola lettura: da qui non si chiama e non si
// chiude niente. «Gestisci» apre la scheda del contatto in un'altra scheda
// del browser, ed è lì che l'azione si lavora.

export type Operatore = { email: string; nome: string }

type Props = {
  /** Se chi guarda ha anche l'agenda a elenco: allora c'è il pulsante per passarci. */
  puoElenco: boolean
  voci: VoceAgenda[]
  operatori: Operatore[]
  io: string | null
  oggi: string
  giorno: string
  tempo: 'giorno' | 'settimana'
  arretrati: number
}

type StatoVista = 'dafare' | 'ritardo' | 'fatto'
type Famiglia = 'sede' | 'telefono' | 'task' | 'email' | 'whatsapp' | 'messaggio'

const INIZIO = 8
const FINE = 21
const ORA_PX = 58
const SENZA = '__nessuno__'
const COLORI_OPERATORI = ['#8b6c14', '#35566b', '#6e3f6a', '#2f6662', '#85561c', '#3f4a8a', '#4a6b3a', '#8c3320']

const FAMIGLIA: Record<TipoVoce, Famiglia> = {
  appuntamento_in_sede: 'sede',
  appuntamento_telefonico: 'telefono',
  task: 'task',
  email: 'email',
  whatsapp: 'whatsapp',
  messaggio: 'messaggio',
}
const NOMI_FAMIGLIA: Record<Famiglia, string> = {
  sede: 'Visita in sede',
  telefono: 'Telefonata',
  task: 'Task',
  email: 'Email',
  whatsapp: 'WhatsApp',
  messaggio: 'Messaggio',
}
const ICONE: Record<Famiglia, string> = { sede: '🏛', telefono: '☎', task: '✎', email: '✉', whatsapp: '✆', messaggio: '✉' }
const SEGNO: Record<StatoVista, string> = { dafare: '', ritardo: '!', fatto: '✓' }
const ETICHETTA_STATO: Record<StatoVista, string> = {
  dafare: 'Da fare',
  ritardo: 'In ritardo · esito da registrare',
  fatto: 'Fatta',
}

// ── date e ore, sempre di Roma ─────────────────────────────────────────────

const minuti = (ora: string) => {
  const [h, m] = ora.split(':').map(Number)
  return h * 60 + m
}
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const data = (g: string) => new Date(`${g}T12:00:00Z`)
const piu = (g: string, n: number) => {
  const d = data(g)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const lunedi = (g: string) => piu(g, -((data(g).getUTCDay() + 6) % 7))
const nomeGiorno = (g: string, opz: Intl.DateTimeFormatOptions) =>
  data(g).toLocaleDateString('it-IT', { ...opz, timeZone: 'UTC' })
const maiuscola = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

function adessoRomaMin(): { giorno: string; minuti: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value])
  )
  return { giorno: `${p.year}-${p.month}-${p.day}`, minuti: Number(p.hour) * 60 + Number(p.minute) }
}

const fineFascia = (v: VoceAgenda) => {
  const f = FASCE_RICHIAMO.find((x) => x.chiave === v.fascia)
  return f ? minuti(f.a) : 24 * 60
}
const etichettaFascia = (v: VoceAgenda) => {
  const f = FASCE_RICHIAMO.find((x) => x.chiave === v.fascia)
  return f ? `${f.etichetta} · ${f.da.replace(':00', '')}–${f.a.replace(':00', '')}` : null
}

// Chi è la persona e cosa c'è da fare: sulle richieste dal sito il titolo è
// già il nome, sui task il nome sta in `persona`.
const nomeDi = (v: VoceAgenda) => v.persona ?? v.titolo
const azioneDi = (v: VoceAgenda) =>
  v.fascia ? 'Richiamami' : v.persona ? v.titolo : v.origine === 'form_contatti' ? ETICHETTE_TIPO[v.tipo] : v.titolo

// Il canale, scritto in grassetto su ogni azione: il colore è dello stato.
const canaleDi = (v: VoceAgenda) => (v.fascia ? 'Richiamami' : NOMI_FAMIGLIA[FAMIGLIA[v.tipo]])
// L'azione, se dice qualcosa in più del canale.
const dettaglioAzione = (v: VoceAgenda) => {
  const a = azioneDi(v)
  return a && a !== canaleDi(v) ? a : null
}

// La durata "visiva": un'azione da 5 o 15 minuti occupa comunque l'altezza
// minima leggibile, e per affiancarla alle altre conta quella.
const durataVisiva = (v: VoceAgenda) => Math.max(v.durataMinuti, 26)

// Le azioni che si sovrappongono si affiancano, come in Google Calendar.
function disponi(voci: VoceAgenda[]): Map<string, { i: number; n: number }> {
  const ordinate = [...voci].sort((a, b) => minuti(a.ora!) - minuti(b.ora!) || b.durataMinuti - a.durataMinuti)
  const gruppi: VoceAgenda[][] = []
  let gruppo: VoceAgenda[] = []
  let fineGruppo = -1
  for (const v of ordinate) {
    const inizio = minuti(v.ora!)
    if (inizio >= fineGruppo && gruppo.length) {
      gruppi.push(gruppo)
      gruppo = []
    }
    gruppo.push(v)
    fineGruppo = Math.max(fineGruppo, inizio + durataVisiva(v))
  }
  if (gruppo.length) gruppi.push(gruppo)
  const pos = new Map<string, { i: number; n: number }>()
  for (const g of gruppi) {
    const colonne: number[] = []
    for (const v of g) {
      let i = colonne.findIndex((fine) => fine <= minuti(v.ora!))
      if (i < 0) {
        i = colonne.length
        colonne.push(0)
      }
      colonne[i] = minuti(v.ora!) + durataVisiva(v)
      pos.set(v.chiave, { i, n: 0 })
    }
    for (const v of g) pos.get(v.chiave)!.n = colonne.length
  }
  return pos
}

export function GrigliaAgenda({ puoElenco, voci, operatori, io, oggi, giorno, tempo, arretrati }: Props) {
  const router = useRouter()
  const [vista, setVista] = useState<'operatori' | 'unica'>('operatori')
  // All'apertura solo chi è collegato; se non è fra gli operatori, tutti.
  const [opAttivi, setOpAttivi] = useState<Set<string>>(
    () => new Set(io && operatori.some((o) => o.email === io) ? [io] : [...operatori.map((o) => o.email), SENZA])
  )
  const [statiAttivi, setStatiAttivi] = useState<Set<StatoVista>>(new Set(['dafare', 'ritardo', 'fatto']))
  const [famiglieAttive, setFamiglieAttive] = useState<Set<Famiglia>>(new Set(Object.keys(NOMI_FAMIGLIA) as Famiglia[]))
  const [cerca, setCerca] = useState('')
  const [aperta, setAperta] = useState<VoceAgenda | null>(null)
  const [adesso, setAdesso] = useState(() => adessoRomaMin())
  const [meseVisto, setMeseVisto] = useState(giorno.slice(0, 7))
  // Sul telefono la settimana diventa un elenco e i filtri stanno dietro un
  // pulsante: sette colonne e una barra laterale non ci stanno.
  const [mobile, setMobile] = useState(false)
  const [filtriAperti, setFiltriAperti] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)')
    const aggiorna = () => setMobile(mq.matches)
    aggiorna()
    mq.addEventListener('change', aggiorna)
    return () => mq.removeEventListener('change', aggiorna)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setAdesso(adessoRomaMin()), 60_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => setMeseVisto(giorno.slice(0, 7)), [giorno])
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAperta(null)
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [])

  const colore = useMemo(() => {
    const m = new Map<string, string>()
    operatori.forEach((o, i) => m.set(o.email, COLORI_OPERATORI[i % COLORI_OPERATORI.length]))
    return m
  }, [operatori])
  const nomeOperatore = (email: string | null) =>
    email ? (operatori.find((o) => o.email === email)?.nome ?? email.split('@')[0]) : null
  const iniziali = (nome: string) =>
    nome
      .split(/\s+/)
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()

  const statoDi = (v: VoceAgenda): StatoVista => {
    if (!v.daFare) return 'fatto'
    const fine = v.ora ? minuti(v.ora) + v.durataMinuti : v.fascia ? fineFascia(v) : 24 * 60
    return v.data < adesso.giorno || (v.data === adesso.giorno && fine <= adesso.minuti) ? 'ritardo' : 'dafare'
  }

  const vai = (g: string, t: 'giorno' | 'settimana' = tempo) => {
    const p = new URLSearchParams()
    if (g !== oggi) p.set('g', g)
    if (t === 'settimana') p.set('vista', 'settimana')
    const q = p.toString()
    router.push(q ? `/dashboard/agenda-test?${q}` : '/dashboard/agenda-test', { scroll: false })
  }

  const testo = cerca.trim().toLowerCase()
  const visibile = (v: VoceAgenda) =>
    statiAttivi.has(statoDi(v)) &&
    famiglieAttive.has(FAMIGLIA[v.tipo]) &&
    opAttivi.has(v.assegnatoA ?? SENZA) &&
    (!testo || v.ricerca.includes(testo) || nomeDi(v).toLowerCase().includes(testo))

  const settimana = [...Array(7)].map((_, i) => piu(lunedi(giorno), i))
  const delPeriodo = voci.filter((v) => (tempo === 'settimana' ? true : v.data === giorno))
  const delPeriodoMie = delPeriodo.filter((v) => opAttivi.has(v.assegnatoA ?? SENZA))
  const visibili = voci.filter(visibile)

  type Colonna = { chiave: string; g: string; email?: string | null; filtro: (v: VoceAgenda) => boolean }
  let colonne: Colonna[]
  if (tempo === 'settimana') {
    colonne = settimana.map((g) => ({ chiave: g, g, filtro: (v) => v.data === g }))
  } else if (vista === 'operatori') {
    colonne = [...operatori.map((o) => o.email), SENZA]
      .filter((e) => opAttivi.has(e))
      .map((e) => ({ chiave: e, g: giorno, email: e, filtro: (v) => v.data === giorno && (v.assegnatoA ?? SENZA) === e }))
  } else {
    colonne = [{ chiave: 'tutti', g: giorno, filtro: (v) => v.data === giorno }]
  }
  const mostraOp = (tempo === 'settimana' || vista === 'unica') && opAttivi.size > 1
  const tutti = [...operatori.map((o) => o.email), SENZA]
  const tuttiScelti = tutti.every((e) => opAttivi.has(e))
  const conta = (s: StatoVista) => delPeriodoMie.filter((v) => statoDi(v) === s).length
  const griglia = `var(--agt-gutter) repeat(${Math.max(colonne.length, 1)}, minmax(${tempo === 'settimana' ? 110 : 150}px, 1fr))`

  const cambia = <T,>(set: Set<T>, valore: T, attivo: boolean, aggiorna: (s: Set<T>) => void) => {
    const nuovo = new Set(set)
    if (attivo) nuovo.add(valore)
    else nuovo.delete(valore)
    aggiorna(nuovo)
  }

  const titolo =
    tempo === 'settimana'
      ? `${data(settimana[0]).getUTCDate()} – ${nomeGiorno(settimana[6], { day: 'numeric', month: 'long' })}`
      : maiuscola(nomeGiorno(giorno, { weekday: 'long', day: 'numeric', month: 'long' }))

  const Pallino = ({ email }: { email: string | null }) => {
    const nome = nomeOperatore(email)
    return nome ? (
      <span className="agt-mini-op" style={{ background: colore.get(email!) ?? '#7a776b' }} title={nome}>
        {iniziali(nome)}
      </span>
    ) : null
  }

  return (
    <div className="agt">
      <div className="agt-testa">
        <h1>
          <small>Agenda · {tempo}</small>
          {titolo}
        </h1>
        <button type="button" className="agt-btn agt-tondo" onClick={() => vai(piu(giorno, tempo === 'settimana' ? -7 : -1))} aria-label="Indietro">
          ‹
        </button>
        <button type="button" className="agt-btn" onClick={() => vai(oggi)}>
          Oggi
        </button>
        <button type="button" className="agt-btn agt-tondo" onClick={() => vai(piu(giorno, tempo === 'settimana' ? 7 : 1))} aria-label="Avanti">
          ›
        </button>
        <div className="agt-segmenti">
          <button type="button" className={tempo === 'giorno' ? 'on' : ''} onClick={() => vai(giorno, 'giorno')}>
            Giorno
          </button>
          <button type="button" className={tempo === 'settimana' ? 'on' : ''} onClick={() => vai(giorno, 'settimana')}>
            Settimana
          </button>
        </div>
        {puoElenco && (
          <a className="agt-btn agt-vista-elenco" href="/dashboard/agenda" title="Passa all'agenda a elenco">
            ☰ Vista elenco
          </a>
        )}
        <div className="agt-spazio" />
        {tempo === 'giorno' && (
          <div className="agt-segmenti">
            <button type="button" className={vista === 'operatori' ? 'on' : ''} onClick={() => setVista('operatori')}>
              Per operatore
            </button>
            <button type="button" className={vista === 'unica' ? 'on' : ''} onClick={() => setVista('unica')}>
              Tutti insieme
            </button>
          </div>
        )}
        <input
          className="agt-cerca"
          type="search"
          placeholder="Cerca nome o telefono"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
        />
        <button
          type="button"
          className={`agt-btn agt-solo-mobile agt-btn-filtri${filtriAperti ? ' on' : ''}`}
          onClick={() => setFiltriAperti((a) => !a)}
          aria-expanded={filtriAperti}
        >
          Filtri · {tuttiScelti ? 'tutti' : opAttivi.size === 1 && io && opAttivi.has(io) ? 'le mie' : `${opAttivi.size} operatori`}
        </button>
      </div>

      <div className="agt-corpo">
        <aside className={`agt-sx${filtriAperti ? ' aperto' : ''}`}>
          <MiniMese
            mese={meseVisto}
            setMese={setMeseVisto}
            oggi={oggi}
            giorno={giorno}
            tempo={tempo}
            conVoci={new Set(voci.map((v) => v.data))}
            scegli={(g) => vai(g)}
          />
          {arretrati > 0 && (
            <a className="agt-arretrati" href="/dashboard/agenda?quando=arretrati">
              <b>{arretrati}</b> azioni arretrate dai giorni scorsi <span>→</span>
            </a>
          )}
          <div className="agt-pannello">
            <h3>Operatori</h3>
            <label className="agt-filtro agt-filtro-tutti">
              <input
                type="checkbox"
                checked={tuttiScelti}
                onChange={(e) =>
                  setOpAttivi(new Set(e.target.checked ? tutti : io && operatori.some((o) => o.email === io) ? [io] : []))
                }
              />
              <b>Tutti</b>
            </label>
            {tutti.map((e) => {
              const nome = e === SENZA ? 'Senza assegnatario' : nomeOperatore(e)!
              const quante = delPeriodo.filter((v) => (v.assegnatoA ?? SENZA) === e && v.daFare).length
              return (
                <label key={e} className="agt-filtro">
                  <input type="checkbox" checked={opAttivi.has(e)} onChange={(x) => cambia(opAttivi, e, x.target.checked, setOpAttivi)} />
                  <span className="agt-iniziali agt-iniziali-sm" style={{ background: e === SENZA ? '#7a776b' : colore.get(e) }}>
                    {e === SENZA ? '—' : iniziali(nome)}
                  </span>
                  {nome}
                  {e === io && <span className="agt-muted">&nbsp;(tu)</span>}
                  <span className={`agt-conta${e === SENZA && quante > 0 ? ' agt-allarme' : ''}`}>{quante}</span>
                </label>
              )
            })}
          </div>
          <div className="agt-pannello">
            <h3>Stato</h3>
            {(['dafare', 'ritardo', 'fatto'] as StatoVista[]).map((s) => (
              <label key={s} className="agt-filtro">
                <input type="checkbox" checked={statiAttivi.has(s)} onChange={(x) => cambia(statiAttivi, s, x.target.checked, setStatiAttivi)} />
                <i className={`agt-l-segno agt-l-${s}`}>{SEGNO[s]}</i>
                {s === 'dafare' ? 'Da fare' : s === 'ritardo' ? 'In ritardo' : 'Fatte'}
                <span className="agt-conta">{conta(s)}</span>
              </label>
            ))}
          </div>
          <div className="agt-pannello">
            <h3>Tipi</h3>
            {(Object.keys(NOMI_FAMIGLIA) as Famiglia[]).map((f) => (
              <label key={f} className="agt-filtro">
                <input type="checkbox" checked={famiglieAttive.has(f)} onChange={(x) => cambia(famiglieAttive, f, x.target.checked, setFamiglieAttive)} />
                {NOMI_FAMIGLIA[f]}
                <span className="agt-conta">{delPeriodoMie.filter((v) => FAMIGLIA[v.tipo] === f).length}</span>
              </label>
            ))}
          </div>
        </aside>

        <div className="agt-destra">
          <div className="agt-legenda">
            <span>
              <i className="agt-l-segno agt-l-dafare" />
              <b>{conta('dafare')}</b>&nbsp;da fare
            </span>
            <span className="agt-rosso">
              <i className="agt-l-segno agt-l-ritardo">!</i>
              <b>{conta('ritardo')}</b>&nbsp;in ritardo, esito da registrare
            </span>
            <span className="agt-verde">
              <i className="agt-l-segno agt-l-fatto">✓</i>
              <b>{conta('fatto')}</b>&nbsp;fatte
            </span>
            <span className="agt-chi">
              {tuttiScelti
                ? 'Tutti gli operatori'
                : tutti
                    .filter((e) => opAttivi.has(e))
                    .map((e) => (e === SENZA ? 'Senza assegnatario' : `${nomeOperatore(e)}${e === io ? ' (tu)' : ''}`))
                    .join(', ') || 'Nessun operatore scelto'}
            </span>
          </div>

          {mobile && tempo === 'settimana' ? (
            <div className="agt-programma">
              {settimana.map((g) => {
                const delGiorno = visibili
                  .filter((v) => v.data === g)
                  .sort((a, b) => (a.ora ?? '').localeCompare(b.ora ?? ''))
                return (
                  <section key={g} className={`agt-prog-giorno${g === oggi ? ' e-oggi' : ''}`}>
                    <button type="button" className="agt-prog-testa" onClick={() => vai(g, 'giorno')}>
                      <span className="gn">{data(g).getUTCDate()}</span>
                      <span className="gs">{maiuscola(nomeGiorno(g, { weekday: 'long' }))}</span>
                      <span className="agt-conta">{delGiorno.length || 'nessuna'}</span>
                    </button>
                    {delGiorno.map((v) => {
                      const st = statoDi(v)
                      return (
                        <button
                          type="button"
                          key={v.chiave}
                          className={`agt-prog-voce agt-${st}`}
                          onClick={() => setAperta(v)}
                        >
                          <span className="agt-prog-ora">{v.ora ?? (v.fascia ? FASCE_RICHIAMO.find((f) => f.chiave === v.fascia)!.etichetta : 'in giornata')}</span>
                          <span className="agt-segno">{SEGNO[st]}</span>
                          <span className="agt-prog-testo">
                            <b>{nomeDi(v)}</b>
                            <small>
                              <b>{canaleDi(v)}</b>
                              {st === 'fatto'
                                ? ` · ✓ ${v.esitoTipo ? etichettaStato('completato', v.esitoTipo, v.tipo) : 'Fatta'}`
                                : dettaglioAzione(v)
                                  ? ` · ${dettaglioAzione(v)}`
                                  : ''}
                            </small>
                          </span>
                          {mostraOp && <Pallino email={v.assegnatoA} />}
                        </button>
                      )
                    })}
                  </section>
                )
              })}
            </div>
          ) : (
          <div className="agt-cal">
            <div className="agt-cal-teste" style={{ gridTemplateColumns: griglia }}>
              <div />
              {colonne.length === 0 && <div>Scegli almeno un operatore</div>}
              {colonne.map((c) => {
                const quante = visibili.filter(c.filtro).length
                if (tempo === 'settimana')
                  return (
                    <button
                      type="button"
                      key={c.chiave}
                      className={`agt-testa-giorno${c.g === oggi ? ' e-oggi' : ''}`}
                      onClick={() => vai(c.g, 'giorno')}
                    >
                      <span className="gs">{nomeGiorno(c.g, { weekday: 'short' })}</span>
                      <span className="gn">{data(c.g).getUTCDate()}</span>
                      <span className="agt-conta">{quante}</span>
                    </button>
                  )
                if (c.email !== undefined)
                  return (
                    <div key={c.chiave}>
                      <span className="agt-iniziali" style={{ background: c.email === SENZA ? '#7a776b' : colore.get(c.email!) }}>
                        {c.email === SENZA ? '—' : iniziali(nomeOperatore(c.email)!)}
                      </span>
                      <span className="agt-nome-col">
                        {c.email === SENZA ? 'Senza assegnatario' : nomeOperatore(c.email)}
                        {c.email === io && <small className="agt-muted"> (tu)</small>}
                      </span>
                      <span className="agt-conta">{quante}</span>
                    </div>
                  )
                return (
                  <div key={c.chiave}>
                    <b>{quante} azioni</b>
                  </div>
                )
              })}
            </div>

            <div className="agt-giornata" style={{ gridTemplateColumns: griglia }}>
              <div>
                in
                <br />
                giornata
              </div>
              {colonne.map((c) => (
                <div key={c.chiave} className={tempo === 'settimana' && c.g === oggi ? 'agt-col-oggi' : ''}>
                  {visibili
                    .filter((v) => !v.ora && c.filtro(v))
                    .map((v) => {
                      const s = statoDi(v)
                      return (
                        <button type="button" key={v.chiave} className={`agt-chip agt-${s}`} onClick={() => setAperta(v)}>
                          <span className="agt-segno">{SEGNO[s]}</span>
                          <b>{nomeDi(v)}</b>
                          {mostraOp && <Pallino email={v.assegnatoA} />}
                          {/* Nella settimana le colonne sono strette: il nome
                              vale più della fascia, che resta nel dettaglio. */}
                          {tempo === 'giorno' && (
                            <span className="agt-fascia">
                              <b>{canaleDi(v)}</b>
                              {s === 'fatto' ? ' · Fatta' : v.fascia ? ` · ${etichettaFascia(v)!.split(' · ')[1]}` : ''}
                            </span>
                          )}
                        </button>
                      )
                    })}
                </div>
              ))}
            </div>

            <div className="agt-griglia" style={{ gridTemplateColumns: griglia }} ref={(el) => {
              if (el && !el.dataset.posizionata) {
                el.scrollTop = (Math.max(INIZIO, Math.min(adesso.minuti / 60 - 1, FINE - 6)) - INIZIO) * ORA_PX
                el.dataset.posizionata = '1'
              }
            }}>
              <div className="agt-ore">
                {[...Array(FINE - INIZIO)].map((_, i) => (
                  <div key={i}>{String(INIZIO + i).padStart(2, '0')}:00</div>
                ))}
              </div>
              {colonne.map((c, ic) => {
                const conOra = visibili.filter((v) => v.ora && c.filtro(v))
                const pos = disponi(conOra)
                return (
                  <div
                    key={c.chiave}
                    className={`agt-colonna${tempo === 'settimana' && c.g === oggi ? ' agt-col-oggi' : ''}`}
                    style={{ height: (FINE - INIZIO) * ORA_PX }}
                  >
                    {conOra.map((v) => {
                      const s = statoDi(v)
                      const inizio = Math.min(Math.max(minuti(v.ora!), INIZIO * 60), FINE * 60 - 15)
                      const alto = Math.max((v.durataMinuti / 60) * ORA_PX - 3, 24)
                      const breve = alto < 40
                      const p = pos.get(v.chiave)!
                      const w = 100 / p.n
                      return (
                        <button
                          type="button"
                          key={v.chiave}
                          className={`agt-ev agt-${s}${aperta?.chiave === v.chiave ? ' agt-sel' : ''}`}
                          style={{
                            top: ((inizio - INIZIO * 60) / 60) * ORA_PX + 1,
                            height: s === 'ritardo' && !breve ? Math.max(alto, 52) : alto,
                            left: `calc(${p.i * w}% + 3px)`,
                            width: `calc(${w}% - 6px)`,
                          }}
                          title={`${canaleDi(v)} · ${ETICHETTA_STATO[s]}`}
                          onClick={() => setAperta(v)}
                        >
                          <div className="agt-ev-t">
                            <span className="agt-segno">{SEGNO[s]}</span>
                            <span className="agt-ev-nome">
                              {breve ? `${v.ora} · ` : ''}
                              {nomeDi(v)}
                            </span>
                            {mostraOp && <Pallino email={v.assegnatoA} />}
                          </div>
                          {!breve &&
                            (s === 'fatto' ? (
                              <div className="agt-ev-s">
                                <b>{canaleDi(v)}</b> · ✓ {v.esitoTipo ? etichettaStato('completato', v.esitoTipo, v.tipo) : 'Fatta'}
                                {v.esito ? ` · ${v.esito}` : ''}
                              </div>
                            ) : (
                              <div className="agt-ev-s">
                                <b>{canaleDi(v)}</b> · {v.ora}–{hhmm(minuti(v.ora!) + v.durataMinuti)}
                                {dettaglioAzione(v) ? ` · ${dettaglioAzione(v)}` : ''}
                              </div>
                            ))}
                          {s === 'ritardo' && !breve && <span className="agt-targa">Esito da registrare</span>}
                        </button>
                      )
                    })}
                    {c.g === adesso.giorno && adesso.minuti >= INIZIO * 60 && adesso.minuti <= FINE * 60 && (
                      <div
                        className={`agt-adesso${ic && tempo === 'giorno' ? ' senza-punto' : ''}`}
                        style={{ top: ((adesso.minuti - INIZIO * 60) / 60) * ORA_PX }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          )}
        </div>
      </div>

      <div className={`agt-velo${aperta ? ' on' : ''}`} onClick={() => setAperta(null)} />
      <aside className={`agt-dettaglio${aperta ? ' on' : ''}`} aria-hidden={!aperta}>
        {aperta && <Dettaglio voce={aperta} stato={statoDi(aperta)} operatore={nomeOperatore(aperta.assegnatoA)} chiudi={() => setAperta(null)} />}
      </aside>
    </div>
  )
}

function Dettaglio({
  voce: v,
  stato,
  operatore,
  chiudi,
}: {
  voce: VoceAgenda
  stato: StatoVista
  operatore: string | null
  chiudi: () => void
}) {
  const f = FAMIGLIA[v.tipo]
  const giorno = maiuscola(nomeGiorno(v.data, { weekday: 'long', day: 'numeric', month: 'long' }))
  const quando = v.ora
    ? `${giorno} · ${v.ora}–${hhmm(minuti(v.ora) + v.durataMinuti)}`
    : [
        v.dataDArrivo ? `Arrivata ${giorno.toLowerCase()}` : giorno,
        v.orarioArrivo ? `alle ${v.orarioArrivo}` : null,
        v.fascia ? `preferisce: ${etichettaFascia(v)}` : 'in giornata',
      ]
        .filter(Boolean)
        .join(' · ')
  const gestisci = v.personaId ? `/dashboard/persone/${v.personaId}` : '/dashboard/agenda'

  return (
    <>
      <div className="agt-det-testa">
        <button type="button" className="agt-chiudi" onClick={chiudi} aria-label="Chiudi">
          ×
        </button>
        <span className="agt-badge">
          {ICONE[f]} {v.fascia ? 'Richiamami' : NOMI_FAMIGLIA[f]}
        </span>
        <span className={`agt-stato-badge agt-sb-${stato}`}>
          {stato === 'fatto' ? '✓ ' : stato === 'ritardo' ? '! ' : ''}
          {ETICHETTA_STATO[stato]}
        </span>
        <h2>{nomeDi(v)}</h2>
        <div className="agt-det-quando">{quando}</div>
      </div>
      <div className="agt-det-corpo">
        <p className="agt-sola-lettura">Riepilogo in sola lettura: l’azione si gestisce nella scheda.</p>
        {v.note && (
          <div className="agt-nota">
            <b>{v.origine === 'form_contatti' ? 'Il suo messaggio' : 'Note'}</b>
            {v.note}
          </div>
        )}
        <dl>
          <dt>Azione</dt>
          <dd>{azioneDi(v)}</dd>
          {v.cellulare && (
            <>
              <dt>Cellulare</dt>
              <dd>{v.cellulare}</dd>
            </>
          )}
          {v.email && (
            <>
              <dt>Email</dt>
              <dd>{v.email}</dd>
            </>
          )}
          {v.attivita && (
            <>
              <dt>Interesse</dt>
              <dd>{v.attivita}</dd>
            </>
          )}
          <dt>Provenienza</dt>
          <dd>{v.origine === 'form_contatti' ? 'Richiesta dal sito' : 'Azione in agenda'}</dd>
          <dt>Assegnata a</dt>
          <dd>{operatore ?? <i>nessuno</i>}</dd>
          {v.tentativi && (
            <>
              <dt>Tentativi</dt>
              <dd>
                {v.tentativi.numero === 1 ? '1 chiamata senza risposta' : `${v.tentativi.numero} chiamate senza risposta`}
              </dd>
            </>
          )}
          {stato === 'fatto' && (
            <>
              <dt>Esito</dt>
              <dd>
                {v.esitoTipo ? etichettaStato('completato', v.esitoTipo, v.tipo) : 'Fatta'}
                {v.esito ? ` · ${v.esito}` : ''}
              </dd>
            </>
          )}
        </dl>
      </div>
      <div className="agt-det-piede">
        <a className="agt-gestisci" href={gestisci} target="_blank" rel="noopener">
          Gestisci
          <span>
            {v.personaId ? `Apre la scheda di ${nomeDi(v)} in una nuova scheda ↗` : 'Apre l’agenda in una nuova scheda ↗'}
          </span>
        </a>
      </div>
    </>
  )
}

function MiniMese({
  mese,
  setMese,
  oggi,
  giorno,
  tempo,
  conVoci,
  scegli,
}: {
  mese: string
  setMese: (m: string) => void
  oggi: string
  giorno: string
  tempo: 'giorno' | 'settimana'
  conVoci: Set<string>
  scegli: (g: string) => void
}) {
  const primo = `${mese}-01`
  const scostamento = (data(primo).getUTCDay() + 6) % 7
  const l = lunedi(giorno)
  const cambiaMese = (n: number) => {
    const d = data(primo)
    d.setUTCMonth(d.getUTCMonth() + n)
    setMese(d.toISOString().slice(0, 7))
  }
  return (
    <div className="agt-pannello">
      <div className="agt-mese-testa">
        <button type="button" onClick={() => cambiaMese(-1)} aria-label="Mese precedente">
          ‹
        </button>
        <span>{maiuscola(nomeGiorno(primo, { month: 'long', year: 'numeric' }))}</span>
        <button type="button" onClick={() => cambiaMese(1)} aria-label="Mese successivo">
          ›
        </button>
      </div>
      <div className="agt-mese">
        {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => (
          <div key={i} className="dow">
            {d}
          </div>
        ))}
        {[...Array(42)].map((_, i) => {
          const g = piu(primo, i - scostamento)
          const cls = [
            g.slice(0, 7) !== mese ? 'fuori' : '',
            conVoci.has(g) ? 'ha' : '',
            g === oggi ? 'oggi' : '',
            tempo === 'giorno' && g === giorno ? 'sel' : '',
            tempo === 'settimana' && g >= l && g <= piu(l, 6) ? 'sett' : '',
          ].join(' ')
          return (
            <button type="button" key={g} className={cls} onClick={() => scegli(g)}>
              {data(g).getUTCDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

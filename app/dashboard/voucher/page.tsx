import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import {
  ETICHETTE_STATO,
  dataOraRoma,
  dataRoma,
  nomeCompleto,
  statoEffettivo,
  type StatoEffettivo,
  type Voucher,
} from '@/lib/voucher'
import { COLONNE } from '@/lib/voucher-server'
import { leggiStatoAutomazione } from '@/lib/voucher-automatico'
import { AzioniVoucher } from './AzioniVoucher'

export const dynamic = 'force-dynamic'

// Quanti voucher mostrare senza ricerca: l'elenco serve a controllare
// l'emesso di recente, non a fare da archivio storico.
const LIMITE = 300

// Con una ricerca si guarda tutta la tabella: poche centinaia di righe
// l'anno, filtrate qui sotto con le stesse regole per nome, email e telefono.
const LIMITE_RICERCA = 5000

const CLASSE_BADGE: Record<StatoEffettivo, string> = {
  attivo: 'badge badge-ok',
  utilizzato: 'badge',
  annullato: 'badge badge-off',
  scaduto: 'badge badge-warn',
}

// Minuscole e senza accenti: «Nicolò» si trova scrivendo «nicolo».
function normalizza(testo: string): string {
  return testo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

// Il telefono si confronta sulle sole cifre e senza prefisso internazionale:
// «+39 340 123 4567», «3401234567» e «340-1234567» sono lo stesso numero.
function cifreTelefono(testo: string): string {
  return testo.replace(/\D/g, '').replace(/^(0039|39)(?=\d{9,10}$)/, '')
}

// Una ricerca fatta di sole cifre (con spazi, + o trattini) è un cellulare;
// altrimenti ogni parola deve comparire in nome, cognome o email, così
// «rossi», «mario rossi» e «mario.rossi@» trovano lo stesso socio.
function corrisponde(v: Voucher, ricerca: string): boolean {
  if (/^[\d\s+\-./()]+$/.test(ricerca)) {
    const cercato = cifreTelefono(ricerca)
    return cercato.length >= 4 && !!v.telefono && cifreTelefono(v.telefono).includes(cercato)
  }
  const pagliaio = normalizza(`${v.nome} ${v.cognome} ${v.email}`)
  return normalizza(ricerca)
    .split(/\s+/)
    .every((parola) => pagliaio.includes(parola))
}

export default async function VoucherPage({ searchParams }: { searchParams: { q?: string } }) {
  if (!(await utenteHaSezione('voucher'))) {
    redirect('/dashboard')
  }

  const ricerca = (searchParams.q ?? '').trim()

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('voucher')
    .select(COLONNE)
    .order('created_at', { ascending: false })
    .limit(ricerca ? LIMITE_RICERCA : LIMITE)

  const tutti = (data ?? []) as Voucher[]
  const voucher = ricerca ? tutti.filter((v) => corrisponde(v, ricerca)) : tutti
  const possoCancellare = await puoCancellare(emailCorrente())
  const automazione = await leggiStatoAutomazione()
  const automaticoAttivo = automazione?.attiva === true

  const conteggi = voucher.reduce<Record<StatoEffettivo, number>>(
    (acc, v) => {
      acc[statoEffettivo(v)] += 1
      return acc
    },
    { attivo: 0, utilizzato: 0, annullato: 0, scaduto: 0 }
  )

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Partnership</p>
        <h1>Voucher visita medica</h1>
        <p className="muted">
          Il codice monouso per la visita inclusa: arriva al socio per email e Chiron lo brucia
          alla prenotazione dalla sua pagina di validazione.
        </p>
      </div>

      {/* La procedura scritta dove la segreteria la usa. L'emissione a mano
          (NuovoVoucher) è sospesa: a regime i codici partono solo
          dall'automazione, e il form tornerà per i casi fuori flusso se
          servirà. */}
      <div className="card">
        <div className="card-head">
          <h2>Come funziona</h2>
          <span className={automaticoAttivo ? 'badge badge-ok' : 'badge badge-off'}>
            {automaticoAttivo
              ? `Invio automatico attivo dal ${dataRoma(automazione!.attivaDal!)}`
              : 'Invio automatico non ancora attivo'}
          </span>
        </div>
        <ol style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.7 }}>
          <li>
            I contratti con la sigla <strong>«(cer000)»</strong> nel nome del prodotto (per
            esempio «1.1 GOLD OVER 35 (cer000)») ricevono il codice <strong>in automatico</strong>{' '}
            per email, entro circa 15 minuti da quando la vendita arriva dal gestionale. Non serve
            fare nulla.
            {!automaticoAttivo && (
              <>
                {' '}
                <em>L’invio automatico non è ancora attivo: per ora non parte nessun codice.</em>
              </>
            )}
          </li>
          <li>
            Il codice <strong>non si vede in questa pagina</strong>: lo riceve solo il socio. Se
            non l’ha ricevuto o non lo trova più, usa <strong>«Rimanda email»</strong>, possibile
            finché il voucher non è stato utilizzato.
          </li>
          <li>
            <strong>Socio senza email nel gestionale</strong>: il codice non può partire. Aggiungi
            l’email nel gestionale entro 7 giorni dalla vendita e il codice parte da solo al giro
            successivo.
          </li>
          <li>
            Il socio prenota <strong>online</strong>, scrivendo il codice nel campo «Note» della
            prenotazione, oppure <strong>al telefono</strong> comunicandolo all’operatore. Quando
            Chiron usa il codice, il socio riceve un’email di conferma e qui il voucher risulta
            «utilizzato».
          </li>
        </ol>
      </div>

      <form method="get" className="card filtri-barra-card" role="search">
        <div className="filtri-barra">
          <div className="field filtri-barra-cerca">
            <label htmlFor="f-q">Cerca un socio</label>
            <input
              id="f-q"
              name="q"
              type="search"
              defaultValue={ricerca}
              placeholder="Nome e cognome, cognome, cellulare o email"
              autoComplete="off"
            />
          </div>
          <div className="filtri-barra-azioni">
            <button type="submit" className="btn">
              Cerca
            </button>
            {ricerca && (
              <Link href="/dashboard/voucher" className="btn btn-ghost">
                Azzera
              </Link>
            )}
          </div>
        </div>
      </form>

      <div className="griglia-stat" style={{ marginTop: '1.5rem' }}>
        <div className="stat">
          <span className="stat-valore">{conteggi.attivo}</span>
          <span className="stat-label">Attivi</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{conteggi.utilizzato}</span>
          <span className="stat-label">Utilizzati</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{conteggi.scaduto}</span>
          <span className="stat-label">Scaduti</span>
        </div>
        <div className="stat">
          <span className="stat-valore">{conteggi.annullato}</span>
          <span className="stat-label">Annullati</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{ricerca ? `Risultati per «${ricerca}»` : 'Voucher emessi'}</h2>
          <span className="muted">
            {ricerca
              ? `${voucher.length} trovati`
              : voucher.length === LIMITE
                ? `ultimi ${LIMITE}`
                : `${voucher.length} in tutto`}
          </span>
        </div>

        {voucher.length === 0 ? (
          <p className="vuoto">{ricerca ? 'Nessun voucher per questa ricerca.' : 'Nessun voucher emesso.'}</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Socio</th>
                  <th>Stato</th>
                  <th>Emesso</th>
                  <th>Scade</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {voucher.map((v) => {
                  const stato = statoEffettivo(v)
                  return (
                    <tr key={v.id}>
                      <td>
                        <div className="cella-chi-nome">{nomeCompleto(v)}</div>
                        <div className="cella-chi-dettagli">
                          {v.email}
                          {v.telefono ? ` · ${v.telefono}` : ''}
                        </div>
                        {v.note && <div className="cella-chi-dettagli">{v.note}</div>}
                      </td>
                      <td className="cella-nowrap">
                        <span className={CLASSE_BADGE[stato]}>{ETICHETTE_STATO[stato]}</span>
                        {v.utilizzato_il && (
                          <div className="cella-chi-dettagli">
                            {dataOraRoma(v.utilizzato_il)}
                            {v.utilizzato_da ? ` · ${v.utilizzato_da}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="cella-nowrap">
                        {dataRoma(v.created_at)}
                        {v.emesso_da && <div className="cella-chi-dettagli">{v.emesso_da}</div>}
                      </td>
                      <td className="cella-nowrap">{dataRoma(v.valido_fino)}</td>
                      <td className="cella-nowrap">
                        {/* L'email che non è partita non si nasconde: è
                            l'unico caso in cui il socio ha un voucher che non
                            sa di avere. */}
                        {v.email_errore ? (
                          <span className="badge badge-ko" title={v.email_errore}>
                            non partita
                          </span>
                        ) : v.email_inviata_il ? (
                          <>
                            {dataRoma(v.email_inviata_il)}
                            {v.email_invii > 1 && (
                              <div className="cella-chi-dettagli">{v.email_invii} invii</div>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <AzioniVoucher
                          id={v.id}
                          socio={nomeCompleto(v)}
                          annullabile={v.stato === 'attivo'}
                          rimandabile={stato === 'attivo'}
                          puoCancellare={possoCancellare}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { puoCancellare } from '@/lib/auth/permessi'
import {
  ETICHETTE_STATO,
  dataOraRoma,
  dataRoma,
  formattaCodice,
  nomeCompleto,
  statoEffettivo,
  type StatoEffettivo,
  type Voucher,
} from '@/lib/voucher'
import { COLONNE } from '@/lib/voucher-server'
import { leggiStatoAutomazione } from '@/lib/voucher-automatico'
import { NuovoVoucher } from './NuovoVoucher'
import { AzioniVoucher } from './AzioniVoucher'

export const dynamic = 'force-dynamic'

// Quanti voucher mostrare: l'elenco serve a controllare l'emesso di recente e
// a ritrovare un codice al telefono, non a fare da archivio storico.
const LIMITE = 300

const CLASSE_BADGE: Record<StatoEffettivo, string> = {
  attivo: 'badge badge-ok',
  utilizzato: 'badge',
  annullato: 'badge badge-off',
  scaduto: 'badge badge-warn',
}

export default async function VoucherPage() {
  if (!(await utenteHaSezione('voucher'))) {
    redirect('/dashboard')
  }

  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('voucher')
    .select(COLONNE)
    .order('created_at', { ascending: false })
    .limit(LIMITE)

  const voucher = (data ?? []) as Voucher[]
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

      {/* La procedura scritta dove la segreteria la usa: chi apre la pagina
          deve capire subito quali voucher partono da soli e quali no. */}
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
            <strong>Abbonamenti con la sigla «(cer000)»</strong> nel nome del prodotto (per esempio
            «1.1 GOLD OVER 35 (cer000)»): il codice parte <strong>da solo</strong> per email,
            entro circa 15 minuti da quando la vendita arriva dal gestionale. Non serve fare
            nulla: nell’elenco li riconosci dalla dicitura «Automatico (cer000)» sotto la data di
            emissione.
            {!automaticoAttivo && (
              <>
                {' '}
                <em>Finché l’invio automatico non è attivo, questi codici vanno emessi a mano.</em>
              </>
            )}
          </li>
          <li>
            <strong>Tutti gli altri casi</strong> con diritto alla visita: emetti il codice a mano
            con «Emetti un voucher».
          </li>
          <li>
            <strong>Socio senza email nel gestionale</strong>: il codice automatico non può
            partire. Aggiungi l’email nel gestionale oppure emetti il voucher a mano. Se ne esiste
            già uno per quel socio, l’automatico non ne manda un secondo.
          </li>
          <li>
            Il socio prenota <strong>online</strong>, scrivendo il codice nel campo «Note» della
            prenotazione, oppure <strong>al telefono</strong> comunicandolo all’operatore. Quando
            Chiron usa il codice, il socio riceve un’email di conferma.
          </li>
        </ol>
      </div>

      <NuovoVoucher />

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
          <h2>Voucher emessi</h2>
          <span className="muted">
            {voucher.length === LIMITE ? `ultimi ${LIMITE}` : `${voucher.length} in tutto`}
          </span>
        </div>

        {voucher.length === 0 ? (
          <p className="vuoto">Nessun voucher emesso.</p>
        ) : (
          <div className="tabella-wrap">
            <table className="tabella">
              <thead>
                <tr>
                  <th>Codice</th>
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
                      <td className="cella-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {formattaCodice(v.codice)}
                      </td>
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
                          codice={formattaCodice(v.codice)}
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

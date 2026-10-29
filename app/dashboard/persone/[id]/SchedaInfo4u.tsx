import { dataBreve } from '@/lib/persone'
import { euro } from '@/lib/pipeline'
import { dataOraDi, oraDi } from '@/lib/percorsoSito'
import {
  ETICHETTE_CONFRONTO,
  ETICHETTE_FINESTRA,
  confrontoConMediana,
  rateScadute,
  statoCertificato,
  statoQuota,
  type DatiInfo4u,
  type EmailInfo4u,
  registroEmail,
  type VoceInfo4u,
} from '@/lib/schedaInfo4u'
import { ElencoAPassi } from './ElencoAPassi'

// I blocchi della scheda contatto che vengono dai dati Info4U (vedi
// lib/scheda-info4u-server.ts). Solo presentazione: nessuna lettura qui.

function Voce({ etichetta, children, classe }: { etichetta: string; children: React.ReactNode; classe?: string }) {
  return (
    <div className={`sintesi-voce ${classe ?? ''}`}>
      <span className="sintesi-etichetta muted">{etichetta}</span>
      <span className="sintesi-valore">{children}</span>
    </div>
  )
}

/** Le quattro cose da sapere prima di telefonare: ultimo ingresso, certificato, quota, rate. */
export function SintesiScheda({ dati, oggi }: { dati: DatiInfo4u; oggi: string }) {
  const ultimo = dati.accessi.ultimi[0]
  const certificato = statoCertificato(dati.certificati, oggi)
  const quota = statoQuota(dati.quote, oggi)
  const scadute = rateScadute(dati.rate, oggi)
  const importoScadute = scadute.reduce((s, r) => s + Number(r.importo ?? 0), 0)

  return (
    <div className="card sintesi">
      <Voce etichetta="Ultimo ingresso">
        {ultimo ? `${dataBreve(ultimo.giorno)} · ${oraDi(ultimo.ingresso)}` : <span className="muted">nessuno</span>}
      </Voce>
      <Voce etichetta="Certificato medico" classe={certificato.tipo === 'scaduto' ? 'sintesi-ko' : ''}>
        {certificato.tipo === 'valido' && `valido fino al ${dataBreve(certificato.fino)}`}
        {certificato.tipo === 'scaduto' && `scaduto il ${dataBreve(certificato.il)}`}
        {certificato.tipo === 'prenotato' && `visita prenotata il ${dataBreve(certificato.il)}`}
        {certificato.tipo === 'nessuno' && <span className="muted">nessuno</span>}
      </Voce>
      <Voce etichetta="Quota associativa" classe={quota.tipo === 'scaduta' ? 'sintesi-ko' : ''}>
        {quota.tipo === 'attiva' && `fino al ${dataBreve(quota.fino)}`}
        {quota.tipo === 'scaduta' && `scaduta il ${dataBreve(quota.il)}`}
        {quota.tipo === 'nessuna' && <span className="muted">nessuna</span>}
      </Voce>
      <Voce etichetta="Rate scadute" classe={scadute.length ? 'sintesi-ko' : ''}>
        {scadute.length === 0
          ? 'nessuna'
          : `${scadute.length} · ${euro(importoScadute) ?? ''}`}
      </Voce>
    </div>
  )
}

/** Ingressi in sede: gli ultimi 5 e i giorni di presenza contro la mediana dei soci. */
export function CardFrequenza({ accessi }: { accessi: DatiInfo4u['accessi'] }) {
  const { ultimi, finestre } = accessi
  return (
    <div className="card">
      <div className="card-head">
        <h2>Frequenza in sede</h2>
        <span className="muted">giorni di presenza</span>
      </div>
      {ultimi.length === 0 && finestre.every((f) => f.giorni === 0) ? (
        <p className="vuoto">Nessun ingresso registrato per questa persona.</p>
      ) : (
        <>
          <div className="frequenza-griglia">
            {finestre.map((f) => {
              const confronto = confrontoConMediana(f.giorni, f.mediana)
              return (
                <div key={f.chiave} className="frequenza-cella">
                  <span className="muted frequenza-periodo">{ETICHETTE_FINESTRA[f.chiave]}</span>
                  <strong className="frequenza-numero">{f.giorni}</strong>
                  <span
                    className={`badge frequenza-confronto ${
                      confronto === 'sopra' ? 'badge-ok' : confronto === 'sotto' ? 'badge-ko' : ''
                    }`}
                    title={`Mediana dei ${f.soci} soci venuti almeno una volta nel periodo: ${f.mediana} giorni`}
                  >
                    {confronto === 'sopra' ? '▲ ' : confronto === 'sotto' ? '▼ ' : '= '}
                    {ETICHETTE_CONFRONTO[confronto]}
                  </span>
                  <span className="muted frequenza-mediana">mediana {Number(f.mediana)}</span>
                </div>
              )
            })}
          </div>
          <h3 className="frequenza-titolo">Ultimi ingressi</h3>
          {ultimi.length === 0 ? (
            <p className="muted azioni-gruppo-vuoto">Nessuno.</p>
          ) : (
            <ul className="storia">
              {ultimi.map((u) => (
                <li key={u.giorno}>
                  <strong>{dataOraDi(u.ingresso)}</strong>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

/** Rate (scadute, prossime, ultime pagate) e ultime ricevute. */
export function CardPagamenti({ dati, oggi }: { dati: DatiInfo4u; oggi: string }) {
  const scadute = rateScadute(dati.rate, oggi).sort((a, b) => b.data_rata.localeCompare(a.data_rata))
  const prossime = dati.rate
    .filter((r) => !r.data_pagato && r.data_rata >= oggi)
    .sort((a, b) => a.data_rata.localeCompare(b.data_rata))
    .slice(0, 3)
  const pagate = dati.rate.filter((r) => r.data_pagato).slice(0, 3)
  const vuota = scadute.length + prossime.length + pagate.length + dati.ricevute.length === 0

  return (
    <div className="card">
      <div className="card-head">
        <h2>Pagamenti</h2>
      </div>
      {vuota ? (
        <p className="vuoto">Nessuna rata né ricevuta.</p>
      ) : (
        <>
          {scadute.length > 0 && (
            <>
              <h3 className="frequenza-titolo">Rate scadute</h3>
              <ul className="storia">
                {scadute.map((r, i) => (
                  <li key={`s${i}`}>
                    <strong>{dataBreve(r.data_rata)}</strong> · {euro(r.importo != null ? Number(r.importo) : null)}{' '}
                    <span className="badge badge-ko">Non pagata</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {prossime.length > 0 && (
            <>
              <h3 className="frequenza-titolo">Prossime rate</h3>
              <ul className="storia">
                {prossime.map((r, i) => (
                  <li key={`p${i}`}>
                    <strong>{dataBreve(r.data_rata)}</strong> · {euro(r.importo != null ? Number(r.importo) : null)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {pagate.length > 0 && (
            <>
              <h3 className="frequenza-titolo">Ultime rate pagate</h3>
              <ul className="storia">
                {pagate.map((r, i) => (
                  <li key={`g${i}`}>
                    <strong>{dataBreve(r.data_pagato)}</strong> · {euro(r.importo != null ? Number(r.importo) : null)}
                    {r.metodo_pagamento && <span className="muted"> · {r.metodo_pagamento}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {dati.ricevute.length > 0 && (
            <>
              <h3 className="frequenza-titolo">Ultime ricevute</h3>
              <ul className="storia">
                {dati.ricevute.map((r, i) => (
                  <li key={`r${i}`}>
                    <strong>{dataBreve(r.data_ricevuta)}</strong>
                    <span className="muted">
                      {' '}
                      · {[r.tipo, r.numero != null && `n. ${r.numero}`].filter(Boolean).join(' ')}
                    </span>
                    {r.totale != null && ` · ${euro(r.totale) ?? ''}`}
                    {r.descrizioni.length > 0 && <div className="storia-testo muted">{r.descrizioni.join(' · ')}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Le email di Info4U in un solo registro, in una sezione chiusa di default:
 * sono la gran parte dello storico (invii automatici di contratti,
 * credenziali, promemoria) e fra le azioni seppellivano i contatti fatti da
 * una persona. Il registro unisce gli invii (con l'esito) e le azioni con cui
 * Info4U li annota: vedi `registroEmail`.
 */
export function SezioneEmailInfo4u({ azioni, email }: { azioni: VoceInfo4u[]; email: EmailInfo4u[] }) {
  const registro = registroEmail(azioni, email)
  if (registro.length === 0) return null
  return (
    <details className="email-info4u">
      <summary>
        <strong>Email Info4U</strong> <span className="muted">· {registro.length}</span>
      </summary>
      <ElencoAPassi
        iniziali={10}
        voci={registro.map((r) => (
          <li key={r.chiave}>
            <strong>{dataBreve(r.quando)}</strong>
            <span className="muted">
              {' '}
              · {oraDi(r.quando)}
              {r.autore ? ` · ${r.autore}` : ''}
            </span>{' '}
            {r.esito === 'errore' ? (
              <span className="badge badge-ko">Errore</span>
            ) : r.esito === 'inviata' ? (
              <span className="badge badge-ok">Inviata</span>
            ) : r.esito === 'in-coda' ? (
              <span className="badge">In coda</span>
            ) : null}
            {r.oggetto && <div className="storia-testo">{r.oggetto}</div>}
            {r.destinatario && <div className="storia-testo muted">a {r.destinatario}</div>}
            {r.errore && <div className="storia-testo muted">{r.errore}</div>}
          </li>
        ))}
      />
    </details>
  )
}

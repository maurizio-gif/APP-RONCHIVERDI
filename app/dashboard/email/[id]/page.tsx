import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { provaDiInvio } from '@/lib/email-tracking-server'
import { NOMI_EVENTI, copriCodice, dataOraSecondi } from '@/lib/email-tracking'
import { BadgeEsito } from '../BadgeEsito'
import { AnteprimaEmail } from './AnteprimaEmail'
import { Stampa } from './Stampa'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Prova di invio — Ronchiverdi' }

// La prova di invio di una email, sul modello del CRM di Athlon: i dati
// ufficiali dell'invio, la verifica che il testo non sia cambiato da allora
// (impronta SHA-256, ricalcolata adesso dal database) e gli eventi di
// consegna, apertura e click comunicati da SendGrid. Si stampa o si salva in
// PDF così com'è.
//
// La aprono la scheda contatto, il riepilogo voucher e il tracking: basta
// una delle tre sezioni.
export default async function ProvaDiInvioPage({ params }: { params: { id: string } }) {
  const [tracking, persone, voucher] = await Promise.all([
    utenteHaSezione('tracking-email'),
    utenteHaSezione('persone'),
    utenteHaSezione('voucher'),
  ])
  if (!tracking && !persone && !voucher) redirect('/dashboard')

  const prova = await provaDiInvio(params.id)
  if (!prova) notFound()

  const { email: e, eventi, impronta, persona } = prova
  const operatore = emailCorrente()
  const consegna = eventi.find((x) => x.evento === 'delivered')
  const aperture = eventi.filter((x) => x.evento === 'open')
  const nonConsegnata = eventi.some((x) => ['bounce', 'dropped', 'spamreport'].includes(x.evento))
  const tuttiFirmati = eventi.length > 0 && eventi.every((x) => x.firmato)
  // Il codice del voucher non si mostra nel pannello: nella copia dell'email
  // è coperto. L'impronta resta quella del testo integrale.
  const html = prova.corpoHtml ? copriCodice(prova.corpoHtml, prova.codiceVoucher) : null
  const testo = prova.corpoTesto ? copriCodice(prova.corpoTesto, prova.codiceVoucher) : null
  const nomeSocio = persona ? `${persona.nome ?? ''} ${persona.cognome ?? ''}`.trim() : null
  const impostaDopo =
    impronta?.registrataIl &&
    new Date(impronta.registrataIl).getTime() - new Date(e.inviata_il).getTime() > 60 * 60 * 1000

  return (
    <div className="pi">
      <div className="pi-comandi no-print">
        {persona ? (
          <Link href={`/dashboard/persone/${persona.id}`} className="btn btn-ghost">
            ← Scheda di {nomeSocio || 'contatto'}
          </Link>
        ) : (
          <Link href="/dashboard/email" className="btn btn-ghost">
            ← Tracking email
          </Link>
        )}
        <Stampa />
      </div>

      <header className="pi-testa">
        <p className="pi-occhiello">Ronchiverdi Sport Club · Prova di invio</p>
        <h1 className="pi-titolo">{e.oggetto || 'Email senza oggetto'}</h1>
        <p className="muted">
          Documento generato il {dataOraSecondi(new Date().toISOString())}
          {operatore ? ` da ${operatore}` : ''}, dai dati registrati nel CRM del Club.
        </p>
      </header>

      <section className="pi-blocco">
        <h2 className="pi-h2">L’email</h2>
        <dl className="pi-dati">
          <dt>Inviata il</dt>
          <dd>
            <strong>{dataOraSecondi(e.inviata_il)}</strong> (ora italiana) ·{' '}
            <span className="pi-mono">{e.inviata_il}</span> (UTC)
          </dd>
          <dt>Da</dt>
          <dd>{e.mittente_nome ? `${e.mittente_nome} <${e.mittente}>` : e.mittente}</dd>
          <dt>A</dt>
          <dd>{e.destinatario}</dd>
          {e.cc && e.cc.length > 0 && (
            <>
              <dt>Cc</dt>
              <dd>{e.cc.join(', ')}</dd>
            </>
          )}
          {prova.rispondiA && (
            <>
              <dt>Risposte a</dt>
              <dd>{prova.rispondiA}</dd>
            </>
          )}
          <dt>Oggetto</dt>
          <dd>{e.oggetto}</dd>
          <dt>Tipo</dt>
          <dd>{e.automazione}</dd>
          <dt>Destinatario nella scheda</dt>
          <dd>
            {persona ? (
              <Link href={`/dashboard/persone/${persona.id}`}>{nomeSocio || e.destinatario}</Link>
            ) : (
              <span className="muted">non collegato a una scheda</span>
            )}
          </dd>
          <dt>Fatta partire da</dt>
          <dd>{e.inviata_da === 'automatico' ? 'Invio automatico del CRM' : e.inviata_da || '—'}</dd>
          <dt>Inviata tramite</dt>
          <dd>SendGrid (Twilio){e.tracciata ? ' · aperture e click tracciati' : ''}</dd>
          <dt>Id del messaggio</dt>
          <dd className="pi-mono">{e.provider_message_id ?? '—'}</dd>
          <dt>Esito dell’invio</dt>
          <dd>
            {e.esito === 'errore' ? (
              <>
                <span className="badge badge-ko">Non partita</span> {e.errore}
              </>
            ) : (
              'Accettata da SendGrid (risposta 202)'
            )}
          </dd>
        </dl>
      </section>

      <section className="pi-blocco">
        <h2 className="pi-h2">Integrità del contenuto</h2>
        {impronta?.registrata ? (
          <>
            <p>
              {impronta.integra ? (
                <>
                  <span className="badge badge-ok">Verificata</span> Il contenuto registrato è identico a quello
                  dell’invio.
                </>
              ) : (
                <>
                  <span className="badge badge-ko">Non combacia</span> Il contenuto attuale non corrisponde
                  all’impronta registrata: questa prova non è affidabile.
                </>
              )}
            </p>
            <dl className="pi-dati">
              <dt>Impronta SHA-256</dt>
              <dd className="pi-mono">{impronta.registrata}</dd>
              <dt>Registrata il</dt>
              <dd>{impronta.registrataIl ? dataOraSecondi(impronta.registrataIl) : '—'}</dd>
            </dl>
            <p className="muted pi-nota">
              L’impronta è calcolata su ora di invio, mittente, destinatari, oggetto e testo integrale dell’email. Il
              database del Club rifiuta qualunque modifica di questi dati dopo l’invio: se anche una sola lettera
              cambiasse, l’impronta ricalcolata sarebbe diversa.
              {impostaDopo && ' Per questa email l’impronta è stata calcolata dopo l’invio.'}
            </p>
          </>
        ) : (
          <p className="muted">Nessuna impronta registrata per questa email.</p>
        )}
      </section>

      <section className="pi-blocco">
        <h2 className="pi-h2">Consegna, aperture e click</h2>
        <p>
          {consegna ? (
            <>
              <BadgeEsito email={e} /> Il server di posta del destinatario l’ha accettata il{' '}
              <strong>{dataOraSecondi(consegna.momento)}</strong>.
              {aperture.length > 0 &&
                ` Risulta aperta ${aperture.length === 1 ? 'una volta' : `${aperture.length} volte`}, la prima il ${dataOraSecondi(aperture[0].momento)}.`}
            </>
          ) : nonConsegnata ? (
            <>
              <span className="badge badge-ko">Non consegnata</span> Vedi il dettaglio qui sotto.
            </>
          ) : e.esito === 'errore' ? (
            'L’email non è partita: non ci sono eventi di consegna.'
          ) : (
            'Nessuna conferma di consegna ricevuta finora.'
          )}
        </p>
        {eventi.length > 0 ? (
          <>
            <table className="tabella pi-eventi">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Evento</th>
                  <th>Dettaglio</th>
                </tr>
              </thead>
              <tbody>
                {eventi.map((x, i) => (
                  <tr key={i}>
                    <td data-label="Quando" className="cella-nowrap">
                      {dataOraSecondi(x.momento)}
                    </td>
                    <td data-label="Evento">{NOMI_EVENTI[x.evento] ?? x.evento}</td>
                    <td data-label="Dettaglio" className="pi-mono pi-dettaglio">
                      {x.dettaglio ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted pi-nota">
              Gli eventi li comunica il fornitore (SendGrid), con l’ora registrata dai suoi server.
              {tuttiFirmati
                ? ' Ogni evento porta la firma digitale di SendGrid, verificata alla ricezione.'
                : ' Non tutti gli eventi sono firmati digitalmente dal fornitore.'}{' '}
              «Aperta» si registra quando il programma di posta carica le immagini: un’email letta con le immagini
              bloccate non risulta aperta, e alcuni programmi (per esempio Apple Mail) la aprono da soli.
            </p>
          </>
        ) : (
          e.esito !== 'errore' && (
            <p className="muted pi-nota">
              Nessun evento registrato per questa email. Gli eventi arrivano da SendGrid solo dopo l’attivazione del
              suo Event Webhook.
            </p>
          )
        )}
      </section>

      <section className="pi-blocco pi-email">
        <h2 className="pi-h2">Il testo inviato</h2>
        {prova.codiceVoucher && (
          <p className="muted pi-nota">
            Il codice del voucher è coperto in questa copia: lo vede solo il socio. L’impronta è calcolata sul testo
            integrale.
          </p>
        )}
        <AnteprimaEmail html={html} testo={testo} />
      </section>
    </div>
  )
}

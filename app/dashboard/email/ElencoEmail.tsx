import Link from 'next/link'
import { dataOraEmail, riassuntoEsito, type EmailEsito } from '@/lib/email-tracking'
import { BadgeEsito } from './BadgeEsito'

// L'elenco delle email di un socio (scheda contatto) o di un voucher: per
// ognuna data, tipo, oggetto, esito e il link alla prova di invio, dove si
// vedono il testo inviato e lo storico di consegna, aperture e click.
export function ElencoEmail({ email, vuoto }: { email: EmailEsito[]; vuoto: string }) {
  if (email.length === 0) return <p className="vuoto">{vuoto}</p>
  return (
    <ul className="storia">
      {email.map((e) => {
        const riassunto = riassuntoEsito(e)
        return (
          <li key={e.id}>
            <div className="email-riga">
              <strong>{dataOraEmail(e.inviata_il)}</strong>
              <BadgeEsito email={e} />
              <Link href={`/dashboard/email/${e.id}`} className="email-riga-prova">
                Prova di invio →
              </Link>
            </div>
            <div className="storia-testo">{e.oggetto}</div>
            <div className="storia-testo muted">
              {[e.automazione, e.destinatario, riassunto].filter(Boolean).join(' · ')}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

import { CLASSE_STATO, ETICHETTE_STATO, statoEmail, type EmailEsito } from '@/lib/email-tracking'

// Lo stato di un'email in un badge, uguale in scheda, voucher e tracking.
export function BadgeEsito({ email }: { email: EmailEsito }) {
  const stato = statoEmail(email)
  const volte =
    stato === 'cliccata' && email.clic > 1
      ? ` ×${email.clic}`
      : stato === 'aperta' && email.aperture > 1
        ? ` ×${email.aperture}`
        : ''
  return (
    <span className={CLASSE_STATO[stato]} title={email.errore ?? email.motivo ?? undefined}>
      {ETICHETTE_STATO[stato]}
      {volte}
    </span>
  )
}

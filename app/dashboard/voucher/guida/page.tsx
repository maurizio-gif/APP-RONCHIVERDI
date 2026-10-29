import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { Presentazione } from './Presentazione'

export const dynamic = 'force-dynamic'

// La presentazione del processo certificati per la segreteria: stessa sezione
// (e stesso permesso) del riepilogo voucher, perché la usa chi lavora quel
// riepilogo. Il centro medico non la vede: ha solo 'validazione-voucher'.
export default async function GuidaCertificatiPage() {
  if (!(await utenteHaSezione('voucher'))) {
    redirect('/dashboard')
  }

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Certificati medici: come funziona</h1>
        <p className="muted">
          Il processo con Chiron dalla vendita dell’abbonamento al certificato in Info4U. Usa le frecce
          della tastiera, oppure premi «Presenta» per la schermata intera.{' '}
          <Link href="/dashboard/voucher">Torna ai voucher</Link>
        </p>
      </div>

      <Presentazione />
    </>
  )
}

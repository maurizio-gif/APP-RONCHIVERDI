import Link from 'next/link'
import { redirect } from 'next/navigation'
import { utenteHaSezione } from '@/lib/auth/sezioni-server'
import { ETICHETTE_SEZIONE, SEZIONE_TESSERAMENTI, SEZIONI_PAGINA, type SezionePagina } from '@/lib/tesseramenti'
import { VistaElenchi } from './VistaElenchi'
import { VistaTessere } from './VistaTessere'

export const dynamic = 'force-dynamic'

// Tesseramenti CSI. Due viste:
//
// - Elenchi: tesserati (tessera in corso di validità), da tesserare, non
//   tesserabili e in errore, calcolati al momento da abbonamenti, tessere CSI e
//   anagrafica; si cercano e si esportano in CSV;
// - Tessere: la ricerca fra le tessere che il server CSI ha in archivio per
//   la società (lette ogni ora, vedi supabase/functions/csi-tessere), con
//   evidenza di chi ha un abbonamento reale in corso.
//
// «Abbonamento reale» ha la stessa definizione del report abbonamenti: la
// vista abbonamenti_attivi_oggi_dettaglio (non cancellato, in corso, prodotto
// non segnato «no abbonamento» nei gruppi).

type SearchParams = Record<string, string | undefined>

export default async function TesseramentiPage({ searchParams }: { searchParams: SearchParams }) {
  if (!(await utenteHaSezione(SEZIONE_TESSERAMENTI))) redirect('/dashboard')

  const sezione: SezionePagina = (SEZIONI_PAGINA as readonly string[]).includes(searchParams.sezione ?? '')
    ? (searchParams.sezione as SezionePagina)
    : 'elenchi'

  return (
    <div>
      <div className="page-head">
        <p className="eyebrow">Segreteria</p>
        <h1>Tesseramenti CSI</h1>
        <div className="check-sosp-gruppo" role="group" aria-label="Vista">
          {SEZIONI_PAGINA.map((s) => (
            <Link
              key={s}
              href={`/dashboard/tesseramenti?sezione=${s}`}
              className={`chip${sezione === s ? ' is-attivo' : ''}`}
              aria-current={sezione === s ? 'true' : undefined}
              scroll={false}
            >
              {sezione === s && (
                <span className="chip-spunta" aria-hidden="true">
                  ✓
                </span>
              )}
              {ETICHETTE_SEZIONE[s]}
            </Link>
          ))}
        </div>
      </div>

      {sezione === 'tessere' && <VistaTessere searchParams={searchParams} />}
      {sezione === 'elenchi' && <VistaElenchi searchParams={searchParams} />}
    </div>
  )
}

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { giornoPiu, mezzanotteRoma, oggiRoma } from '@/lib/agenda'

// Quanti voucher sono stati validati in un periodo, e nient'altro.
//
// Serve al centro medico per sapere quante visite ha erogato — a fine mese,
// o fra due date qualsiasi. Di proposito non c'è nessun nome: chi valida vede
// già l'intestatario del singolo codice mentre lo brucia, e un elenco di soci
// che hanno fatto una visita medica è una cosa diversa da un conteggio.
// Qui si conta e basta.
//
// I filtri sono un form GET, senza JavaScript: le due date finiscono
// nell'indirizzo, quindi un periodo si può tenere fra i preferiti e la pagina
// si ricarica già impostata.

/** Una data dal form, se ha la forma che ci aspettiamo. Altrimenti niente. */
function giornoValido(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

/** Il primo del mese corrente: il periodo che si guarda più spesso. */
function primoDelMese(): string {
  return `${oggiRoma().slice(0, 7)}-01`
}

function dataLeggibile(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

export async function ContatoreValidati({ da, a }: { da?: string; a?: string }) {
  // Date invertite: si contano lo stesso, scambiandole. Un periodo al
  // contrario darebbe zero, e uno zero senza spiegazione si legge come «non
  // ne ho validato nessuno» invece che «hai sbagliato a compilare».
  const primo = giornoValido(da) ?? primoDelMese()
  const secondo = giornoValido(a) ?? oggiRoma()
  const [dal, al] = primo <= secondo ? [primo, secondo] : [secondo, primo]

  const supabase = createSupabaseServiceClient()
  // `head: true` porta a casa il solo conteggio: nessuna riga viaggia, e
  // quindi nessun nominativo esce dal database per una domanda che è un
  // numero. L'estremo destro è la mezzanotte del giorno dopo, così il giorno
  // «al» è compreso per intero.
  const { count, error } = await supabase
    .from('voucher')
    .select('id', { count: 'exact', head: true })
    .not('utilizzato_il', 'is', null)
    .gte('utilizzato_il', mezzanotteRoma(dal))
    .lt('utilizzato_il', mezzanotteRoma(giornoPiu(al, 1)))

  if (error) console.error('Conteggio voucher validati non riuscito:', error.message)

  return (
    <div className="card">
      <div className="card-head">
        <h2>Voucher validati</h2>
        <span className="muted">solo il numero, nessun nominativo</span>
      </div>

      {/* Il pulsante sotto e non in fila con le date: i campi di .form-row si
          allargano tutti allo stesso modo, e un «Conta» largo come un campo
          data sembrerebbe il terzo campo di tre. */}
      <form method="get">
        <div className="form-row">
          <div className="field">
            <label htmlFor="da">Dal</label>
            <input id="da" name="da" type="date" defaultValue={dal} />
          </div>
          <div className="field">
            <label htmlFor="a">Al</label>
            <input id="a" name="a" type="date" defaultValue={al} />
          </div>
        </div>
        <button className="btn" type="submit" style={{ marginBottom: '1.25rem' }}>
          Conta
        </button>
      </form>

      <div className="stat">
        <span className="stat-valore">{error ? '—' : (count ?? 0)}</span>
        <span className="stat-label">validati nel periodo</span>
        <span className="stat-nota">
          {error
            ? 'Il conteggio non è stato letto: riprova fra poco.'
            : `Dal ${dataLeggibile(dal)} al ${dataLeggibile(al)}, compresi.`}
        </span>
      </div>
    </div>
  )
}

import { redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { dataBreve, giornoPiu, normalizzaOra, oggiRoma } from '@/lib/agenda'
import {
  CLASSE_STATO_SESSIONE,
  COLONNE_SESSIONE,
  ETICHETTE_STATO_SESSIONE,
  nomeCliente,
  type SessionePersonal,
} from '@/lib/personal'
import { ModuloSessione } from './ModuloSessione'

export const dynamic = 'force-dynamic'

// Quanto indietro guarda l'elenco delle proprie sessioni: il mese in corso e
// quello prima, cioè quello che il trainer può ancora ricontrollare prima che
// l'amministrazione chiuda i conti.
const GIORNI_STORICO = 62

// La pagina del trainer, dal telefono: registra la sessione e vede le sue
// ultime, con lo stato. Non può modificarle né cancellarle — lo fa solo il
// responsabile (Check personal): un errore si segnala a lui.
export default async function PersonalPage() {
  if (!(await utenteHaSezione('personal'))) {
    redirect('/dashboard')
  }

  const email = emailCorrente()!
  const oggi = oggiRoma()
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('personal_sessioni')
    .select(COLONNE_SESSIONE)
    .eq('trainer_email', email)
    .gte('data', giornoPiu(oggi, -GIORNI_STORICO))
    .order('data', { ascending: false })
    .order('ora', { ascending: false })
    .limit(200)

  const sessioni = (data ?? []) as unknown as SessionePersonal[]
  const inAttesa = sessioni.filter((s) => s.stato === 'in_attesa').length

  return (
    <div className="pt-pagina">
      <div className="page-head">
        <p className="eyebrow">Personal training</p>
        <h1>Registra sessione</h1>
        <p className="muted">
          Registra ogni sessione con il cliente: scegli chi è, il giorno e l’ora d’inizio. Il
          responsabile la conferma e da lì vale per il rendiconto del mese.
        </p>
      </div>

      <ModuloSessione oggi={oggi} />

      <div className="card pt-mie">
        <div className="card-head">
          <h2>Le tue sessioni</h2>
          <span className="muted">
            {inAttesa > 0 ? `${inAttesa} in attesa di conferma` : 'ultimi due mesi'}
          </span>
        </div>
        {sessioni.length === 0 ? (
          <p className="vuoto">Nessuna sessione registrata negli ultimi due mesi.</p>
        ) : (
          <ul className="pt-elenco">
            {sessioni.map((s) => (
              <li key={s.id} className="pt-elenco-riga">
                <div>
                  <div className="pt-nome">{nomeCliente(s)}</div>
                  <div className="pt-dettagli">
                    {dataBreve(s.data)} · {normalizzaOra(s.ora)}
                    {s.corporate && s.azienda ? ` · ${s.azienda}` : ''}
                  </div>
                </div>
                <span className={CLASSE_STATO_SESSIONE[s.stato]}>{ETICHETTE_STATO_SESSIONE[s.stato]}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="card-nota muted">
          Hai sbagliato qualcosa? Non registrarla di nuovo: avvisa il responsabile, che la corregge o
          la elimina.
        </p>
      </div>
    </div>
  )
}

'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente } from '@/lib/auth/sezioni-server'
import { rigaStaffCorrente } from '@/lib/auth/staff-server'
import { registraLog } from '@/lib/audit'
import {
  eChiusa,
  eStatoValido,
  puoAnnullare,
  puoAssegnare,
  type StatoTrattativa,
} from '@/lib/pipeline'

export type Esito = { ok: true } | { ok: false; errore: string }

/**
 * I diritti dell'operatore corrente sulle trattative. Letti dalla riga di
 * staff_users, che rigaStaffCorrente tiene in cache per la durata della
 * richiesta: senza, ogni azione la interrogherebbe due o tre volte.
 */
async function dirittiCorrenti() {
  const email = emailCorrente()
  const riga = await rigaStaffCorrente(email)
  return {
    email,
    sonoCommerciale: !!riga?.commerciale,
    possoRiassegnare: !!riga?.puo_riassegnare,
    haSezione: (riga?.sezioni_consentite ?? []).includes('richieste-club'),
  }
}

async function trattativa(id: string) {
  const supabase = createSupabaseServiceClient()
  const { data } = await supabase
    .from('opportunita')
    .select('id, stato, assegnato_a, persona_id')
    .eq('id', id)
    .maybeSingle()
  return data
}

/**
 * Cambia l'assegnatario. `a` null significa liberare la trattativa.
 *
 * Il controllo di chi può fare cosa è qui e non nell'interfaccia: nascondere
 * un pulsante non protegge una Server Action, che resta chiamabile a mano con
 * l'id di una trattativa altrui.
 */
export async function assegnaTrattativa(id: string, a: string | null): Promise<Esito> {
  const { email, sonoCommerciale, possoRiassegnare, haSezione } = await dirittiCorrenti()
  if (!haSezione) return { ok: false, errore: 'Non hai accesso alle richieste Club e Family.' }

  const t = await trattativa(id)
  if (!t) return { ok: false, errore: 'Trattativa non trovata.' }

  if (!puoAssegnare({ assegnatoA: t.assegnato_a, io: email, sonoCommerciale, possoRiassegnare })) {
    return {
      ok: false,
      errore: t.assegnato_a
        ? `La segue ${t.assegnato_a}: per spostarla serve il diritto di riassegnare.`
        : 'Serve il diritto commerciale per prendere in carico una trattativa.',
    }
  }

  const destinatario = a?.trim().toLowerCase() || null

  // Si può assegnare solo a chi è commerciale: assegnare a un responsabile di
  // corso significherebbe metterlo in un elenco che non guarda mai.
  if (destinatario) {
    const supabase = createSupabaseServiceClient()
    const { data: chi } = await supabase
      .from('staff_users')
      .select('email, commerciale')
      .eq('email', destinatario)
      .maybeSingle()
    if (!chi) return { ok: false, errore: 'Questa persona non ha accesso al pannello.' }
    if (!chi.commerciale) return { ok: false, errore: `${destinatario} non ha il diritto commerciale.` }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('opportunita')
    .update({
      assegnato_a: destinatario,
      assegnato_il: destinatario ? new Date().toISOString() : null,
      assegnato_da: email,
      // Prendere in carico una trattativa libera la porta in gestione da sé:
      // è il senso di prenderla, e lasciarla "da prendere in carico" con un
      // assegnatario sarebbe una contraddizione da correggere a mano.
      ...(destinatario && t.stato === 'nuovo' ? { stato: 'in_gestione', stato_da: email, stato_il: new Date().toISOString() } : {}),
    })
    .eq('id', id)

  if (error) {
    console.error('Assegnazione non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare l’assegnazione. Riprova.' }
  }

  await registraLog(email, destinatario ? 'trattativa_assegnata' : 'trattativa_liberata', {
    entita: 'opportunita',
    entitaId: id,
    dettagli: { da: t.assegnato_a, a: destinatario },
  })

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/persone', 'layout')
  // Il Riepilogo elenca le trattative proprie e quelle libere: prendersene
  // una dalla dashboard deve farla passare da un elenco all'altro subito.
  revalidatePath('/dashboard')
  return { ok: true }
}

/** Scorciatoia per il caso più frequente: me la prendo io. */
export async function prendiInCarico(id: string): Promise<Esito> {
  const { email } = await dirittiCorrenti()
  if (!email) return { ok: false, errore: 'Sessione scaduta: ricarica la pagina.' }
  return assegnaTrattativa(id, email)
}

/**
 * Sposta la trattativa in un altro stato.
 *
 * `motivo` serve ai due stati che lo chiedono, e finisce in due colonne
 * diverse perché sono due domande diverse:
 *
 *  - **perso** → `motivo_perso`, il motivo commerciale: ci abbiamo provato e
 *    non è andata, e fra sei mesi quel perché è l'unica cosa che insegna
 *    qualcosa;
 *  - **annullato** → `motivo_annullato`, la spiegazione di un errore di
 *    inserimento: doppione, attività spuntata per sbaglio al banco, prova.
 *
 * Tenerli separati è ciò che permette di rileggere i motivi di perdita senza
 * doverci prima filtrare via gli sbagli.
 */
export async function cambiaStato(
  id: string,
  nuovo: string,
  motivo?: string | null
): Promise<Esito> {
  const { email, sonoCommerciale, possoRiassegnare, haSezione } = await dirittiCorrenti()
  if (!haSezione) return { ok: false, errore: 'Non hai accesso alle richieste Club e Family.' }
  if (!eStatoValido(nuovo)) return { ok: false, errore: 'Stato non valido.' }

  const t = await trattativa(id)
  if (!t) return { ok: false, errore: 'Trattativa non trovata.' }

  const stato = nuovo as StatoTrattativa
  const adesso = new Date().toISOString()
  const perche = (motivo ?? '').trim() || null
  const diritti = { assegnatoA: t.assegnato_a, io: email, sonoCommerciale, possoRiassegnare }

  // Annullare è l'unico passaggio che sfugge alla regola dell'assegnazione:
  // lo può fare qualsiasi commerciale, anche su una trattativa che segue un
  // collega (vedi puoAnnullare). Gli altri stati sono giudizi sul lavoro di
  // chi la ha in mano; annullare dice che quella riga non è mai stata una
  // trattativa, ed è una correzione dei dati — chi si accorge di un doppione
  // deve poterlo togliere quando lo vede.
  const permesso =
    stato === 'annullato' ? puoAnnullare(diritti) : puoAssegnare(diritti)

  if (!permesso) {
    return {
      ok: false,
      errore:
        stato === 'annullato'
          ? 'Serve il diritto commerciale per annullare una trattativa.'
          : `La segue ${t.assegnato_a}: solo chi la ha in mano può aggiornarla.`,
    }
  }

  // Il controllo sta qui e non solo nel pannello: una Server Action resta
  // chiamabile a mano, e un'annullata senza spiegazione è esattamente la
  // riga che fra un mese nessuno sa più perché è sparita dalla pipeline —
  // tanto più adesso che si può annullare la trattativa di un collega.
  if (stato === 'annullato' && !perche) {
    return { ok: false, errore: 'Scrivi perché la annulli: doppione, errore di inserimento, prova…' }
  }

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase
    .from('opportunita')
    .update({
      stato,
      stato_da: email,
      stato_il: adesso,
      // Riaprire una trattativa chiusa deve azzerare la data di chiusura,
      // altrimenti resta una trattativa aperta con una data di chiusura.
      chiuso_il: eChiusa(stato) ? adesso : null,
      // Ogni motivo vive solo nel suo stato, e uscendo da quello si azzera:
      // una annullata rimessa in gestione che si portasse dietro «doppione»
      // direbbe il falso alla prima riga di storico.
      motivo_perso: stato === 'perso' ? perche : null,
      motivo_annullato: stato === 'annullato' ? perche : null,
    })
    .eq('id', id)

  if (error) return { ok: false, errore: error.message }

  await registraLog(
    email,
    stato === 'annullato' ? 'trattativa_annullata' : 'trattativa_stato_cambiato',
    {
      entita: 'opportunita',
      entitaId: id,
      dettagli: { da: t.stato, a: stato, motivo: perche },
    }
  )

  revalidatePath('/dashboard/richieste', 'layout')
  revalidatePath('/dashboard/persone', 'layout')
  // Il Riepilogo elenca le trattative proprie e quelle libere: prendersene
  // una dalla dashboard deve farla passare da un elenco all'altro subito.
  revalidatePath('/dashboard')
  return { ok: true }
}

import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'

// Server-only (usa il client service role): importare solo da Server
// Action/Server Component, mai da un file "use client".

// Etichette in italiano per ogni azione registrata: servono sia al filtro sia
// alla colonna "Azione" di Controllo operatori. Una chiave senza etichetta qui
// mostra la chiave grezza (vedi etichettaAzione), quindi aggiungere una nuova
// azione non obbliga a toccare nient'altro.
export const AZIONI_LOG: Record<string, string> = {
  login: 'Accesso riuscito',
  login_fallito: 'Accesso rifiutato',
  logout: 'Uscita',
  password_impostata: 'Password impostata',
  recupero_richiesto: 'Recupero password richiesto',
  recupero_fallito: 'Recupero password non inviato',
  // Un tentativo su un indirizzo che non è nel pannello: la pagina risponde
  // come se fosse andato a buon fine (per non rivelare chi c'è), quindi
  // questa riga è l'unico posto in cui si vede.
  recupero_non_autorizzato: 'Recupero password su indirizzo non abilitato',
  utente_invitato: 'Utente invitato',
  utente_rimosso: 'Utente rimosso',
  permesso_invitare_modificato: 'Permesso "Può invitare" modificato',
  permesso_cancellare_modificato: 'Permesso "Può cancellare" modificato',
  sezioni_modificate: 'Sezioni visibili modificate',
  timbratura_entrata: 'Timbratura: entrata',
  timbratura_uscita: 'Timbratura: uscita',
  timbratura_rifiutata: 'Timbratura rifiutata (fuori zona)',
  agenda_voce_creata: 'Agenda: voce creata',
  // Il "Segna fatto" non esiste più — si chiude solo con esito — ma le righe
  // già registrate restano, e senza etichetta mostrerebbero la chiave grezza.
  agenda_voce_completata: 'Agenda: voce segnata fatta',
  agenda_voce_riaperta: 'Agenda: voce riaperta',
  evento_programmato: 'Evento programmato',
  evento_registrato: 'Evento registrato (già avvenuto)',
  evento_modificato: 'Evento modificato',
  agenda_voce_annullata: 'Agenda: voce annullata',
  agenda_voce_eliminata: 'Agenda: voce eliminata',
  esito_eseguita: 'Chiusa con esito: eseguita',
  esito_fallita: 'Chiusa con esito: fallita',
  // Distinta dalle due qui sopra: una voce corretta ha due righe nel registro
  // e la seconda deve dire che ha riscritto la prima, non che è stata chiusa
  // di nuovo. I dettagli portano l'esito di prima e quello di adesso.
  esito_corretto: 'Esito corretto dopo la chiusura',
  voce_rimossa: 'Rimossa (errore o prova)',
  voce_riprogrammata: 'Riprogrammata',
  // Su Club e Family la presa in carico a mano non esiste più — si chiude solo
  // con esito — ma le righe già registrate restano. Sugli altri canali
  // (Young School, Summer Camp, Chinesis, padel, Fitness Manager) queste due
  // chiavi sono tornate in uso: là si gestisce con l'interruttore, e ogni
  // scatto in un senso o nell'altro passa da salvaGestione.
  contatto_gestito: 'Richiesta dal sito: segnata gestita',
  contatto_riaperto: 'Richiesta dal sito: riaperta',
  contatto_nota_salvata: 'Richiesta dal sito: nota salvata',
  persona_nota_salvata: 'Anagrafica: nota salvata',
  persona_nome_corretto: 'Anagrafica: nome corretto',
  trattativa_assegnata: 'Trattativa assegnata',
  trattativa_liberata: 'Trattativa liberata',
  trattativa_stato_cambiato: 'Trattativa: stato cambiato',
  // Distinta dal cambio di stato generico: annullare vuol dire togliere una
  // trattativa dalla pipeline dicendo che non andava creata, ed è la riga che
  // si va a cercare quando i conti di un mese non tornano.
  trattativa_annullata: 'Trattativa annullata (non andava creata)',
  permesso_commerciale_modificato: 'Permesso "Commerciale" modificato',
  permesso_riassegnare_modificato: 'Permesso "Può riassegnare" modificato',
  candidatura_stato: 'Curriculum: stato della candidatura cambiato',
  candidatura_nota: 'Curriculum: nota salvata',
  candidatura_cv_scaricato: 'Curriculum: CV scaricato',
  voucher_emesso: 'Voucher emesso',
  voucher_email_reinviata: 'Voucher: email rimandata al socio',
  voucher_annullato: 'Voucher annullato',
  // Scritte dalla pagina di validazione: l'operatore e' l'account del
  // partner, quindi si vede chi ha bruciato cosa come per ogni altra azione.
  voucher_utilizzato: 'Voucher utilizzato (validazione)',
  voucher_uso_rifiutato: 'Voucher: utilizzo rifiutato',
  notifica_inviata: 'Messaggio interno inviato',
  notifica_letta: 'Messaggio interno: lettura confermata',
  timbratura_corretta: 'Timbratura corretta a mano',
  timbratura_eliminata: 'Timbratura eliminata',
}

export function etichettaAzione(azione: string): string {
  return AZIONI_LOG[azione] ?? azione
}

type OpzioniLog = {
  entita?: string
  entitaId?: string
  dettagli?: Record<string, unknown>
}

// Registra un'azione dell'operatore. Non lancia mai: un log che non riesce a
// scriversi non deve far fallire l'operazione che l'utente ha chiesto — al
// massimo resta una riga in meno nel controllo operatori.
export async function registraLog(
  email: string | null | undefined,
  azione: string,
  opzioni: OpzioniLog = {}
): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient()
    await supabase.from('audit_log').insert({
      email: email?.trim().toLowerCase() ?? null,
      azione,
      entita: opzioni.entita ?? null,
      entita_id: opzioni.entitaId ?? null,
      dettagli: opzioni.dettagli ?? null,
    })
  } catch (e) {
    console.error('audit_log non scritto:', e)
  }
}

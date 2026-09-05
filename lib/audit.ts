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
  agenda_voce_annullata: 'Agenda: voce annullata',
  agenda_voce_eliminata: 'Agenda: voce eliminata',
  esito_eseguita: 'Chiusa con esito: eseguita',
  esito_fallita: 'Chiusa con esito: fallita',
  voce_rimossa: 'Rimossa (errore o prova)',
  voce_riprogrammata: 'Riprogrammata',
  // Come agenda_voce_completata: la presa in carico a mano non esiste più —
  // si chiude solo con esito — ma le righe già registrate restano.
  contatto_gestito: 'Richiesta dal sito: stato gestione modificato',
  contatto_riaperto: 'Richiesta dal sito: riaperta',
  contatto_nota_salvata: 'Richiesta dal sito: nota salvata',
  persona_nota_salvata: 'Anagrafica: nota salvata',
  persona_nome_corretto: 'Anagrafica: nome corretto',
  trattativa_assegnata: 'Trattativa assegnata',
  trattativa_liberata: 'Trattativa liberata',
  trattativa_stato_cambiato: 'Trattativa: stato cambiato',
  permesso_commerciale_modificato: 'Permesso "Commerciale" modificato',
  permesso_riassegnare_modificato: 'Permesso "Può riassegnare" modificato',
  voucher_emesso: 'Voucher emesso',
  voucher_email_reinviata: 'Voucher: email rimandata al socio',
  voucher_annullato: 'Voucher annullato',
  // Le due righe scritte dall'interfaccia del partner: non hanno un
  // operatore del pannello (email nulla), il partner sta in dettagli.
  voucher_utilizzato: 'Voucher utilizzato dal partner',
  voucher_uso_rifiutato: 'Voucher: utilizzo rifiutato',
  chiron_accesso_rifiutato: 'Validazione voucher: accesso rifiutato',
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

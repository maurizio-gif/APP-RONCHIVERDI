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

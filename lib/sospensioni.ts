// Il motivo delle sospensioni (pagina Check sospensioni, vedi
// scripts/sql/2026-10-22-check-sospensioni.sql). Nessun import server-only:
// i tipi servono anche ai componenti client; le letture stanno in
// sospensioni-server.ts.

import type { SezioneChiave } from '@/lib/auth/sezioni'

export const SEZIONE_CHECK_SOSPENSIONI: SezioneChiave = 'check-sospensioni'

// Un documento allegato a una nota (certificato, trasferimento di lavoro, ...).
// Se ne vede il nome: aprirlo e rimuoverlo dal CRM arriva dopo.
export type DocumentoSospensione = {
  id: string
  nome: string
  tipo: string | null
  byte: number | null
}

// Una nota sul motivo: non si modifica, una correzione è una nota nuova.
export type MotivoSospensione = {
  id: string
  testo: string
  // Email di staff_users.
  autore: string
  creato_il: string
  // Assenti dove i documenti non si leggono (pagina Scadenze spostate).
  documenti?: DocumentoSospensione[]
}

export const LUNGHEZZA_MASSIMA_MOTIVO = 2000

// I documenti sono dati sulla salute (art. 9 GDPR): bucket privato, solo
// immagini e PDF fino a 10 MB (stessi limiti dei ticket, vedi lib/ticket.ts).
export const BUCKET_SOSPENSIONI = 'sospensioni-documenti'
export const MASSIMO_DOCUMENTI = 5


// Il motivo delle sospensioni (pagina Check sospensioni, vedi
// scripts/sql/2026-10-22-check-sospensioni.sql). Nessun import server-only:
// i tipi servono anche ai componenti client; le letture stanno in
// sospensioni-server.ts.

import type { SezioneChiave } from '@/lib/auth/sezioni'

export const SEZIONE_CHECK_SOSPENSIONI: SezioneChiave = 'check-sospensioni'

// Una nota sul motivo: non si modifica, una correzione è una nota nuova.
export type MotivoSospensione = {
  id: string
  testo: string
  // Email di staff_users.
  autore: string
  creato_il: string
}

export const LUNGHEZZA_MASSIMA_MOTIVO = 2000

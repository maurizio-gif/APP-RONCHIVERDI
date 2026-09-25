// Estratto da actions.ts (che è 'use server'): un file server action può
// esportare solo funzioni async — un array costante esportato da lì non
// arriva integro al client ("MOTIVI_NON_RINNOVO.map is not a function" a
// runtime, non un errore a compilazione). Stesso elenco del vincolo su
// abbonamenti_scadenze_lavorazione.motivo_non_rinnovo, vedi
// scripts/sql/2026-09-25-abbonamenti-scadenze-motivo-non-rinnovo.sql.
export const MOTIVI_NON_RINNOVO = [
  'ALTRA STRUTTURA',
  'ALTRO SPORT',
  'DISDETTA FLEX',
  'LAVORO',
  'MAI VENUTO',
  'MOTIVI PERSONALI',
  'NESSUNA RISPOSTA',
  'PIGRIZIA E IMPEGNI FAMIGLIARI',
  'POCA FREQUENZA',
  'PREZZO',
  'PREZZO X FREQUENZA',
  'RATE INSOLUTE',
  'RECUPERO',
  'SALUTE',
  'SOLO PERIODO ESTIVO',
  'SOLO PERIODI BREVI',
  "SOVRAFFOLAMENTO-PREZZO- QUALITA' SERVIZI",
  'STUDIO',
  'TRASFERIMENTO ABITAZIONE',
  'TRASFERIMENTO LAVORO',
  'TRASFERIMENTO STUDIO',
] as const

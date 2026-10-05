// La durata venduta di un abbonamento, in parole: Info4U la manda come numero
// + unità (abbonamenti.durata + abbonamenti.periodo: 12 + 'M' = 12 mesi, 'G'
// giorni, 'P' periodi), ed è l'unico modo di sapere se un "1.1 GOLD OVER 35"
// è un mensile o un annuale — lo stesso prodotto esiste in più durate. Non la
// si ricava dalle date: proroghe e sospensioni allungano data_fine (vedi
// scripts/sql/2026-10-05-abbonamenti-scadenze-durata.sql).

const NOMI_MESI: Record<number, string> = {
  1: 'Mensile',
  2: 'Bimestrale',
  3: 'Trimestrale',
  4: 'Quadrimestrale',
  6: 'Semestrale',
  12: 'Annuale',
  24: 'Biennale',
  36: 'Triennale',
}

export function etichettaDurata(durata: number | null, periodo: string | null): string | null {
  if (!durata || !periodo) return null
  switch (periodo.toUpperCase()) {
    case 'M':
      return NOMI_MESI[durata] ?? `${durata} mesi`
    case 'G':
      return durata === 1 ? '1 giorno' : `${durata} giorni`
    case 'P':
      return durata === 1 ? '1 periodo' : `${durata} periodi`
    default:
      return `${durata} ${periodo}`
  }
}

/**
 * Per ordinare le durate dalla più breve alla più lunga (nel filtro): tutto
 * ricondotto a giorni, approssimando il mese a 30. I periodi, di cui non si
 * conosce la lunghezza, vanno in fondo.
 */
export function giorniDurata(durata: number | null, periodo: string | null): number {
  if (!durata || !periodo) return Number.MAX_SAFE_INTEGER
  switch (periodo.toUpperCase()) {
    case 'M':
      return durata * 30
    case 'G':
      return durata
    default:
      return Number.MAX_SAFE_INTEGER - 1
  }
}

/**
 * PostgREST tronca comunque ogni risposta a 1000 righe, `.limit()` o no (lo
 * stesso bug corretto nel resoconto serale, lib/report-direzionale.ts): si
 * legge a pagine da 1000 finché ne torna una più corta. `pagina(da)` è la
 * query già con `.range(da, da + 999)`.
 */
export async function leggiPaginato<T>(
  pagina: (da: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ righe: T[]; error: { message: string } | null }> {
  const righe: T[] = []
  let error: { message: string } | null = null
  for (let da = 0; da < 10000; da += 1000) {
    const risposta = await pagina(da)
    if (risposta.error) error = risposta.error
    righe.push(...(risposta.data ?? []))
    if (!risposta.data || risposta.data.length < 1000) break
  }
  return { righe, error }
}

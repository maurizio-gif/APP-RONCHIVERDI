// Il riquadro base della dashboard direzionale: numero grande, una nota con
// il dato di confronto, e un badge di variazione — niente 'use client', è lo
// stesso .stat statico usato altrove (vedi Totale in
// app/dashboard/analytics/page.tsx), solo con il badge in più.
export function StatCard({
  label,
  valore,
  nota,
  percentuale,
  suffissoBadge = 'vs anno prec.',
}: {
  label: string
  valore: string
  nota?: string
  /** null quando manca un confronto valido (es. anno prima a zero): niente badge, non un finto "+100%". */
  percentuale?: number | null
  suffissoBadge?: string
}) {
  return (
    <div className="stat">
      <span className="stat-testa">
        <span className="stat-label">{label}</span>
      </span>
      <span className="stat-valore">{valore}</span>
      {nota && <span className="stat-nota">{nota}</span>}
      {percentuale !== undefined && percentuale !== null && (
        <span className={`badge ${percentuale >= 0 ? 'badge-ok' : 'badge-ko'}`}>
          {percentuale > 0 ? '+' : ''}
          {percentuale}% {suffissoBadge}
        </span>
      )}
    </div>
  )
}

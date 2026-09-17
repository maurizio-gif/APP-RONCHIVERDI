/**
 * La freccia che esce da un riquadro: il segno che ovunque in un browser
 * vuol dire "questo apre da un'altra parte". Va sui pulsanti che portano
 * alla scheda di un contatto mentre si sta lavorando su un'altra pagina —
 * un'agenda, un avviso, una tabella del Core Manager — così si sa prima di
 * cliccare che non si perde il posto: il pulsante apre una scheda nuova, non
 * sostituisce questa.
 */
export function IconaNuovaScheda() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icona-nuova-scheda"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </svg>
  )
}

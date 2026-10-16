'use client'

// Il PDF della prova si fa dalla stampa del browser («Salva come PDF»): lo
// stile di stampa toglie menu e pulsanti e lascia solo il documento.
export function Stampa() {
  return (
    <button type="button" className="btn no-print" onClick={() => window.print()}>
      Salva in PDF o stampa
    </button>
  )
}

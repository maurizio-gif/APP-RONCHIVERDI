import type { ReactNode } from 'react'

// Il guscio delle guide: una riga chiusa che si apre sul testo.
//
// Sta qui e non dentro ciascuna guida perché le guide sono più di una — il
// modello di Club e Family, la legenda della dashboard — e devono aprirsi,
// pesare e stare nella pagina allo stesso modo. Due gusci separati avrebbero
// preso strade diverse alla prima modifica, e chi passa da una sezione
// all'altra avrebbe trovato due cose che si comportano diversamente pur
// sembrando la stessa.
//
// Chiusa di default, e in un `<details>` nativo: una guida si legge una volta
// e poi non la si vuole più fra sé e il lavoro. Un banner sempre aperto
// diventa invisibile in tre giorni, e intanto occupa la parte alta della
// pagina proprio dove servono i numeri.
export function GuidaSezione({ titolo, children }: { titolo: string; children: ReactNode }) {
  return (
    <details className="guida">
      <summary className="guida-testa">
        <span className="guida-titolo">{titolo}</span>
        <span className="guida-apri" aria-hidden="true" />
      </summary>
      <div className="guida-corpo">{children}</div>
    </details>
  )
}

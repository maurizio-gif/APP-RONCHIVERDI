// Cosa c'è nella dashboard, e di chi è ciò che ci si vede dentro.
//
// La domanda che questa legenda risolve è una sola, e non è ovvia: le due
// sezioni della pagina hanno perimetri diversi. Sopra ci sono le trattative
// **tue**; sotto ci sono gli impegni di **tutti**. Chi non lo sa legge
// «Impegni di oggi» come «i miei impegni di oggi» — e finisce o per
// presentarsi a un appuntamento di una collega, o per dare per scontato che
// qualcun altro se ne occupi.
//
// Il guscio che apre e chiude sta in GuidaSezione, condiviso con la guida del
// modello di Club e Family.

import { GuidaSezione } from './GuidaSezione'

export function GuidaDashboard() {
  return (
    <GuidaSezione titolo="Cosa trovi in questa pagina">
      <section className="guida-passo">
        <h3>In alto: le tue trattative</h3>
        <p>
          I quattro numeri sono i <strong>tuoi</strong>: quante ne hai in gestione, quante hai
          vinto, quante perso. L&apos;unico che non è tuo è <em>da prendere in carico</em>, che
          conta quelle libere di tutto il club — sono lì apposta perché qualcuno se le prenda.
        </p>
      </section>

      <section className="guida-passo">
        <h3>Poi due elenchi: le libere e quelle che segui</h3>
        <p>
          <strong>Libere: le prende chi vuole</strong> — non le ha in mano nessuno. «Prendi in
          carico» te le assegna e le sposta in gestione.
        </p>
        <p>
          <strong>Quelle che segui tu</strong> — aperte e assegnate a te. Sono il tuo lavoro in
          corso: vanno portate a vinta o a persa, col motivo.
        </p>
      </section>

      <section className="guida-passo">
        <h3>In basso: gli impegni di oggi, che non sono solo tuoi</h3>
        <p>
          Gli appuntamenti e le telefonate sono quelli <strong>di tutto il club</strong>, non solo i
          tuoi: al banco serve sapere chi arriva, e vederli tutti evita che in due ci si presenti
          alla stessa telefonata. Le <em>cose da fare</em>, invece, sono solo le tue — quelle non
          riguardano nessun altro. In elenco c&apos;è anche quello che è rimasto indietro nei giorni
          scorsi.
        </p>
        <p>
          Per questo accanto a ogni impegno c&apos;è <strong>il tag di chi ce l&apos;ha in
          mano</strong>: il tuo nome quando è tuo, quello della collega quando è suo,{' '}
          <em>dal sito</em> se l&apos;ha prenotato la persona e non l&apos;ha ancora preso nessuno.
          Prima di lavorare una riga, guarda il tag.
        </p>
      </section>

      <section className="guida-passo">
        <h3>Da qui si lavora, non solo si guarda</h3>
        <p>
          Ogni impegno si chiude da questa pagina con <em>Gestisci</em>: è lo stesso pannello
          dell&apos;agenda e delle richieste, con la stessa nota obbligatoria. L&apos;agenda resta
          il posto dove si vede tutto il calendario; qui c&apos;è solo quello che tocca oggi.
        </p>
      </section>
    </GuidaSezione>
  )
}

// Cosa c'è nella dashboard, e di chi è ciò che ci si vede dentro.
//
// La domanda che questa legenda risolve è una sola, e non è ovvia: le sezioni
// della pagina hanno perimetri diversi. Le trattative sono **tue** (o libere,
// cioè di chi se le prende); gli eventi sono di **tutti**. Chi non lo sa legge
// «Eventi da gestire oggi» come «i miei eventi di oggi» — e finisce o per
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
        <h3>Le righe si aprono</h3>
        <p>
          Ogni riga dice a colpo d&apos;occhio le cose che servono a scegliere chi chiamare per
          primo: il <strong>nome</strong>, <strong>da dove arriva</strong> — Sito, Guest Register,
          Agenda — <strong>che tipo di contatto</strong> l&apos;ha generata e{' '}
          <strong>da quanto aspetta</strong>. Aprila e trovi il messaggio, i pulsanti per chiamare o
          scrivere, e i comandi per chiuderla: <em>da qui si lavora, senza cambiare pagina</em>.
        </p>
      </section>

      <section className="guida-passo">
        <h3>1. Trattative da prendere in carico</h3>
        <p>
          Non le ha in mano <strong>nessuno</strong>: sono di tutto il club e le prende chi vuole.
          «Prendi in carico» te le assegna e le sposta in gestione — sta in riga chiusa, perché è il
          gesto per cui l&apos;elenco esiste.
        </p>
      </section>

      <section className="guida-passo">
        <h3>2. Eventi scaduti o da gestire oggi</h3>
        <p>
          Sono quelli <strong>di tutto il club</strong> — appuntamenti, telefonate e cose da fare,
          di chiunque: al banco serve sapere chi arriva, e in segreteria si copre il turno di chi
          non c&apos;è. Per questo ogni riga dice <strong>a chi è in carico</strong>: «in carico a
          te», il nome del collega, o <em>Non assegnato</em> dove non l&apos;ha preso nessuno —
          com&apos;è per definizione di quelli prenotati dal sito. Guarda quel tag prima di lavorare
          una riga, o in due ci si presenta alla stessa telefonata.
        </p>
        <p>
          Banda <strong>rossa</strong>: è di un giorno passato. Banda <strong>blu</strong>: è di
          oggi.
        </p>
        <p>
          Chiudendo una riga con l&apos;esito ti viene chiesto se vuoi <strong>programmare
          l&apos;evento successivo</strong>: è il «richiamare fra una settimana» che la persona ha
          appena chiesto, e se non lo fissi lì resta solo in testa a te.
        </p>
      </section>

      <section className="guida-passo">
        <h3>3. Le trattative che segui tu</h3>
        <p>
          Il tuo lavoro in corso, da portare a vinta o a persa col motivo. Sotto, i quattro numeri
          sono i <strong>tuoi</strong> — l&apos;unico che non è tuo è <em>da prendere in carico</em>
          , che conta le libere di tutto il club — e in fondo c&apos;è il totale del club, per
          sapere se sei tu a essere carico o è carico il club.
        </p>
      </section>
    </GuidaSezione>
  )
}

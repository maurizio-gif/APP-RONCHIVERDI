// Come funzionano trattative ed eventi, spiegato dove si lavora.
//
// Non è documentazione: è la risposta alla domanda che si fa chi apre il
// pannello e vede una richiesta, una trattativa e un evento senza sapere
// quale delle tre sia la cosa da fare. Finché la spiegazione sta altrove —
// in un manuale, nella testa di chi ha costruito il CRM — quella domanda si
// ripete a ogni persona nuova, e nel frattempo ciascuno si costruisce una
// teoria sua.
//
// Un testo solo, usato da tutte le sezioni che ne hanno bisogno: due copie
// avrebbero preso strade diverse alla prima modifica del modello — ed è
// esattamente quello che si sta spiegando.
//
// Il guscio che apre e chiude sta in GuidaSezione, condiviso con la legenda
// della dashboard.

import { GuidaSezione } from './GuidaSezione'

export function GuidaModello() {
  return (
    <GuidaSezione titolo="Come funzionano trattative ed eventi">
        <section className="guida-passo">
          <h3>Tutto comincia da un evento</h3>
          <p>
            Qualcuno si fa vivo: scrive dal sito, telefona, si presenta al banco. Da dovunque
            arrivi, quel contatto diventa <strong>un evento da gestire</strong> — e, se per quella
            persona non ce n&apos;è già una aperta, apre anche <strong>una trattativa nuova</strong>.
          </p>
        </section>

        <section className="guida-passo">
          <h3>La trattativa è della persona, non della singola richiesta</h3>
          <p>
            Se scrive tre volte, la trattativa resta una: così due consulenti non chiamano lo stesso
            socio. Nasce <em>da prendere in carico</em> — finché nessuno se la prende è di nessuno,
            ed è per quello che l&apos;avviso suona. Chi la prende la segue nel tempo, e prima o poi
            la chiude: <strong>vinta</strong> se si abbona, <strong>persa</strong> se non ne vuole
            più sapere. Sono le uniche due fini.
          </p>
        </section>

        <section className="guida-passo">
          <h3>Gli eventi sono i passi che la fanno avanzare</h3>
          <p>
            Dentro una trattativa gli eventi si accumulano. Alcuni arrivano da soli — una richiesta
            dal sito, una visita al banco — altri li mette la consulente, e può fare due cose
            diverse: <strong>programmare</strong> quello che farà (richiamare giovedì) o{' '}
            <strong>registrare</strong> quello che ha già fatto (le ho appena scritto).
          </p>
          <p>
            Ogni evento programmato va poi chiuso dicendo <strong>com&apos;è andata</strong>:
            eseguito o fallito, con la nota che spiega il perché e la firma di chi l&apos;ha scritta.
            Una nota si può sempre correggere dopo, senza riaprire niente.
          </p>
          <p>
            <strong>Dentro la trattativa si vedono tutti gli eventi che le appartengono</strong>: si
            apre <em>Eventi</em> sulla riga della persona e c&apos;è la cronologia intera, dal primo
            contatto in poi — quello che è arrivato dal sito, quello che è stato fatto, e quello che
            resta da fare. Sono gli eventi di <em>tutta</em> la trattativa, non della singola
            richiesta: se quella persona ha scritto più volte, i richiami nati dalle richieste
            precedenti compaiono lì insieme agli altri, ciascuno segnalato per quello che è. È il
            posto in cui si capisce a che punto si è con qualcuno prima di richiamarlo.
          </p>
        </section>

        <section className="guida-passo">
          <h3>Un messaggio, invece, non ha un esito</h3>
          <p>
            Un messaggio arrivato dal sito non si esegue e non fallisce: o l&apos;hai visto o no, e
            si segna gestito con una nota. È il fatto che <em>ha aperto</em> la trattativa.
            Com&apos;è andata lo dicono gli eventi che seguono; come è finita lo dice la trattativa.
            Un appuntamento prenotato dal sito è un&apos;altra cosa: quello è un impegno preso per
            un giorno e un&apos;ora, e si chiude con un esito come ogni evento.
          </p>
        </section>

        <section className="guida-passo">
          <h3>Dove si guarda cosa</h3>
          <ul className="guida-dove">
            <li>
              <strong>Agenda</strong> — tutti gli eventi, di tutti o solo i tuoi. È da qui che si
              lavora la giornata: cosa c&apos;è oggi, cosa è rimasto indietro.
            </li>
            <li>
              <strong>Abbonamento Club e Family</strong> — il cruscotto delle trattative: quante ne
              sono aperte, chi segue chi, a che punto sono.
            </li>
            <li>
              <strong>La riga della persona</strong> — aprendo <em>Eventi</em> ci sono tutti gli
              eventi di quella trattativa, dal primo contatto in poi.
            </li>
          </ul>
        </section>
    </GuidaSezione>
  )
}

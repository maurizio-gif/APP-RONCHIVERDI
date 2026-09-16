import Link from 'next/link'

/**
 * Il pulsante che porta all'anagrafica del contatto, **uno per tutto il
 * pannello**: l'agenda, la dashboard ed Eventi Core aprono la stessa
 * espansione (vedi GestioneEvento e EventiElenco) e da tutte e tre si va in
 * scheda con lo stesso gesto, nello stesso posto.
 *
 * Sta **in testa** all'espansione, non in coda. Chi apre una riga ha due
 * domande prima di telefonare — «chi è questo?» e «cosa ha già chiesto?» — e
 * la risposta è in scheda: le sue altre richieste, le sue trattative, le note
 * di chi l'ha già chiamato, il percorso sul sito. Il link c'era, ma dopo la
 * trattativa, i recapiti, i dettagli del form, il pannello di chiusura e la
 * cronologia: in fondo a un'espansione che su una riga lavorata è alta due
 * schermi, dove si trova scorrendo e sapendo già che esiste.
 *
 * Pieno e non una pastiglia come Chiama e WhatsApp: quelli sono gesti che si
 * fanno restando sulla riga, questo porta su un'altra pagina — e un comando
 * che cambia pagina si distingue prima di leggerlo.
 *
 * Apre in una scheda nuova, non al posto di questa: chi lo clicca lo fa
 * mentre sta lavorando un evento o una richiesta, e tornare a quel pannello
 * dopo aver guardato l'anagrafica non deve voler dire riaprirlo da capo.
 */
export function SchedaContatto({
  personaId,
  /**
   * Dove la scheda non c'è: dirlo, invece di lasciare un vuoto. Un pulsante
   * che manca non si legge — si cerca, e chi non lo trova pensa che questa
   * espansione sia diversa dalle altre.
   */
  spiegaSeAssente = true,
}: {
  personaId: string | null
  spiegaSeAssente?: boolean
}) {
  if (!personaId) {
    if (!spiegaSeAssente) return null
    // Il perché, non un «non disponibile»: senza email né cellulare il
    // database non aggancia la richiesta a nessuno in anagrafica — non
    // saprebbe a chi, e crearla comunque vorrebbe dire un duplicato
    // garantito al contatto successivo (vedi trova_o_crea_persona).
    return (
      <p className="scheda-contatto-assente muted">
        Nessuna scheda in anagrafica: senza email né cellulare questa voce non è agganciata a
        nessun contatto.
      </p>
    )
  }

  return (
    <Link
      className="btn btn-sm scheda-contatto"
      href={`/dashboard/persone/${personaId}`}
      target="_blank"
      rel="noopener"
    >
      {/* La persona a tratto, come le icone del menu: un glifo di testo
          (☺, ⌂) cambia disegno e ingombro da un sistema all'altro. */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="3.6" />
        <path d="M5 20c0-3.7 3.1-6.2 7-6.2s7 2.5 7 6.2" />
      </svg>
      Scheda contatto
    </Link>
  )
}

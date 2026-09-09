'use client'

/**
 * Chiama · WhatsApp · Email, come tre pastiglie sulla riga.
 *
 * Prima i recapiti stavano solo dentro «Dettagli»: per telefonare a qualcuno
 * si apriva la riga, si leggeva il numero e si cliccava — due passaggi per il
 * gesto che in segreteria si ripete venti volte al giorno. E in dashboard
 * c'erano come testo grigio, da ricopiare a mano.
 *
 * Il click non deve risalire alla riga che li contiene, o telefonare
 * aprirebbe anche il pannello dei dettagli: `stopPropagation` sta qui una
 * volta per tutte invece che su ogni chiamante.
 */
export function ContattiRapidi({
  email,
  cellulare,
  /** Dove manca tutto: dirlo, invece di lasciare uno spazio vuoto. */
  spiegaSeVuoto = false,
}: {
  email: string | null
  cellulare: string | null
  spiegaSeVuoto?: boolean
}) {
  if (!email && !cellulare) {
    if (!spiegaSeVuoto) return null
    // Non è un dettaglio estetico: una richiesta Club senza email né
    // cellulare non genera nessuna persona e quindi nessuna trattativa (vedi
    // trova_o_crea_persona). Chi guarda deve sapere perché quella riga non si
    // può lavorare, invece di cercare il pulsante che non c'è.
    return <p className="contatti-mancanti">Nessun recapito: non è richiamabile</p>
  }

  return (
    <div className="contatti-rapidi" onClick={(e) => e.stopPropagation()}>
      {cellulare && (
        <>
          <a className="contatto-rapido" href={`tel:${soloCifre(cellulare)}`}>
            <span className="contatto-glifo" aria-hidden="true">
              ☎
            </span>
            Chiama
          </a>
          <a
            className="contatto-rapido"
            href={`https://wa.me/${soloCifre(cellulare)}`}
            target="_blank"
            rel="noopener"
          >
            <span className="contatto-glifo" aria-hidden="true">
              ✆
            </span>
            WhatsApp
          </a>
        </>
      )}
      {email && (
        <a className="contatto-rapido" href={`mailto:${email}`}>
          <span className="contatto-glifo" aria-hidden="true">
            ✉
          </span>
          Email
        </a>
      )}
    </div>
  )
}

/** Numero pronto per tel: e wa.me: solo cifre, senza + né spazi. */
function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

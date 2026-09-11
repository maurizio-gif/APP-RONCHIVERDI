'use client'

/**
 * Chiama · WhatsApp · Email, come pastiglie, **con il recapito scritto
 * accanto**.
 *
 * I pulsanti da soli non bastano: al banco si detta un numero al telefono, si
 * copia un indirizzo in un'altra finestra, ci si accorge che il cellulare ha
 * nove cifre e per questo nessuno ha ancora risposto. Un link «Chiama» non si
 * legge e non si copia — e il valore stava solo più in basso, in una lista di
 * etichette, cioè lontano dal gesto a cui serve.
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
      {/* Numero e indirizzo restano attaccati ai loro comandi: il cellulare
          serve Chiama e WhatsApp, l'email serve Email. In una fila unica di
          pastiglie e valori non si capirebbe quale recapito appartiene a
          quale pulsante quando ce n'è uno solo dei due. */}
      {cellulare && (
        <span className="contatto-gruppo">
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
          {/* Il numero com'è scritto sul database, spazi e prefisso compresi:
              è quello che si detta e si confronta. Le cifre pulite servono a
              `tel:` e a wa.me, non a chi legge. */}
          <span className="contatto-valore">{cellulare}</span>
        </span>
      )}
      {email && (
        <span className="contatto-gruppo">
          <a className="contatto-rapido" href={`mailto:${email}`}>
            <span className="contatto-glifo" aria-hidden="true">
              ✉
            </span>
            Email
          </a>
          <span className="contatto-valore">{email}</span>
        </span>
      )}
    </div>
  )
}

/** Numero pronto per tel: e wa.me: solo cifre, senza + né spazi. */
function soloCifre(numero: string): string {
  return numero.replace(/[^0-9]/g, '')
}

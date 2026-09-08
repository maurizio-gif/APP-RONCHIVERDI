// Regole per gli allegati dei messaggi interni. Lo stesso elenco è controllato
// due volte: lato client per dare un errore subito, lato server perché è
// l'unico posto di cui ci si può fidare.
//
// Solo dati e funzioni pure: lo importano sia la pagina sia il modulo di
// composizione, che è un componente client.

/** Tipo MIME accettato → estensione con cui il file viene salvato nel bucket. */
export const TIPI_ALLEGATO_CONSENTITI: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
}

// Il MIME che il browser dichiara non è affidabile su tutti i sistemi (un
// .docx arriva a volte come application/octet-stream): l'attributo accept
// elenca le estensioni, così il selettore file mostra le cose giuste anche
// dove il tipo non viene indovinato.
export const ACCEPT_ALLEGATO = ['.jpg', '.jpeg', '.png', '.pdf', '.doc', '.docx', '.xls', '.xlsx'].join(',')

export const DIMENSIONE_MASSIMA_ALLEGATO = 5 * 1024 * 1024 // 5 MB

export const BUCKET_ALLEGATI = 'notifiche-allegati'

export const ERRORE_TIPO_ALLEGATO =
  'Tipo di file non supportato. Sono ammessi JPG, PNG, PDF, Word ed Excel.'
export const ERRORE_DIMENSIONE_ALLEGATO = 'Il file supera la dimensione massima di 5 MB.'

/** Peso del file leggibile: "480 KB", "1,2 MB". Stesso formato dei curriculum. */
export function pesoLeggibile(byte: number | null | undefined): string | null {
  if (!byte || byte <= 0) return null
  if (byte < 1024) return `${byte} byte`
  if (byte < 1024 * 1024) return `${Math.round(byte / 1024)} KB`
  return `${(byte / 1024 / 1024).toFixed(1)} MB`.replace('.', ',')
}

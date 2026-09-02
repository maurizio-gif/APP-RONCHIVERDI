'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServiceClient } from '@/lib/supabase/serviceClient'
import { emailCorrente, utenteHaSezione } from '@/lib/auth/sezioni-server'
import { registraLog } from '@/lib/audit'
import { ZONA_TIMBRATURA, dentroZona, prossimoTipo, type TipoTimbratura, type Timbratura } from '@/lib/timbratura'

// Risultato come valore di ritorno, non un throw: in produzione Next.js oscura
// il messaggio di un errore lanciato da una Server Action, e qui il messaggio è
// tutto — chi timbra deve capire se è troppo lontano, di quanto, e cosa fare.
export type EsitoTimbratura =
  | { ok: true; tipo: TipoTimbratura; distanza: number }
  | { ok: false; errore: string; fuoriZona?: { distanza: number } }

export async function timbra(
  tipoRichiesto: TipoTimbratura,
  lat: number,
  lng: number,
  precisioneMetri: number | null
): Promise<EsitoTimbratura> {
  const email = emailCorrente()
  if (!email) return { ok: false, errore: 'Sessione scaduta: ricarica la pagina e rientra.' }

  if (!(await utenteHaSezione('timbratura'))) {
    return { ok: false, errore: 'Non hai il permesso di timbrare il cartellino.' }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, errore: 'Posizione non rilevata. Attiva il GPS e riprova.' }
  }

  // La validazione della zona è QUI, non nel browser: le coordinate arrivano
  // dal client e un client si può falsificare. Il controllo lato client serve
  // solo a mostrare la distanza prima di premere.
  const { dentro, distanza } = dentroZona(lat, lng)
  const distanzaArrotondata = Math.round(distanza)

  const supabase = createSupabaseServiceClient()

  if (!dentro) {
    // Il tentativo respinto non entra nel cartellino ma resta tracciato: se
    // qualcuno prova a timbrare da casa, si vede.
    await registraLog(email, 'timbratura_rifiutata', {
      entita: 'timbrature',
      dettagli: {
        tipo: tipoRichiesto,
        distanza_metri: distanzaArrotondata,
        raggio_metri: ZONA_TIMBRATURA.raggioMetri,
        precisione_metri: precisioneMetri,
      },
    })
    return {
      ok: false,
      errore: `Sei a circa ${distanzaArrotondata} m dal club: si può timbrare solo entro ${ZONA_TIMBRATURA.raggioMetri} m.`,
      fuoriZona: { distanza: distanzaArrotondata },
    }
  }

  // Il tipo lo decide il server sull'ultima timbratura in tabella, non il
  // pulsante: fra il caricamento della pagina e il tocco può essere passato
  // del tempo, o un'altra scheda può aver già timbrato. Senza questo si
  // ottengono due entrate di fila e un turno che non si chiude più.
  const { data: ultimaRiga } = await supabase
    .from('timbrature')
    .select('id, created_at, email, tipo, distanza_metri')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const tipo = prossimoTipo(ultimaRiga as Timbratura | null)
  if (tipo !== tipoRichiesto) {
    return {
      ok: false,
      errore:
        tipo === 'uscita'
          ? 'Risulti già dentro: la prossima timbratura è un’uscita. Ricarica la pagina.'
          : 'Risulti già fuori: la prossima timbratura è un’entrata. Ricarica la pagina.',
    }
  }

  const { error } = await supabase.from('timbrature').insert({
    email,
    tipo,
    lat,
    lng,
    distanza_metri: distanzaArrotondata,
  })

  if (error) {
    console.error('Timbratura non salvata:', error.message)
    return { ok: false, errore: 'Non siamo riusciti a salvare la timbratura. Riprova.' }
  }

  await registraLog(email, tipo === 'entrata' ? 'timbratura_entrata' : 'timbratura_uscita', {
    entita: 'timbrature',
    dettagli: { distanza_metri: distanzaArrotondata, precisione_metri: precisioneMetri },
  })

  revalidatePath('/dashboard/timbratura')
  return { ok: true, tipo, distanza: distanzaArrotondata }
}

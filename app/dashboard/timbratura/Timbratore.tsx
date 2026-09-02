'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ZONA_TIMBRATURA, dentroZona, type TipoTimbratura } from '@/lib/timbratura'
import { timbra } from './actions'

type StatoPosizione =
  | { fase: 'iniziale' }
  | { fase: 'richiesta' }
  | { fase: 'ok'; lat: number; lng: number; precisione: number; distanza: number; dentro: boolean }
  | { fase: 'errore'; messaggio: string }

// Precisione oltre la quale la posizione non è affidabile: con un margine di
// mezzo chilometro il punto può cadere dentro la zona per caso (tipico del
// posizionamento via WiFi o rete mobile, quando il GPS non ha agganciato).
const PRECISIONE_MAX_METRI = 200

function messaggioErrorePosizione(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Permesso di posizione negato. Va concesso al sito dalle impostazioni del browser: senza, non si può timbrare.'
    case err.POSITION_UNAVAILABLE:
      return 'Posizione non disponibile. Se sei al coperto prova ad avvicinarti a una finestra o esci qualche passo.'
    case err.TIMEOUT:
      return 'Il rilevamento della posizione è andato in timeout. Riprova.'
    default:
      return 'Non è stato possibile rilevare la posizione.'
  }
}

export function Timbratore({ prossimo }: { prossimo: TipoTimbratura }) {
  const router = useRouter()
  const [posizione, setPosizione] = useState<StatoPosizione>({ fase: 'iniziale' })
  const [esito, setEsito] = useState<{ ok: boolean; messaggio: string } | null>(null)
  const [inCorso, startTransition] = useTransition()

  function rilevaPosizione() {
    if (!('geolocation' in navigator)) {
      setPosizione({ fase: 'errore', messaggio: 'Questo browser non sa rilevare la posizione.' })
      return
    }

    setPosizione({ fase: 'richiesta' })
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        const { dentro, distanza } = dentroZona(latitude, longitude)
        setPosizione({
          fase: 'ok',
          lat: latitude,
          lng: longitude,
          precisione: Math.round(accuracy),
          distanza: Math.round(distanza),
          dentro,
        })
      },
      (err) => setPosizione({ fase: 'errore', messaggio: messaggioErrorePosizione(err) }),
      // enableHighAccuracy: sul telefono accende il GPS invece di accontentarsi
      // della rete. maximumAge 0: una posizione in cache di dieci minuti prima
      // potrebbe essere quella di casa.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  // La posizione si chiede appena la pagina è aperta: chi timbra ha le mani
  // occupate e vuole un tocco solo, non due.
  useEffect(() => {
    rilevaPosizione()
  }, [])

  function invia() {
    if (posizione.fase !== 'ok') return
    setEsito(null)
    startTransition(async () => {
      const r = await timbra(prossimo, posizione.lat, posizione.lng, posizione.precisione)
      if (r.ok) {
        setEsito({
          ok: true,
          messaggio: r.tipo === 'entrata' ? 'Entrata registrata. Buon lavoro!' : 'Uscita registrata. A domani!',
        })
        // Rilegge lo stato dal server: il pulsante si capovolge in
        // entrata/uscita e il turno appena chiuso compare nell'elenco.
        router.refresh()
      } else {
        setEsito({ ok: false, messaggio: r.errore })
      }
    })
  }

  const eEntrata = prossimo === 'entrata'

  return (
    <div className="card timbratore">
      <div className="card-head">
        <div>
          <p className="eyebrow">Timbra cartellino</p>
          <h2 style={{ margin: 0 }}>{eEntrata ? 'Sei fuori servizio' : 'Sei in servizio'}</h2>
        </div>
        <span className={`badge ${eEntrata ? 'badge-off' : 'badge-ok'}`}>
          {eEntrata ? 'da timbrare in entrata' : 'turno aperto'}
        </span>
      </div>

      {posizione.fase === 'richiesta' && (
        <p className="muted posizione-riga">
          <span className="spinner" /> Rilevo la posizione…
        </p>
      )}

      {posizione.fase === 'errore' && (
        <>
          <p className="error-banner">{posizione.messaggio}</p>
          <button type="button" className="btn btn-ghost" onClick={rilevaPosizione}>
            Riprova a rilevare
          </button>
        </>
      )}

      {posizione.fase === 'ok' && (
        <>
          <p className={`posizione-riga ${posizione.dentro ? 'is-dentro' : 'is-fuori'}`}>
            {posizione.dentro ? 'Sei al club' : 'Sei fuori dalla zona del club'}
            <span className="muted">
              {' '}
              · a {posizione.distanza} m dal centro, precisione ±{posizione.precisione} m
            </span>
          </p>

          {posizione.precisione > PRECISIONE_MAX_METRI && (
            <p className="banner">
              La posizione è imprecisa (±{posizione.precisione} m): il GPS probabilmente non ha ancora
              agganciato. Aspetta qualche secondo e rileva di nuovo, così il timbro non finisce con
              una posizione approssimativa.
            </p>
          )}

          {!posizione.dentro && (
            <p className="banner">
              Si può timbrare solo entro {ZONA_TIMBRATURA.raggioMetri} m dal club. Se sei in sede e
              vedi questo messaggio, rileva di nuovo la posizione: al coperto il primo tentativo
              spesso usa la rete invece del GPS.
            </p>
          )}

          <div className="timbratore-azioni">
            <button
              type="button"
              className="btn btn-grande"
              onClick={invia}
              disabled={!posizione.dentro || inCorso}
            >
              {inCorso ? 'Registro…' : eEntrata ? 'Timbra entrata' : 'Timbra uscita'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={rilevaPosizione} disabled={inCorso}>
              Rileva di nuovo
            </button>
          </div>
        </>
      )}

      {esito && <p className={esito.ok ? 'ok-banner' : 'error-banner'} style={{ marginTop: '1rem', marginBottom: 0 }}>{esito.messaggio}</p>}
    </div>
  )
}

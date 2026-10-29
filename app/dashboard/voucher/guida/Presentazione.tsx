'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

// Il codice di esempio è inventato: i voucher veri non si mostrano mai in una
// presentazione (il codice lo vede solo il socio).
const CASELLA = 'certificatimedici@ronchiverdi.it'

type Diapositiva = { id: string; scura?: boolean; titolo: string; corpo: ReactNode }

function Passo({ n, titolo, testo }: { n: number; titolo: string; testo: string }) {
  return (
    <li className="pres-passo">
      <span className="pres-passo-n">{n}</span>
      <strong>{titolo}</strong>
      <span>{testo}</span>
    </li>
  )
}

const DIAPOSITIVE: Diapositiva[] = [
  {
    id: 'titolo',
    scura: true,
    titolo: 'Certificati medici',
    corpo: (
      <>
        <p className="pres-sottotitolo">Il nuovo processo con Chiron</p>
        <p className="pres-nota">Guida per la segreteria · dalla vendita dell’abbonamento al certificato in Info4U</p>
      </>
    ),
  },
  {
    id: 'processo',
    titolo: 'Il processo in cinque passi',
    corpo: (
      <ol className="pres-passi">
        <Passo n={1} titolo="Vendita" testo="Il prodotto ha la sigla «(cer000)»" />
        <Passo n={2} titolo="Codice" testo="Parte da solo, per email, al socio" />
        <Passo n={3} titolo="Chiron" testo="Verifica il codice e lo usa" />
        <Passo n={4} titolo="Certificato" testo="Il socio lo invia alla casella dedicata" />
        <Passo n={5} titolo="Info4U" testo="La segreteria inserisce la data" />
      </ol>
    ),
  },
  {
    id: 'vendita',
    titolo: '1 · Alla vendita: la sigla «(cer000)»',
    corpo: (
      <div className="pres-due">
        <div>
          <p>
            Quando vendi un abbonamento che include la visita, il nome del prodotto in Info4U deve contenere{' '}
            <strong>«(cer000)»</strong>.
          </p>
          <p>È quella sigla a far partire l’automazione: senza, il socio non riceve nessun codice.</p>
          <p className="pres-nota">
            Socio senza email in Info4U? Il codice non può partire: aggiungi l’email entro 7 giorni dalla vendita e
            parte da solo.
          </p>
        </div>
        <div className="pres-mock">
          <p className="pres-mock-etichetta">Prodotto in Info4U</p>
          <p className="pres-prodotto">
            1.1 GOLD OVER 35 <mark>(cer000)</mark>
          </p>
          <p className="pres-mock-etichetta">Il codice parte entro circa 15 minuti dalla vendita</p>
        </div>
      </div>
    ),
  },
  {
    id: 'codice',
    titolo: '2 · Il socio riceve il codice',
    corpo: (
      <div className="pres-due">
        <div className="pres-mock pres-email">
          <p className="pres-mock-etichetta">Email al socio</p>
          <p className="pres-email-oggetto">Il tuo voucher per la visita medica inclusa</p>
          <p className="pres-codice">1234 5678</p>
          <p className="pres-mock-etichetta">Monouso · valido 12 mesi dall’emissione</p>
        </div>
        <div>
          <p>
            L’email arriva <strong>subito</strong>, con il codice di otto cifre. Vale <strong>12 mesi</strong> e si
            può usare una volta sola.
          </p>
          <p>
            Il socio prenota <strong>online</strong>, scrivendo il codice nel campo «Note», oppure{' '}
            <strong>al telefono</strong>, comunicandolo all’operatore.
          </p>
        </div>
      </div>
    ),
  },
  {
    id: 'crm',
    titolo: '3 · Cosa vedi nel CRM',
    corpo: (
      <div className="pres-due">
        <div>
          <p>
            In <strong>Voucher visita medica</strong> trovi tutti i codici emessi, con lo stato e le email partite
            (e il loro esito).
          </p>
          <p>
            Il socio non ha ricevuto l’email o non la trova? <strong>«Reinvia email»</strong>: parte la stessa email,
            con lo stesso codice.
          </p>
          <p className="pres-nota">Il codice non si vede nel CRM: lo riceve solo il socio.</p>
        </div>
        <div className="pres-mock">
          <table className="tabella pres-tabella">
            <thead>
              <tr>
                <th>Socio</th>
                <th>Stato</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Mario Rossi</td>
                <td>
                  <span className="badge badge-ok">Attivo</span>
                </td>
                <td>
                  <span className="btn btn-ghost btn-sm">Reinvia email</span>
                </td>
              </tr>
              <tr>
                <td>Laura Bianchi</td>
                <td>
                  <span className="badge">Utilizzato</span>
                </td>
                <td className="muted">29/10 · 10:42</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    ),
  },
  {
    id: 'chiron',
    titolo: '4 · Chiron usa il codice',
    corpo: (
      <ol className="pres-elenco">
        <li>
          Chiron entra nel CRM con le sue credenziali e inserisce il codice che gli detta il socio.
        </li>
        <li>
          La pagina dice se è <strong>ancora utilizzabile</strong> e a chi è intestato.
        </li>
        <li>
          Chiron conferma: il codice si consuma e <strong>non è più utilizzabile</strong>.
        </li>
        <li>
          Il socio riceve subito un’email di notifica. Nel CRM il voucher passa a <strong>«Utilizzato»</strong>, con
          data, ora e operatore.
        </li>
      </ol>
    ),
  },
  {
    id: 'certificato',
    scura: true,
    titolo: '5 · Il certificato arriva per email',
    corpo: (
      <>
        <p className="pres-casella">{CASELLA}</p>
        <p className="pres-sottotitolo">Niente più fotocopie: il certificato non si ritira fisicamente.</p>
        <ul className="pres-elenco-chiaro">
          <li>Il socio lo invia <strong>in allegato</strong> a questa casella. È l’unica modalità di consegna.</li>
          <li>Ha solo il cartaceo? In reception lo fotografiamo e lo inviamo insieme a lui.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'info4u',
    titolo: 'Poi tocca alla segreteria',
    corpo: (
      <ol className="pres-passi pres-passi-3">
        <Passo n={1} titolo="Controlla" testo="Il certificato è leggibile e va bene" />
        <Passo n={2} titolo="Inserisci" testo="La data in Info4U, a mano" />
        <Passo n={3} titolo="Resta in casella" testo="L’email rimane salvata nella casella dedicata" />
      </ol>
    ),
  },
  {
    id: 'ricorda',
    scura: true,
    titolo: 'Da ricordare',
    corpo: (
      <ul className="pres-elenco-chiaro pres-ricorda">
        <li>
          Alla vendita: la sigla <strong>«(cer000)»</strong> nel prodotto.
        </li>
        <li>
          Il codice parte da solo e vale <strong>12 mesi</strong>.
        </li>
        <li>
          Non è arrivato? <strong>«Reinvia email»</strong> nel CRM.
        </li>
        <li>
          Il certificato va a <strong>{CASELLA}</strong>: la data in Info4U si inserisce a mano.
        </li>
      </ul>
    ),
  },
]

export function Presentazione() {
  const [i, setI] = useState(0)
  const [pieno, setPieno] = useState(false)
  const [video, setVideo] = useState(false)
  const palco = useRef<HTMLDivElement>(null)
  const ultima = DIAPOSITIVE.length - 1

  const vai = useCallback((n: number) => setI(Math.max(0, Math.min(ultima, n))), [ultima])

  useEffect(() => {
    function tasto(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        setI((x) => Math.min(ultima, x + 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        setI((x) => Math.max(0, x - 1))
      } else if (e.key === 'Home') setI(0)
      else if (e.key === 'End') setI(ultima)
    }
    function cambioPieno() {
      setPieno(document.fullscreenElement === palco.current)
    }
    window.addEventListener('keydown', tasto)
    document.addEventListener('fullscreenchange', cambioPieno)
    return () => {
      window.removeEventListener('keydown', tasto)
      document.removeEventListener('fullscreenchange', cambioPieno)
    }
  }, [ultima])

  function presenta() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void palco.current?.requestFullscreen?.()
  }

  const d = DIAPOSITIVE[i]

  return (
    <>
      <div className="pres-barra">
        <button type="button" className="btn" onClick={presenta}>
          {pieno ? 'Esci dalla schermata intera' : 'Presenta'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setVideo((v) => !v)}>
          {video ? 'Torna alle slide' : 'Guarda il video'}
        </button>
      </div>

      <div ref={palco} className={`pres-palco${pieno ? ' is-pieno' : ''}`}>
        {video ? (
          <video
            className="pres-video"
            src="/guida/certificati-chiron.mp4"
            poster="/guida/certificati-chiron.jpg"
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <section className={`pres-slide${d.scura ? ' is-scura' : ''}`} aria-live="polite">
            <h2 className="pres-titolo">{d.titolo}</h2>
            <div className="pres-corpo">{d.corpo}</div>
            <span className="pres-conta">
              {i + 1} / {DIAPOSITIVE.length}
            </span>
          </section>
        )}

        {!video && (
          <div className="pres-nav">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => vai(i - 1)} disabled={i === 0}>
              ← Indietro
            </button>
            <span className="pres-punti" role="tablist" aria-label="Diapositive">
              {DIAPOSITIVE.map((x, n) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={n === i}
                  aria-label={`Diapositiva ${n + 1}`}
                  className={`pres-punto${n === i ? ' is-attivo' : ''}`}
                  onClick={() => vai(n)}
                />
              ))}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => vai(i + 1)} disabled={i === ultima}>
              Avanti →
            </button>
          </div>
        )}
      </div>
    </>
  )
}

'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type TextareaHTMLAttributes } from 'react'

// Ogni campo note del CRM passa da qui, al posto di <textarea>. Due cose in più:
//
// 1. Mentre si scrive il riquadro cresce con il testo, invece di far scorrere
//    un testo lungo in tre righe. Uscendo dal campo torna alla sua altezza (e
//    il testo scorre dentro): così una griglia o un elenco con il campo dentro
//    non si deformano per una nota lunga.
//
// 2. Il microfono: si detta e il testo si aggiunge in fondo a quello già
//    scritto. Usa il riconoscimento vocale del browser (Web Speech API, in
//    italiano): c'è su Chrome, Edge e Safari, anche su iPhone e Android. Dove
//    non c'è (Firefox) il pulsante non compare.
//
// Accetta tutte le proprietà di una <textarea>, controllata (value/onChange)
// o no (defaultValue/name nei form): il testo dettato passa da un evento
// `input` vero, quindi lo vedono sia React sia un <form> normale.

type Riconoscimento = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function creaRiconoscimento(): Riconoscimento | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as Record<string, (new () => Riconoscimento) | undefined>
  const Costruttore = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Costruttore ? new Costruttore() : null
}

export const CampoNote = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function CampoNote({ className, onInput, onBlur, disabled, readOnly, maxLength, ...resto }, esterno) {
    const ref = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(esterno, () => ref.current!, [])
    const [supportato, setSupportato] = useState(false)
    const [ascolto, setAscolto] = useState(false)
    const [errore, setErrore] = useState<string | null>(null)
    const riconoscimento = useRef<Riconoscimento | null>(null)

    useEffect(() => {
      setSupportato(!!creaRiconoscimento())
      return () => riconoscimento.current?.stop()
    }, [])

    // Cresce fino a contenere tutto il testo, mai sotto l'altezza di partenza.
    const cresci = useCallback(() => {
      const el = ref.current
      if (!el) return
      el.style.height = ''
      const base = el.offsetHeight
      if (el.scrollHeight > el.clientHeight) el.style.height = `${Math.max(base, el.scrollHeight + 2)}px`
    }, [])

    const torna = useCallback(() => {
      if (ref.current) ref.current.style.height = ''
    }, [])

    // Il testo dettato entra come se fosse stato scritto: setter nativo più
    // evento `input`, l'unico modo perché React aggiorni il suo stato.
    const aggiungi = useCallback(
      (dettato: string) => {
        const el = ref.current
        const parole = dettato.trim()
        if (!el || !parole) return
        const prima = el.value
        const separatore = prima && !/\s$/.test(prima) ? ' ' : ''
        let nuovo = prima + separatore + parole.charAt(0).toUpperCase() + parole.slice(1)
        if (maxLength && maxLength > 0) nuovo = nuovo.slice(0, maxLength)
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        setter?.call(el, nuovo)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        cresci()
      },
      [cresci, maxLength]
    )

    function microfono() {
      setErrore(null)
      if (ascolto) {
        riconoscimento.current?.stop()
        return
      }
      const r = creaRiconoscimento()
      if (!r) return
      r.lang = 'it-IT'
      r.continuous = true
      r.interimResults = false
      r.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) aggiungi(e.results[i][0].transcript)
        }
      }
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
          setErrore('Il browser non ha il permesso di usare il microfono.')
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setErrore('Dettatura interrotta: riprova.')
      }
      r.onend = () => {
        setAscolto(false)
        riconoscimento.current = null
      }
      riconoscimento.current = r
      try {
        r.start()
        setAscolto(true)
        ref.current?.focus()
      } catch {
        setErrore('Il microfono non è disponibile.')
      }
    }

    const conMicrofono = supportato && !disabled && !readOnly

    return (
      <div className={`campo-note${conMicrofono ? ' con-microfono' : ''}${ascolto ? ' in-ascolto' : ''}`}>
        <textarea
          ref={ref}
          className={className}
          disabled={disabled}
          readOnly={readOnly}
          maxLength={maxLength}
          {...resto}
          onInput={(e) => {
            cresci()
            onInput?.(e)
          }}
          onBlur={(e) => {
            // Durante la dettatura il campo resta aperto anche se il fuoco va
            // sul pulsante del microfono.
            if (!ascolto) torna()
            onBlur?.(e)
          }}
        />
        {conMicrofono && (
          <button
            type="button"
            className="campo-note-mic"
            onMouseDown={(e) => e.preventDefault()}
            onClick={microfono}
            aria-pressed={ascolto}
            aria-label={ascolto ? 'Ferma la dettatura' : 'Detta con il microfono'}
            title={ascolto ? 'Ferma la dettatura' : 'Detta con il microfono'}
          >
            {ascolto ? (
              <span className="campo-note-stop" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
        )}
        {ascolto && <span className="campo-note-stato">Sto ascoltando… parla, poi premi di nuovo per fermare</span>}
        {errore && <span className="campo-note-errore">{errore}</span>}
      </div>
    )
  }
)

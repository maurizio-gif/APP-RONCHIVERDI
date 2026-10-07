'use client'

import { useEffect, useState } from 'react'

type Formato = 'A4' | 'A3'

// Stampa (o salva in PDF dal dialogo del browser) la tabella dei rinnovi in
// orizzontale. Il formato carta si sceglie qui perché @page non si può
// parametrizzare da CSS: si inietta uno <style> con la size giusta solo per
// la durata della stampa, e la classe sul body attiva le regole di stampa
// in globals.css (così le altre pagine non cambiano).
export function BottoneStampa() {
  const [formato, setFormato] = useState<Formato>('A4')

  useEffect(() => {
    function pulisci() {
      document.body.classList.remove('stampa-rinnovi')
      document.getElementById('stampa-rinnovi-formato')?.remove()
    }
    window.addEventListener('afterprint', pulisci)
    return () => {
      window.removeEventListener('afterprint', pulisci)
      pulisci()
    }
  }, [])

  function stampa() {
    document.getElementById('stampa-rinnovi-formato')?.remove()
    const stile = document.createElement('style')
    stile.id = 'stampa-rinnovi-formato'
    stile.textContent = `@page { size: ${formato} landscape; margin: 8mm; }`
    document.head.appendChild(stile)
    document.body.classList.add('stampa-rinnovi')
    window.print()
  }

  return (
    <div className="stampa-comandi no-stampa">
      <label className="stampa-formato">
        <span className="muted">Formato</span>
        <select value={formato} onChange={(e) => setFormato(e.target.value as Formato)} aria-label="Formato carta">
          <option value="A4">A4 orizzontale</option>
          <option value="A3">A3 orizzontale</option>
        </select>
      </label>
      <button type="button" className="btn btn-sm" onClick={stampa}>
        Stampa / PDF
      </button>
    </div>
  )
}

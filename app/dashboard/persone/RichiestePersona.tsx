'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  CLASSE_TIPO,
  ETICHETTE_TIPO_BREVI,
  dataBreve,
  eAppuntamentoVero,
  intervalloOrario,
  tipoDaAzione,
  type Esito,
} from '@/lib/agenda'
import { canaleDiRichiesta, eGestioneSemplice } from '@/lib/richieste'
import { provenienzaTrattativa } from '@/lib/provenienza'
import { nomeDiEmail } from '@/lib/staff'
import { percorsoBreve, primoContattoDi, provenienzaRichiesta } from '@/lib/percorsoSito'
import { GestioneEsito } from '@/components/GestioneEsito'
import { GestioneSemplice } from '../richieste/GestioneSemplice'
import { ChiusuraTrattativa } from '../ChiusuraTrattativa'
import { ContattiRapidi } from '../ContattiRapidi'
import type { DatiTrattativa } from '../richieste/Trattativa'

/** Una richiesta della persona, con tutto quello che serve a lavorarla qui. */
export type RichiestaDiPersona = {
  id: string
  created_at: string
  origine: string | null
  attivita: string | null
  attivita_label: string | null
  settore: string | null
  azione: string | null
  data_scelta: string | null
  ora_scelta: string | null
  messaggio: string | null
  dettagli: string[] | null
  gestito: boolean
  gestito_da: string | null
  gestito_il: string | null
  /** Di chi è il lavoro (vedi il trigger assegna_eventi_della_trattativa). */
  assegnato_a: string | null
  note: string | null
  note_da: string | null
  note_il: string | null
  esito_tipo: string | null
  esito: string | null
  esito_da: string | null
  esito_il: string | null
  pagina: string | null
  cta: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  first_utm_source: string | null
  first_utm_campaign: string | null
  landing_page: string | null
}

// Le richieste di una persona, gestibili qui.
//
// La scheda del contatto era **solo lettura**, per una ragione che sembrava
// buona: le richieste si lavorano nella sezione del responsabile, e avere due
// posti dove agire vorrebbe dire due abitudini diverse per la stessa cosa.
//
// Ma il gesto vero è un altro. Si apre la scheda di una persona **prima di
// chiamarla**: si guarda cos'ha chiesto, quante volte, cosa le è stato detto
// l'ultima volta. Fatta la telefonata, la si deve chiudere — e la scheda
// rimandava a un'altra pagina, dove ritrovare la riga giusta in un elenco di
// duecento. Tre passaggi per il gesto immediatamente successivo a quello che
// si stava facendo.
//
// «Due posti dove agire» non è il rischio che si temeva, perché non ci sono
// due implementazioni: il pannello è lo stesso — GestioneEsito e
// GestioneSemplice — con le stesse regole e la stessa nota obbligatoria, e
// l'autorizzazione la fa il server sul canale della richiesta, non questa
// pagina. È un secondo accesso alla stessa porta, non una seconda porta.
//
// La forma della riga è quella della dashboard (.op-*): chiusa dice cosa ha
// chiesto e com'è andata, aperta si lavora.

export function RichiestePersona({
  richieste,
  email,
  cellulare,
  nome,
  operatori,
  puoCancellare,
  trattativaAperta = null,
  io = null,
  sonoCommerciale = false,
  possoRiassegnare = false,
  nomiStaff = {},
}: {
  richieste: RichiestaDiPersona[]
  /** I recapiti della persona: uguali per tutte le sue richieste. */
  email: string | null
  cellulare: string | null
  /** Nome e cognome: titolo dei pannelli e dell'evento di seguito. */
  nome: string
  operatori: string[]
  puoCancellare: boolean
  /**
   * La trattativa aperta di questa persona, se ce n'è una: si chiude da qui,
   * dalla richiesta che si sta lavorando. Al massimo una — vedi
   * trova_o_crea_opportunita.
   */
  trattativaAperta?: DatiTrattativa | null
  io?: string | null
  /** I diritti sulla pipeline: decidono quali chiusure si possono offrire. */
  sonoCommerciale?: boolean
  possoRiassegnare?: boolean
  nomiStaff?: Record<string, string>
}) {
  const [aperta, setAperta] = useState<string | null>(null)

  return (
    <ul className="op-elenco">
      {richieste.map((r) => {
        const inGestione = aperta === r.id
        const canale = canaleDiRichiesta(r)
        const tipo = tipoDaAzione(r.azione)

        /**
         * Se si chiude con l'interruttore o con l'esito. Stessa regola di
         * conInterruttore in app/dashboard/richieste/actions.ts, che lato
         * server decide cosa si può salvare: senza canale si resta
         * sull'interruttore, che è il pannello che non pretende di far
         * avanzare una pipeline che non c'è.
         */
        const conInterruttore = canale
          ? eGestioneSemplice(canale) || !eAppuntamentoVero(tipo)
          : true

        const provenienza = provenienzaTrattativa({
          origineRichiesta: r.origine,
          haRichiesta: true,
        })

        const quando = r.data_scelta
          ? `${dataBreve(r.data_scelta)}${
              r.ora_scelta
                ? ` · ${intervalloOrario(String(r.ora_scelta).slice(0, 5), 45) ?? String(r.ora_scelta).slice(0, 5)}`
                : ''
            }`
          : null

        const titolo =
          r.attivita_label ?? (r.origine === 'chinesis-inline' ? 'Chinesis' : 'Richiesta informazioni')

        return (
          <li
            className={`op riga-stato ${r.gestito ? 'stato-chiuso' : 'stato-nuovo'}${
              inGestione ? ' is-aperta' : ''
            }`}
            key={r.id}
          >
            <div className="op-riga">
              <button
                type="button"
                className="op-apri"
                aria-expanded={inGestione}
                onClick={() => setAperta(inGestione ? null : r.id)}
              >
                <span className={`badge-tipo ${CLASSE_TIPO[tipo]} op-tipo`}>
                  {ETICHETTE_TIPO_BREVI[tipo]}
                </span>

                <span className="op-corpo">
                  <span className="op-nome">{titolo}</span>

                  <span className="op-meta">
                    {/* La data d'arrivo: su una scheda si legge la storia, e
                        una riga senza quando non si colloca. */}
                    <span className="op-quando muted">{dataBreve(r.created_at.slice(0, 10))}</span>

                    <span className={`tag-provenienza ${provenienza.classe}`}>
                      {provenienza.etichetta}
                    </span>

                    {r.settore && <span className="tag">{r.settore}</span>}

                    {quando && <span className="tag tag-appuntamento">{quando}</span>}

                    {/* Di chi è il lavoro, e dirlo sempre: «Non assegnato»
                        dove non l'ha preso nessuno, o l'assenza del nome
                        diventa essa stessa l'informazione — leggibile solo da
                        chi la sa già. */}
                    <span
                      className={`tag-assegnato${r.assegnato_a ? ' e-altrui' : ' e-nessuno'}`}
                    >
                      {r.assegnato_a
                        ? `In carico a ${nomeDiEmail(r.assegnato_a, nomiStaff)}`
                        : 'Non assegnato'}
                    </span>

                    {r.gestito ? (
                      <span className="badge badge-ok badge-punto badge-stato">lavorata</span>
                    ) : (
                      <span className="badge badge-warn badge-punto badge-stato">da lavorare</span>
                    )}
                  </span>
                </span>

                <span className="op-freccia" aria-hidden="true" />
              </button>
            </div>

            {inGestione && (
              <div className="op-espansione">
                <div className="op-richiesta">
                  {r.messaggio && <p className="op-messaggio">{r.messaggio}</p>}

                  {r.dettagli && r.dettagli.length > 0 && (
                    <p className="op-attivita muted">Interessi: {r.dettagli.join(', ')}</p>
                  )}

                  {/* Da dove ha compilato e cosa ha premuto: una richiesta
                      senza il suo contesto è solo una data. */}
                  {(r.pagina || r.cta) && (
                    <p className="op-attivita muted">
                      Ha compilato da {r.pagina ?? 'pagina non registrata'}
                      {r.cta && ` · pulsante «${r.cta}»`}
                    </p>
                  )}

                  {(provenienzaRichiesta(r) || r.landing_page) && (
                    <p className="op-attivita muted">
                      Provenienza: {provenienzaRichiesta(r) || 'diretto'}
                      {primoContattoDi(r) && primoContattoDi(r) !== provenienzaRichiesta(r) && (
                        <> · primo contatto: {primoContattoDi(r)}</>
                      )}
                      {r.landing_page && (
                        <span title={r.landing_page}>
                          {' '}
                          · atterrato su {percorsoBreve(r.landing_page)}
                        </span>
                      )}
                    </p>
                  )}
                </div>

                <ContattiRapidi email={email} cellulare={cellulare} spiegaSeVuoto />

                <div className="op-gestione">
                  <p className="op-gestione-titolo">
                    {conInterruttore ? 'La richiesta' : "L'appuntamento"}
                  </p>
                  <p className="op-gestione-chi muted">
                    {r.assegnato_a
                      ? `In carico a ${nomeDiEmail(r.assegnato_a, nomiStaff)}`
                      : 'Non assegnato'}
                    {r.gestito &&
                      (r.esito_da || r.gestito_da) &&
                      ` · eseguito da ${nomeDiEmail((r.esito_da ?? r.gestito_da)!, nomiStaff)}`}
                  </p>

                  {conInterruttore ? (
                    <GestioneSemplice
                      id={r.id}
                      gestito={r.gestito}
                      nota={r.note}
                      gestitoDa={r.gestito_da ? nomeDiEmail(r.gestito_da, nomiStaff) : null}
                      gestitoIl={r.gestito_il}
                      notaDa={r.note_da ? nomeDiEmail(r.note_da, nomiStaff) : null}
                      notaIl={r.note_il}
                    />
                  ) : (
                    <GestioneEsito
                      origine="form_contatti"
                      id={r.id}
                      titolo={nome}
                      operatori={operatori}
                      puoCancellare={puoCancellare}
                      conOrario
                      dataCorrente={r.data_scelta}
                      oraCorrente={r.ora_scelta ? String(r.ora_scelta).slice(0, 5) : null}
                      chiusa={r.gestito}
                      esitoCorrente={
                        r.esito_tipo === 'eseguita' || r.esito_tipo === 'fallita'
                          ? (r.esito_tipo as Esito)
                          : null
                      }
                      notaCorrente={r.esito}
                      firma={r.esito_da ? nomeDiEmail(r.esito_da, nomiStaff) : null}
                      firmaIl={r.esito_il}
                      // Chiuso l'appuntamento, il passo dopo si fissa qui
                      // senza cambiare pagina: è la stessa proposta della
                      // dashboard.
                      seguito={{ entita: 'form_contatti', id: r.id }}
                    />
                  )}
                </div>

                {/* Com'è finita la trattativa. La telefonata che si sta
                    chiudendo è quasi sempre il momento in cui si sa anche
                    questo, e mandare a un'altra pagina per dirlo è il modo di
                    non dirlo. */}
                {trattativaAperta && (
                  <div className="op-gestione">
                    <ChiusuraTrattativa
                      t={trattativaAperta}
                      io={io}
                      sonoCommerciale={sonoCommerciale}
                      possoRiassegnare={possoRiassegnare}
                      nomiStaff={nomiStaff}
                    />
                  </div>
                )}

                {/* La sezione del responsabile resta raggiungibile: là c'è
                    l'elenco completo del canale, con i filtri. */}
                {canale && (
                  <Link
                    className="btn btn-ghost btn-sm"
                    href={`/dashboard/richieste/${canale.chiave}?richiesta=${r.id}`}
                  >
                    Apri in {canale.label}
                  </Link>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

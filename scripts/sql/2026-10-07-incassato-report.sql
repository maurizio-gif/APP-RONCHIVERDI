-- Report INCASSATO per la contabilità interna (pagina /dashboard/incassato).
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi, DOPO
-- 2026-10-07-transazioni-cassa.sql (serve la tabella `transazioni`).
--
-- Tre viste e il permesso della nuova sezione.
--
--   transazioni_dettaglio   un movimento per riga, già agganciato alla
--                           vendita e alla persona, con due etichette per
--                           riconciliare: `collegamento` (a cosa si riferisce
--                           il movimento) e `periodo_vendita` (rispetto al
--                           mese della vendita, di che incasso si tratta).
--   incassato_giornaliero   le stesse righe sommate per giorno, tipo di
--                           servizio, metodo, collegamento e periodo: la
--                           pagina ne ricava tutti i totali.
--   abbonamenti_incassato   una riga per vendita: venduto, incassato finora
--                           e differenza. Il confronto venduto/incassato.
--
-- Tutte security_invoker: come la tabella, non si leggono con la anon key.

-- ───────────────────────────────────────────────── transazioni_dettaglio

create or replace view public.transazioni_dettaglio
with (security_invoker = true) as
select
	t.id,
	t.source_movimento_id,
	t.data_operazione,
	-- Il giorno di calendario a Roma, non quello UTC: i movimenti serali
	-- finirebbero nel giorno dopo.
	(t.data_operazione at time zone 'Europe/Rome')::date as giorno,
	t.importo,
	t.tipo_servizio,
	t.descrizione_servizio,
	t.causale,
	t.metodo_pagamento,
	t.movimenta_cassa,
	t.source_movimento_storno_id,
	(t.source_movimento_storno_id is not null) as e_storno,
	t.operatore_nome,
	t.cassetto,
	t.cancellato_il,
	t.persona_id,
	t.source_utente_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	t.source_iscrizione_id,
	a.abbonamento,
	a.data_vendita,
	a.totale as vendita_totale,

	-- A cosa si riferisce il movimento:
	--   abbonamento        incasso su una vendita presente nel CRM
	--   eliminazione       il movimento negativo che Info4U crea quando un
	--                      operatore elimina una vendita (non ha vendita)
	--   vendita_eliminata  punta a una vendita che non c'è più (cancellata in
	--                      Info4U): i movimenti originali restano in cassa
	--   senza_abbonamento  nessuna vendita: cauzioni, tesseramenti,
	--                      prenotazioni, rimborsi, borsellino...
	case
		when t.causale ilike 'ABBONAMENTI: Elimina%' then 'eliminazione'
		when t.source_iscrizione_id is null then 'senza_abbonamento'
		when a.id is null or a.cancellato_il is not null then 'vendita_eliminata'
		else 'abbonamento'
	end as collegamento,

	-- Il mese del movimento rispetto al mese della vendita collegata. Serve a
	-- separare l'incasso "di competenza" (stesso mese) dai saldi e dalle rate
	-- di vendite precedenti, e dagli acconti di vendite successive.
	case
		when a.id is null or a.cancellato_il is not null then null
		when date_trunc('month', a.data_vendita at time zone 'Europe/Rome')
			= date_trunc('month', t.data_operazione at time zone 'Europe/Rome') then 'stesso_mese'
		when date_trunc('month', a.data_vendita at time zone 'Europe/Rome')
			< date_trunc('month', t.data_operazione at time zone 'Europe/Rome') then 'vendita_precedente'
		else 'vendita_successiva'
	end as periodo_vendita
from public.transazioni t
left join public.abbonamenti a on a.source_iscrizione_id = t.source_iscrizione_id
left join public.persone p on p.id = t.persona_id;

-- ───────────────────────────────────────────────── incassato_giornaliero

create or replace view public.incassato_giornaliero
with (security_invoker = true) as
select
	d.giorno,
	coalesce(d.tipo_servizio, '?') as tipo_servizio,
	coalesce(d.metodo_pagamento, 'Nessun metodo') as metodo_pagamento,
	d.movimenta_cassa,
	d.collegamento,
	d.periodo_vendita,
	count(*) as movimenti,
	coalesce(sum(d.importo) filter (where d.importo > 0), 0) as entrate,
	coalesce(sum(d.importo) filter (where d.importo < 0), 0) as uscite,
	coalesce(sum(d.importo), 0) as netto,
	count(*) filter (where d.e_storno) as storni
from public.transazioni_dettaglio d
where d.cancellato_il is null
  and d.data_operazione <= now()
group by d.giorno, d.tipo_servizio, d.metodo_pagamento, d.movimenta_cassa,
         d.collegamento, d.periodo_vendita;

comment on view public.incassato_giornaliero is
	'Movimenti di cassa di Info4U sommati per giorno (Roma), tipo_servizio, metodo, collegamento e periodo_vendita. entrate = importi positivi, uscite = negativi (storni, rimborsi, eliminazioni), netto = somma. Esclude movimenti cancellati e con data nel futuro.';

-- ───────────────────────────────────────────────── abbonamenti_incassato

create or replace view public.abbonamenti_incassato
with (security_invoker = true) as
select
	a.id,
	a.source_iscrizione_id,
	a.persona_id,
	p.nome as persona_nome,
	p.cognome as persona_cognome,
	a.abbonamento,
	a.variante,
	a.data_vendita,
	coalesce(a.totale, 0) as venduto,
	coalesce(i.incassato, 0) as incassato,
	coalesce(i.movimenti, 0) as movimenti,
	i.ultimo_incasso,
	coalesce(a.totale, 0) - coalesce(i.incassato, 0) as differenza
from public.abbonamenti a
left join public.persone p on p.id = a.persona_id
left join lateral (
	select sum(t.importo) as incassato,
	       count(*) as movimenti,
	       max(t.data_operazione) as ultimo_incasso
	from public.transazioni t
	where t.source_iscrizione_id = a.source_iscrizione_id
	  and t.cancellato_il is null
	  and t.data_operazione <= now()
) i on true
where a.cancellato_il is null;

comment on view public.abbonamenti_incassato is
	'Per ogni vendita: venduto (totale), incassato finora (somma dei movimenti collegati) e differenza. Le transazioni partono dal 2023-01-01: per vendite di fine 2022 l''incassato può essere parziale. Una vendita rateale risulta incassata in parte finché non sono pagate tutte le rate (il piano rate non è ancora nel CRM).';

-- ───────────────────────────────────────────────────── permesso sezione

-- Dati finanziari: la sezione non si dà a tutti. Parte da chi ha lanciato il
-- progetto; le altre persone della contabilità si abilitano da Gestione
-- utenti, spuntando «Incassato».
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'incassato')
where email = 'maurizio@ready2digital.it'
	and not ('incassato' = any (sezioni_consentite));

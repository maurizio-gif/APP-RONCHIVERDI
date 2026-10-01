-- La lista dietro il riquadro «Utenti attivi per gruppo, a oggi» della
-- pagina Abbonamenti: una riga per abbonamento in corso, con la persona.
--
-- Stessa definizione di «attivo» di abbonamenti_attivi_al (non cancellato,
-- con persona, iniziato e non scaduto, prodotto non «no abbonamento»): il
-- riquadro conta le persone distinte di questa vista, per gruppo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq).

create or replace view public.abbonamenti_attivi_oggi_dettaglio as
select
	a.id,
	a.persona_id,
	p.nome,
	p.cognome,
	p.email,
	p.cellulare,
	a.abbonamento,
	m.gruppo_id,
	a.data_inizio,
	a.data_fine,
	a.totale
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
left join public.persone p on p.id = a.persona_id
where a.cancellato_il is null
	and a.persona_id is not null
	and a.data_inizio is not null
	and a.data_inizio <= current_date
	and (a.data_fine is null or a.data_fine >= current_date)
	and coalesce(m.no_abbonamento, false) = false;

comment on view public.abbonamenti_attivi_oggi_dettaglio is
	'Abbonamenti attivi oggi, una riga per abbonamento con i dati della persona: la lista dettagliata di /dashboard/abbonamenti/attivi. Stessa definizione di abbonamenti_attivi_al.';

-- Contiene dati personali: solo la service role del pannello.
revoke all on public.abbonamenti_attivi_oggi_dettaglio from anon, authenticated;

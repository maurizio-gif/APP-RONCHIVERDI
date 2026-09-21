-- Quanti abbonati attivi ADESSO ha ogni prodotto non ancora categorizzato:
-- la pagina Gruppi prodotto elenca già tutti i prodotti da categorizzare
-- (spesso centinaia, molti storici — "ESTATE RAGAZZI 2007" non ha bisogno
-- di un gruppo con urgenza), ma non dice quali di quelli stanno pesando sul
-- numero "Non categorizzato" del riquadro Utenti attivi in questo momento.
-- Questa vista è quella priorità: solo i prodotti con almeno un abbonato
-- attivo oggi, con quanti.
--
-- Stessa identica definizione di "attivo" di abbonamenti_attivi_al (vedi
-- 2026-09-21-abbonamenti-no-abbonamento.sql): persone distinte, non
-- cancellato, non "no abbonamento", data_inizio <= oggi <= data_fine.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-no-abbonamento.sql.

create or replace view public.abbonamenti_prodotti_attivi_non_categorizzati as
select
	a.abbonamento as prodotto,
	count(distinct a.persona_id) as numero_attivi
from public.abbonamenti a
left join public.abbonamenti_mappatura m on m.prodotto = a.abbonamento
where a.cancellato_il is null
	and a.persona_id is not null
	and a.data_inizio is not null
	and a.data_inizio <= current_date
	and (a.data_fine is null or a.data_fine >= current_date)
	and m.gruppo_id is null
	and coalesce(m.no_abbonamento, false) = false
group by a.abbonamento;

comment on view public.abbonamenti_prodotti_attivi_non_categorizzati is
	'Prodotti senza gruppo assegnato che hanno almeno un abbonato attivo oggi, con quanti — la lista di priorità per /dashboard/abbonamenti/gruppi?solo=attivi: quali "Non categorizzato" del riquadro Utenti attivi vale la pena sistemare per primi.';

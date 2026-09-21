-- Un po' di contesto in più sui 383+ prodotti da categorizzare in
-- /dashboard/abbonamenti/gruppi: Info4U porta anche una "variante" per
-- vendita (es. VISITA MEDICA: "Compresa", "Agonistica"; TENNIS ORE VOLANTI
-- TESSERATI: "TENNIS TORNEO", "TENNIS ORE FISSE") già sincronizzata in
-- `abbonamenti.variante`, ma finora mai mostrata — solo il nome grezzo del
-- prodotto arrivava in questa vista. Le varianti viste per un prodotto sono
-- spesso l'indizio più rapido per capire cos'è davvero (un servizio? un
-- pacchetto?) e a che gruppo assegnarlo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-18-abbonamenti-gruppi.sql.

create or replace view public.abbonamenti_prodotti as
select
	a.abbonamento as prodotto,
	count(*) as numero_vendite,
	max(a.data_vendita) as ultima_vendita,
	-- Ordinate e senza null: una lista pulita da unire con ", " lato pagina,
	-- non un array grezzo da ripulire ogni volta che lo si legge.
	array_remove(array_agg(distinct a.variante order by a.variante), null) as varianti
from public.abbonamenti a
where a.abbonamento is not null
group by a.abbonamento;

comment on view public.abbonamenti_prodotti is
	'Un prodotto Info4U per riga: quante vendite, l''ultima, e le varianti distinte viste per quel prodotto (abbonamenti.variante) — usata dalla pagina di gestione gruppi per dare più contesto su cosa sia davvero un prodotto prima di assegnarlo.';

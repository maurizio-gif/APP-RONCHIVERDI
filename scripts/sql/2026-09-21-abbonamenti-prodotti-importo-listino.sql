-- Aggiunge l'importo di listino (l'ultimo praticato, dalla vendita più
-- recente di quel prodotto) alla vista abbonamenti_prodotti: aiuta chi
-- categorizza i prodotti in Gruppi prodotto a riconoscere di cosa si
-- tratta anche dal prezzo, non solo dal nome/dalle varianti.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-21-abbonamenti-prodotti-dettagli.sql.

create or replace view public.abbonamenti_prodotti as
select
	abbonamento as prodotto,
	count(*) as numero_vendite,
	max(data_vendita) as ultima_vendita,
	array_remove(array_agg(distinct variante order by variante), null::text) as varianti,
	(array_agg(importo_listino order by data_vendita desc))[1] as importo_listino_recente
from abbonamenti a
where abbonamento is not null
group by abbonamento;

comment on view public.abbonamenti_prodotti is
	'Un prodotto per riga, con quante volte è stato venduto, l''ultima vendita, le varianti Info4U viste e l''importo di listino praticato nella vendita più recente — usata dalla pagina Gruppi prodotto.';

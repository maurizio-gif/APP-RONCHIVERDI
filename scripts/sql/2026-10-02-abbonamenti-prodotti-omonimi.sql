-- Prodotti Info4U omonimi, e la categoria Info4U sulle vendite.
--
-- Il CRM riconosce un prodotto dal NOME (abbonamenti.abbonamento, ed è su
-- quel nome che abbonamenti_mappatura assegna gruppo e flag). Ma in Info4U
-- lo stesso nome può appartenere a prodotti diversi: «GOLD UNDER 17» sono due
-- (643, categoria 1.13-UNDER 17, attivo; 558, categoria 6-UNDER 17, chiuso
-- nel 2024), «CARNET 10 INGRESSI CON MAESTRO» esiste sia nel Tennis sia nel
-- Padel, «BABY» o «OPEN» sono sette corsi diversi. Fusi sotto un nome solo,
-- i conteggi non tornano con Info4U e un gruppo si prende il fatturato di un
-- altro settore (verifica delle discrepanze, ottobre 2026).
--
-- La sincronizzazione (ops/sync-info4u/sync-abbonamenti.ps1) da qui in poi:
--   - scrive la categoria Info4U in abbonamenti.categoria;
--   - quando un nome è condiviso da più prodotti Info4U, gli aggiunge la
--     categoria: «GOLD UNDER 17 (6-UNDER 17)». I prodotti col nome unico
--     restano come sono, quindi la mappatura esistente non cambia;
--   - a ogni giro chiama allinea_catalogo_info4u col catalogo intero, che
--     riallinea nome e categoria anche delle vendite vecchie (quelle che il
--     refresh delle vendite aperte non rilegge più).
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq) PRIMA di aggiornare lo script sul PC della
-- sincronizzazione.

alter table public.abbonamenti
	add column if not exists categoria text;

comment on column public.abbonamenti.categoria is
	'Categoria del prodotto in Info4U (dbo.AbbonamentiCategorie.Descrizione), scritta dalla sincronizzazione. Distingue i prodotti omonimi: vedi 2026-10-02-abbonamenti-prodotti-omonimi.sql.';

-- La funzione aggiorna per source_abbonamento_id, una volta per prodotto.
create index if not exists abbonamenti_source_abbonamento_idx
	on public.abbonamenti (source_abbonamento_id);

-- ─────────────────────────────────────────────── allineamento del catalogo

-- p_catalogo: [{ "id": 558, "nome": "GOLD UNDER 17 (6-UNDER 17)", "categoria": "6-UNDER 17" }, ...]
--
-- Per ogni prodotto: se le sue vendite portano ancora un nome diverso, prima
-- si copia la mappatura del vecchio nome sul nuovo (gruppo e flag), poi si
-- rinominano le vendite. Così un prodotto che si separa dal suo omonimo
-- resta nel gruppo in cui era, e lo si sposta poi da Gruppi prodotto se
-- appartiene a un altro. La mappatura del vecchio nome resta: serve ancora
-- all'omonimo che non cambia nome, o a niente (e allora è innocua).
create or replace function public.allinea_catalogo_info4u(p_catalogo jsonb)
returns integer
language plpgsql
as $$
declare
	v_prodotto record;
	v_righe integer;
	v_totale integer := 0;
begin
	for v_prodotto in
		select (x->>'id')::int as id, nullif(trim(x->>'nome'), '') as nome, nullif(trim(x->>'categoria'), '') as categoria
		from jsonb_array_elements(p_catalogo) x
	loop
		continue when v_prodotto.id is null or v_prodotto.nome is null;

		insert into public.abbonamenti_mappatura (prodotto, gruppo_id, no_abbonamento, aggiornato_il)
		select v_prodotto.nome, m.gruppo_id, m.no_abbonamento, now()
		from (
			select distinct a.abbonamento
			from public.abbonamenti a
			where a.source_abbonamento_id = v_prodotto.id
				and a.abbonamento is distinct from v_prodotto.nome
		) vecchi
		join public.abbonamenti_mappatura m on m.prodotto = vecchi.abbonamento
		limit 1
		on conflict (prodotto) do nothing;

		update public.abbonamenti a
		set abbonamento = v_prodotto.nome,
			categoria = v_prodotto.categoria
		where a.source_abbonamento_id = v_prodotto.id
			and (a.abbonamento is distinct from v_prodotto.nome
				or a.categoria is distinct from v_prodotto.categoria);
		get diagnostics v_righe = row_count;
		v_totale := v_totale + v_righe;
	end loop;
	return v_totale;
end;
$$;

comment on function public.allinea_catalogo_info4u(jsonb) is
	'Riallinea nome (con la categoria aggiunta ai prodotti omonimi) e categoria Info4U di tutte le vendite di ogni prodotto del catalogo passato, copiando la mappatura del vecchio nome sul nuovo. Chiamata dalla sincronizzazione Info4U a ogni giro; restituisce quante vendite ha cambiato.';

revoke all on function public.allinea_catalogo_info4u(jsonb) from public, anon, authenticated;

-- ────────────────────────────────────── prodotti: categoria e importi veri

-- Gruppi prodotto mostrava solo il prezzo di LISTINO dell'ultima vendita,
-- che in Info4U è 0 su molti prodotti pagati davvero (Welfare, Gold Under 13
-- Family, Quota iscrizione abbonamenti…): da lì «presente a costo zero» e
-- «mancano gli importi». Si aggiungono quanto è stato incassato e il prezzo
-- medio delle vendite non a zero. Colonne nuove in coda: la vista resta
-- compatibile con chi la legge già.
create or replace view public.abbonamenti_prodotti as
select
	a.abbonamento as prodotto,
	count(*) as numero_vendite,
	max(a.data_vendita) as ultima_vendita,
	array_remove(array_agg(distinct a.variante order by a.variante), null::text) as varianti,
	(array_agg(a.importo_listino order by a.data_vendita desc))[1] as importo_listino_recente,
	(array_agg(a.categoria order by a.data_vendita desc))[1] as categoria,
	coalesce(sum(a.totale) filter (where a.cancellato_il is null), 0) as fatturato,
	round(avg(a.totale) filter (where a.cancellato_il is null and a.totale > 0), 2) as prezzo_medio
from public.abbonamenti a
where a.abbonamento is not null
group by a.abbonamento;

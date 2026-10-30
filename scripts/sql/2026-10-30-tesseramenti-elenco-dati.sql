-- Tesseramenti CSI, due cambi:
--
-- 1. Il tennis (Young School Tennis) non si tessera: i suoi prodotti escono da
--    tesseramenti_csi_prodotti (attivo = false), quindi non compaiono più negli
--    elenchi e il tesseramento automatico non li considera. Sono i prodotti del
--    gruppo «YS TENNIS» più le quote di preiscrizione dei corsi (che non hanno
--    gruppo ma nel nome portano «Y.S. TENNIS»). Rieseguire
--    2026-10-29-tesseramento-csi-prodotti.sql non li riattiva (ha la stessa
--    esclusione).
--
-- 2. tesseramenti_elenco restituisce anche i dati che CSI vuole (luogo di
--    nascita come lo manda la function, sesso) e l'elenco di quelli mancanti,
--    così nella pagina si vede subito cosa manca a ciascuno. Cambia il tipo
--    restituito: la funzione va ricreata.
--
-- Si può rieseguire senza danni.

update public.tesseramenti_csi_prodotti pr
set attivo = false, aggiornato_il = now()
where pr.attivo
	and (
		exists (
			select 1
			from public.abbonamenti_mappatura m
			join public.abbonamenti_gruppi g on g.id = m.gruppo_id
			where m.prodotto = pr.prodotto and g.nome = 'YS TENNIS'
		)
		or pr.prodotto ilike '%Y.S. TENNIS%'
	);

drop function if exists public.tesseramenti_elenco();

create function public.tesseramenti_elenco()
returns table (
	categoria text,
	persona_id uuid,
	cognome text,
	nome text,
	codice_fiscale text,
	data_nascita date,
	email text,
	cellulare text,
	abbonamento text,
	data_inizio date,
	data_fine date,
	tessera text,
	tessera_tipo text,
	tessera_rilascio date,
	tessera_scadenza date,
	motivo_tipo text,
	motivo text,
	riga_id uuid,
	tentativi integer,
	ultimo_tentativo_il timestamptz,
	luogo_nascita text,
	sesso text,
	mancanti text[]
)
language sql
stable
security definer
set search_path = public
as $$
	with ab as (
		select distinct on (d.persona_id) d.persona_id, d.abbonamento, d.data_inizio, d.data_fine
		from public.abbonamenti_attivi_oggi_dettaglio d
		join public.tesseramenti_csi_prodotti pr on pr.prodotto = d.abbonamento and pr.attivo
		order by d.persona_id, d.data_fine desc nulls first
	),
	-- L'ultimo esito dell'invio a CSI per persona.
	invio as (
		select distinct on (t.persona_id) t.persona_id, t.id, t.stato, t.motivo_tipo, t.motivo, t.tentativi, t.ultimo_tentativo_il
		from public.tesseramenti_csi t
		order by t.persona_id, t.stagione desc, t.aggiornato_il desc
	),
	base as (
		select p.id as persona_id, p.cognome, p.nome, p.codice_fiscale, p.data_nascita, p.email, p.cellulare,
			p.sesso,
			-- Il luogo come lo manda la edge function tesseramento-csi: il comune,
			-- o lo stato per chi è nato all'estero.
			trim(case
				when (upper(trim(coalesce(p.provincia_nascita, ''))) = 'EE'
					or (trim(coalesce(p.stato_nascita, '')) <> '' and lower(trim(p.stato_nascita)) <> 'italia'))
					and trim(coalesce(p.stato_nascita, '')) <> ''
				then p.stato_nascita else coalesce(p.luogo_nascita, '') end) as luogo_csi,
			ab.abbonamento, ab.data_inizio, ab.data_fine,
			ta.tessera, ta.tipotess as tessera_tipo, ta.rilascio as tessera_rilascio, ta.scadenza as tessera_scadenza,
			i.id as riga_id, i.stato as invio_stato, i.motivo_tipo, i.motivo, i.tentativi, i.ultimo_tentativo_il
		from public.persone p
		left join ab on ab.persona_id = p.id
		left join public.tessere_csi_attive ta on ta.persona_id = p.id
		left join invio i on i.persona_id = p.id
		where ta.persona_id is not null or ab.persona_id is not null
	),
	-- I dati che CSI vuole (stessa regola della edge function tesseramento-csi).
	con_mancanti as (
		select b.*,
			array_remove(array[
				case when length(trim(coalesce(b.cognome, ''))) < 2 then 'cognome' end,
				case when length(trim(coalesce(b.nome, ''))) < 2 then 'nome' end,
				case when b.data_nascita is null then 'data di nascita'
					when b.data_nascita > current_date then 'data di nascita (è nel futuro)' end,
				case when length(b.luogo_csi) < 2 then 'luogo di nascita' end,
				case when upper(trim(coalesce(b.sesso, ''))) not in ('M', 'F') then 'sesso' end
			], null) as mancanti
		from base b
	)
	select
		case
			when b.tessera is not null then 'tesserato'
			when b.invio_stato = 'non_tesserato' and b.motivo_tipo is distinct from 'dati_mancanti' then 'in_errore'
			when cardinality(b.mancanti) > 0 then 'non_tesserabile'
			else 'da_tesserare'
		end as categoria,
		b.persona_id, b.cognome, b.nome, b.codice_fiscale, b.data_nascita, b.email, b.cellulare,
		b.abbonamento, b.data_inizio, b.data_fine,
		b.tessera, b.tessera_tipo, b.tessera_rilascio, b.tessera_scadenza,
		case
			when b.tessera is not null then null
			when b.invio_stato = 'non_tesserato' and b.motivo_tipo is distinct from 'dati_mancanti' then b.motivo_tipo
			when cardinality(b.mancanti) > 0 then 'dati_mancanti'
		end as motivo_tipo,
		case
			when b.tessera is not null then null
			when b.invio_stato = 'non_tesserato' and b.motivo_tipo is distinct from 'dati_mancanti' then b.motivo
			when cardinality(b.mancanti) > 0 then 'Dati mancanti: ' || array_to_string(b.mancanti, ', ') || '.'
		end as motivo,
		b.riga_id, coalesce(b.tentativi, 0), b.ultimo_tentativo_il,
		nullif(b.luogo_csi, '') as luogo_nascita, nullif(upper(trim(b.sesso)), '') as sesso, b.mancanti
	from con_mancanti b
	order by b.cognome, b.nome, b.persona_id;
$$;

revoke all on function public.tesseramenti_elenco() from public, anon, authenticated;
grant execute on function public.tesseramenti_elenco() to service_role;

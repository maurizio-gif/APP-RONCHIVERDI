-- L'elenco dinamico di Tesseramenti: una riga per persona, calcolata ogni volta
-- da quello che c'è adesso, non dalla coda del tesseramento automatico.
--
-- Quattro categorie, in quest'ordine di precedenza:
--
-- 1. tesserato: ha una tessera CSI in corso di validità (tessere_csi_attive),
--    anche senza un abbonamento;
-- 2. in_errore: non ha tessera e l'ultimo invio a CSI è andato male
--    (tesseramenti_csi non_tesserato per un motivo che non sono i dati
--    mancanti), con il motivo;
-- 3. non_tesserabile: ha un abbonamento reale in corso di un prodotto con
--    tessera ma in anagrafica manca un dato che CSI vuole (cognome, nome, data
--    di nascita, luogo di nascita, sesso);
-- 4. da_tesserare: ha un abbonamento reale in corso di un prodotto con
--    tessera, i dati ci sono e la tessera non c'è.
--
-- «Abbonamento reale» è quello del report abbonamenti (vista
-- abbonamenti_attivi_oggi_dettaglio); i prodotti con tessera sono quelli di
-- tesseramenti_csi_prodotti. Per ogni persona si prende l'abbonamento che
-- finisce più tardi. Si può rieseguire senza danni.

create or replace function public.tesseramenti_elenco()
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
	ultimo_tentativo_il timestamptz
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
			ab.abbonamento, ab.data_inizio, ab.data_fine,
			ta.tessera, ta.tipotess as tessera_tipo, ta.rilascio as tessera_rilascio, ta.scadenza as tessera_scadenza,
			i.id as riga_id, i.stato as invio_stato, i.motivo_tipo, i.motivo, i.tentativi, i.ultimo_tentativo_il,
			-- I dati che CSI vuole (stessa regola della edge function
			-- tesseramento-csi): il luogo è il comune, o lo stato per chi è nato
			-- all'estero.
			array_remove(array[
				case when length(trim(coalesce(p.cognome, ''))) < 2 then 'cognome' end,
				case when length(trim(coalesce(p.nome, ''))) < 2 then 'nome' end,
				case when p.data_nascita is null then 'data di nascita' end,
				case when length(trim(case
					when (upper(trim(coalesce(p.provincia_nascita, ''))) = 'EE'
						or (trim(coalesce(p.stato_nascita, '')) <> '' and lower(trim(p.stato_nascita)) <> 'italia'))
						and trim(coalesce(p.stato_nascita, '')) <> ''
					then p.stato_nascita else coalesce(p.luogo_nascita, '') end)) < 2 then 'luogo di nascita' end,
				case when upper(trim(coalesce(p.sesso, ''))) not in ('M', 'F') then 'sesso' end
			], null) as mancanti
		from public.persone p
		left join ab on ab.persona_id = p.id
		left join public.tessere_csi_attive ta on ta.persona_id = p.id
		left join invio i on i.persona_id = p.id
		where ta.persona_id is not null or ab.persona_id is not null
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
		b.riga_id, coalesce(b.tentativi, 0), b.ultimo_tentativo_il
	from base b
	order by b.cognome, b.nome, b.persona_id;
$$;

revoke all on function public.tesseramenti_elenco() from public, anon, authenticated;
grant execute on function public.tesseramenti_elenco() to service_role;

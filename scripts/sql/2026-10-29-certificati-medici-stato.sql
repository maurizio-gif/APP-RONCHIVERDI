-- Lo stato dei certificati medici di chi ha un abbonamento in corso.
--
-- La pagina Certificati medici legge da qui: una riga per persona con un
-- abbonamento reale in corso (la stessa definizione del report abbonamenti,
-- vista abbonamenti_attivi_oggi_dettaglio, qualunque sia il prodotto),
-- calcolata ogni volta su certificati e abbonamenti. Non c'entra l'IVA.
--
-- Cinque categorie, in quest'ordine:
--
-- 1. valido: ha un certificato che scade oltre i prossimi `p_giorni` giorni;
-- 2. in_scadenza: ha un certificato valido ma scade entro `p_giorni` giorni
--    (30 di default), oggi compreso;
-- 3. scaduto: ha avuto certificati, ma nessuno è più valido;
-- 4. solo_provvisorio: non ha nessun certificato vero, solo righe
--    «provvisorio» o visite prenotate (non sono certificati: la stessa regola
--    del filtro Certificato dei Contatti, vedi 2026-10-29-contatti-filtri.sql);
-- 5. mai_avuto: nessuna riga di certificato.
--
-- Per ogni persona l'ultimo certificato vero (scadenza più lontana) e, se non
-- ne ha, l'ultima riga provvisoria. Il giorno è quello di Roma. Si può
-- rieseguire senza danni.

create or replace function public.certificati_stato(p_giorni integer default 30)
returns table (
	categoria text,
	persona_id uuid,
	cognome text,
	nome text,
	codice_fiscale text,
	email text,
	cellulare text,
	abbonamento text,
	data_inizio date,
	data_fine date,
	certificato text,
	emissione date,
	scadenza date,
	giorni_alla_scadenza integer,
	provvisorio boolean
)
language sql
stable
security definer
set search_path = public
as $$
	with oggi as (select (now() at time zone 'Europe/Rome')::date as d),
	ab as (
		select distinct on (d.persona_id) d.persona_id, d.abbonamento, d.data_inizio, d.data_fine
		from public.abbonamenti_attivi_oggi_dettaglio d
		order by d.persona_id, d.data_fine desc nulls first
	),
	base as (
		select ab.persona_id, ab.abbonamento, ab.data_inizio, ab.data_fine,
			cv.descrizione as def_desc, cv.data_emissione as def_em, cv.data_scadenza as def_sc,
			cp.descrizione as prov_desc, cp.data_emissione as prov_em, cp.data_scadenza as prov_sc,
			(select count(*) from public.certificati x where x.persona_id = ab.persona_id) as n
		from ab
		left join lateral (
			select c.descrizione, c.data_emissione, c.data_scadenza
			from public.certificati c
			where c.persona_id = ab.persona_id and c.data_scadenza is not null and coalesce(c.descrizione, '') !~* 'provvisorio'
			order by c.data_scadenza desc, c.data_emissione desc nulls last
			limit 1
		) cv on true
		left join lateral (
			select c.descrizione, c.data_emissione, c.data_scadenza
			from public.certificati c
			where c.persona_id = ab.persona_id and coalesce(c.descrizione, '') ~* 'provvisorio'
			order by c.data_scadenza desc nulls last, c.data_emissione desc nulls last
			limit 1
		) cp on true
	)
	select
		case
			when b.def_sc is not null and b.def_sc > o.d + p_giorni then 'valido'
			when b.def_sc is not null and b.def_sc >= o.d then 'in_scadenza'
			when b.def_sc is not null then 'scaduto'
			when b.n > 0 then 'solo_provvisorio'
			else 'mai_avuto'
		end as categoria,
		p.id, p.cognome, p.nome, p.codice_fiscale, p.email, p.cellulare,
		b.abbonamento, b.data_inizio, b.data_fine,
		coalesce(b.def_desc, b.prov_desc),
		case when b.def_sc is not null then b.def_em else b.prov_em end,
		case when b.def_sc is not null then b.def_sc else b.prov_sc end,
		(case when b.def_sc is not null then b.def_sc else b.prov_sc end - o.d)::integer,
		b.def_sc is null and b.n > 0
	from base b
	join public.persone p on p.id = b.persona_id
	cross join oggi o
	order by p.cognome, p.nome, p.id;
$$;

revoke all on function public.certificati_stato(integer) from public, anon, authenticated;
grant execute on function public.certificati_stato(integer) to service_role;

-- La pagina sta in Segreteria: la ricevono chi ha già Abbonamenti o è operatore
-- di segreteria.
update public.staff_users
set sezioni_consentite = array_append(sezioni_consentite, 'certificati')
where (operatore_segreteria or 'abbonamenti' = any (sezioni_consentite))
	and not ('certificati' = any (sezioni_consentite));

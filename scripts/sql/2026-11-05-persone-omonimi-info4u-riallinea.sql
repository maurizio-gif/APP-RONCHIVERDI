-- Omonimi Info4U: righe agganciate alla scheda di un'altra persona.
--
-- Il problema (visto su Sassi Stefano: certificato agonistico valido su
-- Info4U, «Mai avuto» nella pagina Certificati medici). Quando la sync
-- incontrava un IDUtente nuovo, trova_o_crea_persona cercava per nome e
-- cognome; se trovava la scheda Info4U di un OMONIMO (un altro IDUtente),
-- sync-abbonamenti.ps1 ci scriveva sopra tutto il corpo, source_utente_id
-- compreso. La scheda passava all'utente nuovo; alla vendita successiva
-- dell'utente originale nasceva una scheda nuova, e le vendite tornavano a
-- lui (la sync scrive persona_id esplicitamente), ma certificati, email,
-- ricevute, prenotazioni... restavano sulla scheda vecchia: i trigger
-- riempiono persona_id solo quando è vuoto. L'import delle persone senza
-- acquisti (dal 27/10) l'ha fatto succedere a centinaia di schede.
--
-- La sync è corretta in sync-abbonamenti.ps1 (Send-PersonaUpsert: una scheda
-- con un altro IDUtente non si sovrascrive mai, si crea una scheda separata
-- segnalata come possibile doppione). Qui:
--
-- 1. il trigger su persone (2026-10-27-persone-collega-dati-info4u.sql)
--    collega le righe dell'IDUtente alla sua scheda anche se erano su
--    un'altra, e copre anche abbonamenti, modifiche e transazioni;
-- 2. info4u_riallinea_persone() fa lo stesso a posteriori;
-- 3. info4u_utenti_senza_scheda() elenca gli IDUtente che hanno righe ma non
--    più una scheda: la loro è stata presa da un omonimo. Si sistemano con
--    .\sync-abbonamenti.ps1 -RiparaOmonimi, che li rilegge da Info4U e crea
--    le schede (il trigger del punto 1 ci sposta le righe).
--
-- La chiave è sempre source_utente_id: una riga Info4U appartiene alla scheda
-- con lo stesso IDUtente, per definizione. Si può rieseguire senza danni.

-- ───────────────────────────────────────────── 1. trigger su persone

create or replace function public.info4u_collega_persona_nuova()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	t text;
begin
	if new.source_utente_id is null then
		return new;
	end if;

	foreach t in array array[
		'abbonamenti', 'abbonamenti_modifiche', 'transazioni',
		'crm_pratiche', 'crm_memo', 'email_info4u', 'certificati', 'quote_associative',
		'prenotazioni_iscrizioni', 'corsi_iscrizioni', 'omaggi_iscrizioni', 'ricevute'
	] loop
		execute format(
			'update public.%I set persona_id = $1
			 where source_utente_id = $2 and persona_id is distinct from $1', t)
		using new.id, new.source_utente_id;
	end loop;
	return new;
end;
$$;

drop trigger if exists persone_collega_info4u on public.persone;
create trigger persone_collega_info4u
	after insert or update of source_utente_id on public.persone
	for each row execute function public.info4u_collega_persona_nuova();

-- ───────────────────────────────────────────── 2. riallineamento

-- Ogni riga Info4U sulla scheda del suo IDUtente: riempie persona_id vuoti
-- e sposta quelli agganciati a un'altra scheda. Restituisce quante righe ha
-- sistemato per tabella.
create or replace function public.info4u_riallinea_persone()
returns table (tabella text, righe bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
	t text;
	n bigint;
begin
	foreach t in array array[
		'abbonamenti', 'abbonamenti_modifiche', 'transazioni',
		'crm_pratiche', 'crm_memo', 'email_info4u', 'certificati', 'quote_associative',
		'prenotazioni_iscrizioni', 'corsi_iscrizioni', 'omaggi_iscrizioni', 'ricevute'
	] loop
		execute format(
			'update public.%I x set persona_id = p.id
			 from public.persone p
			 where x.source_utente_id = p.source_utente_id
			   and x.persona_id is distinct from p.id', t);
		get diagnostics n = row_count;
		tabella := t;
		righe := n;
		return next;
	end loop;
end;
$$;

revoke all on function public.info4u_riallinea_persone() from public, anon, authenticated;
grant execute on function public.info4u_riallinea_persone() to service_role;

-- ───────────────────────────────────────────── 3. IDUtente senza scheda

-- Gli IDUtente che hanno righe agganciate alla scheda di un ALTRO IDUtente e
-- nessuna scheda propria. Li usa sync-abbonamenti.ps1 -RiparaOmonimi.
create or replace function public.info4u_utenti_senza_scheda()
returns table (source_utente_id integer, persona_id uuid)
language sql
stable
security definer
set search_path = public
as $$
	with righe as (
		select x.persona_id, x.source_utente_id from public.abbonamenti x
		union select x.persona_id, x.source_utente_id from public.abbonamenti_modifiche x
		union select x.persona_id, x.source_utente_id from public.transazioni x
		union select x.persona_id, x.source_utente_id from public.crm_pratiche x
		union select x.persona_id, x.source_utente_id from public.crm_memo x
		union select x.persona_id, x.source_utente_id from public.email_info4u x
		union select x.persona_id, x.source_utente_id from public.certificati x
		union select x.persona_id, x.source_utente_id from public.quote_associative x
		union select x.persona_id, x.source_utente_id from public.prenotazioni_iscrizioni x
		union select x.persona_id, x.source_utente_id from public.corsi_iscrizioni x
		union select x.persona_id, x.source_utente_id from public.omaggi_iscrizioni x
		union select x.persona_id, x.source_utente_id from public.ricevute x
	)
	select distinct on (r.source_utente_id) r.source_utente_id::integer, r.persona_id
	from righe r
	join public.persone p on p.id = r.persona_id
	where r.source_utente_id is not null
		and p.source_utente_id is not null
		and p.source_utente_id <> r.source_utente_id
		and not exists (select 1 from public.persone q where q.source_utente_id = r.source_utente_id)
	order by r.source_utente_id, r.persona_id;
$$;

revoke all on function public.info4u_utenti_senza_scheda() from public, anon, authenticated;
grant execute on function public.info4u_utenti_senza_scheda() to service_role;

-- Una tantum: sposta sulla scheda giusta le righe il cui IDUtente ha già una
-- scheda propria (come Sassi Stefano).
select * from public.info4u_riallinea_persone();

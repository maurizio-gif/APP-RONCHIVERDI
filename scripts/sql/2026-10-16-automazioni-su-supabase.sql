-- Le automazioni sul database girano da Supabase, non da Vercel.
--
-- Prima c'erano due modi: i job pg_cron in SQL (snapshot mensile, lead delle
-- scadenze, incassi per competenza, trattative di recupero) e i cron di
-- Vercel che chiamavano una route Next.js. Da qui in poi tutto quello che
-- legge e scrive il database parte da pg_cron:
--
-- - se basta SQL, il job chiama direttamente la funzione
--   (trattative-inattive → chiudi_trattative_inattive);
-- - se serve altro (un'email, un servizio esterno), il job chiama una edge
--   function via pg_net (voucher-automatico).
--
-- Su Vercel resta solo il resoconto direzionale serale, da spostare in un
-- secondo momento.
--
-- Autenticazione delle edge function chiamate da pg_cron: un token casuale
-- nel Vault (`cron_token`), mandato nell'header x-cron-token e confrontato
-- dalla function con verifica_token_cron(). Non lo si copia da nessuna parte:
-- nasce qui e lo leggono solo il database e chi ha la service role key.

create extension if not exists pg_net;

do $$
begin
	if not exists (select 1 from vault.secrets where name = 'cron_token') then
		perform vault.create_secret(
			replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
			'cron_token',
			'Token con cui pg_cron chiama le edge function (header x-cron-token).'
		);
	end if;
	-- L'indirizzo del progetto sta nel Vault e non nel testo dei job: un
	-- progetto di prova lo cambia qui, senza riscrivere le schedulazioni.
	if not exists (select 1 from vault.secrets where name = 'project_url') then
		perform vault.create_secret(
			'https://upoiasekisojikbzsymq.supabase.co',
			'project_url',
			'Indirizzo del progetto, per le chiamate di pg_cron alle edge function.'
		);
	end if;
end $$;

-- La edge function chiede al database se il token è quello giusto: così il
-- segreto non deve esistere anche fra i secrets della function.
create or replace function public.verifica_token_cron(p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(p_token, '') <> ''
	   and exists (
		select 1 from vault.decrypted_secrets
		 where name = 'cron_token' and decrypted_secret = p_token
	   )
$$;

revoke all on function public.verifica_token_cron(text) from public, anon, authenticated;
grant execute on function public.verifica_token_cron(text) to service_role;

-- La chiamata di pg_cron a una edge function. Asincrona: pg_net mette in
-- coda la richiesta e l'esito finisce in net._http_response (tenuto qualche
-- ora), che è il primo posto dove guardare se un giro non è partito.
create or replace function public.chiama_edge_function(p_nome text, p_query text default '')
returns bigint
language sql
security definer
set search_path = ''
as $$
	select net.http_post(
		url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
			|| '/functions/v1/' || p_nome || p_query,
		headers := jsonb_build_object(
			'Content-Type', 'application/json',
			'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_token')
		),
		body := '{}'::jsonb,
		timeout_milliseconds := 120000
	)
$$;

revoke all on function public.chiama_edge_function(text, text) from public, anon, authenticated;

-- Trattative inattive: ogni giorno alle 03:00 UTC, come faceva il cron di
-- Vercel. La regola è tutta in chiudi_trattative_inattive
-- (2026-10-14-trattative-inattive-perse.sql).
select cron.schedule(
	'trattative-inattive',
	'0 3 * * *',
	$$select public.chiudi_trattative_inattive(14)$$
);

-- Voucher automatico "(cer000)": ogni 15 minuti, ma la edge function viene
-- chiamata solo se l'interruttore in `automazioni` è acceso. A interruttore
-- spento non parte nessuna richiesta; la function lo ricontrolla comunque.
select cron.schedule(
	'voucher-automatico',
	'*/15 * * * *',
	$$select public.chiama_edge_function('voucher-automatico')
	   where exists (select 1 from public.automazioni where chiave = 'voucher_cer000' and attiva)$$
);

-- Verifica
select jobname, schedule, active from cron.job order by jobid;

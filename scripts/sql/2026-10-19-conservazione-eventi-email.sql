-- Conservazione degli esiti delle email: 24 mesi dall'invio.
--
-- È il termine dichiarato nell'informativa privacy del sito (sezione
-- «Tracciamento delle email», www.ronchiverdi.it/privacy#email) per
-- consegna, apertura e clic delle email del voucher. Ogni notte si
-- cancellano gli eventi di SendGrid (`email_eventi`, vedi
-- 2026-10-16-tracking-email.sql) delle email partite da più di 24 mesi.
--
-- Il termine si conta dall'invio dell'email, non dall'evento: un'apertura
-- arrivata un anno dopo l'invio se ne va insieme alle altre dello stesso
-- messaggio. Un evento senza email registrata (inviata prima del registro,
-- o da fuori dal CRM) usa la propria data.
--
-- Il registro degli invii (`email_inviate`, con testo e impronta) resta:
-- è la prova che la comunicazione è partita, non un dato di tracciamento.
-- La vista email_inviate_esiti mostrerà quelle email senza aperture né clic.

create or replace function public.cancella_eventi_email_scaduti(p_mesi integer default 24)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	cancellati integer;
begin
	delete from public.email_eventi x
	 where coalesce(
	         (select min(m.inviata_il) from public.email_inviate m where m.provider_message_id = x.provider_message_id),
	         x.momento
	       ) < now() - make_interval(months => p_mesi);
	get diagnostics cancellati = row_count;
	return cancellati;
end
$$;

revoke all on function public.cancella_eventi_email_scaduti(integer) from public, anon, authenticated;
grant execute on function public.cancella_eventi_email_scaduti(integer) to service_role;

-- Ogni notte alle 03:20 UTC, dopo le trattative inattive delle 03:00.
select cron.unschedule(jobid) from cron.job where jobname = 'cancella-eventi-email-scaduti';
select cron.schedule(
	'cancella-eventi-email-scaduti',
	'20 3 * * *',
	$$select public.cancella_eventi_email_scaduti(24)$$
);

-- Verifica
select jobname, schedule, active from cron.job where jobname = 'cancella-eventi-email-scaduti';

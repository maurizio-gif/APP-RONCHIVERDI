-- Lo storico di un appuntamento preso dal sito: ogni spostamento e
-- l'annullamento, con prima/dopo, quando e chi.
--
-- Fino a ottobre 2026 spostare un appuntamento (dal link nell'email, o
-- «Riprogrammata» nel CRM) sovrascriveva data_scelta e ora_scelta, e
-- annullarlo scriveva solo appuntamento_annullato_il: di com'era all'inizio, e
-- di quante volte era cambiato, non restava niente. Una cliente che apre la
-- pagina di gestione otto volte in cinque giorni (successo davvero) non
-- lasciava nessuna traccia di cosa avesse fatto.
--
-- Il registro lo tiene il database, con un trigger, e non chi scrive: le
-- strade che cambiano un appuntamento sono due — il sito
-- (src/pages/api/appuntamento.ts) e il CRM (riprogrammaVoce) — e una regola
-- scritta due volte prima o poi diverge. Chi ha fatto la modifica invece lo
-- sa solo chi scrive: lo passa in appuntamento_modificato_da nello stesso
-- update ('cliente' dal sito, l'email dell'operatore dal CRM). Il trigger lo
-- legge e lo azzera, così non resta attaccato alla riga per la modifica dopo.
--
-- Una voce per cambio, in ordine:
--   { "azione": "spostato" | "fissato" | "annullato",
--     "il": istante, "chi": 'cliente' | email | null,
--     "da": { "data", "ora" }, "a": { "data", "ora" } }   -- "a" solo se spostato/fissato
-- «fissato» è il primo giorno dato a una richiesta che non ne aveva (un
-- «Richiamami» riprogrammato a un giorno preciso).
--
-- Le righe esistenti partono con lo storico vuoto: quello che è successo
-- prima non è ricostruibile.

alter table public.form_contatti
	add column if not exists storico_appuntamento jsonb not null default '[]'::jsonb;

alter table public.form_contatti
	add column if not exists appuntamento_modificato_da text;

comment on column public.form_contatti.storico_appuntamento is
	'Spostamenti e annullamento dell''appuntamento, uno per voce, scritti dal trigger form_contatti_storico_appuntamento. Vedi scripts/sql/2026-10-15-storico-appuntamento.sql.';
comment on column public.form_contatti.appuntamento_modificato_da is
	'Chi sta spostando o annullando l''appuntamento in questo update (''cliente'' o l''email dell''operatore): lo legge e lo azzera il trigger form_contatti_storico_appuntamento. Non si legge da qui.';

create or replace function public.registra_storico_appuntamento()
returns trigger
language plpgsql
as $$
declare
	v_voce jsonb;
begin
	if new.appuntamento_annullato_il is not null and old.appuntamento_annullato_il is null then
		v_voce := jsonb_build_object(
			'azione', 'annullato',
			'il', now(),
			'chi', new.appuntamento_modificato_da,
			'da', jsonb_build_object('data', old.data_scelta, 'ora', old.ora_scelta)
		);
	elsif new.data_scelta is distinct from old.data_scelta
		or new.ora_scelta is distinct from old.ora_scelta then
		v_voce := jsonb_build_object(
			'azione', case when old.data_scelta is null then 'fissato' else 'spostato' end,
			'il', now(),
			'chi', new.appuntamento_modificato_da,
			'da', jsonb_build_object('data', old.data_scelta, 'ora', old.ora_scelta),
			'a', jsonb_build_object('data', new.data_scelta, 'ora', new.ora_scelta)
		);
	end if;

	if v_voce is not null then
		new.storico_appuntamento := coalesce(old.storico_appuntamento, '[]'::jsonb) || jsonb_build_array(v_voce);
	end if;
	-- Letto, si azzera: la prossima modifica deve dire da sé chi la fa.
	new.appuntamento_modificato_da := null;
	return new;
end;
$$;

drop trigger if exists form_contatti_storico_appuntamento on public.form_contatti;
create trigger form_contatti_storico_appuntamento
	before update of data_scelta, ora_scelta, appuntamento_annullato_il
	on public.form_contatti
	for each row
	execute function public.registra_storico_appuntamento();

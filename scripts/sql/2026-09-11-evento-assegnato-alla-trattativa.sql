-- L'evento arrivato dal sito prende l'assegnatario della trattativa, e resta
-- distinto da chi poi lo esegue.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-10-evento-apre-trattativa.sql.
--
-- Va eseguita PRIMA del deploy: il pannello legge `form_contatti.assegnato_a`
-- per dire di chi è ogni riga nella sezione «Eventi scaduti o da gestire
-- oggi», e senza la colonna quella lettura fallisce e l'elenco resta vuoto.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Un appuntamento prenotato dal sito è una voce d'agenda per conto suo (vedi
-- voceDaContatto in lib/agenda.ts) e finora non aveva **nessun** assegnatario:
-- la colonna non esisteva, e il pannello lo mostrava come «Dal sito». Ma
-- quella richiesta ha aperto una trattativa, e appena qualcuno si prende la
-- trattativa si è preso anche l'appuntamento — è la stessa telefonata. Senza
-- scriverlo, in dashboard restava una riga di nessuno accanto a una trattativa
-- che qualcuno stava già seguendo: o ci si presenta in due, o si dà per
-- scontato che ci pensi l'altro.
--
-- Perché **scritta** e non derivata al volo da `opportunita.assegnato_a`:
-- perché quella si può riassegnare. Derivandola, spostando la trattativa a un
-- collega cambierebbe retroattivamente anche l'assegnatario di un evento di
-- tre settimane prima — e si perderebbe proprio il dato che serve, cioè **a
-- chi era** quando andava fatto.
--
-- Le due cose restano due colonne diverse, e non è una ridondanza:
--
--   assegnato_a  — di chi è il lavoro. Lo scrive questo trigger quando la
--                  trattativa trova un titolare.
--   esito_da     — chi l'ha effettivamente chiuso, preso dal login di chi
--                  premeva il pulsante (vedi chiudiConEsito). C'era già.
--
-- Un appuntamento in carico a Carola può benissimo essere tenuto da Marco
-- perché quel giorno c'era lui al banco: sono due fatti veri insieme, e
-- tenerne uno solo vuol dire non poter più rispondere né a «di chi era» né a
-- «chi l'ha fatto».


-- ---------------------------------------------------------------------------
-- 1. Le colonne
-- ---------------------------------------------------------------------------
-- `text` e non una foreign key verso staff_users, come su `task.assegnato_a`:
-- l'email è la chiave dello staff, e un vincolo qui impedirebbe di
-- disattivare un collega che ha ancora eventi addosso.
alter table public.form_contatti
	add column if not exists assegnato_a text,
	add column if not exists assegnato_il timestamptz,
	add column if not exists assegnato_da text;

comment on column public.form_contatti.assegnato_a is
	'Di chi è il lavoro su questa richiesta: l''assegnatario della trattativa nel momento in cui l''ha presa. Scritto dal trigger assegna_eventi_della_trattativa. Distinto da esito_da, che è chi l''ha effettivamente chiusa.';

comment on column public.form_contatti.assegnato_da is
	'Chi ha causato l''assegnazione: l''operatore che ha preso o riassegnato la trattativa.';

-- Le righe da lavorare di un assegnatario, che è la lettura della dashboard.
create index if not exists form_contatti_assegnato_a_idx
	on public.form_contatti (assegnato_a)
	where gestito = false;


-- ---------------------------------------------------------------------------
-- 2. Il trigger: la trattativa trova un titolare, i suoi eventi aperti pure
-- ---------------------------------------------------------------------------
-- Sta nel database e non nel pannello perché all'assegnazione si arriva da
-- più porte: il pulsante «Prendi in carico», la tendina dell'assegnatario
-- (assegnaTrattativa), e la funzione trattativa_per_evento che se la prende
-- quando un commerciale scrive un evento in agenda. Tre porte e una regola:
-- scritta in una sola di esse, le altre due la violerebbero in silenzio.
--
-- Due cose che il trigger NON fa, ed è voluto:
--
--   * non tocca gli eventi **già assegnati a qualcun altro**: `assegnato_a is
--     null` nella where. Riassegnare la trattativa non riscrive la storia di
--     chi aveva in mano cosa — è il punto di avere la colonna;
--   * non tocca quelli **già chiusi**: una richiesta gestita o un task
--     completato sono storia. Assegnare a posteriori un lavoro già fatto
--     vorrebbe dire attribuirlo a chi non l'ha fatto.
create or replace function public.assegna_eventi_della_trattativa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
	-- Niente titolare, niente da propagare. Liberare una trattativa non
	-- libera i suoi eventi: restano a chi li aveva, che è ciò che «di chi
	-- era» deve continuare a dire.
	if new.assegnato_a is null then
		return new;
	end if;

	-- Mai far fallire l'assegnazione della trattativa per un problema di
	-- propagazione: prendere in carico è il gesto centrale del pannello, e un
	-- evento che resta senza nome si corregge, una presa in carico rifiutata
	-- blocca il lavoro.
	begin
		-- a) Le richieste dal sito o dal banco di questa trattativa.
		update form_contatti
		set assegnato_a = new.assegnato_a,
			assegnato_il = now(),
			assegnato_da = coalesce(new.assegnato_da, new.assegnato_a)
		where opportunita_id = new.id
			and gestito = false
			and assegnato_a is null;

		-- b) Gli eventi d'agenda agganciati a quelle richieste.
		update task
		set assegnato_a = new.assegnato_a
		where stato = 'aperto'
			and assegnato_a is null
			and entita = 'form_contatti'
			and entita_id in (
				select id::text from form_contatti where opportunita_id = new.id
			);

		-- c) Gli eventi d'agenda agganciati alla persona.
		--
		-- Una persona ha al massimo una trattativa aperta per costruzione
		-- (vedi trova_o_crea_opportunita e trattativa_per_evento), quindi i
		-- suoi eventi aperti sono di questa: agganciarli alla persona invece
		-- che all'opportunità è proprio la scelta che li fa sopravvivere alla
		-- chiusura di una trattativa e all'apertura della successiva.
		if new.persona_id is not null then
			update task
			set assegnato_a = new.assegnato_a
			where stato = 'aperto'
				and assegnato_a is null
				and entita = 'persona'
				and entita_id = new.persona_id::text;
		end if;
	exception when others then
		raise warning 'Eventi della trattativa % non assegnati: %', new.id, sqlerrm;
	end;

	return new;
end;
$$;

comment on function public.assegna_eventi_della_trattativa() is
	'Quando una trattativa trova un titolare, i suoi eventi ancora aperti e senza assegnatario passano a lui: richieste dal sito (form_contatti.assegnato_a) ed eventi d''agenda (task.assegnato_a). Non tocca quelli già assegnati a qualcun altro né quelli chiusi — l''assegnatario di allora è un dato da conservare, non da riscrivere.';

drop trigger if exists trg_assegna_eventi_della_trattativa on public.opportunita;

-- INSERT compreso: una trattativa può nascere già assegnata — eredita
-- l'ultimo commerciale della persona (trova_o_crea_opportunita) o è aperta da
-- un evento scritto da qualcuno (trattativa_per_evento).
create trigger trg_assegna_eventi_della_trattativa
after insert or update of assegnato_a on public.opportunita
for each row
execute function public.assegna_eventi_della_trattativa();


-- ---------------------------------------------------------------------------
-- 3. Le righe che c'erano già
-- ---------------------------------------------------------------------------
-- Solo le richieste ancora da lavorare, e solo dove la trattativa ha un
-- titolare: su una richiesta già gestita scriverla adesso vorrebbe dire
-- attribuire a qualcuno un lavoro chiuso mesi fa, magari da un altro — e
-- `gestito_da` dice già chi l'ha fatto.
update public.form_contatti f
set assegnato_a = o.assegnato_a,
	assegnato_il = coalesce(o.assegnato_il, now()),
	assegnato_da = coalesce(o.assegnato_da, o.assegnato_a)
from public.opportunita o
where f.opportunita_id = o.id
	and f.gestito = false
	and f.assegnato_a is null
	and o.assegnato_a is not null;


-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. Le colonne ci sono.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'form_contatti'
	and column_name in ('assegnato_a', 'assegnato_il', 'assegnato_da')
order by column_name;

-- 2. Il trigger è attaccato a opportunita.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.opportunita'::regclass and not tgisinternal
order by tgname;

-- 3. Quante richieste da lavorare hanno adesso un nome addosso, e quante no.
--    Le «senza» sono quelle la cui trattativa non ha ancora un titolare: sono
--    esattamente le «Trattative da prendere in carico» della dashboard, e
--    devono coincidere.
select
	count(*) filter (where f.assegnato_a is not null) as con_assegnatario,
	count(*) filter (where f.assegnato_a is null) as senza_assegnatario
from public.form_contatti f
where f.gestito = false and f.opportunita_id is not null;

-- 4. La prova del trigger, da rifare a mano su una trattativa di prova:
--    prenderla in carico dal pannello e controllare che la sua richiesta
--    aperta abbia assegnato_a uguale.
--
--    select f.id, f.assegnato_a, o.assegnato_a as trattativa
--    from public.form_contatti f join public.opportunita o on o.id = f.opportunita_id
--    where o.id = '<id della trattativa>';

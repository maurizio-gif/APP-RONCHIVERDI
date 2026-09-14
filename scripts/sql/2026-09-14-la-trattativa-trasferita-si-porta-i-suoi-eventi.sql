-- La trattativa che passa a un collega si porta dietro gli eventi ancora da
-- fare. Quelli già chiusi restano a chi li ha fatti.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-11-evento-assegnato-alla-trattativa.sql.
--
-- Nessuna colonna nuova: si può eseguire prima o dopo il deploy, e il pannello
-- funziona uguale in entrambi i casi — semplicemente, finché non è passata, il
-- tag di una riga trasferita continua a dire il nome di prima.
--
-- ─────────────────────────────────────────────────────────────── il perché
--
-- Alice Scagliola è stata spostata da Carola a Jasmine. Nel pannello della
-- trattativa si leggeva «la segue Jasmine», e nel tag in cima alla riga dello
-- stesso evento «In carico a te» — a Carola. Due verità sullo stesso schermo,
-- e quella sbagliata era anche quella che decide il lavoro: la dashboard
-- elenca le righe per `assegnato_a`, quindi l'appuntamento restava nell'elenco
-- di Carola e non compariva in quello di Jasmine.
--
-- Il trigger scritto in 2026-09-11 propagava l'assegnatario **solo sugli
-- eventi che non ne avevano uno** (`assegnato_a is null`), per non riscrivere
-- la storia di chi aveva in mano cosa. La regola è giusta, ma copriva un caso
-- di troppo: un evento **ancora aperto** non è storia, è lavoro da fare. La
-- storia la fanno gli eventi chiusi — quelli il trigger continua a non
-- toccarli, ed è lì che «a chi era quando andava fatto» va conservato.
--
-- La regola nuova, in una riga: **un evento aperto segue la trattativa se era
-- in mano a chi la sta passando**. Tre casi, tutti e tre voluti:
--
--   * aperto e senza nessuno            → prende il nuovo titolare (come prima);
--   * aperto e in mano a chi la passa   → passa anche lui, è la stessa
--                                         telefonata che cambia mani;
--   * aperto e in mano a un terzo       → resta suo. La segreteria può aver
--                                         assegnato a mano un appuntamento a
--                                         un collega preciso (la tendina
--                                         dell'assegnatario in agenda), e
--                                         spostare la trattativa non è un
--                                         motivo per disfare quella scelta;
--   * chiuso, in qualunque mano         → non si tocca mai.
--
-- Perché serve `old`: senza sapere **da chi** arriva il trasferimento non si
-- distingue il secondo caso dal terzo, e si finirebbe per scegliere fra due
-- errori — lasciare tutto fermo (il difetto di adesso) o riscrivere anche le
-- assegnazioni fatte a mano.
--
-- Liberare una trattativa continua a non liberare i suoi eventi: restano a chi
-- li aveva. Una trattativa senza titolare è una trattativa da prendere, non un
-- lavoro da cancellare, e un appuntamento di domani senza nessuno addosso è
-- peggio di uno in mano a chi l'ha preso.


-- ---------------------------------------------------------------------------
-- 1. Il trigger
-- ---------------------------------------------------------------------------
create or replace function public.assegna_eventi_della_trattativa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	-- Chi la seguiva prima di questo cambio, quando c'era un prima: su un
	-- INSERT `old` non esiste, e in PL/pgSQL leggerlo dentro un trigger di
	-- inserimento è un errore («record old is not assigned yet»), non un null.
	-- Resta null anche quando la trattativa era libera, e allora la condizione
	-- qui sotto si riduce a quella di prima: solo gli eventi di nessuno.
	v_precedente text := null;
begin
	if tg_op = 'UPDATE' then
		v_precedente := old.assegnato_a;
	end if;

	-- Niente titolare, niente da propagare (vedi sopra: liberare non libera).
	if new.assegnato_a is null then
		return new;
	end if;

	-- Mai far fallire l'assegnazione della trattativa per un problema di
	-- propagazione: prendere in carico e passare una pratica sono i gesti
	-- centrali del pannello. Un evento che resta col nome sbagliato si
	-- corregge, un trasferimento rifiutato blocca il lavoro.
	begin
		-- a) Le richieste dal sito o dal banco di questa trattativa.
		--
		-- `form_contatti.assegnato_a` non si sceglie a mano da nessuna parte
		-- del pannello — lo scrive solo questo trigger — quindi qui il terzo
		-- caso non esiste: o è di nessuno, o è di chi sta passando la
		-- trattativa.
		update form_contatti
		set assegnato_a = new.assegnato_a,
			assegnato_il = now(),
			assegnato_da = coalesce(new.assegnato_da, new.assegnato_a)
		where opportunita_id = new.id
			and gestito = false
			and (assegnato_a is null or assegnato_a is not distinct from v_precedente);

		-- b) Gli eventi d'agenda agganciati a quelle richieste: i seguiti
		--    programmati chiudendo una richiesta.
		update task
		set assegnato_a = new.assegnato_a
		where stato = 'aperto'
			and (assegnato_a is null or assegnato_a is not distinct from v_precedente)
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
				and (assegnato_a is null or assegnato_a is not distinct from v_precedente)
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
	'Quando una trattativa trova un titolare o passa a un collega, i suoi eventi ancora aperti lo seguono: quelli di nessuno e quelli che erano in mano a chi la passa (richieste dal sito in form_contatti.assegnato_a, eventi d''agenda in task.assegnato_a). Non tocca gli eventi chiusi — l''assegnatario di allora è un dato da conservare — né quelli assegnati a mano a un terzo collega.';

-- Il trigger è già attaccato (after insert or update of assegnato_a on
-- opportunita) e non cambia: si rifà solo la funzione. Lo si ricrea comunque,
-- perché questo file deve poter girare anche su un database in cui la
-- migration del 2026-09-11 fosse stata eseguita a metà.
drop trigger if exists trg_assegna_eventi_della_trattativa on public.opportunita;

create trigger trg_assegna_eventi_della_trattativa
after insert or update of assegnato_a on public.opportunita
for each row
execute function public.assegna_eventi_della_trattativa();


-- ---------------------------------------------------------------------------
-- 2. Le righe già fuori posto
-- ---------------------------------------------------------------------------
-- I trasferimenti fatti prima di questa migration hanno lasciato gli eventi
-- aperti col nome di prima: è il caso di Alice Scagliola, ed è quello che si
-- vede a schermo adesso.

-- a) Le richieste dal sito: si allineano tutte.
--
-- Nessun dubbio da sciogliere — `form_contatti.assegnato_a` lo scrive solo il
-- trigger, quindi un valore diverso dal titolare attuale della trattativa può
-- essere una cosa sola: un trasferimento avvenuto prima di oggi. E solo le
-- righe ancora da lavorare: su una gestita `gestito_da` dice già chi l'ha
-- fatta, e riscriverle vorrebbe dire attribuire a qualcuno un lavoro chiuso.
update public.form_contatti f
set assegnato_a = o.assegnato_a,
	assegnato_il = coalesce(f.assegnato_il, o.assegnato_il, now()),
	assegnato_da = coalesce(o.assegnato_da, o.assegnato_a)
from public.opportunita o
where f.opportunita_id = o.id
	and f.gestito = false
	and o.assegnato_a is not null
	and f.assegnato_a is distinct from o.assegnato_a;

-- b) Gli eventi d'agenda: quelli di nessuno, e quelli che erano in mano a chi
--    ha passato la trattativa — chi fosse lo dice il registro operatori.
--
-- Qui l'allineamento cieco non si può fare: `task.assegnato_a` si sceglie a
-- mano in agenda, quindi un nome diverso dal titolare della trattativa può
-- essere sia un trasferimento vecchio sia una scelta voluta della segreteria.
-- La differenza la sa il log: ogni passaggio scrive una riga
-- `trattativa_assegnata` con dentro `dettagli->>'da'`, cioè il titolare di
-- prima (vedi assegnaTrattativa in app/dashboard/richieste/trattativa-actions.ts).
-- Si sposta solo chi corrisponde a quel nome; tutto il resto resta dov'è.
--
-- Solo le trattative **aperte**: una persona ne ha al massimo una per
-- costruzione, e senza questo filtro un evento agganciato alla persona si
-- aggancerebbe anche alle sue trattative chiuse — cioè prenderebbe il nome di
-- un titolare di un anno fa, scelto fra i tanti a caso.
with ultimo_passaggio as (
	select distinct on (l.entita_id)
		l.entita_id as opportunita_id,
		lower(l.dettagli->>'da') as precedente
	from public.audit_log l
	where l.azione = 'trattativa_assegnata'
		and l.entita = 'opportunita'
		and l.entita_id is not null
	order by l.entita_id, l.created_at desc
)
update public.task t
set assegnato_a = o.assegnato_a
from public.opportunita o
	left join ultimo_passaggio u on u.opportunita_id = o.id::text
where o.assegnato_a is not null
	and o.stato not in ('vinto', 'perso', 'annullato')
	and t.stato = 'aperto'
	and (
		-- di nessuno: lo prende il titolare, come fa il trigger a ogni
		-- assegnazione. Non c'è niente da conservare in un nome che non c'è;
		t.assegnato_a is null
		-- oppure era di chi ha passato la trattativa.
		or (u.precedente is not null and t.assegnato_a is not distinct from u.precedente)
	)
	and t.assegnato_a is distinct from o.assegnato_a
	and (
		(t.entita = 'persona' and o.persona_id is not null and t.entita_id = o.persona_id::text)
		or (
			t.entita = 'form_contatti'
			and t.entita_id in (select f.id::text from public.form_contatti f where f.opportunita_id = o.id)
		)
	);


-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. La funzione è quella nuova: deve comparire `v_precedente`.
select pg_get_functiondef('public.assegna_eventi_della_trattativa()'::regprocedure)
	like '%v_precedente%' as regola_nuova_attiva;

-- 2. Il trigger è attaccato a opportunita.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.opportunita'::regclass and not tgisinternal
order by tgname;

-- 3. Nessuna richiesta da lavorare in disaccordo con la sua trattativa.
--    Deve tornare 0: se torna un numero, il backfill non ha coperto quelle
--    righe e vanno guardate a mano.
select count(*) as richieste_in_disaccordo
from public.form_contatti f
join public.opportunita o on o.id = f.opportunita_id
where f.gestito = false
	and o.assegnato_a is not null
	and f.assegnato_a is distinct from o.assegnato_a;

-- 4. Gli eventi d'agenda aperti che restano in mano a un nome diverso dal
--    titolare della trattativa. Qui un numero **non** è un difetto: sono le
--    assegnazioni fatte a mano dalla segreteria, ed è giusto che siano
--    rimaste. Serve a guardarle, non a correggerle in blocco.
select t.id, t.titolo, t.data, t.assegnato_a as evento, o.assegnato_a as trattativa
from public.task t
join public.opportunita o
	on ((t.entita = 'persona' and t.entita_id = o.persona_id::text)
		or (t.entita = 'form_contatti' and t.entita_id in (
			select f.id::text from public.form_contatti f where f.opportunita_id = o.id
		)))
	and o.stato not in ('vinto', 'perso', 'annullato')
where t.stato = 'aperto'
	and o.assegnato_a is not null
	and t.assegnato_a is distinct from o.assegnato_a
order by t.data;

-- 5. Alice Scagliola, cioè il caso da cui è partita questa migration: il tag
--    dell'evento e il titolare della trattativa devono dire lo stesso nome.
--
--    select p.nome, p.cognome, o.assegnato_a as trattativa,
--           f.assegnato_a as richiesta, f.gestito
--    from public.persone p
--    join public.opportunita o on o.persona_id = p.id
--    left join public.form_contatti f on f.opportunita_id = o.id
--    where p.cognome ilike 'scagliola';

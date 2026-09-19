-- Un abbonamento venduto chiude da sola la trattativa aperta di quella
-- persona: era il pezzo esplicitamente rimandato in
-- ops/sync-info4u/README.md ("collegamento alle trattative... è il prossimo
-- passo, una volta che i dati sono dentro e li guardiamo insieme") — la
-- sincronizzazione Info4U → `abbonamenti` gira stabile da un po', tocca a
-- questo pezzo.
--
-- Da eseguire nel SQL Editor del progetto Supabase Ronchiverdi
-- (upoiasekisojikbzsymq), dopo 2026-09-17-sync-info4u-abbonamenti.sql e
-- 2026-09-17-triple-pack-e-obiettivi-giornalieri.sql (serve la colonna
-- triple_pack).
--
-- ──────────────────────────────────────────────────────── cosa chiude, e come
--
-- Qualunque vendita in `abbonamenti` con una persona agganciata (membership,
-- corsi, shop, daily pass, carnet — la tabella non filtra per tipo, vedi
-- ops/sync-info4u/README.md) chiude come **vinta** la trattativa aperta
-- (nuovo | in_gestione) di quella persona, se ce n'è una. Non c'è un filtro
-- sul tipo di prodotto: chi ha una trattativa Club/Family aperta e compare
-- con una vendita qualunque a suo nome ha comunque risposto a quella
-- trattativa, e lasciarla aperta in attesa di una vendita "più giusta"
-- vorrebbe dire pipeline sporca per il tempo di aspettare.
--
-- Le tre colonne della vinta, riempite come le riempirebbe un operatore a
-- mano (vedi 2026-09-11-nota-della-vinta.sql, che le ha introdotte):
--   motivo_vinto → il nome del prodotto (`abbonamento`, con la `variante` se
--                  c'è): è la stessa domanda che si fa a chi chiude a mano,
--                  "quale abbonamento è stato venduto".
--   valore_euro  → `totale`: quanto è stato **effettivamente incassato**,
--                  non il listino — la stessa scelta della UI manuale.
--   chiuso_il    → `data_vendita`, non `now()`. `chiuso_il` è la colonna che
--                  tutta la reportistica per periodo legge come "il giorno
--                  in cui la trattativa è stata vinta" (core-manager,
--                  obiettivi giornalieri): usare la data reale della vendita
--                  invece del momento in cui gira la sincronizzazione è
--                  quello che tiene corretto il fatturato del giorno giusto
--                  quando il sync recupera un arretrato, ed è anche — a
--                  schermo — la data della vendita di cui si chiedeva
--                  comparisse sulla trattativa vinta: non serve una colonna
--                  in più, è la stessa che il resto del CRM già legge come
--                  "quando è stata chiusa".
--
-- Senza nota non si chiude: `motivo_vinto` è obbligatorio quanto lo è
-- dall'interfaccia (chiedeMotivo in lib/pipeline.ts), e una vendita con
-- `abbonamento` vuoto — non dovrebbe succedere, ma Info4U non lo garantisce —
-- non chiude nulla piuttosto che scrivere una vinta senza dire cosa fu
-- venduto.
--
-- ──────────────────────────────────────────────── il problema dello storico
--
-- Il primo sync porta **tutto lo storico** Info4U, circa 193.000 vendite
-- (vedi ops/sync-info4u/README.md): fra queste, quasi certamente, vendite
-- vecchie di mesi o anni di persone che HANNO ANCHE una trattativa aperta
-- OGGI, magari tornate a chiedere informazioni per un nuovo abbonamento.
-- Senza guardia, la prima sincronizzazione chiuderebbe quella trattativa di
-- oggi con la data (e il prodotto) di una vendita di tre anni fa.
--
-- La guardia è `data_vendita >= creato_il` della trattativa: si chiude solo
-- se la vendita è successiva all'apertura della trattativa che sta
-- chiudendo. Una vendita più vecchia della trattativa non può essere il
-- motivo per cui quella trattativa esiste, quindi non la tocca.

create or replace function public.chiudi_trattativa_da_abbonamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id uuid;
	v_nota text;
begin
	if new.persona_id is null then return new; end if;

	-- La trattativa aperta di questa persona, se c'è, aperta prima della
	-- vendita che sta arrivando. Al massimo ce n'è una aperta per persona
	-- (trova_o_crea_opportunita/trattativa_per_evento la riusano sempre),
	-- ma "order by ... limit 1" resta una difesa a costo zero.
	select o.id into v_id
	from opportunita o
	where o.persona_id = new.persona_id
		and o.stato in ('nuovo', 'in_gestione')
		and o.creato_il <= coalesce(new.data_vendita, now())
	order by o.creato_il desc
	limit 1;

	if v_id is null then return new; end if;

	v_nota := nullif(
		btrim(
			coalesce(new.abbonamento, '')
			|| case when coalesce(btrim(new.variante), '') <> '' then ' - ' || btrim(new.variante) else '' end
		),
		''
	);

	-- Come da interfaccia: senza sapere cosa fu venduto non si chiude come
	-- vinta (chiedeMotivo in lib/pipeline.ts, e il vincolo lato server in
	-- cambiaStato). Resta aperta, si chiuderà a mano o alla prossima vendita
	-- di quella persona che abbia un nome prodotto.
	if v_nota is null then return new; end if;

	update opportunita
	set stato = 'vinto',
		-- Marcatore testuale e non un'email: si distingue a colpo d'occhio
		-- nel registro operatori (StoricoTrattative legge cambiato_da) da
		-- una chiusura fatta da un commerciale al telefono.
		stato_da = 'sync-info4u',
		stato_il = now(),
		chiuso_il = coalesce(new.data_vendita, now()),
		motivo_vinto = v_nota,
		valore_euro = new.totale,
		triple_pack = false
	where id = v_id;

	return new;
exception when others then
	-- Come collega_persona_a_contatto: l'inserimento della vendita non deve
	-- fallire per un intoppo nella trattativa. La vendita è il dato che non
	-- si può perdere; una trattativa rimasta aperta per errore si sistema
	-- dopo, dal pannello.
	raise warning 'Trattativa non chiusa dall''abbonamento %: %', new.id, sqlerrm;
	return new;
end;
$$;

comment on function public.chiudi_trattativa_da_abbonamento() is
	'Chiude come vinta la trattativa aperta della persona quando le arriva una vendita in abbonamenti (sync Info4U). Guardia data_vendita >= creato_il della trattativa: una vendita più vecchia della trattativa non la può aver vinta lei, e senza questa guardia il primo sync dello storico (~193.000 righe) chiuderebbe trattative di oggi con vendite di anni fa.';

-- Solo AFTER INSERT: lo script di sync fa upsert su source_iscrizione_id ma
-- oggi non ripassa mai su una vendita già sotto il suo watermark (vedi
-- ops/sync-info4u/README.md, "Cosa NON fa (ancora)"), quindi non arrivano
-- UPDATE da gestire — se in futuro lo script imparasse a correggere vendite
-- già sincronizzate, si aggiunge qui anche AFTER UPDATE OF totale, abbonamento.
drop trigger if exists abbonamenti_chiude_trattativa on public.abbonamenti;
create trigger abbonamenti_chiude_trattativa
	after insert on public.abbonamenti
	for each row
	execute function public.chiudi_trattativa_da_abbonamento();

revoke all on function public.chiudi_trattativa_da_abbonamento() from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────── backfill
--
-- Le vendite già sincronizzate prima di questo trigger, per le trattative
-- tuttora aperte: senza backfill resterebbero aperte finché non arriva la
-- prossima vendita di quella persona. Stessa guardia del trigger
-- (data_vendita >= creato_il), e fra più vendite valide si prende la più
-- vecchia — è quella che il trigger avrebbe usato se fosse già esistito
-- quando è arrivata.
do $$
declare
	r record;
	v_nota text;
begin
	for r in
		select distinct on (o.id)
			o.id as opportunita_id, a.abbonamento, a.variante, a.totale, a.data_vendita
		from opportunita o
		join abbonamenti a
			on a.persona_id = o.persona_id
			and a.data_vendita >= o.creato_il
		where o.stato in ('nuovo', 'in_gestione')
		order by o.id, a.data_vendita asc
	loop
		v_nota := nullif(
			btrim(
				coalesce(r.abbonamento, '')
				|| case when coalesce(btrim(r.variante), '') <> '' then ' - ' || btrim(r.variante) else '' end
			),
			''
		);
		if v_nota is null then continue; end if;

		update opportunita
		set stato = 'vinto',
			stato_da = 'sync-info4u',
			stato_il = now(),
			chiuso_il = coalesce(r.data_vendita, now()),
			motivo_vinto = v_nota,
			valore_euro = r.totale,
			triple_pack = false
		where id = r.opportunita_id;
	end loop;
end;
$$;

-- ──────────────────────────────────────────────────────── da verificare dopo

-- 1. Quante trattative il backfill ha chiuso, e con quale fatturato: la
--    controprova che il trigger da qui in avanti farà lo stesso lavoro sulle
--    vendite nuove.
select count(*) as vinte_da_sync, sum(valore_euro) as fatturato
from opportunita
where stato = 'vinto' and stato_da = 'sync-info4u';

-- 2. Le trattative ancora aperte che hanno comunque una vendita successiva
--    alla loro apertura: se questa query non è vuota, qualcosa nella guardia
--    o nella nota (es. `abbonamento` vuoto su quella vendita) ha impedito la
--    chiusura, e vale la pena guardarle una per una.
select o.id, o.persona_id, o.creato_il, a.abbonamento, a.data_vendita
from opportunita o
join abbonamenti a on a.persona_id = o.persona_id and a.data_vendita >= o.creato_il
where o.stato in ('nuovo', 'in_gestione')
order by a.data_vendita desc;

-- Ticket #10 «cambiare nome anagrafica»: Laura Viberti è in anagrafica due
-- volte, stessa email e stesso cellulare.
--   75ea4eda… «laura vibert»  (form del sito, cognome con la i mancante):
--             ha la trattativa vinta «annuale swim indoor», 1.188 €
--   b21afdc9… «Laura Viberti» (import Info4U): dati completi, nessuna trattativa
-- Si sposta la trattativa sulla scheda Info4U e si elimina quella sbagliata.
-- Da eseguire nel SQL Editor di Supabase.

begin;

-- Sposta trattativa, form di contatto e azioni collegate, e scrive l'audit
-- (la stessa funzione del pulsante «Sposta lead»).
select * from sposta_trattativa_su_persona(
  '3b2e8c3c-a7bf-4f49-8cc0-9a01de05b272',
  'b21afdc9-3bc0-4ac1-b630-efcc7a114d1d',
  's.aggazio@ronchiverdi.it'
);

-- La scheda sbagliata non deve avere più niente attaccato: se una di queste
-- conta più di 0, fermarsi e fare rollback.
select
  (select count(*) from opportunita  where persona_id = '75ea4eda-b7b5-4ff7-85a2-d1dcda2c397d') as opportunita,
  (select count(*) from form_contatti where persona_id = '75ea4eda-b7b5-4ff7-85a2-d1dcda2c397d') as form_contatti,
  (select count(*) from abbonamenti   where persona_id = '75ea4eda-b7b5-4ff7-85a2-d1dcda2c397d') as abbonamenti,
  (select count(*) from email_inviate where persona_id = '75ea4eda-b7b5-4ff7-85a2-d1dcda2c397d') as email_inviate;

delete from persone where id = '75ea4eda-b7b5-4ff7-85a2-d1dcda2c397d';

commit;

-- Lot 73 — la caisse de la coordinatrice (30/08/2026).
-- APPLIQUÉE le 30/08/2026 sur jvcybcpqraoxbkemmpax (migration
-- « lot73_caisse_coordinatrice ») ; ce fichier est la copie de relecture.
--
-- Le change devient un mouvement à part entière ; le sens et le lieu de chaque
-- mouvement deviennent explicites ; le solde se CALCULE, seul le comptage
-- physique se saisit (caisse_arretes).
--
-- Vérifié après application : sens/lieu posés sur 64/64 (entree/compte 44,
-- entree/caisse 13, sortie/caisse 7, aucun sens vide), sauvegarde 64 lignes,
-- 64 updated_at horodatés, vue → EUR 46 683,00, 0 illisible.

-- 0) Sauvegarde datée AVANT toute écriture (méthode du 19/08). RLS sans
--    politique : fermée à PostgREST, comme les autres sauvegarde_*.
create table sauvegarde_finances_20260830 as select * from finances;
alter table sauvegarde_finances_20260830 enable row level security;

-- 1) Quatre colonnes, au motif maison de la table (text NOT NULL DEFAULT '') :
--    le monolithe continue d'insérer sans les nommer ; '' = « à classer »,
--    signalé à l'écran, jamais compté dans un solde.
alter table finances
  add column sens text not null default '',
  add column lieu text not null default '',
  add column montant_contrepartie text not null default '',
  add column devise_contrepartie text not null default '';

-- 2) Reprise des 64 lignes existantes : correspondance EXPLICITE type→sens/lieu,
--    aucune déduction. Journal dans notes, updated_at posé À LA MAIN (la table
--    n'a aucun déclencheur — même piège que catalogue_interventions).
update finances set
  sens = 'entree',
  lieu = case methode when 'Virement' then 'compte' when 'Espèces' then 'caisse' else '' end,
  notes = case when notes = '' then '' else notes || ' | ' end
    || '30/08/2026 lot 73 : sens=entree, lieu='
    || case methode when 'Virement' then 'compte' when 'Espèces' then 'caisse' else '(methode inconnue)' end
    || ' poses depuis type+methode',
  updated_at = now()
where type in ('Acompte', 'Devis', 'Paiement total') and sens = '';

update finances set
  sens = 'sortie',
  lieu = 'caisse',
  notes = case when notes = '' then '' else notes || ' | ' end
    || '30/08/2026 lot 73 : sens=sortie, lieu=caisse poses depuis type',
  updated_at = now()
where type in ('Honoraires chirurgien', 'Paiement chirurgien', 'Commission commerciale') and sens = '';

-- 3) Les arrêtés de caisse : le comptage physique, PAS le solde. Le premier
--    enregistrement sera le solde d'ouverture — saisi par un humain après un
--    comptage, à une date écrite. AUCUNE ligne insérée ici (interdit du lot).
--    Un arrêté vaut FIN de journée : la vue ne compte que les mouvements dont
--    la date est STRICTEMENT postérieure. Aucune colonne de taux, nulle part :
--    un taux se calcule à l'affichage, jamais ne se stocke.
create table caisse_arretes (
  id text primary key,
  date text not null default '',
  devise text not null default '',
  montant_compte numeric(12,2) not null,
  montant_calcule numeric(12,2) not null,
  ecart numeric(12,2) not null,
  par text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
alter table caisse_arretes enable row level security;
create policy caisse_arretes_staff on caisse_arretes for all
  using ((app_role() is not null) and (app_role() <> all (array['chirurgien'::text, 'anonyme'::text])));

-- 4) La vue du solde : par devise, depuis le dernier arrêté. security_invoker :
--    la RLS de finances s'applique au lecteur, la vue ne la contourne pas.
--    · seuls les mouvements RÉALISÉS comptent (Complété, Payé) — « En attente »
--      n'est pas dans la caisse, « Annulé » n'y est plus, un statut vide ne se
--      devine pas (les 4 honoraires : signalés, jamais comptés) ;
--    · un change est UNE ligne : montant sort dans sa devise,
--      montant_contrepartie entre dans la sienne ;
--    · un montant qui ne caste pas n'entre dans aucun total : il est COMPTÉ
--      dans lignes_illisibles, jamais ignoré en silence.
create view vue_caisse_solde with (security_invoker = on) as
with lisible as (
  select f.*,
    case when btrim(f.montant) ~ '^-?[0-9]+([.,][0-9]+)?$'
         then replace(btrim(f.montant), ',', '.')::numeric end as montant_num,
    case when btrim(f.montant_contrepartie) ~ '^-?[0-9]+([.,][0-9]+)?$'
         then replace(btrim(f.montant_contrepartie), ',', '.')::numeric end as contrepartie_num
  from finances f
),
realise as (
  select * from lisible where sens <> '' and statut in ('Complété', 'Payé')
),
mouv as (
  select devise, date, montant_num as delta from realise
    where sens = 'entree' and lieu = 'caisse' and montant_num is not null
  union all
  select devise, date, -montant_num from realise
    where sens in ('sortie', 'remise') and lieu = 'caisse' and montant_num is not null
  union all
  select devise, date, -montant_num from realise
    where sens = 'change' and montant_num is not null
  union all
  select devise_contrepartie, date, contrepartie_num from realise
    where sens = 'change' and contrepartie_num is not null and devise_contrepartie <> ''
),
arrete as (
  select distinct on (devise) devise, date, montant_compte
  from caisse_arretes order by devise, date desc, created_at desc
),
devises as (select devise from mouv union select devise from arrete)
select
  d.devise,
  round(coalesce(a.montant_compte, 0)
    + coalesce((select sum(m.delta) from mouv m
                where m.devise = d.devise and (a.date is null or m.date > a.date)), 0), 2) as solde,
  a.date as depuis_arrete,
  (select count(*) from lisible l
   where l.sens <> '' and l.statut in ('Complété', 'Payé') and l.montant_num is null) as lignes_illisibles
from devises d
left join arrete a on a.devise = d.devise;

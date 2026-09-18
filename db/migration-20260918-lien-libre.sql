-- Lien de paiement SANS devis (18/09/2026).
-- Copie de relecture de la migration « lien_paiement_libre » appliquée sur
-- jvcybcpqraoxbkemmpax (clinic-nobel-crm-prod).
--
-- Le besoin, dans les mots de Veys : « Quand je dois faire un paiement, même
-- si je n'ai pas de devis, je mets le nom du patient et je fais un paiement
-- par Paysera. » Des gens arrivent pour autre chose, ou ont déjà payé leur
-- facture.
--
-- ═══ LA QUESTION D'ARGENT, tranchée par la mesure et non par un avis ═══
-- `nw_paiements.facture_id` est NULLABLE, et 2 des 17 paiements en base sont
-- DÉJÀ sans facture (les deux acomptes de 300 € dont la facture d'origine a
-- été supprimée). L'écran Paiements les montre depuis toujours dans sa
-- rubrique « Paiements non rattachés », et l'éditeur de paiement permet de
-- leur choisir une facture après coup.
-- Conséquence : un paiement encaissé sans devis n'exige AUCUN changement au
-- schéma comptable. Ce fichier ne touche donc pas à `nw_paiements` — ni
-- colonne, ni contrainte, ni ligne.
--
-- Ce qui s'élargit, c'est la table de CE dépôt : `nw_liens_paiement`, créée
-- le 16/09, qui exigeait un devis.

-- 0) Sauvegarde datée AVANT toute écriture (méthode du 19/08, du 30/08, du 16/09).
--    RLS activé, ZÉRO politique : ce vide EST la fermeture.
create table sauvegarde_nw_liens_paiement_20260918 as select * from nw_liens_paiement;
alter table sauvegarde_nw_liens_paiement_20260918 enable row level security;

-- 1) Un lien peut n'avoir aucun devis. `devis_numero` garde son rôle : il
--    porte la RÉFÉRENCE envoyée au site et relue dans `nw_paiements.ref_num`
--    — un numéro de devis quand il y en a un, une référence libre sinon.
alter table nw_liens_paiement alter column devis_id drop not null;

-- 2) Ce qu'un lien libre porte en plus : le libellé que la patiente lira, et
--    l'identité de la personne — sa fiche quand elle existe, son nom sinon.
--    `patient_id` reste NULLABLE et SANS clé étrangère : une personne pas
--    encore au fichier n'a pas d'identifiant, et c'est le cas d'usage.
alter table nw_liens_paiement
  add column libelle text not null default '',
  add column patient_id text,
  add column patient_nom text not null default '';

-- 3) La numérotation reste ATOMIQUE et CÔTÉ SERVEUR — invariant du dépôt :
--    « La numérotation ne se calcule jamais côté navigateur. » Un troisième
--    type s'ajoute, « libre », qui produit L-2026-000001. Même forme que
--    D-… et F-… (une lettre, l'année, six chiffres) : le site qui reçoit
--    cette référence dans son champ `devis` voit donc la forme qu'il connaît.
--    Le reste de la fonction est inchangé, gardes de rôle comprises.
create or replace function public.nw_prochain_numero(type text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role  text := public.app_role();
  v_year  text := to_char(now() at time zone 'Europe/Istanbul', 'YYYY');
  v_kind  text := lower(coalesce(type, ''));
  v_prefix text;
  v_key   text;
  v_next  bigint;
begin
  if v_role is null or v_role in ('chirurgien', 'anonyme') then
    raise exception 'Acces refuse : role % non autorise sur Nobel World', coalesce(v_role, 'inconnu');
  end if;

  if v_kind in ('devis', 'd') then
    v_prefix := 'D'; v_key := 'devis_' || v_year;
  elsif v_kind in ('facture', 'factures', 'f') then
    v_prefix := 'F'; v_key := 'factures_' || v_year;
  elsif v_kind in ('libre', 'lien', 'l') then
    v_prefix := 'L'; v_key := 'liens_libres_' || v_year;
  else
    raise exception 'Type de numerotation inconnu : %', type;
  end if;

  insert into public.nw_parametres (cle, valeur)
  values ('compteurs', '{}'::jsonb)
  on conflict (cle) do nothing;

  update public.nw_parametres
     set valeur = jsonb_set(valeur, array[v_key],
                    to_jsonb(coalesce((valeur ->> v_key)::bigint, 0) + 1), true),
         maj = now()
   where cle = 'compteurs'
  returning (valeur ->> v_key)::bigint into v_next;

  return v_prefix || '-' || v_year || '-' || lpad(v_next::text, 6, '0');
end
$function$;

-- Contrôle d'après-écriture (exécuté le 18/09, résultat au compte rendu) :
--   select column_name, is_nullable from information_schema.columns
--    where table_name='nw_liens_paiement' order by ordinal_position;
--   -- et la numérotation, sans consommer de numéro de devis :
--   select public.nw_prochain_numero('libre');

-- Lien de paiement Paysera depuis un devis (16/09/2026).
-- Copie de relecture de la migration « lien_paiement_paysera » sur
-- jvcybcpqraoxbkemmpax (clinic-nobel-crm-prod) — voir README, section
-- « Le lien de paiement Paysera ».
--
-- Une seule table, NEUVE et vide : la mémoire des liens que le site
-- clinicnobel.com renvoie (il n'en garde aucune — chaque appel crée un lien
-- neuf, valable 7 jours). Rien n'est ajouté sur nw_devis : le statut « payé »
-- se lit dans nw_paiements (ref_num = numéro du devis, mode « Paysera »),
-- convention existante conservée, décision confirmée avec Veys le 16/09.
--
-- Écrite par la route serveur de Nobel World SEULEMENT
-- (app/api/paysera/lien-devis) ; lue par l'écran du devis. Jamais de
-- suppression : un lien expiré reste une trace (qui a demandé quoi, quand).

create table nw_liens_paiement (
  id text primary key,
  devis_id text not null,
  devis_numero text not null default '',
  -- acompte · paiement (le vocabulaire du contrat, identique à nw_paiements.type)
  type text not null,
  montant numeric(12,2) not null,
  devise text not null default 'EUR',
  -- la référence Paysera (« DEVIS-D-2026-000123-A-… ») : le site la pose en
  -- `note` du paiement écrit sur webhook, c'est le pont entre les deux tables
  reference text not null default '',
  payment_url text not null,
  order_id text not null default '',
  link_id text not null default '',
  is_test boolean not null default false,
  langue text not null default 'fr',
  expires_at timestamptz,
  cree_par text not null default '',
  created_at timestamptz not null default now()
);
create index nw_liens_paiement_devis on nw_liens_paiement (devis_id, created_at desc);

-- Même porte que nw_historique : tout rôle non anonyme, hors chirurgien.
-- Le droit de GÉNÉRER un lien, lui, se décide dans l'application
-- (permission `paiementLienPaysera`, portée par le seul rôle admin) et dans
-- sa route serveur — la table n'a pas à connaître cette nuance.
alter table nw_liens_paiement enable row level security;
create policy nw_liens_paiement_staff on nw_liens_paiement for all to authenticated
  using ((app_role() is not null) and (app_role() <> all (array['chirurgien'::text, 'anonyme'::text])))
  with check ((app_role() is not null) and (app_role() <> all (array['chirurgien'::text, 'anonyme'::text])));

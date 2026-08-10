# Clinic NobelWorld — Devis & Factures

Application Next.js 15 (App Router) · TypeScript · Tailwind · Supabase, déployée sur Vercel.
Elle remplace la page unique `index.html` (React par CDN + Babel navigateur) et le backend
Google Apps Script, **à iso-fonctionnalité et iso-apparence**.

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis renseigner les deux variables
npm run dev
```

Variables d'environnement (les seules ; **aucune clé ne doit être écrite dans le code**) :

| Variable | Rôle |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase `clinic-nobel-crm-prod` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé publiable (les droits réels viennent des règles RLS) |

## Base de données — règles non négociables

La base est **partagée avec le CRM Clinic Nobel**, sur lequel un système d'IA est en
construction. Les garde-fous sont posés à trois niveaux : les règles RLS côté Postgres,
la liste blanche `TABLES_ECRITURE` de `lib/data.ts`, et l'interface.

| Table | Droit de Nobel World |
| --- | --- |
| `nw_devis`, `nw_factures`, `nw_paiements`, `nw_historique`, `nw_options`, `nw_parametres` | lecture + écriture |
| `patients` | lecture + écriture, **jamais de suppression** (liste unique partagée) |
| `catalogue_interventions`, `catalogue_correspondances`, `profiles` | **lecture seule** |
| toute autre table (`rdvs`, `finances`, `taches`, `devis`, `devis_lignes`, `ia_*`…) | **interdite** |

Autres invariants :

- **Un devis envoyé est figé.** Ses montants et ses textes ne sont jamais recalculés depuis
  le catalogue ; l'éditeur exige une confirmation explicite avant de réécrire un devis
  envoyé ou accepté.
- **Aucune normalisation silencieuse.** Les convertisseurs de `lib/mappers.ts` conservent
  la valeur stockée dès lors qu'elle est métier-équivalente : la base mélange `'€'` et
  `'EUR'`, `remise_type` `null` et `'montant'` — réécrire ces valeurs modifierait des
  documents déjà partis chez des patientes.
- **Le catalogue est en lecture seule.** Une prestation manquante est signalée à l'écran ;
  l'application ne crée jamais de ligne au catalogue.
- **La numérotation ne se calcule jamais côté navigateur.** La fonction Postgres atomique
  `nw_prochain_numero(type)` incrémente et renvoie `D-2026-000040` / `F-2026-000024`.
- Les rôles `chirurgien` et `anonyme` sont refusés par la base : ils n'accèdent pas à
  Nobel World.

## PDF

`components/DevisDoc.tsx` est un portage strict du composant d'origine, et
`app/globals.css` reprend la feuille de style de `index.html` caractère pour caractère.
**Toute retouche de ces deux fichiers change le document reçu par les patientes.**

Recette effectuée sur le devis `D-2026-000011` (Widmie Blanc, 4 000 €) : rendu comparé au
pixel près avec `index.html`, puis PDF A4 générés par les deux versions — **880 flux PDF
sur 880 identiques**, pagination 2 pages des deux côtés.

## Contrôles

```bash
npm run typecheck
npm run build
npx tsx scripts/verifier-mappage.ts instantane.json   # aller-retour colonnes ⇄ objets
```

`scripts/verifier-mappage.ts` rejoue chaque ligne réellement présente en base à travers
les convertisseurs (`row → objet → row`) et vérifie qu'aucune colonne n'est altérée. Il
attend un instantané JSON de la forme `{ "devis": [...], "factures": [...], "paiements":
[...], "options": [...], "patients": [...] }`.

## PWA & ancienne version

`index.html`, `Code.gs`, `manifest.json`, `sw.js` et les icônes restent à la racine :
l'ancienne version continue d'être servie par GitHub Pages pendant la durée des travaux.
Les mêmes fichiers PWA sont recopiés dans `public/` pour la version Next.js, avec des
chemins absolus. Le cache du service worker est passé en `v3`.

## Déploiement

Le projet Vercel `nobelworld-devis` (équipe Nobel Dent) est relié à ce dépôt. La branche
`claude/adoring-keller-qi3eez` est déployée en **préproduction** pour la recette du PDF ;
`main` n'est pas fusionnée tant que cette recette n'est pas validée, afin que GitHub Pages
continue de servir l'ancienne application.

## Session : ce qui la maintient ouverte

L'exigence métier est de rester connecté le plus longtemps possible. Trois pièces
y concourent, et aucune ne doit être retirée sans mesure préalable.

1. **`lib/supabase/client.ts`** — `persistSession` et `autoRefreshToken` explicites,
   et surtout des méthodes `getAll` / `setAll` maison. `@supabase/ssr` 0.5.2 écrase
   toute `maxAge` fournie ; fournir nos propres accès aux cookies est le seul moyen
   d'honorer la case « Rester connecté » et de marquer les cookies `Secure`.
2. **`lib/session.ts`** — au retour de l'utilisateur (`visibilitychange`, `focus`,
   `pageshow`, `online`) et toutes les 4 minutes, on relance `startAutoRefresh()` et
   on renouvelle le jeton s'il expire dans moins de 10 minutes. Le navigateur gèle
   les minuteurs des onglets en arrière-plan : sans ce rattrapage, on revient avec
   un jeton mort.
3. **`components/App.tsx`** — **une erreur passagère ne déconnecte jamais.** Seul un
   refus explicite (`AccesRefuseError` : profil absent, rôle interdit, compte
   désactivé) ferme la session. Tout le reste affiche un écran de reprise et
   réessaie par paliers. Un verrou de ré-entrance (`enCours`) empêche qu'un
   renouvellement de jeton relance un cycle de chargement, et inversement.

Banc d'essai : `faux-supabase.js` + `recette-session.js` (hors dépôt, décrits dans le
compte rendu de la consigne 02). Le jeton y expire en 20 s au lieu de 24 h, ce qui
permet de rejouer en quelques minutes ce qui prendrait une journée.

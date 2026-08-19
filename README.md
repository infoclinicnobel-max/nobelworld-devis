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
| `nw_catalogue_descriptions` | lecture (alimentée par le client, hors application) |
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
- **La description patient d'une prestation vit dans `nw_catalogue_descriptions`**, pas dans
  `catalogue_interventions.notes` : cette colonne porte du commentaire interne au CRM
  (arbitrages de tarif, doublons signalés) qui n'a rien à faire sur un document remis à une
  patiente. Appliquer un modèle **recopie** la description dans l'acte à cet instant ; elle
  n'est plus jamais relue ensuite. Une prestation sans description donne une case
  « Inclus / détail » vide, signalée à l'écran, jamais une erreur.
- **Une option ne gonfle pas le montant engagé.** Une option se décide en consultation :
  tant qu'elle n'est pas *retenue*, elle s'affiche avec son prix dans un bloc distinct et
  reste hors du total, de l'acompte et du reste à payer. ⚠ Le champ `retenue` **absent vaut
  `true`** — toutes les options écrites avant ce lot en sont dépourvues, et les lire comme
  non retenues retrancherait des montants de devis déjà acceptés. La lecture passe toujours
  par `estRetenue()` de `lib/calc.ts`, jamais par `o.retenue` en direct.
- **Le groupement et la recherche du catalogue vivent dans `lib/catalogue.ts`**, source unique
  des deux listes « Appliquer un modèle » (actes et options). La recherche porte aussi sur
  `synonymes`, ce qui permet de trouver « liposuccion 360 + BBL » quand la ligne s'appelle
  « SAFE BBL + Liposuccion Vaser HD 360° ».
- **Un modèle appliqué remplace, il ne concatène jamais.** Il remplit la première ligne vide
  de la section d'où la liste a été ouverte, sinon il en crée une neuve — libellé et détail
  dans deux champs distincts, pour un acte comme pour une option.
- **Le devis nourrit la fiche patiente, il ne la corrige pas.** Six champs — et six
  seulement — remontent vers `patients` : `dateOperation`, `dateDevis`, `medecin`,
  `budget`, `procedure` (au SINGULIER : c'est la colonne qu'affiche la carte patient ;
  `procedures` au pluriel est un vestige) et `stade`. La remontée part dès que **l'un** des
  deux signaux est vrai — un devis accepté **ou** un paiement — parce que le statut d'un
  document ne suit pas la réalité : des factures en brouillon portent des paiements
  encaissés. ⚠ `aPaye()` cherche par `patient_id` **et** par `facture_id` : 3 paiements sur
  12 n'ont pas de `patient_id`. `procedure` et `stade` sont marqués `silencieux` dans
  `CHAMPS_REMONTES` — un écart n'y est jamais signalé, un stade en avance étant le cours
  normal des choses. ⚠ **On n'écrit que dans un champ vide** (chaîne vide :
  ces colonnes sont `text NOT NULL DEFAULT ''`, un test `is null` ne trouverait rien). Une
  valeur du CRM différente n'est jamais écrasée : elle est affichée dans une fenêtre de
  divergence. `UPDATE` ciblé, jamais d'`INSERT` — un devis ne crée jamais une fiche.
  `patients.procedures` (pluriel) et `hopital` restent hors périmètre. Voir `lib/fiche.ts`.
- **La comparaison est normalisée, l'écriture ne l'est pas.** « Dr Anvar Ahmedov » et
  « Anvar Ahmedov » désignent le même praticien : les traiter comme un désaccord ferait
  crier l'alerte sur la moitié du fichier, et plus personne ne la lirait.
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
npx tsx scripts/totaux-devis.ts devis.json ref.json   # montants inchangés, devis par devis
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

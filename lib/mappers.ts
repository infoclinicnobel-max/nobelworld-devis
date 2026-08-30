/* Traduction colonnes Postgres ⇄ formes applicatives.
   Un seul endroit connaît les noms de colonnes : tout le reste de l'application
   continue de manipuler exactement les objets de index.html. */

import { curSymbol, normalizeDate } from './format';
import { DEFAULT_SETTINGS, type Settings } from './defaults';
import { mapRole, parseProfilePerms, type AppUser } from './perms';
import type {
  Arrete, DocRecord, HistoEntry, Medecin, Modele, Mouvement, OptionCat, Paiement, Patient,
} from './types';

type Row = Record<string, any>;

const str = (v: unknown) => (v == null ? '' : String(v));
const num = (v: unknown) => Number(v || 0);

/* ---------------------------------------------------------------- patients */

export function rowToPatient(r: Row): Patient {
  return {
    id: str(r.id),
    prenom: str(r.prenom),
    nom: str(r.nom),
    email: str(r.email),
    telephone: str(r.tel),
    pays: str(r.pays),
    ville: str(r.ville),
    commentaires: str(r.notes),
    procedure: str(r.procedure),
    stade: str(r.stade),
    createdBy: str(r.creePar),
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

export function patientToRow(p: Partial<Patient>, auteur: string): Row {
  const row: Row = {
    prenom: str(p.prenom),
    nom: str(p.nom),
    email: str(p.email),
    tel: str(p.telephone),
    pays: str(p.pays),
    ville: str(p.ville),
    notes: str(p.commentaires),
    updated_at: new Date().toISOString(),
  };
  if (p.id) row.id = p.id;
  else {
    /* Même forme d'identifiant que les fiches existantes créées par le CRM. */
    row.id = 'pat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    row.creePar = auteur;
    row.cree = new Date().toISOString().slice(0, 10);
  }
  return row;
}

/* ------------------------------------------------------ devis et factures */

/** Clés portées par le jsonb `contenu` (tout ce qui s'imprime et varie par document). */
const CONTENU_KEYS = [
  'actes', 'inc', 'exc', 'options', 'importantList', 'paiementNote', 'cgv', 'legal', 'important',
  'bqNom', 'bqIban', 'bqBic', 'bqAdresse', 'promoJours', 'modeleId', 'pagesMode', 'lignes', 'factNotes',
] as const;

function baseRowToDoc(r: Row): DocRecord {
  const contenu = (r.contenu && typeof r.contenu === 'object' ? r.contenu : {}) as Row;
  return {
    /* Ligne d'origine conservée telle quelle : à la réécriture, toute colonne dont la
       valeur métier n'a pas changé est renvoyée à l'identique. La base contient des
       écritures historiques hétérogènes ('€' et 'EUR', remise_type null et 'montant') :
       les normaliser en douce réécrirait des documents déjà partis chez des patientes. */
    _row: r,
    id: str(r.id),
    numero: str(r.numero),
    patientId: str(r.patient_id),
    date: normalizeDate(r.date),
    validite: normalizeDate(r.validite),
    dateIntervention: normalizeDate(r.date_intervention),
    chirurgien: str(r.chirurgien),
    hopital: str(r.hopital),
    statut: str(r.statut) || 'brouillon',
    devise: curSymbol(r.devise) || '€',
    acompte: num(r.acompte),
    forfait: num(r.forfait),
    remiseType: r.remise_type === 'pourcent' ? 'pourcent' : 'montant',
    remiseValeur: num(r.remise_valeur),
    remiseMotif: str(r.remise_motif),
    createdBy: str(r.cree_par),
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
    ...contenu,
  };
}

export function rowToDevis(r: Row): DocRecord {
  return baseRowToDoc(r);
}

export function rowToFacture(r: Row): DocRecord {
  return {
    ...baseRowToDoc(r),
    numeroDevis: str(r.numero_devis),
    devisId: r.devis_id ? str(r.devis_id) : '',
    typeFacture: str(r.type_facture),
    noteInterne: str(r.note_interne),
  };
}

/* ---- Préservation de l'ABSENCE du champ `retenue` ----

   `estRetenue()` protège la LECTURE : une option sans le champ compte dans le
   total. Mais rien ne protégeait l'ÉCRITURE. Un enregistrement qui pose
   `retenue: false` sur une option héritée la fait sortir du total, et le devis
   change de montant sans que personne ne l'ait décidé — c'est ce qui a fait
   passer D-2026-000040 de 10 500 € à 8 500 €, puis engendré une facture à
   8 500 €.

   Règle : une option qui n'avait pas le champ n'en reçoit pas un tant que sa
   valeur reste `false`. Seul un `true`, ou une option neuve, écrit la clé.
   Le rapprochement se fait par `id` quand il existe, par rang sinon — les
   options d'avant ce lot n'ont pas d'identifiant. */
function preserverAbsenceRetenue(d: DocRecord, options: unknown): unknown {
  if (!Array.isArray(options)) return options;
  const avant = (((d._row as Row | undefined)?.contenu as Row | undefined)?.options ?? []) as Row[];
  if (!Array.isArray(avant) || !avant.length) return options;
  const parId = new Map<string, Row>();
  avant.forEach((o) => { if (o && typeof o.id === 'string') parId.set(o.id, o); });

  return (options as Row[]).map((o, i) => {
    if (!o || typeof o !== 'object' || o.retenue !== false) return o;
    const origine = (typeof o.id === 'string' && parId.get(o.id)) || avant[i];
    // L'option existait-elle, et sans le champ ? Alors on ne le crée pas.
    if (origine && typeof origine === 'object' && !('retenue' in origine)) {
      const { retenue, ...reste } = o;
      void retenue;
      return reste;
    }
    return o;
  });
}

/* ---- Clés remplies « par défaut » à l'ouverture de l'éditeur ----

   buildForm() pré-remplit un formulaire vierge depuis les Paramètres. Rouvrir
   un ANCIEN document faisait donc repartir ces défauts à l'enregistrement :
   - `promoJours` : neuf devis portent 15, cinq portent 8. Rouvrir un devis à
     15 jours le ramenait au défaut courant — la mention de validité changeait
     sur un document déjà remis, sans que rien ne le signale ;
   - `bqIban` et consorts : D-2026-000028 et D-2026-000034 n'en ont pas et en
     recevaient un à la réouverture.

   Le défaut sert aux documents NEUFS. Sur un document déjà en base :
   - `promoJours` est gelé sur la valeur stockée (aucune interface ne le règle,
     toute variation ne peut donc venir que du défaut) ;
   - les coordonnées bancaires ne sont pas CRÉÉES si elles étaient absentes,
     mais restent modifiables quand elles existent — le bouton « actualiser les
     coordonnées bancaires » des factures doit continuer de fonctionner. */
const CLES_GELEES = ['promoJours'] as const;
const CLES_NON_CREEES = ['bqNom', 'bqIban', 'bqBic', 'bqAdresse'] as const;

function contenuAncien(d: DocRecord): Row | null {
  const raw = d._row as Row | undefined;
  if (!raw || raw.id !== d.id) return null;                 // document neuf
  const c = raw.contenu;
  return c && typeof c === 'object' ? (c as Row) : null;
}

function contenuOf(d: DocRecord): Row {
  const ancien = contenuAncien(d);
  const c: Row = {};
  for (const k of CONTENU_KEYS) {
    const v = (d as Row)[k];
    if (v === undefined) continue;
    if (k === 'options') { c[k] = preserverAbsenceRetenue(d, v); continue; }
    if (ancien) {
      if ((CLES_GELEES as readonly string[]).includes(k)) {
        if (k in ancien) c[k] = ancien[k];                  // gelé sur le stocké
        continue;                                           // absent → reste absent
      }
      if ((CLES_NON_CREEES as readonly string[]).includes(k) && !(k in ancien)) continue;
    }
    c[k] = v;
  }
  return c;
}

/** Date « propre » : YYYY-MM-DD ou null — jamais de chaîne vide dans une colonne `date`. */
const dateCol = (v: unknown): string | null => {
  const n = normalizeDate(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(n) ? n : null;
};

/* La base conserve la devise en code ISO ; l'affichage la retraduit en symbole. */
const CODE_BY_SYMBOL: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP', '₺': 'TRY' };
const deviseCol = (v: unknown) => {
  const raw = String(v ?? '').trim();
  return CODE_BY_SYMBOL[raw] || raw.toUpperCase() || 'EUR';
};

/** Renvoie la valeur stockée si elle est métier-équivalente à la nouvelle. */
function conserver(d: DocRecord, col: string, nouvelle: unknown, equivalent: (stockee: any) => boolean) {
  const raw = d._row as Row | undefined;
  if (raw && raw.id === d.id && col in raw && equivalent(raw[col])) return raw[col];
  return nouvelle;
}

export function devisToRow(d: DocRecord, auteur: string): Row {
  const typeRemise = d.remiseType === 'pourcent' ? 'pourcent' : 'montant';
  return {
    id: d.id,
    numero: conserver(d, 'numero', d.numero || null, (v) => str(v) === str(d.numero)),
    patient_id: str(d.patientId),
    date: dateCol(d.date),
    validite: dateCol(d.validite),
    date_intervention: dateCol(d.dateIntervention),
    chirurgien: str(d.chirurgien),
    hopital: str(d.hopital),
    statut: str(d.statut) || 'brouillon',
    devise: conserver(d, 'devise', deviseCol(d.devise), (v) => curSymbol(v) === curSymbol(d.devise)),
    acompte: num(d.acompte),
    forfait: num(d.forfait),
    remise_type: conserver(d, 'remise_type', typeRemise, (v) => (v === 'pourcent' ? 'pourcent' : 'montant') === typeRemise),
    remise_valeur: num(d.remiseValeur),
    remise_motif: conserver(d, 'remise_motif', d.remiseMotif ? str(d.remiseMotif) : null, (v) => str(v) === str(d.remiseMotif)),
    contenu: contenuOf(d),
    cree_par: str(d.createdBy) || auteur,
    updated_at: new Date().toISOString(),
  };
}

export function factureToRow(f: DocRecord, auteur: string): Row {
  const txt = (col: string, v: unknown) => conserver(f, col, v ? str(v) : null, (st) => str(st) === str(v));
  return {
    ...devisToRow(f, auteur),
    numero_devis: txt('numero_devis', f.numeroDevis),
    devis_id: txt('devis_id', f.devisId),
    type_facture: txt('type_facture', f.typeFacture),
    note_interne: txt('note_interne', f.noteInterne),
  };
}

/* ------------------------------------------------------------- paiements */

export function rowToPaiement(r: Row): Paiement {
  return {
    _row: r,
    id: str(r.id),
    refId: r.facture_id ? str(r.facture_id) : null,
    refNum: str(r.ref_num),
    patientId: r.patient_id ? str(r.patient_id) : null,
    montant: num(r.montant),
    date: normalizeDate(r.date),
    mode: str(r.mode),
    type: str(r.type) || 'paiement',
    devise: curSymbol(r.devise) || '€',
    note: str(r.note),
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

export function paiementToRow(p: Partial<Paiement>): Row {
  const raw = p._row as Row | undefined;
  const garder = (col: string, nouvelle: unknown, equivalent: (v: any) => boolean) =>
    raw && raw.id === p.id && col in raw && equivalent(raw[col]) ? raw[col] : nouvelle;
  const txt = (col: string, v: unknown) => garder(col, v ? str(v) : null, (st) => str(st) === str(v));
  return {
    id: p.id,
    facture_id: p.refId || null,
    ref_num: txt('ref_num', p.refNum),
    patient_id: p.patientId || null,
    montant: num(p.montant),
    date: dateCol(p.date),
    mode: txt('mode', p.mode),
    type: txt('type', p.type),
    devise: garder('devise', deviseCol(p.devise), (v) => curSymbol(v) === curSymbol(p.devise)),
    note: txt('note', p.note),
    updated_at: new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- options */

export function rowToOption(r: Row): OptionCat {
  return { id: str(r.id), nom: str(r.nom), prix: num(r.prix), actif: r.actif !== false };
}

export function optionToRow(o: Partial<OptionCat>): Row {
  return {
    id: o.id || 'opt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    nom: str(o.nom),
    prix: num(o.prix),
    actif: o.actif !== false,
    updated_at: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------- historique */

export function rowToHisto(r: Row): HistoEntry {
  return { id: str(r.id), date: r.date || '', user: str(r.utilisateur), message: str(r.message) };
}

export function histoToRow(h: Partial<HistoEntry>): Row {
  return {
    id: h.id || 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: h.date || new Date().toISOString(),
    utilisateur: str(h.user),
    message: str(h.message),
  };
}

/* ---------------------------------------- catalogue (modèles, lecture seule) */

export function rowToModele(r: Row): Modele {
  const promo = r.tarif_promo_eur == null ? null : Number(r.tarif_promo_eur);
  const std = r.tarif_standard_eur == null ? null : Number(r.tarif_standard_eur);
  return {
    id: str(r.id),
    nom: str(r.libelle_fr),
    categorie: str(r.categorie),
    sousCategorie: str(r.sous_categorie),
    nature: str(r.nature),
    prixBase: promo ?? std ?? 0,
    prixStandard: std,
    surDevis: r.tarif_sur_devis === true,
    /* ATTENTION — ne JAMAIS remettre `notes` ici. C'est du commentaire interne du
       CRM (« Repris de Nobel World le 2026-08-10, tarif Nobel World retenu »,
       « DISTINCT du package 5 malgré la ressemblance ») : 20 des 75 lignes en
       portent, et cela partait mot pour mot dans la case « INCLUS / DÉTAIL » du
       PDF remis à la patiente. La description vient de nw_catalogue_descriptions,
       injectée par chargerTout(). */
    description: '',
    notesInternes: str(r.notes),
    /* `synonymes` est un text[] Postgres (et non un jsonb comme inclusions/exclusions).
       Il ne s'affiche nulle part : il élargit seulement la recherche du sélecteur. */
    synonymes: Array.isArray(r.synonymes) ? r.synonymes.map(String) : [],
    inc: Array.isArray(r.inclusions) ? r.inclusions.map(String) : [],
    exc: Array.isArray(r.exclusions) ? r.exclusions.map(String) : [],
    dureeJours: r.duree_sejour_jours == null ? null : Number(r.duree_sejour_jours),
    dureeNuits: r.duree_nuits == null ? null : Number(r.duree_nuits),
    actif: r.actif !== false,
    ordre: r.ordre == null ? null : Number(r.ordre),
  };
}

/* ------------------------------------------------- caisse (lot 73, 30/08) */

/* `finances` est la table du CRM, tout en texte, colonnes camelCase citées
   ("patientId", "creePar"). Le montant RESTE du texte : la conversion vit dans
   lib/caisse.ts, et une valeur illisible se signale au lieu de devenir NaN. */
export function rowToMouvement(r: Row): Mouvement {
  return {
    _row: r,
    id: str(r.id),
    patientId: str(r.patientId),
    type: str(r.type),
    procedure: str(r.procedure),
    montant: str(r.montant),
    date: str(r.date),
    statut: str(r.statut),
    methode: str(r.methode),
    creePar: str(r.creePar),
    devise: str(r.devise),
    notes: str(r.notes),
    sens: str(r.sens),
    lieu: str(r.lieu),
    montantContrepartie: str(r.montant_contrepartie),
    deviseContrepartie: str(r.devise_contrepartie),
    createdAt: r.created_at || undefined,
    updatedAt: r.updated_at || undefined,
  };
}

/* ⚠ Les obligations du lot 73 vivent ICI, dans l'écrivain — pas en base, où
   `NOT NULL DEFAULT ''` laisse le monolithe insérer sans les nommer :
   · sens, lieu, devise OBLIGATOIRES — la devise facultative est la dette
     qu'on vient de payer, la reproduire serait impardonnable ;
   · montant LISIBLE et date ISO — jamais un texte qui sortira des totaux ;
   · un change porte sa contrepartie (montant lisible + devise) ; tout autre
     sens repart avec une contrepartie VIDE ;
   · updated_at posé À LA MAIN : finances n'a aucun déclencheur. */
export function mouvementToRow(m: Partial<Mouvement>, auteur: string): Row {
  const sens = str(m.sens);
  const lieu = str(m.lieu);
  const devise = str(m.devise).trim();
  if (!['entree', 'sortie', 'change', 'remise'].includes(sens)) {
    throw new Error(`Mouvement refusé : sens « ${sens} » inconnu (entree, sortie, change, remise).`);
  }
  if (!['caisse', 'compte'].includes(lieu)) {
    throw new Error(`Mouvement refusé : lieu « ${lieu} » inconnu (caisse, compte).`);
  }
  if (!devise) throw new Error('Mouvement refusé : la devise est obligatoire.');
  const montant = str(m.montant).trim();
  if (!/^-?[0-9]+([.,][0-9]+)?$/.test(montant)) {
    throw new Error(`Mouvement refusé : montant « ${montant} » illisible.`);
  }
  const date = normalizeDate(m.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Mouvement refusé : la date du mouvement est obligatoire (AAAA-MM-JJ).');
  }
  let contrepartie = '';
  let deviseContrepartie = '';
  if (sens === 'change') {
    contrepartie = str(m.montantContrepartie).trim();
    deviseContrepartie = str(m.deviseContrepartie).trim();
    if (!/^-?[0-9]+([.,][0-9]+)?$/.test(contrepartie) || !deviseContrepartie) {
      throw new Error('Change refusé : la contrepartie (montant obtenu + devise) est obligatoire.');
    }
    if (deviseContrepartie === devise) {
      throw new Error('Change refusé : les deux devises sont identiques — un change traverse les devises.');
    }
  }
  return {
    id: m.id,
    patientId: str(m.patientId),
    type: str(m.type),
    procedure: str(m.procedure),
    montant,
    date,
    statut: str(m.statut) || 'Complété',
    methode: str(m.methode),
    creePar: str(m.creePar) || auteur,
    devise,
    notes: str(m.notes),
    sens,
    lieu,
    montant_contrepartie: contrepartie,
    devise_contrepartie: deviseContrepartie,
    updated_at: new Date().toISOString(),
  };
}

/* Un arrêté est IMMUABLE : insertion seule, pas d'updated_at. L'écart est
   recalculé ici — une seule formule, jamais deux. */
export function rowToArrete(r: Row): Arrete {
  return {
    id: str(r.id),
    date: str(r.date),
    devise: str(r.devise),
    montantCompte: num(r.montant_compte),
    montantCalcule: num(r.montant_calcule),
    ecart: num(r.ecart),
    par: str(r.par),
    notes: str(r.notes),
    createdAt: r.created_at || undefined,
  };
}
export function arreteToRow(a: Partial<Arrete>): Row {
  const date = normalizeDate(a.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Arrêté refusé : la date du comptage est obligatoire.');
  const devise = str(a.devise).trim();
  if (!devise) throw new Error('Arrêté refusé : la devise est obligatoire.');
  const compte = Number(a.montantCompte);
  const calcule = Number(a.montantCalcule);
  if (!Number.isFinite(compte) || !Number.isFinite(calcule)) {
    throw new Error('Arrêté refusé : montant compté et montant calculé doivent être des nombres.');
  }
  return {
    id: a.id,
    date,
    devise,
    montant_compte: Math.round(compte * 100) / 100,
    montant_calcule: Math.round(calcule * 100) / 100,
    ecart: Math.round((compte - calcule) * 100) / 100,
    par: str(a.par),
    notes: str(a.notes),
  };
}

/* ---------------------------------------------- médecins (lecture seule) */

/* Deux colonnes seulement : l'identifiant et le libellé canonique. Sert au
   geste « J'ai payé » — la règle Zeynalov-en-euros se lit sur l'identifiant,
   jamais sur un texte (lib/caisse.ts). */
export function rowToMedecin(r: Row): Medecin {
  return { id: str(r.id), nomAffiche: str(r.nomAffiche).trim() };
}

/* ------------------------------------------------- profils (lecture seule) */

export function rowToUser(r: Row): AppUser {
  const roleBase = str(r.role);
  const role = mapRole(roleBase);
  return {
    id: str(r.id),
    authUserId: r.auth_user_id ? str(r.auth_user_id) : null,
    prenom: str(r.prenom),
    nom: str(r.nom),
    email: str(r.email),
    telephone: str(r.telephone),
    fonction: str(r.fonction),
    role,
    roleBase,
    statut: str(r.statut),
    photo: str(r.photo),
    perms: parseProfilePerms(r.perms, role, r.scopes),
    color: str(r.color),
    cree: str(r.cree),
  };
}

/* ------------------------------------------------------------- paramètres */

/* `nw_parametres.societe` porte les clés historiques (nom, site, adresse…) partagées
   avec le CRM. On les lit ET on les réécrit, en ajoutant à côté les réglages propres
   à Nobel World. Aucune clé existante n'est supprimée. */
const LEGACY_FROM: Record<string, string> = {
  nom: 'company', site: 'website', adresse: 'address', devise: 'currency',
  tagline: 'tagline', email: 'email', telephone: 'phone',
};
const LEGACY_TO: Record<string, string> = {
  company: 'nom', website: 'site', address: 'adresse', currency: 'devise',
  tagline: 'tagline', email: 'email', phone: 'telephone',
};

export function valeurToSettings(valeur: Row | null | undefined): Settings {
  const v = (valeur || {}) as Row;
  const out: Row = { ...DEFAULT_SETTINGS };
  for (const [legacy, appKey] of Object.entries(LEGACY_FROM)) {
    if (v[legacy] !== undefined && v[legacy] !== null && v[legacy] !== '') out[appKey] = v[legacy];
  }
  for (const [k, val] of Object.entries(v)) {
    if (LEGACY_FROM[k] !== undefined) continue;
    if (val !== undefined) out[k] = val;
  }
  return out as Settings;
}

export function settingsToValeur(s: Settings, previous: Row | null | undefined): Row {
  const out: Row = { ...(previous || {}) };
  for (const [k, val] of Object.entries(s)) {
    out[k] = val;
    const legacy = LEGACY_TO[k];
    if (legacy) out[legacy] = val;
  }
  return out;
}

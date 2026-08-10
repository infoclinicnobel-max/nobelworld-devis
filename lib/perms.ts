/* =========================================================================
   PERMISSIONS (RBAC) — les 26 permissions et les préréglages de index.html,
   branchés sur la colonne `perms` de `profiles` (lecture seule : la gestion
   des comptes reste au CRM Clinic Nobel).
   ------------------------------------------------------------------------- */

export type PermKey = string;
export type PermMap = Record<PermKey, boolean>;

export interface AppUser {
  id: string;
  authUserId: string | null;
  prenom: string;
  nom: string;
  email: string;
  telephone: string;
  fonction: string;
  /** rôle applicatif Nobel World (pdg / commerciale / coordinatrice / lecture / limite) */
  role: string;
  /** rôle brut stocké dans profiles (admin / commerciale / coordinatrice / chirurgien…) */
  roleBase: string;
  statut: string;
  photo: string;
  perms: PermMap;
  color?: string;
  cree?: string;
}

/* Permissions « Voir » des modules : ajoutées avec continuité (migration douce) —
   les rôles existants gardent exactement les accès qu'ils avaient avant l'application
   des verrous de navigation. */
const VIEW_KEYS_ALL: PermMap = {
  dashboardView: true, devisView: true, facturesView: true, patientsView: true,
  modelesView: true, optionsView: true, histoView: true, paramView: true,
};

export const ROLES: Record<string, { label: string; can: PermMap & { all?: boolean } }> = {
  pdg: { label: 'PDG / Administrateur', can: { all: true } },
  commerciale: {
    label: 'Commerciale',
    can: {
      ...VIEW_KEYS_ALL,
      devisCreate: true, devisEditOwn: true, devisSend: true, devisDuplicate: true, devisDelete: true,
      patientCreate: true, patientEdit: true, patientDelete: true,
      factureCreate: true, factureDelete: true, viewOwnStats: true, pdf: true, paymentView: true,
      scheduleEdit: true, remiseEdit: true, montantsEdit: true, pagesEdit: true,
      catalogManage: true,
    },
  },
  coordinatrice: {
    label: 'Coordinatrice médicale',
    can: {
      ...VIEW_KEYS_ALL,
      devisViewAll: true, devisEditAll: true, devisDelete: true,
      patientViewAll: true, patientEdit: true, patientDelete: true,
      factureCreate: true, factureDelete: true,
      paymentEdit: true, scheduleEdit: true, remiseEdit: true, montantsEdit: true,
      pagesEdit: true, pdf: true,
      catalogManage: true,
    },
  },
  lecture: {
    label: 'Lecture seule',
    can: {
      ...VIEW_KEYS_ALL, paramView: false,
      devisViewAll: true, patientViewAll: true, paymentView: true, pdf: true,
    },
  },
  limite: {
    label: 'Utilisateur limité',
    /* aucun accès par défaut — uniquement les modules cochés par l'administrateur */
    can: {},
  },
};

export function can(user: Partial<AppUser> | null | undefined, perm: PermKey): boolean {
  if (!user) return false;
  if (user.perms && Object.prototype.hasOwnProperty.call(user.perms, perm)) return !!user.perms[perm];
  const r = ROLES[user.role as string];
  if (!r) return false;
  return r.can.all === true || !!r.can[perm];
}

export function isAdmin(user: Partial<AppUser> | null | undefined): boolean {
  return !!user && (user.role === 'pdg' || can(user, 'usersManage'));
}

export function userLabel(u: Partial<AppUser> | null | undefined): string {
  if (!u) return '—';
  const n = `${(u.prenom || '').trim()} ${(u.nom || '').trim()}`.trim();
  return n || u.email || '—';
}

/* Catalogue des permissions ajustables (libellés FR -> clés internes) */
export const PERMS: { g: string; items: [string, string][] }[] = [
  { g: 'Tableau de bord', items: [['dashboardView', 'Voir le tableau de bord']] },
  {
    g: 'Devis',
    items: [
      ['devisView', 'Voir le module Devis'], ['devisViewAll', 'Voir tous les devis (sinon : les siens)'],
      ['devisCreate', 'Créer un devis'], ['devisEditOwn', 'Modifier ses propres devis'],
      ['devisEditAll', 'Modifier tous les devis'],
      ['devisDuplicate', 'Dupliquer un devis'], ['devisDelete', 'Supprimer un devis'],
      ['montantsEdit', 'Modifier les montants (forfait, acompte)'],
      ['scheduleEdit', "Modifier la date d'opération"],
      ['remiseEdit', 'Ajouter / modifier une remise promotionnelle'],
      ['pagesEdit', 'Choisir le nombre de pages du PDF'],
    ],
  },
  {
    g: 'Factures',
    items: [
      ['facturesView', 'Voir le module Factures'], ['factureCreate', 'Créer une facture'],
      ['factureDelete', 'Supprimer une facture'],
    ],
  },
  {
    g: 'Paiements',
    items: [
      ['paymentView', 'Voir les paiements, acomptes et soldes'],
      ['paymentEdit', 'Ajouter / modifier / supprimer un paiement'],
    ],
  },
  {
    g: 'Patients',
    items: [
      ['patientsView', 'Voir le module Patients'],
      ['patientViewAll', 'Voir tous les patients (sinon : les siens)'],
      ['patientCreate', 'Créer un patient'], ['patientEdit', 'Modifier un patient'],
      ['patientDelete', 'Supprimer un patient'],
    ],
  },
  {
    g: 'Bibliothèque (modèles & options)',
    items: [
      ['modelesView', 'Voir les modèles de devis'], ['optionsView', 'Voir les options'],
      ['catalogManage', 'Créer / modifier / supprimer modèles et options'],
    ],
  },
  {
    g: 'Paramètres',
    items: [
      ['paramView', 'Accéder aux Paramètres (Société, Paiement & légal, Textes PDF)'],
      ['paramEdit', 'Modifier et enregistrer ces paramètres'],
      ['connexionView', 'Accéder aux paramètres de connexion (admin)'],
    ],
  },
  {
    g: 'Utilisateurs & historique',
    items: [
      ['usersManage', 'Gérer les utilisateurs et leurs permissions (admin)'],
      ['histoView', "Voir l'historique"],
    ],
  },
  { g: 'Autres', items: [['pdf', 'Imprimer / exporter les PDF'], ['viewOwnStats', 'Voir ses statistiques']] },
];

/* Permissions « lecture » utilisées par le préréglage Lecture seule */
export const READ_KEYS = [
  'dashboardView', 'devisView', 'devisViewAll', 'facturesView', 'patientsView', 'patientViewAll',
  'modelesView', 'optionsView', 'histoView', 'paymentView', 'pdf', 'viewOwnStats',
];

/* Droit de VOIR un module (navigation + routeur). Protège aussi contre l'accès
   par URL directe ou rechargement : le routeur passe systématiquement par ici. */
const VIEW_PERM: Record<string, string> = {
  dashboard: 'dashboardView', devis: 'devisView', factures: 'facturesView',
  patients: 'patientsView', modeles: 'modelesView', options: 'optionsView',
  utilisateurs: 'usersManage', historique: 'histoView', parametres: 'paramView',
};

export function canView(user: Partial<AppUser> | null | undefined, viewKey: string): boolean {
  if (can(user, 'all')) return true;
  if (viewKey === 'paiements') return can(user, 'paymentView') || can(user, 'paymentEdit');
  const p = VIEW_PERM[viewKey];
  return p ? can(user, p) : true;
}

export function roleDefaultPerms(role: string): PermMap {
  const m: PermMap = {};
  PERMS.forEach((grp) => grp.items.forEach(([k]) => { m[k] = can({ role } as Partial<AppUser>, k); }));
  return m;
}

/* =========================================================================
   Pont profiles → Nobel World
   ------------------------------------------------------------------------- */

/** Rôle CRM → rôle applicatif Nobel World. */
export function mapRole(roleBase: string): string {
  switch (String(roleBase || '').toLowerCase()) {
    case 'admin':
    case 'pdg':
      return 'pdg';
    case 'commerciale':
    case 'commercial':
      return 'commerciale';
    case 'coordinatrice':
    case 'coordinateur':
      return 'coordinatrice';
    case 'lecture':
      return 'lecture';
    default:
      return 'limite';
  }
}

/** Les rôles refusés en base (policies RLS) : le chirurgien n'accède pas à Nobel World. */
export const ROLES_SANS_ACCES = ['chirurgien', 'anonyme'];

type CrmModulePerm = { view?: boolean; add?: boolean; edit?: boolean; delete?: boolean };

/* `profiles.perms` porte deux formes possibles :
   – la forme CRM { module: {view,add,edit,delete} }, seule présente aujourd'hui ;
   – la forme plate Nobel World { devisCreate:true, … }, si le CRM la stocke un jour.
   On accepte les deux ; la forme plate a toujours le dernier mot. */
export function parseProfilePerms(raw: unknown, role: string): PermMap {
  let obj: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw.trim()) {
    try { obj = JSON.parse(raw); } catch { obj = {}; }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  const keys = Object.keys(obj);
  if (!keys.length) return {};

  const flat: PermMap = {};
  const crm: Record<string, CrmModulePerm> = {};
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'boolean') flat[k] = v;
    else if (v && typeof v === 'object') crm[k] = v as CrmModulePerm;
  }

  const out: PermMap = {};
  if (Object.keys(crm).length) Object.assign(out, crmToNobelWorld(crm, role));
  Object.assign(out, flat);
  return out;
}

/** Traduit les modules CRM vers les 26 permissions Nobel World. */
function crmToNobelWorld(crm: Record<string, CrmModulePerm>, role: string): PermMap {
  const m = (k: string): CrmModulePerm => crm[k] || {};
  const base = roleDefaultPerms(role);
  const devis = m('devis'), factures = m('factures'), patients = m('patients');
  const paiements = m('paiements'), finances = m('finances'), dashboard = m('dashboard');
  const equipe = m('equipe'), analyses = m('analyses');

  const has = (p: CrmModulePerm, f: keyof CrmModulePerm) => p[f] === true;
  const known = (k: string) => Object.prototype.hasOwnProperty.call(crm, k);

  const out: PermMap = { ...base };
  if (known('dashboard')) out.dashboardView = has(dashboard, 'view');
  if (known('devis')) {
    out.devisView = has(devis, 'view');
    out.devisCreate = has(devis, 'add');
    out.devisEditOwn = has(devis, 'edit');
    out.devisDuplicate = has(devis, 'add');
    out.devisDelete = has(devis, 'delete');
  }
  if (known('factures')) {
    out.facturesView = has(factures, 'view');
    out.factureCreate = has(factures, 'add');
    out.factureDelete = has(factures, 'delete');
  }
  if (known('patients')) {
    out.patientsView = has(patients, 'view');
    out.patientCreate = has(patients, 'add');
    out.patientEdit = has(patients, 'edit');
    out.patientDelete = has(patients, 'delete');
  }
  if (known('paiements') || known('finances')) {
    out.paymentView = has(paiements, 'view') || has(finances, 'view');
    out.paymentEdit = has(paiements, 'edit') || has(paiements, 'add') || has(finances, 'edit');
  }
  if (known('analyses')) out.viewOwnStats = has(analyses, 'view');
  if (known('equipe')) out.usersManage = has(equipe, 'edit');
  return out;
}

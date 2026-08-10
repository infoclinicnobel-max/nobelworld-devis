/* Textes & options PDF par défaut — repris mot pour mot de index.html.
   Modifiables dans Paramètres → Modèles PDF. Servent de modèles pour les NOUVEAUX
   devis/factures (photographiés dans chaque document à sa création). */

export const PDF_TEXTS = {
  validiteJours: 30,
  validitePromoJours: 8,
  promoActive: true,
  importantDefault:
    "Ce devis est valable 30 jours.\nLe plan opératoire définitif est confirmé après consultation et validation médicale.\nLes billets d'avion ne sont pas inclus.\nToute modification médicale nécessaire sera décidée exclusivement par le chirurgien dans l'intérêt de la sécurité du patient.",
  cgv:
    "Le présent devis en promotion est valable 8 jours. Un acompte confirme la réservation de la date opératoire. Le solde est réglé avant l'intervention. Les tarifs incluent uniquement les prestations listées.\n\nLe patient s'engage à fournir des informations médicales exactes, à transmettre les examens préopératoires demandés et à signaler tout traitement médical en cours ou toute modification de son état de santé.\n\nLa date d'intervention est confirmée après réception de l'acompte. En cas de nécessité, la date de l'intervention pourra être reportée ou modifiée d'un commun accord entre le patient et Clinic NobelWorld, sans perte de l'acompte.\n\nLes résultats d'une intervention chirurgicale varient selon chaque patient et ne peuvent être garantis. Un suivi postopératoire conforme aux recommandations du chirurgien est indispensable afin d'assurer une prise en charge optimale.",
  paiementNote:
    'Acompte à la réservation par virement. Le solde est payable à votre arrivée à la clinique. Modes de paiement : espèces (€).',
  libAcompte: 'Acompte à la réservation',
  libSolde: 'Reste à payer',
  incDefault:
    "Honoraires du chirurgien et de l'anesthésiste\nBloc opératoire et hospitalisation\nConsultation préopératoire et analyses sanguines\nMédicaments pendant l'hospitalisation\nTraducteur médical francophone\nSuivi postopératoire et contrôles\nCorset médical, bas de contention et coussin BBL\nHôtel 5★ avec petit-déjeuner\nTransferts VIP : Aéroport ⇄ Hôtel ⇄ Clinique\n1 accompagnant inclus",
  excDefault: "Billets d'avion / vols internationaux\nDépenses personnelles",
  legal: "Clinic NobelWorld — Tourisme médical. Document non contractuel à valeur d'estimation.",
  signature: 'Signature du patient — précédée de la mention « Lu et approuvé »',
  showImportant: true,
  showNotes: true,
  showQR: true,
  showSignature: true,
  optVolsExclus: true,
  optHotelInclus: true,
  optTransfertsInclus: true,
  /* ---- Modèle PDF FACTURE : textes totalement indépendants du devis ---- */
  factImportant:
    "Le règlement de la présente facture vaut acceptation des prestations listées.\nToute réclamation doit être adressée par écrit sous 8 jours à compter de la date de facture.",
  factNotes:
    "Facture établie par Clinic NobelWorld pour les prestations médicales et d'accompagnement détaillées ci-dessus. Les acomptes versés et les paiements enregistrés sont déduits du solde restant dû. Sauf accord écrit contraire, le solde est payable avant l'intervention.",
  factLegal: 'Document tenant lieu de facture.',
  factFooter: '',
};

export const DEFAULT_SETTINGS = {
  company: 'Clinic NobelWorld',
  tagline: 'Tourisme médical · Istanbul',
  address: 'Avrasya Hastanesi — Istanbul, Türkiye',
  phone: '+90 ___ ___ __ __',
  whatsapp: '+90 ___ ___ __ __',
  email: 'contact@clinicnobel.world',
  website: 'www.clinicnobel.world',
  bankName: '',
  bankAddress: '',
  iban: '',
  bic: '',
  vat: '',
  logo: '',
  currency: '€',
  docTitle: 'DEVIS MÉDICAL PREMIUM',
  important:
    "Le patient s'engage à fournir un bilan médical complet et à signaler tout traitement en cours. Les dates d'intervention sont confirmées après réception de l'acompte. En cas d'annulation à moins de 7 jours, l'acompte reste acquis. Les résultats peuvent varier d'un patient à l'autre ; aucun résultat n'est garanti. Un suivi post-opératoire est requis.",
  sessionJours: '30',
  /* `cgv` et `legal` viennent de PDF_TEXTS : dans index.html, le spread écrasait
     déjà les valeurs déclarées au-dessus. Les garder ici n'aurait aucun effet. */
  ...PDF_TEXTS,
};

export type Settings = typeof DEFAULT_SETTINGS & Record<string, unknown>;

/* Valeurs de départ pour un NOUVEAU devis premium (pré-remplies, modifiables) */
export const DEFAULT_INC = [
  "Honoraires du chirurgien et de l'anesthésiste",
  'Bloc opératoire et hospitalisation',
  'Consultation préopératoire et analyses sanguines',
  "Médicaments pendant l'hospitalisation",
  'Traducteur médical francophone',
  'Suivi postopératoire et contrôles',
  'Corset médical, bas de contention et coussin BBL',
  'Hôtel 5★ avec petit-déjeuner',
  'Transferts VIP : Aéroport ⇄ Hôtel ⇄ Clinique',
  '1 accompagnant inclus',
];

export const DEFAULT_IMPORTANT = [
  'Ce devis est valable 30 jours.',
  'Le plan opératoire définitif est confirmé après consultation et validation médicale.',
  "Les billets d'avion ne sont pas inclus.",
  "Toute modification médicale nécessaire sera décidée exclusivement par le chirurgien dans l'intérêt de la sécurité du patient.",
];

export const DEFAULT_PAIEMENT_NOTE =
  'Acompte à la réservation par virement. Le solde est payable à votre arrivée à la clinique. Modes de paiement : espèces (€).';

/* Lignes de conditions issues des Paramètres (repli : défauts intégrés) */
export function settingsImpLines(P: Partial<Settings> | null | undefined): string[] {
  const l = String((P && P.importantDefault) || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  return l.length ? l : [...DEFAULT_IMPORTANT];
}

/* Prestations incluses / non incluses par défaut, composées selon les options du forfait */
export function composeIncExc(P: Partial<Settings> | null | undefined): { inc: string[]; exc: string[] } {
  const S = P || {};
  const _lines = (t: unknown) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const _has = (x: string, ws: string[]) => ws.some((w) => x.toLowerCase().includes(w));
  let incD = _lines(S.incDefault);
  if (!incD.length) incD = [...DEFAULT_INC];
  let excD = _lines(S.excDefault);
  if (S.optHotelInclus === false) {
    incD = incD.filter((x) => !_has(x, ['hôtel', 'hotel']));
    if (!excD.some((x) => _has(x, ['hôtel', 'hotel']))) excD.push("Hébergement à l'hôtel");
  }
  if (S.optTransfertsInclus === false) {
    incD = incD.filter((x) => !_has(x, ['transfert']));
    if (!excD.some((x) => _has(x, ['transfert']))) excD.push('Transferts aéroport / hôtel / clinique');
  }
  if (S.optVolsExclus === false) {
    excD = excD.filter((x) => !_has(x, ['avion', 'vol']));
  } else if (!excD.some((x) => _has(x, ['avion', 'vol']))) {
    excD.push("Billets d'avion / vols internationaux");
  }
  return { inc: incD, exc: excD };
}

export const UNSAVED_MSG =
  'Des modifications ne sont pas enregistrées.\nVoulez-vous vraiment quitter sans enregistrer ?\n\nOK = Quitter sans enregistrer\nAnnuler = Continuer la modification';

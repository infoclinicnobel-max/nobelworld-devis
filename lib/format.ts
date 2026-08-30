/* Utilitaires de formatage — repris de index.html sans changement de comportement. */

export const uid = (p = 'id') =>
  p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/* Les dates sont désormais de vrais `date` Postgres : supabase-js les renvoie en
   « YYYY-MM-DD » et la première branche les rend telles quelles, sans décalage.
   Le rattrapage +12 h ne subsiste que pour les valeurs horodatées héritées
   (anciens instantanés, saisies libres) — il ne s'applique jamais aux dates pures. */
export function normalizeDate(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return String(v);
  return new Date(d.getTime() + 12 * 3600 * 1000).toISOString().slice(0, 10);
}

export function fmtDate(iso: unknown): string {
  if (!iso) return '—';
  const d = new Date(normalizeDate(iso));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function money(n: unknown, cur = '€'): string {
  const v = Number(n || 0);
  return (
    new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(v) +
    ' ' +
    cur
  );
}

/* La base stocke la devise en code ISO ('EUR') alors que les documents historiques
   l'impriment en symbole ('€'). On convertit à l'affichage : le PDF reste identique
   et aucune ligne n'est réécrite en base. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', TRY: '₺', TL: '₺',
};
export function curSymbol(v: unknown): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '';
  return CURRENCY_SYMBOLS[raw.toUpperCase()] || raw;
}

export function initials(name = ''): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

/* Conversion sûre en minuscules : la base peut renvoyer des nombres (téléphones…)
   ou d'autres types là où on attend du texte — String(v ?? '') neutralise tous les cas. */
export const safeLower = (v: unknown) => String(v ?? '').toLowerCase();

/* Chiffres seuls : permet de retrouver « +33 7 51 40 25 67 » en tapant « 0751402567 ». */
export const digitsOnly = (v: unknown) => String(v ?? '').replace(/[^\d]/g, '');

export function fmtPhone(t: unknown): string {
  if (!t) return '';
  let d = ('' + t).replace(/[^\d]/g, '');
  if (!d) return String(t);
  if (d.startsWith('0')) d = d.slice(1);
  if (d.startsWith('90')) d = d.slice(2);
  if (d.length === 10) return '+90 ' + d.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4');
  return ('' + t).trim().startsWith('+') ? ('' + t).trim() : '+' + d;
}

export function arrMove<T>(arr: T[] | undefined, from: number, to: number): T[] {
  const a = [...(arr || [])];
  if (from < 0 || from >= a.length || to < 0 || to >= a.length) return a;
  const [x] = a.splice(from, 1);
  a.splice(to, 0, x);
  return a;
}

export function fmtDateTime(v: unknown): string {
  if (!v) return '—';
  const d = new Date(v as string);
  if (isNaN(d.getTime())) return '—';
  return (
    d.toLocaleDateString('fr-FR') +
    ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

export function fmtClock(ts: unknown): string {
  if (!ts) return '—';
  try {
    return new Date(ts as string).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/* Redimensionne une image (photo de profil) en dataURL compacte */
export function resizeImage(file: File, max = 160): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * sc);
        c.height = Math.round(img.height * sc);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = rej;
      img.src = r.result as string;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/* Nom du fichier PDF proposé par le navigateur (= titre de la page pendant l'impression).
   Règle : « Clinic NobelWorld — Devis — NOM Prénom » / « … — Facture — NOM Prénom ».
   Sécurité : caractères interdits (/ \ : * ? " < > |) retirés, espaces multiples réduits,
   accents conservés, replis « Patient » et « Document » si informations manquantes. */
export function pdfFileName(
  company: unknown,
  type: string,
  patient?: { nom?: string; prenom?: string } | null,
): string {
  const clean = (t: unknown) =>
    String(t || '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const co = clean(company) || 'Clinic NobelWorld';
  const ty = type === 'facture' ? 'Facture' : type === 'devis' ? 'Devis' : 'Document';
  const nom = clean(`${(patient && patient.nom) || ''} ${(patient && patient.prenom) || ''}`) || 'Patient';
  return `${co} — ${ty} — ${nom}`;
}

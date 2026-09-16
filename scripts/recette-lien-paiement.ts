/* Recette du lien de paiement Paysera depuis un devis — 16 septembre 2026.

   Ce que ce lot promet, et que cette recette PROUVE sans connexion :
   · le montant vient du devis (acompte saisi, ou solde = total − encaissé),
     et se refuse hors des bornes du contrat (1 à 50 000 €) ;
   · le bouton ne se propose que sur un devis envoyé ou accepté ;
   · un acompte déjà encaissé par Paysera éteint la proposition « acompte »,
     un devis entièrement réglé éteint le solde ;
   · un lien vivant pour la même somme se réutilise ; un lien expiré, ou
     d'un autre montant, ne se réutilise jamais ;
   · le statut se lit dans nw_paiements sur ref_num = numéro du devis et
     mode « Paysera » — et sur rien d'autre ;
   · la réponse du site est relue avec méfiance, et chaque échec a une
     phrase en français.

   Usage : npx tsx scripts/recette-lien-paiement.ts */

import {
  derniersLiens, encaisse, estEuro, estLangueLien, estTypeLien, lienExpire, lienVivant, lireReponseSite,
  messageErreurSite, MONTANT_MAX, MONTANT_MIN, objetLien, paiementsDuDevis, paiementsPaysera,
  peutProposerLien, propositions, STATUTS_LIEN_POSSIBLE,
} from '../lib/lienPaiement';
import { PERM_LIEN_PAIEMENT, can, roleDefaultPerms } from '../lib/perms';
import { profilAutorise, AccesRefuseError } from '../lib/acces';
import type { DocRecord, LienPaiement, Paiement } from '../lib/types';

const r: [string, boolean][] = [];
const v = (nom: string, ok: boolean, detail = '') => {
  r.push([nom, ok]);
  console.log(`  ${ok ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

const devis = (o: Partial<DocRecord> = {}): DocRecord =>
  ({ id: 'dev_1', numero: 'D-2026-000123', patientId: 'p1', statut: 'accepte', forfait: 8000, acompte: 1500, devise: 'EUR', ...o }) as DocRecord;
const paiement = (o: Partial<Paiement> = {}): Paiement =>
  ({ id: 'pai_' + Math.random().toString(36).slice(2, 6), refId: null, refNum: 'D-2026-000123', patientId: 'p1', montant: 1500, date: '2026-09-10', mode: 'Paysera', type: 'acompte', devise: '€', note: 'DEVIS-D-2026-000123-A-1', ...o }) as Paiement;
const lien = (o: Partial<LienPaiement> = {}): LienPaiement => ({
  id: 'lien_' + Math.random().toString(36).slice(2, 6), devisId: 'dev_1', devisNumero: 'D-2026-000123', type: 'acompte', montant: 1500,
  devise: 'EUR', reference: 'DEVIS-D-2026-000123-A-1', paymentUrl: 'https://bank.paysera.com/pay/abc', orderId: 'o1', linkId: 'l1',
  isTest: false, langue: 'fr', expiresAt: '2026-09-23T10:00:00Z', creePar: 'Veys Turan', createdAt: '2026-09-16T10:00:00Z', ...o,
});
const MAINTENANT = Date.parse('2026-09-16T12:00:00Z');

console.log('\n=== 1. Sur quels statuts le bouton se propose ===');
{
  v('envoyé → oui', peutProposerLien(devis({ statut: 'envoye' })));
  v('accepté → oui', peutProposerLien(devis({ statut: 'accepte' })));
  v('brouillon → non (le devis n’est pas parti)', !peutProposerLien(devis({ statut: 'brouillon' })));
  v('refusé → non, expiré → non (classés, figés)', !peutProposerLien(devis({ statut: 'refuse' })) && !peutProposerLien(devis({ statut: 'expire' })));
  v('statut vide ou inconnu → non', !peutProposerLien({ statut: '' }) && !peutProposerLien({ statut: 'annule' }));
  v('la liste blanche porte exactement deux statuts', STATUTS_LIEN_POSSIBLE.length === 2);
  v('euro : « € », « EUR », vide — et rien d’autre', estEuro('€') && estEuro('EUR') && estEuro('eur') && estEuro('') && !estEuro('TRY') && !estEuro('₺'));
}

console.log('\n=== 2. Le montant vient du devis — acompte ou solde, jamais saisi ===');
{
  const [ac, so] = propositions(devis(), [], []);
  v('acompte = l’acompte du devis (1 500)', ac.type === 'acompte' && ac.montant === 1500 && !ac.indisponible, String(ac.montant));
  v('solde sans encaissement = le total du devis (8 000)', so.type === 'paiement' && so.montant === 8000 && !so.indisponible, so.libelle);
  v('exactement deux propositions', propositions(devis(), [], []).length === 2);

  const [ac0] = propositions(devis({ acompte: 0 }), [], []);
  v('acompte à 0 → proposition éteinte, avec sa raison', !!ac0.indisponible, ac0.indisponible);

  const remise = devis({ forfait: 10000, remiseValeur: 10, remiseType: 'pourcent' });
  v('le solde suit le total APRÈS remise (10 000 − 10 % = 9 000)', propositions(remise, [], [])[1].montant === 9000);

  const opt = devis({ forfait: 8000, options: [{ nom: 'Chambre', prix: 500, retenue: false }, { nom: 'Ancienne', prix: 300 }] });
  v('les options : retenue absente COMPTE (300), non retenue ne compte pas (500) → 8 300',
    propositions(opt, [], [])[1].montant === 8300, String(propositions(opt, [], [])[1].montant));
}

console.log('\n=== 3. Déjà encaissé : par le numéro du devis ET par la facture née du devis ===');
{
  const facture = { id: 'fac_1', devisId: 'dev_1' } as DocRecord;
  const virement = paiement({ id: 'pai_v', refId: 'fac_1', refNum: 'F-2026-000045', mode: 'Virement bancaire', montant: 2000 });
  const paysera = paiement({ id: 'pai_p', montant: 1500 });
  const autre = paiement({ id: 'pai_x', refNum: 'D-2026-000999', montant: 700 });
  const liste = paiementsDuDevis([virement, paysera, autre, paysera], devis(), [facture]);
  v('deux paiements retenus, le troisième (autre devis) exclu, le doublon dédoublonné', liste.length === 2, liste.map((p) => p.id).join(','));
  v('encaissé = 3 500', encaisse(liste) === 3500);
  const [, so] = propositions(devis(), [virement, paysera, autre], [facture]);
  v('solde = 8 000 − 3 500 = 4 500, et le libellé le dit', so.montant === 4500 && /déjà encaissé/.test(so.libelle), so.libelle);
  const remb = paiement({ id: 'pai_r', type: 'remboursement', montant: -500 });
  v('un remboursement (négatif) se retranche de l’encaissé', encaisse(paiementsDuDevis([paysera, remb], devis(), [])) === 1000);
}

console.log('\n=== 4. « Devis déjà payé » : chaque proposition s’éteint pour sa raison ===');
{
  const [ac, so] = propositions(devis(), [paiement()], []);
  v('acompte Paysera déjà encaissé → « acompte » éteint, daté', !!ac.indisponible && /déjà été encaissé/.test(ac.indisponible!), ac.indisponible);
  v('… mais le solde reste proposable (8 000 − 1 500 = 6 500)', !so.indisponible && so.montant === 6500);
  const virementAcompte = paiement({ mode: 'Virement bancaire' });
  v('JUMEAU : un acompte par VIREMENT n’éteint pas l’acompte Paysera (autre canal), mais compte dans le solde',
    !propositions(devis(), [virementAcompte], [])[0].indisponible && propositions(devis(), [virementAcompte], [])[1].montant === 6500);
  const [, tout] = propositions(devis(), [paiement({ type: 'paiement', montant: 8000 })], []);
  v('devis entièrement réglé → solde éteint « déjà entièrement réglé »', !!tout.indisponible && /entièrement réglé/.test(tout.indisponible!), tout.indisponible);
  const [, vide] = propositions(devis({ forfait: 0, acompte: 0 }), [], []);
  v('devis sans montant → solde éteint', !!vide.indisponible);
}

console.log('\n=== 5. Les bornes du contrat (1 à 50 000 €) ===');
{
  v('constantes : 1 et 50 000', MONTANT_MIN === 1 && MONTANT_MAX === 50_000);
  const [ac] = propositions(devis({ acompte: 0.5 }), [], []);
  v('acompte de 0,50 € → éteint (minimum)', !!ac.indisponible && /minimum/.test(ac.indisponible!), ac.indisponible);
  const [, so] = propositions(devis({ forfait: 60000 }), [], []);
  v('solde de 60 000 € → éteint (plafond)', !!so.indisponible && /plafond/.test(so.indisponible!), so.indisponible);
  v('JUMEAU : 50 000 exactement passe', !propositions(devis({ forfait: 50000 }), [], [])[1].indisponible);
  v('JUMEAU : 1 € exactement passe', !propositions(devis({ acompte: 1 }), [], [])[0].indisponible);
}

console.log('\n=== 6. La mémoire du lien : réutiliser, ou pas ===');
{
  const vivant = lien();
  v('même type, même montant, non expiré → réutilisé', lienVivant([vivant], 'acompte', 1500, MAINTENANT)?.id === vivant.id);
  v('expiré → pas réutilisé', lienVivant([lien({ expiresAt: '2026-09-15T00:00:00Z' })], 'acompte', 1500, MAINTENANT) === null);
  v('autre montant (acompte modifié sur le devis) → pas réutilisé', lienVivant([vivant], 'acompte', 2000, MAINTENANT) === null);
  v('autre type → pas réutilisé', lienVivant([vivant], 'paiement', 1500, MAINTENANT) === null);
  v('sans URL → pas réutilisé', lienVivant([lien({ paymentUrl: '' })], 'acompte', 1500, MAINTENANT) === null);
  v('expiration illisible → traité comme expiré', lienExpire(lien({ expiresAt: 'bientôt' }), MAINTENANT) && lienExpire(lien({ expiresAt: '' }), MAINTENANT));
  const ancien = lien({ id: 'a', createdAt: '2026-09-10T10:00:00Z', expiresAt: '2026-09-17T10:00:00Z' });
  const recent = lien({ id: 'b', createdAt: '2026-09-16T10:00:00Z' });
  v('deux liens vivants → le plus récent', lienVivant([ancien, recent], 'acompte', 1500, MAINTENANT)?.id === 'b');
  const d = derniersLiens([ancien, recent, lien({ id: 'c', type: 'paiement', createdAt: '2026-09-01T00:00:00Z' })]);
  v('derniersLiens : un par type, le plus récent de chacun', d.length === 2 && d.some((x) => x.id === 'b') && d.some((x) => x.id === 'c'));
}

console.log('\n=== 7. Le statut se lit dans nw_paiements : ref_num = numéro, mode Paysera ===');
{
  const ok = paiement();
  const autreNumero = paiement({ refNum: 'D-2026-000124' });
  const virement = paiement({ mode: 'Virement bancaire' });
  const casse = paiement({ mode: 'paysera', refNum: ' D-2026-000123 ' });
  const l = paiementsPaysera([autreNumero, virement, ok, casse], 'D-2026-000123');
  v('deux lignes Paysera sur ce numéro (casse et espaces tolérées), les autres exclues', l.length === 2);
  v('numéro vide → rien', paiementsPaysera([ok], '').length === 0 && paiementsPaysera([ok], undefined).length === 0);
  v('triées par date', paiementsPaysera([paiement({ date: '2026-09-12' }), paiement({ date: '2026-09-02' })], 'D-2026-000123')[0].date === '2026-09-02');
}

console.log('\n=== 8. La réponse du site, relue avec méfiance ===');
{
  const bonne = { ok: true, reference: 'DEVIS-D-2026-000123-A-x', devis: 'D-2026-000123', type: 'acompte', montant: 1500, devise: 'EUR', paymentUrl: 'https://bank.paysera.com/pay/x', orderId: 'o', linkId: 'l', isTest: false, expiresAt: '2026-09-23T10:00:00Z' };
  const lue = lireReponseSite(bonne);
  v('réponse 201 du contrat → lue', !!lue && lue.montant === 1500 && lue.type === 'acompte' && lue.expiresAt === bonne.expiresAt);
  v('ok:false → rejetée', lireReponseSite({ ...bonne, ok: false }) === null);
  v('paymentUrl en http (non sécurisé) → rejetée', lireReponseSite({ ...bonne, paymentUrl: 'http://x' }) === null);
  v('paymentUrl absente → rejetée', lireReponseSite({ ...bonne, paymentUrl: '' }) === null);
  v('type inconnu → rejetée', lireReponseSite({ ...bonne, type: 'solde' }) === null);
  v('montant nul → rejetée', lireReponseSite({ ...bonne, montant: 0 }) === null);
  v('corps nul / texte → rejetée', lireReponseSite(null) === null && lireReponseSite('ok') === null);
  v('isTest vrai conservé', lireReponseSite({ ...bonne, isTest: true })?.isTest === true);
}

console.log('\n=== 9. Chaque échec a une phrase en français, jamais un code brut seul ===');
{
  v('401 → parle du secret partagé', /secret/i.test(messageErreurSite(401, {})));
  v('400 → reprend le champ nommé par le site', /montant/.test(messageErreurSite(400, { champ: 'montant' })) && /langue/.test(messageErreurSite(400, { error: 'langue' })));
  v('502 → parle de Paysera', /Paysera/.test(messageErreurSite(502, {})));
  v('503 → site non configuré', /configur/.test(messageErreurSite(503, {})));
  v('404 → lot non déployé côté site', /déployé/.test(messageErreurSite(404, null)));
  v('autre code → dit le code et « rien n’a été créé »', /« 418 »/.test(messageErreurSite(418, {})) && /Rien/.test(messageErreurSite(418, {})));
}

console.log('\n=== 10. Le contrat : types, langues, objet ===');
{
  v('types : acompte, paiement — et rien d’autre', estTypeLien('acompte') && estTypeLien('paiement') && !estTypeLien('solde') && !estTypeLien(''));
  v('langues : fr en tr es it de', ['fr', 'en', 'tr', 'es', 'it', 'de'].every(estLangueLien) && !estLangueLien('ru') && !estLangueLien(''));
  v('objet : nomme le devis', /D-2026-000123/.test(objetLien('acompte', 'D-2026-000123')) && /Acompte/.test(objetLien('acompte', 'D-2026-000123')));
}

console.log('\n=== 11. Qui peut déclencher : la permission, portée par le seul rôle admin ===');
{
  const pdg = { role: 'pdg', perms: {} };
  const coord = { role: 'coordinatrice', perms: roleDefaultPerms('coordinatrice') };
  const comm = { role: 'commerciale', perms: roleDefaultPerms('commerciale') };
  const lecture = { role: 'lecture', perms: roleDefaultPerms('lecture') };
  v('pdg (admin CRM) → oui', can(pdg, PERM_LIEN_PAIEMENT));
  v('coordinatrice → non', !can(coord, PERM_LIEN_PAIEMENT));
  v('commerciale → non, lecture → non, limité → non', !can(comm, PERM_LIEN_PAIEMENT) && !can(lecture, PERM_LIEN_PAIEMENT) && !can({ role: 'limite', perms: {} }, PERM_LIEN_PAIEMENT));
  v('sans utilisateur → non', !can(null, PERM_LIEN_PAIEMENT));
  v('une forme plate posée explicitement peut l’accorder — et la retirer à un admin',
    can({ role: 'coordinatrice', perms: { [PERM_LIEN_PAIEMENT]: true } }, PERM_LIEN_PAIEMENT)
    && !can({ role: 'pdg', perms: { [PERM_LIEN_PAIEMENT]: false } }, PERM_LIEN_PAIEMENT));

  /* La même règle d'accès que l'écran de connexion, appliquée par la route. */
  const ligne = (o: Record<string, unknown>) => ({ id: 'u1', auth_user_id: 'a1', prenom: 'Veys', nom: 'Turan', role: 'admin', statut: 'Actif', ...o });
  const refuse = (o: Record<string, unknown>) => { try { profilAutorise(ligne(o)); return false; } catch (e) { return e instanceof AccesRefuseError; } };
  v('profil admin actif → autorisé, rôle pdg, permission accordée', can(profilAutorise(ligne({})), PERM_LIEN_PAIEMENT));
  v('profil absent → refus explicite', (() => { try { profilAutorise(null); return false; } catch (e) { return e instanceof AccesRefuseError; } })());
  v('chirurgien → refus explicite', refuse({ role: 'chirurgien' }));
  v('compte inactif → refus explicite', refuse({ statut: 'Inactif' }));
  v('coordinatrice active → autorisée à entrer, mais sans la permission', !refuse({ role: 'coordinatrice' }) && !can(profilAutorise(ligne({ role: 'coordinatrice' })), PERM_LIEN_PAIEMENT));
}

const ko = r.filter(([, ok]) => !ok);
console.log(`\n=== ${r.length - ko.length}/${r.length} contrôles au vert ===`);
if (ko.length) console.log('  échecs : ' + ko.map(([n]) => n).join(' · '));
process.exit(ko.length ? 1 : 0);

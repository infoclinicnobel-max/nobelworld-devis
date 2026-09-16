/* Contrôle d'accès à Nobel World — la règle, en un seul endroit, PURE.

   Elle était écrite dans `chargerProfil()` (lib/data.ts, module navigateur).
   La route serveur du lien de paiement Paysera (app/api/paysera/lien-devis)
   doit appliquer EXACTEMENT la même : profil absent, rôle interdit ou compte
   désactivé → refus. Plutôt que la recopier, elle descend ici et les deux
   appelants la partagent — il ne peut pas en exister deux versions. */

import { rowToUser } from './mappers';
import { ROLES_SANS_ACCES, type AppUser } from './perms';

export class AccesRefuseError extends Error {}

/** La ligne `profiles` d'un compte → l'utilisateur applicatif, ou un refus explicite. */
export function profilAutorise(row: Record<string, unknown> | null | undefined): AppUser {
  if (!row) {
    throw new AccesRefuseError(
      "Aucun profil n'est associé à ce compte dans Clinic Nobel. Demandez à l'administrateur de créer votre fiche.",
    );
  }
  const u = rowToUser(row);
  if (ROLES_SANS_ACCES.includes(u.roleBase.toLowerCase())) {
    throw new AccesRefuseError(
      `Le rôle « ${u.roleBase} » n'a pas accès à Nobel World. Les règles d'accès de la base réservent l'application aux autres rôles.`,
    );
  }
  if (String(u.statut).toLowerCase() === 'inactif') {
    throw new AccesRefuseError("Compte désactivé. Contactez l'administrateur.");
  }
  return u;
}

'use client';

import React from 'react';
import { Empty } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { initials } from '@/lib/format';
import { isAdmin, ROLES, ROLES_SANS_ACCES, userLabel } from '@/lib/perms';

/* =========================================================================
   UTILISATEURS — table `profiles`, propriété du CRM Clinic Nobel.
   Lecture seule : aucune création, modification ni suppression depuis ici.
   ------------------------------------------------------------------------- */
export function UtilisateursView() {
  const { data, user } = useApp();
  if (!isAdmin(user))
    return (
      <Empty
        icon={Ico.users}
        title="Accès réservé"
        sub="Seul l'administrateur peut consulter les comptes."
      />
    );
  const users = data.utilisateurs || [];
  return (
    <>
      <div className="toolbar">
        <div className="sec-head" style={{ margin: 0 }}>
          <div>
            <h2>Utilisateurs</h2>
            <div className="desc">{users.length} compte(s)</div>
          </div>
        </div>
      </div>
      <div
        className="card card-pad"
        style={{ marginBottom: 16, background: 'var(--surface)', fontSize: 12.5, lineHeight: 1.6 }}
      >
        <b>Comptes gérés par le CRM Clinic Nobel.</b> Nobel World lit la table <code>profiles</code> mais n&apos;y
        écrit jamais : création de compte, changement de rôle, activation et réinitialisation de mot de passe se
        font dans le CRM. Chacun peut modifier son propre mot de passe dans Paramètres → Société.
      </div>
      <div className="card">
        {users.length ? (
          <table>
            <thead>
              <tr>
                <th>Utilisateur</th><th>Rôle CRM</th><th>Rôle Nobel World</th><th>Fonction</th>
                <th>Statut</th><th>Accès Nobel World</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const refuse = ROLES_SANS_ACCES.includes(u.roleBase.toLowerCase());
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {u.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.photo} className="uav" alt="" />
                        ) : (
                          <div className="uav ph">{initials(userLabel(u))}</div>
                        )}
                        <div style={{ minWidth: 0 }}>
                          <div className="t-strong">{userLabel(u)}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{u.roleBase || '—'}</td>
                    <td>{ROLES[u.role]?.label || u.role}</td>
                    <td className="muted">{u.fonction || '—'}</td>
                    <td>
                      {String(u.statut).toLowerCase() === 'inactif' ? (
                        <span className="badge b-cancel"><span className="dot" />Désactivé</span>
                      ) : (
                        <span className="badge b-paid"><span className="dot" />Actif</span>
                      )}
                    </td>
                    <td>
                      {refuse ? (
                        <span className="badge b-cancel"><span className="dot" />Refusé par la base</span>
                      ) : (
                        <span className="badge b-part"><span className="dot" />Autorisé</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty icon={Ico.users} title="Aucun utilisateur" sub="Aucun profil n'est visible depuis ce compte." />
        )}
      </div>
    </>
  );
}

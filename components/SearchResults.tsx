'use client';

import React from 'react';
import { Empty, StatusBadge } from './ui';
import { Ico } from './icons';
import { useApp } from './AppContext';
import { digitsOnly, money, safeLower } from '@/lib/format';
import { patientName, totalOf } from '@/lib/calc';

/* =========================================================================
   RECHERCHE GLOBALE
   La recherche par téléphone doit fonctionner que le numéro soit saisi avec
   ou sans espaces : on compare aussi les chiffres seuls, des deux côtés.
   ------------------------------------------------------------------------- */
export function SearchResults({ q, onClear }: { q: string; onClear: () => void }) {
  const { data, go } = useApp();
  const s = safeLower(q).trim();
  const sDigits = digitsOnly(q);

  const matchTexte = (v: unknown) => safeLower(v).includes(s);
  /* « 07 51 40 25 67 », « 0751402567 » et « +33751402567 » doivent tous ramener
     la même fiche : on compare les suffixes de chiffres (indicatif variable). */
  const matchTel = (v: unknown) => {
    if (sDigits.length < 3) return false;
    const d = digitsOnly(v);
    if (!d) return false;
    return d.includes(sDigits) || sDigits.includes(d) || d.endsWith(sDigits.replace(/^0+/, ''));
  };

  const pats = (data.patients || []).filter(
    (p) =>
      [p.nom, p.prenom, p.pays, p.email, p.ville].some(matchTexte) ||
      matchTexte(p.telephone) ||
      matchTel(p.telephone),
  );
  const dvs = (data.devis || []).filter((d) => matchTexte(d.numero));
  const fcs = (data.factures || []).filter((f) => matchTexte(f.numero));
  const n = pats.length + dvs.length + fcs.length;

  return (
    <div>
      <div className="toolbar">
        <div className="t-strong">{n} résultat(s) pour « {q} »</div>
        <div className="sp" />
        <button className="btn btn-sm" onClick={onClear}>Effacer</button>
      </div>
      {!n && (
        <div className="card">
          <Empty icon={Ico.search} title="Aucun résultat" sub="Essayez un autre nom ou numéro." />
        </div>
      )}
      {pats.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Patients</h2>
          </div>
          <table>
            <tbody>
              {pats.map((p) => (
                <tr key={p.id} className="clickable" onClick={() => go('patients')}>
                  <td className="t-strong">{patientName(p)}</td>
                  <td className="muted">{p.telephone}</td>
                  <td className="muted">{p.pays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dvs.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Devis</h2>
          </div>
          <table>
            <tbody>
              {dvs.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => go('devis')}>
                  <td className="t-strong">{d.numero}</td>
                  <td><StatusBadge s={d.statut} doc="devis" /></td>
                  <td className="tnum">{money(totalOf(d), data.parametres.currency || '€')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fcs.length > 0 && (
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 0 }}>
            <h2 style={{ fontSize: 14, margin: 0 }}>Factures</h2>
          </div>
          <table>
            <tbody>
              {fcs.map((f) => (
                <tr key={f.id} className="clickable" onClick={() => go('factures')}>
                  <td className="t-strong">{f.numero}</td>
                  <td><StatusBadge s={f.statut} /></td>
                  <td className="tnum">{money(totalOf(f), data.parametres.currency || '€')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

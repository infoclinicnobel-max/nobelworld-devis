'use client';

import React from 'react';

/* Icônes (SVG inline, trait fin) — reprises telles quelles de index.html. */

type IcoProps = { size?: number } & React.SVGProps<SVGSVGElement>;

const I =
  (p: React.ReactNode, vb = '0 0 24 24') =>
  ({ size = 18, ...r }: IcoProps) => (
    <svg
      width={size}
      height={size}
      viewBox={vb}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...r}
    >
      {p}
    </svg>
  );

export const Ico = {
  dash: I(<><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></>),
  doc: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></>),
  invoice: I(<><path d="M5 2h14v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/></>),
  users: I(<><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 6"/><path d="M21 20a6 6 0 0 0-4-5.6"/></>),
  pay: I(<><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></>),
  tpl: I(<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>),
  cog: I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.6 14H2a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4.6 8.4a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8z"/></>),
  hist: I(<><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/></>),
  search: I(<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>),
  plus: I(<><path d="M12 5v14M5 12h14"/></>),
  menu: I(<><path d="M3 6h18M3 12h18M3 18h18"/></>),
  x: I(<><path d="M18 6 6 18M6 6l12 12"/></>),
  chevron: I(<><path d="m9 18 6-6-6-6"/></>),
  pdf: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h1.5a1.5 1.5 0 0 0 0-3H9v6"/></>),
  print: I(<><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></>),
  copy: I(<><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>),
  trash: I(<><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>),
  edit: I(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/></>),
  arrow: I(<><path d="M5 12h14M13 6l6 6-6 6"/></>),
  check: I(<><path d="M20 6 9 17l-5-5"/></>),
  patient: I(<><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>),
  euro: I(<><path d="M18 7a6 6 0 0 0-9 9 6 6 0 0 0 9 2"/><path d="M4 11h9M4 15h7"/></>),
  wallet: I(<><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h16a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><circle cx="17" cy="13" r="1.4"/></>),
  send: I(<><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></>),
  bell: I(<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>),
  lock: I(<><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>),
  power: I(<><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></>),
};

export type IconType = (props: IcoProps) => React.JSX.Element;

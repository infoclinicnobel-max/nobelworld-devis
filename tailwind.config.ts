import type { Config } from 'tailwindcss';

/* Tailwind est présent dans la pile mais volontairement neutralisé sur les éléments
   existants : l'iso-apparence repose sur la feuille de style d'origine (app/globals.css),
   reprise caractère pour caractère depuis index.html. Le preflight est désactivé pour
   qu'aucune règle Tailwind ne modifie le rendu — en particulier celui du PDF. */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
export default config;

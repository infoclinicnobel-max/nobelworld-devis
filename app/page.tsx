import { AppClient } from './AppClient';

/* L'application est entièrement rendue côté navigateur, comme la version d'origine :
   une seule page, un seul point d'entrée. Le rendu serveur est désactivé pour ce bloc
   afin que la reprise de session Supabase et l'impression PDF se comportent à l'identique. */
export default function Page() {
  return <AppClient />;
}

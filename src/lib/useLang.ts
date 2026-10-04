import { useEffect, useState } from 'react'
import { ipc } from './ipc'
import type { Lang } from './i18n'

/**
 * The app language (Settings → Language), for components that show
 * translatable prose. Starts on the shipped default (`ja`, see
 * `AppSettings::default`) so the first frame is already right for most users;
 * the settings fetch corrects it for anyone who switched.
 */
export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>('ja')
  useEffect(() => {
    ipc.getSettings().then((s) => setLang(s.language)).catch(() => {})
  }, [])
  return lang
}

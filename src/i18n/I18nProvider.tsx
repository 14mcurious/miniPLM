import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LANGUAGE, translate, translations } from "./i18n";

const STORAGE_KEY = "miniplm.language";

/** Read the user's last language choice; defaults to English. */
function detectLanguage(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && translations[stored]) return stored;
  } catch {
    // storage unavailable - fall back to the default language
  }
  return DEFAULT_LANGUAGE;
}

interface I18nContextValue {
  /** Currently active language code (e.g. "en"). */
  language: string;
  /** Switch the active language and persist the choice. */
  setLanguage: (language: string) => void;
  /** Translate a key, with optional {placeholder} variables. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  language: DEFAULT_LANGUAGE,
  setLanguage: () => undefined,
  t: (key, vars) => translate(DEFAULT_LANGUAGE, key, vars),
});

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [language, setLanguageState] = useState<string>(detectLanguage);

  const setLanguage = useCallback((next: string) => {
    if (!translations[next]) return;
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable - the choice stays for this page session only
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(language, key, vars),
    [language]
  );

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};

/** Hook giving access to the active language and the translator. */
export const useI18n = () => useContext(I18nContext);

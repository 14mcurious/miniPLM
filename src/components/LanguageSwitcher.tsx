import { AVAILABLE_LANGUAGES, useI18n } from "@/i18n";

const LanguageSwitcher = () => {
  const { t, language, setLanguage } = useI18n();

  return (
    <label
      htmlFor="language-select"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      {t("language.label")}
      <select
        id="language-select"
        name="language"
        value={language}
        onChange={(e) => setLanguage(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {AVAILABLE_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {t(`language.name.${code}`)}
          </option>
        ))}
      </select>
    </label>
  );
};

export default LanguageSwitcher;

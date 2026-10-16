import { useI18n } from "@/i18n";
import BackLink from "@/components/BackLink";

const WorkArea = () => {
  const { t } = useI18n();

  return (
    <>
      <BackLink to="/" label={t("home.title")} />
      <div className="flex min-h-screen items-center justify-center bg-background">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          {t("workArea.title")}
        </h1>
      </div>
    </>
  );
};

export default WorkArea;

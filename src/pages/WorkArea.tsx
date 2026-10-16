import { useI18n } from "@/i18n";

const WorkArea = () => {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <h1 className="text-4xl font-bold tracking-tight text-foreground">
        {t("workArea.title")}
      </h1>
    </div>
  );
};

export default WorkArea;

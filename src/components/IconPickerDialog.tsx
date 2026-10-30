import { useEffect, useMemo, useState } from "react";
import { icons, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface IconPickerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Currently chosen icon name (null = no icon). */
  selected: string | null;
  /** Called with the chosen icon name, or null to remove the icon. */
  onSelect: (iconName: string | null) => void;
}

/**
 * Private icon gallery of the application: the full Lucide icon set
 * (https://lucide.dev/icons/) bundled locally with the app (lucide-react)
 * and rendered as a searchable grid. One click picks the icon for the
 * template; the "no icon" option removes the current choice.
 */
const IconPickerDialog = ({
  open,
  onClose,
  selected,
  onSelect,
}: IconPickerDialogProps) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");

  // The gallery is the complete local Lucide set (icons map).
  const galleryNames = useMemo(
    () => Object.keys(icons).sort((a, b) => a.localeCompare(b)),
    []
  );

  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return galleryNames;
    return galleryNames.filter((name) => name.toLowerCase().includes(query));
  }, [galleryNames, filter]);

  // Reset the search filter each time the gallery is opened.
  useEffect(() => {
    if (open) setFilter("");
  }, [open]);

  // Escape closes the gallery.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("wa.templateIconGallery")}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border bg-background shadow-lg">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            {t("wa.templateIconGallery")}
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t("wa.templateIconClose")}
          >
            ✕
          </Button>
        </div>

        <div className="px-5 pt-4">
          <label htmlFor="icon-filter" className="sr-only">
            {t("wa.templateIconSearch")}
          </label>
          <Input
            id="icon-filter"
            name="iconFilter"
            placeholder={t("wa.templateIconSearch")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3">
            <Button
              type="button"
              size="sm"
              variant={selected === null ? "default" : "outline"}
              onClick={() => onSelect(null)}
            >
              {t("wa.templateIconNone")}
            </Button>
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("wa.templateIconEmpty")}
            </p>
          ) : (
            <ul
              className="grid grid-cols-6 gap-1 sm:grid-cols-8 md:grid-cols-10"
              aria-label={t("wa.templateIconGallery")}
            >
              {filtered.map((name) => {
                const Icon = icons[
                  name as keyof typeof icons
                ] as LucideIcon;
                const isSelected = selected === name;
                return (
                  <li key={name}>
                    <button
                      type="button"
                      title={name}
                      aria-pressed={isSelected}
                      onClick={() => onSelect(name)}
                      className={cn(
                        "flex aspect-square w-full items-center justify-center rounded-md border transition-colors",
                        isSelected
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-transparent text-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">
            {t("wa.templateIconCount", { count: filtered.length })}
          </p>
        </div>
      </div>
    </div>
  );
};

export default IconPickerDialog;

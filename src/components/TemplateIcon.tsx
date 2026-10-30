import { icons, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders the Lucide icon (name) associated with a work instance / work
 * container template, next to the element title. Unknown or missing names
 * render nothing, so a template without a chosen icon stays plain.
 */
const TemplateIcon = ({
  name,
  className,
}: {
  name?: string | null;
  className?: string;
}) => {
  const Icon: LucideIcon | undefined = name
    ? (icons[name as keyof typeof icons] as LucideIcon | undefined)
    : undefined;
  if (!Icon) return null;
  return (
    <Icon
      aria-hidden="true"
      className={cn("h-4 w-4 shrink-0 text-muted-foreground", className)}
    />
  );
};

export default TemplateIcon;

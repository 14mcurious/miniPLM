import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Identifiers of the sidebar leaves. The identifier is stable while the
 * route can change, so the highlight logic maps route prefixes to ids.
 */
type LeafId =
  | "users"
  | "groups"
  | "projects"
  | "projectSettings"
  | "customTypes"
  | "searchColumns"
  | "security"
  | "templates"
  | "workflow";

interface AdminLeaf {
  id: LeafId;
  to: string;
  labelKey: string;
}

interface AdminSection {
  id: string;
  labelKey: string;
  leaves: AdminLeaf[];
}

const SECTIONS: AdminSection[] = [
  {
    id: "usersPermissions",
    labelKey: "administration.sidebar.usersPermissions",
    leaves: [
      {
        id: "users",
        to: "/administration/users/users-list",
        labelKey: "administration.users",
      },
      {
        id: "groups",
        to: "/administration/groups/groups-list",
        labelKey: "administration.groups",
      },
    ],
  },
  {
    id: "projects",
    labelKey: "administration.projects",
    leaves: [
      {
        id: "projects",
        to: "/administration/projects/projects-list",
        labelKey: "projects.title",
      },
      {
        id: "projectSettings",
        to: "/administration/projects/project-settings",
        labelKey: "projectSettings.title",
      },
    ],
  },
  {
    id: "configuration",
    labelKey: "administration.configuration",
    leaves: [
      {
        id: "customTypes",
        to: "/administration/configuration/custom-types",
        labelKey: "customTypesConfig.title",
      },
      {
        id: "searchColumns",
        to: "/administration/configuration/search-columns",
        labelKey: "searchColumnsConfig.title",
      },
      {
        id: "security",
        to: "/administration/configuration/security",
        labelKey: "securitySettings.title",
      },
      {
        id: "templates",
        to: "/administration/configuration/templates",
        labelKey: "templatesConfig.title",
      },
      {
        id: "workflow",
        to: "/administration/configuration/workflow",
        labelKey: "workflowConfig.title",
      },
    ],
  },
];

/**
 * Maps the current route to the sidebar leaf that represents it. The
 * more specific prefixes (project-settings, workflow sub-routes) must be
 * tested before the shorter ones.
 */
function activeLeafId(pathname: string): LeafId | null {
  if (pathname.startsWith("/administration/users")) return "users";
  if (pathname.startsWith("/administration/groups")) return "groups";
  if (pathname.startsWith("/administration/projects/project-settings")) {
    return "projectSettings";
  }
  if (pathname.startsWith("/administration/projects")) return "projects";
  if (pathname.startsWith("/administration/configuration/workflow")) {
    return "workflow";
  }
  if (pathname.startsWith("/administration/configuration/custom-types")) {
    return "customTypes";
  }
  if (pathname.startsWith("/administration/configuration/search-columns")) {
    return "searchColumns";
  }
  if (pathname.startsWith("/administration/configuration/security")) {
    return "security";
  }
  if (pathname.startsWith("/administration/configuration/templates")) {
    return "templates";
  }
  return null;
}

function sectionOfLeaf(leafId: LeafId | null): string | null {
  for (const section of SECTIONS) {
    if (section.leaves.some((leaf) => leaf.id === leafId)) {
      return section.id;
    }
  }
  return null;
}

/** Rotating chevron indicating whether a section is expanded. */
const Chevron = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    aria-hidden="true"
    className={cn(
      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
      open && "rotate-90"
    )}
  >
    <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Left navigation of the administration area: a vertical menu with
 * expandable sections. The leaf matching the current route is highlighted
 * and its section is always expanded while the user stays on it.
 */
const AdminSidebar = () => {
  const { t } = useI18n();
  const { pathname } = useLocation();

  const currentLeaf = activeLeafId(pathname);
  const currentSection = sectionOfLeaf(currentLeaf);

  // The section of the active route is force-opened by the effect below so
  // the highlighted leaf is always visible; user toggles are free otherwise.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const section of SECTIONS) initial[section.id] = false;
    const active = sectionOfLeaf(activeLeafId(pathname));
    if (active) initial[active] = true;
    return initial;
  });

  useEffect(() => {
    if (!currentSection) return;
    setOpen((prev) =>
      prev[currentSection] ? prev : { ...prev, [currentSection]: true }
    );
  }, [currentSection]);

  const toggleSection = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <nav
      aria-label={t("administration.title")}
      className="sticky top-0 flex h-screen w-72 shrink-0 flex-col overflow-y-auto border-r bg-muted/30"
    >
      <div className="border-b px-4 py-4">
        <Link
          to="/administration"
          className="text-lg font-semibold tracking-tight text-foreground hover:underline"
        >
          {t("administration.title")}
        </Link>
      </div>

      <ul className="flex-1 space-y-1 p-2">
        {SECTIONS.map((section) => {
          const sectionOpen = Boolean(open[section.id]);
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                aria-expanded={sectionOpen}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span>{t(section.labelKey)}</span>
                <Chevron open={sectionOpen} />
              </button>

              {sectionOpen && (
                <ul className="mt-1 space-y-0.5 border-l pl-2 ml-4">
                  {section.leaves.map((leaf) => {
                    const active = currentLeaf === leaf.id;
                    return (
                      <li key={leaf.id}>
                        <Link
                          to={leaf.to}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "block rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                            active &&
                              "bg-accent font-medium text-accent-foreground"
                          )}
                        >
                          {t(leaf.labelKey)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

export default AdminSidebar;

import { useEffect, useState, type ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { getLocale, t } from "../../i18n";
import { createProjectFromTilesets, openRecentProject } from "../../io/session";
import { getPlatform, type RecentEntry } from "../../platform";
import { LanguageSwitch } from "../../platform/LanguageSwitch";
import type { CommandId } from "../../shortcuts/shortcuts";
import { openNewProjectDialog } from "../dialogs/NewProjectDialog";
import { Icon, type IconName } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { pickFiles } from "../pickFiles";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../projectSettings/projectTemplates";
import { useUiStore } from "../uiStore";

/** Shown whenever no project is open (the app never shows an empty screen). */
export function WelcomeScreen() {
  return (
    <div className="flex h-full overflow-y-auto">
      <div className="m-auto flex w-[960px] max-w-full flex-col gap-8 px-6 py-10">
        <header className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border border-line bg-raised text-accent">
            <Icon name="logo" size={22} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight text-title">{t("app.name")}</h1>
            <p className="text-md text-muted">{t("app.tagline")}</p>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-[300px_1fr]">
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-2">
              <SectionTitle>{t("welcome.start")}</SectionTitle>
              <ActionRow icon="filePlus" title={t("welcome.newProject")} hint={t("welcome.newProjectHint")} command="file.new" onClick={() => openNewProjectDialog()} />
              <ActionRow icon="folder" title={t("welcome.open")} hint={t("welcome.openHint")} command="file.open" />
              <DropZone />
            </section>
            <section className="flex flex-col gap-2">
              <SectionTitle>{t("welcome.templates")}</SectionTitle>
              {PROJECT_TEMPLATES.map((template) => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </section>
          </div>
          <Recents />
        </div>

        <footer className="flex items-center justify-center gap-2 text-xs text-faint">
          <CommandKbd command="palette.open" />
          <span>{t("commands.palette.open")}</span>
          <span aria-hidden className="mx-1 h-3 w-px bg-line" />
          <LanguageSwitch />
        </footer>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="px-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">{children}</h2>;
}

function ActionRow({ icon, title, hint, command, onClick }: { icon: IconName; title: string; hint: string; command: CommandId; onClick?(): void }) {
  return (
    <button
      type="button"
      onClick={onClick ?? (() => runCommand(command))}
      className="group flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-hover"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raised text-muted transition-colors group-hover:text-accent">
        <Icon name={icon} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-md font-medium text-text">{title}</span>
        <span className="truncate text-sm text-faint">{hint}</span>
      </span>
      <CommandKbd command={command} />
    </button>
  );
}

function DropZone() {
  const dragging = useUiStore((s) => s.draggingFiles);
  const browse = () => {
    void pickFiles("image/png").then((files) => createProjectFromTilesets(files));
  };
  return (
    <button
      type="button"
      onClick={browse}
      data-welcome-drop=""
      className={`flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors duration-150 ${
        dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:border-faint hover:bg-hover"
      }`}
    >
      <span
        className={`grid size-8 shrink-0 place-items-center rounded-md transition-colors ${dragging ? "bg-raised text-accent" : "bg-raised text-muted"}`}
      >
        <Icon name="upload" size={16} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-md font-medium text-text">{dragging ? t("welcome.dropActive") : t("welcome.dropShort")}</span>
        <span className="truncate text-sm text-faint">{t("welcome.dropShortHint")}</span>
      </span>
    </button>
  );
}

/** Template card: a tiny picture of the layer stack + tile size, map size and layer count. */
function TemplateCard({ template }: { template: ProjectTemplate }) {
  const layers = template.layers();
  return (
    <button
      type="button"
      onClick={() => openNewProjectDialog(template.id)}
      className="group flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-hover"
      data-template={template.id}
    >
      <TemplateGlyph tile={template.tileWidth} layers={layers.length} />
      <span className="flex min-w-0 flex-col">
        <span className="text-md font-medium text-text">{t(`templates.${template.id}`)}</span>
        <span className="truncate font-mono text-xs text-faint tabular">{t(`templates.${template.id}Hint`)}</span>
      </span>
      <Icon name="chevronRight" size={14} className="ml-auto shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/** Stacked sheets (one per layer, at most 4) with a grid as dense as the tile size. */
function TemplateGlyph({ tile, layers }: { tile: number; layers: number }) {
  const sheets = Math.min(4, layers);
  const cell = tile >= 32 ? 6 : 4;
  return (
    <span className="relative size-8 shrink-0" aria-hidden>
      {Array.from({ length: sheets }, (_, i) => (
        <span
          key={i}
          className="absolute rounded-[3px] border border-line-strong bg-raised group-hover:border-accent-line"
          style={{
            left: i * 2,
            top: (sheets - 1 - i) * 2,
            width: 32 - (sheets - 1) * 2,
            height: 32 - (sheets - 1) * 2,
            backgroundImage:
              i === sheets - 1
                ? "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)"
                : undefined,
            backgroundSize: i === sheets - 1 ? `${cell}px ${cell}px` : undefined,
          }}
        />
      ))}
    </span>
  );
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(getLocale() === "tr" ? "tr-TR" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Recents() {
  const [recents, setRecents] = useState<RecentEntry[] | null>(null);
  const platform = getPlatform();
  const supported = platform.recents.supported;

  useEffect(() => {
    let alive = true;
    void getPlatform()
      .recents.list()
      .then((list) => alive && setRecents(list))
      .catch(() => alive && setRecents([]));
    return () => {
      alive = false;
    };
  }, []);

  let body: ReactNode;
  if (!supported) body = <Empty text={t("welcome.recentUnsupported")} />;
  else if (recents === null) body = <div className="h-40" />;
  else if (recents.length === 0) body = <Empty text={t("welcome.recentEmpty")} />;
  else
    body = (
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {recents.map((recent) => (
          <RecentCard
            key={recent.key}
            recent={recent}
            onRemove={() => {
              void platform.recents.remove(recent).catch(() => undefined);
              setRecents((list) => list?.filter((r) => r.key !== recent.key) ?? null);
            }}
          />
        ))}
      </ul>
    );

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <SectionTitle>{t("welcome.recent")}</SectionTitle>
      {body}
    </section>
  );
}

function RecentCard({ recent, onRemove }: { recent: RecentEntry; onRemove(): void }) {
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => void openRecentProject(recent)}
        className="flex w-full flex-col overflow-hidden rounded-lg border border-line bg-panel text-left transition-colors hover:border-line-strong hover:bg-hover focus-visible:border-accent"
      >
        <span className="relative grid aspect-[16/9] w-full place-items-center overflow-hidden border-b border-line bg-canvas">
          {recent.thumbnail ? (
            <img src={recent.thumbnail} alt="" className="max-h-full max-w-full object-contain [image-rendering:pixelated]" draggable={false} />
          ) : (
            <span className="flex flex-col items-center gap-1 text-faint">
              <Icon name="map" size={20} />
              <span className="text-xs">{t("welcome.noThumbnail")}</span>
            </span>
          )}
          {!recent.exists && (
            <span className="absolute top-2 left-2 rounded-sm bg-danger-soft px-1.5 py-0.5 text-xs text-danger">{t("welcome.recentMissing")}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 truncate text-md font-medium text-text">{recent.name}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-faint tabular">{formatDate(recent.openedAt)}</span>
          </span>
          <span className={`min-w-0 truncate text-xs text-faint ${recent.exists ? "" : "line-through"}`} title={recent.location}>
            {recent.location}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={t("welcome.removeRecent")}
        title={t("welcome.removeRecent")}
        onClick={onRemove}
        className="absolute top-2 right-2 grid size-6 place-items-center rounded-sm bg-popup text-faint opacity-0 shadow-popup transition-opacity group-hover:opacity-100 hover:text-text focus-visible:opacity-100"
      >
        <Icon name="x" size={13} />
      </button>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="grid h-40 place-items-center rounded-lg border border-dashed border-line text-sm text-faint">
      <span className="flex flex-col items-center gap-2">
        <Icon name="folder" size={18} />
        {text}
      </span>
    </div>
  );
}

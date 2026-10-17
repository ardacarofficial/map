import { useEffect, useState, type ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { getLocale, t } from "../../i18n";
import { createProjectFromTilesets, openRecentProject } from "../../io/session";
import { getPlatform, type RecentEntry } from "../../platform";
import { LanguageSwitch } from "../../platform/LanguageSwitch";
import { keysFor, type CommandId } from "../../shortcuts/shortcuts";
import { openNewProjectDialog } from "../dialogs/NewProjectDialog";
import { IconButton } from "../primitives/Button";
import { Icon, type IconName } from "../primitives/Icon";
import { KbdText } from "../primitives/Kbd";
import { pickFiles } from "../pickFiles";
import { PROJECT_TEMPLATES, type ProjectTemplate } from "../projectSettings/projectTemplates";
import { useUiStore } from "../uiStore";

/** Shown whenever no project is open (the app never shows an empty screen). */
export function WelcomeScreen() {
  return (
    <div className="flex h-full overflow-y-auto p-6 lg:p-8">
      <div className="m-auto flex w-full max-w-[1040px] flex-col gap-6">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-title"><Icon name="logo" size={16} className="text-accent" />{t("app.name")}</h1>
            <section className="flex flex-col gap-2">
              <ActionRow icon="file-plus" title={t("welcome.newProject")} command="file.new" onClick={() => openNewProjectDialog()} />
              <ActionRow icon="folder" title={t("welcome.open")} command="file.open" />
              <DropZone />
            </section>
            <section className="flex flex-col gap-2">
              <SectionTitle>{t("welcome.templates")}</SectionTitle>
              {PROJECT_TEMPLATES.map(template => <TemplateCard key={template.id} template={template} />)}
            </section>
          </div>
          <Recents />
        </div>
        <footer className="flex items-center gap-2 text-xs text-muted">
          <Shortcut command="palette.open" /><span>{t("commands.palette.open")}</span>
          <span aria-hidden className="mx-1 h-3 w-px bg-line" /><LanguageSwitch />
        </footer>
      </div>
    </div>
  );
}

function Shortcut({ command }: { command: CommandId }) {
  const keys = keysFor(command)[0];
  return keys ? <KbdText keys={keys} /> : null;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-xs font-semibold tracking-section text-muted uppercase">{children}</h2>;
}

function ActionRow({ icon, title, command, onClick }: { icon: IconName; title: string; command: CommandId; onClick?(): void }) {
  return <button type="button" onClick={onClick ?? (() => runCommand(command))} className="flex h-control-rail items-center gap-2 rounded-sm px-2 text-left hover:bg-hover">
    <Icon name={icon} size={16} className="text-muted" /><span className="flex-1 text-md text-text">{title}</span><Shortcut command={command} />
  </button>;
}

function DropZone() {
  const dragging = useUiStore(s => s.draggingFiles);
  return <button type="button" data-welcome-drop="" onClick={() => void pickFiles("image/png").then(createProjectFromTilesets)}
    className={`flex h-24 items-center justify-center gap-2 rounded-md border border-dashed text-md text-muted ${dragging ? "border-accent-line bg-accent-soft" : "border-line-strong hover:bg-hover"}`}>
    <Icon name="upload" size={16} />{dragging ? t("welcome.dropActive") : t("welcome.dropShort")}
  </button>;
}

function TemplateCard({ template }: { template: ProjectTemplate }) {
  return <button type="button" data-template={template.id} onClick={() => openNewProjectDialog(template.id)}
    className="flex h-control-rail items-center gap-2 rounded-sm px-2 text-left hover:bg-hover">
    <Icon name="layers" size={16} className="shrink-0 text-muted" />
    <span className="shrink-0 text-sm text-text">{t(`templates.${template.id}`)}</span>
    <span className="ml-auto truncate text-xs text-muted tabular">{t(`templates.${template.id}Hint`)}</span>
  </button>;
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
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
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
        title={recent.location}
        data-recent-project={recent.key}
        className="flex w-full flex-col overflow-hidden rounded-md border border-line bg-panel text-left transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-hover focus-visible:border-accent"
      >
        <span className="relative grid aspect-[16/10] w-full place-items-center overflow-hidden border-b border-line checker">
          {recent.thumbnail ? (
            <img src={recent.thumbnail} alt="" className="max-h-full max-w-full object-contain pixelated" draggable={false} />
          ) : (
            <span className="flex flex-col items-center gap-1 text-muted">
              <Icon name="map" size={16} />
              <span className="text-xs">{t("welcome.noThumbnail")}</span>
            </span>
          )}
          {!recent.exists && (
            <span className="absolute top-2 left-2 text-xs text-danger">{t("welcome.recentMissing")}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="min-w-0 truncate text-sm font-medium text-text">{recent.name}</span>
            <span className="text-xs text-faint tabular">{formatDate(recent.openedAt)}</span>
          </span>

        </span>
      </button>
      <IconButton size="sm" aria-label={t("welcome.removeRecent")} title={t("welcome.removeRecent")} onClick={onRemove}
        className="absolute top-2 right-2 bg-popup opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
        <Icon name="x" size={16} />
      </IconButton>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted">{text}</p>;
}

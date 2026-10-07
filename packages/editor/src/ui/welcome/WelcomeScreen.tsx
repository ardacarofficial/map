import { useEffect, useState, type ReactNode } from "react";

import { runCommand } from "../../commands/registry";
import { getLocale, t } from "../../i18n";
import { createProjectFromTilesets, DEFAULT_MAP_HEIGHT, DEFAULT_MAP_WIDTH, openRecentProject } from "../../io/session";
import { forgetRecent, listRecents, supportsRecents, type RecentProject } from "../../io/recents";
import type { CommandId } from "../../shortcuts/shortcuts";
import { Icon, type IconName } from "../primitives/Icon";
import { CommandKbd } from "../primitives/Kbd";
import { pickFiles } from "../pickFiles";
import { useUiStore } from "../uiStore";

/** Shown whenever no project is open (the app never shows an empty screen). */
export function WelcomeScreen() {
  return (
    <div className="flex h-full overflow-y-auto">
      <div className="m-auto flex w-[560px] max-w-full flex-col gap-8 px-6 py-12">
        <header className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-lg border border-line bg-raised text-accent">
            <Icon name="logo" size={22} />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-semibold tracking-tight text-text">{t("app.name")}</h1>
            <p className="text-md text-muted">{t("app.tagline")}</p>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3">
          <ActionCard icon="filePlus" title={t("welcome.newProject")} hint={t("welcome.newProjectHint")} command="file.new" />
          <ActionCard icon="folder" title={t("welcome.open")} hint={t("welcome.openHint")} command="file.open" />
        </div>

        <DropZone />
        <Recents />

        <footer className="flex items-center justify-center gap-2 text-xs text-faint">
          <CommandKbd command="palette.open" />
          <span>{t("commands.palette.open")}</span>
        </footer>
      </div>
    </div>
  );
}

function ActionCard({ icon, title, hint, command }: { icon: IconName; title: string; hint: string; command: CommandId }) {
  return (
    <button
      type="button"
      onClick={() => runCommand(command)}
      className="group flex flex-col gap-3 rounded-lg border border-line bg-panel p-4 text-left transition-colors hover:border-line-strong hover:bg-raised"
    >
      <div className="flex items-center justify-between">
        <Icon name={icon} size={18} className="text-muted transition-colors group-hover:text-accent" />
        <CommandKbd command={command} />
      </div>
      <div className="flex flex-col">
        <span className="text-md font-medium text-text">{title}</span>
        <span className="text-sm text-faint">{hint}</span>
      </div>
    </button>
  );
}

function DropZone() {
  const dragging = useUiStore((s) => s.draggingFiles);
  const browse = () => {
    void pickFiles("image/png").then((files) => createProjectFromTilesets(files));
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={browse}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          browse();
        }
      }}
      className={`flex h-[200px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors duration-150 ${
        dragging ? "border-accent bg-accent-soft" : "border-line-strong hover:border-faint hover:bg-panel"
      }`}
    >
      <div
        className={`grid size-11 place-items-center rounded-full border transition-colors ${
          dragging ? "border-accent-line bg-raised text-accent" : "border-line bg-raised text-muted"
        }`}
      >
        <Icon name="upload" size={20} />
      </div>
      <div className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-lg font-medium text-text">{dragging ? t("welcome.dropActive") : t("welcome.dropTitle")}</span>
        <span className="text-sm text-faint">
          {t("welcome.dropHint", { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT })}
        </span>
      </div>
      <span className="text-sm text-accent underline-offset-2 hover:underline">{t("welcome.browse")}</span>
    </div>
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
  const [recents, setRecents] = useState<RecentProject[] | null>(null);
  const supported = supportsRecents();

  useEffect(() => {
    let alive = true;
    void listRecents().then((list) => alive && setRecents(list));
    return () => {
      alive = false;
    };
  }, []);

  let body: ReactNode;
  if (!supported) body = <Empty text={t("welcome.recentUnsupported")} />;
  else if (recents === null) body = <div className="h-9" />;
  else if (recents.length === 0) body = <Empty text={t("welcome.recentEmpty")} />;
  else
    body = (
      <ul className="flex flex-col gap-px">
        {recents.map((recent) => (
          <li key={recent.openedAt} className="group relative">
            <button
              type="button"
              onClick={() => void openRecentProject(recent)}
              className="flex h-10 w-full items-center gap-3 rounded-md px-3 pr-10 text-left transition-colors hover:bg-hover"
            >
              <Icon name="folder" size={15} className="shrink-0 text-faint" />
              <span className="min-w-0 truncate text-md text-text">{recent.name}</span>
              <span className="min-w-0 truncate text-sm text-faint">{recent.folder}</span>
              <span className="ml-auto shrink-0 font-mono text-xs text-faint tabular">{formatDate(recent.openedAt)}</span>
            </button>
            <button
              type="button"
              aria-label={t("welcome.removeRecent")}
              title={t("welcome.removeRecent")}
              onClick={() => {
                void forgetRecent(recent.openedAt);
                setRecents((list) => list?.filter((r) => r.openedAt !== recent.openedAt) ?? null);
              }}
              className="absolute top-2 right-2 grid size-6 place-items-center rounded-sm text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-active hover:text-text focus-visible:opacity-100"
            >
              <Icon name="x" size={13} />
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-3 text-xs font-semibold tracking-wide text-muted">{t("welcome.recent")}</h2>
      {body}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="px-3 text-sm text-faint">{text}</div>;
}

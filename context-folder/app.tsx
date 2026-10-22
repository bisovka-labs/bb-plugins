// bb-plugin-context-folder — "Select folder" in the composer's + menu.
//
// The popup offers bb projects first, then a folder browser starting at ~.
// Picking one inserts a plugin mention pill; server.ts resolves it into
// agent context when the message is sent.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { definePluginApp, useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import type { ProjectFolder, rpcContract } from "./server";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const POPUP_ID = "select-folder";
const MENTION_PROVIDER = "folder";

type Listing = {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  truncated: boolean;
};

type Row =
  | { kind: "project"; key: string; project: ProjectFolder }
  | { kind: "pick-current"; key: string }
  | { kind: "parent"; key: string; path: string }
  | { kind: "dir"; key: string; name: string; path: string };

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Abbreviates the home directory to ~. */
function shortPath(path: string, home: string | null): string {
  if (home === null) return path;
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function SelectFolderPopup() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<ProjectFolder[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // Projects lead the list until the user starts browsing folders.
  const [browsing, setBrowsing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const browse = useCallback(
    (path: string | null) => {
      rpc.call("list_dirs", { path }).then(
        (next) => {
          setListing(next);
          setBrowsing(path !== null);
          setQuery("");
          setActive(0);
          setError(null);
          inputRef.current?.focus();
        },
        (cause) => setError(errorText(cause)),
      );
    },
    [rpc],
  );

  useEffect(() => {
    rpc.call("projects").then(
      (result) => {
        setProjects(result.projects);
        setHome(result.home);
      },
      (cause) => setError(errorText(cause)),
    );
    browse(null);
  }, [rpc, browse]);

  const pick = (path: string, label: string) => {
    composer.insert([{ provider: MENTION_PROVIDER, id: path, label }, " "]);
    composer.experimental_closePopup();
  };

  const isPathQuery = query.startsWith("/") || query.startsWith("~");
  const rows = useMemo<Row[]>(() => {
    const q = isPathQuery ? "" : query.trim().toLowerCase();
    const result: Row[] = [];
    for (const project of browsing ? [] : (projects ?? [])) {
      if (q === "" || project.name.toLowerCase().includes(q)) {
        result.push({ kind: "project", key: `p:${project.projectId}`, project });
      }
    }
    if (listing !== null) {
      result.push({ kind: "pick-current", key: "current" });
      if (listing.parent !== null && q === "") {
        result.push({ kind: "parent", key: "parent", path: listing.parent });
      }
      for (const dir of listing.dirs) {
        if (q === "" || dir.name.toLowerCase().includes(q)) {
          result.push({ kind: "dir", key: `d:${dir.path}`, name: dir.name, path: dir.path });
        }
      }
    }
    return result;
  }, [projects, listing, query, isPathQuery, browsing]);

  const activeIndex = Math.min(active, Math.max(rows.length - 1, 0));

  const activate = (row: Row | undefined) => {
    if (row === undefined) return;
    if (row.kind === "project") pick(row.project.path, row.project.name);
    else if (row.kind === "pick-current" && listing !== null) pick(listing.path, lastSegment(listing.path));
    else if (row.kind === "parent" || row.kind === "dir") browse(row.path);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, rows.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (isPathQuery) browse(query);
      else activate(rows[activeIndex]);
    }
  };

  const renderRow = (row: Row, index: number) => {
    const selected = index === activeIndex;
    let icon = "Folder";
    let title: string;
    let subtitle: string | null = null;
    if (row.kind === "project") {
      icon = "FolderGit";
      title = row.project.name;
      subtitle = row.project.path;
    } else if (row.kind === "pick-current") {
      icon = "Check";
      title = `Use “${lastSegment(listing?.path ?? "")}”`;
      subtitle = listing?.path ?? null;
    } else if (row.kind === "parent") {
      icon = "Folder";
      title = "..";
    } else {
      title = row.name;
    }
    return (
      <li key={row.key} role="option" aria-selected={selected}>
        <button
          type="button"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
            selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
          )}
          onMouseEnter={() => setActive(index)}
          onClick={() => activate(row)}
        >
          <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {subtitle === null ? null : (
            // rtl keeps the end of a long path visible; bdi keeps the path itself in order.
            <span dir="rtl" className="hidden max-w-[55%] truncate text-left text-xs text-muted-foreground sm:inline">
              <bdi>{shortPath(subtitle, home)}</bdi>
            </span>
          )}
          {row.kind === "dir" || row.kind === "parent" ? (
            <Icon name="ChevronRight" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
        </button>
      </li>
    );
  };

  const firstFolderRow = rows.findIndex((row) => row.kind !== "project");

  return (
    <div className="flex max-h-[min(26rem,60vh)] w-full flex-col gap-1 p-1">
      <input
        ref={inputRef}
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Filter projects and folders, or type a path (~/…)"
        aria-label="Filter projects and folders, or type a path"
        className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      {error === null ? null : (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {isPathQuery ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">Press Enter to open {query}</p>
      ) : (
        <ul role="listbox" aria-label="Folders" className="min-h-0 flex-1 overflow-y-auto">
          {rows.map((row, index) => (
            <FragmentWithHeader
              key={row.key}
              header={
                index === 0 && row.kind === "project"
                  ? "Projects"
                  : index === firstFolderRow
                    ? (listing === null ? "Folders" : shortPath(listing.path, home))
                    : null
              }
            >
              {renderRow(row, index)}
            </FragmentWithHeader>
          ))}
          {listing?.truncated ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Showing the first {listing.dirs.length} folders</li>
          ) : null}
          {projects === null || listing === null ? (
            <li className="px-2 py-1 text-xs text-muted-foreground">Loading…</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function FragmentWithHeader({ header, children }: { header: string | null; children: ReactNode }) {
  return (
    <>
      {header === null ? null : (
        <li role="presentation" className="truncate px-2 pb-0.5 pt-2 text-xs font-medium text-muted-foreground">
          {header}
        </li>
      )}
      {children}
    </>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "context-folder",
    plusMenu: [
      {
        id: "select-folder",
        label: "Select folder",
        icon: "FolderPlus",
        description: "Give the agent an extra folder or bb project as context",
        run: ({ composer }) => {
          composer.experimental_openPopup(POPUP_ID);
        },
      },
    ],
    experimental_popups: [{ id: POPUP_ID, label: "Select folder", component: SelectFolderPopup }],
  });
});

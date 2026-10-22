// bb-plugin-todo — a personal todo list.
//
// One SQLite table serves four surfaces: the Todo page in the BB sidebar
// (app.tsx, over RPC), native agent tools (todo_add / todo_list), the
// `bb todo` CLI, and the skill in skills/todo/SKILL.md. Every write publishes
// a realtime signal so open pages refetch.
import { randomUUID } from "node:crypto";
import {
  PluginCliError,
  cliCommand,
  defineCli,
  defineRpcContract,
  type BbPluginApi,
} from "@get-bb/plugin-sdk";
import { z } from "zod";

export const PRIORITIES = ["high", "normal", "low"] as const;
const prioritySchema = z.enum(PRIORITIES);
export type Priority = z.infer<typeof prioritySchema>;

const todoSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string(),
  project: z.string(),
  priority: prioritySchema,
  done: z.boolean(),
  createdAt: z.string(),
  doneAt: z.string().nullable(),
  threadId: z.string().nullable(),
});
export type Todo = z.infer<typeof todoSchema>;

const titleSchema = z.string().trim().min(1).max(300);
const notesSchema = z.string().trim().max(4000);
const projectSchema = z.string().trim().min(1).max(80);

export const rpcContract = defineRpcContract({
  todos_list: {
    input: z.null(),
    output: z.object({ todos: z.array(todoSchema) }),
  },
  todos_add: {
    input: z.object({
      title: titleSchema,
      project: projectSchema,
      priority: prioritySchema,
    }),
    output: todoSchema,
  },
  todos_update: {
    input: z.object({
      id: z.string(),
      title: titleSchema.optional(),
      notes: notesSchema.optional(),
      project: projectSchema.optional(),
      priority: prioritySchema.optional(),
      done: z.boolean().optional(),
    }),
    output: todoSchema,
  },
  todos_remove: {
    input: z.object({ id: z.string() }),
    output: z.object({ removed: z.boolean() }),
  },
});

const TODOS_CHANGED = "todos-changed";
const FALLBACK_PROJECT = "Inbox";
const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const PRIORITY_MARK: Record<Priority, string> = {
  high: "!!",
  normal: "· ",
  low: "··",
};

type Row = {
  id: string;
  title: string;
  notes: string;
  project: string;
  priority: Priority;
  done: number;
  created_at: string;
  done_at: string | null;
  thread_id: string | null;
};

function fromRow(row: Row): Todo {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    project: row.project,
    priority: row.priority,
    done: row.done === 1,
    createdAt: row.created_at,
    doneAt: row.done_at,
    threadId: row.thread_id,
  };
}

export default async function plugin(bb: BbPluginApi) {
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      project TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      done_at TEXT,
      thread_id TEXT
    )`,
  ]);

  function changed() {
    bb.realtime.publish(TODOS_CHANGED, {});
  }

  /** Open todos first by priority then age; done todos last, newest first. */
  function listTodos(): Todo[] {
    const rows = db
      .prepare(
        `SELECT * FROM todos ORDER BY done ASC,
           CASE WHEN done = 1 THEN done_at END DESC,
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END ASC,
           created_at ASC`,
      )
      .all() as Row[];
    return rows.map(fromRow);
  }

  function getTodo(id: string): Todo | null {
    const row = db.prepare(`SELECT * FROM todos WHERE id = ?`).get(id) as
      | Row
      | undefined;
    return row === undefined ? null : fromRow(row);
  }

  /** Reuse an existing project's spelling so "acme" and "Acme" stay one group. */
  function canonicalProject(name: string): string {
    const row = db
      .prepare(`SELECT project FROM todos WHERE lower(project) = lower(?) LIMIT 1`)
      .get(name) as { project: string } | undefined;
    return row?.project ?? name;
  }

  function knownProjects(): string[] {
    const rows = db
      .prepare(`SELECT DISTINCT project FROM todos ORDER BY project`)
      .all() as { project: string }[];
    return rows.map((row) => row.project);
  }

  /** The BB project of the calling thread, or Inbox outside a thread. */
  async function defaultProject(projectId: string | undefined): Promise<string> {
    if (projectId === undefined) return FALLBACK_PROJECT;
    try {
      const project = await bb.sdk.projects.get({ projectId });
      return project.name.trim() === "" ? FALLBACK_PROJECT : project.name;
    } catch {
      return FALLBACK_PROJECT;
    }
  }

  function addTodo(input: {
    title: string;
    notes?: string;
    project: string;
    priority: Priority;
    threadId?: string | null;
  }): Todo {
    const todo: Todo = {
      id: randomUUID().slice(0, 8),
      title: input.title,
      notes: input.notes ?? "",
      project: canonicalProject(input.project),
      priority: input.priority,
      done: false,
      createdAt: new Date().toISOString(),
      doneAt: null,
      threadId: input.threadId ?? null,
    };
    db.prepare(
      `INSERT INTO todos (id, title, notes, project, priority, done, created_at, done_at, thread_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
    ).run(
      todo.id,
      todo.title,
      todo.notes,
      todo.project,
      todo.priority,
      todo.createdAt,
      todo.threadId,
    );
    changed();
    return todo;
  }

  function updateTodo(
    id: string,
    patch: Partial<Pick<Todo, "title" | "notes" | "project" | "priority" | "done">>,
  ): Todo | null {
    const todo = getTodo(id);
    if (todo === null) return null;
    const next: Todo = {
      ...todo,
      ...patch,
      project:
        patch.project === undefined ? todo.project : canonicalProject(patch.project),
    };
    if (patch.done !== undefined && patch.done !== todo.done) {
      next.doneAt = patch.done ? new Date().toISOString() : null;
    }
    db.prepare(
      `UPDATE todos SET title = ?, notes = ?, project = ?, priority = ?, done = ?, done_at = ?
       WHERE id = ?`,
    ).run(
      next.title,
      next.notes,
      next.project,
      next.priority,
      next.done ? 1 : 0,
      next.doneAt,
      id,
    );
    changed();
    return next;
  }

  function removeTodo(id: string): boolean {
    const removed = db.prepare(`DELETE FROM todos WHERE id = ?`).run(id).changes > 0;
    if (removed) changed();
    return removed;
  }

  bb.rpc.register(rpcContract, {
    todos_list: async () => ({ todos: listTodos() }),
    todos_add: (input) => addTodo(input),
    todos_update: async ({ id, ...patch }) => {
      const todo = updateTodo(id, patch);
      if (todo === null) throw new Error(`Задача ${id} не найдена`);
      return todo;
    },
    todos_remove: async ({ id }) => ({ removed: removeTodo(id) }),
  });

  // ---- Text output shared by the CLI and agent tools -----------------------

  function formatTodo(todo: Todo): string {
    const box = todo.done ? "[x]" : "[ ]";
    return `${box} ${todo.id} ${PRIORITY_MARK[todo.priority]} ${todo.title}`;
  }

  function formatList(todos: Todo[], { all }: { all: boolean }): string {
    const shown = all ? todos : todos.filter((todo) => !todo.done);
    if (shown.length === 0) return all ? "Список пуст." : "Открытых задач нет.";
    const groups = new Map<string, Todo[]>();
    for (const todo of shown) {
      const group = groups.get(todo.project) ?? [];
      group.push(todo);
      groups.set(todo.project, group);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([project, items]) =>
        [`## ${project} (${items.length})`, ...items.map(formatTodo)].join("\n"),
      )
      .join("\n\n");
  }

  function findOrThrow(id: string): Todo {
    const todo = getTodo(id);
    if (todo === null) {
      throw new PluginCliError(`No todo with id ${id}`, {
        code: "todo_not_found",
        hint: 'Run "bb todo list --all" to see ids.',
      });
    }
    return todo;
  }

  // ---- Native agent tools --------------------------------------------------

  bb.agents.registerTool({
    name: "todo_add",
    description:
      "Add a task to the user's personal todo list (the Todo page in the BB sidebar). " +
      "Use when the user says to put something in the todo list / «поставь в туду», «закинь в задачи», «в тудулист». " +
      "Tasks are things the user will do themselves later, carefully, at their computer.",
    instructions:
      "When the user asks to put something into the todo list («в туду», «в тудулист», «в задачи»), call todo_add. " +
      "Write the title as a short actionable phrase in the user's language. Put the context needed to do the task later " +
      "(what was found, links, commands, file paths, the exact text the user pointed at) into notes, self-contained, " +
      "because the user will read it without this conversation. Omit project unless the user names one or the task clearly " +
      "belongs to a project other than the current thread's BB project.",
    presentation: {
      label: { pending: "Adding to todo list", completed: "Added to todo list" },
    },
    parameters: z.object({
      title: titleSchema.describe("Short actionable task title"),
      notes: notesSchema
        .optional()
        .describe("Self-contained context: what to do, why, links, paths, snippets"),
      project: projectSchema
        .optional()
        .describe("Project name; defaults to the current thread's BB project"),
      priority: prioritySchema
        .optional()
        .describe("high = urgent/important, normal (default), low = someday"),
    }),
    async execute({ title, notes, project, priority }, { threadId, projectId }) {
      const todo = addTodo({
        title,
        notes,
        project: project ?? (await defaultProject(projectId)),
        priority: priority ?? "normal",
        threadId,
      });
      return `Added to todo list → ${todo.project}\n${formatTodo(todo)}`;
    },
  });

  bb.agents.registerTool({
    name: "todo_list",
    description:
      "Show the user's personal todo list grouped by project, with ids and priorities (!! high, · normal, ·· low).",
    presentation: {
      label: { pending: "Reading todo list", completed: "Read todo list" },
    },
    parameters: z.object({
      all: z.boolean().optional().describe("Include completed tasks"),
    }),
    async execute({ all }) {
      return formatList(listTodos(), { all: all === true });
    },
  });

  // ---- `bb todo` CLI -------------------------------------------------------

  const json = { type: "boolean", description: "Emit JSON" } as const;
  const reply = (asJson: boolean, value: unknown, text: string) => ({
    exitCode: 0,
    stdout: asJson ? JSON.stringify(value) : text,
  });

  bb.cli.register(
    defineCli({
      name: "todo",
      summary: "Personal todo list (projects + priorities)",
      commands: {
        list: cliCommand({
          summary: "List open todos grouped by project",
          options: {
            all: { type: "boolean", description: "Include done todos" },
            project: { type: "string", description: "Only this project" },
            json,
          },
          run({ options }) {
            let todos = listTodos();
            if (options.project !== undefined) {
              const wanted = options.project.toLowerCase();
              todos = todos.filter((todo) => todo.project.toLowerCase() === wanted);
            }
            return reply(options.json, todos, formatList(todos, { all: options.all }));
          },
        }),
        add: cliCommand({
          summary: "Add a todo",
          positionals: [
            { name: "title", description: "Task title", required: true, variadic: true },
          ],
          options: {
            project: {
              type: "string",
              aliases: ["p"],
              description: "Project (default: the thread's BB project, else Inbox)",
            },
            priority: {
              type: "enum",
              values: PRIORITIES,
              default: "normal",
              aliases: ["prio"],
              description: "high | normal | low",
            },
            notes: {
              type: "string",
              aliases: ["note", "details"],
              description: "Context for later (max 4000 chars)",
            },
            json,
          },
          async run({ positionals, options }, ctx) {
            const title = titleSchema.safeParse(positionals.title.join(" "));
            if (!title.success) {
              throw new PluginCliError("Title must be 1–300 characters", {
                code: "invalid_title",
              });
            }
            const notes = notesSchema.safeParse(options.notes ?? "");
            if (!notes.success) {
              throw new PluginCliError("Notes must be at most 4000 characters", {
                code: "invalid_notes",
              });
            }
            const project = projectSchema.safeParse(
              options.project ?? (await defaultProject(ctx.projectId)),
            );
            if (!project.success) {
              throw new PluginCliError("Project must be 1–80 characters", {
                code: "invalid_project",
              });
            }
            const todo = addTodo({
              title: title.data,
              notes: notes.data,
              project: project.data,
              priority: options.priority as Priority,
              threadId: ctx.threadId ?? null,
            });
            return reply(options.json, todo, `Added → ${todo.project}\n${formatTodo(todo)}`);
          },
        }),
        done: cliCommand({
          summary: "Mark a todo done",
          positionals: [{ name: "id", description: "Todo id", required: true }],
          options: { json },
          run({ positionals, options }) {
            findOrThrow(positionals.id);
            const todo = updateTodo(positionals.id, { done: true })!;
            return reply(options.json, todo, formatTodo(todo));
          },
        }),
        undo: cliCommand({
          summary: "Reopen a done todo",
          positionals: [{ name: "id", description: "Todo id", required: true }],
          options: { json },
          run({ positionals, options }) {
            findOrThrow(positionals.id);
            const todo = updateTodo(positionals.id, { done: false })!;
            return reply(options.json, todo, formatTodo(todo));
          },
        }),
        edit: cliCommand({
          summary: "Change a todo's title, project, priority, or notes",
          positionals: [{ name: "id", description: "Todo id", required: true }],
          options: {
            title: { type: "string", description: "New title" },
            project: { type: "string", aliases: ["p"], description: "Move to project" },
            priority: {
              type: "enum",
              values: PRIORITIES,
              aliases: ["prio"],
              description: "high | normal | low",
            },
            notes: { type: "string", aliases: ["note"], description: "Replace notes" },
            json,
          },
          constraints: [
            { kind: "at-least-one", options: ["title", "project", "priority", "notes"] },
          ],
          run({ positionals, options }) {
            findOrThrow(positionals.id);
            const patch = z
              .object({
                title: titleSchema.optional(),
                notes: notesSchema.optional(),
                project: projectSchema.optional(),
                priority: prioritySchema.optional(),
              })
              .safeParse(options);
            if (!patch.success) {
              throw new PluginCliError(patch.error.issues[0]?.message ?? "Invalid value", {
                code: "invalid_value",
              });
            }
            const todo = updateTodo(positionals.id, patch.data)!;
            return reply(options.json, todo, `${todo.project}\n${formatTodo(todo)}`);
          },
        }),
        remove: cliCommand({
          summary: "Delete a todo",
          aliases: ["rm", "delete"],
          positionals: [{ name: "id", description: "Todo id", required: true }],
          options: { json },
          run({ positionals, options }) {
            findOrThrow(positionals.id);
            removeTodo(positionals.id);
            return reply(options.json, { removed: true, id: positionals.id }, `Removed ${positionals.id}`);
          },
        }),
        projects: cliCommand({
          summary: "List project names already used",
          options: { json },
          run({ options }) {
            const projects = knownProjects();
            return reply(options.json, projects, projects.join("\n") || "No projects yet.");
          },
        }),
      },
    }),
  );
}

// Pure logic of Short Titles: what to ask the model and how to clean its reply.

export function systemPrompt(maxWords: number): string {
  const few = Math.max(1, maxWords - 1);
  return `You name chat threads for a sidebar. Reply with the title only: ${few === 1 ? "1 word" : `1-${few} words`}, ${maxWords} at most, under 24 characters.
Name the subject of the task (the product, feature, or thing being worked on), not the action. No verbs like "make", "fix", "сделать". No quotes, no trailing punctuation.
Write it in the language of the task; keep product names, ticket ids and identifiers as written. Capitalize the first word only.
When a current title is given, keep it only if it already fits these rules; otherwise write a new short one.

Examples:
Task: Сделай плагин, который через минуту меняет название сессии исходя из промпта -> Названия тредов
Task: Design the onboarding flow v3 with MCP, iPhone install and notifications -> Onboarding v3
Task: почему ночной CI красный на main, посмотри логи и почини -> Красный CI
Task: Compare prices for iPhone 17 Pro in Almaty stores -> iPhone 17 Pro`;
}

const COMMANDS_MARK = "The prompt invokes these commands";
const TASK_MARK = "Task:\n";

/**
 * bb writes one prompt per helper task. A thread-title prompt carries a
 * "Task:" section; return everything from the task context on, without bb's
 * own length rules. Null means another task (a commit message): pass it through.
 */
export function titleContext(prompt: string): string | null {
  const task = prompt.indexOf(TASK_MARK);
  if (task < 0 || !/\btitles?\b/iu.test(prompt.slice(0, task))) return null;
  const commands = prompt.lastIndexOf(COMMANDS_MARK, task);
  return prompt.slice(commands >= 0 ? commands : task).trim();
}

const EDGES = /^["'`«“‘*_\s]+|["'`»”’*_\s.!?…:;,]+$/gu;

export function cleanTitle(raw: string, maxWords: number): string {
  const line =
    raw
      .replace(/<think(?:ing)?>[\s\S]*?(?:<\/think(?:ing)?>|$)/giu, "")
      .split(/\r?\n/u)
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  const words = line
    .replace(EDGES, "")
    .replace(/^(?:title|название)\s*:\s*/iu, "")
    .replace(EDGES, "")
    .split(/\s+/u)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ").replace(/[.:;,\-–—]+$/u, "");
}

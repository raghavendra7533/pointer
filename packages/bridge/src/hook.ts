import { formatSelections } from "@pointer/core/format";
import { BridgeClient } from "./client.ts";

/**
 * Claude Code UserPromptSubmit hook. Prints a delimited block for a fresh,
 * not-yet-delivered selection and stays completely silent otherwise, so a
 * missing bridge or an old selection never disturbs a prompt.
 */
export async function runHook(client = new BridgeClient()): Promise<string> {
  try {
    const set = await client.get({ consumeForHook: true });
    if (!set.selections.length || set.stale) return "";
    return formatSelections(set.selections) + "\n";
  } catch {
    return "";
  }
}

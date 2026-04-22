import { SlashCommandRegistry } from "../slash-command-registry.js";
import { SlashCommandDispatcher } from "../slash-command-dispatcher.js";
import { createSessionOps } from "./session-ops.js";
import { bridgeCommands } from "./bridge-commands.js";

export function createSlashSystem({ engine, hub }) {
  const registry = new SlashCommandRegistry();
  const sessionOps = createSessionOps({ engine });
  const dispatcher = new SlashCommandDispatcher({ registry, engine, hub, sessionOps });
  for (const def of bridgeCommands) registry.registerCommand(def);
  return { registry, dispatcher, sessionOps };
}

const OWNED_FLAGS = new Set(["--model", "--effort"]);

/**
 * Build the Claude arguments of a group loop session from the board policy loop model.
 *
 * @remarks
 * A `null` loop model means the session settings, so the configured arguments stay as they are.
 * Otherwise `--model` and `--effort` leave the configured arguments, so the policy wins over Settings.
 */
export function groupLaunchArgs(input: {
  loopModel: string | null;
  claudeArgs: string[];
}): { leadingArgs: string[]; claudeArgs: string[] } {
  if (input.loopModel === null) {
    return { leadingArgs: [], claudeArgs: input.claudeArgs };
  }
  const [model, effort] = input.loopModel.split(":");
  const kept: string[] = [];
  const args = input.claudeArgs;
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i].split("=", 1)[0];
    if (!OWNED_FLAGS.has(name)) {
      kept.push(args[i]);
    } else if (!args[i].includes("=") && i + 1 < args.length) {
      if (!args[i + 1].startsWith("-")) i += 1;
    }
  }
  return {
    leadingArgs: ["--model", model, "--effort", effort],
    claudeArgs: kept,
  };
}

import { constants, existsSync, watch, type FSWatcher } from "node:fs";
import {
  open,
  readdir,
  realpath,
  stat,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import type {
  ActivityEvent,
  Card,
  LoopProgress,
} from "../../../shared/types.js";
import { isLoopCard } from "../../../shared/running-group.js";
import { boardRepository as store } from "../../store/board-repository.js";
import {
  buildLoopProgress,
  buildPrdProgress,
  ENGINE_FILE,
  openEngineText,
  parseProgressFile,
  phaseDir,
  progressPathOf,
  reasonOf,
  unitFilePaths,
} from "../domain/loop-progress.js";
import {
  doneMatchesLoop,
  featureDir,
  parsePrdEngine,
  prdSlugOf,
} from "../domain/prd-progress.js";

const MAX_BYTES = 1_048_576;
const ROADMAP_PATTERN = /^ROADMAP.*\.md$/;
const SLUG_HINT = /\bslug\s+`?([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)`?/g;
const LOG_PREFIX = "[loop-progress]";
const OPEN_FLAGS =
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const warnedWatchDirs = new Set<string>();

interface Named {
  name: string;
  mtimeMs: number;
}

function isMissing(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return (
    rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)
  );
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    const info = await stat(file);
    return info.isFile() ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

async function listFiles(
  dir: string,
  accept: RegExp | null,
  rest: string,
): Promise<Named[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const found: Named[] = [];
  for (const name of names) {
    if (accept !== null && !accept.test(name)) continue;
    const mtimeMs = await mtimeOf(path.join(dir, name, rest));
    if (mtimeMs !== null) found.push({ name, mtimeMs });
  }
  return found;
}

function newestOf(items: Named[]): Named {
  return items.reduce((best, item) =>
    item.mtimeMs > best.mtimeMs ? item : best,
  );
}

async function readCapped(handle: FileHandle, size: number): Promise<Buffer> {
  const buffer = Buffer.alloc(Math.min(size, MAX_BYTES) + 1);
  let total = 0;
  while (total < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      total,
      buffer.length - total,
      total,
    );
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return buffer.subarray(0, total);
}

/**
 * Reads one file under the session root, or null when it is missing, unsafe or too large.
 *
 * @remarks Resolves the real path first, then opens it with O_NOFOLLOW so a symlink swapped in after the check cannot lead outside the root. A missing file adds no warning.
 */
async function readSafe(
  root: string,
  realRoot: string,
  rel: string,
  warnings: string[],
): Promise<string | null> {
  const target = path.resolve(root, rel);
  const outside = `${rel}: outside the session root`;
  if (!isInside(root, target)) {
    warnings.push(outside);
    return null;
  }
  const tooLarge = `${rel}: larger than 1 MiB`;
  let handle: FileHandle | undefined;
  try {
    const real = await realpath(target);
    if (!isInside(realRoot, real)) {
      warnings.push(outside);
      return null;
    }
    handle = await open(real, OPEN_FLAGS);
    const info = await handle.stat();
    if (!info.isFile()) {
      warnings.push(`${rel}: not a file`);
      return null;
    }
    if (info.size > MAX_BYTES) {
      warnings.push(tooLarge);
      return null;
    }
    const bytes = await readCapped(handle, info.size);
    if (bytes.length > MAX_BYTES) {
      warnings.push(tooLarge);
      return null;
    }
    return bytes.toString("utf8");
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "ELOOP") {
      warnings.push(outside);
    } else if (!isMissing(error)) {
      warnings.push(`${rel}: ${reasonOf(error)}`);
    }
    return null;
  } finally {
    await handle?.close();
  }
}

function pickSlug(
  folders: Named[],
  engineText: string | null,
  warnings: string[],
): string {
  if (folders.length === 1) return folders[0].name;
  for (const match of (engineText ?? "").matchAll(SLUG_HINT)) {
    const hinted = folders.find((folder) => folder.name === match[1]);
    if (hinted) return hinted.name;
  }
  const chosen = newestOf(folders).name;
  warnings.push(`.roadmap: several loop folders, using ${chosen}`);
  return chosen;
}

async function pickRoadmap(
  root: string,
  progressText: string | null,
  warnings: string[],
): Promise<string | null> {
  const named =
    progressText === null ? null : parseProgressFile(progressText).roadmapPath;
  if (named !== null) {
    const base = path.basename(named);
    if ((await mtimeOf(path.join(root, base))) !== null) return base;
  }
  const files = await listFiles(root, ROADMAP_PATTERN, "");
  if (files.length === 0) return null;
  if (files.length === 1) return files[0].name;
  const chosen = newestOf(files).name;
  warnings.push(`session root: several ROADMAP files, using ${chosen}`);
  return chosen;
}

interface ReadOptions {
  single?: boolean;
  previous?: LoopProgress;
  identifier?: string;
}

/**
 * Lists the unit file paths under the card identifier slug, index for index with the roadmap slug list, or null when the two slugs match.
 *
 * @remarks A roadmap loop can pass `<identifier>-unit-<N>` to ralph-gate.sh instead of `<roadmap slug>-unit-<N>`, so the gate lines land in that folder (GROUP-27).
 */
function cardSlugPaths(
  roadmapText: string,
  slug: string,
  identifier: string | undefined,
): string[] | null {
  const alias = identifier?.toLowerCase();
  if (alias === undefined || alias === slug) return null;
  return unitFilePaths(roadmapText, alias).paths;
}

interface GuardedReader {
  warnings: string[];
  refused: Set<string>;
  read: (rel: string) => Promise<string | null>;
}

async function guardedReader(root: string): Promise<GuardedReader> {
  const realRoot = await realpath(root);
  const warnings: string[] = [];
  const refused = new Set<string>();
  const read = async (rel: string): Promise<string | null> => {
    const before = warnings.length;
    const text = await readSafe(root, realRoot, rel, warnings);
    if (warnings.length > before) refused.add(rel);
    return text;
  };
  return { warnings, refused, read };
}

async function readEngineText(
  reader: GuardedReader,
  previous: LoopProgress | undefined,
): Promise<{ text: string | null; closed: boolean }> {
  const text = await reader.read(ENGINE_FILE);
  if (text !== null || reader.refused.has(ENGINE_FILE)) {
    return { text, closed: false };
  }
  const doneText = await reader.read(`${ENGINE_FILE}.done`);
  if (doneText !== null && doneMatchesLoop(doneText, previous)) {
    return { text: doneText, closed: true };
  }
  if (previous?.engine?.active === true && !previous.engine.closed) {
    reader.warnings.push("engine file removed without a close");
    return {
      text: openEngineText(previous.engine, previous.slug),
      closed: false,
    };
  }
  return { text: null, closed: false };
}

/**
 * Finds the newest `.planning/prds/<slug>.md` or `<slug>-*.md` under the root or one folder below it, trying each slug in order.
 *
 * @remarks A single loop with no PRD path in its engine file still has its PRD and state folder named by the slug, often inside a repo worktree under the workspace root.
 */
async function prdBySlug(
  root: string,
  slugs: (string | undefined)[],
): Promise<{ prdFile: string; slug: string } | null> {
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return null;
  }
  const bases = ["", ...names.filter((name) => !name.startsWith("."))];
  for (const slug of new Set(slugs)) {
    if (slug === undefined || prdSlugOf(slug) !== slug) continue;
    const matches: Named[] = [];
    for (const base of bases) {
      const dir = path.join(base, ".planning", "prds");
      for (const file of await listFiles(path.join(root, dir), null, "")) {
        if (
          file.name === `${slug}.md` ||
          (file.name.startsWith(`${slug}-`) && file.name.endsWith(".md"))
        ) {
          matches.push({ ...file, name: path.join(dir, file.name) });
        }
      }
    }
    if (matches.length > 0) return { prdFile: newestOf(matches).name, slug };
  }
  return null;
}

async function readPrdModel(
  root: string,
  previous: LoopProgress | undefined,
  identifier?: string,
): Promise<LoopProgress | null> {
  let reader: GuardedReader;
  try {
    reader = await guardedReader(root);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const { warnings, refused, read } = reader;
  const { text: engineText, closed } = await readEngineText(reader, previous);
  const parsed = parsePrdEngine(engineText ?? "");
  const sameLoop = parsed.slug === null || parsed.slug === previous?.slug;
  const known = sameLoop ? previous?.prdFile : undefined;
  const found =
    parsed.prdPath === null && known === undefined
      ? await prdBySlug(
          root,
          parsed.slug === null
            ? [identifier?.toLowerCase(), identifier]
            : [parsed.slug],
        )
      : null;
  const prdFile = parsed.prdPath ?? known ?? found?.prdFile ?? null;
  const engine = engineText === null ? null : { text: engineText, closed };
  if (prdFile === null) {
    if (parsed.slug === null) return null;
    warnings.push(`${ENGINE_FILE}: no PRD path in the loop prompt`);
    return buildPrdProgress({
      slug: parsed.slug,
      prdFile: null,
      readAt: new Date().toISOString(),
      prdText: null,
      statePath: null,
      stateText: null,
      attemptsPath: null,
      attemptsText: null,
      engine,
      refused,
      warnings,
    });
  }
  const prdRel = path.isAbsolute(prdFile)
    ? path.relative(root, prdFile)
    : path.normalize(prdFile);
  const outside = !isInside(root, path.resolve(root, prdRel));
  const slug =
    parsed.slug ??
    found?.slug ??
    (parsed.prdPath === null ? previous?.slug : undefined) ??
    prdSlugOf(prdRel);
  if (slug === null || slug === undefined) return null;

  let prdText: string | null = null;
  let statePath: string | null = null;
  let stateText: string | null = null;
  let attemptsPath: string | null = null;
  let attemptsText: string | null = null;
  if (outside) {
    warnings.push(`${prdFile}: outside the session root`);
    refused.add(prdFile);
  } else {
    prdText = await read(prdRel);
    const dir = featureDir(prdRel, slug);
    if (dir === null) {
      warnings.push(`${prdRel}: no .planning/ folder in the PRD path`);
    } else {
      statePath = `${dir}/state.md`;
      attemptsPath = `${dir}/attempts.md`;
      stateText = await read(statePath);
      attemptsText = await read(attemptsPath);
    }
  }
  const model = buildPrdProgress({
    slug,
    prdFile: outside ? prdFile : prdRel,
    readAt: new Date().toISOString(),
    prdText,
    statePath,
    stateText,
    attemptsPath,
    attemptsText,
    engine,
    refused,
    warnings,
  });
  if (outside) delete model.prdFile;
  return model;
}

async function readModel(
  sessionRoot: string,
  options: ReadOptions,
): Promise<LoopProgress | null> {
  const root = path.resolve(sessionRoot);
  const folders = await listFiles(
    path.join(root, ".roadmap"),
    null,
    "progress.md",
  );
  if (folders.length === 0) {
    return options.single === true
      ? readPrdModel(root, options.previous, options.identifier)
      : null;
  }
  const reader = await guardedReader(root);
  const { warnings, refused, read } = reader;
  const { text: engineText, closed } = await readEngineText(
    reader,
    options.previous,
  );
  const slug = pickSlug(folders, engineText, warnings);
  const progressText = await read(progressPathOf(slug));
  const roadmapFile = await pickRoadmap(root, progressText, warnings);
  if (roadmapFile === null) return null;
  const roadmapText = await read(roadmapFile);
  if (roadmapText === null || roadmapText.trim() === "") return null;

  const listed = unitFilePaths(roadmapText, slug);
  warnings.push(...listed.warnings);
  const files = new Map<string, string | null>();
  const alias = cardSlugPaths(roadmapText, slug, options.identifier);
  for (const [index, rel] of listed.paths.entries()) {
    if (files.has(rel)) continue;
    let text = await read(rel);
    const other = alias?.[index];
    if (
      text === null &&
      other !== undefined &&
      other !== rel &&
      !refused.has(rel)
    ) {
      text = await read(other);
    }
    files.set(rel, text);
  }

  return buildLoopProgress({
    slug,
    roadmapFile,
    readAt: new Date().toISOString(),
    roadmapText,
    progressText,
    engine: engineText === null ? null : { text: engineText, closed },
    files,
    refused,
    warnings,
  });
}

/** Read one loop file under a session root with the same guards as the progress read, or null. */
export async function readLoopFile(
  root: string,
  rel: string,
): Promise<string | null> {
  try {
    return await readSafe(root, await realpath(root), rel, []);
  } catch {
    return null;
  }
}

/**
 * Reads the loop files under a session root into the loop model, or null when the root has no loop.
 *
 * @remarks Never throws: an unexpected failure is logged and read as null.
 */
export async function readLoopProgress(
  sessionRoot: string,
  options: ReadOptions = {},
): Promise<LoopProgress | null> {
  try {
    return await readModel(sessionRoot, options);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${sessionRoot}: ${reasonOf(error)}`);
    return null;
  }
}

function isTracked(
  card: Card | undefined,
): card is Card & { workspacePath: string } {
  return (
    card !== undefined &&
    isLoopCard(card) &&
    card.column !== "done" &&
    card.workspacePath !== undefined &&
    card.workspacePath !== ""
  );
}

function phaseDirOf(progress: LoopProgress, root: string): string | null {
  const unit = progress.units.find(
    (candidate) => candidate.number === progress.summary.currentUnit,
  );
  let rel: string | null = null;
  if (progress.prdFile !== undefined) {
    rel = featureDir(progress.prdFile, progress.slug);
  } else if (unit?.prdPath != null) {
    rel = phaseDir(unit.prdPath, progress.slug, unit.number);
  }
  if (rel === null) return null;
  const dir = path.resolve(root, rel);
  return isInside(root, dir) ? dir : null;
}

/**
 * Returns the current unit state folder under the card identifier slug, or null when the reader has no fallback to it.
 *
 * @remarks Mirrors the `cardSlugPaths` fallback of the roadmap read, so a gate pass in `<identifier>-unit-<N>` shows within the watch delay.
 */
function identifierDirOf(
  progress: LoopProgress,
  root: string,
  identifier: string | undefined,
): string | null {
  const alias = identifier?.toLowerCase();
  if (alias === undefined || alias === progress.slug) return null;
  if (progress.prdFile !== undefined) return null;
  return phaseDirOf({ ...progress, slug: alias }, root);
}

const inFlight = new Map<string, Promise<void>>();
const rerun = new Set<string>();
const forced = new Set<string>();

async function refreshOnce(cardId: string): Promise<void> {
  const force = forced.delete(cardId);
  try {
    const card = store.getCard(cardId);
    if (!isTracked(card)) return;
    const root = path.resolve(card.workspacePath);
    const progress = await readLoopProgress(root, {
      single: card.source !== "group",
      previous: card.loopProgress,
      identifier: card.identifier,
    });
    if (progress !== null) await store.setLoopProgress(cardId, progress, force);
  } catch (error) {
    console.warn(`${LOG_PREFIX} ${cardId}: ${reasonOf(error)}`);
  }
}

async function refreshUntilQuiet(cardId: string): Promise<void> {
  try {
    do {
      rerun.delete(cardId);
      await refreshOnce(cardId);
    } while (rerun.has(cardId));
  } finally {
    inFlight.delete(cardId);
  }
}

/**
 * Re-reads the loop files of one tracked loop card and stores the result.
 *
 * @remarks A call during a read queues exactly one more read and returns the in-flight promise, which settles after that rerun. The promise never rejects. `force` makes the next store write persist even when only `readAt` changed.
 */
export function refreshLoopProgress(
  cardId: string,
  force = false,
): Promise<void> {
  if (force) forced.add(cardId);
  const running = inFlight.get(cardId);
  if (running !== undefined) {
    rerun.add(cardId);
    return running;
  }
  const started = refreshUntilQuiet(cardId);
  inFlight.set(cardId, started);
  return started;
}

function trackedCards(): (Card & { workspacePath: string })[] {
  const cards: (Card & { workspacePath: string })[] = [];
  for (const board of store.listBoards()) {
    for (const card of store.snapshot(board.key).cards) {
      if (isTracked(card)) cards.push(card);
    }
  }
  return cards;
}

interface CardWatch {
  dirs: Map<string, FSWatcher>;
  debounce: NodeJS.Timeout | null;
}

/** Force a store write on a DONE marker so `readAt` follows it. */
function onActivity(event: ActivityEvent): void {
  if (event.type === "status_agent_done" && event.cardId != null) {
    void refreshLoopProgress(event.cardId, true);
  }
}

/**
 * Starts the file watches and the periodic read of every tracked loop card, and returns the stop function.
 *
 * @remarks The timer also re-syncs the watch set, so folders that appear later get a watch within one interval.
 */
export function startLoopProgressReader(
  options: { intervalMs?: number; debounceMs?: number } = {},
): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  const debounceMs = options.debounceMs ?? 300;
  const watches = new Map<string, CardWatch>();
  let stopped = false;

  const closeDir = (entry: CardWatch, dir: string): void => {
    entry.dirs.get(dir)?.close();
    entry.dirs.delete(dir);
  };

  const closeCard = (cardId: string): void => {
    const entry = watches.get(cardId);
    if (entry === undefined) return;
    if (entry.debounce !== null) clearTimeout(entry.debounce);
    for (const dir of [...entry.dirs.keys()]) closeDir(entry, dir);
    watches.delete(cardId);
  };

  const addDir = (
    entry: CardWatch,
    dir: string,
    onChange: () => void,
  ): void => {
    try {
      const watcher = watch(dir, { persistent: false }, () => {
        if (entry.debounce !== null) clearTimeout(entry.debounce);
        entry.debounce = setTimeout(() => {
          entry.debounce = null;
          onChange();
        }, debounceMs);
      });
      watcher.on("error", () => closeDir(entry, dir));
      entry.dirs.set(dir, watcher);
    } catch (error) {
      if (!warnedWatchDirs.has(dir)) {
        warnedWatchDirs.add(dir);
        console.warn(`${LOG_PREFIX} watch ${dir}: ${reasonOf(error)}`);
      }
    }
  };

  const wantedDirs = (card: Card & { workspacePath: string }): string[] => {
    const root = path.resolve(card.workspacePath);
    const progress = store.getCard(card.id)?.loopProgress;
    const dirs = [root, path.join(root, ".claude")];
    if (progress === undefined) return dirs;
    dirs.push(path.join(root, ".roadmap", progress.slug));
    const phaseFolder = phaseDirOf(progress, root);
    if (phaseFolder !== null) dirs.push(phaseFolder);
    const aliasFolder = identifierDirOf(progress, root, card.identifier);
    if (aliasFolder !== null) dirs.push(aliasFolder);
    return dirs;
  };

  const reconcile = (
    card: Card & { workspacePath: string },
    onChange: () => void,
  ): void => {
    const entry = watches.get(card.id) ?? {
      dirs: new Map<string, FSWatcher>(),
      debounce: null,
    };
    watches.set(card.id, entry);
    const wanted = wantedDirs(card);
    for (const dir of [...entry.dirs.keys()]) {
      if (!wanted.includes(dir) || !existsSync(dir)) closeDir(entry, dir);
    }
    for (const dir of wanted) {
      if (!entry.dirs.has(dir) && existsSync(dir)) addDir(entry, dir, onChange);
    }
  };

  const refreshAndWatch = async (cardId: string): Promise<void> => {
    await refreshLoopProgress(cardId);
    if (stopped) return;
    const fresh = store.getCard(cardId);
    if (isTracked(fresh)) reconcile(fresh, () => refreshSafely(cardId));
    else closeCard(cardId);
  };

  function refreshSafely(cardId: string): void {
    refreshAndWatch(cardId).catch((error: unknown) => {
      console.warn(`${LOG_PREFIX} ${cardId}: ${reasonOf(error)}`);
    });
  }

  const sync = (): void => {
    if (stopped) return;
    try {
      const cards = trackedCards();
      const live = new Set(cards.map((card) => card.id));
      for (const cardId of [...watches.keys()]) {
        if (!live.has(cardId)) closeCard(cardId);
      }
      for (const card of cards) refreshSafely(card.id);
    } catch (error) {
      console.warn(`${LOG_PREFIX} sync: ${reasonOf(error)}`);
    }
  };

  store.on("activity", onActivity);

  sync();
  const timer = setInterval(sync, intervalMs);
  timer.unref();

  return () => {
    stopped = true;
    store.off("activity", onActivity);
    clearInterval(timer);
    for (const cardId of [...watches.keys()]) closeCard(cardId);
  };
}

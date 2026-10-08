import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IDENTIFIER = "com.dispatch.calendar-helper";

/**
 * Return why the calendar helper build is skipped, or null when it should run.
 *
 * @remarks A missing compiler or a non macOS host must not fail `npm run build`, so CI on Linux and
 * Macs without Xcode tools still build the rest of the product.
 */
export function skipReason(platform, hasSwiftc) {
  if (platform !== "darwin") return "not macOS";
  if (!hasSwiftc) return "swiftc not found";
  return null;
}

/** Report whether `swiftc --version` can start; ENOENT means the compiler is absent. */
function detectSwiftc() {
  const probe = spawnSync("swiftc", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Return whether the build must exit 1 because the helper binary is missing.
 *
 * @remarks Only `--require` (the `prepublishOnly` script) makes a missing binary fatal, so a release
 * cannot ship a package without the helper while a plain build on Linux still passes.
 */
export function mustFail(required, binaryExists) {
  return required && !binaryExists;
}

/** Run one build step and throw when it fails. */
function step(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`${cmd} failed`);
  }
}

/**
 * Compile a universal helper and ad hoc sign it in a temp folder, then rename it into dist/native.
 *
 * @remarks The rename comes only after signing passed, so a failed build leaves the previous app in place.
 */
function build(root, app) {
  const source = path.join(root, "native", "calendar-helper");
  const work = path.join(path.dirname(app), ".DispatchCalendar.build");
  const staged = path.join(work, "DispatchCalendar.app");
  const binary = path.join(staged, "Contents", "MacOS", "DispatchCalendar");
  fs.rmSync(work, { recursive: true, force: true });
  try {
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.copyFileSync(
      path.join(source, "Info.plist"),
      path.join(staged, "Contents", "Info.plist"),
    );
    const slices = ["arm64", "x86_64"].map((arch) => {
      const out = path.join(work, `DispatchCalendar-${arch}`);
      step("swiftc", [
        "-O",
        "-target",
        `${arch}-apple-macos14`,
        path.join(source, "main.swift"),
        "-o",
        out,
      ]);
      return out;
    });
    step("lipo", ["-create", ...slices, "-output", binary]);
    step("codesign", [
      "--force",
      "--sign",
      "-",
      "--identifier",
      IDENTIFIER,
      staged,
    ]);
    fs.rmSync(app, { recursive: true, force: true });
    fs.renameSync(staged, app);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`calendar helper: built ${path.relative(root, app)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const app = path.join(root, "dist", "native", "DispatchCalendar.app");
  const reason = skipReason(
    process.platform,
    process.platform === "darwin" && detectSwiftc(),
  );
  if (reason !== null) {
    console.log(`calendar helper: skipped (${reason})`);
  } else {
    try {
      build(root, app);
    } catch (err) {
      console.error(`calendar helper: ${err.message}`);
      process.exit(1);
    }
  }
  const binary = path.join(app, "Contents", "MacOS", "DispatchCalendar");
  if (mustFail(process.argv.includes("--require"), fs.existsSync(binary))) {
    console.error(`calendar helper: missing ${path.relative(root, binary)}`);
    process.exit(1);
  }
}

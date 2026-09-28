import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const [portArg, fixture] = process.argv.slice(2);
const port = Number(portArg);
if (
  !Number.isInteger(port) ||
  port <= 0 ||
  port === 4700 ||
  port === 4710 ||
  !fixture
) {
  console.error(
    "usage: node scripts/fake-ical.mjs <port> <fixture.ics> (never 4700 or 4710)",
  );
  process.exit(2);
}

const secretPath = `/${crypto.randomBytes(16).toString("hex")}.ics`;
fs.writeFileSync(`${fixture}.path`, `${secretPath}\n`, { mode: 0o600 });

/**
 * Answer the fixture at the secret path, shaped by the mode file next to it.
 */
function answer(res) {
  let mode = "ok";
  try {
    mode = fs.readFileSync(`${fixture}.mode`, "utf8").trim() || "ok";
  } catch {
    mode = "ok";
  }
  if (mode === "404") {
    res.writeHead(404).end();
  } else if (mode === "garbage") {
    res
      .writeHead(200, { "content-type": "text/plain" })
      .end("this is not a calendar\n");
  } else if (mode === "oversize") {
    res.writeHead(200, { "content-type": "text/calendar" });
    const chunk = Buffer.alloc(64 * 1024, "A");
    for (let i = 0; i < 96; i += 1) res.write(chunk);
    res.end();
  } else if (mode === "slow") {
    setTimeout(() => res.writeHead(200).end(fs.readFileSync(fixture)), 35_000);
  } else {
    res
      .writeHead(200, { "content-type": "text/calendar" })
      .end(fs.readFileSync(fixture));
  }
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === secretPath) answer(res);
    else res.writeHead(404).end();
  })
  .listen(port, "127.0.0.1", () => {
    console.log(
      `fake-ical listening on 127.0.0.1:${port}; the path is in ${fixture}.path`,
    );
  });

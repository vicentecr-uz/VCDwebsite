import assert from "node:assert/strict";
import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/fetch-content.sh");
const fixtureSource = path.join(root, "scripts/test/fixtures/content");
const fixtures = [];
test.after(async () => {
  await Promise.all(
    fixtures.map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "vcd-fetch-"));
  fixtures.push(dir);
  const repo = path.join(dir, "content-repo");
  await cp(fixtureSource, repo, { recursive: true });
  await run("git", ["init", "-q", repo]);
  await run("git", ["-C", repo, "add", "."]);
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "content",
  ]);
  await run("git", ["init", "-q", dir]);
  await mkdir(path.join(dir, "scripts"), { recursive: true });
  await cp(script, path.join(dir, "scripts/fetch-content.sh"));
  return {
    dir,
    repo,
    env: { ...process.env, CONTENT_REPO: repo, CONTENT_SOURCE: "repo" },
  };
}

test("repository source refuses replacement unless explicitly enabled", async () => {
  const { dir, env } = await fixture();
  await mkdir(path.join(dir, "src/content"), { recursive: true });
  await writeFile(path.join(dir, "src/content/sentinel"), "keep");
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh")], {
      cwd: dir,
      env,
    }),
  );
  assert.equal(
    await readFile(path.join(dir, "src/content/sentinel"), "utf8"),
    "keep",
  );
});
test("repository source stages fixture with --replace", async () => {
  const { dir, env } = await fixture();
  await mkdir(path.join(dir, "src/content"), { recursive: true });
  await writeFile(path.join(dir, "src/content/sentinel"), "remove");
  await run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
    cwd: dir,
    env,
  });
  assert.match(
    await readFile(path.join(dir, "src/content/settings/header.json"), "utf8"),
    /Test fixture/,
  );
  await assert.rejects(readFile(path.join(dir, "src/content/sentinel")));
});
test("unsupported source mode and failed clone preserve destination", async () => {
  const { dir, env } = await fixture();
  await mkdir(path.join(dir, "src/content"), { recursive: true });
  await writeFile(path.join(dir, "src/content/sentinel"), "keep");
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
      cwd: dir,
      env: { ...env, CONTENT_SOURCE: "sample" },
    }),
  );
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
      cwd: dir,
      env: { ...env, CONTENT_REPO: path.join(dir, "missing") },
    }),
  );
  assert.equal(
    await readFile(path.join(dir, "src/content/sentinel"), "utf8"),
    "keep",
  );
});
test("replacement removes stale optional roots and destination symlinks are rejected", async () => {
  const first = await fixture();
  await mkdir(path.join(first.dir, "public/images"), { recursive: true });
  await writeFile(path.join(first.dir, "public/images/private"), "stale");
  await run(
    "bash",
    [path.join(first.dir, "scripts/fetch-content.sh"), "--replace"],
    { cwd: first.dir, env: first.env },
  );
  await assert.rejects(readFile(path.join(first.dir, "public/images/private")));
  const second = await fixture();
  await symlink(
    path.join(second.dir, "outside"),
    path.join(second.dir, "media"),
  );
  await assert.rejects(
    run(
      "bash",
      [path.join(second.dir, "scripts/fetch-content.sh"), "--replace"],
      { cwd: second.dir, env: second.env },
    ),
  );
});
test("source symlink and malformed header preserve destination", async () => {
  const { dir, repo, env } = await fixture();
  await mkdir(path.join(dir, "src/content"), { recursive: true });
  await writeFile(path.join(dir, "src/content/sentinel"), "keep");
  await symlink(path.join(repo, "outside"), path.join(repo, "media/escape"));
  await run("git", ["-C", repo, "add", "."]);
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "bad link",
  ]);
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
      cwd: dir,
      env,
    }),
  );
  await rm(path.join(repo, "media/escape"));
  await writeFile(path.join(repo, "src/content/settings/header.json"), "[]");
  await run("git", ["-C", repo, "add", "."]);
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "bad header",
  ]);
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
      cwd: dir,
      env,
    }),
  );
  assert.equal(
    await readFile(path.join(dir, "src/content/sentinel"), "utf8"),
    "keep",
  );
});

test("unsupported schema version preserves destination", async () => {
  const { dir, repo, env } = await fixture();
  await mkdir(path.join(dir, "src/content"), { recursive: true });
  await writeFile(path.join(dir, "src/content/sentinel"), "keep");
  await writeFile(
    path.join(repo, "src/content/settings/schema.json"),
    '{"schemaVersion":2}\n',
  );
  await run("git", ["-C", repo, "add", "."]);
  await run("git", [
    "-C", repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-qm",
    "bad version",
  ]);
  await assert.rejects(
    run("bash", [path.join(dir, "scripts/fetch-content.sh"), "--replace"], {
      cwd: dir,
      env,
    }),
  );
  assert.equal(
    await readFile(path.join(dir, "src/content/sentinel"), "utf8"),
    "keep",
  );
});

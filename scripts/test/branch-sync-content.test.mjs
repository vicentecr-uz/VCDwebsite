import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { updateWithDrafts } from "../branch-sync-drafts.mjs";
import {
  branchUpdateState,
  requestBranchUpdate,
} from "../dev-branch-update.mjs";

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status) throw new Error(r.stderr || r.stdout);
  return r.stdout.trim();
};
const contentPaths = [
  "src/content",
  "media",
  "public/images",
  "public/videos",
  "sitemap",
  "ops",
  "scripts/vps-agent.py",
  "scripts/test/vps-agent.test.py",
];

function fixture() {
  const container = mkdtempSync(path.join(tmpdir(), "vcd-dual-sync-"));
  const engineOrigin = path.join(container, "engine-origin.git");
  const contentOrigin = path.join(container, "content-origin.git");
  const seedEngine = path.join(container, "seed-engine");
  const seedContent = path.join(container, "seed-content");
  const work = path.join(container, "work");
  const peerEngine = path.join(container, "peer-engine");
  const peerContent = path.join(container, "peer-content");
  git(container, "init", "--bare", "--initial-branch=main", engineOrigin);
  git(container, "init", "--bare", "--initial-branch=main", contentOrigin);
  mkdirSync(seedEngine);
  git(seedEngine, "init", "-b", "main");
  configure(seedEngine);
  writeFileSync(
    path.join(seedEngine, ".gitignore"),
    [".content.git", ".dev-session", ...contentPaths].join("\n") + "\n",
  );
  writeFileSync(path.join(seedEngine, "README.md"), "engine initial\n");
  git(seedEngine, "add", ".");
  git(seedEngine, "commit", "-qm", "engine initial");
  git(seedEngine, "remote", "add", "origin", engineOrigin);
  git(seedEngine, "push", "-qu", "origin", "main");
  mkdirSync(seedContent);
  git(seedContent, "init", "-b", "main");
  configure(seedContent);
  mkdirSync(path.join(seedContent, "src/content"), { recursive: true });
  writeFileSync(
    path.join(seedContent, "src/content/project.json"),
    '{"v":1}\n',
  );
  git(seedContent, "add", ".");
  git(seedContent, "commit", "-qm", "content initial");
  git(seedContent, "remote", "add", "origin", contentOrigin);
  git(seedContent, "push", "-qu", "origin", "main");
  git(container, "clone", "-q", engineOrigin, work);
  git(container, "clone", "-q", engineOrigin, peerEngine);
  git(container, "clone", "-q", contentOrigin, peerContent);
  configure(work);
  configure(peerEngine);
  configure(peerContent);
  git(work, "clone", "--bare", "-q", contentOrigin, ".content.git");
  git(work, "--git-dir=.content.git", "config", "core.bare", "false");
  git(work, "--git-dir=.content.git", "config", "core.worktree", work);
  git(
    work,
    "--git-dir=.content.git",
    "config",
    "status.showUntrackedFiles",
    "no",
  );
  git(
    work,
    "--git-dir=.content.git",
    "config",
    "user.email",
    "test@example.com",
  );
  git(work, "--git-dir=.content.git", "config", "user.name", "Dual Sync Test");
  git(
    work,
    "--git-dir=.content.git",
    "config",
    "remote.origin.fetch",
    "+refs/heads/*:refs/remotes/origin/*",
  );
  git(work, "--git-dir=.content.git", "fetch", "-q", "origin", "main");
  git(
    work,
    "--git-dir=.content.git",
    "--work-tree=.",
    "reset",
    "--hard",
    "main",
  );
  return {
    container,
    work,
    peerEngine,
    peerContent,
    close: () => rmSync(container, { recursive: true, force: true }),
  };
}
function configure(cwd) {
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Dual Sync Test");
}
function cg(f, ...args) {
  return git(f.work, "--git-dir=.content.git", "--work-tree=.", ...args);
}
function incoming(f, repo, file, value, message) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), value);
  git(repo, "add", file);
  git(repo, "commit", "-qm", message);
  git(repo, "push", "-q");
}

{
  const f = fixture();
  try {
    writeFileSync(path.join(f.work, "README.md"), "engine staged\n");
    git(f.work, "add", "README.md");
    writeFileSync(path.join(f.work, "README.md"), "engine dirty\n");
    writeFileSync(
      path.join(f.work, "src/content/local ignored.bin"),
      Buffer.from([0, 1, 2, 255]),
    );
    writeFileSync(
      path.join(f.work, "src/content/local.json"),
      '{"local":true}\n',
    );
    incoming(
      f,
      f.peerEngine,
      "engine-incoming.txt",
      "incoming\n",
      "engine incoming",
    );
    incoming(
      f,
      f.peerContent,
      "src/content/remote.json",
      '{"remote":true}\n',
      "content incoming",
    );
    git(f.work, "fetch", "-q", "origin", "main");
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    updateWithDrafts(f.work, "origin/main");
    assert.equal(
      git(f.work, "rev-parse", "HEAD"),
      git(f.work, "rev-parse", "origin/main"),
    );
    assert.equal(cg(f, "rev-parse", "HEAD"), cg(f, "rev-parse", "origin/main"));
    assert.equal(
      readFileSync(path.join(f.work, "README.md"), "utf8"),
      "engine dirty\n",
    );
    assert.deepEqual(
      [...readFileSync(path.join(f.work, "src/content/local ignored.bin"))],
      [0, 1, 2, 255],
    );
    console.log("PASS: both repositories advance and preserve drafts");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    writeFileSync(
      path.join(f.work, "src/content/staged-delete.json"),
      '{"delete":true}\n',
    );
    cg(f, "add", "-f", "src/content/staged-delete.json");
    cg(f, "commit", "-qm", "local content file");
    cg(f, "rm", "src/content/staged-delete.json");
    incoming(
      f,
      f.peerContent,
      "src/content/remote.json",
      "{}\n",
      "remote content",
    );
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    const before = cg(f, "status", "--porcelain");
    updateWithDrafts(f.work, "origin/main");
    assert.match(cg(f, "status", "--porcelain"), /staged-delete/);
    assert.equal(before.includes("staged-delete"), true);
    console.log("PASS: staged content deletion survives update");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    writeFileSync(path.join(f.work, "README.md"), "user draft\n");
    git(f.work, "stash", "push", "-qm", "user stash");
    const before = git(f.work, "stash", "list");
    incoming(f, f.peerEngine, "engine-incoming.txt", "{}\n", "remote engine");
    git(f.work, "fetch", "-q", "origin", "main");
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    updateWithDrafts(f.work, "origin/main");
    assert.match(git(f.work, "stash", "list"), /user stash/);
    assert.match(
      git(f.work, "stash", "list"),
      new RegExp(before.split(":")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    console.log("PASS: unrelated stash remains untouched");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    mkdirSync(path.join(f.peerEngine, "src/content"), { recursive: true });
    writeFileSync(path.join(f.peerEngine, "src/content/private.json"), "{}\n");
    git(f.peerEngine, "add", "-f", "src/content/private.json");
    git(f.peerEngine, "commit", "-qm", "private overlap");
    git(f.peerEngine, "push", "-q");
    git(f.work, "fetch", "-q", "origin", "main");
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    assert.throws(
      () => updateWithDrafts(f.work, "origin/main"),
      /overlap|content paths/i,
    );
    console.log("PASS: incoming engine private content path is rejected");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    git(f.work, "--git-dir=.content.git", "switch", "-c", "feature");
    incoming(f, f.peerContent, "src/content/remote.json", "{}\n", "remote");
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    assert.throws(
      () => updateWithDrafts(f.work, "origin/main"),
      /content checkout must be on main/i,
    );
    console.log("PASS: non-main content branch is rejected");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    const engineHead = git(f.work, "rev-parse", "HEAD");
    const contentHead = cg(f, "rev-parse", "HEAD");
    writeFileSync(
      path.join(f.work, "src/content/project.json"),
      '{"local":true}\n',
    );
    incoming(
      f,
      f.peerEngine,
      "engine-incoming.txt",
      "incoming\n",
      "engine incoming",
    );
    incoming(
      f,
      f.peerContent,
      "src/content/project.json",
      '{"remote":true}\n',
      "content conflict",
    );
    git(f.work, "fetch", "-q", "origin", "main");
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    assert.throws(
      () => updateWithDrafts(f.work, "origin/main"),
      /conflicted|recovery/i,
    );
    assert.equal(git(f.work, "rev-parse", "HEAD"), engineHead);
    assert.equal(cg(f, "rev-parse", "HEAD"), contentHead);
    console.log("PASS: content conflict rolls both repositories back");
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    incoming(
      f,
      f.peerContent,
      "src/content/remote.json",
      '{"remote":true}\n',
      "content only",
    );
    cg(f, "fetch", "-q", "origin", "main:refs/remotes/origin/main");
    const state = await branchUpdateState(f.work);
    assert.equal(state.contentBehind, 1);
    assert.equal(state.available, true);
    const request = await requestBranchUpdate(f.work);
    assert.ok(request.requestId);
    console.log("PASS: content-only update is available and requestable");
  } finally {
    f.close();
  }
}

for (const conflict of ["content-commit", "content-draft", "engine-commit"]) {
  const f = fixture();
  try {
    if (conflict === "content-commit") {
      writeFileSync(
        path.join(f.work, "src/content/project.json"),
        '{"localCommit":true}\n',
      );
      cg(f, "add", "-f", "src/content/project.json");
      cg(f, "commit", "-qm", "local content commit");
    }
    if (conflict === "engine-commit") {
      writeFileSync(path.join(f.work, "README.md"), "local commit\n");
      git(f.work, "add", "README.md");
      git(f.work, "commit", "-qm", "local engine commit");
    }
    writeFileSync(path.join(f.work, "README.md"), "engine staged\n");
    git(f.work, "add", "README.md");
    writeFileSync(path.join(f.work, "README.md"), "engine unstaged\n");
    writeFileSync(
      path.join(f.work, "new engine.bin"),
      Buffer.from([1, 0, 255]),
    );
    writeFileSync(
      path.join(f.work, "src/content/draft.json"),
      '{"staged":true}\n',
    );
    cg(f, "add", "-f", "src/content/draft.json");
    writeFileSync(
      path.join(f.work, "src/content/draft.json"),
      '{"unstaged":true}\n',
    );
    writeFileSync(
      path.join(f.work, "src/content/new ñ.bin"),
      Buffer.from([0, 255, 2]),
    );
    if (conflict === "content-draft")
      writeFileSync(
        path.join(f.work, "src/content/project.json"),
        '{"draft":true}\n',
      );
    incoming(
      f,
      f.peerEngine,
      conflict === "engine-commit" ? "README.md" : "new-engine.txt",
      "remote engine\n",
      "engine incoming",
    );
    incoming(
      f,
      f.peerContent,
      "src/content/project.json",
      '{"remote":true}\n',
      "content incoming",
    );
    git(f.work, "fetch", "-q", "origin", "main");
    cg(f, "fetch", "-q", "origin", "main");
    const before = capture(f);
    assert.throws(
      () => updateWithDrafts(f.work, "origin/main"),
      /conflicted and was cancelled/,
    );
    assert.deepEqual(capture(f), before);
    assert.equal(git(f.work, "stash", "list"), "");
    assert.equal(cg(f, "stash", "list"), "");
    console.log(
      `PASS: ${conflict} restores both heads, indexes and new binary drafts`,
    );
  } finally {
    f.close();
  }
}

function capture(f) {
  return {
    engineHead: git(f.work, "rev-parse", "HEAD"),
    contentHead: cg(f, "rev-parse", "HEAD"),
    engineIndex: git(f.work, "write-tree"),
    contentIndex: cg(f, "write-tree"),
    engineDiff: git(f.work, "diff", "--binary"),
    contentDiff: cg(f, "diff", "--binary"),
    engineNew: readFileSync(path.join(f.work, "new engine.bin")),
    contentNew: readFileSync(path.join(f.work, "src/content/new ñ.bin")),
  };
}

{
  const f = fixture();
  try {
    const operation = path.join(f.work, ".content.git/MERGE_HEAD");
    writeFileSync(operation, cg(f, "rev-parse", "HEAD"));
    incoming(f, f.peerEngine, "new.txt", "remote\n", "incoming");
    git(f.work, "fetch", "-q", "origin", "main");
    assert.equal((await branchUpdateState(f.work)).available, false);
    await assert.rejects(
      () => requestBranchUpdate(f.work),
      /current Git operation/,
    );
    assert.throws(
      () => updateWithDrafts(f.work, "origin/main"),
      /existing Git operation/,
    );
    assert.equal(
      existsSync(path.join(f.work, ".dev-session/branch-sync.request")),
      false,
    );
    console.log(
      "PASS: a content Git operation blocks both update entry points",
    );
  } finally {
    f.close();
  }
}

for (const fetchFailure of [false, true]) {
  const f = fixture();
  try {
    const scripts = path.join(f.work, "scripts");
    mkdirSync(scripts);
    for (const file of [
      "branch-sync.sh",
      "branch-sync-drafts.mjs",
      "content-repository.mjs",
    ]) {
      copyFileSync(
        path.resolve(import.meta.dirname, "..", file),
        path.join(scripts, file),
      );
    }
    writeFileSync(path.join(f.work, ".git/info/exclude"), "scripts/\n");
    const session = path.join(scripts, "test-session.sh");
    writeFileSync(session, "#!/bin/sh\nexit 1\n");
    chmodSync(session, 0o755);
    const engineHead = git(f.work, "rev-parse", "HEAD");
    const contentHead = cg(f, "rev-parse", "HEAD");
    incoming(
      f,
      f.peerContent,
      "src/content/shell.json",
      '{"shell":true}\n',
      "content only",
    );
    if (fetchFailure) {
      incoming(
        f,
        f.peerEngine,
        "engine-remote.txt",
        "remote\n",
        "engine update",
      );
      cg(
        f,
        "remote",
        "set-url",
        "origin",
        path.join(f.container, "missing.git"),
      );
    }
    const result = spawnSync(
      "bash",
      [path.join(scripts, "branch-sync.sh"), "once"],
      {
        cwd: f.work,
        encoding: "utf8",
        env: {
          ...process.env,
          BRANCH_SYNC_BUN: process.execPath,
          BRANCH_SYNC_SESSION_SCRIPT: session,
        },
      },
    );
    assert.equal(
      result.status,
      fetchFailure ? 1 : 0,
      result.stdout + result.stderr,
    );
    assert.equal(git(f.work, "rev-parse", "HEAD"), engineHead);
    if (fetchFailure) assert.equal(cg(f, "rev-parse", "HEAD"), contentHead);
    else
      assert.equal(
        readFileSync(path.join(f.work, "src/content/shell.json"), "utf8"),
        '{"shell":true}\n',
      );
    console.log(
      `PASS: shell ${fetchFailure ? "content fetch failure changes neither checkout" : "content-only fetch and update"}`,
    );
  } finally {
    f.close();
  }
}

{
  const f = fixture();
  try {
    writeFileSync(path.join(f.work, "README.md"), "engine draft\n");
    writeFileSync(path.join(f.work, "new engine.bin"), Buffer.from([1, 2, 3]));
    writeFileSync(
      path.join(f.work, "src/content/project.json"),
      '{"draft":true}\n',
    );
    writeFileSync(
      path.join(f.work, "src/content/new ñ.bin"),
      Buffer.from([4, 5, 6]),
    );
    const before = capture(f);
    const lock = path.join(f.work, ".content.git/index.lock");
    writeFileSync(lock, "");
    assert.throws(() => updateWithDrafts(f.work, "origin/main"), /cancelled/);
    rmSync(lock);
    assert.deepEqual(capture(f), before);
    assert.equal(git(f.work, "stash", "list"), "");
    console.log(
      "PASS: failed second backup restores the first without resetting unbacked drafts",
    );
  } finally {
    f.close();
  }
}

# QA rotation workflow

A named session rhythm for live QA of a feature branch. Anto tests panels one by one
in the running site; the agent he is talking to is the **manager**; fixes go to
**worker** subagents so QA never blocks on a fix. First run: `feat/figma-dev-chrome`
dev-chrome QA pass, 2026-08-25.

**Trigger:** Anto says "let's work with the QA rotation workflow" (or just "rotation").
If you are the agent he is talking to, you are the manager. Do not ask who manages.

## The loop

1. **Anto QAs top to bottom** through an agreed queue. He reports "pass" (or "lgtm")
   or describes what's wrong — a screenshot helps.
2. **Pass → mark done in the plan, name what's next.** The chat must always answer
   "what am I testing now, and what's after it."
3. **Fail → dispatch a worker immediately, with a written spec, while Anto moves on
   to the next item.** If a second fail arrives before the first worker lands,
   dispatch a second worker. Workers run in parallel; the manager never types a
   fix inline while Anto is waiting.
4. **Worker lands → manager reviews the diff, pushes, and recaps.** The recap is
   what Anto reads: what to hard-refresh, what to try step by step, the commit
   hash, and what the commit *didn't* touch. Anto signs off or sends more
   feedback (same item, new worker).
5. **New asks are queued, not interruptions.** Bigger-than-a-fix requests join the
   plan as their own item; the current item keeps moving.

## The plan is the manager's memory

The rotation survives context loss because state lives outside the chat:

- **A `.cursor/plans/*.plan.md`** with one todo per QA item (`completed` /
  `in_progress` / `pending`), updated **every time** status changes — the sidebar
  Anto sees is the ground truth, not the manager's recall. Include signed-off
  hashes and known leftovers in the todo content so a summary rebuilds the queue.
- **A tracking GitHub issue** for the detailed log; v2/polish finds get filed as
  their own issues the moment they're identified, not remembered.
- **Commit hashes in every recap.** If the manager is summarised and restarted,
  `git log` + the plan + the issue reconstruct the session without asking Anto.

Manager rule: if you notice you've told Anto something that isn't reflected in
the plan, update the plan **before** replying.

## Manager / worker rules specific to rotation

- Follow `CLAUDE.md` → **Manager / worker split** for model choice
  (Cursor: Composer 2.5 Fast), spec shape, and diff review. The rotation adds:
- **Specs are self-contained.** The worker has no QA context — include the exact
  files it owns, the expected behaviour, the likely root cause, what not to
  touch, and the test script Anto will run.
- **Split work by file, not by feature.** Two workers editing one file collide.
  If two QA fails share a file, one worker takes both.
- **Workers commit; the manager pushes.** Worker: `bun run build`, then
  `bun run commit:engine "<msg>" <explicit paths>`, no push. Manager: review the
  diff, then push. If the manager spots a defect in review, the manager's fix is
  a small edit — do it inline and commit, don't respawn for a one-liner.
- **Figma-first stays in force during rotation.** Source-of-truth questions
  (geometry, variants, tokens) are answered from the file before a worker spec
  is written; Figma edits Anto asks for are done between dispatches, not
  deferred to "later".
- **One dev server.** Workers never start or restart it. If a fix touches dev
  middleware, the recap must say "restart 4321" explicitly.
- **After any commit lands, Anto hard-refreshes before judging it.** Say so in
  every recap.

## What lands where

- Feature fixes → the feature branch being QA'd, pushed as they land.
- Docs/standards (like this file) → their own branch straight to `main`, never
  bundled into the feature PR. Use a worktree so the QA checkout stays put.
- Out-of-scope polish → a GitHub issue (v2 milestone if it applies), linked in
  the recap.

## Why it works

Anto always knows what's next (plan sidebar + recap), a fail never stalls the
pass (worker takes it while he moves on), and nothing depends on the manager
remembering — the plan, the issue, and the commit hashes are the session.

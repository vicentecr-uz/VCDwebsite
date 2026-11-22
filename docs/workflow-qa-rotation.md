# QA rotation workflow

Canonical process: the **`qa-rotation` skill**. That is what agents load.

| Agent | Path |
| --- | --- |
| Claude Code | `~/.claude/skills/qa-rotation/SKILL.md` |
| Codex, Cursor | `~/.agents/skills/qa-rotation/SKILL.md` |

Both paths are symlinks to the owner's single private source; edit that source, never a harness copy.

**Trigger:** "let's work with the QA rotation workflow" (or just "rotation"). The agent being talked to is the manager. Do not ask who manages.

This file is a pointer, not a second copy of the loop. If the skill is missing, ask the owner to restore the link before starting — do not reconstruct the workflow from memory.

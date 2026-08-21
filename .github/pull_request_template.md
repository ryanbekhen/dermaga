<!--
  The title becomes the commit subject when this is squashed, and the release
  notes are grouped by its prefix: feat, fix, perf or docs get a section of
  their own; ci, build, test and chore land under Maintenance. Pick the one a
  reader deciding whether to update would expect.
-->

## Summary

<!-- What this changes, in a sentence or two. -->

## Why

<!--
  The half that is hard to recover a year from now -- the code already says
  what it does, never why it had to. What was wrong, or what became possible.

  Link the issue if there is one: Fixes #123.
-->

## How it was checked

<!--
  `make check` is the floor, not the answer: it proves the code compiles and
  the tests still pass, not that the thing you fixed is fixed.

  Say what you actually ran and what it did. Much of Dermaga only fails on a
  real machine -- a CLI that hangs without a pty, a window that traps on the
  wrong thread, a script blocked by the production CSP -- and none of that is
  caught by reading or by a unit test.
-->

## Screenshots

<!-- Anything visible: before and after. Remove this section if nothing is. -->

---

- [ ] `make check` passes
- [ ] The title carries a conventional prefix
- [ ] User-facing? `CHANGELOG.md` has an entry — the app's **What's new** page is built from it
- [ ] Anything left unverified is named above, rather than left to be discovered

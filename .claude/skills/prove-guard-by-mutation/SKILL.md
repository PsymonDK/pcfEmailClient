---
name: prove-guard-by-mutation
description: Prove that a new or changed test, guard or invariant in this repo can actually fail - break the source, watch the test fail for the right reason, restore. Use after writing or changing any test under pcf/CaseEmailClient/**/__tests__, any rule in domain/, and whenever CLAUDE.md or a review says "prove it by mutation".
---

# Proving a guard by mutation

A guard that cannot fail is decoration. Here the mutation step catches tests that pass while proving nothing — most often because a **fake is more generous than the platform**, a **regex matches nothing (or everything)**, or a **rule in `domain/` is never given its input by the caller** (`blockingReasonBeforeSend` and `inReplyToId` were both tested and both inert: the shell never passed the argument). A unit test cannot see that last seam; a mutation of the *caller* can.

## Steps

1. **Copy the source aside first.** `cp <file> "<scratchpad>/<name>.bak"`. **Never** restore with `git checkout -- <file>` or `git restore`: they go to HEAD, not to your uncommitted work, and destroy edits.
2. **Break exactly the thing the test claims to guard** — delete the line, flip the constant, drop the argument at the call site, reorder the `await`. One mutation at a time. For an "inert guard" suspicion, mutate the **caller** (stop passing the input), not the rule.
3. **Run only the narrow test**, from `pcf/`:

   ```bash
   npm test -- CaseEmailClient/domain/__tests__/<file>.test.ts
   ```

   Never `npx vitest`: it resolves a cached global copy with no jsdom and silently skips the file. A failing `expect` on a DOM node can print the whole document — compare booleans (`x === null`), not nodes.
4. **Watch it fail for the right reason** — read the assertion message, not just the exit code. A different failure (a typo you introduced, a type error) proves nothing.
5. **Restore from the copy** (`cp` back), run the test again and watch it **pass**. Diff the file against the copy to be sure nothing else changed.
6. Say in the commit or PR what was mutated and that it failed.

## If the mutation does not fail

- **The fake may be too generous.** `fakeRichText`, the `fakeApi` in the shell smoke test and any metadata fake should model what the platform does, including refusing. Tighten the fake; the existing tests then become the guard. (The environment has exactly one `emailsignature` row, so a signature test passes whichever code path ran — create a second signature before believing one.)
- **The regex quietly matches nothing or everything** (an unanchored token matching inside a longer one; a whole-file `toContain` finding a string in the wrong scope). Test each scope separately, and test the regex against a string that must NOT match.
- **The line under it may be dead.** Delete it and re-point the test at the design it actually protects.
- **jsdom has no layout and no focus model.** A claim about size, position or focus cannot be proved here; say so rather than writing a test that always passes, and prove it in the published app.
- **A passing live check is not a guard.** One real environment reading proves one reading; the test is what keeps it true.

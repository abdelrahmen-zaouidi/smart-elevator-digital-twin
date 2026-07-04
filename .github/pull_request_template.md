## What & why

<!-- One or two sentences: what changes, and the problem it solves. -->

## Validation

- [ ] `npm run validate` passes locally (node suites, n8n package, python
      suites, typecheck, lint — 0 errors, no new warnings)
- [ ] Runtime surface exercised (command output / screenshot below), or this
      change has no runtime surface
- [ ] Claims labeled per evidence level: software-validated / documented
      integration / outside scope

## Invariants check

- [ ] Ditto stays the single source of truth (no dashboard↔MQTT reads)
- [ ] No path bypasses or weakens the command safety gate
- [ ] AI/LLM remains advisory-only (no actuation authority)
- [ ] No secrets committed; local-first preserved (no required cloud calls)
- [ ] MQTT topic/thing-id contracts unchanged (or contracts docs updated)

## Docs

- [ ] CHANGELOG `[Unreleased]` updated (user-visible changes)
- [ ] Affected docs updated (`docs/README.md` index still accurate)

<!-- Evidence (paste command output / screenshots): -->

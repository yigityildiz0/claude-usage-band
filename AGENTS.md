# AGENTS.md

Guidance for agents (and people) contributing to Kota Bandı, a Claude Code mod that draws a
usage-quota band above the prompt box. User-facing description: [README.md](README.md).

## Layout

| Path | Role |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest (name `kota-bandi`) |
| `.claude-plugin/marketplace.json` | Marketplace entry, so the repo installs with `/plugin install` |
| `hooks/hooks.json` | Names the one hooks module, `./register.tsx` |
| `hooks/register.tsx` | The mod: the `AbovePrompt` band (terminal, desktop and mobile surfaces), the `/kota` command, polling, notifications, auto-compact runner |
| `hooks/tahmin.ts` | Forecast and text helpers: pure functions of a reading, the time and the learned pace |
| `hooks/esik.ts` | Auto-compact default threshold and the one-time pass that moves old defaults |
| `hooks/kalici.ts` | Persistence between chats and restarts, with a fallback to small files when the engine store is broken |
| `hooks/cetvel.ts` | Client of the optional Burette service (loopback HTTP). The file keeps its earlier name, as does the `Cetvel` directory it reads the connection from |
| `hooks/shared.ts` | Shared auto-compact file protocol (see rules below) |
| `types/index.d.ts` | State types the band and its helpers share |
| `tests/band.test.tsx` | All tests (one file, run through the engine's test harness) |

## Run the tests

```
claude plugin validate .
claude plugin test .
```

Run both from the repository root. Both must pass before a change is done.

## Rules

- **User-visible text is Turkish.** Keep every label, notification and command argument in
  Turkish, with Turkish percent style (`%60`) and the g/sa/dk duration units. Code, comments
  and docs are English, except `docs/tasarim.md`, the design notes, which are in Turkish.
- **Do not edit `hooks/shared.ts` on its own.** It defines the auto-compact file format
  (`<chat>.json` and `<mod>.alive` under `claude-auto-compact`) that other mods share, and it
  is kept identical across them. A format change needs a matching change in every mod that
  uses it.
- **Never hardcode user-specific data.** No personal names, e-mail addresses, machine names,
  absolute user paths or keys in code, tests, data or docs. Use `~` or a placeholder in
  example paths. Tests use fake paths such as `C:/ev/.claude`.
- **Keep secrets out of output.** The Burette token stays in memory: never log, draw or store
  it. The mod never sees the session credential.
- **Layout must not overflow or clip** at any width from 20 columns up. When you change the
  layout, extend the width tests; see [docs/tasarim.md](docs/tasarim.md) for the breakpoints.
- **Do not show subscription plan names** anywhere in the band.
- **Do not touch the original usage-quota mod's settings.** The band only reads them once on
  first install.
- Keep the README (English) and README.tr.md (Turkish) in step, and do not document features
  that do not exist.
- Add or update a test with every behaviour change; do not delete a test to make it pass.

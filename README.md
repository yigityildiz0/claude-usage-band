# Kota Bandı (claude-usage-band)

English | [Türkçe](README.tr.md)

A usage-quota band that sits right above the prompt box in Claude Code. It shows your
5-hour and weekly limits, when you will run out at the current pace, how full the context
window is, and compacts the conversation for you before it overflows. It is for anyone who
hits Claude Code limits or a full context window in the middle of work.

**The interface text is Turkish** (labels, notifications, `/kota` arguments). Only this
README and the code comments are in English.

This is a fork of Anant Raghunath's
[usage-quota](https://github.com/anantraghunath/claude-code-usage-quota-mod) mod
(MIT, version 0.1.6). The original license is kept in `LICENSE`.

## Install

```
/plugin install kota-bandi --marketplace yigityildiz0/claude-usage-band
```

This one-step install line works on Claude Code 2.1.275 or later. If your version does not
recognise it, add the marketplace first and install from it:

```
/plugin marketplace add yigityildiz0/claude-usage-band
/plugin install kota-bandi@claude-usage-band
```

Afterwards, run `/reload-plugins` in open chats.

## What it shows

- **5 Saat (5-hour) and Haftalık (weekly) limits:** share used, time to reset, and a grey
  tick on the bar for "at this pace, at most X% by the reset". If a limit will fill before
  its reset, the band says when ("bugün 14:20 (2sa 3dk sonra)").
- **Etkin kalan (effective time left):** the two windows are read together. The one that
  binds first (full, filling first, or with the least left) is named and underlined. If both
  are full, it gives the time use opens up again.
- **Early-exhaustion warning:** one notification per window period, shared by all chats, when
  a window is on course to fill at least 15 minutes before its reset and there is enough data
  to say so. Early in a window the forecast is marked "(tahmini)".
- **Context:** fill percentage, split into Messages, Tools and Other.
- **Compact button and auto-compact:** a **Sıkıştır** button, plus per-chat automatic
  compaction. It is on by default at 75%; the threshold moves in 5-point steps (15% to 95%)
  with the `−` and `+` buttons.

## Three views

The view is shared by all chats and remembered.

| View | What stays | How |
|---|---|---|
| **Detaylı** (detailed) | Everything: header, both windows, context breakdown, other-platform table | `▲` or `/kota detaylı` |
| **Kısa** (short) | Header, controls and the three bars on one row (stacked if they do not fit) | `▼` or `/kota kısa` |
| **Gizli** (hidden) | A small square button on the right; its dot shows the state of the tightest limit (or the context). Hover for a one-line summary. Press it to return to the last open view | `Gizle` or `/kota gizli` |

`/kota` alone turns the band on or off (persistent); auto-compact keeps running while it is
off. When the window is too short for the detailed view, the band draws the short view
without changing your setting.

The band lays out without overflow at any width of 20 columns or more: two blocks side by
side on wide screens, stacked on narrow ones, with the percentages and the threshold always
fully visible. See [docs/tasarim.md](docs/tasarim.md) (in Turkish) for the breakpoints.

Colours: text uses the theme's own colours; the bars and dots are mid tones with at least 3:1
contrast on both dark and light backgrounds. The subscription plan name is never shown.

## Optional: other platforms through Burette

[Burette](https://github.com/yigityildiz0/burette) is a local usage service (a Rust daemon,
Windows) that tracks the quotas of other AI
tools. If it is running, the band talks to it; if not, nothing is shown and the band works on
its own.

| What | How |
|---|---|
| Connection | Reads only `port` and the token from `%LOCALAPPDATA%\Cetvel\baglanti.json` (the directory keeps the service's earlier name). The address is always `http://127.0.0.1:<port>`. The token stays in memory and is never logged, drawn or stored. On a 401 the file is re-read once. |
| Claude figures | The Claude limits the band already reads are sent to the service. |
| One asker | Before the 2-minute plan query, the band asks the service for a lease. If another chat holds it, this chat does not ask and reads that chat's result from the service instead. |
| Other platforms | Polled every 10 seconds (ETag/304). The detailed view lists each connected pool with the share **left** in its windows, plus reset times and model names on hover. Plan names are never shown. Narrow bands drop to two-row cards; on the one-line summary the tightest pools stay and the rest become `+N`. |
| Forecast | The service's EWMA pace is used when its reset matches the band's window. For the weekly window only a verified (`hazir`) forecast counts; experimental ones are ignored because a short burst would be spread over the whole week. Otherwise the band's own damped pace is used. |
| Service goes quiet | Exponential back-off (5 to 60 s); the line greys out and reads "(Cetvel yanıt vermiyor)", then disappears after 10 minutes. |

Why HTTP: the mod engine's `$.http.fetch` can reach the loopback address; `$.process` exists
only in the CLI and would spawn a process every few seconds; reading the snapshot file alone
could neither post the figures nor take the lease.

## Privacy

- The band makes **no model calls** and has no telemetry.
- Network: one query to `api.anthropic.com/api/oauth/usage` (the same data the app's own
  "Plan usage limits" panel reads), through the session's own credential, which the mod never
  sees. At most once every 2 minutes across all chats. If Burette runs, requests also go to
  `127.0.0.1`, and only there.
- Files written: the mod's settings store under `~/.claude/plugins/store/`, a fallback folder
  `~/.claude/plugins/data/kota-bandi/` and the shared auto-compact folder described below.
  Nothing is sent anywhere else.

## If the original usage-quota mod is also on

Both together mean two bands, two auto-compact runners and double queries to the usage
service. At startup and once a minute the band checks, and shows a one-line warning
("İki kota bandı açık: ...") when the original is enabled, or disabled but still loaded in an
open chat. To remove it for good:

```
claude plugin uninstall usage-quota@claude-code-usage-quota-mod
```

then `/reload-plugins` in open chats (setting it to `false` does not unload it from a running
chat). Kota Bandı never enables or disables the original and never writes to its settings; on
first install it reads the original's auto-compact settings and learned pace once and copies
them.

## If the settings store is corrupted

The engine's settings store (`~/.claude/plugins/store/kota-bandi_*.json`) was once filled with
NUL bytes during a write: reads came back empty and writes failed. At startup the band tests
the store (write, read back). If it is broken, the band shows one notification, keeps each key
in a small file of its own under `~/.claude/plugins/data/kota-bandi/depo/`, retries every 5
minutes, and moves the values back when the store recovers. To repair by hand: back up and
delete the store file, then run `/reload-plugins`; the engine recreates it.

## Differences from the original

- All text is Turkish; percentages in Turkish style (%60), durations in g/sa/dk; 99.6% is
  shown as %99, never as full.
- The threshold field showed one digit on desktop ("4" for "40"); the text box was replaced
  by a plus/minus control that is fully visible on every surface.
- Three views, the Burette integration, shared auto-compact settings and store recovery are
  new.
- The usage rate learned by the original and its per-chat settings are taken over once.
- An exact context count (about 320 requests) is taken in one chat every 2 minutes, and the
  result is shared with the others.
- After `/clear`, the new chat id continues with the old chat's auto-compact setting.

## Sharing auto-compact with another mod

If two mods offer auto-compact, there should be one setting and one runner. Kota Bandı uses
the convention below, so another mod can follow it:

| Rule | How |
|---|---|
| Shared setting | One file per chat: `~/.claude/plugins/data/claude-auto-compact/<chat>.json` (`isOn`, `at`, `t`). Changing it in either mod reaches the other within about 3 seconds. |
| One runner | Kota Bandı writes `kota-bandi.alive` every 5 s (also in the hidden view). Another mod should not compact while that file is less than 20 s old. |
| Alone | Whichever mod is installed alone does the compaction. |
| Claude Code's built-in compaction | It is independent of mods. If `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` is lower than the mod's threshold (for example 60), the app compacts first. Keep it above the highest mod threshold (95%), such as 97, or leave it unset. |
| Default | On, 75%, in a new chat. Older versions' 40% and 80% defaults are moved to 75% once; a threshold that was set by hand is never touched. |

Two writers never edit the same file: each mod writes only its own `.alive` file.

## Uninstall

```
claude plugin uninstall kota-bandi@claude-usage-band
```

then `/reload-plugins` in open chats. The small files the band wrote (see Privacy) can be
deleted by hand: `~/.claude/plugins/data/kota-bandi/`. Leave
`~/.claude/plugins/data/claude-auto-compact/` alone if another mod still shares it.

## Troubleshooting

| Symptom | What to check |
|---|---|
| No band after install | Run `/reload-plugins` in the open chat. Check that Claude Code is 2.1.275 or later for the one-line install. |
| The band vanished | `/kota` alone toggles it, so you may have switched it off: run `/kota` again. In the hidden view only a small square button stays at the right edge. |
| Two bands, or a warning that two are on | The original usage-quota mod is also loaded; see "If the original usage-quota mod is also on". |
| Settings are not remembered | See "If the settings store is corrupted". |
| No other-platform table | Burette is optional and must be running; without it nothing is shown. |

## Development

See [AGENTS.md](AGENTS.md). Run `claude plugin validate .` and `claude plugin test .` from the
repository root.

## License

MIT. Copyright (c) 2026 Anant Raghunath and Yiğit Yıldız. See [LICENSE](LICENSE).

# osu!mania Skill Analyzer v1.0.0

osu!mania Skill Analyzer is a Windows desktop replay analyzer for osu!mania. It reads an `.osr` replay file and the matching `.osu` beatmap file, then visualizes player mistake tendencies by lane, key, finger, timing, and beatmap characteristics.

This tool is for practice support and tendency analysis. It is not an official osu! judgement reproduction tool.

## App Overview

v1.0.0 focuses on Replay File Analysis:

- Load `.osr` replay files
- Load matching `.osu` beatmap files
- Compare OSR Miss and Analyzer Miss
- Build a Player Profile from up to 5 replays
- Show normalized skill tendencies using beatmap exposure

CSV import and real-time input logging are intentionally hidden in v1.0.0. They are planned for later versions.

## Main Features

- Single replay analysis
- Multi replay analysis, up to 5 `.osr + .osu` sets
- OSR Miss / Analyzer Miss / Difference comparison
- Lane, key, and finger error breakdown
- Tap / LN / Early / Late / Overhit breakdown
- LN start / release / hold-break estimation
- Beatmap Profile display
- Beatmap-aware normalized Player Profile
- Strengths TOP3 and challenge candidates
- Japanese / English UI switching
- Developer Tools with replay and analysis debug details

## How To Use

### Development Run

Install dependencies once:

```powershell
npm install
```

Start the Electron app:

```powershell
npm start
```

### Build Windows Portable EXE

```powershell
npm run build
```

The portable executable is generated in `dist/`.

## Loading .osr / .osu Files

1. Select a replay file in `.osr replay`.
2. Select the matching beatmap file in `.osu beatmap`.
3. Click `Analyze` / `解析する`.
4. Check OSR Miss, Analyzer Miss, Difference, and detailed error breakdowns.

The `.osr` and `.osu` files must correspond to the same play. If they do not match, the analyzer result will not be reliable.

## Single Replay Analysis

Single analysis is useful when checking one play in detail.

Main outputs:

- OSR Miss
- Analyzer Miss
- Difference
- Hit count
- Input count
- Mistake type breakdown
- Lane error breakdown
- Key error breakdown
- Finger error breakdown
- Replay playback timeline
- Practice advice

Use `Reset analysis` / `解析結果をリセット` to clear the current single analysis state.

## Multi Replay Analysis

Multi replay analysis supports up to 5 replay sets.

Each set contains:

- one `.osr` replay
- one matching `.osu` beatmap

Main outputs:

- Each replay result
- OSR Miss Total
- Analyzer Miss Total
- Difference
- Average Analyzer Miss
- Player Profile
- Beatmap Exposure
- Normalized Skill Profile
- Analyzer Miss / Error breakdown
- Strengths TOP3
- Challenge candidates

Each Replay row can be reset individually. `Reset all` clears all 5 sets and the generated Player Profile.

## Player Profile

Player Profile summarizes tendencies from multiple replay results.

Current profile metrics:

- LN aptitude
- Jack aptitude
- Left-hand aptitude
- Right-hand aptitude
- High-density tolerance
- Late stamina
- Finger error rate
- Left/right balance
- Overall profile comments

The profile uses normalized indicators that consider beatmap characteristics. For example, LN errors on LN-heavy beatmaps are treated differently from LN errors on tap-heavy beatmaps.

## Known Limitations

- Analyzer Miss is not the official osu! Miss count.
- Results may not perfectly match osu! client judgement.
- LN judgement includes estimation.
- Mod support is limited in v1.0.0.
- Replays with HT / EZ / DT / HR may produce shifted or less reliable evaluations.
- Some beatmaps may produce a large automatic offset correction.
- Beatmap feature analysis is approximate.
- Recommended maps are frozen for v1.0.0.
- CSV import and external log analysis are hidden from the normal v1.0.0 UI.
- Real-time input logging is not exposed in the normal v1.0.0 UI.

## Roadmap

- v1.0: Replay file analysis
- v1.1: 10 replay batch analysis
- v1.2: Mod-aware analysis
- v1.3: Input log / real-time mode
- v1.4: CSV / external log import

## v1.0.0 Release Info

- App name: osu!mania Skill Analyzer
- Package name: osu-mania-skill-analyzer
- Version: 1.0.0
- Platform: Windows
- Distribution format: portable `.exe`
- Release artifact: `dist/osu-mania-skill-analyzer-v1.0.0-win-x64-portable.exe`

## Developer Notes

`node_modules/`, `dist/`, `tools/`, and `work/` are intentionally ignored by Git.

For GitHub Releases, upload the generated portable exe from `dist/`. Do not commit `dist/` to the repository.

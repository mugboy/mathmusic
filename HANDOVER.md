# Math Music handover

## Where to resume

The user has returned to **planning** and wants a new tool. Its purpose, inputs, outputs, and sidebar category are still open. Start with one question: “What does the musician put in, and what should they see or hear?” Wait for the idea and permission to implement. The immediate request was to document the project for the next chat.

An earlier idea for a **Grouper** would let musicians position rendered clips on a timeline and export one mixed WAV. It is an unimplemented idea, and the user has yet to identify the new tool.

## Working copy and deployment

- Workspace: `C:\projects\code\mathmusic` on Windows, using PowerShell. GitHub: [mugboy/mathmusic](https://github.com/mugboy/mathmusic), branch `main`. Follow [AGENTS.md](AGENTS.md).
- At handover, `src/library.ts` has pre-existing uncommitted edits adding **Sixth Cadence** and **Ending Cadence**. Check `git status -sb` and `git diff -- src/library.ts` before working. The local preset list and the deployed list differ. Use the actual file when describing available presets.
- Production was verified at [mathmusic.vercel.app](https://mathmusic.vercel.app) after deploying commit `db71934` from a clean, temporary checkout via the npm-distributed Vercel CLI. Vercel project: `mugboys-projects/mathmusic`. Build with the Vite preset from the repository root, emitting `dist`.
- Automatic GitHub deployment was **unconfirmed** at handover. Vercel’s initial Git connection failed for the private repository. The user received instructions to grant the Vercel GitHub App access. Check [project Git settings](https://vercel.com/mugboys-projects/mathmusic/settings/git) before assuming a push deploys. For a requested manual release, check the intended commit and project link before running `npx vercel deploy --prod`.
- Run `npm ci` and `npm run dev` locally. `npm run build` runs TypeScript checks and Vite. There is no dedicated test script. Prior checks exercised pitch combinations, save/load, and simulated MIDI. Physical MIDI output, audible quality, and grand-staff layout still benefit from hands-on testing.

## Behavior worth preserving

| Area | Current behavior |
| --- | --- |
| Progression Maker | Starts blank. Insert a preset before or after the selected chord, or add chords individually. New chords default to two beats. The PLAYING marker follows playback independently of editor selection. MIDI and WAV downloads are central to the workflow. |
| Chord Lookup | Updates immediately when any selector changes. Four notes appear bass first, with one note on the bass staff and three on the treble staff. |
| Shared voicing | The user specifically chose the original lookup voicing for both tools. Root-position C major sounds **C3** in the bass with **E4 G4 C5** above it. In A minor, V uses **G♯** in every inversion. |
| Audio | Built-in synthesis is the default. Navbar volume starts at 50%. Live synthesis uses fixed 50 Hz high-pass and 1,600 Hz low-pass filters. WAV export uses the synthesized samples directly. External MIDI devices supply their own instrument sound. |
| Web MIDI | Each tool offers a playback engine and output selector. Permission can succeed with an empty output list. Chrome on Windows filters the Microsoft GS Wavetable Synth. Web MIDI was checked with a simulated device. |
| Saved Projects | Named browser-local saves include chords, key, mode, and tempo. The dedicated page supports open, rename, and confirmed deletion. Saves on localhost and on the production origin are separate. |

## Code map

- [src/main.tsx](src/main.tsx) owns hash navigation (`#editor`, `#lookup`, `#projects`), editor state, transport, audio nodes, and the `choices` table for suggestions.
- [src/music.ts](src/music.ts) owns chord construction, minor-key V, spelling, shared four-part voicing, ABC notation, synthesis, and MIDI/WAV encoding. Reuse `lookupVoicing` for pitch consistency.
- [src/library.ts](src/library.ts) owns presets. Degree strings use digits 1–7. Optional `positions` entries use zero-based chord indices and position codes 0–6. `materialize` returns editable chords, `formula` produces Roman numerals, and `spelled` produces chord names.
- [src/ChordStaff.tsx](src/ChordStaff.tsx) renders ABC with abcjs. [src/MidiAudition.tsx](src/MidiAudition.tsx) handles device discovery, note on/off, and progression timing.
- [src/projects.ts](src/projects.ts) manages browser storage under `mathmusic.project.v1.`. [src/studio.css](src/studio.css) contains the shared layout and styles.

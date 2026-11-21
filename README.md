# Math Music

Math Music is a browser-based composition workspace built with React, TypeScript, and Vite. Its chord progression maker lets you sketch a harmonic idea and export it to other music software.

## Run locally

Install Node.js 22.12 or later, then run these commands from the project directory.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. To type-check and build the production app, run `npm run build`. Run `npm run preview` to serve that build locally.

## Compose a progression

1. Open **Chord Progression Maker** under **Music Composition**. Choose a key, scale, and tempo.
2. Add a chord to the blank progression or insert a preset from the library. Select an existing chord to insert another preset before or after it.
3. Select a chord to change its scale degree, inversion, or duration. Roman numerals identify degrees, and figures such as **V 6 5** show inversions.
4. Play the progression or audition a suggested next chord. Download **MIDI** for editable notes or **WAV** for rendered audio.

## Source files

For current development context, deployment details, and the next planning conversation, read [the project handover](HANDOVER.md). Contributor preferences are in [AGENTS.md](AGENTS.md).

- [Editor and navigation](src/main.tsx)
- [Progression presets](src/library.ts)
- [Chord spelling, synthesis, and file export](src/music.ts)
- [Styles](src/studio.css)

## Chord Lookup and saved projects

Chord Lookup shows the notes and grand staff automatically when you select a key, scale, degree, or inversion. Both tools can audition chords through the built-in synth or a browser-exposed Web MIDI output.

Save a named progression in the editor. Open **Saved Projects** at the top of the sidebar to open, rename, or delete it. Saves belong to the current browser and site address. The production site is [Math Music on Vercel](https://mathmusic.vercel.app).

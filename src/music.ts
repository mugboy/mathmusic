export interface Chord {
	degree: number;
	position: number;
	beats: number;
}
const roots = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const romans = ["I", "II", "III", "IV", "V", "VI", "VII"];
const figures = ["", "6", "6 4", "7", "6 5", "4 3", "2"];
const modes = [
	[0, 2, 4, 5, 7, 9, 11],
	[0, 2, 3, 5, 7, 8, 10],
];
const chord = (degree: number, position = 0) => ({
	degree,
	position,
	beats: 2,
});
const harmonicMinor = [0, 2, 3, 5, 7, 8, 11];

/** Use the raised leading tone when building or spelling V in a minor key. */
function chordScale(degree: number, mode: number) {
	return mode === 1 && degree === 4 ? harmonicMinor : modes[mode];
}

/** Build a triad or seventh and rotate it into the selected inversion. */
function notes(item: Chord, key: number, mode: number) {
	const scale = chordScale(item.degree, mode);
	const result = [];
	const seventh = item.position >= 3;
	for (let i = 0; i < (seventh ? 4 : 3); i++) {
		const step = item.degree + 2 * i;
		result.push(60 + key + scale[step % 7] + 12 * Math.floor(step / 7));
	}
	const inversion = seventh ? item.position - 3 : item.position;
	for (let i = 0; i < inversion; i++) result.push(result.shift()! + 12);
	return result;
}

/** Spell the root with the letter appropriate to its scale degree. */
function rootName(degree: number, pitch: number, key: number) {
	const letters = "CDEFGAB";
	const letter = (letters.indexOf(roots[key][0]) + degree) % 7;
	const offset = ((pitch - modes[0][letter] + 6) % 12) - 6;
	return letters[letter] + (offset < 0 ? "♭" : "♯").repeat(Math.abs(offset));
}

/** Place the inversion in the bass and voice the other tones above it, doubling the root for triads. */
export function lookupVoicing(item: Chord, key: number, mode: number) {
	const voiced = notes(item, key, mode);
	const bass = 43 + (voiced[0] - 43) % 12;
	const upper = voiced.slice(1);
	if (voiced.length === 3) {
		let root = notes({ ...item, position: 0 }, key, mode)[0];
		while (root <= upper[upper.length - 1]) root += 12;
		upper.push(root);
	}
	const shift = 12 * Math.ceil((60 - upper[0]) / 12);
	return [bass, upper[0] + shift, upper[1] + shift, upper[2] + shift];
}

/** Spell the lookup voicing in bass-first order using letters from the selected scale. */
export function chordNotes(item: Chord, key: number, mode: number) {
	const names: string[] = [];
	const scale = chordScale(item.degree, mode);
	for (const pitch of lookupVoicing(item, key, mode)) {
		const degree = scale.indexOf((pitch - key) % 12);
		names.push(rootName(degree, pitch, key));
	}
	return names;
}

/** Encode the sounding voicing in ABC notation with explicit accidentals and written octaves. */
export function chordScore(item: Chord, key: number, mode: number) {
	const pitches = lookupVoicing(item, key, mode);
	const names = chordNotes(item, key, mode);
	const tokens: string[] = [];
	for (const [index, name] of names.entries()) {
		const letter = name[0];
		const accidental = name.slice(1);
		const alteration = accidental.startsWith("♭") ? -accidental.length : accidental.length;
		const naturalPitch = modes[0]["CDEFGAB".indexOf(letter)];
		const octave = (pitches[index] - naturalPitch - alteration) / 12 - 1;
		const register = octave < 4 ? ",".repeat(4 - octave) : "'".repeat(octave - 4);
		tokens.push(accidental.replaceAll("♭", "_").replaceAll("♯", "^") + letter + register);
	}
	return [
		"X:1", "%%score { (upper) | (bass) }", "L:1/4",
		"V:upper clef=treble", "V:bass clef=bass", "K:C",
		`[V:upper] [${tokens.slice(1).join("")}]${item.beats}|]`,
		`[V:bass] ${tokens[0]}${item.beats}|]`,
	].join("\n");
}

/** Describe chord quality independently of the uppercase Roman numeral. */
function chordName(item: Chord, key: number, mode: number) {
	const [root, third, fifth, seventh] = notes(
		{ ...item, position: item.position >= 3 ? 3 : 0 },
		key,
		mode,
	);
	const triad = fifth - root === 6 ? "DIM" : third - root === 3 ? "MIN" : "MAJ";
	const quality =
		seventh === undefined
			? triad
			: seventh - root === 11
				? "MAJ7"
				: triad === "MAJ"
					? "7"
					: triad === "DIM"
						? "HALF-DIM7"
						: "MIN7";
	return rootName(item.degree, root, key) + " " + quality;
}
const numeral = (item: Chord) =>
	[romans[item.degree], figures[item.position]].filter(Boolean).join(" ");
/** Generate a mono PCM performance shared by playback and WAV export. */
function samples(items: Chord[], bpm: number, key: number, mode: number, voicing = lookupVoicing) {
	const rate = 22050,
		beat = 60 / bpm;
	const length = items.reduce(sumBeats, 0);
	const data = new Float32Array(Math.ceil(length * beat * rate));
	let start = 0;
	for (const item of items) {
		const end = start + item.beats;
		const first = Math.round(start * beat * rate),
			last = Math.round(end * beat * rate);
		for (const pitch of voicing(item, key, mode)) {
			const frequency = 440 * 2 ** ((pitch - 69) / 12);
			// Taper the octave overtone as the fundamental moves into the treble.
			const overtone = 0.12 / (1 + (frequency / 600) ** 2);
			for (let i = first; i < last; i++) {
				const t = (i - first) / rate,
					phase = 2 * Math.PI * frequency * t;
				const fade = Math.min(1, t / 0.02, (last - 1 - i) / (rate * 0.08));
				const envelope = fade * fade * (3 - 2 * fade) * Math.exp(-1.3 * t);
				data[i] +=
					0.14 * envelope * (Math.sin(phase) + overtone * Math.sin(2 * phase));
			}
		}
		start = end;
	}
	return data;
}
function sumBeats(total: number, item: Chord) {
	return total + item.beats;
}
const ascii = (str: string) => Array.from(str, charCode);
function charCode(c: string) {
	return c.charCodeAt(0);
}
function big32(n: number) {
	return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

/** Encode an integer as a MIDI variable-length delta time. */
function delta(n: number) {
	const out = [n & 127];
	while ((n = Math.floor(n / 128)) > 0) out.unshift((n & 127) | 128);
	return out;
}

/** Write a single MIDI track with a tempo event and explicit note offs. */
function midi(items: Chord[], bpm: number, key: number, mode: number) {
	const track = [0, 255, 81, 3, ...big32(Math.round(60000000 / bpm)).slice(1)];
	for (const item of items) {
		const pitches = lookupVoicing(item, key, mode);
		for (const pitch of pitches) track.push(0, 144, pitch, 86);
		for (const [i, pitch] of pitches.entries())
			track.push(...delta(i === 0 ? item.beats * 480 : 0), 128, pitch, 0);
	}
	track.push(0, 255, 47, 0);
	return Uint8Array.from([
		...ascii("MThd"),
		0,
		0,
		0,
		6,
		0,
		0,
		0,
		1,
		1,
		224,
		...ascii("MTrk"),
		...big32(track.length),
		...track,
	]);
}

/** Wrap the performance in a 16-bit PCM RIFF/WAVE file. */
function wave(data: Float32Array) {
	const out = new Uint8Array(44 + data.length * 2),
		view = new DataView(out.buffer);
	out.set(ascii("RIFF"));
	out.set(ascii("WAVEfmt "), 8);
	out.set(ascii("data"), 36);
	view.setUint32(4, out.length - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 22050, true);
	view.setUint32(28, 44100, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	view.setUint32(40, out.length - 44, true);
	for (let i = 0; i < data.length; i++)
		view.setInt16(44 + i * 2, Math.round(data[i] * 32767), true);
	return out;
}

/** Download a rendered file using a temporary browser object URL. */
function download(
	bytes: Uint8Array<ArrayBuffer>,
	extension: string,
	type: string,
) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(new Blob([bytes], { type }));
	link.download = "progression." + extension;
	link.click();
	setTimeout(URL.revokeObjectURL.bind(URL, link.href), 10000);
}

export {
	roots,
	romans,
	figures,
	chord,
	chordName,
	numeral,
	samples,
	midi,
	wave,
	download,
};

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
	beats: 4,
});
/** Build a diatonic triad or seventh and rotate it into the selected inversion. */
function notes(item: Chord, key: number, mode: number) {
	const scale = modes[mode];
	const result = [];
	const seventh = item.position >= 3;
	for (let i = 0; i < (seventh ? 4 : 3); i++) {
		const step = item.degree + 2 * i;
		result.push(48 + key + scale[step % 7] + 12 * Math.floor(step / 7));
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
function samples(items: Chord[], bpm: number, key: number, mode: number) {
	const rate = 22050,
		beat = 60 / bpm;
	const length = items.reduce(sumBeats, 0);
	const data = new Float32Array(Math.ceil(length * beat * rate));
	let start = 0;
	for (const item of items) {
		const end = start + item.beats;
		const first = Math.round(start * beat * rate),
			last = Math.round(end * beat * rate);
		for (const pitch of notes(item, key, mode)) {
			const frequency = 440 * 2 ** ((pitch - 69) / 12);
			for (let i = first; i < last; i++) {
				const t = (i - first) / rate,
					phase = 2 * Math.PI * frequency * t;
				const envelope =
					Math.min(1, t * 100, (last - i) / (rate * 0.06)) * Math.exp(-1.3 * t);
				data[i] +=
					0.16 * envelope * (Math.sin(phase) + 0.25 * Math.sin(2 * phase));
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
		const pitches = notes(item, key, mode);
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

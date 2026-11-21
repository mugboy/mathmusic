import { roots } from "./music";

export interface FourierPoint {
	x: number;
	y: number;
}

export interface FourierCircle {
	harmonic: number;
	radius: number;
	phase: number;
	frequency: number;
	note: string;
}

const sampleCount = 256;
const fullTurn = 2 * Math.PI;

/** Sample the closed outline at equal distances, including the final segment back to the start. */
function sampleOutline(points: readonly FourierPoint[]): FourierPoint[] {
	if (points.length < 2) return [];
	const distances = [0];
	for (let i = 0; i < points.length; i++) {
		const a = points[i];
		const b = points[(i + 1) % points.length];
		distances.push(distances[i] + Math.hypot(b.x - a.x, b.y - a.y));
	}
	const length = distances[points.length];
	if (!Number.isFinite(length) || length === 0) return [];
	const samples: FourierPoint[] = [];
	let edge = 0;
	for (let i = 0; i < sampleCount; i++) {
		const distance = (i / sampleCount) * length;
		while (edge < points.length - 1 && distances[edge + 1] <= distance) edge++;
		const t = (distance - distances[edge]) / (distances[edge + 1] - distances[edge]);
		const a = points[edge];
		const b = points[(edge + 1) % points.length];
		samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	}
	return samples;
}

/** Snap a harmonic interval to semitones and place it above the selected root. */
function circlePitch(harmonic: number, rootMidi: number) {
	const pitch = rootMidi + Math.round(12 * Math.log2(Math.abs(harmonic)));
	return {
		frequency: 440 * 2 ** ((pitch - 69) / 12),
		note: roots[pitch % 12] + (Math.floor(pitch / 12) - 1),
	};
}

/** Project the outline onto one signed complex harmonic and tune its rotation to the reference pitch. */
function getCircle(samples: FourierPoint[], harmonic: number, referencePitch: number): FourierCircle {
	let real = 0;
	let imaginary = 0;
	for (let i = 0; i < samples.length; i++) {
		const angle = fullTurn * harmonic * i / samples.length;
		const cosine = Math.cos(angle);
		const sine = Math.sin(angle);
		real += samples[i].x * cosine + samples[i].y * sine;
		imaginary += samples[i].y * cosine - samples[i].x * sine;
	}
	return {
		harmonic,
		radius: Math.hypot(real, imaginary) / samples.length,
		phase: Math.atan2(imaginary, real),
		...circlePitch(harmonic, referencePitch),
	};
}

function byLargestRadius(a: FourierCircle, b: FourierCircle) {
	return b.radius - a.radius;
}

/** Separate the constant center and keep circles at least one percent as large as the strongest. */
export function analyzeDrawing(points: readonly FourierPoint[], referencePitch = 45) {
	const samples = sampleOutline(points);
	const center = { x: 0, y: 0 };
	const circles: FourierCircle[] = [];
	for (const point of samples) {
		center.x += point.x / samples.length;
		center.y += point.y / samples.length;
	}
	for (const point of samples) {
		point.x -= center.x;
		point.y -= center.y;
	}
	for (let k = 1; k < samples.length; k++) {
		circles.push(getCircle(samples, k <= samples.length / 2 ? k : k - samples.length, referencePitch));
	}
	circles.sort(byLargestRadius);
	const threshold = (circles[0]?.radius ?? 0) * 0.01;
	const significant: FourierCircle[] = [];
	for (const circle of circles) {
		if (circle.radius > 0 && circle.radius >= threshold) significant.push(circle);
	}
	return { center, circles: significant };
}

/** Update the visible notes while preserving each circle's position and rotation. */
export function withRoot(circles: readonly FourierCircle[], rootMidi: number) {
	const tuned = [];
	for (const circle of circles)
		tuned.push({ ...circle, ...circlePitch(circle.harmonic, rootMidi) });
	return tuned;
}

/** Release the audio graph once the oscillator finishes its fade. */
function disconnectVoice(oscillator: OscillatorNode, gain: GainNode, panner: StereoPannerNode) {
	oscillator.disconnect();
	gain.disconnect();
	panner.disconnect();
}

interface Voice {
	oscillator: OscillatorNode;
	gain: GainNode;
	panner: StereoPannerNode;
	circle: FourierCircle;
}

export function circleAngle(circle: FourierCircle, turns: number) {
	return circle.phase + fullTurn * circle.harmonic * turns;
}

function circlePan(circle: FourierCircle, turns: number) {
	return Math.cos(circleAngle(circle, turns));
}

/** Track each rotating radius horizontally as the visible animation advances. */
function setVoiceTurns(context: AudioContext, voices: Voice[], turns: number) {
	for (const { circle, panner } of voices)
		panner.pan.setTargetAtTime(circlePan(circle, turns), context.currentTime, 0.008);
}

/** Retune sounding oscillators without restarting the rotating circles. */
function setVoiceRoot(voices: Voice[], rootMidi: number) {
	for (const { circle, oscillator } of voices)
		oscillator.frequency.value = circlePitch(circle.harmonic, rootMidi).frequency;
}

/** Fade all tones out together, with repeated calls leaving the scheduled release intact. */
function stopVoices(context: AudioContext, voices: Voice[]) {
	const now = context.currentTime;
	for (const { oscillator, gain } of voices.splice(0)) {
		gain.gain.setTargetAtTime(0, now, 0.006);
		oscillator.stop(now + 0.04);
	}
}

/** Sustain simultaneous sine tones weighted by circle size until the caller releases them. */
export function startFourierSound(context: AudioContext, destination: AudioNode, circles: readonly FourierCircle[], turns = 0) {
	const voices: Voice[] = [];
	let total = 0;
	for (const circle of circles) total += circle.radius;
	const now = context.currentTime;
	for (const circle of circles) {
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		const panner = context.createStereoPanner();
		panner.pan.value = circlePan(circle, turns);
		oscillator.frequency.value = circle.frequency;
		gain.gain.setValueAtTime(0, now);
		gain.gain.setTargetAtTime(0.65 * circle.radius / total, now, 0.005);
		oscillator.connect(gain);
		gain.connect(panner);
		panner.connect(destination);
		oscillator.onended = disconnectVoice.bind(null, oscillator, gain, panner);
		oscillator.start(now);
		voices.push({ oscillator, gain, panner, circle });
	}
	return {
		stop: stopVoices.bind(null, context, voices),
		setTurns: setVoiceTurns.bind(null, context, voices),
		setRoot: setVoiceRoot.bind(null, voices),
	};
}

import { Component, type MouseEvent, type PointerEvent } from "react";
import {
	analyzeDrawing,
	startFourierSound,
	type FourierCircle,
	type FourierPoint,
} from "./fourier";
import "./fourier.css";

const width = 640;
const height = 360;
const drawBox = `0 0 ${width} ${height}`;
const turnDuration = 6000;

function coordinate(point: FourierPoint) {
	return `${point.x},${point.y}`;
}

/** Convert a pointer location to the same units as the drawing. */
function drawingPoint(event: PointerEvent<SVGSVGElement>) {
	const matrix = event.currentTarget.getScreenCTM();
	if (!matrix) return null;
	const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
	return { x: Math.max(0, Math.min(width, point.x)), y: Math.max(0, Math.min(height, point.y)) };
}

/** Leave room for the rotating chain even when a stroke touches the drawing edge. */
function circleViewBox(center: FourierPoint, circles: FourierCircle[]) {
	let reach = 6;
	for (const circle of circles) reach += circle.radius;
	const left = Math.min(0, center.x - reach);
	const top = Math.min(0, center.y - reach);
	const right = Math.max(width, center.x + reach);
	const bottom = Math.max(height, center.y + reach);
	return `${left} ${top} ${right - left} ${bottom - top}`;
}

interface State {
	outline: string;
	viewBox: string;
	center: FourierPoint;
	circles: FourierCircle[];
	turns: number;
	playing: "harmony" | number | null;
	message: string;
}

const empty: State = {
	outline: "",
	viewBox: drawBox,
	center: { x: 0, y: 0 },
	circles: [],
	turns: 0,
	playing: null,
	message: "",
};

export class FourierSoundCreator extends Component<{ volume: number }, State> {
	state: State = empty;
	points: FourierPoint[] = [];
	pointer: number | null = null;
	audio?: AudioContext;
	output?: GainNode;
	release?: () => void;
	request = 0;
	frame = 0;
	started = 0;

	componentDidUpdate(previous: { volume: number }) {
		if (previous.volume !== this.props.volume && this.output && this.audio)
			this.output.gain.setTargetAtTime(this.props.volume / 100, this.audio.currentTime, 0.01);
	}

	componentWillUnmount() {
		this.silence();
		if (this.audio) void this.audio.close();
	}

	/** Cancel pending resumes, playing oscillators and the drawing animation. */
	silence() {
		this.request++;
		cancelAnimationFrame(this.frame);
		this.release?.();
		this.release = undefined;
	}

	stop = () => {
		this.silence();
		this.setState({ playing: null });
	};

	/** Return the surface to its empty drawing state. */
	clear = () => {
		this.silence();
		this.points = [];
		this.pointer = null;
		this.setState(empty);
	};

	/** Capture a single pen, finger or mouse stroke on the empty surface. */
	begin = (event: PointerEvent<SVGSVGElement>) => {
		if (this.state.circles.length || this.pointer !== null || event.button !== 0) return;
		const point = drawingPoint(event);
		if (!point) return;
		this.pointer = event.pointerId;
		event.currentTarget.setPointerCapture(event.pointerId);
		this.points = [point];
		this.setState({ outline: coordinate(point), message: "" });
	};

	/** Append distinct points to the visible stroke. */
	move = (event: PointerEvent<SVGSVGElement>) => {
		if (this.pointer !== event.pointerId) return;
		const point = drawingPoint(event);
		const last = this.points[this.points.length - 1];
		if (!point || Math.hypot(point.x - last.x, point.y - last.y) < 1) return;
		this.points.push(point);
		this.setState({ outline: this.points.map(coordinate).join(" ") });
	};

	/** Close the stroke and show its Fourier circles and snapped notes. */
	finish = (event: PointerEvent<SVGSVGElement>) => {
		if (this.pointer !== event.pointerId) return;
		this.move(event);
		this.pointer = null;
		const { center, circles } = analyzeDrawing(this.points);
		if (!circles.length) {
			this.setState({ ...empty, message: "DRAW A LONGER STROKE." });
			return;
		}
		const outline = [...this.points, this.points[0]].map(coordinate).join(" ");
		this.setState({ center, circles, outline, viewBox: circleViewBox(center, circles) });
	};

	cancelStroke = (event: PointerEvent<SVGSVGElement>) => {
		if (this.pointer === event.pointerId) this.clear();
	};

	animate = (now: number) => {
		this.setState({ turns: ((now - this.started) % turnDuration) / turnDuration });
		this.frame = requestAnimationFrame(this.animate);
	};

	/** Start the selected oscillators together and keep only the latest request active. */
	async listen(selection: "harmony" | number) {
		const circles = selection === "harmony" ? this.state.circles : [this.state.circles[selection]];
		if (!circles.length || !circles[0]) return;
		this.silence();
		const request = this.request;
		this.setState({ playing: selection, message: "" });
		try {
			this.audio ??= new AudioContext();
			if (!this.output) {
				this.output = this.audio.createGain();
				this.output.gain.value = this.props.volume / 100;
				this.output.connect(this.audio.destination);
			}
			await this.audio.resume();
			if (request !== this.request) return;
			this.release = startFourierSound(this.audio, this.output, circles);
			if (selection === "harmony") {
				this.started = performance.now();
				this.animate(this.started);
			}
		} catch {
			if (request === this.request) {
				this.stop();
				this.setState({ message: "AUDIO COULD NOT BE PLAYED." });
			}
		}
	}

	harmony = () => this.listen("harmony");

	soloRing = (event: PointerEvent<SVGCircleElement>) => {
		if (event.button === 0) void this.listen(Number(event.currentTarget.dataset.index));
	};

	soloNote = (event: MouseEvent<HTMLButtonElement>) => this.listen(Number(event.currentTarget.value));

	/** Position each circle at the endpoint of the preceding rotating radius. */
	renderCircles() {
		const { circles, turns, playing } = this.state;
		let { x, y } = this.state.center;
		const rings = [];
		for (const [index, circle] of circles.entries()) {
			const angle = circle.phase + 2 * Math.PI * circle.harmonic * turns;
			const endX = x + circle.radius * Math.cos(angle);
			const endY = y + circle.radius * Math.sin(angle);
			rings.push(
				<g key={circle.harmonic} className={playing === index ? "fourier-circle solo" : "fourier-circle"}>
					<circle className="fourier-rim" cx={x} cy={y} r={circle.radius} />
					<line x1={x} y1={y} x2={endX} y2={endY} />
					<circle className="fourier-hit" cx={x} cy={y} r={circle.radius} data-index={index} onPointerDown={this.soloRing}>
						<title>{`PLAY ${circle.note}`}</title>
					</circle>
				</g>
			);
			x = endX;
			y = endY;
		}
		if (circles.length) rings.push(
			<circle key="endpoint" className="fourier-end" cx={x} cy={y} r={4} />
		);
		return rings;
	}

	/** Provide a stationary, keyboard-accessible target for every circle. */
	note = (circle: FourierCircle, index: number) => (
		<button
			key={circle.harmonic}
			value={index}
			aria-label={`PLAY CIRCLE ${index + 1}, ${circle.note}`}
			aria-pressed={this.state.playing === index}
			onClick={this.soloNote}
		>
			{circle.note}
		</button>
	);

	/** Present the drawing, audition controls and individual circle notes. */
	render() {
		const { outline, circles, viewBox, playing, message } = this.state;
		const hasCircles = circles.length > 0;
		return (
			<main id="fourier">
				<h1>FOURIER TRANSFORM SOUND CREATOR</h1>
				<h2>DRAWING</h2>
				<p id="fourier-help">
					{hasCircles ? "PRESS PLAY TO HEAR THE HARMONY, OR TAP A CIRCLE TO HEAR ITS NOTE." : "DRAW A SHAPE IN ONE STROKE. RELEASE TO CLOSE THE LOOP."}
				</p>
				<svg
					className={hasCircles ? "fourier-pad analyzed" : "fourier-pad"}
					viewBox={viewBox}
					role="img"
					aria-label="DRAWING AND FOURIER CIRCLES"
					aria-describedby="fourier-help"
					onPointerDown={this.begin}
					onPointerMove={this.move}
					onPointerUp={this.finish}
					onPointerCancel={this.cancelStroke}
					onLostPointerCapture={this.cancelStroke}
				>
					<polyline className="fourier-outline" points={outline} />
					{this.renderCircles()}
				</svg>
				<div className="actions">
					<button disabled={!hasCircles || playing === "harmony"} onClick={this.harmony}>PLAY</button>
					<button disabled={playing === null} onClick={this.stop}>STOP</button>
					<button disabled={!outline} onClick={this.clear}>CLEAR</button>
				</div>
				{hasCircles && (
					<section aria-labelledby="fourier-notes">
						<h2 id="fourier-notes">NOTES</h2>
						<div className="controls fourier-notes">{circles.map(this.note)}</div>
					</section>
				)}
				{message && (
					<p role="status">{message}</p>
				)}
			</main>
		);
	}
}

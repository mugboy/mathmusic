import {
	library,
	materialize,
	formula,
	spelled,
	type Template,
} from "./library";
import { Component, type ChangeEvent, type MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import {
	roots,
	romans,
	chord,
	chordName,
	numeral,
	samples,
	midi,
	wave,
	download,
	type Chord,
} from "./music";
import "./studio.css";

function templateOption(template: Template, index: number) {
	return option(template.title + " : " + formula(template), index);
}

interface State {
	templateIndex: number;
	before: boolean;
	items: Chord[];
	selected: number;
	keyIndex: number;
	mode: number;
	tempo: string;
	suggestion: Chord | null;
	error: string;
	playing: boolean;
}

const positions = [
	"TRIAD · ROOT",
	"TRIAD · 6",
	"TRIAD · 6 4",
	"SEVENTH · 7",
	"SEVENTH · 6 5",
	"SEVENTH · 4 3",
	"SEVENTH · 2",
];
const choices = [
	[3, 4, 5],
	[4, 6],
	[5, 3],
	[1, 4],
	[0, 5],
	[1, 3],
	[0, 2],
];
function option(label: string, index: number) {
	return (
		<option key={index} value={index}>
			{label}
		</option>
	);
}
function beatOption(value: number) {
	return <option key={value}>{value}</option>;
}

class Studio extends Component<object, State> {
	state: State = {
		items: [],
		templateIndex: 0,
		before: false,
		selected: -1,
		keyIndex: 0,
		mode: 0,
		tempo: "100",
		suggestion: null,
		error: "",
		playing: false,
	};
	audio?: AudioContext;
	source?: AudioBufferSourceNode;
	revision = 0;

	/** Cancel pending audio requests and stop the current performance. */
	stop() {
		this.revision++;
		if (this.source) {
			this.source.onended = null;
			this.source.stop();
			this.source = undefined;
		}
		this.setState({ error: "", playing: false });
	}

	ended = () => {
		this.source = undefined;
		this.setState({ playing: false });
	};

	/** Play the same synthesized samples used by WAV export. */
	async listen(items: Chord[]) {
		this.stop();
		const request = this.revision;
		const { tempo, keyIndex, mode } = this.state;
		this.audio ??= new AudioContext();
		await this.audio.resume();
		if (request !== this.revision) return;
		const pcm = samples(items, Number(tempo), keyIndex, mode);
		const buffer = this.audio.createBuffer(1, pcm.length, 22050);
		buffer.copyToChannel(pcm, 0);
		const source = this.audio.createBufferSource();
		source.buffer = buffer;
		source.connect(this.audio.destination);
		source.onended = this.ended;
		this.source = source;
		source.start();
		this.setState({ playing: true });
	}

	/** Update the editable chord or global settings and invalidate the suggestion. */
	change = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const { name, value } = event.target;
		this.stop();
		this.setState({ suggestion: null });
		if (name === "template") {
			this.setState({ templateIndex: Number(value) });
			return;
		}
		if (name === "side") {
			this.setState({ before: value === "before" });
			return;
		}
		if (name === "tempo") {
			this.setState({ tempo: value });
			return;
		}
		if (name === "key") {
			this.setState({ keyIndex: Number(value) });
			return;
		}
		if (name === "mode") {
			this.setState({ mode: Number(value) });
			return;
		}
		const { items, selected } = this.state;
		const next = items.slice();
		next[selected] = { ...next[selected], [name]: Number(value) };
		this.setState({ items: next });
	};

	/** Handle transport, export and progression editing from the workspace. */
	action = async (event: MouseEvent<HTMLElement>) => {
		const button = (event.target as Element).closest("button");
		if (!button) return;
		const { items, selected, keyIndex, mode, tempo, suggestion } = this.state;
		const bpm = Number(tempo);
		try {
			if (
				["play", "suggest", "wav", "midi"].includes(button.name) &&
				(!Number.isInteger(bpm) || bpm < 40 || bpm > 240)
			) {
				this.setState({ error: "ENTER A TEMPO FROM 40 TO 240 BPM." });
				return;
			}
			switch (button.name) {
				case "stop":
					this.stop();
					return;
				case "play":
					await this.listen(items);
					return;
				case "wav":
					download(
						wave(samples(items, bpm, keyIndex, mode)),
						"wav",
						"audio/wav",
					);
					return;
				case "midi":
					download(midi(items, bpm, keyIndex, mode), "mid", "audio/midi");
					return;
				case "suggest": {
					const options = choices[items[selected].degree];
					const candidate = chord(
						options[Math.floor(Math.random() * options.length)],
					);
					this.setState({ suggestion: candidate });
					await this.listen([candidate]);
					return;
				}
			}
			this.stop();
			const next = items.slice();
			let index = selected;
			if (button.name === "insert") {
				const added = materialize(library[this.state.templateIndex]);
				const at = Math.max(0, selected + (this.state.before ? 0 : 1));
				next.splice(at, 0, ...added);
				index = at + added.length - 1;
			}
			if (button.name === "select") index = Number(button.value);
			if (button.name === "remove") {
				next.splice(index, 1);
				index = Math.min(index, next.length - 1);
			}
			if (button.name === "accept" || button.name === "add")
				next.splice(
					++index,
					0,
					button.name === "accept" && suggestion ? suggestion : chord(0),
				);
			this.setState({ selected: index, items: next, suggestion: null });
		} catch (error) {
			this.setState({
				error: String(
					error instanceof Error ? error.message : error,
				).toUpperCase(),
			});
		}
	};

	/** Render a selectable chord with its duration and spelled name. */
	card = (item: Chord, index: number) => {
		return (
			<button
				key={index}
				name="select"
				value={index}
				aria-pressed={this.state.selected === index}
			>
				{numeral(item)}
				<small>
					{chordName(item, this.state.keyIndex, this.state.mode)} · {item.beats}{" "}
					{item.beats === 1 ? "BEAT" : "BEATS"}
				</small>
			</button>
		);
	};
	degreeOption = (roman: string, index: number) =>
		option(
			roman +
				" · " +
				chordName(chord(index), this.state.keyIndex, this.state.mode),
			index,
		);

	/** Present the progression editor, audition controls and downloads. */
	render() {
		const { items, selected, keyIndex, mode, tempo, suggestion, error } =
			this.state;
		const item = items[selected];
		return (
			<>
				<aside>
					<strong>MATH / MUSIC</strong>
					<nav aria-label="TOOLS">
						<section aria-labelledby="composition-category">
							<h2 id="composition-category">MUSIC COMPOSITION</h2>
							<a href="#editor">CHORD PROGRESSION MAKER</a>
						</section>
						<section aria-labelledby="experiments-category">
							<h2 id="experiments-category">MATH MUSIC EXPERIMENTS</h2>
						</section>
					</nav>
				</aside>
				<main id="editor" onClick={this.action}>
					<h1>CHORD PROGRESSION MAKER</h1>
					<section className="controls">
						<label>
							KEY
							<select name="key" value={keyIndex} onChange={this.change}>
								{roots.map(option)}
							</select>
						</label>
						<label>
							SCALE
							<select name="mode" value={mode} onChange={this.change}>
								{["MAJOR", "NATURAL MINOR"].map(option)}
							</select>
						</label>
						<label>
							TEMPO · BPM
							<input
								id="tempo"
								name="tempo"
								type="number"
								min={40}
								max={240}
								value={tempo}
								onChange={this.change}
							/>
						</label>
					</section>
					<section className="library" aria-labelledby="library-title">
						<h2 id="library-title">PROGRESSION LIBRARY</h2>
						<div className="controls">
							<label>
								PRESET
								<select
									name="template"
									value={this.state.templateIndex}
									onChange={this.change}
								>
									{library.map(templateOption)}
								</select>
							</label>
							{item && (
								<label>
									INSERTION POINT
									<select
										name="side"
										value={this.state.before ? "before" : "after"}
										onChange={this.change}
									>
										<option value="before">BEFORE SELECTED CHORD</option>
										<option value="after">AFTER SELECTED CHORD</option>
									</select>
								</label>
							)}
							<button name="insert">INSERT PROGRESSION</button>
							<div className="template-detail">
								<strong>
									{spelled(library[this.state.templateIndex], keyIndex, mode)}
								</strong>
							</div>
						</div>
					</section>
					<h2>PROGRESSION</h2>
					{!item && <p>INSERT A PRESET OR ADD YOUR FIRST CHORD.</p>}
					<div id="sequence">{items.map(this.card)}</div>
					{item && (
						<section className="controls">
							<label>
								SELECTED CHORD
								<select
									name="degree"
									value={item.degree}
									onChange={this.change}
								>
									{romans.map(this.degreeOption)}
								</select>
							</label>
							<label>
								POSITION
								<select
									name="position"
									value={item.position}
									onChange={this.change}
								>
									{positions.map(option)}
								</select>
							</label>
							<label>
								BEATS
								<select name="beats" value={item.beats} onChange={this.change}>
									{[1, 2, 3, 4, 6, 8].map(beatOption)}
								</select>
							</label>
							<button name="remove">REMOVE</button>
						</section>
					)}
					<div className="actions">
						<button name="add">ADD CHORD</button>
						<button disabled={!item} name="suggest">
							SUGGEST NEXT CHORD
						</button>
					</div>
					{suggestion && (
						<p>
							<span>
								{numeral(suggestion)} ·{" "}
								{chordName(suggestion, keyIndex, mode)}{" "}
							</span>
							<button name="accept">ADD SUGGESTION</button>
						</p>
					)}
					<footer>
						<button disabled={!item} name={this.state.playing ? "stop" : "play"}>
							{this.state.playing ? "STOP" : "PLAY"}
						</button>
						<button disabled={!item} name="midi">
							DOWNLOAD MIDI
						</button>
						<button disabled={!item} name="wav">
							DOWNLOAD WAV
						</button>
					</footer>
					<p role="status">{error}</p>
				</main>
			</>
		);
	}
}

createRoot(document.getElementById("root")!).render(<Studio />);

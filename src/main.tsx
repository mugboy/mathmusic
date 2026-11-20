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
	chordNotes,
	chordScore,
	lookupVoicing,
	numeral,
	samples,
	midi,
	wave,
	download,
	type Chord,
} from "./music";
import "./studio.css";
import { ChordStaff } from "./ChordStaff";
import { projectNames, loadProject, saveProject, renameProject, deleteProject } from "./projects";

function templateOption(template: Template, index: number) {
	return option(template.title + " : " + formula(template), index);
}

interface State {
	volume: number;
	toneHz: number;
	page: string;
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
	playhead: number;
	projectName: string;
	savedName: string;
	saves: string[];
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
function savedOption(name: string) {
	return (
		<option key={name} value={name}>
			{name}
		</option>
	);
}

interface VolumeProps {
	volume: number;
	changeVolume: (event: ChangeEvent<HTMLInputElement>) => void;
}

/** Display the shared playback level as a keyboard-accessible percentage slider. */
function VolumeControl({ volume, changeVolume }: VolumeProps) {
	return (
		<label>
			VOLUME {volume}%
			<input type="range" min={0} max={100} value={volume} onChange={changeVolume}
				aria-label="PLAYBACK VOLUME" aria-valuetext={`${volume}%`} />
		</label>
	);
}

interface LookupProps {
	play: (items: Chord[], key: number, mode: number) => Promise<void>;
	stop: () => void;
	playing: boolean;
}

class ChordLookup extends Component<LookupProps, { item: Chord; keyIndex: number; mode: number }> {
	state = { item: chord(0), keyIndex: 0, mode: 0 };

	/** Keep the selected voicing synchronized with all four controls. */
	change = (event: React.FormEvent<HTMLFormElement>) => {
		const fields = new FormData(event.currentTarget);
		const item = chord(
			Number(fields.get("degree")),
			Number(fields.get("position")),
		);
		this.props.stop();
		this.setState({ item, keyIndex: Number(fields.get("key")), mode: Number(fields.get("scale")) });
	};
	audition = () =>
		this.props.playing
			? this.props.stop()
			: this.props.play([this.state.item], this.state.keyIndex, this.state.mode);

	/** Display the conversion controls and a separate bass-first note readout. */
	render() {
		const { item, keyIndex, mode } = this.state;
		const result = chordNotes(item, keyIndex, mode).join("   ");
		return (
			<main id="lookup">
				<h1>CHORD LOOKUP</h1>
				<form className="controls" onChange={this.change}>
					<label>
						KEY
						<select name="key">{roots.map(option)}</select>
					</label>
					<label>
						SCALE
						<select name="scale">
							{["MAJOR", "NATURAL MINOR"].map(option)}
						</select>
					</label>
					<label>
						ROMAN NUMERAL
						<select name="degree">{romans.map(option)}</select>
					</label>
					<label>
						INVERSION
						<select name="position">{positions.map(option)}</select>
					</label>
				</form>
				<h2 id="notes-heading">NOTES</h2>
				<output className="lookup-notes" aria-labelledby="notes-heading">
					{result}
				</output>
				<ChordStaff
					score={chordScore(item, keyIndex, mode)}
					label={`SHEET MUSIC: ${result}`}
				/>
				<button onClick={this.audition}>
					{this.props.playing ? "STOP" : "PLAY"}
				</button>
			</main>
		);
	}
}

class Studio extends Component<object, State> {
	state: State = {
		page: window.location.hash,
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
		volume: 50,
		toneHz: 1000,
		playhead: -1,
		projectName: "",
		savedName: "",
		saves: [],
	};
	audio?: AudioContext;
	output?: GainNode;
	toneFilter?: BiquadFilterNode;

	/** Move the playback low-pass cutoff without interrupting held notes. */
	changeTone = (event: ChangeEvent<HTMLInputElement>) => {
		const toneHz = event.currentTarget.valueAsNumber;
		this.setState({ toneHz });
		if (this.toneFilter && this.audio)
			this.toneFilter.frequency.setTargetAtTime(toneHz, this.audio.currentTime, 0.025);
	};

	/** Adjust the live output smoothly without restarting the current performance. */
	changeVolume = (event: ChangeEvent<HTMLInputElement>) => {
		const volume = event.currentTarget.valueAsNumber;
		this.setState({ volume });
		if (this.output && this.audio)
			this.output.gain.setTargetAtTime(volume / 100, this.audio.currentTime, 0.01);
	};
	source?: AudioBufferSourceNode;
	releaseGain?: GainNode;
	revision = 0;
	frame = 0;
	startedAt = 0;
	boundaries: number[] = [];

	componentDidMount() {
		window.addEventListener("hashchange", this.navigate);
		this.refreshSaves();
		window.addEventListener("storage", this.refreshSaves);
	}

	componentWillUnmount() {
		window.removeEventListener("hashchange", this.navigate);
		window.removeEventListener("storage", this.refreshSaves);
		this.stop();
	}

	/** Refresh the list after local saves or writes in another tab. */
	refreshSaves = () => {
		try {
			this.setState({ saves: projectNames() });
		} catch {
			this.setState({ error: "BROWSER STORAGE IS UNAVAILABLE." });
		}
	};

	editName = (event: ChangeEvent<HTMLInputElement>) =>
		this.setState({ projectName: event.target.value });
	chooseSave = (event: ChangeEvent<HTMLSelectElement>) =>
		this.setState({ savedName: event.target.value });

	navigate = () => {
		this.stop();
		this.setState({ page: window.location.hash });
	};

	/** Restore a saved progression into the editor. */
	openProject(name: string) {
		const project = loadProject(name);
		this.stop();
		this.setState({ ...project, selected: 0, suggestion: null, projectName: name, savedName: name, error: "PROGRESSION LOADED." });
	}

	/** Apply an action to the named project and synchronize the editor's save fields. */
	manageProject = (event: MouseEvent<HTMLButtonElement>) => {
		const {name: action, value: name} = event.currentTarget;
		try {
			if (action === "open") {
				this.openProject(name);
				window.location.hash = "editor";
				return;
			}
			let replacement = "";
			if (action === "rename") {
				const input = window.prompt("NEW PROJECT NAME", name);
				if (input === null) return;
				replacement = renameProject(name, input);
			} else {
				if (!window.confirm(`DELETE “${name}” FROM THIS BROWSER?`)) return;
				deleteProject(name);
			}
			this.setState({
				projectName: this.state.projectName === name ? replacement : this.state.projectName,
				savedName: this.state.savedName === name ? replacement : this.state.savedName,
				error: action === "rename" ? "PROJECT RENAMED." : "PROJECT DELETED.",
			});
			this.refreshSaves();
		} catch (error) {
			this.setState({error: error instanceof Error ? error.message : "PROJECT ACTION FAILED."});
		}
	};

	/** Display the project name and its available library actions. */
	projectRow = (name: string) => (
		<li className="controls project-row" key={name}>
			<strong>{name}</strong>
			<button name="open" value={name} onClick={this.manageProject}>OPEN</button>
			<button name="rename" value={name} onClick={this.manageProject}>RENAME</button>
			<button name="delete" value={name} onClick={this.manageProject}>DELETE</button>
		</li>
	);

	/** Cancel pending audio requests and stop the current performance. */
	stop = () => {
		this.revision++;
		cancelAnimationFrame(this.frame);
		if (this.source && this.audio && this.releaseGain) {
			const now = this.audio.currentTime;
			const end = now + 0.015;
			this.releaseGain.gain.setValueAtTime(1, now);
			this.releaseGain.gain.linearRampToValueAtTime(0, end);
			this.source.stop(end);
			this.source = undefined;
			this.releaseGain = undefined;
		}
		this.setState({ error: "", playing: false, playhead: -1 });
	};

	/** Disconnect finished audio nodes, ignoring UI updates from replaced performances. */
	ended = (source: AudioBufferSourceNode, gain: GainNode) => {
		source.disconnect();
		gain.disconnect();
		if (source !== this.source) return;
		this.source = undefined;
		this.releaseGain = undefined;
		cancelAnimationFrame(this.frame);
		this.setState({ playing: false, playhead: -1 });
	};

	/** Read the audio clock so the marker catches up after a background tab resumes. */
	markChord = () => {
		if (!this.audio || !this.source) return;
		const elapsed = this.audio.currentTime - this.startedAt;
		let index = 0;
		while (index < this.boundaries.length && elapsed >= this.boundaries[index])
			index++;
		const playhead = index < this.boundaries.length ? index : -1;
		if (this.state.playhead !== playhead) this.setState({ playhead });
		this.frame = requestAnimationFrame(this.markChord);
	};

	/** Audition the converted chord independently of the editor tempo. */
	playLookup = async (items: Chord[], key: number, mode: number) => {
		try {
			await this.listen(items, key, mode, 100, lookupVoicing);
		} catch {
			this.setState({ error: "CHORD AUDIO COULD NOT BE PLAYED." });
		}
	};

	/** Play the same synthesized samples used by WAV export. */
	async listen(
		items: Chord[],
		keyIndex = this.state.keyIndex,
		mode = this.state.mode,
		bpm = Number(this.state.tempo),
		voicing?: typeof lookupVoicing,
	) {
		this.stop();
		const request = this.revision;
		this.audio ??= new AudioContext();
		await this.audio.resume();
		if (request !== this.revision) return;
		const pcm = samples(items, bpm, keyIndex, mode, voicing);
		const buffer = this.audio.createBuffer(1, pcm.length, 22050);
		buffer.copyToChannel(pcm, 0);
		const source = this.audio.createBufferSource();
		source.buffer = buffer;
		if (!this.output) {
			this.output = this.audio.createGain();
			this.output.gain.value = this.state.volume / 100;
			this.toneFilter = this.audio.createBiquadFilter();
			this.toneFilter.type = "lowpass";
			this.toneFilter.Q.value = -3;
			this.toneFilter.frequency.value = this.state.toneHz;
			this.output.connect(this.toneFilter);
			this.toneFilter.connect(this.audio.destination);
		}
		const releaseGain = this.audio.createGain();
		source.connect(releaseGain);
		releaseGain.connect(this.output);
		source.onended = this.ended.bind(this, source, releaseGain);
		this.releaseGain = releaseGain;
		this.source = source;
		this.startedAt = this.audio.currentTime;
		source.start(this.startedAt);
		if (items === this.state.items) {
			let beats = 0;
			this.boundaries = [];
			for (const item of items) {
				beats += item.beats;
				this.boundaries.push((beats * 60) / bpm);
			}
			this.markChord();
		}
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
				["play", "suggest", "wav", "midi", "save"].includes(button.name) &&
				(!Number.isInteger(bpm) || bpm < 40 || bpm > 240)
			) {
				this.setState({ error: "ENTER A TEMPO FROM 40 TO 240 BPM." });
				return;
			}
			switch (button.name) {
				case "save": {
					const name = this.state.projectName.trim();
					saveProject(name, { items, keyIndex, mode, tempo });
					this.refreshSaves();
					this.setState({
						projectName: name,
						savedName: name,
						error: "PROGRESSION SAVED.",
					});
					return;
				}
				case "load": {
					this.openProject(this.state.savedName);
					return;
				}
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
				{this.state.playhead === index && (
					<span className="playing-marker">PLAYING</span>
				)}
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
						<a href="#projects" aria-current={this.state.page === "#projects" ? "page" : undefined}>SAVED PROJECTS</a>
						<section aria-labelledby="composition-category">
							<h2 id="composition-category">MUSIC COMPOSITION</h2>
							<a
								href="#editor"
								aria-current={["#lookup", "#projects"].includes(this.state.page) ? undefined : "page"}
							>
								CHORD PROGRESSION MAKER
							</a>
							<a
								href="#lookup"
								aria-current={this.state.page === "#lookup" ? "page" : undefined}
							>
								CHORD LOOKUP
							</a>
						</section>
						<section aria-labelledby="experiments-category">
							<h2 id="experiments-category">MATH MUSIC EXPERIMENTS</h2>
						</section>
						<VolumeControl volume={this.state.volume} changeVolume={this.changeVolume} />
						<label>
							TREBLE CUTOFF {this.state.toneHz} HZ
							<input type="range" min={400} max={5000} step={50}
								value={this.state.toneHz} onChange={this.changeTone} />
						</label>
					</nav>
				</aside>
				{this.state.page === "#projects" ? (
					<main id="projects">
						<h1>SAVED PROJECTS</h1>
						{this.state.saves.length ? (
							<ul className="project-list">{this.state.saves.map(this.projectRow)}</ul>
						) : <p>NO PROJECTS SAVED IN THIS BROWSER.</p>}
						<p role="status">{error}</p>
					</main>
				) : this.state.page === "#lookup" ? (
					<>
						<ChordLookup
							play={this.playLookup}
							stop={this.stop}
							playing={this.state.playing}
						/>
						{error && <p role="status">{error}</p>}
					</>
				) : (
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
									<select
										name="beats"
										value={item.beats}
										onChange={this.change}
									>
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
							<button
								disabled={!item}
								name={this.state.playing ? "stop" : "play"}
							>
								{this.state.playing ? "STOP" : "PLAY"}
							</button>
							<button disabled={!item} name="midi">
								DOWNLOAD MIDI
							</button>
							<button disabled={!item} name="wav">
								DOWNLOAD WAV
							</button>
						</footer>
						<h2>SAVED PROGRESSIONS</h2>
						<section className="controls">
							<label>
								PROJECT NAME
								<input
									value={this.state.projectName}
									onChange={this.editName}
								/>
							</label>
							<button
								name="save"
								disabled={!item || !this.state.projectName.trim()}
							>
								SAVE
							</button>
							<label>
								SAVED IN THIS BROWSER
								<select value={this.state.savedName} onChange={this.chooseSave}>
									<option value="">CHOOSE A PROGRESSION</option>
									{this.state.saves.map(savedOption)}
								</select>
							</label>
							<button
								name="load"
								disabled={!this.state.saves.includes(this.state.savedName)}
							>
								LOAD
							</button>
						</section>
						<p role="status">{error}</p>
					</main>
				)}
			</>
		);
	}
}

createRoot(document.getElementById("root")!).render(<Studio />);

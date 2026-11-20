import { Component, type ChangeEvent } from "react";
import { lookupVoicing, type Chord } from "./music";

interface Props {
	item: Chord;
	keyIndex: number;
	mode: number;
	volume: number;
}

interface State {
	outputs: MIDIOutput[];
	selected: string;
	message: string;
	playing: boolean;
}

function outputOption(output: MIDIOutput) {
	return (
		<option key={output.id} value={output.id}>
			{output.name || output.id}
		</option>
	);
}

/** Audition the lookup voicing through a user-selected system MIDI port. */
export class MidiAudition extends Component<Props, State> {
	state: State = {
		outputs: [],
		selected: "",
		message: "REQUESTING MIDI ACCESS…",
		playing: false,
	};
	private access?: MIDIAccess;
	private active?: { output: MIDIOutput; notes: number[] };
	private timer?: number;
	private mounted = false;

	componentDidMount() {
		this.mounted = true;
		void this.connect();
	}

	/** Release sounding notes when the user changes the chord or volume. */
	componentDidUpdate(previous: Props) {
		if (
			previous.item !== this.props.item ||
			previous.mode !== this.props.mode ||
			previous.keyIndex !== this.props.keyIndex
		)
			this.stop();
		else if (this.active && previous.volume !== this.props.volume)
			this.active.output.send([0xb0, 7, this.level()]);
	}

	componentWillUnmount() {
		this.mounted = false;
		this.access?.removeEventListener("statechange", this.refresh);
		this.stop();
	}

	level() {
		return Math.round((this.props.volume * 127) / 100);
	}

	/** Request ordinary MIDI access, including software synth ports where supported. */
	async connect() {
		try {
			if (!navigator.requestMIDIAccess)
				throw new Error(
					"WEB MIDI REQUIRES A SUPPORTED BROWSER AND HTTPS OR LOCALHOST.",
				);
			const options = { software: true, sysex: false };
			const access = await navigator.requestMIDIAccess(options);
			if (!this.mounted) return;
			this.access = access;
			access.addEventListener("statechange", this.refresh);
			this.refresh();
		} catch (error) {
			if (this.mounted)
				this.setState({
					message:
						error instanceof Error
							? error.message.toUpperCase()
							: "MIDI ACCESS UNAVAILABLE.",
				});
		}
	}

	/** Retain the chosen output while it remains connected. */
	refresh = () => {
		const outputs: MIDIOutput[] = [];
		this.access?.outputs.forEach(collectConnected.bind(null, outputs));
		const selected = outputs.some(this.isSelected)
			? this.state.selected
			: (outputs[0]?.id ?? "");
		if (this.active && this.active.output.id !== selected) this.stop();
		this.setState({
			outputs,
			selected,
			message: outputs.length ? "" : "NO MIDI OUTPUTS AVAILABLE.",
		});
	};

	isSelected = (output: MIDIOutput) => output.id === this.state.selected;

	select = (event: ChangeEvent<HTMLSelectElement>) => {
		this.stop();
		this.setState({ selected: event.currentTarget.value });
	};

	/** Cancel the duration timer and release each sounding note. */
	stop = () => {
		window.clearTimeout(this.timer);
		const active = this.active;
		this.active = undefined;
		if (active?.output.state === "connected") {
			for (const pitch of active.notes) active.output.send([0x80, pitch, 0]);
		}
		if (this.mounted && this.state.playing) this.setState({ playing: false });
	};

	/** Send the same chord and duration used by the built-in audition. */
	play = () => {
		const output = this.access?.outputs.get(this.state.selected);
		if (!output) return;
		try {
			const { item, keyIndex, mode } = this.props;
			const notes = lookupVoicing(item, keyIndex, mode);
			const duration = item.beats * 600;
			this.active = { output, notes };
			output.send([0xb0, 7, this.level()]);
			for (const pitch of notes) output.send([0x90, pitch, 86]);
			this.timer = window.setTimeout(this.stop, duration);
			this.setState({ playing: true, message: "" });
		} catch {
			this.stop();
			this.setState({ message: "COULD NOT PLAY THROUGH THIS MIDI OUTPUT." });
		}
	};

	/** Show device availability and controls for the active MIDI output. */
	render() {
		return (
			<>
				<label>
					MIDI OUTPUT
					<select
						value={this.state.selected}
						onChange={this.select}
						disabled={!this.state.outputs.length}
					>
						{this.state.outputs.map(outputOption)}
					</select>
				</label>
				<button
					disabled={!this.state.selected}
					onClick={this.state.playing ? this.stop : this.play}
				>
					{this.state.playing ? "STOP" : "PLAY"}
				</button>
				{this.state.message && <p role="status">{this.state.message}</p>}
			</>
		);
	}
}

function collectConnected(outputs: MIDIOutput[], output: MIDIOutput) {
	if (output.state === "connected") outputs.push(output);
}

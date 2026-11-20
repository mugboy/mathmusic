import { Component, createRef } from "react";
import { renderAbc } from "abcjs";

export class ChordStaff extends Component<{ score: string; label: string }> {
	private target = createRef<HTMLDivElement>();

	componentDidMount() {
		this.draw();
	}

	componentDidUpdate(previous: Readonly<{ score: string }>) {
		if (previous.score !== this.props.score) this.draw();
	}

	/** Engrave one chord into a compact SVG staff with room for ledger lines. */
	draw() {
		if (!this.target.current) return;
		renderAbc(this.target.current, this.props.score, {
			staffwidth: 180,
			paddingtop: 8,
			paddingbottom: 8,
		});
	}

	render() {
		return <div ref={this.target} role="img" aria-label={this.props.label} />;
	}
}

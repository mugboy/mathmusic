import { chord, chordName, numeral } from "./music";
export interface Template {
	title: string;
	degrees: string;
	/** Non-root positions keyed by zero-based chord index, using the editor's position values. */
	positions?: Partial<Record<number, number>>;
}
export const library: Template[] = [
	{
		title: "Classic Cadence",
		degrees: "51"
	},
	{
		title: "Sixth Cadence",
		degrees: "56"
	},
	{
		title: "Ending Cadence",
		degrees: "151",
		positions: {0: 2}
	},
	{
		title: "Bridge between Inversions",
		degrees: "171",
		positions: {1: 1, 2: 1}
		
	}
];
function fromDegree(template: Template, value: string, index: number) {
	return chord(Number(value) - 1, template.positions?.[index]);
}
export function materialize(template: Template) {
	return Array.from(template.degrees, fromDegree.bind(null, template));
}
export function formula(template: Template) {
	return materialize(template).map(numeral).join(" – ");
}
export function spelled(template: Template, key: number, mode: number) {
	return materialize(template)
		.map(renderName.bind(null, key, mode))
		.join(" – ");
}
function renderName(key: number, mode: number, item: ReturnType<typeof chord>) {
	return chordName(item, key, mode);
}

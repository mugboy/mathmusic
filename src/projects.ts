import type { Chord } from "./music";

export interface Project {
	items: Chord[];
	keyIndex: number;
	mode: number;
	tempo: string;
}

const prefix = "mathmusic.project.v1.";

/** List named progressions saved by this application on this origin. */
export function projectNames() {
	const names: string[] = [];
	for (let index = 0; index < localStorage.length; index++) {
		const key = localStorage.key(index);
		if (key?.startsWith(prefix)) names.push(key.slice(prefix.length));
	}
	return names.sort();
}

export function saveProject(name: string, project: Project) {
	localStorage.setItem(prefix + name, JSON.stringify(project));
}

/** Move a saved project under a new name without replacing an existing entry. */
export function renameProject(name: string, requestedName: string) {
	const target = requestedName.trim();
	if (!target) throw new Error("ENTER A PROJECT NAME.");
	const data = localStorage.getItem(prefix + name);
	if (data === null) throw new Error("PROJECT NO LONGER EXISTS.");
	if (target === name) return name;
	if (localStorage.getItem(prefix + target) !== null)
		throw new Error("A PROJECT ALREADY USES THAT NAME.");
	localStorage.setItem(prefix + target, data);
	localStorage.removeItem(prefix + name);
	return target;
}

export function deleteProject(name: string) {
	localStorage.removeItem(prefix + name);
}

function validChord(item: Chord) {
	return (
		item &&
		Number.isInteger(item.degree) &&
		item.degree >= 0 &&
		item.degree < 7 &&
		Number.isInteger(item.position) &&
		item.position >= 0 &&
		item.position < 7 &&
		[1, 2, 3, 4, 6, 8].includes(item.beats)
	);
}

/** Reject missing or malformed saves before replacing the open progression. */
export function loadProject(name: string): Project {
	const data = JSON.parse(localStorage.getItem(prefix + name) ?? "null");
	if (
		!data ||
		!Array.isArray(data.items) ||
		!data.items.length ||
		!data.items.every(validChord) ||
		!Number.isInteger(data.keyIndex) ||
		data.keyIndex < 0 ||
		data.keyIndex > 11 ||
		![0, 1].includes(data.mode) ||
		typeof data.tempo !== "string" ||
		!Number.isInteger(Number(data.tempo)) ||
		Number(data.tempo) < 40 ||
		Number(data.tempo) > 240
	)
		throw new Error("THIS SAVED PROGRESSION COULD NOT BE LOADED.");
	return {
		items: data.items,
		keyIndex: data.keyIndex,
		mode: data.mode,
		tempo: data.tempo,
	};
}

import * as Gdk from '../../native/gdk.js';
import type { Save } from '../save.js';

const textures = new Map<string, Gdk.Texture | null>();

function load({ screenshot }: Save): Gdk.Texture | null {
	if (!screenshot) return null;
	if (typeof screenshot == 'string') return Gdk.Texture.newFromFilename(screenshot);
	const { width, height, data } = screenshot();
	return new Gdk.MemoryTexture(width, height, Gdk.MemoryFormat.r8g8b8a8, data, width * 4);
}

/** The save's screenshot, or null if it has none or it can't be read. */
export function screenshotTexture(save: Save): Gdk.Texture | null {
	if (!textures.has(save.id)) {
		try {
			textures.set(save.id, load(save));
		} catch {
			textures.set(save.id, null);
		}
	}
	return textures.get(save.id)!;
}

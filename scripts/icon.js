// Builds the Windows icon from the SVG, with the sizes Windows shows in the Start Menu, taskbar and Settings.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const svg = join(root, 'data/dev.jamespre.Multiverse.svg');
const build = join(root, 'build/icon');

rmSync(build, { recursive: true, force: true });
mkdirSync(build, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 256];
const images = sizes.map(size => {
	const image = join(build, `${size}.png`);
	execFileSync('rsvg-convert', ['--width', String(size), '--height', String(size), '--output', image, svg]);
	return image;
});

execFileSync('icotool', ['--create', '--output', join(root, 'data/dev.jamespre.Multiverse.ico'), ...images]);

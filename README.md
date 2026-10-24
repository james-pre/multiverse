# Save Timeline

View game saves as branching timelines. Each playthrough is a tree, with saves as nodes placed by play time, and the tree splits wherever you loaded an older save and played on from it.

Supported games:

- Cyberpunk 2077 (Steam).
- The Elder Scrolls V: Skyrim Special Edition (Steam), including co-saves from the Skyrim Script Extender.
- Diplomacy is Not an Option (Steam).
- InfraSpace (Steam).

## Installation

Save Timeline needs GTK 4 and libadwaita. Either download `save-timeline-linux-x64` from the [latest release](https://github.com/james-pre/save-timeline/releases/latest), which includes Node.js, or install it with npm 12 or newer and Node.js 26 or newer:

```sh
sudo npm i -g @james-pre/save-timeline --allow-scripts=@james-pre/save-timeline
```

npm only runs the install script, which adds a desktop entry and icon so Save Timeline shows up in your launcher, if `--allow-scripts` covers the package. To install from a local clone, allow it by its path instead (e.g. `--allow-scripts=$PWD`), since npm only matches package names for packages from the registry.

`save-timeline install` and `save-timeline uninstall` manage the desktop entry yourself, for example with `--data-directory ~/.local/share`. The downloaded executable copies the entry, pointing it at wherever the executable is, instead of linking it.

## Usage

```sh
save-timeline                    # open the viewer, starting with a game picker
save-timeline --game cyberpunk   # open a game's timelines directly
save-timeline tree               # print the timelines of every game with saves
save-timeline inspect <save>     # show what is in a save file (Skyrim)
```

Saves are found through Steam, including every library in `libraryfolders.vdf` and Proton prefixes on Linux. Both commands take `--game <id>` with `--directory <path>` for saves somewhere else. `inspect` takes the sections to show (by default all of them, e.g. `header plugins globals changes`), and `--decompressed <path>` writes the save's data without compression for other tools.

In the viewer, scroll to zoom, drag to pan, and click a save to select it. The card at the bottom shows the hovered or selected save, with buttons to make an automatic or quick save manual, open its folder, or move it to the trash. Right-clicking a save shows the same actions. The viewer reloads when saves change on disk.

## How branches are inferred

Most games don't record which "parent" save a save was loaded from, so the tree is inferred from each save's play time, wall-clock time and progress markers (e.g. finished quests). A candidate ancestor must have less play time, a subset of the progress, and enough wall-clock time before the save to account for the play time in between. Among those candidates the parent is the one with the most play time among saves from the same session, where wall-clock and play time differ by at most `sessionGap`, otherwise it's the one with the most play time overall (which is the save most likely loaded).

## Development

```sh
npm install
npm run build:native # generate and compile the GTK bindings into native/
npm run build
node dist/main.js
```

`build:native` needs CMake, a C++23 compiler, and the GTK 4 and libadwaita development packages. It must run before `build` or `lint`, and again after updating `girbind-devel`.

The viewer uses GTK 4 and libadwaita on Node through [girbind](https://github.com/james-pre/girbind). GLib events run from Node's event loop, so the app calls `register()` and `activate()` instead of the blocking `run()`, and holds a `keepAlive()` handle until the window closes.

UI text is in `locales/`, using [`@james-pre/locales`](https://www.npmjs.com/package/@james-pre/locales). `build` and `lint` generate the types for its keys into `src/.locale.ts`.

`npm run build:sea` builds `build/save-timeline-linux-x64` with [xsea](https://github.com/james-pre/xsea).

Releases are published to npm by CI, with the bindings prebuilt on Fedora, and the executable is attached to the GitHub release.

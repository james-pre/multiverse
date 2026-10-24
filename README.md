# Multiverse

View game saves as branching timelines. Each playthrough is a tree, with saves as nodes placed by play time, and the tree splits wherever you loaded an older save and played on from it.

Supported games:

- Cyberpunk 2077 (Steam).
- The Elder Scrolls V: Skyrim Special Edition (Steam), including co-saves from the Skyrim Script Extender.
- Diplomacy is Not an Option (Steam).
- InfraSpace (Steam).
- Plague Inc: Evolved (Steam).

## Installation

Multiverse needs GTK 4 and libadwaita. Either download `multiverse-linux-x64` from the [latest release](https://github.com/james-pre/multiverse/releases/latest), which includes Node.js, or install it with npm 12 or newer and Node.js 26 or newer:

```sh
sudo npm i -g @james-pre/multiverse --allow-scripts=@james-pre/multiverse
```

npm only runs the install script, which adds Multiverse to your launcher, if `--allow-scripts` covers the package. On Linux it adds a desktop entry and icon. On Windows, where npm installs for the current user without `sudo`, it adds a Start Menu shortcut and lists Multiverse in Settings' installed apps, where uninstalling it also uninstalls the npm package. To install from a local clone, allow it by its path instead (e.g. `--allow-scripts=$PWD`), since npm only matches package names for packages from the registry.

`multiverse install` and `multiverse uninstall` manage the launcher entry yourself, for example with `--data-directory ~/.local/share`. The downloaded executable copies the entry, pointing it at wherever the executable is, instead of linking it.

## Usage

```sh
multiverse                    # open the viewer, starting with a game picker
multiverse --game cyberpunk   # open a game's timelines directly
multiverse tree               # print the timelines of every game with saves
multiverse inspect <save>     # show what is in a save file
```

Saves are found through Steam, including every library in `libraryfolders.vdf` and Proton prefixes on Linux. Both commands take `--game <id>` with `--directory <path>` for saves somewhere else. `inspect` recognizes the game from the file, and takes the sections to show (by default all of them, e.g. `header plugins globals changes` for Skyrim). An unknown section lists the ones the game has. For Skyrim, `--decompressed <path>` writes the save's data without compression for other tools.

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

`npm run build:sea` builds `build/multiverse-linux-x64` with [xsea](https://github.com/james-pre/xsea).

Releases are published to npm by CI, with the bindings prebuilt on Fedora, and the executable is attached to the GitHub release.

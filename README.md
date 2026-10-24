# Multiverse

View game saves as branching timelines. Each playthrough is a tree, with saves as nodes placed by play time, and the tree splits wherever you loaded an older save and played on from it.

Supported games (Steam):

- Cyberpunk 2077
- The Elder Scrolls V: Skyrim Special Edition, including co-saves from the Skyrim Script Extender
- Diplomacy is Not an Option
- InfraSpace
- Plague Inc: Evolved
- Schedule I
- Subnautica

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
multiverse archive            # copy saves of games that save over them into the archive
multiverse config set autoArchive true
```

Saves are found through Steam, including every library in `libraryfolders.vdf` and Proton prefixes on Linux. Both commands take `--game <id>` with `--directory <path>` for saves somewhere else. `inspect` recognizes the game from the file, and takes the sections to show (by default all of them, e.g. `header plugins globals changes` for Skyrim). An unknown section lists the ones the game has. For Skyrim, `--decompressed <path>` writes the save's data without compression for other tools.

In the viewer, scroll to zoom, drag to pan, and click a save to select it. The card at the bottom shows the hovered or selected save, with buttons to make an automatic or quick save manual, open its folder, or move it to the trash. Right-clicking a save shows the same actions. The viewer reloads when saves change on disk.

## Archive

Some games save over their saves instead of making new ones: Schedule I has a fixed number of slots, and Subnautica saves each playthrough over its slot. For these games, Multiverse can keep copies of saves in its archive (`~/.local/share/multiverse/archive` on Linux, `%LOCALAPPDATA%\Multiverse\archive` on Windows), so a save the game writes over isn't lost.

Archive a save with its card's Archive button, or turn on Archive Saves Automatically in Preferences (or `multiverse config set autoArchive true`) to copy each save as the game writes it while Multiverse is running. `multiverse archive --watch` does the same from a terminal. Archived saves join the timeline, drawn hollow while they aren't in the game.

The card's In game switch puts an archived save back into the game's save folder, or takes one out of it. A save is always archived before Multiverse removes it from the game. In games with fixed slots each slot is its own tab, and putting a save in the game replaces the save in its slot. Archived saves from a slot that's now empty get tabs of their own. In other games, a save goes back in its own slot, or a new one if its slot holds a different save.

## Editing

The inspector can change values in saves of every game except Subnautica. Values that are unlikely to break a save can be changed right away, like Cyberpunk 2077's unspent attribute and perk points, money in Schedule I, resources in Diplomacy is Not an Option and InfraSpace, and DNA points in Plague Inc. Turn on Expert Mode in an inspector window to change any other value it shows, in the overview or the contents.

Save Copy writes the changes to a new save beside the original, which the game lists as another save, and keeps writing to that copy while the window is open. Overwrite Original replaces the save instead, archiving it first for games with an archive. Edited saves can be corrupted or break the game in ways that only show up later, so keep the original until the copy works.

From a terminal, `multiverse inspect <save> --set 'money/Bank balance=1000'` changes rows by their section and labels, which `inspect` marks as editable, and writes a copy. `--expert` allows changing any editable row, and `--in-place` overwrites the save.

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

To make a game's saves editable, give the `Row`s and `Entry`s its inspection shows an `edit` (see `src/editing.ts`), marking it `safe` if the value can be changed outside of expert mode, then add `write` to the inspection and `copy` to the inspector. Inspections don't parse values again to write them, so:

- JSON saves read their files with `JsonDocument`, whose `edit` changes a value's text and leaves the rest of the file as it was.
- Binary saves record where values of fixed-size types are with `Locations` while parsing, change them in the data with `binaryEdit`, and write the data back, compressing it again if it was.
- Saves read through views of their data, like Skyrim's structs, use `propertyEdit`.

`copy` uses `copySave` with the game's name for the copy, such as the next free slot.

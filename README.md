# Save Timeline

View game saves as branching timelines. Each playthrough is a tree, with saves as nodes placed by play time, and the tree splits wherever you loaded an older save and played on from it.

Supported games:

- Cyberpunk 2077 (Steam).

## Usage

```sh
npm install
npm run build:native # generate and compile the GTK bindings into native/
npm run build
npx save-timeline tree # print the inferred timelines
npx save-timeline # open the viewer
```

Both commands take `--game <id>` and `--directory <path>` for saves outside the default location.

## How branches are inferred

Most games don't record which "parent" save a save was loaded from, so the tree is inferred from each save's play time, wall-clock time and progress markers (e.g. finished quests). A candidate ancestor must have less play time, a subset of the progress, and enough wall-clock time before the save to account for the play time in between. Among those candidates the parent is the one with the most play time among saves from the same session, where wall-clock and play time differ by at most `sessionGap`, otherwise it's the one with the most play time overall (which is the save most likely loaded).

## GUI

The viewer uses GTK4 and libadwaita on Node through [girbind](https://github.com/james-pre/girbind). The libraries are listed in `girbindDependencies` in `package.json`, and `npm run build:native` must run before `build` or `lint`. Rerun it after updating `girbind-devel`.

GLib events run from Node's event loop, so the app calls `register()` and `activate()` instead of the blocking `run()`, and holds a `keepAlive()` handle until the window closes.

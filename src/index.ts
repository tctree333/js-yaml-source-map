import type { State } from "js-yaml";

// maps path in object to position information
interface PathMap {
  [path: string]: {
    line: number;
    position: number;
    lineStart: number;
  };
}

interface Fragment {
  path: string;
  line: number;
  position: number;
  lineStart: number;
  children?: Fragment[];
}

interface SourceLocation {
  line: number;
  column: number;
  position: number;
}

class SourceMap {
  private _map: PathMap;
  private _path: string[];
  private _lastScalar: string;
  private _fragments: Fragment[];
  private _count: number;

  constructor() {
    this._map = {};
    this._path = [];
    this._lastScalar = "";
    this._fragments = [];
    this._count = 0;
  }

  public get map(): PathMap {
    return this._map;
  }

  // recursively pushes information to the path map
  private resolveNode(fragment: Fragment, path: string): void {
    // if the path is already in the map, we don't override it
    if (!this._map[path]) {
      const { line, position, lineStart } = fragment;
      this._map[path] = { line, position, lineStart };
    }
    // if there are children, we recursively resolve them
    if (fragment.children && fragment.children.length > 0) {
      fragment.children.forEach((child) => {
        this.resolveNode(child, path + "." + child.path);
      });
    }
  }

  // loops through fragments and removes children of the path
  private iterFragments(
    pathName: string,
    callback: (fragment: Fragment) => void
  ): void {
    for (let i = this._fragments.length - 1; i >= 0; i--) {
      // skip the parent and fragments not in the path
      if (
        !this._fragments[i].path.startsWith(pathName) ||
        this._fragments[i].path === pathName
      ) {
        continue;
      }
      const fragment = this._fragments.pop() as Fragment;
      callback(fragment);
    }
  }

  private handleState(event: "open" | "close", state: State): void {
    // the listener function emits an "open" and "close" event for each "node".
    // "open" events tell us that we are going one level deeper, while "close"
    // events actually give us the correct data about the node. we receive each
    // scalar value (primitve) as well as the constructed objects (map, seq, etc)
    //
    // to generate sourcemaps, we listen to "open" and "close" events to determine
    // our depth in the document. we also keep track of all the scalar values we
    // encounter, which includes both keys and values. since we can't determine
    // whether a scalar is a key or a value, or the location in a sequence, we
    // edit past fragments to the correct path when constructed objects are finally
    // emitted.

    if (event === "close") {
      const result = state.result as unknown;
      const kind = state.kind;
      const pathName = this._path.join(".");

      // scalar typse are primitives (non maps/arrays)
      if (kind === "scalar") {
        // we need to pop the path before computing things for scalars
        this._path.pop();

        // save the scalar for later, since it's not junk
        this._lastScalar = `${result as string}`;

        const { line, position, lineStart } = state;
        if (this._path.length === 0) {
          // a path of length 0 is the root, store this to the path map
          this._map["." + (result as string)] = {
            line,
            position,
            lineStart,
          };
        } else {
          // a path of length > 1 is a child of the root, store this as a fragment
          this._fragments.push({
            path: this._path.join(".") + "." + (result as string),
            line,
            position,
            lineStart,
          });
        }
      } else if (kind === "mapping") {
        const newFragment: Fragment = {
          path: pathName,
          children: [],
          line: 0,
          position: 0,
          lineStart: 0,
        };
        // the fragments currently do not distinguish between keys and values, so we
        // need to use the index to determine which is which.
        //
        // we're just counting, so the index doesn't correspond to anything
        // and we can count up, even though we're looping backwards.
        let index = 0;
        this.iterFragments(pathName, (fragment) => {
          // always keep non-primitive fragments
          if (!fragment.children || fragment.children.length === 0) {
            // some fragments might be values, not keys.
            // keys will have an even index since we loop backwards, start at 0, and increment before checking.
            index++;
            if (index % 2 === 1) {
              // discard odd indices, they're values
              return;
            }
          }

          if (this._path.length === 1) {
            // if we're at the root, write to path map
            this.resolveNode(fragment, fragment.path);
          } else {
            // otherwise create a new fragment with correct children
            (newFragment.children as Fragment[]).push({
              ...fragment,
              path: fragment.path.slice(pathName.length + 1),
            });

            newFragment.line = fragment.line;
            newFragment.position = fragment.position;
            newFragment.lineStart = fragment.lineStart;
          }
        });
        this._fragments.push(newFragment);

        this._path.pop();
      } else if (kind === "sequence") {
        // fragment paths are junk for sequences so we don't use them.

        const newFragment: Fragment = {
          path: pathName,
          children: [],
          line: 0,
          position: 0,
          lineStart: 0,
        };
        // discard duplicates based on position
        const seen = new Set<number>();

        // since we don't have keys and can have duplicate values in a sequence,
        // we need to determine the correct order. by assuming that we're traversing
        // the document in order, we can find the order.
        //
        // we're actually looping backwards, so we count down from the end
        let index = (result as any[]).length;
        this.iterFragments(pathName, (fragment) => {
          if (seen.has(fragment.position)) {
            return;
          }
          index--;
          seen.add(fragment.position);

          if (this._path.length === 1) {
            // if we're at the root, write to path map
            this.resolveNode(fragment, `${pathName}.${index}`);
          } else {
            // otherwise create a new fragment with correct children
            (newFragment.children as Fragment[]).push({
              ...fragment,
              path: index.toString(),
            });

            newFragment.line = fragment.line;
            newFragment.position = fragment.position;
            newFragment.lineStart = fragment.lineStart;
          }
        });
        this._fragments.push(newFragment);

        this._path.pop();
      } else {
        // kind is undefined, pop the path to stay in sync
        this._path.pop();
      }
    }

    if (event === "open") {
      if (this._count === 0) {
        // save the root document
        const { line, position, lineStart } = state;
        this._map["."] = { line, position, lineStart };
      }

      // open events might have junk data, so we push the last found scalar
      this._path.push(this._lastScalar);

      this._count++;
    }
  }

  public listen() {
    // since js-yaml calls `state.listener` internally, we bind to this
    // so `this` refers to the class instance, not `state``
    return this.handleState.bind(this);
  }

  public lookup(path: string | string[]): SourceLocation | undefined {
    let pathName =
      path instanceof Array ? path.map((f) => `${f}`).join(".") : `${path}`;
    if (!pathName.startsWith(".")) {
      // add leading dot if not present
      pathName = "." + pathName;
    }
    if (pathName.startsWith("..")) {
      // fix double leading dots if present
      pathName = pathName.slice(1);
    }
    // convert bracket notation to dot notation
    pathName = pathName.replace(/\[/g, ".").replace(/\]/g, "");

    const pathInfo = this._map[pathName];
    if (!pathInfo) {
      return;
    }

    return {
      line: pathInfo.line + 1,
      column: pathInfo.position - pathInfo.lineStart + 1,
      position: pathInfo.position,
    };
  }
}

export default SourceMap;

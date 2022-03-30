# js-yaml sourcemaps

A library for finding YAML source locations after parsing by [js-yaml](https://github.com/nodeca/js-yaml).

## Installation

```
npm install js-yaml-source-map js-yaml
```

## Usage

```yaml
---
# file: example.yaml
fruits:
  - apple
  - banana
  - orange
people:
  - name: Eric
    age: 26
  - name: Lily
    age: 22
states:
  CA: California
  NY: New York
    capital: Albany
  TX: Texas
```

```js
import fs from "fs";
import yaml from "js-yaml";
import SourceMap from "js-yaml-source-map";

const data = fs.readFileSync("./example.yaml", "utf8");

const map = new SourceMap();
// pass map.listen() to the listener option
const loaded = yaml.load(data, { listener: map.listen() });

console.log(loaded); // { fruits: [ 'apple', 'banana', 'orange' ], ... }

// different syntaxes supported
console.log(map.lookup("fruits")); // { line: 4, column: 10, position: 42 }
console.log(map.lookup("people.0.age")); // { line: 9, column: 8, position: 95 }
console.log(map.lookup(".people[1].name")); // { line: 10, column: 9, position: 108}
console.log(map.lookup(["states", "NY", "capital"])); // { line: 16, column: 12, position: 188 }
```

If you're using CommonJS, you'll need to access the `default` key:

```js
const SourceMap = require("js-yaml-source-map").default;

const map = new SourceMap();

//...
```

## API Reference

### `SourceMap`

**Constructor:** `new SourceMap()`

**Properties:**

- `SourceMap().map`: `PathMap`

**Methods:**

- `SourceMap().listen(): (event: "open" | "close", state: State) => void`
- `SourceMap().lookup(path: string | string[]): SourceLocation | undefined`

### Types

```ts
PathMap {
    [path: string]: {
        line: number;
        position: number;
        lineStart: number;
    };
}

SourceLocation {
    line: number;
    column: number;
    position: number;
}
```

## Limitations

- This library does not work with multi-document sources and `yaml.loadAll()`. Using it with `yaml.loadAll()` will result in undefined behavior.
- Using `Date`s as keys is not properly supported. To use Dates as keys, you may need to switch to the `FAILSAFE_SCHEMA`.
- Using arrays or objects as keys will not work.

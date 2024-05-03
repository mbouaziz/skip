# SkState server

This is the server-side of `skstate`.

It connects to the SKDB database, watches requests to read files and handles them.
That's it!

## Install dependencies

```bash
npm install
```

## Build

```bash
tsc
```

## Run

```bash
cd .. && node skstate/dist/index.js
```


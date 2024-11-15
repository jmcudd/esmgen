# ESMGen
ESMGen is a self-hosted alternative to esm.sh, focusing on simplicity. It generates and organizes ECMAScript Modules from npm packages for static storage, allowing developers to self-host these ESM packages without external service dependencies.

## Features

- Download and convert Node.js packages from npm to ESM.
- Organize converted modules by package name and version.
- Serve ESM modules over a local HTTP server.
- Emphasizes self-hosting and static file generation for efficient and private module usage.


## Basic Usage

```
npx esmgen dl lodash 
```

Result:

```plaintext
esm/
└── lodash@4.17.21/
    ├── bundle.js
    └── ...
```

## Usage

ESMGen provides two primary commands: `download` and `serve`.

### Download and Convert Command

**Command:**

```bash
npx esmgen download [pkg] [version] [options]
```

**Aliases:**

- `dl`
- `d`

**Description:** Downloads a specified npm package, converts it to an ESM module, and organizes it in a directory structure that reflects its name and version for easy identification and use.

**Options:**

- `--registry <url>`: Specify the npm registry source (default: `https://registry.npmjs.org/`).
- `--dir <dir>`: Specify the directory to store the converted ESM modules (default: `./esm`).
- `--serve`: Serve the converted ESM modules over HTTP immediately after conversion.
- `--port <port>`: Set the port for the server (default: `3000`).
- `--host <host>`: Set the host address for binding the server (default: `127.0.0.1`).
- `--entry <entryFile>`: Specify a custom HTML entry file to be served as the root (used when serving).

**Example:**

```bash
npx esmgen download react 17.0.0 --serve --port 4001 --entry customIndex.html
```

### Serve Command

**Command:**

```bash
npx esmgen serve [options]
```

**Alias:** `s`

**Description:** Start an HTTP server to serve ESM modules from the specified directory.

**Options:**

- `--port <port>`: Specify the serve port (default: `3000`).
- `--host <host>`: Specify the host for binding (default: `127.0.0.1`).
- `--dir <dir>`: Specify the directory of ESM modules to serve (default: `./esm`).
- `--entry <entryFile>`: Specify a custom HTML entry file to serve as the root.

**Example:**

```bash
npx esmgen serve --port 4001 --entry customIndex.html
```

## Organization of ESM Modules

The converted ESM modules are organized in a folder structure based on the package name and version. This facilitates easy self-hosting and retrieval of specific module versions. Example folder structure after conversion might look like this:

```plaintext
esm/
└── react@17.0.0/
    ├── bundle.js
    └── ...
```

This organization makes it simple to manage multiple versions of modules and ensure compatibility across projects by selectively including the necessary files.

## Using the Converted Modules in a Browser

Once converted and optionally served, you can import these modules using modern web practices:

### Direct Import

If you're running an internal server via the `--serve` flag, import directly:

```html
<script type="module">
  import { something } from 'http://127.0.0.1:3000/react@17.0.0/bundle.js';

  console.log(something);
</script>
```

### Using Import Maps

Use import maps to define module paths for browser ease.

```html
<script type="importmap">
{
  "imports": {
    "react": "http://127.0.0.1:3000/react@17.0.0/bundle.js"
  }
}
</script>

<script type="module">
  import React from 'react';

  console.log(React);
</script>
```





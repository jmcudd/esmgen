# ESMGen

ESMGen is a self-hosted alternative to esm.sh, focusing on simplicity. It generates and organizes ECMAScript Modules from npm packages for static storage, allowing developers to self-host these ESM packages without external service dependencies.

## Features

- Download and convert Node.js packages from npm to ESM.
- Organize converted modules by package name and version.
- Serve ESM modules over a local HTTP server.
- Remove ESM packages and update dependencies in `package.json`.
- Emphasizes self-hosting and static file generation for efficient and private module usage.

## Commands Overview

This CLI tool offers commands to manage ESM modules efficiently:

### Add and Convert Command

**Command:**

```bash
npx esmgen add [pkg] [version] [options]
```

**Aliases:**

- `a`

**Description:** Downloads a specified npm package, converts it to an ESM module, organizes it in a directory structure by name and version, and optionally serves the package immediately.

**Options:**

- `--registry`: Registry to download the package from (default: `https://registry.npmjs.org/`).
- `--dir <dir>`: Directory for storing the converted ESM modules (default: `./esm`).
- `--serve`: Serve the converted ESM modules over HTTP immediately.
- `--port <port>`: Port for the local server (default: `3000`).
- `--host <host>`: Host address for binding the server (default: `127.0.0.1`).
- `--entry <entryFile>`: Specify a custom HTML entry file to serve as the root.
- `--include-all-assets`: Include all non-JS assets in the conversion.

**Example:**

```bash
npx esmgen add react 17.0.0 --serve --port 4001 --entry customIndex.html
```

### Serve Command

**Command:**

```bash
npx esmgen serve [options]
```

**Alias:** `s`

**Description:** Start an HTTP server to serve ESM modules from a specified directory.

**Options:**

- `--port <port>`: Specify the server's port (default: `3000`).
- `--host <host>`: Specify the server's host binding (default: `127.0.0.1`).
- `--dir <dir>`: Directory of ESM modules to serve (default: `./esm`).
- `--entry <entryFile>`: Specify a custom HTML entry file as the root input.

**Example:**

```bash
npx esmgen serve --port 4001 --entry customIndex.html
```

### Remove Command

**Command:**

```bash
npx esmgen remove <pkg>
```

**Aliases:**

- `rm`
- `r`

**Description:** Removes an ESM package from the local directory and updates `package.json`.

**Example:**

```bash
npx esmgen remove lodash
```

## Organization of ESM Modules

The converted ESM modules are organized in a folder structure based on the package name and version, facilitating easy self-hosting and retrieval of specific module versions. Example folder structure:

```plaintext
esm/
└── react@17.0.0/
    ├── bundle.js
    └── ...
```

This arrangement ensures compatibility across projects by allowing selective inclusion and facilitation of multiple module versions.

## Using the Converted Modules in a Browser

Once converted and optionally served, you can import these modules using standard browser import techniques:

### Direct Import

When running an internal server with the `--serve` flag:

```html
<script type="module">
  import { something } from 'http://127.0.0.1:3000/react@17.0.0/bundle.js';
  console.log(something);
</script>
```

### Using Import Maps

Define module paths for direct browser usage with import maps:

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

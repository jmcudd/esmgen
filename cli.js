#!/usr/bin/env node

const express = require("express");
const { Command } = require("commander");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const rollup = require("rollup");
const typescript = require("@rollup/plugin-typescript");
const commonjs = require("@rollup/plugin-commonjs");
const resolve = require("@rollup/plugin-node-resolve");
const tar = require("tar");
const os = require("os");

async function main() {
  const program = new Command();

  program.version("0.0.1");

  const defaultPort = 3000;
  const defaultHost = "127.0.0.1";
  const defaultDir = path.join(process.cwd(), "esm");
  const defaultRegistry = "https://registry.npmjs.org/";
  const esmgenReadmePath = path.join(__dirname, "README.md");

  program
    .command("download [pkg] [version]")
    .alias("dl")
    .alias("d")
    .description("Download and convert a package to ESM.")
    .option(
      "--registry",
      "Registry to download the package from",
      defaultRegistry
    )
    .option("--dir <dir>", "Directory for ESM modules", defaultDir)
    .option("--serve", "Serve the ESM directory after processing", false)
    .option("--port <port>", "Port to serve on", defaultPort)
    .option("--host <host>", "Host to bind the server to", defaultHost)
    .option("--entry <entryFile>", "Custom entry HTML file to serve")
    .action(async (pkg, version = "latest", options) => {
      if (!pkg) {
        console.error("Package name is required.");
        process.exit(1);
      }

      const CONVERTED_DIR = path.resolve(options.dir || defaultDir);
      console.log(`Processing ${pkg}@${version}`);
      console.log(`Converted output directory: ${CONVERTED_DIR}`);

      const esmDirectory = await processPackage(pkg, version, CONVERTED_DIR);

      if (options.serve) {
        serve(esmDirectory, options.port, options.host, options.entry);
      }
    });

  program
    .command("serve")
    .alias("s")
    .description("Serve the ESM directory.")
    .option("--port <port>", "Port to serve on", defaultPort)
    .option("--host <host>", "Host to bind the server to", defaultHost)
    .option("--dir <dir>", "Directory for ESM modules to serve", defaultDir)
    .option("--entry <entryFile>", "Custom entry HTML file to serve")
    .action((options) => {
      const CONVERTED_DIR = path.resolve(options.dir || defaultDir);
      console.log(`Serving from directory: ${CONVERTED_DIR}`);
      serve(CONVERTED_DIR, options.port, options.host, options.entry);
    });

  program.parse(process.argv);

  const tempDir = os.tmpdir();
  const DOWNLOAD_DIR = path.join(tempDir, "esmgen-downloads");

  function serve(dir, port, host, customEntryFile) {
    const app = express();

    function escapeHtml(unsafe) {
      return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    app.get("/", async (req, res) => {
      if (customEntryFile) {
        const customFilePath = path.join(process.cwd(), customEntryFile);
        if (fs.existsSync(customFilePath)) {
          return res.sendFile(customFilePath);
        } else {
          console.error(`${customFilePath} does not exist.`);
          return res.status(404).send(`<h1>${customEntryFile} not found</h1>`);
        }
      }

      try {
        const contents = fs.readdirSync(dir, { withFileTypes: true });
        const packageSnippets = contents
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            const packageName = entry.name;
            const scriptTag = `import "/${packageName}/bundle.js";`;
            const escapedScriptTag = escapeHtml(scriptTag);
            return `
            <li>
              ${packageName}:
              <pre style="display:inline;"><code>${escapedScriptTag}</code></pre>
              <button onclick="copyToClipboard('${escapedScriptTag}')">Copy</button>
            </li>
          `;
          })
          .join("");

        res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>ESM Packages</title>
          <style>
            pre {
              background-color: #f5f5f5;
              padding: 10px;
              border-radius: 5px;
              overflow-x: auto;
            }
            button {
              margin-top: 5px;
            }
          </style>
        </head>
        <body>
          <h1>Available ESM Packages</h1>
          <ul>
            ${packageSnippets}
          </ul>
          <script>
            function copyToClipboard(text) {
              navigator.clipboard.writeText(text).then(() => {
                console.log('Script copied to clipboard!');
              }).catch(err => {
                console.error('Could not copy text: ', err);
              });
            }
          </script>
        </body>
        </html>
      `);
      } catch (err) {
        res.send("<h1>Error reading ESM directory</h1>");
        console.error("Error reading directory:", err.message);
      }
    });

    app.use(express.static(dir));

    function attemptToListen(port) {
      const server = app.listen(port, host, () => {
        console.log(`Serving ${dir} on http://${host}:${port}`);
      });

      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(`Port ${port} is in use, trying a different port...`);
          attemptToListen(port + 1);
        } else {
          console.error(`Failed to start server: ${err.message}`);
        }
      });
    }

    attemptToListen(port);
  }

  async function fetchPackageMetadata(pkg, version = "latest") {
    const url = `https://registry.npmjs.org/${pkg}`;
    const response = await axios.get(url);
    const data = response.data;
    const targetVersion =
      version === "latest" ? data["dist-tags"][version] : version;
    const packageData = data.versions[targetVersion];

    if (!packageData) {
      throw new Error(`Version ${version} not found for package ${pkg}`);
    }

    return packageData;
  }

  async function downloadPackage(packageData, outputDir) {
    const tarballUrl = packageData.dist.tarball;
    const tarStream = await axios.get(tarballUrl, { responseType: "stream" });

    await new Promise((resolve, reject) => {
      tarStream.data
        .pipe(
          tar.x({
            cwd: outputDir,
            strip: 1,
          })
        )
        .on("finish", resolve)
        .on("error", reject);
    });
  }

  async function convertToESM(inputDir, outputDir) {
    const inputFilePath = findEntryFile(inputDir);

    const bundle = await rollup.rollup({
      input: inputFilePath,
      plugins: [
        // Using Conditionally only if file extension indicates
        inputFilePath.endsWith(".ts") ? typescript({ tsconfig: false }) : null,
        resolve(),
        commonjs(),
      ].filter(Boolean),
    });

    await bundle.write({
      file: path.join(outputDir, "bundle.js"),
      format: "esm",
    });

    console.log(`Converted to ESM at: ${path.join(outputDir, "bundle.js")}`);
    return outputDir;
  }

  function findEntryFile(inputDir) {
    const packageJsonPath = path.join(inputDir, "package.json");

    if (!fs.existsSync(packageJsonPath)) {
      throw new Error("package.json not found in the root directory");
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Prioritize dist directory files based on exports
    const exportFields = packageJson.exports;
    if (exportFields) {
      // Check for direct paths in exports, scrambled accordingly.
      const possiblePaths = [exportFields.default, exportFields.require].flat();

      for (const possiblePath of possiblePaths) {
        if (typeof possiblePath === "string") {
          const resolvedPath = path.join(inputDir, possiblePath);
          if (fs.existsSync(resolvedPath)) {
            return resolvedPath;
          }
        }
      }
    }

    // If no exports, look for built files in the dist directory.
    const distFiles = ["dist/index.js", "dist/index.cjs"];
    for (const file of distFiles) {
      const candidatePath = path.join(inputDir, file);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

    // Last resort, check source field or typical main alternatives.
    const sourceFile = packageJson.source || null;
    const mainFile = packageJson.main || null;
    const fileCandidates = [sourceFile, mainFile, "index.js", "index.ts"];

    for (const candidate of fileCandidates) {
      if (candidate) {
        const candidatePath = path.join(inputDir, candidate);
        if (fs.existsSync(candidatePath)) {
          return candidatePath;
        }
      }
    }

    // If none are found, report error.
    throw new Error(`
    None of the potential entry files specified under exports, or built files (${distFiles.join(", ")}),
    source or main were found in ${inputDir}
  `);
  }

  async function processPackage(pkg, version, conversionDir) {
    try {
      const data = await fetchPackageMetadata(pkg, version);

      ensureDirectoryExists(DOWNLOAD_DIR);
      ensureDirectoryExists(conversionDir);

      const downloadOutputDir = path.join(
        DOWNLOAD_DIR,
        `${pkg}@${data.version}`
      );
      const conversionOutputDir = path.join(
        conversionDir,
        `${pkg}@${data.version}`
      );

      fs.mkdirSync(downloadOutputDir, { recursive: true });

      console.log(`Downloading package: ${pkg}@${data.version}...`);
      await downloadPackage(data, downloadOutputDir);

      console.log(`Identifying extracted directory structure...`);
      const srcDir = await findExtractedRootDir(downloadOutputDir);

      console.log(`Converting to ESM modules...`);
      fs.mkdirSync(conversionOutputDir, { recursive: true });

      const esmOutputDirectory = await convertToESM(
        srcDir,
        conversionOutputDir
      );

      return esmOutputDirectory;
    } catch (error) {
      console.error("Error:", error.message);
    }
  }

  async function findExtractedRootDir(outputDir) {
    const files = fs.readdirSync(outputDir);

    if (files.includes("package.json")) {
      return outputDir;
    }

    for (const candidateDir of files) {
      const candidatePath = path.join(outputDir, candidateDir);
      if (
        fs.statSync(candidatePath).isDirectory() &&
        fs.existsSync(path.join(candidatePath, "package.json"))
      ) {
        return candidatePath;
      }
    }

    throw new Error(
      `Could not determine extracted package root in ${outputDir}`
    );
  }

  function ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Call the main function to execute the program logic.
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
const { terser } = require("@rollup/plugin-terser");
const tar = require("tar");
const os = require("os");

function getPackageVersion() {
  const packageJsonPath = path.join(__dirname, "package.json");
  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (packageJson.version) {
      return packageJson.version;
    }
  } catch (error) {
    console.error("Error reading package.json to determine version:", error);
  }
  return "Unknown"; // Default version if unsuccessful
}
async function main() {
  const program = new Command();

  program.version(getPackageVersion());

  const defaultPort = 3000;
  const defaultHost = "127.0.0.1";
  const defaultDir = path.join(process.cwd(), "esm");
  const defaultRegistry = "https://registry.npmjs.org/";

  program
    .command("add [pkg] [version]")
    .alias("a")
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
    .option(
      "--include-all-assets",
      "Include all assets from the package",
      false
    )
    .action(async (pkg, version = "latest", options) => {
      if (!pkg) {
        const esmPackages = getEsmPackages();

        if (!esmPackages || Object.keys(esmPackages).length === 0) {
          console.error(
            "No packages specified in the esm section of package.json and no package name provided."
          );
          return;
        }

        for (const [name, version] of Object.entries(esmPackages)) {
          await processAndOptionallyServe(name, version, options);
        }
      } else {
        await processAndOptionallyServe(pkg, version, options);
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
      const esmDir = path.resolve(options.dir || defaultDir);
      console.log(`Serving from directory: ${esmDir}`);
      serve(esmDir, options.port, options.host, options.entry);
    });

  program
    .command("remove <pkg>")
    .alias("rm")
    .alias("r")
    .description("Remove an ESM package and update package.json.")
    .action((pkg) => {
      const esmDirectory = path.resolve(defaultDir);
      const packageDirs = fs.readdirSync(esmDirectory);

      console.log(`Removing ${pkg}...`);
      const removed = updatePackageJson(pkg, "remove");

      for (const dir of packageDirs) {
        if (dir.startsWith(pkg + "@")) {
          const packageDir = path.join(esmDirectory, dir);
          if (fs.existsSync(packageDir)) {
            fs.rmSync(packageDir, { recursive: true, force: true });
            console.log(`Removed ${pkg} from ESM directory.`);
            return;
          }
        }
      }

      console.error(`Package ${pkg} is not installed.`);
    });

  program.parse(process.argv);

  const tempDir = os.tmpdir();
  const tmpDir = path.join(tempDir, "esmgen-downloads");

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

  async function convertToESM(inputDir, outputDir, includeAllAssets) {
    const inputFilePath = findEntryFile(inputDir);
    if (!inputFilePath) {
      console.warn(
        `No JavaScript entry file found in ${inputDir}. Skipping ESM conversion.`
      );
      return;
    }

    const entryDir = path.dirname(inputFilePath);

    const bundle = await rollup.rollup({
      input: inputFilePath,
      plugins: [
        inputFilePath.endsWith(".ts") ? typescript({ tsconfig: false }) : null,
        resolve(),
        commonjs(),
        terser(), // Add the terser plugin here
      ].filter(Boolean),
    });

    await bundle.write({
      file: path.join(outputDir, "bundle.js"),
      format: "esm",
    });

    console.log(`Converted to ESM at: ${path.join(outputDir, "bundle.js")}`);
    console.log("Minification complete!");
    // now call copyAssets with the flag
    copyAssets(inputDir, outputDir, entryDir, includeAllAssets);

    return outputDir;
  }

  function findEntryFile(inputDir) {
    const packageJsonPath = path.join(inputDir, "package.json");

    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    // Prioritize dist directory files based on exports
    const exportFields = packageJson.exports;
    if (exportFields) {
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

    const distFiles = ["dist/index.js", "dist/index.cjs"];
    for (const file of distFiles) {
      const candidatePath = path.join(inputDir, file);
      if (fs.existsSync(candidatePath)) {
        return candidatePath;
      }
    }

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

    return null;
  }

  async function processAndOptionallyServe(pkg, version, options) {
    const esmDir = path.resolve(options.dir || defaultDir);
    console.log(`Processing ${pkg}@${version}`);
    console.log(`Converted output directory: ${esmDir}`);

    const esmDirectory = await processPackage(pkg, version, esmDir, options);

    if (options.serve) {
      serve(esmDirectory, options.port, options.host, options.entry);
    }
  }

  async function processPackage(pkg, version, conversionDir, options) {
    try {
      const data = await fetchPackageMetadata(pkg, version);

      ensureDirectoryExists(tmpDir);
      ensureDirectoryExists(conversionDir);

      const downloadOutputDir = path.join(tmpDir, `${pkg}@${data.version}`);
      const conversionOutputDir = path.join(
        conversionDir,
        `${pkg}@${data.version}`
      );

      fs.mkdirSync(downloadOutputDir, { recursive: true });

      console.log(`Downloading package: ${pkg}@${data.version}...`);
      await downloadPackage(data, downloadOutputDir);

      console.log(`Identifying extracted directory structure...`);
      const srcDir = await findExtractedRootDir(downloadOutputDir);

      console.log(`Processing package assets...`);
      const entryFile = findEntryFile(srcDir);

      // Always copy assets if any
      fs.mkdirSync(conversionOutputDir, { recursive: true });
      if (entryFile) {
        console.log(
          `Converting to ESM modules from entry file ${entryFile}...`
        );
        await convertToESM(
          srcDir,
          conversionOutputDir,
          options.includeAllAssets
        );
      } else {
        console.log(`No entry file. Only assets will be copied if present.`);
        copyAssets(
          srcDir,
          conversionOutputDir,
          srcDir,
          options.includeAllAssets
        );
      }

      // Update package.json with the actual resolved version
      updatePackageJson(pkg, "add", data.version);

      return conversionOutputDir;
    } catch (error) {
      console.error("Error:", error.message);
      return null;
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

  function copyAssets(srcDir, destDir, entryDir, includeAllAssets = false) {
    const includedAssetsExtensions = [
      ".css",
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".svg",
    ];

    const files = fs.readdirSync(srcDir, { withFileTypes: true });
    const excludedAssets = [];

    files.forEach((file) => {
      const srcPath = path.join(srcDir, file.name);
      const destPath = path.join(destDir, file.name);

      if (includeAllAssets) {
        if (
          file.isDirectory() ||
          includedAssetsExtensions.includes(path.extname(file.name))
        ) {
          ensureDirectoryExists(destPath);
          if (file.isDirectory()) {
            copyAssets(srcPath, destPath, entryDir, true);
          } else {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Asset copied: ${srcPath} to ${destPath}`);
          }
        }
      } else {
        if (file.isDirectory()) {
          const pathFallsWithinEntry = srcPath.startsWith(entryDir);
          if (pathFallsWithinEntry) {
            ensureDirectoryExists(destPath);
            copyAssets(srcPath, destPath, entryDir, false);
          }
        } else if (includedAssetsExtensions.includes(path.extname(file.name))) {
          if (srcPath.startsWith(entryDir)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`Asset copied: ${srcPath} to ${destPath}`);
          } else {
            excludedAssets.push(srcPath);
          }
        }
      }
    });

    if (!includeAllAssets && excludedAssets.length > 0) {
      console.log("The following files/assets are not included:");
      excludedAssets.forEach((asset) => console.log(`- ${asset}`));
      console.log(
        "Use the --include-all-assets flag to include all assets from the entire npm package."
      );
    }
  }

  function getEsmPackages() {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    if (!fs.existsSync(packageJsonPath)) return {};

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    return packageJson.esm?.packages || {};
  }

  function updatePackageJson(pkg, action, version) {
    const packageJsonPath = path.join(process.cwd(), "package.json");
    let packageJson;

    if (fs.existsSync(packageJsonPath)) {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    } else {
      return;
    }

    if (!packageJson.esm) {
      packageJson.esm = { packages: {} };
    }

    if (action === "add") {
      packageJson.esm.packages[pkg] = version;
    } else if (action === "remove") {
      delete packageJson.esm.packages[pkg];
    }

    fs.writeFileSync(
      packageJsonPath,
      JSON.stringify(packageJson, null, 2),
      "utf-8"
    );
    console.log(`package.json successfully updated.`);
  }
}

// Call the main function to execute the program logic.
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

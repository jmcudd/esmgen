#!/usr/bin/env node

const express = require("express");
const { Command } = require("commander");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const rollup = require("rollup");
const commonjs = require("@rollup/plugin-commonjs");
const resolve = require("@rollup/plugin-node-resolve");
const tar = require("tar");
const os = require("os");

async function main() {
  const program = new Command();

  program.version("0.0.1");

  const defaultPort = 3000;
  const defaultHost = "127.0.0.1";
  const defaultDir = path.join(process.cwd(), "esm"); // Default directory in current directory
  const defaultRegistry = "https://registry.npmjs.org/";

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
        serve(esmDirectory, options.port, options.host);
      }
    });

  program
    .command("serve")
    .alias("s")
    .description("Serve the ESM directory")
    .option("--port <port>", "Port to serve on", defaultPort)
    .option("--host <host>", "Host to bind the server to", defaultHost)
    .option("--dir <dir>", "Directory ESM modules to serve", defaultDir)
    .action((options) => {
      const CONVERTED_DIR = path.resolve(options.dir || defaultDir);
      console.log(`Serving from directory: ${CONVERTED_DIR}`);
      serve(CONVERTED_DIR, options.port, options.host);
    });

  program.parse(process.argv);

  const tempDir = os.tmpdir();
  const DOWNLOAD_DIR = path.join(tempDir, "esmgen-downloads");

  function serve(dir, port, host) {
    const app = express();
    app.use(express.static(dir));

    function attemptToListen(port) {
      const server = app.listen(port, host, () => {
        console.log(`Serving ${dir} on http://${host}:${port}`);
      });

      // Handle error if the port is in use
      server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.error(`Port ${port} is in use, trying a different port...`);

          // Get a random available port by setting port to 0
          attemptToListen(port + 1);
        } else {
          console.error(`Failed to start server: ${err.message}`);
        }
      });
    }

    // Start listening on the initial specified port
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
      plugins: [resolve(), commonjs()],
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
    const entryFile = packageJson.main || "index.js";
    const entryFilePath = path.join(inputDir, entryFile);

    if (!fs.existsSync(entryFilePath)) {
      throw new Error(`Entry file ${entryFile} not found in ${inputDir}`);
    }
    return entryFilePath;
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

// Call the main function to execute the program logic
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

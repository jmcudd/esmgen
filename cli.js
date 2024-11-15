#!/usr/bin/env node

const { Command } = require("commander");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const tar = require("tar");
const babel = require("@babel/core");

async function main() {
  const program = new Command();

  program.version("0.0.1");

  program
    .argument("<pkg>", "package to download and convert")
    .argument("[version]", "version of the package", "latest")
    .action(async (pkg, version) => {
      console.log(`Processing ${pkg}@${version}`);
      await processPackage(pkg, version);
    });

  program.parse(process.argv);

  const DOWNLOAD_DIR = path.join(__dirname, "downloads");
  const CONVERTED_DIR = path.join(__dirname, "esm-modules");

  function ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
    const files = fs.readdirSync(inputDir);

    files.forEach((file) => {
      const filePath = path.join(inputDir, file);
      if (fs.statSync(filePath).isDirectory()) {
        // Recursively process directories
        const newOutputDir = path.join(outputDir, file);
        fs.mkdirSync(newOutputDir, { recursive: true });
        convertToESM(filePath, newOutputDir);
      } else if (filePath.endsWith(".js")) {
        const transformed = babel.transformFileSync(filePath, {
          presets: ["@babel/preset-env"],
          plugins: ["@babel/plugin-transform-modules-commonjs"],
        });
        const outputPath = path.join(outputDir, file);
        fs.writeFileSync(outputPath, transformed.code);
      }
    });
  }

  async function processPackage(pkg, version) {
    try {
      const data = await fetchPackageMetadata(pkg, version);

      ensureDirectoryExists(DOWNLOAD_DIR);
      ensureDirectoryExists(CONVERTED_DIR);

      const downloadOutputDir = path.join(
        DOWNLOAD_DIR,
        `${pkg}@${data.version}`
      );
      const conversionOutputDir = path.join(
        CONVERTED_DIR,
        `${pkg}@${data.version}`
      );

      fs.mkdirSync(downloadOutputDir, { recursive: true });

      console.log(`Downloading package: ${pkg}@${data.version}...`);
      await downloadPackage(data, downloadOutputDir);

      console.log(`Identifying extracted directory structure...`);
      const srcDir = await findExtractedRootDir(downloadOutputDir);

      console.log(`Converting to ESM modules...`);
      fs.mkdirSync(conversionOutputDir, { recursive: true });

      return convertToESM(srcDir, conversionOutputDir);
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
}

// Call the main function to execute the program logic
main().catch((error) => {
  console.error(error);
  process.exit(1);
});

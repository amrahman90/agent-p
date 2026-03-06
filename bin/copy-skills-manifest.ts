import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SOURCE_MANIFEST_PATH = "src/skills/skills.json";
const DIST_MANIFEST_PATH = "dist/src/skills/skills.json";

const sourcePath = join(process.cwd(), SOURCE_MANIFEST_PATH);
const distPath = join(process.cwd(), DIST_MANIFEST_PATH);

if (!existsSync(sourcePath)) {
  throw new Error(`Skills manifest not found at ${sourcePath}`);
}

mkdirSync(dirname(distPath), { recursive: true });
copyFileSync(sourcePath, distPath);

process.stdout.write(
  `Copied ${SOURCE_MANIFEST_PATH} to ${DIST_MANIFEST_PATH}\n`,
);

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ARCHITECTURE_FILES = [
  "docs/architecture/overview.md",
  "docs/architecture/foundation.md",
  "docs/architecture/agents.md",
  "docs/architecture/memory.md",
  "docs/architecture/search.md",
  "docs/architecture/skills.md",
  "docs/architecture/workflow.md",
  "docs/architecture/quality.md",
] as const;

const readArchitectureDoc = async (
  rootDir: string,
  relativePath: string,
): Promise<string> => {
  const absolutePath = resolve(rootDir, relativePath);
  await access(absolutePath, constants.R_OK);
  return readFile(absolutePath, "utf8");
};

const hasMarkdownHeading = (content: string): boolean =>
  /^#\s+.+/m.test(content);

const verifyArchitectureDocs = async (): Promise<void> => {
  const rootDir = process.cwd();
  const errors: string[] = [];

  for (const relativePath of REQUIRED_ARCHITECTURE_FILES) {
    try {
      const content = await readArchitectureDoc(rootDir, relativePath);
      if (content.trim().length === 0) {
        errors.push(`${relativePath}: file is empty`);
        continue;
      }

      if (!hasMarkdownHeading(content)) {
        errors.push(`${relativePath}: missing markdown heading`);
      }
    } catch {
      errors.push(`${relativePath}: missing or unreadable`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write("Documentation verification failed:\n");
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write("Documentation verification passed\n");
};

await verifyArchitectureDocs();

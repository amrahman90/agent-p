import { sep } from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolvePathWithinRoot,
  sanitizePathIdentifier,
} from "../../src/path-security.js";

const isWindows = process.platform === "win32";

describe("path-security", () => {
  describe("sanitizePathIdentifier", () => {
    it("should accept valid identifiers", () => {
      expect(sanitizePathIdentifier("valid-identifier")).toBe(
        "valid-identifier",
      );
      expect(sanitizePathIdentifier("file_name")).toBe("file_name");
      expect(sanitizePathIdentifier("path.to.file")).toBe("path.to.file");
      expect(sanitizePathIdentifier("a")).toBe("a");
      expect(sanitizePathIdentifier("File123")).toBe("File123");
    });

    it("should trim whitespace", () => {
      expect(sanitizePathIdentifier("  trimmed  ")).toBe("trimmed");
    });

    it("should reject empty strings", () => {
      expect(() => sanitizePathIdentifier("")).toThrow(
        "identifier must be a non-empty string",
      );
    });

    it("should reject whitespace-only strings", () => {
      expect(() => sanitizePathIdentifier("   ")).toThrow(
        "identifier must be a non-empty string",
      );
    });

    it("should reject null bytes", () => {
      expect(() => sanitizePathIdentifier("file\x00name")).toThrow(
        "identifier contains invalid null byte",
      );
    });

    it("should reject strings exceeding max length", () => {
      const longString = "a".repeat(200);
      expect(() =>
        sanitizePathIdentifier(longString, { maxLength: 128 }),
      ).toThrow("identifier exceeds max length of 128");
    });

    it("should reject dot and double-dot", () => {
      expect(() => sanitizePathIdentifier(".")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
      expect(() => sanitizePathIdentifier("..")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
    });

    it("should reject identifiers starting with special characters", () => {
      expect(() => sanitizePathIdentifier("-start")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
      expect(() => sanitizePathIdentifier("_start")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
      expect(() => sanitizePathIdentifier(".start")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
    });

    it("should reject identifiers with invalid characters", () => {
      expect(() => sanitizePathIdentifier("file name")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
      expect(() => sanitizePathIdentifier("file/name")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
      expect(() => sanitizePathIdentifier("file\\name")).toThrow(
        "identifier may only contain letters, numbers, '.', '-', '_'",
      );
    });

    it("should use custom label in error messages", () => {
      expect(() => sanitizePathIdentifier("", { label: "custom" })).toThrow(
        "custom must be a non-empty string",
      );
    });
  });

  describe("resolvePathWithinRoot", () => {
    const root = isWindows ? "C:\\workspace" : "/workspace";

    it("should resolve simple relative paths", () => {
      const result = resolvePathWithinRoot(root, "src", "index.ts");
      expect(result).toBe(`${root}${sep}src${sep}index.ts`);
    });

    it("should handle empty segments", () => {
      const result = resolvePathWithinRoot(root, "", "file.txt");
      expect(result).toBe(`${root}${sep}file.txt`);
    });

    it("should reject null bytes in root path", () => {
      expect(() => resolvePathWithinRoot("C:\\workspace\x00", "file")).toThrow(
        "root path contains invalid null byte",
      );
    });

    it("should reject null bytes in segments", () => {
      expect(() => resolvePathWithinRoot(root, "file\x00name")).toThrow(
        "path segment contains invalid null byte",
      );
    });

    it("should reject path traversal attempts", () => {
      expect(() => resolvePathWithinRoot(root, "..", "etc", "passwd")).toThrow(
        "resolved path escapes configured root",
      );

      expect(() =>
        resolvePathWithinRoot(`${root}${sep}src`, "..", "..", "secrets"),
      ).toThrow("resolved path escapes configured root");
    });

    it("should allow paths within root", () => {
      const result = resolvePathWithinRoot(root, "subdir");
      expect(result).toBe(`${root}${sep}subdir`);
    });

    it("should handle root as exact match", () => {
      const result = resolvePathWithinRoot(root);
      expect(result).toBe(root);
    });
  });
});

const verifyBetterSqlite = async (): Promise<void> => {
  try {
    await import("better-sqlite3");
    process.stdout.write("[build-sqlite] better-sqlite3 is available\n");
  } catch {
    process.stdout.write(
      "[build-sqlite] better-sqlite3 is unavailable, runtime will fall back to sql.js\n",
    );
  }
};

void verifyBetterSqlite();

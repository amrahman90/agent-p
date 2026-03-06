declare module "sql.js" {
  interface Statement {
    bind(params?: unknown[]): void;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  interface Database {
    run(sql: string, params?: unknown[]): void;
    prepare(sql: string): Statement;
    exec(sql: string): void;
    export(): Uint8Array;
    close(): void;
  }

  interface SqlJsStatic {
    Database: new (buffer?: Uint8Array | Buffer) => Database;
  }

  export default function initSqlJs(options?: unknown): Promise<SqlJsStatic>;
}

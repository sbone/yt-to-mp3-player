declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }

  export default class Database {
    constructor(filename: string);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
  }
}

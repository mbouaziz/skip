export const schema = {
    readFile: [
        ["path", "TEXT", "NOT NULL"],
        ["offset", "INTEGER", "NOT NULL"],
        ["progress", "INTEGER", "NOT NULL"],
        ["value", "TEXT"]
    ],
} as const;

export type Schema = typeof schema;
export const schema = {
    readFile: [
        ["path", "TEXT", "NOT NULL"],
        ["offset", "TEXT", "NOT NULL"],
        ["progress", "INTEGER", "NOT NULL"],
        ["value", "TEXT"]
    ],
} as const;

export type Schema = typeof schema;
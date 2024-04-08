export const schema = {
    readFileRequest: [
        ["path", "TEXT", "NOT NULL"],
        ["status", "TEXT", "NOT NULL"]
    ],
    readFile: [
        ["path", "TEXT", "NOT NULL"],
        ["magic", "TEXT", "NOT NULL"],
        ["bottom_addr", "TEXT", "NOT NULL"],
    ],
} as const;

export type Schema = typeof schema;
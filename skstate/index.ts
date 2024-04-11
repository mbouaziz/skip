
import { connectAndMirror } from "typed-skdb";
import fsPromises from "node:fs/promises";

const skdb = await connectAndMirror({
    database: "mappings",
    schema: {
        readFile: [
            ["path", "TEXT", "NOT NULL"],
            ["offset", "INTEGER", "NOT NULL"],
            ["progress", "INTEGER", "NOT NULL"],
            ["value", "TEXT"]
        ]
    }
});

console.log("CONNECTED");

async function onNewReadFileRequest(path: string, offset: number): Promise<void> {
    console.log(`New request: ${path} @ ${offset}`);
    try {
        const existingResult = await skdb.execSelectCount("readFile", "path = @path AND offset = @offset AND progress > 0", { path, offset });
        if (existingResult > 0) {
            console.log(`Abandoning ${path} @ ${offset}`);
            return;
        }
        await skdb.execInsert("readFile", { path, offset, progress: 1, value: null });
        const fh = await fsPromises.open(path, "r");
        const buffer = new BigUint64Array(1);
        const { bytesRead } = await fh.read(buffer, 0, 8, offset);
        await fh.close();
        console.log(`Read ${bytesRead} bytes`);
        const r = (bytesRead < 8) ?
            { progress: 2, value: `Read ${bytesRead} bytes instead of 8` } :
            { progress: 3, value: buffer[0].toString() };
        await skdb.execInsertOrUpdateWithKey("readFile", { path, offset }, r);
    } catch (error) {
        console.error(error);
        await skdb.execInsertOrUpdateWithKey("readFile", { path, offset }, { progress: 2, value: `${error}` });
    }
}
async function onNewReadFileRequests(added: { path: string, offset: number }[], _removed?: any): Promise<void> {
    await Promise.all(added.map(({ path, offset }) => onNewReadFileRequest(path, offset)));
}
const watchReadFile = skdb.watchSelectChanges(
    "readFile", ["path", "offset"], "progress = 0", {}, onNewReadFileRequests, onNewReadFileRequests
)
await Promise.all([watchReadFile]);


import { connectAndMirror } from "typed-skdb";
import fsPromises from "node:fs/promises";

const skdb = await connectAndMirror({
    database: "mappings",
    schema: {
        readWord: [
            ["path", "TEXT", "NOT NULL"],
            ["offset", "INTEGER", "NOT NULL"],
            ["progress", "INTEGER", "NOT NULL"],
            ["value", "TEXT"]
        ],
        readCString: [
            ["path", "TEXT", "NOT NULL"],
            ["offset", "INTEGER", "NOT NULL"],
            ["progress", "INTEGER", "NOT NULL"],
            ["value", "TEXT"]
        ]
    }
});

console.log("CONNECTED");

async function onNewReadWordRequest(path: string, offset: number): Promise<void> {
    console.log(`New request: ${path} @ ${offset}`);
    try {
        const existingResult = await skdb.execSelectCount("readWord", "path = @path AND offset = @offset AND progress > 0", { path, offset });
        if (existingResult > 0) {
            await skdb.execDelete("readWord", "path = @path AND offset = @offset AND progress = 0", { path, offset });
            console.log(`Abandoning ${path} @ ${offset}`);
            return;
        }
        await skdb.execInsert("readWord", { path, offset, progress: 1, value: null });
        const fh = await fsPromises.open(path, "r");
        const buffer = new BigUint64Array(1);
        const { bytesRead } = await fh.read(buffer, 0, 8, offset);
        await fh.close();
        console.log(`Read ${bytesRead} bytes`);
        const r = (bytesRead < 8) ?
            { progress: 2, value: `Read ${bytesRead} bytes instead of 8` } :
            { progress: 3, value: buffer[0].toString() };
        await skdb.execInsertOrUpdateWithKey("readWord", { path, offset }, r);
    } catch (error) {
        console.error(error);
        await skdb.execInsertOrUpdateWithKey("readWord", { path, offset }, { progress: 2, value: `${error}` });
    }
}
async function onNewReadWordRequests(added: { path: string, offset: number }[], _removed?: any): Promise<void> {
    await Promise.all(added.map(({ path, offset }) => onNewReadWordRequest(path, offset)));
}
const watchReadWord = skdb.watchSelectChanges(
    "readWord", ["path", "offset"], "progress = 0", {}, onNewReadWordRequests, onNewReadWordRequests
)
await Promise.all([watchReadWord]);

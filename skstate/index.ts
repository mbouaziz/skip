
import { connectAndMirror } from "typed-skdb";
import fsPromises from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

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

async function readCString(fh: FileHandle, offset: number): Promise<string> {
    const CHUNK_SIZE = 1024 * 1024;
    const chunks = [];
    let curOffset = offset;
    let totalLength = 0;
    let bytesRead = 0;
    for (; ; offset += bytesRead) {
        const chunk = Buffer.allocUnsafe(CHUNK_SIZE);
        let { bytesRead } = await fh.read(chunk, 0, CHUNK_SIZE, curOffset);
        let posOfZero = 0;
        for (; posOfZero < bytesRead; posOfZero++) {
            if (chunk[posOfZero] === 0) {
                break;
            }
        }
        chunks.push(chunk.subarray(0, posOfZero));
        totalLength += posOfZero;
        if (bytesRead === 0 || posOfZero < bytesRead) {
            break;
        }
    }
    return Buffer.concat(chunks, totalLength).toString();
}

async function onNewReadWordRequest(path: string, offset: number): Promise<void> {
    console.log(`New word request: ${path} @ ${offset}`);
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
async function onNewReadCStringRequest(path: string, offset: number): Promise<void> {
    console.log(`New CString request: ${path} @ ${offset}`);
    try {
        const existingResult = await skdb.execSelectCount("readCString", "path = @path AND offset = @offset AND progress > 0", { path, offset });
        if (existingResult > 0) {
            await skdb.execDelete("readCString", "path = @path AND offset = @offset AND progress = 0", { path, offset });
            console.log(`Abandoning ${path} @ ${offset}`);
            return;
        }
        await skdb.execInsert("readCString", { path, offset, progress: 1, value: null });
        const fh = await fsPromises.open(path, "r");
        const value = await readCString(fh, offset);;
        await fh.close();
        console.log(`Read ${value.length} bytes`);
        await skdb.execInsertOrUpdateWithKey("readCString", { path, offset }, { progress: 3, value });
    } catch (error) {
        console.error(error);
        await skdb.execInsertOrUpdateWithKey("readCString", { path, offset }, { progress: 2, value: `${error}` });
    }
}
async function onNewReadWordRequests(added: { path: string, offset: number }[], _removed?: any): Promise<void> {
    await Promise.all(added.map(({ path, offset }) => onNewReadWordRequest(path, offset)));
}
async function onNewReadCStringRequests(added: { path: string, offset: number }[], _removed?: any): Promise<void> {
    await Promise.all(added.map(({ path, offset }) => onNewReadCStringRequest(path, offset)));
}
const watchReadWord = skdb.watchSelectChanges(
    "readWord",
    ["path", "offset"],
    "progress = 0",
    {},
    onNewReadWordRequests,
    onNewReadWordRequests,
);
const watchReadCString = skdb.watchSelectChanges(
    "readCString",
    ["path", "offset"],
    "progress = 0",
    {},
    onNewReadCStringRequests,
    onNewReadCStringRequests,
);
await Promise.all([watchReadWord, watchReadCString]);

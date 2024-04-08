
import { connectAndMirror } from "typed-skdb";
import fs from "node:fs";
import * as util from "node:util";

const skdb = await connectAndMirror({
    database: "mappings",
    schema: {
        readFileRequest: [
            ["path", "TEXT", "NOT NULL"],
            ["status", "TEXT", "NOT NULL"]
        ],
        readFile: [
            ["path", "TEXT", "NOT NULL"],
            ["magic", "TEXT", "NOT NULL"],
            ["bottom_addr", "TEXT", "NOT NULL"]
        ]
    }
});

console.log("CONNECTED");

function uint64ToString(bi: bigint): string {
    const s = bi.toString(16);
    return "0x" + "0000000000000000".slice(s.length) + s;
}

async function onNewReadFileRequest(path: string): Promise<void> {
    console.log(`New request: ${path}`);
    try {
        await skdb.update("readFileRequest", { status: "processing" }, "path = @path AND status = 'new'", { path });
        const fd = await util.promisify(fs.open)(path, "r");
        console.log(`Opened ${path}: ${fd}`);
        const buffer = new BigUint64Array(2);
        const { bytesRead } = await util.promisify(fs.read)(fd, buffer, 0, 16, 0);
        console.log(`Read ${bytesRead} bytes`);
        const [biMagic, biBottomAddr] = buffer;
        console.log(`Updated 1. Will update 2 with magic ${biMagic} (${Number(biMagic)}) and length ${biBottomAddr} (${Number(biBottomAddr)})`);
        await skdb.insertOrUpdateWithKey("readFile", { path }, { magic: uint64ToString(biMagic), bottom_addr: uint64ToString(biBottomAddr) });
        console.log(`Updated 2`);
        await skdb.delete("readFileRequest", "path = @path", { path });
    } catch (error) {
        console.error(error);
        const status = `Error: ${error}`;
        await skdb.update("readFileRequest", { status }, "path = @path", { path });
    }
}
async function onNewReadFileRequests(added: { path: string }[], _removed?: any): Promise<void> {
    await Promise.all(added.map(({ path }) => onNewReadFileRequest(path)));
}
const watchReadFile = skdb.watchSelectChanges(
    "readFileRequest", ["path"], "status = 'new'", {}, onNewReadFileRequests, onNewReadFileRequests
)
await Promise.all([watchReadFile]);

import { useEffect, useState } from "react";
import "./App.css";
// import {schema} from "./schema.ts";
import type { Schema } from "./schema.ts";
import type { ConnectedDB, WithSKDB } from "typed-skdb";

const DEFAULT_BOTTOM_ADDR = 0x0000001000000000n;

function h(bi: bigint): string {
  const s = bi.toString(16);
  return "0x" + "0000000000000000".slice(s.length) + s;
}

type obi = bigint | undefined;
type oRow = { progress: number; value: string | null } | undefined;

function loadingH(obi: obi): string {
  return obi === undefined ? "Loading..." : h(obi);
}

function useRawWordMay(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: bigint,
): oRow {
  return skdb.useSelectMaybeSingle(
    "readFile",
    ["progress", "value"],
    "path = @path AND offset = @offset",
    { path, offset: offset.toString() },
    undefined,
    { order: [["progress", "DESC"]], limit: 1 },
  );
}

function obiOfoRow(oRow: oRow): obi {
  return oRow === undefined || oRow.progress < 3 || oRow.value === null
    ? undefined
    : BigInt(oRow.value);
}

function useWordMay(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: bigint,
): obi {
  return obiOfoRow(useRawWordMay(skdb, path, offset));
}

function useWordMust(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: bigint,
): obi {
  const oRow = useRawWordMay(skdb, path, offset);
  const oProgress = oRow?.progress;
  useEffect(() => {
    async function insert() {
      return await skdb.insert("readFile", {
        path,
        offset: offset.toString(),
        progress: 0,
        value: null,
      });
    }
    if (oProgress === undefined) {
      insert();
    }
  }, [skdb, path, offset, oProgress]);
  return obiOfoRow(oRow);
}

type vobi = { value: obi };

function Magic({ value }: vobi) {
  return (
    <tr>
      <td>Magic</td>
      <td>{loadingH(value)}</td>
    </tr>
  );
}

function BottomAddr({ value }: vobi) {
  const extra =
    value === undefined ? (
      ""
    ) : value === DEFAULT_BOTTOM_ADDR ? (
      <span title="Uses default bottom address">✓</span>
    ) : (
      <span
        title={`Unusual bottom address, default is ${h(DEFAULT_BOTTOM_ADDR)}`}
      >
        ⚠
      </span>
    );
  return (
    <tr>
      <td>Bottom address</td>
      <td>
        {loadingH(value)}&nbsp;{extra}
      </td>
    </tr>
  );
}

function Mapping({ skdb, path }: WithSKDB<Schema, { path: string }>) {
  const magic = useWordMust(skdb, path, 0n);
  const bottom_addr = useWordMust(skdb, path, 8n);

  return (
    <>
      <Magic value={magic} />
      <BottomAddr value={bottom_addr} />
    </>
  );
}

function App({ skdb }: WithSKDB<Schema>) {
  const [mappingFileInput, setMappingFileInput] = useState("");
  const [selectedMappingFile, setSelectedMappingFile] = useState("");

  const data =
    selectedMappingFile === "" ? (
      <></>
    ) : (
      <Mapping skdb={skdb} path={selectedMappingFile} />
    );

  return (
    <div className="app">
      <input
        type="text"
        value={mappingFileInput}
        onChange={(e) => setMappingFileInput(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            setSelectedMappingFile(mappingFileInput);
          }
        }}
      />
      <table>
        <thead>
          <tr>
            <th />
            <th>{selectedMappingFile}</th>
          </tr>
        </thead>
        <tbody className="app-data">{data}</tbody>
      </table>
    </div>
  );
}

export default App;

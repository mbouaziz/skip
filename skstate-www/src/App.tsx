import { useState } from "react";
import "./App.css";
// import {schema} from "./schema.ts";
import type { Schema } from "./schema.ts";
import { type WithSKDB } from "typed-skdb";

function ReadFileRequestStatus({
  skdb,
  path,
}: WithSKDB<Schema, { path: string }>) {
  const status = skdb.useSelectMaybeScalar(
    "readFileRequest",
    "status",
    "path = @path",
    { path },
  );
  return <>(Status: {status ?? "Done"})</>;
}

function Mapping({ skdb, path }: WithSKDB<Schema, { path: string }>) {
  const header = skdb.useSelectMaybeSingle(
    "readFile",
    ["magic", "bottom_addr"],
    "path = @path",
    { path },
  );
  if (path === "") {
    return "";
  }
  if (header === undefined) {
    return (
      <tr>
        <td />
        <td>Loading...</td>
      </tr>
    );
  }
  const { magic, bottom_addr } = header;
  return (
    <>
      <tr>
        <td>Magic</td>
        <td>{magic}</td>
      </tr>
      <tr>
        <td>Bottom address</td>
        <td>{bottom_addr}</td>
      </tr>
    </>
  );
}

function App({ skdb }: WithSKDB<Schema>) {
  const [mappingFileInput, setMappingFileInput] = useState("");
  const [selectedMappingFile, setSelectedMappingFile] = useState("");

  return (
    <div className="app">
      <input
        type="text"
        value={mappingFileInput}
        onChange={(e) => setMappingFileInput(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            await skdb.insert("readFileRequest", {
              path: mappingFileInput,
              status: "new",
            });
            setSelectedMappingFile(mappingFileInput);
          }
        }}
      />
      <ReadFileRequestStatus skdb={skdb} path={selectedMappingFile} />
      <table>
        <thead>
          <tr>
            <th />
            <th>{selectedMappingFile}</th>
          </tr>
        </thead>
        <tbody className="app-data">
          <Mapping skdb={skdb} path={selectedMappingFile} />
        </tbody>
      </table>
    </div>
  );
}

export default App;

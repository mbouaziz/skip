import { useEffect, useState } from "react";
import "./App.css";
// import {schema} from "./schema.ts";
import type { Schema } from "./schema.ts";
import type { ConnectedDB, WithSKDB } from "typed-skdb";

const DEFAULT_BOTTOM_ADDR = 0x0000001000000000n;

type read_bi = { bi: bigint };
type read_value = { processing: boolean } | { error: string } | read_bi;
type val = WithSKDB<
  Schema,
  {
    path: string;
    offset: number;
    processing?: boolean;
  }
> &
  read_value;
type bival = val & read_bi;
type RowExtraProps = {
  name: string;
  bi_extra?: (v: bival) => React.ReactElement;
};

function hi(i: number): string {
  const s = i.toString(16);
  return "0x" + "00000000".slice(s.length) + s;
}

function hbi(bi: bigint): string {
  const s = bi.toString(16);
  return "0x" + "0000000000000000".slice(s.length) + s;
}

async function requestReadWord(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: number,
  nb: number = 1,
) {
  return await skdb.execInsert(
    "readFile",
    Array.from({ length: nb }, (_, i) => ({
      path,
      offset: offset + i * 8,
      progress: 0,
      value: null,
    })),
  );
}

function LoadLink(
  props: WithSKDB<Schema, { path: string; offset: number; n?: number }>,
) {
  const n = props.n ?? 1;
  return (
    <a
      href="#"
      onClick={async (e) => {
        e.preventDefault();
        requestReadWord(props.skdb, props.path, props.offset, n);
      }}
    >
      Load{n > 1 ? " all" : ""}
    </a>
  );
}

function PP(val: val) {
  if ("bi" in val) {
    return hbi(val.bi);
  } else if ("error" in val) {
    return val.error;
  } else if (val.processing === true) {
    return "Loading...";
  } else {
    return <LoadLink {...val} />;
  }
}

function useWordMay(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: number,
): val {
  const oRow = skdb.useSelectMaybeSingle(
    "readFile",
    ["progress", "value"],
    "path = @path AND offset = @offset",
    { path, offset },
    undefined,
    { order: [["progress", "DESC"]], limit: 1 },
  );
  const x =
    oRow === undefined
      ? { processing: false }
      : oRow.progress <= 1
      ? { processing: true }
      : oRow.progress === 2
      ? { error: oRow.value ?? "" }
      : oRow.progress === 3
      ? oRow.value === null
        ? { error: "Unexpected NULL" }
        : { bi: BigInt(oRow.value) }
      : { error: `Unexpected progress ${oRow.progress}` };
  return { skdb, path, offset, ...x };
}

function useWordMust(
  skdb: ConnectedDB<Schema>,
  path: string,
  offset: number,
): val {
  const val = useWordMay(skdb, path, offset);
  const requireRequest = "processing" in val && val.processing === false;
  useEffect(() => {
    if (requireRequest) {
      requestReadWord(skdb, path, offset);
    }
  }, [skdb, path, offset, requireRequest]);
  return { ...val, processing: true };
}

function Row(props: val & RowExtraProps) {
  const BIExtra = props.bi_extra;
  const extra =
    BIExtra === undefined || !("bi" in props) ? (
      <></>
    ) : (
      <>
        &nbsp;
        <BIExtra {...props} />
      </>
    );
  return (
    <tr>
      <td>{hi(props.offset)}</td>
      <td>{props.name}</td>
      <td>
        <PP {...props} />
        {extra}
      </td>
    </tr>
  );
}

function UseRowMay(
  props: WithSKDB<Schema, { path: string; offset: number } & RowExtraProps>,
) {
  const { skdb, path, offset } = props;
  const val = useWordMay(skdb, path, offset);
  return <Row {...props} {...val} />;
}

function LoadAllRow(
  props: WithSKDB<
    Schema,
    { path: string; offset: number; n: number; name: string }
  >,
) {
  const { skdb, path, offset, n } = props;
  const allLoaded = skdb.use(
    skdb.selectCount(
      "readFile",
      "path = @path AND offset >= @start AND offset <= @end AND progress = 3",
      { path, start: offset, end: offset + n * 8 },
    ),
    0,
  );
  if (allLoaded) {
    return <></>;
  } else {
    return (
      <tr>
        <td>{hi(props.offset)}</td>
        <td>{props.name}</td>
        <td>
          <LoadLink {...props} />
        </td>
      </tr>
    );
  }
}

function BottomAddrExtra({ bi }: bival) {
  return bi === DEFAULT_BOTTOM_ADDR ? (
    <span title="Uses default bottom address">✓</span>
  ) : (
    <span
      title={`Unusual bottom address, default is ${hbi(DEFAULT_BOTTOM_ADDR)}`}
    >
      ⚠
    </span>
  );
}

function FTableElement(
  props: WithSKDB<Schema, { path: string; offset: number; index: number }>,
) {
  const { skdb, path, offset, index } = props;
  const ptr = useWordMay(skdb, path, offset);
  return <Row name={`ftable[${index}]`} {...ptr} />;
}

function Ginfo(props: WithSKDB<Schema, { path: string; offset: number }>) {
  const ftable = [];
  for (let i = 0; i < 64; i++) {
    const offset = props.offset + i * 8;
    ftable.push(
      <FTableElement key={offset} {...props} offset={offset} index={i} />,
    );
  }
  return (
    <>
      <LoadAllRow name="Free table" {...props} n={64} />
      {ftable}
    </>
  );
}

function ReadOfHeader(
  props: WithSKDB<Schema, { path: string; offset: number }>,
) {
  const { offset } = props;

  return (
    <>
      <UseRowMay name="gmutex_attr" {...props} />
      <Ginfo {...props} offset={offset + 40} />
    </>
  );
}

function Mapping(props: WithSKDB<Schema, { path: string }>) {
  const { skdb, path } = props;
  const magic = useWordMust(skdb, path, 0);
  const bottom_addr = useWordMust(skdb, path, 8);

  return (
    <>
      <Row name="magic" {...magic} />
      <Row name="bottom_addr" {...bottom_addr} bi_extra={BottomAddrExtra} />
      {"bi" in magic ? <ReadOfHeader {...props} offset={16} /> : <></>}
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
            <th></th>
            <th></th>
            <th>{selectedMappingFile}</th>
          </tr>
        </thead>
        <tbody className="app-data">{data}</tbody>
      </table>
    </div>
  );
}

export default App;

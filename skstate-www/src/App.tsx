import { useEffect, useState } from "react";
import "./App.css";
// import {schema} from "./schema.ts";
import type { Schema } from "./schema.ts";
import type { WithSKDB } from "typed-skdb";

const DEFAULT_BOTTOM_ADDR = 0x0000001000000000n;

type SKDBPath = WithSKDB<Schema, { path: string }>;
type SKDBPathOffset = SKDBPath & { offset: number };
type read_bi = { bi: bigint };
type read_value = { processing: boolean } | { error: string } | read_bi;
type val = SKDBPathOffset & { processing?: boolean } & read_value;
type bival = val & read_bi;
type RowExtraProps = {
  name: string;
  extra?: (v: bival) => React.ReactElement | string;
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
  args: SKDBPathOffset,
  n_or_missingOffsets?: number | number[],
) {
  const { skdb, path, offset } = args;
  const offsets = Array.isArray(n_or_missingOffsets)
    ? n_or_missingOffsets
    : typeof n_or_missingOffsets === "number"
    ? Array.from({ length: n_or_missingOffsets }, (_, i) => offset + 8 * i)
    : [offset];
  return await skdb.execInsert(
    "readFile",
    offsets.map((offset: number) => ({
      path,
      offset,
      progress: 0,
      value: null,
    })),
  );
}

function LoadLink(
  props: SKDBPathOffset & { n?: number; missingOffsets?: number[] },
) {
  const n = props.n ?? 1;
  const suffix = props.missingOffsets !== undefined || n > 1 ? " all" : "";
  return (
    <a
      href="#"
      onClick={async (e) => {
        e.preventDefault();
        requestReadWord(props, props.missingOffsets || n);
      }}
    >
      Load{suffix}
    </a>
  );
}

const sizeUnitPrefix = ["", "kilo", "mega", "giga", "tera", "peta"];

function PPSize({ bi }: bival) {
  let o = 0;
  let n: number;
  if (bi >= 0x400n) {
    let i = bi;
    o++;
    while (i >= 0x100000n && o < sizeUnitPrefix.length - 1) {
      i /= 0x400n;
      o++;
    }
    n = Number(i) / 0x400;
  } else {
    n = Number(bi);
  }
  return (
    <span title={bi.toLocaleString(undefined, { style: "unit", unit: "byte" })}>
      {n.toLocaleString(undefined, {
        style: "unit",
        unit: sizeUnitPrefix[o] + "byte",
        maximumSignificantDigits: 4,
      })}
    </span>
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

function valOfRow(
  args: SKDBPathOffset,
  oRow: { progress: number; value: string | null; offset?: number } | undefined,
): val {
  const { skdb, path } = args;
  const offset = oRow?.offset ?? args.offset;
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

function useWordsMay(args: SKDBPathOffset, n: number): val[] {
  const { skdb, path, offset } = args;
  const start = offset;
  const end = offset + 8 * (n - 1);
  const rows = skdb.useSelect(
    "readFile",
    ["offset", "progress", "value"],
    "path = @path AND offset >= @start AND offset <= @end",
    { path, start, end },
    [],
    { group: ["offset"], order: [["offset", "ASC"]] },
  );
  return rows.map((row) => valOfRow(args, row));
}

function useWordMay(
  ...a: [args: SKDBPathOffset] | [args: SKDBPath, offset: number]
): val {
  const args = a.length === 1 ? a[0] : { ...a[0], offset: a[1] };
  const { skdb, path, offset } = args;
  return valOfRow(
    args,
    skdb.useSelectMaybeSingle(
      "readFile",
      ["progress", "value"],
      "path = @path AND offset = @offset",
      { path, offset },
      undefined,
      { order: [["progress", "DESC"]], limit: 1 },
    ),
  );
}

function useWordMust(
  ...a: [args: SKDBPathOffset] | [args: SKDBPath, offset: number]
): val {
  const args = a.length === 1 ? a[0] : { ...a[0], offset: a[1] };
  const val = useWordMay(args);
  const { skdb, path, offset } = args;
  const requireRequest = "processing" in val && val.processing === false;
  useEffect(() => {
    if (requireRequest) {
      requestReadWord({ skdb, path, offset });
    }
  }, [skdb, path, offset, requireRequest]);
  return { ...val, processing: true };
}

function Row(props: val & RowExtraProps & { offsetFrom?: number }) {
  const Extra = props.extra;
  const extra =
    Extra === undefined || !("bi" in props) ? (
      <></>
    ) : (
      <>
        &nbsp;
        <Extra {...props} />
      </>
    );
  const off =
    props.offsetFrom !== undefined && props.offsetFrom !== props.offset
      ? hi(props.offsetFrom) + ".." + hi(props.offset)
      : hi(props.offset);
  return (
    <tr>
      <td>{off}</td>
      <td>{props.name}</td>
      <td>
        <PP {...props} />
        {extra}
      </td>
    </tr>
  );
}

function UseRowMay(props: SKDBPathOffset & RowExtraProps) {
  const val = useWordMay(props);
  return <Row {...props} {...val} />;
}

// function LoadAllRow(props: SKDBPathOffset & { n: number; name: string }) {
//   const { skdb, path, offset, n } = props;
//   const allLoaded = skdb.use(
//     skdb.selectCount(
//       "readFile",
//       "path = @path AND offset >= @start AND offset <= @end AND progress = 3",
//       { path, start: offset, end: offset + n * 8 },
//     ),
//     0,
//   );
//   if (allLoaded) {
//     return <></>;
//   } else {
//     return (
//       <tr>
//         <td>{hi(props.offset)}</td>
//         <td>{props.name}</td>
//         <td>
//           <LoadLink {...props} />
//         </td>
//       </tr>
//     );
//   }
// }

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

function FreeTable(props: SKDBPathOffset) {
  const foldConsecutiveZeroes = true;
  const slots = useWordsMay(props, 64);
  const ftable: JSX.Element[] = [];
  let index = 0;
  const missingOffsets: number[] = [];
  let lastEmptyOffset = props.offset;
  const addMissing = (toOffset: number) => {
    for (; lastEmptyOffset < toOffset; lastEmptyOffset += 8) {
      missingOffsets.push(lastEmptyOffset);
      ftable.push(
        <Row
          name={`ftable[${index}]`}
          key={index}
          {...props}
          offset={lastEmptyOffset}
          processing={false}
        />,
      );
      index++;
    }
  };
  let consecutiveZeroes = 0;
  slots.forEach((cur, i) => {
    addMissing(cur.offset);
    if (!("bi" in cur) && cur.processing !== true) {
      missingOffsets.push(cur.offset);
    }
    const next = slots[i + 1];
    if (
      foldConsecutiveZeroes &&
      "bi" in cur &&
      cur.bi === 0n &&
      next !== undefined &&
      next.offset == cur.offset + 8 &&
      "bi" in next &&
      next.bi === 0n
    ) {
      consecutiveZeroes++;
    } else {
      const name =
        consecutiveZeroes > 0
          ? `ftable[${index - consecutiveZeroes}..${index}]`
          : `ftable[${index}]`;
      const offsetFrom = cur.offset - consecutiveZeroes * 8;
      ftable.push(
        <Row
          name={name}
          key={index}
          {...props}
          {...cur}
          offsetFrom={offsetFrom}
        />,
      );
      consecutiveZeroes = 0;
    }
    index++;
    lastEmptyOffset = cur.offset + 8;
  });
  addMissing(props.offset + 8 * 64);
  const loadAll =
    missingOffsets.length === 0 ? (
      <></>
    ) : (
      <tr>
        <td>{hi(props.offset)}</td>
        <td>Free table</td>
        <td>
          <LoadLink {...props} missingOffsets={missingOffsets} />
        </td>
      </tr>
    );
  return (
    <>
      {loadAll}
      {ftable}
    </>
  );
}

function Context(props: SKDBPathOffset) {
  return <UseRowMay name="context" {...props} />;
}

function Ginfo(props: SKDBPathOffset) {
  let { offset } = props;
  const children = [];

  children.push(<FreeTable {...props} offset={offset} />);
  offset += 8 * 64;

  children.push(<Context {...props} offset={offset} />);
  offset += 8;

  children.push(<UseRowMay name="head" {...props} offset={offset} />);
  offset += 8;

  children.push(<UseRowMay name="end" {...props} offset={offset} />);
  offset += 8;

  children.push(<UseRowMay name="fileName" {...props} offset={offset} />);
  offset += 8;

  children.push(<UseRowMay name="break_ptr" {...props} offset={offset} />);
  offset += 8;

  children.push(
    <UseRowMay
      name="total_palloc_size"
      {...props}
      offset={offset}
      extra={PPSize}
    />,
  );
  offset += 8;

  return <>{children}</>;
}

function RestOfFile(props: SKDBPathOffset) {
  let { offset } = props;
  const children = [];

  children.push(<UseRowMay name="gmutex_attr" {...props} offset={offset} />);
  offset += 8;

  /* gmutex  */
  offset += 40;

  children.push(<Ginfo {...props} offset={offset} />);
  offset += 8 * (64 + 6);

  children.push(<UseRowMay name="gid" {...props} offset={offset} />);
  offset += 8;

  children.push(
    <UseRowMay name="capacity" {...props} offset={offset} extra={PPSize} />,
  );
  offset += 8;

  return <>{children}</>;
}

function Mapping(props: WithSKDB<Schema, { path: string }>) {
  let offset = 0;
  const children = [];

  const magic = useWordMust(props, offset);
  children.push(<Row name="magic" {...magic} />);
  offset += 8;

  const bottom_addr = useWordMust(props, offset);
  children.push(
    <Row name="bottom_addr" {...bottom_addr} extra={BottomAddrExtra} />,
  );
  offset += 8;

  if ("bi" in magic) {
    children.push(<RestOfFile {...props} offset={offset} />);
  }

  return <>{children}</>;
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
        name="path"
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

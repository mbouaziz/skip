import { Map } from "immutable";
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
// import {schema} from "./schema.ts";
import type { Schema } from "./schema.ts";
import type { WithSKDB } from "typed-skdb";

const DEFAULT_BOTTOM_ADDR = 0x0000001000000000n;

type ElementOrString = JSX.Element | string;

type Named = { name: string };
type SetAt = {
  bottom_addr: bigint;
  setAt: (addr: bigint, elt: ElementOrString) => void;
};
type SKDBPath = WithSKDB<Schema, { path: string }>;
type SKDBPathOffset = SKDBPath & { offset: number };
type SKDBPathOffsetSet = SKDBPathOffset & SetAt;
type v<T> = { v: T };
type nonv = { processing: boolean } | { error: string };
type read_value<T> = nonv | v<T>;
type val<T> = SKDBPathOffset & { processing?: boolean } & read_value<T>;
type vval<T> = val<T> & v<T>;
type PossiblyPtrTo =
  | { PtrTo?: undefined }
  | ({
      PtrTo: (props: SKDBPathOffsetSet & Named) => ElementOrString;
    } & SetAt);
type RowExtraProps<T> = {
  extra?: (v: vval<T>) => ElementOrString;
} & PossiblyPtrTo;
type rowval<T> = val<T> & RowExtraProps<T>;

type biv = v<bigint>;
type bival = val<bigint>;
type bivval = vval<bigint>;
type BIRowExtraProps = RowExtraProps<bigint>;
type birowval = rowval<bigint>;

type sval = val<string>;
type csrowval = rowval<string>;

function hi(i: number): string {
  const s = i.toString(16);
  return "0x" + "00000000".slice(s.length) + s;
}

function hbi(v: bigint): string {
  const s = v.toString(16);
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
    "readWord",
    offsets.map((offset: number) => ({
      path,
      offset,
      progress: 0,
      value: null,
    })),
  );
}

async function requestReadCString(args: SKDBPathOffset) {
  const { skdb, path, offset } = args;
  const offsets = [offset];
  return await skdb.execInsert(
    "readCString",
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

function PPSize({ v }: v<bigint>) {
  let o = 0;
  let n: number;
  if (v >= 0x400n) {
    let i = v;
    o++;
    while (i >= 0x100000n && o < sizeUnitPrefix.length - 1) {
      i /= 0x400n;
      o++;
    }
    n = Number(i) / 0x400;
  } else {
    n = Number(v);
  }
  return (
    <span title={v.toLocaleString(undefined, { style: "unit", unit: "byte" })}>
      {n.toLocaleString(undefined, {
        style: "unit",
        unit: sizeUnitPrefix[o] + "byte",
        maximumSignificantDigits: 4,
      })}
    </span>
  );
}

function doNotSetAt(): void {}

function PPValBI(props: birowval & v<bigint>) {
  const Extra = props.extra;
  const extra =
    Extra === undefined ? (
      <></>
    ) : (
      <>
        &nbsp;
        <Extra {...props} />
      </>
    );
  let contents: ElementOrString = hbi(props.v);
  const { skdb, path, PtrTo } = props;
  const bottom_addr = props.PtrTo !== undefined ? props.bottom_addr : 0n;
  const setAt = props.PtrTo !== undefined ? props.setAt : doNotSetAt;
  const pointedOffset = Number(props.v - bottom_addr);
  const pointedElt = useMemo(() => {
    if (PtrTo !== undefined) {
      return (
        <PtrTo
          key={pointedOffset}
          skdb={skdb}
          path={path}
          offset={pointedOffset}
          bottom_addr={bottom_addr}
          setAt={setAt}
          name=""
        />
      );
    } else return "";
  }, [PtrTo, skdb, path, pointedOffset, bottom_addr, setAt]);
  if (PtrTo !== undefined) {
    contents = (
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          setAt(props.v, pointedElt);
        }}
      >
        {contents}
      </a>
    );
  }
  return (
    <>
      {contents}
      {extra}
    </>
  );
}

function PPValCString(props: v<string>) {
  return <>{props.v}</>;
}

type PPVVal<T> = {
  PPVVal: (props: val<T> & v<T>) => ElementOrString;
};

function PPVal<T>(props: val<T> & PPVVal<T>) {
  const { PPVVal } = props;
  return "v" in props ? (
    <PPVVal {...props} />
  ) : "error" in props ? (
    props.error
  ) : props.processing === true ? (
    "Loading..."
  ) : (
    <LoadLink {...props} />
  );
}

type oRow =
  | { progress: number; value: string | null; offset?: number }
  | undefined;

function valOfRow<T>(
  args: SKDBPathOffset,
  oRow: oRow,
  f: (v: string) => T,
): val<T> {
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
              : { v: f(oRow.value) }
            : { error: `Unexpected progress ${oRow.progress}` };
  return { skdb, path, offset, ...x };
}

function bivalOfRow(args: SKDBPathOffset, oRow: oRow): bival {
  return valOfRow(args, oRow, BigInt);
}

function svalOfRow(args: SKDBPathOffset, oRow: oRow): sval {
  return valOfRow(args, oRow, (s) => s);
}

function useWordsMay(args: SKDBPathOffset, n: number): bival[] {
  const { skdb, path, offset } = args;
  const start = offset;
  const end = offset + 8 * (n - 1);
  const rows = skdb.useSelect(
    "readWord",
    ["offset", "progress", "value"],
    "path = @path AND offset >= @start AND offset <= @end",
    { path, start, end },
    [],
    { group: ["offset"], order: [["offset", "ASC"]] },
  );
  return rows.map((row) => bivalOfRow(args, row));
}

function useWordMay(
  ...a: [args: SKDBPathOffset] | [args: SKDBPath, offset: number]
): bival {
  const args = a.length === 1 ? a[0] : { ...a[0], offset: a[1] };
  const { skdb, path, offset } = args;
  return bivalOfRow(
    args,
    skdb.useSelectMaybeSingle(
      "readWord",
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
): bival {
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

function useCStringMay(args: SKDBPathOffset): sval {
  const { skdb, path, offset } = args;
  return svalOfRow(
    args,
    skdb.useSelectMaybeSingle(
      "readCString",
      ["progress", "value"],
      "path = @path AND offset = @offset",
      { path, offset },
      undefined,
      { order: [["progress", "DESC"]], limit: 1 },
    ),
  );
}

function useCStringMust(args: SKDBPathOffset): sval {
  const val = useCStringMay(args);
  const { skdb, path, offset } = args;
  const requireRequest = "processing" in val && val.processing === false;
  useEffect(() => {
    if (requireRequest) {
      requestReadCString({ skdb, path, offset });
    }
  }, [skdb, path, offset, requireRequest]);
  return { ...val, processing: true };
}

function Row<T>(
  props: rowval<T> & PPVVal<T> & Named & { offsetFrom?: number },
) {
  const off =
    props.offsetFrom !== undefined && props.offsetFrom !== props.offset
      ? hi(props.offsetFrom) + ".." + hi(props.offset)
      : hi(props.offset);
  return (
    <tr>
      <td>{off}</td>
      <td>{props.name}</td>
      <td>
        <PPVal {...props} />
      </td>
    </tr>
  );
}

function BIRow(props: birowval & Named & { offsetFrom?: number }) {
  return <Row {...props} PPVVal={PPValBI} />;
}

function CStringRow(props: csrowval & Named) {
  return <Row {...props} PPVVal={PPValCString} />;
}

function NonVContents(nonv: nonv) {
  return "error" in nonv ? nonv.error : "Loading...";
}

function NonVRow(props: { offset: number } & Named & { nonv: nonv }) {
  return (
    <tr>
      <td>{hi(props.offset)}</td>
      <td>{props.name}</td>
      <td>{NonVContents(props.nonv)}</td>
    </tr>
  );
}

function UseRowMay(props: SKDBPathOffset & BIRowExtraProps & Named) {
  const val = useWordMay(props);
  return <BIRow {...props} {...val} />;
}

function CString(props: SKDBPathOffset & RowExtraProps<string> & Named) {
  const val = useCStringMust(props);
  return <CStringRow {...props} {...val} />;
}

function JustCString(props: SKDBPathOffset) {
  const val = useCStringMust(props);
  return "v" in val ? PPValCString(val) : NonVContents(val);
}

const BINARY_PATH = "/home/mehdi/skdb.github/sql/target/host/dev/skdb";

function inBinary(props: SKDBPathOffset, bioffset: bigint | number) {
  const offset = Number(BigInt(bioffset) - 0x400000n);
  return { ...props, path: BINARY_PATH, offset };
}

function SkObjFromGCTypeWord0and2(
  props: SKDBPathOffsetSet & { vtable_ptr: bivval } & {
    gctype_word0: bivval;
    gctype_word1: biv;
  },
) {
  const { vtable_ptr, gctype_word0, gctype_word1 } = props;
  const m_refsHintMask = gctype_word0.v & 0x1n;
  const m_kind = gctype_word0.v & 0x100n;
  const m_hasName = gctype_word0.v & 0xff000000n;
  const m_userByteSize = gctype_word1.v;
  const length_of_refMask = Number(
    m_refsHintMask === 0n ? 0 : ((m_userByteSize + 7n) / 8n + 63n) / 64n,
  );
  const isArray = m_kind !== 0n;
  if (isArray) {
    return "TODO Array";
  }
  const children = [];
  const vtable_extra =
    m_hasName === 0n ? (
      ""
    ) : (
      <>
        (
        <JustCString
          {...gctype_word0}
          offset={gctype_word0.offset + 8 * (3 + length_of_refMask)}
        />
        )
      </>
    );
  children.push(
    <tr>
      <td>{hi(vtable_ptr.offset)}</td>
      <td>vtable</td>
      <td>
        {hbi(vtable_ptr.v)} {vtable_extra}
      </td>
    </tr>,
  );
  return <>{children}</>;
}

function SkObjFromGCTypePtr(
  props: SKDBPathOffsetSet & { vtable_ptr: bivval } & { gctype_ptr: biv },
) {
  const gctype_props = inBinary(props, props.gctype_ptr.v);
  const gctype_word0 = useWordMust(gctype_props);
  const gctype_word1 = useWordMust(gctype_props, gctype_props.offset + 8);
  return "v" in gctype_word0 ? (
    "v" in gctype_word1 ? (
      <SkObjFromGCTypeWord0and2
        {...props}
        gctype_word0={gctype_word0}
        gctype_word1={gctype_word1}
      />
    ) : (
      <NonVRow {...props} name="" nonv={gctype_word1} />
    )
  ) : (
    <NonVRow {...props} name="" nonv={gctype_word0} />
  );
}

function SkObjFromVtablePtr(props: SKDBPathOffsetSet & { vtable_ptr: bivval }) {
  const gctype_ptr_offset = props.vtable_ptr.v + 8n;
  const in_binary_props = inBinary(props, gctype_ptr_offset);
  const gctype_ptr = useWordMust(in_binary_props);
  return "v" in gctype_ptr ? (
    <SkObjFromGCTypePtr {...props} gctype_ptr={gctype_ptr} />
  ) : (
    <NonVRow {...props} name="" nonv={gctype_ptr} />
  );
}

function SkObj(props: SKDBPathOffsetSet) {
  const { offset } = props;
  const vtable_offset = offset - 8;
  const vtable_ptr = useWordMust({ ...props, offset: vtable_offset });
  return "v" in vtable_ptr ? (
    <SkObjFromVtablePtr {...props} vtable_ptr={vtable_ptr} />
  ) : (
    <NonVRow {...props} name="" nonv={vtable_ptr} />
  );
}

// function LoadAllRow(props: SKDBPathOffset & { n: number; name: string }) {
//   const { skdb, path, offset, n } = props;
//   const allLoaded = skdb.use(
//     skdb.selectCount(
//       "readWord",
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

function BottomAddrExtra({ v }: v<bigint>) {
  return v === DEFAULT_BOTTOM_ADDR ? (
    <span title="Uses default bottom address">✓</span>
  ) : (
    <span
      title={`Unusual bottom address, default is ${hbi(DEFAULT_BOTTOM_ADDR)}`}
    >
      ⚠
    </span>
  );
}

function FreeTable(props: SKDBPathOffsetSet) {
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
        <BIRow
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
    if (!("v" in cur) && cur.processing !== true) {
      missingOffsets.push(cur.offset);
    }
    const next = slots[i + 1];
    if (
      foldConsecutiveZeroes &&
      "v" in cur &&
      cur.v === 0n &&
      next !== undefined &&
      next.offset == cur.offset + 8 &&
      "v" in next &&
      next.v === 0n
    ) {
      consecutiveZeroes++;
    } else {
      const name =
        consecutiveZeroes > 0
          ? `ftable[${index - consecutiveZeroes}..${index}]`
          : `ftable[${index}]`;
      const offsetFrom = cur.offset - consecutiveZeroes * 8;
      ftable.push(
        <BIRow
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

function Ginfo(props: SKDBPathOffsetSet) {
  let { offset } = props;
  const children = [];

  children.push(<FreeTable key={offset} {...props} offset={offset} />);
  offset += 8 * 64;

  children.push(
    <UseRowMay
      key={offset}
      name="context"
      {...props}
      offset={offset}
      PtrTo={SkObj}
    />,
  );
  offset += 8;

  children.push(
    <UseRowMay key={offset} name="head" {...props} offset={offset} />,
  );
  offset += 8;

  children.push(
    <UseRowMay key={offset} name="end" {...props} offset={offset} />,
  );
  offset += 8;

  children.push(
    <UseRowMay
      key={offset}
      name="fileName"
      {...props}
      offset={offset}
      PtrTo={CString}
    />,
  );
  offset += 8;

  children.push(
    <UseRowMay key={offset} name="break_ptr" {...props} offset={offset} />,
  );
  offset += 8;

  children.push(
    <UseRowMay
      key={offset}
      name="total_palloc_size"
      {...props}
      offset={offset}
      extra={PPSize}
    />,
  );
  offset += 8;

  return <>{children}</>;
}

function RestOfHeader(props: SKDBPathOffsetSet) {
  let { offset } = props;
  const children = [];

  children.push(
    <UseRowMay key={offset} name="gmutex_attr" {...props} offset={offset} />,
  );
  offset += 8;

  /* gmutex  */
  offset += 40;

  children.push(<Ginfo key={offset} {...props} offset={offset} />);
  offset += 8 * (64 + 6);

  children.push(
    <UseRowMay key={offset} name="gid" {...props} offset={offset} />,
  );
  offset += 8;

  children.push(
    <UseRowMay
      key={offset}
      name="capacity"
      {...props}
      offset={offset}
      extra={PPSize}
    />,
  );
  offset += 8;

  children.push(
    <UseRowMay key={offset} name="pconsts" {...props} offset={offset} />,
  );
  offset += 8;

  return <>{children}</>;
}

const emptyMap: Map<number, ElementOrString> = Map();

function RestOfFile(props: SKDBPathOffset & { bottom_addr: bigint }) {
  const [loadedAddresses, setLoadedAddresses] = useState(emptyMap);
  const bottom_addr = props.bottom_addr;

  const setAt = useCallback(
    (addr: bigint, elt: ElementOrString) =>
      setLoadedAddresses((la) => {
        const offset = Number(addr - bottom_addr);
        return Object.is(la.get(offset), elt) ? la : la.set(offset, elt);
      }),
    [bottom_addr, setLoadedAddresses],
  );

  const sortedLoadedAddresses = loadedAddresses
    .sortBy((_v, k) => k)
    .toIndexedSeq()
    .toArray();

  return (
    <>
      <RestOfHeader {...props} setAt={setAt} />
      {sortedLoadedAddresses}
    </>
  );
}

function Mapping(props: WithSKDB<Schema, { path: string }>) {
  let offset = 0;
  const children = [];

  const magic = useWordMust(props, offset);
  children.push(<BIRow key={offset} name="magic" {...magic} />);
  offset += 8;

  const bottom_addr = useWordMust(props, offset);
  children.push(
    <BIRow
      key={offset}
      name="bottom_addr"
      {...bottom_addr}
      extra={BottomAddrExtra}
    />,
  );
  offset += 8;

  if ("v" in magic && "v" in bottom_addr) {
    children.push(
      <RestOfFile
        key={offset}
        {...props}
        offset={offset}
        bottom_addr={bottom_addr.v}
      />,
    );
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

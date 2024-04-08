
import { skdbDevServerDb, createLocalDbConnectedTo } from "skdb-dev";
import type { SKDB, SKDBTable } from "skdb";
import * as React from "react";

type MirrorDefns = Parameters<SKDB['mirror']>;
type ParamValue = string | number | boolean | null;
type Params = Parameters<SKDB['watch']>[1];
type WatchReturnType = ReturnType<SKDB['watch']>;

type PossiblyReadonly<T> = T | Readonly<T>

interface ColumnTypeToJSType {
    "INTEGER": number;
    "TEXT": string;
}
interface ColumnNullnessToJSType {
    "NOT NULL": never;
    "": null;
}

type tableName = string
type columnName = string
type columnType = keyof ColumnTypeToJSType
type columnNullness = keyof ColumnNullnessToJSType
type columnDescription = PossiblyReadonly<[columnName, columnType] | [columnName, columnType, columnNullness]>
type columns = PossiblyReadonly<columnDescription[]>
export type DBSchema = PossiblyReadonly<{
    [table: tableName]: columns
}>
type defaultNullness = ""

// TODO: use branded types to check this on the input schema
function checkColumnName(_name: columnName): void { }
function checkTableName(_name: tableName): void { }

function typedColumnsToText<C extends columns>(cols: C): string {
    const res = cols.map(([name, type, nullness]) => {
        checkColumnName(name);
        return `${name} ${type} ${nullness ?? ""}`
    });
    res.push("skdb_access TEXT");
    return `(${res.join(", ")})`;
}

function schemaToText<S extends DBSchema>(schema: S): string {
    return Object.entries(schema).map(
        ([tableName, cols]) => {
            checkTableName(tableName);
            return `CREATE TABLE ${tableName} ${typedColumnsToText(cols)};`;
        }).join("\n");
}

function schemaToMirrorDfns<S extends DBSchema>(schema: S): MirrorDefns {
    return Object.entries(schema).map(
        ([table, cols]) => ({ table, expectedColumns: typedColumnsToText(cols) })
    );
}

export interface DBToConnect<S extends DBSchema> {
    database?: string;
    host?: string;
    port?: number;
    accessKey?: string;
    schema: S;
}

type PossibleColumnNames<S extends DBSchema, T extends keyof S> = S[T][number][0];

type GetColumnDescription<S extends DBSchema, T extends keyof S, K extends PossibleColumnNames<S, T>> =
    Extract<S[T][number], PossiblyReadonly<[K, ...any[]]>>

type ColumnNullness<D extends columnDescription> =
    D extends PossiblyReadonly<[any, any, any, ...any[]]> ? D[2] : defaultNullness;

type TypeOfColumnDescription<D extends columnDescription> =
    ColumnTypeToJSType[D[1]] | ColumnNullnessToJSType[ColumnNullness<D>]

type ColumnType<S extends DBSchema, T extends keyof S, K extends PossibleColumnNames<S, T>> =
    TypeOfColumnDescription<GetColumnDescription<S, T, K>>

type FullRow<S extends DBSchema, T extends keyof S> = {
    [K in S[T][number][0]]: ColumnType<S, T, K>
}

type PartialRow<S extends DBSchema, T extends keyof S> =
    Partial<FullRow<S, T>>

type Row<S extends DBSchema, T extends keyof S, C extends Array<PossibleColumnNames<S, T>>> = {
    [K in C[number]]: ColumnType<S, T, K>
}

type Rows<S extends DBSchema,
    T extends keyof S,
    C extends Array<PossibleColumnNames<S, T>>> = Array<Row<S, T, C>>;

type tableOf<X> = string & keyof X;

type RestRow<S extends DBSchema, T extends keyof S, K extends PartialRow<S, T>> =
    Omit<FullRow<S, T>, keyof K>

export class ConnectedDB<const S extends DBSchema> {
    constructor(
        private readonly schema: S,
        private readonly localDb: SKDB) {
    }

    private async exec(query: string, params: Params | undefined = undefined) {
        const p = params === undefined ? "" : " with " + Object.entries(params).map(([k, v]) => `${k} => ${v}`).join(", ");
        // @ts-ignore
        console.log(`EXEC: ${query}${p};`);
        return await this.localDb.exec(query, params);
    }

    public async insert<const T extends tableOf<S>>(
        table: T,
        row: FullRow<S, T>
    ) {
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        const colParams = this.schema[table].map(([colName]) => `@${colName}`).join(", ");
        const query = `INSERT INTO ${table} (${cols}, skdb_access) VALUES (${colParams}, 'read-write');`;
        return await this.exec(query, row);
    }

    public async delete<const T extends tableOf<S>>(
        table: T,
        where: string | null,
        params: Params | undefined,
    ) {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== null && where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return await this.exec(query, params);
    }

    public async update<const T extends tableOf<S>>(
        table: T,
        row: PartialRow<S, T>,
        where: string | null,
        params: Params | undefined,
    ) {
        const queryParts = ["UPDATE"];
        queryParts.push(table);
        queryParts.push("SET");
        // TODO: prefix colName to avoid conflicts with params
        queryParts.push(Object.keys(row).map((colName) => `${colName} = @${colName}`).join(", "));
        if (where !== null && where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        let paramsRecord: Record<string, ParamValue>;
        if (params === undefined) {
            paramsRecord = {};
        } else if (params instanceof Map) {
            paramsRecord = Object.fromEntries(params);
        } else {
            paramsRecord = params;
        }
        const allParams: Params = { ...paramsRecord, ...row };
        return await this.exec(query, allParams);
    }

    public async insertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(
        table: T,
        rowKey: K,
        rowRest: RestRow<S, T, K>,
    ) {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        await this.delete(table, deleteWhere, rowKey as Record<string, ParamValue>);
        const row = { ...rowKey, ...rowRest };
        await this.insert(table, row as FullRow<S, T>);
    }

    private buildSelectQuery<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
    ): string {
        const queryParts = ["SELECT"];
        queryParts.push(columns.join(", "));
        queryParts.push("FROM");
        queryParts.push(table);
        if (where !== null && where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        return queryParts.join(" ");
    }

    public async watchSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
        params: Params,
        onChange: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void,
    ): WatchReturnType {
        const query = this.buildSelectQuery(table, columns, where);
        const castedChange = (rows: SKDBTable) => onChange.bind(this)(rows as Array<Record<string, any>> as Rows<S, T, C>);
        return await this.localDb.watch(query, params, castedChange);
    }

    public async watchSelectChanges<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
        params: Params,
        init: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void,
        update: (this: ConnectedDB<S>, added: Rows<S, T, C>, removed: Rows<S, T, C>) => void
    ): WatchReturnType {
        const query = this.buildSelectQuery(table, columns, where);
        const castedInit = (rows: SKDBTable) => init.bind(this)(rows as Array<Record<string, any>> as Rows<S, T, C>);
        const castedUpdate = (added: SKDBTable, removed: SKDBTable) => update.bind(this)(
            added as Array<Record<string, any>> as Rows<S, T, C>,
            removed as Array<Record<string, any>> as Rows<S, T, C>
        );
        return await this.localDb.watchChanges(query, params, castedInit, castedUpdate);
    }

    public useSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
        params: Params,
        defaultRows: Rows<S, T, C> = [],
    ): Rows<S, T, C> {
        const [state, setState] = React.useState(defaultRows);
        const deps = Object.values(params);
        deps.push(this, table, columns, where);
        React.useEffect(() => {
            let removeQuery = false;
            const closeable = { close: () => { } };
            this.watchSelect(table, columns, where, params, (rows) => { setState(rows); })
                .then((handle) => {
                    if (removeQuery) {
                        return handle.close();
                    }
                    closeable.close = handle.close;
                });
            return () => { removeQuery = true; closeable.close(); };
        }, deps);
        return state;
    }

    public useSelectMaybeSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
        params: Params,
        defaultRow: Row<S, T, C> | undefined = undefined,
    ): Row<S, T, C> | undefined {
        const defaultRows = defaultRow === undefined ? undefined : [defaultRow];
        const rows = this.useSelect(table, columns, where, params, defaultRows);
        if (rows.length > 1) {
            throw new Error(`Can't extract only row, got ${rows.length} rows`);
        }
        return rows[0];
    }

    public useSelectSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string | null,
        params: Params,
        defaultRow: Row<S, T, C>,
    ): Row<S, T, C> {
        const maybeRow = this.useSelectMaybeSingle(table, columns, where, params, defaultRow);
        if (maybeRow === undefined) {
            throw new Error(`Can't extract only row, got no rows`);
        }
        return maybeRow;
    }

    public useSelectMaybeScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(
        table: T,
        column: C,
        where: string | null,
        params: Params,
        defaultValue: ColumnType<S, T, C> | undefined = undefined,
    ): ColumnType<S, T, C> | undefined {
        const defaultRow = defaultValue === undefined ? undefined : { [column]: defaultValue } as Row<S, T, [C]>;
        const row = this.useSelectMaybeSingle(table, [column], where, params, defaultRow);
        return row === undefined ? undefined : row[column];
    }

    public useSelectScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(
        table: T,
        column: C,
        where: string | null,
        params: Params,
        defaultValue: ColumnType<S, T, C>
    ): ColumnType<S, T, C> {
        const maybeValue = this.useSelectMaybeScalar(table, column, where, params, defaultValue);
        if (maybeValue === undefined) {
            throw new Error(`Can't extract only value, got no values`);
        }
        return maybeValue;
    }
}

export async function connectAndMirror<const S extends DBSchema>(db: DBToConnect<S>): Promise<ConnectedDB<S>> {
    const { database, host, port, accessKey, schema } = db;

    const remoteDb = await skdbDevServerDb(database, host, port);

    await remoteDb.schema(schemaToText(schema));

    const localDb = await createLocalDbConnectedTo(remoteDb, accessKey);

    await localDb.mirror(...schemaToMirrorDfns(schema));

    return new ConnectedDB(schema, localDb);
}

/* For React components */
type SKDBPropName = "skdb";
type SKDBProp<S extends DBSchema> = { [p in SKDBPropName]: ConnectedDB<S> }
export type WithSKDB<S extends DBSchema, Props = {}> =
    SKDBProp<S> & Props

// type ComponentFunction<S extends DBSchema, This, Props, Return> =
//     (this: This, skdb: ConnectedDB<S>, props: Props) => Return;

// export function withSchema<const S extends DBSchema>(_schema: S) {
//     return function <This, Props, Return>(
//         f: ComponentFunction<S, This, Props, Return>,
//         _context: ClassMethodDecoratorContext<This, ComponentFunction<S, This, Props, Return>>
//     ) {
//         return function (this: This, { skdb, ...rest }: WithSKDB<S, Props>) {
//             return f.call(this, skdb, rest as Props);
//         }
//     }
// }

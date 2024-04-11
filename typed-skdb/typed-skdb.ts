
import { skdbDevServerDb, createLocalDbConnectedTo } from "skdb-dev";
import { SKDBTable, type SKDB } from "skdb";
import * as React from "react";

/* Generic utilities */

type PossiblyReadonly<T> = T | Readonly<T>

function ignore(_: any): void { }

/* Types from SKDB */

type MirrorDefns = Parameters<SKDB['mirror']>;
type ParamValue = string | number | boolean | null;
type Params = Parameters<SKDB['watch']>[1];
type WatchReturnType = ReturnType<SKDB['watch']>;

/* Here it starts */

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
    Extract<S[T][number], PossiblyReadonly<[K, ...any[]]>>;

type ColumnNullness<D extends columnDescription> =
    D extends PossiblyReadonly<[any, any, any, ...any[]]> ? D[2] : defaultNullness;

type TypeOfColumnDescription<D extends columnDescription> =
    ColumnTypeToJSType[D[1]] | ColumnNullnessToJSType[ColumnNullness<D>];

type ColumnType<S extends DBSchema, T extends keyof S, K extends PossibleColumnNames<S, T>> =
    TypeOfColumnDescription<GetColumnDescription<S, T, K>>

type FullRow<S extends DBSchema, T extends keyof S> = {
    [K in S[T][number][0]]: ColumnType<S, T, K>
};

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
    Omit<FullRow<S, T>, keyof K>;

type OrderOrder = "ASC" | "DESC";

type SelectOrderItem<S extends DBSchema, T extends keyof S> =
    [PossibleColumnNames<S, T>] | [PossibleColumnNames<S, T>, OrderOrder];

type SelectOrder<S extends DBSchema, T extends keyof S> =
    Array<SelectOrderItem<S, T>>;

type SelectOptions<S extends DBSchema, T extends keyof S> = {
    order?: SelectOrder<S, T>,
    limit?: number,
};

class Query<T> {
    constructor(
        public readonly query: string,
        public readonly params: Params,
        public readonly ofSKDBTable: (t: SKDBTable) => T,
    ) { }

    public static void(query: string, params: Params): Query<void> {
        return new Query(query, params, ignore);
    }

    public mapResult<U>(f: (x: T) => U): Query<U> {
        return new Query(
            this.query,
            this.params,
            t => f(this.ofSKDBTable(t))
        );
    }

    public static transac(qs: Query<void>[]): Query<void> {
        const query = qs.map(({ query }) => query).join("; ");
        // FIXME: this is shamelessly merging params
        const params = qs.map(({ params }) => params).reduce((prev, cur) => ({ ...prev, ...cur }));
        return Query.void(query, params);
    }

    public followedBy(this: Query<void>, next: Query<void>): Query<void> {
        return Query.transac([this, next]);
    }

    public maybeSingle<T>(this: Query<T[]>): Query<T | undefined> {
        return this.mapResult(getMaybeSingleRow);
    }

    public mustRow<T>(this: Query<T | undefined>): Query<T> {
        return this.mapResult(getMustRow);
    }

    public mustSingle<T>(this: Query<T[]>): Query<T> {
        return this.maybeSingle().mustRow();
    }

    public getColumn<const C extends string, T>(this: Query<Record<C, T>[]>, column: C): Query<T[]> {
        return this.mapResult(rows => rows.map(row => row?.[column]));
    }

    public maybeColumn<const C extends string, T>(this: Query<Record<C, T> | undefined>, column: C): Query<T | undefined> {
        return this.mapResult(row => row?.[column]);
    }

    public maybeScalar<const C extends string, T>(this: Query<Record<C, T>[]>, column: C): Query<T | undefined> {
        return this.maybeSingle().maybeColumn(column);
    }
};

function rowsOfSKDBTable<const S extends DBSchema, const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
    t: SKDBTable
): Rows<S, T, C> {
    return t as Array<Record<string, any>> as Rows<S, T, C>;
}
function scalarOfSKDBTable<T extends string | number>(t: SKDBTable): T {
    return Object.values(t[0])[0];
}

function logQuery<T>(kind: string, { query, params }: Query<T>) {
    const p = Object.keys(params).length === 0 ?
        "" :
        " with " + Object.entries(params).map(([k, v]) => `${k} => ${v}`).join(", ");
    // @ts-ignore
    console.log(`${kind}: ${query}${p};`);
}

function getMaybeSingleRow<T>(rows: T[]): T | undefined {
    if (rows.length > 1) {
        throw new Error(`Can't extract only row, got ${rows.length} rows`);
    }
    return rows[0];
}

function getMust<T>(what: string, maybe?: T): T {
    if (maybe === undefined) {
        throw new Error(`Can't extract only ${what}, got no ${what}s`);
    }
    return maybe;
}

function getMustRow<T>(maybeRow?: T): T { return getMust("row", maybeRow); }
//function getMustVal<T>(maybeVal?: T): T { return getMust("value", maybeVal); }

export class ConnectedDB<const S extends DBSchema> {
    constructor(
        private readonly schema: S,
        private readonly localDb: SKDB) {
    }

    /* Actions */

    public async exec<T>(q: Query<T>): Promise<T> {
        logQuery("EXEC", q);
        const res = await this.localDb.exec(q.query, q.params);
        return q.ofSKDBTable(res);
    }

    public async watch<T>(q: Query<T>, onChange: (this: ConnectedDB<S>, v: T) => void) {
        logQuery("WATCH", q);
        const castedOnChange = (rows: SKDBTable) => onChange.bind(this)(q.ofSKDBTable(rows));
        return await this.localDb.watch(q.query, q.params, castedOnChange);
    }

    public async watchChanges<T>(
        q: Query<T>,
        init: (this: ConnectedDB<S>, v: T) => void,
        update: (this: ConnectedDB<S>, added: T, removed: T) => void,
    ) {
        logQuery("WATCH CHANGES", q);
        const castedInit = (rows: SKDBTable) => init.bind(this)(q.ofSKDBTable(rows));
        const castedUpdate = (added: SKDBTable, removed: SKDBTable) => update.bind(this)(q.ofSKDBTable(added), q.ofSKDBTable(removed));
        return await this.localDb.watchChanges(q.query, q.params, castedInit, castedUpdate);
    }

    public use<T>(
        q: Query<T>,
        initial: T,
    ): T {
        const [state, setState] = React.useState(initial);
        const deps = [this, q.query, Object.values(q.params)].flat(Infinity);
        React.useEffect(() => {
            let removeQuery = false;
            const closeable = { close: () => { } };
            this.watch(q, setState)
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

    private buildSelectQueryGen<const T extends tableOf<S>>(
        table: T,
        what: string,
        where: string = "",
        options: SelectOptions<S, T> = {},
    ): string {
        const queryParts = ["SELECT"];
        queryParts.push(what);
        queryParts.push("FROM");
        queryParts.push(table);
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const { order, limit } = options;
        if (order !== undefined && order.length > 0) {
            queryParts.push("ORDER BY");
            queryParts.push(order.map(orderItem => orderItem.join(" ")).join(", "));
        }
        if (limit !== undefined) {
            queryParts.push("LIMIT");
            queryParts.push(limit.toString());
        }
        return queryParts.join(" ");
    }

    private buildSelectQuery<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where?: string,
        options?: SelectOptions<S, T>,
    ): string {
        const what = columns.join(", ");
        return this.buildSelectQueryGen(table, what, where, options);
    }

    public select<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string = "",
        params: Params = {},
        options?: SelectOptions<S, T>,
    ): Query<Rows<S, T, C>> {
        const query = this.buildSelectQuery(table, columns, where, options);
        return new Query(query, params, rowsOfSKDBTable);
    }

    public selectOneField<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(
        table: T,
        column: C,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Query<ColumnType<S, T, C>[]> {
        return this.select(table, [column], where, params, options).mapResult(rows => rows.map(row => row?.[column]));
    }

    public selectCount<const T extends tableOf<S>>(
        table: T,
        where?: string,
        params: Params = {},
        //options?: SelectOptions<S, T>,
    ): Query<number> {
        const query = this.buildSelectQueryGen(table, "COUNT(*)", where);
        return new Query<number>(query, params, scalarOfSKDBTable);
    }

    /* Query builders */

    public insert<const T extends tableOf<S>>(
        table: T,
        r: FullRow<S, T> | FullRow<S, T>[],
    ): Query<void> {
        const queryParts = ["INSERT INTO"];
        queryParts.push(table);
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        queryParts.push(`(${cols}, skdb_access)`);
        queryParts.push("VALUES");
        const values = [];
        let params: Params;
        if (Array.isArray(r)) {
            const preParams = [];
            for (const i in r) {
                values.push(this.schema[table].map(([colName]) => `@${colName}_${i}`));
                preParams.push(Object.entries(r[i]).map(([c, v]) => [`${c}_${i}`, v]));
            }
            params = Object.fromEntries(preParams.flat());
        } else {
            values.push(this.schema[table].map(([colName]) => `@${colName}`));
            params = r;
        }
        queryParts.push(values.map(v => `(${v.join(", ")}, 'read-write')`).join(", "));
        const query = queryParts.join(" ");
        return Query.void(query, params);
    }

    public delete<const T extends tableOf<S>>(
        table: T,
        where: string = "",
        params: Params = {},
    ): Query<void> {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return Query.void(query, params);
    }

    public update<const T extends tableOf<S>>(
        table: T,
        row: PartialRow<S, T>,
        where: string = "",
        params: Params = {},
    ): Query<void> {
        const queryParts = ["UPDATE"];
        queryParts.push(table);
        queryParts.push("SET");
        // TODO: prefix colName to avoid conflicts with params
        queryParts.push(Object.keys(row).map((colName) => `${colName} = @${colName}`).join(", "));
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        const paramsRecord = params instanceof Map ? Object.fromEntries(params) : params;
        const allParams: Params = { ...paramsRecord, ...row };
        return Query.void(query, allParams);
    }

    public insertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(
        table: T,
        rowKey: K,
        rowRest: RestRow<S, T, K>,
    ): Query<void> {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        const row = { ...rowKey, ...rowRest };
        return this.delete(table, deleteWhere, rowKey as Record<string, ParamValue>).followedBy(
            this.insert(table, row as FullRow<S, T>));
    }

    /* Pre-built compositions */

    public async execInsert<const T extends tableOf<S>>(
        table: T,
        r: FullRow<S, T> | FullRow<S, T>[]
    ): Promise<void> {
        return await this.exec(this.insert(table, r));
    }

    public async execDelete<const T extends tableOf<S>>(
        table: T,
        where?: string,
        params?: Params,
    ) {
        return await this.exec(this.delete(table, where, params));
    }

    public async execInsertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(
        table: T,
        rowKey: K,
        rowRest: RestRow<S, T, K>,
    ) {
        return await this.exec(this.insertOrUpdateWithKey(table, rowKey, rowRest));
    }


    public async execSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<Rows<S, T, C>> {
        return await this.exec(this.select(table, columns, where, params, options));
    }

    public async execSelectCount<const T extends tableOf<S>>(
        table: T,
        where?: string,
        params?: Params,
        //options?: SelectOptions<S, T>,
    ): Promise<number> {
        return await this.exec(this.selectCount(table, where, params));
    }

    public async watchSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string,
        params: Params,
        onChange: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void,
        options?: SelectOptions<S, T>,
    ): WatchReturnType {
        return await this.watch(this.select(table, columns, where, params, options), onChange);
    }

    public async watchSelectChanges<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string,
        params: Params,
        init: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void,
        update: (this: ConnectedDB<S>, added: Rows<S, T, C>, removed: Rows<S, T, C>) => void,
        options?: SelectOptions<S, T>,
    ): WatchReturnType {
        return await this.watchChanges(this.select(table, columns, where, params, options), init, update);
    }

    public useSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where?: string,
        params?: Params,
        defaultRows: Rows<S, T, C> = [],
        options?: SelectOptions<S, T>,
    ): Rows<S, T, C> {
        return this.use(this.select(table, columns, where, params, options), defaultRows);
    }

    public useSelectMaybeSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where?: string,
        params?: Params,
        defaultRow?: Row<S, T, C>,
        options?: SelectOptions<S, T>,
    ): Row<S, T, C> | undefined {
        return this.use(this.select(table, columns, where, params, options).maybeSingle(), defaultRow);
    }

    public useSelectSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(
        table: T,
        columns: C,
        where: string,
        params: Params,
        defaultRow: Row<S, T, C>,
        options?: SelectOptions<S, T>,
    ): Row<S, T, C> {
        return this.use(this.select(table, columns, where, params, options).mustSingle(), defaultRow);
    }

    public useSelectMaybeScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(
        table: T,
        column: C,
        where?: string,
        params?: Params,
        defaultValue?: ColumnType<S, T, C>,
        options?: SelectOptions<S, T>,
    ): ColumnType<S, T, C> | undefined {
        return this.use(this.selectOneField(table, column, where, params, options).maybeSingle(), defaultValue);
    }

    public useSelectScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(
        table: T,
        column: C,
        where: string,
        params: Params,
        defaultValue: ColumnType<S, T, C>,
        options?: SelectOptions<S, T>,
    ): ColumnType<S, T, C> {
        return this.use(this.selectOneField(table, column, where, params, options).mustSingle(), defaultValue);
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

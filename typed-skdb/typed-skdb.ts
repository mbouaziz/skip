
import { skdbDevServerDb, createLocalDbConnectedTo } from "skdb-dev";
import type { SKDB, SKDBTable } from "skdb";
import * as React from "react";

type MirrorDefns = Parameters<SKDB['mirror']>;
type ParamValue = string | number | boolean | null;
type Params = Parameters<SKDB['watch']>[1];
type WatchReturnType = ReturnType<SKDB['watch']>;

type PossiblyReadonly<T> = T | Readonly<T>;
type IndexOf<A extends any[]> = Exclude<keyof A, keyof any[]>;
type FieldsAndTypesToObject<A extends Array<[number | string | symbol, any]>> = {
    [K in A[number][0]]: Extract<A[number], [K, any]>[1];
};

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
    TypeOfColumnDescription<GetColumnDescription<S, T, K>>;

type CountType = number;

type FullRow<S extends DBSchema, T extends keyof S> = {
    [K in S[T][number][0]]: ColumnType<S, T, K>
};

type PartialRow<S extends DBSchema, T extends keyof S> =
    Partial<FullRow<S, T>>;

type SelectExpr<S extends DBSchema, T extends keyof S> =
    "COUNT" | PossibleColumnNames<S, T>;

type SelectExprType<S extends DBSchema, T extends keyof S, E extends SelectExpr<S, T>> =
    E extends "COUNT" ? CountType : ColumnType<S, T, E>;

type FieldName<S extends DBSchema, T extends keyof S, I extends string | number, E extends SelectExpr<S, T>> =
    E extends "COUNT" ? `col<${I}>` : E;

type RowFieldsAndTypes<S extends DBSchema, T extends keyof S, E extends Array<SelectExpr<S, T>>> = {
    [I in keyof E]: I extends IndexOf<E> ? [FieldName<S, T, I, E[I]>, SelectExprType<S, T, E[I]>] : [I, E[I]];
}

type Row<S extends DBSchema, T extends keyof S, E extends Array<SelectExpr<S, T>>> =
    FieldsAndTypesToObject<RowFieldsAndTypes<S, T, E>>;

type Rows<S extends DBSchema,
    T extends keyof S,
    E extends Array<SelectExpr<S, T>>> = Array<Row<S, T, E>>;

type tableOf<X> = string & keyof X;

type RestRow<S extends DBSchema, T extends keyof S, K extends PartialRow<S, T>> =
    Omit<FullRow<S, T>, keyof K>;

type Prepared = [string, Params | undefined];

type OrderOrder = "ASC" | "DESC";

type SelectOrderItem<S extends DBSchema, T extends keyof S> =
    [PossibleColumnNames<S, T>] | [PossibleColumnNames<S, T>, OrderOrder];

type SelectOrder<S extends DBSchema, T extends keyof S> =
    Array<SelectOrderItem<S, T>>;

type SelectOptions<S extends DBSchema, T extends keyof S> = {
    order?: SelectOrder<S, T>,
    limit?: number,
};

function logQuery(kind: string, query: string, params?: Params) {
    const p = params === undefined || Object.keys(params).length === 0 ?
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
function getMustVal<T>(maybeVal?: T): T { return getMust("value", maybeVal); }

function scalarFieldName<const S extends DBSchema, const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
    expr: E,
): FieldName<S, T, 0, E> {
    // @ts-ignore
    return expr === "COUNT" ? "col<0>" : expr;
}
function getMaybeScalar<const S extends DBSchema, const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
    expr: E,
    maybeRow?: Row<S, T, [E]>,
): SelectExprType<S, T, E> | undefined {
    return maybeRow?.[scalarFieldName(expr)];
}

export class ConnectedDB<const S extends DBSchema> {
    constructor(
        private readonly schema: S,
        private readonly localDb: SKDB) {
    }

    private async exec(query: string, params?: Params) {
        logQuery("EXEC", query, params);
        return await this.localDb.exec(query, params);
    }

    private async watch(query: string, params: Params, onChange: (rows: SKDBTable) => void) {
        logQuery("WATCH", query, params);
        return await this.localDb.watch(query, params, onChange);
    }

    private async watchChanges(
        query: string,
        params: Params,
        init: (rows: SKDBTable) => void,
        update: (added: SKDBTable, removed: SKDBTable) => void,
    ) {
        logQuery("WATCH CHANGES", query, params);
        return await this.localDb.watchChanges(query, params, init, update);
    }

    private async execTransac(preps: Prepared[]) {
        const q = preps.map(([q, _p]) => q).join("; ");
        const p = preps.map(([_q, p]) => p).reduce((prev, cur) => ({ ...prev, ...cur }));
        return this.exec(q, p);
    }

    private prepareInsert<const T extends tableOf<S>>(
        table: T,
        row: FullRow<S, T>,
    ): Prepared {
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        const colParams = this.schema[table].map(([colName]) => `@${colName}`).join(", ");
        const query = `INSERT INTO ${table} (${cols}, skdb_access) VALUES (${colParams}, 'read-write');`;
        return [query, row];
    }

    public async insert<const T extends tableOf<S>>(
        table: T,
        row: FullRow<S, T>
    ) {
        const [q, p] = this.prepareInsert(table, row);
        return await this.exec(q, p);
    }

    private prepareDelete<const T extends tableOf<S>>(
        table: T,
        where: string = "",
        params?: Params,
    ): Prepared {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return [query, params];
    }

    public async delete<const T extends tableOf<S>>(
        table: T,
        where?: string,
        params?: Params,
    ) {
        const [q, p] = this.prepareDelete(table, where, params);
        return await this.exec(q, p);
    }

    public async update<const T extends tableOf<S>>(
        table: T,
        row: PartialRow<S, T>,
        where: string = "",
        params: Params = {},
    ) {
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
        return await this.exec(query, allParams);
    }

    public async insertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(
        table: T,
        rowKey: K,
        rowRest: RestRow<S, T, K>,
    ) {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        // await this.delete(table, deleteWhere, rowKey as Record<string, ParamValue>);
        const row = { ...rowKey, ...rowRest };
        // await this.insert(table, row as FullRow<S, T>);
        const d = this.prepareDelete(table, deleteWhere, rowKey as Record<string, ParamValue>);
        const i = this.prepareInsert(table, row as FullRow<S, T>);
        return await this.execTransac([d, i]);
    }

    private buildSelectQuery<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where: string = "",
        options: SelectOptions<S, T> = {},
    ): string {
        const what = exprs.map(
            (e) => (e === "COUNT") ? "COUNT(*)" : e
        ).join(", ");
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

    public async select<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<Rows<S, T, E>> {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const result = await this.exec(query, params);
        return result as Array<Record<string, any>> as Rows<S, T, E>;
    }

    public async selectMaybeSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<Row<S, T, E> | undefined> {
        const rows = await this.select(table, exprs, where, params, options);
        return getMaybeSingleRow(rows);
    }

    public async selectSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<Row<S, T, E>> {
        const maybeRow = await this.selectMaybeSingle(table, exprs, where, params, options);
        return getMustRow(maybeRow);
    }

    public async selectMaybeScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
        table: T,
        expr: E,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<SelectExprType<S, T, E> | undefined> {
        const maybeRow = await this.selectMaybeSingle(table, [expr], where, params, options);
        return getMaybeScalar(expr, maybeRow);
    }

    public async selectScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
        table: T,
        expr: E,
        where?: string,
        params?: Params,
        options?: SelectOptions<S, T>,
    ): Promise<SelectExprType<S, T, E>> {
        const maybeScalar = await this.selectMaybeScalar(table, expr, where, params, options);
        return getMustVal(maybeScalar);
    }

    public async watchSelect<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where: string,
        params: Params,
        onChange: (this: ConnectedDB<S>, rows: Rows<S, T, E>) => void,
        options?: SelectOptions<S, T>,
    ): WatchReturnType {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const castedChange = (rows: SKDBTable) => onChange.bind(this)(rows as Array<Record<string, any>> as Rows<S, T, E>);
        return await this.watch(query, params, castedChange);
    }

    public async watchSelectChanges<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where: string,
        params: Params,
        init: (this: ConnectedDB<S>, rows: Rows<S, T, E>) => void,
        update: (this: ConnectedDB<S>, added: Rows<S, T, E>, removed: Rows<S, T, E>) => void,
        options?: SelectOptions<S, T>,
    ): WatchReturnType {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const castedInit = (rows: SKDBTable) => init.bind(this)(rows as Array<Record<string, any>> as Rows<S, T, E>);
        const castedUpdate = (added: SKDBTable, removed: SKDBTable) => update.bind(this)(
            added as Array<Record<string, any>> as Rows<S, T, E>,
            removed as Array<Record<string, any>> as Rows<S, T, E>
        );
        return await this.watchChanges(query, params, castedInit, castedUpdate);
    }

    public useSelect<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where: string = "",
        params: Params = {},
        defaultRows: Rows<S, T, E> = [],
        options: SelectOptions<S, T> = {},
    ): Rows<S, T, E> {
        const [state, setState] = React.useState(defaultRows);
        const deps = [this, table, exprs, where, Object.values(params), Object.values(options)].flat(Infinity);
        React.useEffect(() => {
            let removeQuery = false;
            const closeable = { close: () => { } };
            this.watchSelect(table, exprs, where, params, setState, options)
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

    public useSelectMaybeSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where?: string,
        params?: Params,
        defaultRow?: Row<S, T, E>,
        options?: SelectOptions<S, T>,
    ): Row<S, T, E> | undefined {
        const defaultRows = defaultRow === undefined ? undefined : [defaultRow];
        return getMaybeSingleRow(this.useSelect(table, exprs, where, params, defaultRows, options));
    }

    public useSelectSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(
        table: T,
        exprs: E,
        where: string,
        params: Params,
        defaultRow: Row<S, T, E>,
        options?: SelectOptions<S, T>,
    ): Row<S, T, E> {
        return getMustRow(this.useSelectMaybeSingle(table, exprs, where, params, defaultRow, options));
    }

    public useSelectMaybeScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
        table: T,
        expr: E,
        where?: string,
        params?: Params,
        defaultValue?: SelectExprType<S, T, E>,
        options?: SelectOptions<S, T>,
    ): SelectExprType<S, T, E> | undefined {
        const defaultRow = defaultValue === undefined ? undefined : { [expr]: defaultValue } as Row<S, T, [E]>;
        return getMaybeScalar(expr, this.useSelectMaybeSingle(table, [expr], where, params, defaultRow, options));
    }

    public useSelectScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(
        table: T,
        expr: E,
        where: string,
        params: Params,
        defaultValue: SelectExprType<S, T, E>,
        options?: SelectOptions<S, T>,
    ): SelectExprType<S, T, E> {
        return getMustVal(this.useSelectMaybeScalar(table, expr, where, params, defaultValue, options));
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

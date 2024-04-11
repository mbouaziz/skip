import type { SKDB, SKDBTable } from "skdb";
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
type tableName = string;
type columnName = string;
type columnType = keyof ColumnTypeToJSType;
type columnNullness = keyof ColumnNullnessToJSType;
type columnDescription = PossiblyReadonly<[columnName, columnType] | [columnName, columnType, columnNullness]>;
type columns = PossiblyReadonly<columnDescription[]>;
export type DBSchema = PossiblyReadonly<{
    [table: tableName]: columns;
}>;
type defaultNullness = "";
export interface DBToConnect<S extends DBSchema> {
    database?: string;
    host?: string;
    port?: number;
    accessKey?: string;
    schema: S;
}
type PossibleColumnNames<S extends DBSchema, T extends keyof S> = S[T][number][0];
type GetColumnDescription<S extends DBSchema, T extends keyof S, K extends PossibleColumnNames<S, T>> = Extract<S[T][number], PossiblyReadonly<[K, ...any[]]>>;
type ColumnNullness<D extends columnDescription> = D extends PossiblyReadonly<[any, any, any, ...any[]]> ? D[2] : defaultNullness;
type TypeOfColumnDescription<D extends columnDescription> = ColumnTypeToJSType[D[1]] | ColumnNullnessToJSType[ColumnNullness<D>];
type ColumnType<S extends DBSchema, T extends keyof S, K extends PossibleColumnNames<S, T>> = TypeOfColumnDescription<GetColumnDescription<S, T, K>>;
type CountType = number;
type FullRow<S extends DBSchema, T extends keyof S> = {
    [K in S[T][number][0]]: ColumnType<S, T, K>;
};
type PartialRow<S extends DBSchema, T extends keyof S> = Partial<FullRow<S, T>>;
type SelectExpr<S extends DBSchema, T extends keyof S> = "COUNT" | PossibleColumnNames<S, T>;
type SelectExprType<S extends DBSchema, T extends keyof S, E extends SelectExpr<S, T>> = E extends "COUNT" ? CountType : ColumnType<S, T, E>;
type FieldName<S extends DBSchema, T extends keyof S, I extends string | number, E extends SelectExpr<S, T>> = E extends "COUNT" ? `col<${I}>` : E;
type RowFieldsAndTypes<S extends DBSchema, T extends keyof S, E extends Array<SelectExpr<S, T>>> = {
    [I in keyof E]: I extends IndexOf<E> ? [FieldName<S, T, I, E[I]>, SelectExprType<S, T, E[I]>] : [I, E[I]];
};
type Row<S extends DBSchema, T extends keyof S, E extends Array<SelectExpr<S, T>>> = FieldsAndTypesToObject<RowFieldsAndTypes<S, T, E>>;
type Rows<S extends DBSchema, T extends keyof S, E extends Array<SelectExpr<S, T>>> = Array<Row<S, T, E>>;
type tableOf<X> = string & keyof X;
type RestRow<S extends DBSchema, T extends keyof S, K extends PartialRow<S, T>> = Omit<FullRow<S, T>, keyof K>;
type OrderOrder = "ASC" | "DESC";
type SelectOrderItem<S extends DBSchema, T extends keyof S> = [
    PossibleColumnNames<S, T>
] | [PossibleColumnNames<S, T>, OrderOrder];
type SelectOrder<S extends DBSchema, T extends keyof S> = Array<SelectOrderItem<S, T>>;
type SelectOptions<S extends DBSchema, T extends keyof S> = {
    order?: SelectOrder<S, T>;
    limit?: number;
};
export declare class ConnectedDB<const S extends DBSchema> {
    private readonly schema;
    private readonly localDb;
    constructor(schema: S, localDb: SKDB);
    private exec;
    private watch;
    private watchChanges;
    private execTransac;
    private prepareInsert;
    insert<const T extends tableOf<S>>(table: T, row: FullRow<S, T>): Promise<SKDBTable>;
    private prepareDelete;
    delete<const T extends tableOf<S>>(table: T, where?: string, params?: Params): Promise<SKDBTable>;
    update<const T extends tableOf<S>>(table: T, row: PartialRow<S, T>, where?: string, params?: Params): Promise<SKDBTable>;
    insertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(table: T, rowKey: K, rowRest: RestRow<S, T, K>): Promise<SKDBTable>;
    private buildSelectQuery;
    select<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where?: string, params?: Params, options?: SelectOptions<S, T>): Promise<Rows<S, T, E>>;
    selectMaybeSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where?: string, params?: Params, options?: SelectOptions<S, T>): Promise<Row<S, T, E> | undefined>;
    selectSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where?: string, params?: Params, options?: SelectOptions<S, T>): Promise<Row<S, T, E>>;
    selectMaybeScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(table: T, expr: E, where?: string, params?: Params, options?: SelectOptions<S, T>): Promise<SelectExprType<S, T, E> | undefined>;
    selectScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(table: T, expr: E, where?: string, params?: Params, options?: SelectOptions<S, T>): Promise<SelectExprType<S, T, E>>;
    watchSelect<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where: string, params: Params, onChange: (this: ConnectedDB<S>, rows: Rows<S, T, E>) => void, options?: SelectOptions<S, T>): WatchReturnType;
    watchSelectChanges<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where: string, params: Params, init: (this: ConnectedDB<S>, rows: Rows<S, T, E>) => void, update: (this: ConnectedDB<S>, added: Rows<S, T, E>, removed: Rows<S, T, E>) => void, options?: SelectOptions<S, T>): WatchReturnType;
    useSelect<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where?: string, params?: Params, defaultRows?: Rows<S, T, E>, options?: SelectOptions<S, T>): Rows<S, T, E>;
    useSelectMaybeSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where?: string, params?: Params, defaultRow?: Row<S, T, E>, options?: SelectOptions<S, T>): Row<S, T, E> | undefined;
    useSelectSingle<const T extends tableOf<S>, const E extends SelectExpr<S, T>[]>(table: T, exprs: E, where: string, params: Params, defaultRow: Row<S, T, E>, options?: SelectOptions<S, T>): Row<S, T, E>;
    useSelectMaybeScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(table: T, expr: E, where?: string, params?: Params, defaultValue?: SelectExprType<S, T, E>, options?: SelectOptions<S, T>): SelectExprType<S, T, E> | undefined;
    useSelectScalar<const T extends tableOf<S>, const E extends SelectExpr<S, T>>(table: T, expr: E, where: string, params: Params, defaultValue: SelectExprType<S, T, E>, options?: SelectOptions<S, T>): SelectExprType<S, T, E>;
}
export declare function connectAndMirror<const S extends DBSchema>(db: DBToConnect<S>): Promise<ConnectedDB<S>>;
type SKDBPropName = "skdb";
type SKDBProp<S extends DBSchema> = {
    [p in SKDBPropName]: ConnectedDB<S>;
};
export type WithSKDB<S extends DBSchema, Props = {}> = SKDBProp<S> & Props;
export {};
//# sourceMappingURL=typed-skdb.d.ts.map
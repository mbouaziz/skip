import { SKDBTable, type SKDB } from "skdb";
type PossiblyReadonly<T> = T | Readonly<T>;
type Params = Parameters<SKDB['watch']>[1];
type WatchReturnType = ReturnType<SKDB['watch']>;
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
type FullRow<S extends DBSchema, T extends keyof S> = {
    [K in S[T][number][0]]: ColumnType<S, T, K>;
};
type PartialRow<S extends DBSchema, T extends keyof S> = Partial<FullRow<S, T>>;
type Row<S extends DBSchema, T extends keyof S, C extends Array<PossibleColumnNames<S, T>>> = {
    [K in C[number]]: ColumnType<S, T, K>;
};
type Rows<S extends DBSchema, T extends keyof S, C extends Array<PossibleColumnNames<S, T>>> = Array<Row<S, T, C>>;
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
type Query<T> = {
    query: string;
    params: Params;
    ofSKDBTable: (t: SKDBTable) => T;
};
export declare class ConnectedDB<const S extends DBSchema> {
    private readonly schema;
    private readonly localDb;
    constructor(schema: S, localDb: SKDB);
    exec<T>(q: Query<T>): Promise<T>;
    watch<T>(q: Query<T>, onChange: (this: ConnectedDB<S>, v: T) => void): Promise<{
        close: () => Promise<void>;
    }>;
    watchChanges<T>(q: Query<T>, init: (this: ConnectedDB<S>, v: T) => void, update: (this: ConnectedDB<S>, added: T, removed: T) => void): Promise<{
        close: () => Promise<void>;
    }>;
    use<T>(q: Query<T>, initial: T): T;
    private buildSelectQueryGen;
    private buildSelectQuery;
    select<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where: string, params?: Params, options?: SelectOptions<S, T>): Query<Rows<S, T, C>>;
    selectCount<const T extends tableOf<S>>(table: T, where?: string, params?: Params): Query<number>;
    insert<const T extends tableOf<S>>(table: T, r: FullRow<S, T> | FullRow<S, T>[]): Query<void>;
    delete<const T extends tableOf<S>>(table: T, where?: string, params?: Params): Query<void>;
    update<const T extends tableOf<S>>(table: T, row: PartialRow<S, T>, where?: string, params?: Params): Query<void>;
    insertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(table: T, rowKey: K, rowRest: RestRow<S, T, K>): Query<void>;
    execInsert<const T extends tableOf<S>>(table: T, r: FullRow<S, T> | FullRow<S, T>[]): Promise<void>;
    execDelete<const T extends tableOf<S>>(table: T, where?: string, params?: Params): Promise<void>;
    execInsertOrUpdateWithKey<const T extends tableOf<S>, K extends PartialRow<S, T>>(table: T, rowKey: K, rowRest: RestRow<S, T, K>): Promise<void>;
    execSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where: string, params?: Params, options?: SelectOptions<S, T>): Promise<Rows<S, T, C>>;
    execSelectCount<const T extends tableOf<S>>(table: T, where?: string, params?: Params): Promise<number>;
    watchSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where: string, params: Params, onChange: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void, options?: SelectOptions<S, T>): WatchReturnType;
    watchSelectChanges<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where: string, params: Params, init: (this: ConnectedDB<S>, rows: Rows<S, T, C>) => void, update: (this: ConnectedDB<S>, added: Rows<S, T, C>, removed: Rows<S, T, C>) => void, options?: SelectOptions<S, T>): WatchReturnType;
    useSelect<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where?: string, params?: Params, defaultRows?: Rows<S, T, C>, options?: SelectOptions<S, T>): Rows<S, T, C>;
    useSelectMaybeSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where?: string, params?: Params, defaultRow?: Row<S, T, C>, options?: SelectOptions<S, T>): Row<S, T, C> | undefined;
    useSelectSingle<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>[]>(table: T, columns: C, where: string, params: Params, defaultRow: Row<S, T, C>, options?: SelectOptions<S, T>): Row<S, T, C>;
    useSelectMaybeScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(table: T, column: C, where?: string, params?: Params, defaultValue?: ColumnType<S, T, C>, options?: SelectOptions<S, T>): ColumnType<S, T, C> | undefined;
    useSelectScalar<const T extends tableOf<S>, const C extends PossibleColumnNames<S, T>>(table: T, column: C, where: string, params: Params, defaultValue: ColumnType<S, T, C>, options?: SelectOptions<S, T>): ColumnType<S, T, C>;
}
export declare function connectAndMirror<const S extends DBSchema>(db: DBToConnect<S>): Promise<ConnectedDB<S>>;
type SKDBPropName = "skdb";
type SKDBProp<S extends DBSchema> = {
    [p in SKDBPropName]: ConnectedDB<S>;
};
export type WithSKDB<S extends DBSchema, Props = {}> = SKDBProp<S> & Props;
export {};
//# sourceMappingURL=typed-skdb.d.ts.map
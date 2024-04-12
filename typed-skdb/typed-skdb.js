import { skdbDevServerDb, createLocalDbConnectedTo } from "skdb-dev";
import { SKDBTable } from "skdb";
import * as React from "react";
function ignore(_) { }
function id(x) { return x; }
// TODO: use branded types to check this on the input schema
function checkColumnName(_name) { }
function checkTableName(_name) { }
function typedColumnsToText(cols) {
    const res = cols.map(([name, type, nullness]) => {
        checkColumnName(name);
        return `${name} ${type} ${nullness ?? ""}`;
    });
    res.push("skdb_access TEXT");
    return `(${res.join(", ")})`;
}
function schemaToText(schema) {
    return Object.entries(schema).map(([tableName, cols]) => {
        checkTableName(tableName);
        return `CREATE TABLE ${tableName} ${typedColumnsToText(cols)};`;
    }).join("\n");
}
function schemaToMirrorDfns(schema) {
    return Object.entries(schema).map(([table, cols]) => ({ table, expectedColumns: typedColumnsToText(cols) }));
}
class Query {
    query;
    params;
    ofSKDBTable;
    constructor(query, params, ofSKDBTable) {
        this.query = query;
        this.params = params;
        this.ofSKDBTable = ofSKDBTable;
    }
    static raw(query, params) {
        return new Query(query, params, id);
    }
    static void(query, params) {
        return new Query(query, params, ignore);
    }
    mapResult(f) {
        return new Query(this.query, this.params, t => f(this.ofSKDBTable(t)));
    }
    static transac(qs) {
        const query = qs.map(({ query }) => query).join("; ");
        // FIXME: this is shamelessly merging params
        const params = qs.map(({ params }) => params).reduce((prev, cur) => ({ ...prev, ...cur }));
        return Query.void(query, params);
    }
    followedBy(next) {
        return Query.transac([this, next]);
    }
    maybeSingle() {
        return this.mapResult(getMaybeSingleRow);
    }
    mustRow() {
        return this.mapResult(getMustRow);
    }
    mustSingle() {
        return this.maybeSingle().mustRow();
    }
    firstRow() {
        return this.mapResult(t => t[0]);
    }
    firstField() {
        return this.mapResult(t => Object.values(t)[0]);
    }
    firstFieldOfFirstRow() {
        return this.firstRow().firstField();
    }
    getColumn(column) {
        return this.mapResult(rows => rows.map(row => row?.[column]));
    }
    maybeColumn(column) {
        return this.mapResult(row => row?.[column]);
    }
    maybeScalar(column) {
        return this.maybeSingle().maybeColumn(column);
    }
}
;
function asArray(t) {
    return t;
}
function asRows(t) {
    return t;
}
function logQuery(kind, { query, params }) {
    const p = Object.keys(params).length === 0 ?
        "" :
        " with " + Object.entries(params).map(([k, v]) => `${k} => ${v}`).join(", ");
    // @ts-ignore
    console.log(`${kind}: ${query}${p};`);
}
function getMaybeSingleRow(rows) {
    if (rows.length > 1) {
        throw new Error(`Can't extract only row, got ${rows.length} rows`);
    }
    return rows[0];
}
function getMust(what, maybe) {
    if (maybe === undefined) {
        throw new Error(`Can't extract only ${what}, got no ${what}s`);
    }
    return maybe;
}
function getMustRow(maybeRow) { return getMust("row", maybeRow); }
//function getMustVal<T>(maybeVal?: T): T { return getMust("value", maybeVal); }
export class ConnectedDB {
    schema;
    localDb;
    constructor(schema, localDb) {
        this.schema = schema;
        this.localDb = localDb;
    }
    /* Actions on queries
        Only these functions actually need localDb. */
    async exec(q) {
        logQuery("EXEC", q);
        const res = await this.localDb.exec(q.query, q.params);
        return q.ofSKDBTable(res);
    }
    async watch(q, onChange) {
        logQuery("WATCH", q);
        const castedOnChange = (rows) => onChange.bind(this)(q.ofSKDBTable(rows));
        return await this.localDb.watch(q.query, q.params, castedOnChange);
    }
    async watchChanges(q, init, update) {
        logQuery("WATCH CHANGES", q);
        const castedInit = (rows) => init.bind(this)(q.ofSKDBTable(rows));
        const castedUpdate = (added, removed) => update.bind(this)(q.ofSKDBTable(added), q.ofSKDBTable(removed));
        return await this.localDb.watchChanges(q.query, q.params, castedInit, castedUpdate);
    }
    use(q, initial) {
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
    /* Select query builders */
    selectRaw(table, what, where = "", params = {}, options = {}) {
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
        const query = queryParts.join(" ");
        return Query.raw(query, params).mapResult((asArray));
    }
    select(table, columns, where, params, options) {
        const what = columns.join(", ");
        return this.selectRaw(table, what, where, params, options).mapResult(asRows);
    }
    // Utility to help typescript in this particular case
    selectOneField(table, column, where, params, options) {
        // TS doesn't like this.select(...).getColumn(column)
        return this.select(table, [column], where, params, options).mapResult(rows => rows.map(row => row?.[column]));
    }
    selectCount(table, where, params) {
        return this.selectRaw(table, "COUNT(*)", where, params).firstFieldOfFirstRow();
    }
    /* Other query builders */
    insert(...args) {
        const [table, r] = args;
        const queryParts = ["INSERT INTO"];
        queryParts.push(table);
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        queryParts.push(`(${cols}, skdb_access)`);
        queryParts.push("VALUES");
        const values = [];
        let params;
        if (Array.isArray(r)) {
            const preParams = [];
            for (const i in r) {
                values.push(this.schema[table].map(([colName]) => `@${colName}_${i}`));
                preParams.push(Object.entries(r[i]).map(([c, v]) => [`${c}_${i}`, v]));
            }
            params = Object.fromEntries(preParams.flat());
        }
        else {
            values.push(this.schema[table].map(([colName]) => `@${colName}`));
            params = r;
        }
        queryParts.push(values.map(v => `(${v.join(", ")}, 'read-write')`).join(", "));
        const query = queryParts.join(" ");
        return Query.void(query, params);
    }
    delete(table, where = "", params = {}) {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return Query.void(query, params);
    }
    update(table, row, where = "", params = {}) {
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
        const allParams = { ...paramsRecord, ...row };
        return Query.void(query, allParams);
    }
    insertOrUpdateWithKey(table, rowKey, rowRest) {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        const row = { ...rowKey, ...rowRest };
        return this.delete(table, deleteWhere, rowKey).followedBy(this.insert(table, row));
    }
    /* Pre-built compositions */
    async execInsert(...args) {
        return await this.exec(this.insert(...args));
    }
    async execDelete(table, where, params) {
        return await this.exec(this.delete(table, where, params));
    }
    async execInsertOrUpdateWithKey(table, rowKey, rowRest) {
        return await this.exec(this.insertOrUpdateWithKey(table, rowKey, rowRest));
    }
    async execSelect(table, columns, where, params, options) {
        return await this.exec(this.select(table, columns, where, params, options));
    }
    async execSelectCount(table, where, params) {
        return await this.exec(this.selectCount(table, where, params));
    }
    async watchSelect(table, columns, where, params, onChange, options) {
        return await this.watch(this.select(table, columns, where, params, options), onChange);
    }
    async watchSelectChanges(table, columns, where, params, init, update, options) {
        return await this.watchChanges(this.select(table, columns, where, params, options), init, update);
    }
    useSelect(table, columns, where, params, defaultRows = [], options) {
        return this.use(this.select(table, columns, where, params, options), defaultRows);
    }
    useSelectMaybeSingle(table, columns, where, params, defaultRow, options) {
        return this.use(this.select(table, columns, where, params, options).maybeSingle(), defaultRow);
    }
    useSelectSingle(table, columns, where, params, defaultRow, options) {
        return this.use(this.select(table, columns, where, params, options).mustSingle(), defaultRow);
    }
    useSelectMaybeScalar(table, column, where, params, defaultValue, options) {
        return this.use(this.selectOneField(table, column, where, params, options).maybeSingle(), defaultValue);
    }
    useSelectScalar(table, column, where, params, defaultValue, options) {
        return this.use(this.selectOneField(table, column, where, params, options).mustSingle(), defaultValue);
    }
}
export async function connectAndMirror(db) {
    const { database, host, port, accessKey, schema } = db;
    const remoteDb = await skdbDevServerDb(database, host, port);
    await remoteDb.schema(schemaToText(schema));
    const localDb = await createLocalDbConnectedTo(remoteDb, accessKey);
    await localDb.mirror(...schemaToMirrorDfns(schema));
    return new ConnectedDB(schema, localDb);
}
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
//# sourceMappingURL=typed-skdb.js.map
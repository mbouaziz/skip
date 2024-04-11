import { skdbDevServerDb, createLocalDbConnectedTo } from "skdb-dev";
import * as React from "react";
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
function logQuery(kind, query, params) {
    const p = params === undefined || Object.keys(params).length === 0 ?
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
function getMustVal(maybeVal) { return getMust("value", maybeVal); }
function scalarFieldName(expr) {
    // @ts-ignore
    return expr === "COUNT" ? "col<0>" : expr;
}
function getMaybeScalar(expr, maybeRow) {
    return maybeRow?.[scalarFieldName(expr)];
}
export class ConnectedDB {
    schema;
    localDb;
    constructor(schema, localDb) {
        this.schema = schema;
        this.localDb = localDb;
    }
    async exec(query, params) {
        logQuery("EXEC", query, params);
        return await this.localDb.exec(query, params);
    }
    async watch(query, params, onChange) {
        logQuery("WATCH", query, params);
        return await this.localDb.watch(query, params, onChange);
    }
    async watchChanges(query, params, init, update) {
        logQuery("WATCH CHANGES", query, params);
        return await this.localDb.watchChanges(query, params, init, update);
    }
    async execTransac(preps) {
        const q = preps.map(([q, _p]) => q).join("; ");
        const p = preps.map(([_q, p]) => p).reduce((prev, cur) => ({ ...prev, ...cur }));
        return this.exec(q, p);
    }
    prepareInsert(table, row) {
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        const colParams = this.schema[table].map(([colName]) => `@${colName}`).join(", ");
        const query = `INSERT INTO ${table} (${cols}, skdb_access) VALUES (${colParams}, 'read-write');`;
        return [query, row];
    }
    async insert(table, row) {
        const [q, p] = this.prepareInsert(table, row);
        return await this.exec(q, p);
    }
    prepareDelete(table, where = "", params) {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return [query, params];
    }
    async delete(table, where, params) {
        const [q, p] = this.prepareDelete(table, where, params);
        return await this.exec(q, p);
    }
    async update(table, row, where = "", params = {}) {
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
        return await this.exec(query, allParams);
    }
    async insertOrUpdateWithKey(table, rowKey, rowRest) {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        // await this.delete(table, deleteWhere, rowKey as Record<string, ParamValue>);
        const row = { ...rowKey, ...rowRest };
        // await this.insert(table, row as FullRow<S, T>);
        const d = this.prepareDelete(table, deleteWhere, rowKey);
        const i = this.prepareInsert(table, row);
        return await this.execTransac([d, i]);
    }
    buildSelectQuery(table, exprs, where = "", options = {}) {
        const what = exprs.map((e) => (e === "COUNT") ? "COUNT(*)" : e).join(", ");
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
    async select(table, exprs, where, params, options) {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const result = await this.exec(query, params);
        return result;
    }
    async selectMaybeSingle(table, exprs, where, params, options) {
        const rows = await this.select(table, exprs, where, params, options);
        return getMaybeSingleRow(rows);
    }
    async selectSingle(table, exprs, where, params, options) {
        const maybeRow = await this.selectMaybeSingle(table, exprs, where, params, options);
        return getMustRow(maybeRow);
    }
    async selectMaybeScalar(table, expr, where, params, options) {
        const maybeRow = await this.selectMaybeSingle(table, [expr], where, params, options);
        return getMaybeScalar(expr, maybeRow);
    }
    async selectScalar(table, expr, where, params, options) {
        const maybeScalar = await this.selectMaybeScalar(table, expr, where, params, options);
        return getMustVal(maybeScalar);
    }
    async watchSelect(table, exprs, where, params, onChange, options) {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const castedChange = (rows) => onChange.bind(this)(rows);
        return await this.watch(query, params, castedChange);
    }
    async watchSelectChanges(table, exprs, where, params, init, update, options) {
        const query = this.buildSelectQuery(table, exprs, where, options);
        const castedInit = (rows) => init.bind(this)(rows);
        const castedUpdate = (added, removed) => update.bind(this)(added, removed);
        return await this.watchChanges(query, params, castedInit, castedUpdate);
    }
    useSelect(table, exprs, where = "", params = {}, defaultRows = [], options = {}) {
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
    useSelectMaybeSingle(table, exprs, where, params, defaultRow, options) {
        const defaultRows = defaultRow === undefined ? undefined : [defaultRow];
        return getMaybeSingleRow(this.useSelect(table, exprs, where, params, defaultRows, options));
    }
    useSelectSingle(table, exprs, where, params, defaultRow, options) {
        return getMustRow(this.useSelectMaybeSingle(table, exprs, where, params, defaultRow, options));
    }
    useSelectMaybeScalar(table, expr, where, params, defaultValue, options) {
        const defaultRow = defaultValue === undefined ? undefined : { [expr]: defaultValue };
        return getMaybeScalar(expr, this.useSelectMaybeSingle(table, [expr], where, params, defaultRow, options));
    }
    useSelectScalar(table, expr, where, params, defaultValue, options) {
        return getMustVal(this.useSelectMaybeScalar(table, expr, where, params, defaultValue, options));
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
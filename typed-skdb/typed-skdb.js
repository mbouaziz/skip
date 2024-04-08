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
export class ConnectedDB {
    schema;
    localDb;
    constructor(schema, localDb) {
        this.schema = schema;
        this.localDb = localDb;
    }
    async exec(query, params = undefined) {
        const p = params === undefined ? "" : " with " + Object.entries(params).map(([k, v]) => `${k} => ${v}`).join(", ");
        // @ts-ignore
        console.log(`EXEC: ${query}${p};`);
        return await this.localDb.exec(query, params);
    }
    async insert(table, row) {
        const cols = this.schema[table].map(([colName]) => colName).join(", ");
        const colParams = this.schema[table].map(([colName]) => `@${colName}`).join(", ");
        const query = `INSERT INTO ${table} (${cols}, skdb_access) VALUES (${colParams}, 'read-write');`;
        return await this.exec(query, row);
    }
    async delete(table, where, params) {
        const queryParts = ["DELETE FROM"];
        queryParts.push(table);
        if (where !== null && where !== "") {
            queryParts.push("WHERE");
            queryParts.push(where);
        }
        const query = queryParts.join(" ");
        return await this.exec(query, params);
    }
    async update(table, row, where, params) {
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
        let paramsRecord;
        if (params === undefined) {
            paramsRecord = {};
        }
        else if (params instanceof Map) {
            paramsRecord = Object.fromEntries(params);
        }
        else {
            paramsRecord = params;
        }
        const allParams = { ...paramsRecord, ...row };
        return await this.exec(query, allParams);
    }
    async insertOrUpdateWithKey(table, rowKey, rowRest) {
        const deleteWhere = Object.keys(rowKey).map((colName) => `${colName} = @${colName}`).join(" AND ");
        await this.delete(table, deleteWhere, rowKey);
        const row = { ...rowKey, ...rowRest };
        await this.insert(table, row);
    }
    buildSelectQuery(table, columns, where) {
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
    async watchSelect(table, columns, where, params, onChange) {
        const query = this.buildSelectQuery(table, columns, where);
        const castedChange = (rows) => onChange.bind(this)(rows);
        return await this.localDb.watch(query, params, castedChange);
    }
    async watchSelectChanges(table, columns, where, params, init, update) {
        const query = this.buildSelectQuery(table, columns, where);
        const castedInit = (rows) => init.bind(this)(rows);
        const castedUpdate = (added, removed) => update.bind(this)(added, removed);
        return await this.localDb.watchChanges(query, params, castedInit, castedUpdate);
    }
    useSelect(table, columns, where, params, defaultRows = []) {
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
    useSelectMaybeSingle(table, columns, where, params, defaultRow = undefined) {
        const defaultRows = defaultRow === undefined ? undefined : [defaultRow];
        const rows = this.useSelect(table, columns, where, params, defaultRows);
        if (rows.length > 1) {
            throw new Error(`Can't extract only row, got ${rows.length} rows`);
        }
        return rows[0];
    }
    useSelectSingle(table, columns, where, params, defaultRow) {
        const maybeRow = this.useSelectMaybeSingle(table, columns, where, params, defaultRow);
        if (maybeRow === undefined) {
            throw new Error(`Can't extract only row, got no rows`);
        }
        return maybeRow;
    }
    useSelectMaybeScalar(table, column, where, params, defaultValue = undefined) {
        const defaultRow = defaultValue === undefined ? undefined : { [column]: defaultValue };
        const row = this.useSelectMaybeSingle(table, [column], where, params, defaultRow);
        return row === undefined ? undefined : row[column];
    }
    useSelectScalar(table, column, where, params, defaultValue) {
        const maybeValue = this.useSelectMaybeScalar(table, column, where, params, defaultValue);
        if (maybeValue === undefined) {
            throw new Error(`Can't extract only value, got no values`);
        }
        return maybeValue;
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
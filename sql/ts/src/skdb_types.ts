import type { Shared } from "@skip-wasm/std";
import { SKDBTable } from "./skdb_util.js";

export interface SKDBHandle {
  readonly runner: (fn: () => string) => SKDBTable;
  readonly main: (new_args: string[], new_stdin: string) => string;
  readonly watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => { close: () => void };
  readonly watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => { close: () => void };
}

export type MirrorDefn = {
  readonly table: string;
  readonly expectedColumns: string;
  readonly filterExpr?: string;
  readonly filterParams?: Params;
};

export interface SKDBSync {
  // CLIENT
  readonly exec: (query: string, params?: Params) => SKDBTable;
  readonly watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => { close: () => void };
  readonly watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => { close: () => void };
  readonly insert: (tableName: string, values: any[]) => boolean;
  readonly insertMany: (
    tableName: string,
    valuesArray: Record<string, any>[],
  ) => number | Error;

  readonly tableSchema: (tableName: string) => string;
  readonly viewSchema: (viewName: string) => string;
  readonly schema: (tableName?: string) => string;
  readonly subscribe: (viewName: string, f: (change: string) => void) => void;
  readonly save: () => Promise<boolean>;

  // SERVER
  readonly connect: (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => Promise<void>;
  readonly mirror: (...tables: MirrorDefn[]) => Promise<void>;

  readonly connectedRemote?: RemoteSKDB;
  readonly createServerDatabase: (
    dbName: string,
  ) => Promise<ProtoResponseCreds>;
  readonly createServerUser: () => Promise<ProtoResponseCreds>;
  readonly serverExec: (query: string, params?: Params) => Promise<SKDBTable>;
  readonly serverTableSchema: (tableName: string) => Promise<string>;
  readonly serverViewSchema: (tableName: string) => Promise<string>;
  readonly serverSchema: () => Promise<string>;
  readonly serverClose: () => Promise<void>;
}

export interface SKDB {
  readonly exec: (query: string, params?: Params) => Promise<SKDBTable>;
  readonly watch: (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => Promise<{ close: () => Promise<void> }>;
  readonly watchChanges: (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => Promise<{ close: () => Promise<void> }>;

  readonly insertMany: (
    tableName: string,
    valuesArray: Record<string, any>[],
  ) => Promise<number>;

  readonly insert: (tableName: string, valuesArray: any[]) => Promise<boolean>;

  readonly connect: (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => Promise<void>;
  readonly connectedRemote: () => Promise<RemoteSKDB | undefined>;
  readonly closeConnection: () => Promise<void>;

  readonly createGroup: () => Promise<SKDBGroup>;
  readonly lookupGroup: (groupID: string) => Promise<SKDBGroup | undefined>;

  readonly currentUser?: string;

  readonly mirror: (...tables: MirrorDefn[]) => Promise<void>;

  readonly schema: (tableName?: string) => Promise<string>;
  readonly save: () => Promise<boolean>;
}

export interface SKDBMechanism {
  readonly writeCsv: (payload: string, source: string) => void;
  readonly watermark: (replicationUid: string, table: string) => bigint;
  readonly watchFile: (
    fileName: string,
    fn: (change: ArrayBuffer) => void,
  ) => void;
  readonly getReplicationUid: (deviceUuid: string) => string;
  readonly subscribe: (
    replicationUid: string,
    tables: string[],
    updateFile: string,
  ) => string;
  readonly unsubscribe: (session: string) => void;
  readonly diff: (
    session: string,
    watermarks: Map<string, bigint>,
  ) => ArrayBuffer | null;
  readonly tableExists: (tableName: string) => boolean;
  readonly exec: (query: string) => SKDBTable;
  readonly assertCanBeMirrored: (table: string, schema: string) => void;
  readonly toggleView: (tableName: string) => void;
}

export interface Storage {
  save(): Promise<boolean>;
}

export type ProtoResponseCreds = {
  readonly type: "credentials";
  readonly accessKey: string;
  readonly privateKey: Uint8Array;
};

export type Params =
  | Map<string, string | number | boolean | null>
  | Record<string, string | number | boolean | null>;

export interface RemoteSKDB {
  connectedAs(): Promise<string>;

  createUser(): Promise<ProtoResponseCreds>;
  readonly schema: () => Promise<string>;
  readonly tableSchema: (tableName: string) => Promise<string>;
  readonly viewSchema: (viewName: string) => Promise<string>;

  readonly createDatabase: (dbName: string) => Promise<ProtoResponseCreds>;

  readonly mirror: (...tables: MirrorDefn[]) => Promise<void>;
  readonly exec: (query: string, params?: Params) => Promise<SKDBTable>;

  readonly isConnectionHealthy: () => Promise<boolean>;
  readonly tablesAwaitingSync: () => Promise<Set<string>>;

  readonly onReboot: (fn: () => void) => Promise<void>;

  close(): Promise<void>;
}

export type Page = { readonly pageid: number; readonly content: any };

export interface PagedMemory {
  init(fn: (page: Page) => void): void;
  restore(pages: Page[]): void;
  clear(): void;
  update(): void;
  getPages(): Promise<Page[]>;
}

export interface SKDBShared extends Shared {
  readonly create: (dbName?: string, asWorker?: boolean) => Promise<SKDB>;
  readonly createSync: (
    dbName?: string,
    asWorker?: boolean,
  ) => Promise<SKDBSync>;
  readonly notify: () => void;
}

export interface SKDBGroup {
  readonly ownerGroupID: string;
  readonly adminGroupID: string;
  readonly groupID: string;

  readonly setDefaultPermission: (perm: string) => Promise<void>;
  readonly setMemberPermission: (userID: string, perm: string) => Promise<void>;

  readonly addAdmin: (userID: string) => Promise<void>;
  readonly removeAdmin: (userID: string) => Promise<void>;

  readonly addOwner: (userID: string) => Promise<void>;
  readonly removeOwner: (userID: string) => Promise<void>;
  readonly transferOwnership: (userID: string) => Promise<void>;

  readonly removeMember: (userID: string) => Promise<void>;
}

export interface SKDBTransaction {
  readonly add: (stmt: string) => SKDBTransaction;
  readonly addParams: (params: Params) => SKDBTransaction;
  readonly commit: (additionalParams?: Params) => Promise<SKDBTable>;
}

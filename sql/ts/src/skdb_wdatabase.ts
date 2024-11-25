import type { Wrk } from "@skip-wasm/std";
import {
  PromiseWorker,
  Function,
  Caller,
  Wrapped,
} from "@skip-wasm/std/worker.js";
import type {
  SKDB,
  ProtoResponseCreds,
  Params,
  RemoteSKDB,
  MirrorDefn,
  SKDBGroup,
} from "./skdb_types.js";
import { SKDBTable } from "./skdb_util.js";
import { SKDBGroupImpl } from "./skdb_group.js";

/* eslint-disable @typescript-eslint/no-invalid-void-type */

class WrappedRemote implements RemoteSKDB {
  constructor(
    private readonly worker: PromiseWorker,
    private readonly wrapped: number,
  ) {}

  createDatabase(dbName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "createDatabase", [dbName]))
      .send<ProtoResponseCreds>();
  }

  createUser() {
    return this.worker
      .post(new Caller(this.wrapped, "createUser", []))
      .send<ProtoResponseCreds>();
  }

  schema() {
    return this.worker
      .post(new Caller(this.wrapped, "schema", []))
      .send<string>();
  }

  tableSchema(tableName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "tableSchema", [tableName]))
      .send<string>();
  }

  notifyConnectedAs(userName: string, replicationId: string) {
    return this.worker
      .post(
        new Caller(this.wrapped, "notifyConnectedAs", [
          userName,
          replicationId,
        ]),
      )
      .send();
  }

  viewSchema(viewName: string) {
    return this.worker
      .post(new Caller(this.wrapped, "viewSchema", [viewName]))
      .send<string>();
  }

  mirror(...tables: MirrorDefn[]) {
    return this.worker
      .post(new Caller(this.wrapped, "mirror", tables))
      .send<void>();
  }

  exec(query: string, params?: Params) {
    return this.worker
      .post(new Caller(this.wrapped, "exec", [query, params]))
      .send<Record<string, any>[]>()
      .then((rows) => new SKDBTable(...rows));
  }

  close() {
    return this.worker
      .post(new Caller(this.wrapped, "close", [], true))
      .send<void>();
  }

  isConnectionHealthy() {
    return this.worker
      .post(new Caller(this.wrapped, "isConnectionHealthy", []))
      .send<boolean>();
  }

  tablesAwaitingSync() {
    return this.worker
      .post(new Caller(this.wrapped, "tablesAwaitingSync", []))
      .send<Set<string>>();
  }

  onReboot(fn: () => void): Promise<void> {
    return this.worker.post(new Caller(this.wrapped, "onReboot", [fn])).send();
  }

  connectedAs(): Promise<string> {
    return this.worker.post(new Caller(this.wrapped, "connectedAs", [])).send();
  }
}

export class SKDBWorker implements SKDB {
  private readonly worker: PromiseWorker;

  constructor(worker: Wrk) {
    this.worker = new PromiseWorker(worker);
  }

  readonly create = async (
    dbName?: string,
    disableWarnings: boolean = false,
  ): Promise<void> => {
    return this.worker
      .post(new Function("create", [dbName, disableWarnings]))
      .send();
  };

  readonly exec = async (query: string, params: Params = new Map()) => {
    const rows = await this.worker
      .post(new Function("exec", [query, params]))
      .send<Record<string, any>[]>();
    return new SKDBTable(...rows);
  };

  readonly watch = async (
    query: string,
    params: Params,
    onChange: (rows: SKDBTable) => void,
  ) => {
    const provider = this.worker.post(
      new Function("watch", [query, params, onChange], {
        wrap: true,
        autoremove: true,
      }),
    );
    return provider.send<Wrapped>().then((wrapped) => {
      const close = () =>
        this.worker
          .post(new Caller(wrapped.wrapped, "close", []))
          .send()
          .then(provider.close);
      return { close: close };
    });
  };

  readonly watchChanges = async (
    query: string,
    params: Params,
    init: (rows: SKDBTable) => void,
    update: (added: SKDBTable, removed: SKDBTable) => void,
  ) => {
    const provider = this.worker.post(
      new Function("watchChanges", [query, params, init, update], {
        wrap: true,
        autoremove: true,
      }),
    );
    return provider.send<Wrapped>().then((wrapped) => {
      const close = () =>
        this.worker
          .post(new Caller(wrapped.wrapped, "close", []))
          .send()
          .then(provider.close);
      return { close: close };
    });
  };

  readonly tableSchema = async (tableName: string) => {
    return this.worker
      .post(new Function("tableSchema", [tableName]))
      .send<string>();
  };

  readonly notifyConnectedAs = async (
    userName: string,
    replicationId: string,
  ) => {
    return this.worker
      .post(new Function("notifyConnectedAs", [userName, replicationId]))
      .send<void>();
  };

  readonly viewSchema = async (viewName: string) => {
    return this.worker
      .post(new Function("viewSchema", [viewName]))
      .send<string>();
  };

  readonly schema = async (tableName?: string) => {
    return this.worker.post(new Function("schema", [tableName])).send<string>();
  };

  readonly insert = async (tableName: string, values: unknown[]) => {
    return this.worker
      .post(new Function("insert", [tableName, values]))
      .send<boolean>();
  };

  readonly insertMany = async (
    tableName: string,
    valuesArray: Record<string, unknown>[],
  ) => {
    const result = await this.worker
      .post(new Function("insertMany", [tableName, valuesArray]))
      .send();
    if (result instanceof Error) {
      throw result;
    }
    return result as number;
  };

  readonly save = async () => {
    return this.worker.post(new Function("save", [])).send<boolean>();
  };

  readonly createServerDatabase = async (dbName: string) => {
    return this.worker
      .post(new Function("createServerDatabase", [dbName]))
      .send<ProtoResponseCreds>();
  };

  readonly createServerUser = async () => {
    return this.worker
      .post(new Function("createServerUser", []))
      .send<ProtoResponseCreds>();
  };

  readonly mirror = async (...tables: MirrorDefn[]) => {
    return this.worker.post(new Function("mirror", tables)).send<void>();
  };

  readonly closeConnection = async () => {
    return this.worker.post(new Function("closeConnection", [])).send<void>();
  };

  currentUser?: string;

  readonly connect = async (
    db: string,
    accessKey: string,
    privateKey: CryptoKey,
    endpoint?: string,
  ) => {
    this.currentUser = accessKey;
    return this.worker
      .post(new Function("connect", [db, accessKey, privateKey, endpoint]))
      .send<void>();
  };

  readonly connectedRemote = async () => {
    return this.worker
      .post(
        new Function("connectedRemote", [], { wrap: true, autoremove: false }),
      )
      .send<Wrapped>()
      .then((wrapped) => new WrappedRemote(this.worker, wrapped.wrapped));
  };

  readonly getUser = async () => {
    return this.worker
      .post(new Function("getUser", []))
      .send<string | undefined>();
  };

  readonly createGroup: () => Promise<SKDBGroup> = async () => {
    return SKDBGroupImpl.create(this);
  };

  readonly lookupGroup: (groupID: string) => Promise<SKDBGroup | undefined> =
    async (groupID: string) => {
      return SKDBGroupImpl.lookup(this, groupID);
    };
}

/* eslint-enable @typescript-eslint/no-invalid-void-type */

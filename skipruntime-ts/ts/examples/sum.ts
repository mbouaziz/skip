import type { UUID } from "crypto";
import type {
  SKStore,
  TJSON,
  Mapper,
  EagerCollection,
  NonEmptyIterator,
  SimpleSkipService,
  SimpleServiceOutput,
  JSONObject,
  Writer,
} from "skip-runtime";

import { runWithServer } from "skip-runtime";

class Request implements Mapper<string, TJSON, string, TJSON> {
  constructor(private source: EagerCollection<string, TJSON>) {}

  mapElement(
    key: string,
    it: NonEmptyIterator<TJSON>,
  ): Iterable<[string, TJSON]> {
    const v = it.first() as JSONObject;
    let computed = 0;
    if (v.command == "add") {
      const value = this.source.maybeGetOne(v.payload as string) as number;
      computed = value ? value : 0;
    }
    return Array([key, computed]);
  }
}

class Add implements Mapper<string, TJSON, string, TJSON> {
  constructor(private other: EagerCollection<string, TJSON>) {}

  mapElement(
    key: string,
    it: NonEmptyIterator<TJSON>,
  ): Iterable<[string, TJSON]> {
    const v = it.first() as number;
    const ev = this.other.maybeGetOne(key) as number;
    if (ev !== null) {
      return Array([key, v + (ev ?? 0)]);
    }
    return Array();
  }
}

type Command = {
  command: string;
  payload: TJSON;
};

type Set = { name: string; key: string; value: number };
type Delete = { name: string; keys: string[] };

class SortPost extends .... {
  constructor(private votes);

  mapElement(key: UUID, posts: NonEmptyIterator<{date;message}>) {
    const post = posts.uniqueValue();
    return [[[-(this.votes.maybeGetOne(key) ?? 0), -post.date], key]];
  }
}

class HackerNews implements SimpleSkipService {
  inputTables = ["posts", "votes"]; // uuid -> date, message | uuid -> upvotes

  async init(tables: Record<string, Writer<TJSON[]>>) {
    console.log("Init called with tables", Object.keys(tables));
  }
  
  reactiveCompute(
    _store,
    inputCollections: {posts: EagerCollection<UUID, {date;message}>, votes: EagerCollection<UUID, int>}
  ) {
    const {posts, votes} = inputCollections;
    const sortedPosts = posts.map(SortPost, votes);
    return {sortedPosts};
  }

  getRequests = {last: {schema:...; f:GetLast}, message: GetMessage};
}

runWithServer(new Service(), { port: 8081 });

  // POST newMessage(message) -> uuid
  // POST upvote(uuid) -> void

  // GET last(n) -> uuid[]
  // GET message(uuid) -> date, message

class GetLast extends ... {
  constructor(private n:int) {

  }

  reactiveCompute(_store,
    inputCollections:..., {sortedPosts}
  ) {
    return sortedPosts.take(n)
  }
}


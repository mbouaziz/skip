import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { connectAndMirror } from "typed-skdb";
import { schema } from "./schema.ts";

const skdb = await connectAndMirror({
  database: "mappings",
  schema,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App skdb={skdb} />
  </React.StrictMode>,
);

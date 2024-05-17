import * as vscode from "vscode";
import * as which from "which";
import { execSync } from "child_process";

function formatSkipFile(fileName: string): void {
  const skfmt = which.sync("skfmt");
  execSync(`"${skfmt} -i < "${fileName}"`, { stdio: "inherit" });
}

const documentFormattingEditProvider = {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.TextEdit[] {
    vscode.window.showInformationMessage("Hello World from skip!");

    formatSkipFile(document.fileName);

    return [];
  },
};

export function activate(context: vscode.ExtensionContext) {
  console.log("Skip extension is alive!");

  const disposable = vscode.languages.registerDocumentFormattingEditProvider(
    { scheme: "file", language: "skip" },
    documentFormattingEditProvider,
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {
  console.log("Shutting down Skip extension");
}

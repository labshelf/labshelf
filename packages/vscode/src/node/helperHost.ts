// Runs the LaTeX helper as the native-messaging host the browser starts through VS Code's launcher.
import { runHelperScriptHost } from "@labshelf/core/helper/node";

runHelperScriptHost("vscode");

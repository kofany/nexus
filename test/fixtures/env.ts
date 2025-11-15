import path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const home = path.join(__dirname, ".nexusirc");

import config from "../../dist/server/config.js";
// setHome() is now async due to ESM dynamic import() requirement
await config.setHome(home);

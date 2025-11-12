import path from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const home = path.join(__dirname, ".nexuslounge");

import config from "../../dist/server/config.js";
config.setHome(home);

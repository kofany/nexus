import * as path from "path";
const home = path.join(__dirname, ".nexuslounge");

import config from "../../server/config";
config.setHome(home);

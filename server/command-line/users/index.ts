import Config from "../../config.js";
import list from "./list.js";
import remove from "./remove.js";
import edit from "./edit.js";
import add from "./add.js";
import reset from "./reset.js";

const commands = [list, remove, edit];

if (!Config.values.ldap.enable) {
    commands.push(add, reset);
}

export default commands;

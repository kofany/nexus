import log from "../log.js";
import chalk from "chalk";
import semver from "semver";
import Helper from "../helper.js";
import Config from "../config.js";
import Utils from "./utils.js";
import {Command} from "commander";
import {FullMetadata} from "package-json";

type CustomMetadata = FullMetadata & {
    nexusirc: {
        supports: string;
    };
    version?: string;
};

const program = new Command("install");
program
    .argument(
        "<package>",
        "package to install. Use `file:$path_to_package_dir` to install a local package"
    )
    .description("Install a theme or a package")
    .on("--help", Utils.extraHelp)
    .action(async function (packageName: string) {
        const fs = await import("fs");
        const fspromises = fs.promises;
        const path = await import("path");
        const packageJson = await import("package-json");

        if (!fs.existsSync(Config.getConfigPath())) {
            log.error(`${Config.getConfigPath()} does not exist.`);
            return;
        }

        log.info("Retrieving information about the package...");
        // TODO: type
        let readFile: any = null;
        let isLocalFile = false;

        if (packageName.startsWith("file:")) {
            isLocalFile = true;
            // our yarn invocation sets $HOME to the cachedir, so we must expand ~ now
            // else the path will be invalid when npm expands it.
            packageName = expandTildeInLocalPath(packageName);
            readFile = fspromises
                .readFile(path.join(packageName.substring("file:".length), "package.json"), "utf-8")
                .then((data) => JSON.parse(data) as typeof packageJson);
        } else {
            // properly split scoped and non-scoped npm packages
            // into their name and version
            let packageVersion = "latest";
            const atIndex = packageName.indexOf("@", 1);

            if (atIndex !== -1) {
                packageVersion = packageName.slice(atIndex + 1);
                packageName = packageName.slice(0, atIndex);
            }

            readFile = (packageJson.default || packageJson)(packageName, {
                fullMetadata: true,
                version: packageVersion,
            });
        }

        if (!readFile) {
            // no-op, error should've been thrown before this point
            return;
        }

        readFile
            .then((json: CustomMetadata) => {
                const humanVersion = isLocalFile ? packageName : `${json.name} v${json.version}`;

                if (!("nexusirc" in json)) {
                    log.error(`${chalk.red(humanVersion)} does not have NexusIRC metadata.`);

                    process.exit(1);
                }

                if (
                    json.nexusirc.supports &&
                    !semver.satisfies(Helper.getVersionNumber(), json.nexusirc.supports, {
                        includePrerelease: true,
                    })
                ) {
                    log.error(
                        `${chalk.red(
                            humanVersion
                        )} does not support NexusIRC v${Helper.getVersionNumber()}. Supported version(s): ${
                            json.nexusirc.supports
                        }`
                    );

                    process.exit(2);
                }

                log.info(`Installing ${chalk.green(humanVersion)}...`);
                const yarnVersion = isLocalFile ? packageName : `${json.name}@${json.version}`;
                return Utils.executeYarnCommand("add", "--exact", yarnVersion)
                    .then(() => {
                        log.info(`${chalk.green(humanVersion)} has been successfully installed.`);

                        if (isLocalFile) {
                            // yarn v1 is buggy if a local filepath is used and doesn't update
                            // the lockfile properly. We need to run an install in that case
                            // even though that's supposed to be done by the add subcommand
                            return Utils.executeYarnCommand("install").catch((err) => {
                                throw `Failed to update lockfile after package install ${err}`;
                            });
                        }
                    })
                    .catch((code) => {
                        throw `Failed to install ${chalk.red(humanVersion)}. Exit code: ${code}`;
                    });
            })
            .catch((e) => {
                log.error(`${e}`);
                process.exit(1);
            });
    });

function expandTildeInLocalPath(packageName: string): string {
    const path = packageName.substring("file:".length);
    return "file:" + Helper.expandHome(path);
}

export default program;

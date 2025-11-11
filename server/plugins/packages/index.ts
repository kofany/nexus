import _ from "lodash";
import log from "../../log.js";
import colors from "chalk";
import path from "path";
import semver from "semver";
import Helper from "../../helper.js";
import Config from "../../config.js";
import themes from "./themes.js";
import fs from "fs";
import Utils from "../../command-line/utils.js";
import {IrssiClient} from "../../irssiClient.js";
import {createRequire} from "module";

const require = createRequire(import.meta.url);

type Package = {
    onServerStart: (packageApis: any) => void;
};

const packageMap = new Map<string, Package>();

export type PackageInfo = {
    packageName: string;
    nexuslounge?: {supports: string};
    version: string;
    type?: string;
    files?: string[];
    // Legacy support
    name?: string;
};

const stylesheets: string[] = [];
const files: string[] = [];

const TIME_TO_LIVE = 15 * 60 * 1000; // 15 minutes, in milliseconds

const cache = {
    outdated: undefined,
};

let experimentalWarningPrinted = false;

export default {
    getFiles,
    getStylesheets,
    getPackage,
    loadPackages,
    outdated,
};

// TODO: verify binds worked. Used to be 'this' instead of 'packageApis'
const packageApis = function (packageInfo: PackageInfo) {
    const addStylesheetForPackage = (filename: string) => addStylesheet(packageInfo.packageName, filename);
    const addPublicFileForPackage = (filename: string) => addFile(packageInfo.packageName, filename);
    const getStorageDirForPackage = () => getPersistentStorageDir(packageInfo.packageName);

    return {
        Stylesheets: {
            addFile(filename: string) {
                addStylesheetForPackage(filename);
            },
        },
        PublicFiles: {
            add(filename: string) {
                addPublicFileForPackage(filename);
            },
        },
        Commands: {
            // SINGLE MODE: Command plugins not supported (no inputs system)
            add() {
                log.warn(`[${packageInfo.packageName}] Command registration not supported in irssi proxy mode`);
            },
            runAsUser(command: string, targetId: number, client: IrssiClient) {
                // In irssi proxy mode, send command directly to irssi
                log.warn(`[${packageInfo.packageName}] runAsUser not implemented for irssi proxy mode`);
            },
        },
        Config: {
            getConfig() {
                return Config.values;
            },
            getPersistentStorageDir() {
                return getStorageDirForPackage();
            },
        },
        Logger: {
            error(...args: string[]) {
                log.error(`[${packageInfo.packageName}]`, ...args);
            },
            warn(...args: string[]) {
                log.warn(`[${packageInfo.packageName}]`, ...args);
            },
            info(...args: string[]) {
                log.info(`[${packageInfo.packageName}]`, ...args);
            },
            debug(...args: string[]) {
                log.debug(`[${packageInfo.packageName}]`, ...args);
            },
        },
    };
};

function addStylesheet(packageName: string, filename: string) {
    stylesheets.push(packageName + "/" + filename);
}

function getStylesheets() {
    return stylesheets;
}

function addFile(packageName: string, filename: string) {
    files.push(packageName + "/" + filename);
}

function getFiles() {
    return files.concat(stylesheets);
}

function getPackage(name: string) {
    return packageMap.get(name);
}

function getEnabledPackages(packageJson: string) {
    try {
        const json = JSON.parse(fs.readFileSync(packageJson, "utf-8"));
        return Object.keys(json.dependencies);
    } catch (e: any) {
        log.error(`Failed to read packages/package.json: ${colors.red(e)}`);
    }

    return [];
}

function getPersistentStorageDir(packageName: string) {
    const dir = path.join(Config.getPackagesPath(), packageName);
    fs.mkdirSync(dir, {recursive: true}); // we don't care if it already exists or not
    return dir;
}

function loadPackage(packageName: string) {
    let packageInfo: PackageInfo;
    // TODO: type
    let packageFile: Package;

    try {
        const packagePath = Config.getPackageModulePath(packageName);

        packageInfo = JSON.parse(fs.readFileSync(path.join(packagePath, "package.json"), "utf-8"));

        if (!packageInfo.nexuslounge) {
            throw "'nexuslounge' is not present in package.json";
        }

        if (
            packageInfo.nexuslounge.supports &&
            !semver.satisfies(Helper.getVersionNumber(), packageInfo.nexuslounge.supports, {
                includePrerelease: true, // our pre-releases should respect the semver guarantees
            })
        ) {
            throw `v${packageInfo.version} does not support this version of Nexus Lounge. Supports: ${packageInfo.nexuslounge.supports}`;
        }

        packageFile = require(packagePath);
    } catch (e: any) {
        log.error(`Package ${colors.bold(packageName)} could not be loaded: ${colors.red(e)}`);

        if (e instanceof Error) {
            log.debug(e.stack ? e.stack : e.message);
        }

        return;
    }

    const version = packageInfo.version;
    packageInfo = {
        ...packageInfo.nexuslounge,
        packageName: packageName,
        version,
    };

    packageMap.set(packageName, packageFile);

    if (packageInfo.type === "theme") {
        // @ts-expect-error Argument of type 'PackageInfo' is not assignable to parameter of type 'ThemeModule'.
        themes.addTheme(packageName, packageInfo);

        if (packageInfo.files) {
            packageInfo.files.forEach((file) => addFile(packageName, file));
        }
    }

    if (packageFile.onServerStart) {
        packageFile.onServerStart(packageApis(packageInfo));
    }

    log.info(`Package ${colors.bold(packageName)} ${colors.green("v" + version)} loaded`);

    if (packageInfo.type !== "theme" && !experimentalWarningPrinted) {
        experimentalWarningPrinted = true;

        log.info(
            "There are packages using the experimental plugin API. " +
                "Be aware that this API is not yet stable and may change in future Nexus Lounge releases."
        );
    }
}

function loadPackages() {
    const packageJson = path.join(Config.getPackagesPath(), "package.json");
    const packages = getEnabledPackages(packageJson);

    packages.forEach(loadPackage);

    watchPackages(packageJson);
}

function watchPackages(packageJson: string) {
    fs.watch(
        packageJson,
        {
            persistent: false,
        },
        _.debounce(
            () => {
                const updated = getEnabledPackages(packageJson);

                for (const packageName of updated) {
                    if (packageMap.has(packageName)) {
                        continue;
                    }

                    loadPackage(packageName);
                }
            },
            1000,
            {maxWait: 10000}
        )
    );
}

async function outdated(cacheTimeout = TIME_TO_LIVE) {
    if (cache.outdated !== undefined) {
        return cache.outdated;
    }

    // Get paths to the location of packages directory
    const packagesPath = Config.getPackagesPath();
    const packagesConfig = path.join(packagesPath, "package.json");
    const packagesList = JSON.parse(fs.readFileSync(packagesConfig, "utf-8")).dependencies;
    const argsList = [
        "outdated",
        "--latest",
        "--json",
        "--production",
        "--ignore-scripts",
        "--cwd",
        packagesPath,
    ];

    // Check if the configuration file exists
    if (!Object.entries(packagesList).length) {
        // CLI calls outdated with zero TTL, so we can print the warning there
        if (!cacheTimeout) {
            log.warn("There are no packages installed.");
        }

        return false;
    }

    const command = argsList.shift();
    const params = argsList;

    if (!command) {
        return;
    }

    // If we get an error from calling outdated and the code isn't 0, then there are no outdated packages
    // TODO: was (...argsList), verify this works
    await Utils.executeYarnCommand(command, ...params)
        .then(() => updateOutdated(false))
        .catch((code) => updateOutdated(code !== 0));

    if (cacheTimeout > 0) {
        setTimeout(() => {
            delete cache.outdated;
        }, cacheTimeout);
    }

    return cache.outdated;
}

function updateOutdated(outdatedPackages) {
    cache.outdated = outdatedPackages;
}

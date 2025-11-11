import {Client} from "ldapts";
import colors from "chalk";

import log from "../../log.js";
import Config from "../../config.js";
import type {AuthHandler} from "../auth.js";

async function ldapAuthCommon(bindDN: string, password: string): Promise<boolean> {
	const config = Config.values;

	const client = new Client({
		url: config.ldap.url,
		tlsOptions: config.ldap.tlsOptions,
	});

	try {
		await client.bind(bindDN, password);
		return true;
	} catch (err) {
		log.error(`LDAP bind failed: ${(err as Error).toString()}`);
		return false;
	} finally {
		await client.unbind().catch(() => {
			// Ignore unbind errors
		});
	}
}

async function simpleLdapAuth(user: string, password: string): Promise<boolean> {
	if (!user || !password) {
		return false;
	}

	const config = Config.values;

	const userDN = user.replace(/([,\\/#+<>;"= ])/g, "\\$1");
	const bindDN = `${config.ldap.primaryKey}=${userDN},${config.ldap.baseDN || ""}`;

	log.info(`Auth against LDAP ${config.ldap.url} with provided bindDN ${bindDN}`);

	return ldapAuthCommon(bindDN, password);
}

/**
 * LDAP auth using initial DN search (see config comment for ldap.searchDN)
 */
async function advancedLdapAuth(user: string, password: string): Promise<boolean> {
	if (!user || !password) {
		return false;
	}

	const config = Config.values;
	const userDN = user.replace(/([,\\/#+<>;"= ])/g, "\\$1");

	const client = new Client({
		url: config.ldap.url,
		tlsOptions: config.ldap.tlsOptions,
	});

	try {
		await client.bind(config.ldap.searchDN.rootDN, config.ldap.searchDN.rootPassword);
	} catch (err) {
		log.error("Invalid LDAP root credentials");
		await client.unbind().catch(() => {
			// Ignore unbind errors
		});
		return false;
	}

	try {
		const searchOptions = {
			scope: config.ldap.searchDN.scope,
			filter: `(&(${config.ldap.primaryKey}=${userDN})${config.ldap.searchDN.filter})`,
			attributes: ["dn"],
		};

		const {searchEntries} = await client.search(config.ldap.searchDN.base, searchOptions);

		if (!searchEntries || searchEntries.length === 0) {
			log.warn(`LDAP Search did not find anything for: ${userDN}`);
			await client.unbind().catch(() => {
				// Ignore unbind errors
			});
			return false;
		}

		const bindDN = searchEntries[0].dn;
		log.info(`Auth against LDAP ${config.ldap.url} with found bindDN ${bindDN}`);

		await client.unbind().catch(() => {
			// Ignore unbind errors
		});

		return ldapAuthCommon(bindDN, password);
	} catch (err) {
		log.warn(`LDAP User not found: ${userDN}`);
		await client.unbind().catch(() => {
			// Ignore unbind errors
		});
		return false;
	}
}

const ldapAuth: AuthHandler = (manager, client, user, password, callback) => {
	// TODO: Enable the use of starttls() as an alternative to ldaps

	// TODO: move this out of here and get rid of `manager` and `client` in
	// auth plugin API
	function callbackWrapper(valid: boolean) {
		if (valid && !client) {
			manager.addUser(user, null, true);
		}

		callback(valid);
	}

	let auth: typeof simpleLdapAuth | typeof advancedLdapAuth;

	if ("baseDN" in Config.values.ldap) {
		auth = simpleLdapAuth;
	} else {
		auth = advancedLdapAuth;
	}

	auth(user, password)
		.then(callbackWrapper)
		.catch((err) => {
			log.error(`Unexpected LDAP auth error: ${(err as Error).toString()}`);
			callbackWrapper(false);
		});
};

/**
 * Use the LDAP filter from config to check that users still exist before loading them
 * via the supplied callback function.
 */

async function advancedLdapLoadUsers(users: string[], callbackLoadUser) {
	const config = Config.values;

	const client = new Client({
		url: config.ldap.url,
		tlsOptions: config.ldap.tlsOptions,
	});

	try {
		await client.bind(config.ldap.searchDN.rootDN, config.ldap.searchDN.rootPassword);

		const remainingUsers = new Set(users);

		const searchOptions = {
			scope: config.ldap.searchDN.scope,
			filter: `${config.ldap.searchDN.filter}`,
			attributes: [config.ldap.primaryKey],
			paged: true,
		};

		const {searchEntries} = await client.search(config.ldap.searchDN.base, searchOptions);

		for (const entry of searchEntries) {
			const attribute = entry[config.ldap.primaryKey];

			if (attribute) {
				const user = Array.isArray(attribute) ? attribute[0] : attribute;
				const userString = typeof user === "string" ? user : String(user);

				if (remainingUsers.has(userString)) {
					remainingUsers.delete(userString);
					callbackLoadUser(userString);
				}
			}
		}

		remainingUsers.forEach((user) => {
			log.warn(
				`No account info in LDAP for ${colors.bold(user)} but user config file exists`
			);
		});
	} catch (err) {
		log.error(`LDAP search error: ${(err as Error).toString()}`);
	} finally {
		await client.unbind().catch(() => {
			// Ignore unbind errors
		});
	}

	return true;
}

function ldapLoadUsers(users: string[], callbackLoadUser) {
	if ("baseDN" in Config.values.ldap) {
		// simple LDAP case can't test for user existence without access to the
		// user's unhashed password, so indicate need to fallback to default
		// loadUser behaviour by returning false
		return false;
	}

	advancedLdapLoadUsers(users, callbackLoadUser).catch((err) => {
		log.error(`Unexpected error loading LDAP users: ${(err as Error).toString()}`);
	});

	return true;
}

function isLdapEnabled() {
	return !Config.values.public && Config.values.ldap.enable;
}

export default {
	moduleName: "ldap",
	auth: ldapAuth,
	isEnabled: isLdapEnabled,
	loadUsers: ldapLoadUsers,
};

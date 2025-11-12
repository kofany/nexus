import constants from "./constants";

import {createRouter, createWebHashHistory} from "vue-router";
import SignIn from "../components/Windows/SignIn.vue";
import Settings from "../components/Windows/Settings.vue";
import Help from "../components/Windows/Help.vue";
import Changelog from "../components/Windows/Changelog.vue";
import NetworkManager from "../components/Windows/NetworkManager.vue";
import SearchResults from "../components/Windows/SearchResults.vue";
import RoutedChat from "../components/RoutedChat.vue";
import {store} from "./store";

import AppearanceSettings from "../components/Settings/Appearance.vue";
import GeneralSettings from "../components/Settings/General.vue";
import AccountSettings from "../components/Settings/Account.vue";
import NotificationSettings from "../components/Settings/Notifications.vue";
import IrssiConnectionSettings from "../components/Settings/IrssiConnection.vue";
import WeeChatRelaySettings from "../components/Settings/WeeChatRelay.vue";
import {ClientChan} from "./types";

const router = createRouter({
	history: createWebHashHistory(),
	routes: [
		{
			path: "/",
			redirect: "/sign-in",
		},
		{
			name: "SignIn",
			path: "/sign-in",
			component: SignIn,
			beforeEnter(to, from, next) {
				// Prevent navigating to sign-in when already signed in
				if (store.state.appLoaded) {
					next(false);
					return;
				}

				next();
			},
		},
		{
			name: "NetworkManager",
			path: "/network-manager",
			component: NetworkManager,
		},
		{
			path: "/settings",
			component: Settings,
			children: [
				{
					name: "General",
					path: "",
					component: GeneralSettings,
				},
				{
					name: "Appearance",
					path: "appearance",
					component: AppearanceSettings,
				},
				{
					name: "Notifications",
					path: "notifications",
					component: NotificationSettings,
				},
				{
					name: "IrssiConnection",
					path: "irssi",
					component: IrssiConnectionSettings,
				},
				{
					name: "WeeChatRelay",
					path: "weechat",
					component: WeeChatRelaySettings,
				},
				{
					name: "Account",
					path: "account",
					component: AccountSettings,
					props: true,
				},
			],
		},
		{
			name: "Help",
			path: "/help",
			component: Help,
		},
		{
			name: "Changelog",
			path: "/changelog",
			component: Changelog,
		},
		{
			name: "RoutedChat",
			path: "/chan-:id",
			component: RoutedChat,
		},
		{
			name: "SearchResults",
			path: "/chan-:id/search",
			component: SearchResults,
		},
	],
});

router.beforeEach((to, from, next) => {
	// If user is not yet signed in, wait for appLoaded state to change
	// unless they are trying to open SignIn (which can be triggered in auth.js)
	if (!store.state.appLoaded && to.name !== "SignIn") {
		store.watch(
			(state: typeof store.state): boolean => state.appLoaded,
			() => next()
		);

		return;
	}

	next();
});

router.beforeEach((to, from) => {
	// Disallow navigating to non-existing routes
	if (!to.matched.length) {
		return false;
	}

	// Disallow navigating to invalid channels
	if (to.name === "RoutedChat" && !store.getters.findChannel(Number(to.params.id))) {
		return false;
	}

	return true;
});

router.afterEach((to) => {
	if (store.state.appLoaded) {
		if (window.innerWidth <= constants.mobileViewportPixels) {
			store.commit("sidebarOpen", false);
		}
	}

	if (store.state.activeChannel) {
		const channel = store.state.activeChannel.channel;

		if (to.name !== "RoutedChat") {
			store.commit("activeChannel", undefined);
		}

		// When switching out of a channel, mark everything as read
		if (channel.messages?.length > 0) {
			channel.firstUnread = channel.messages[channel.messages.length - 1].id;
		}

		if (channel.messages?.length > 100) {
			channel.messages.splice(0, channel.messages.length - 100);
			channel.moreHistoryAvailable = true;
		}
	}
});

async function navigate(routeName: string, params: any = {}) {
	if (router.currentRoute.value.name) {
		await router.push({name: routeName, params});
	} else {
		// If current route is null, replace the history entry
		// This prevents invalid entries from lingering in history,
		// and then the route guard preventing proper navigation
		await router.replace({name: routeName, params}).catch(() => {});
	}
}

function switchToChannel(channel: ClientChan) {
	void navigate("RoutedChat", {id: channel.id});
}

if ("serviceWorker" in navigator) {
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data && event.data.type === "open") {
			const id = parseInt(event.data.channel.substring(5), 10); // remove "chan-" prefix

			const channelTarget = store.getters.findChannel(id);

			if (channelTarget) {
				switchToChannel(channelTarget.channel);
			}
		}
	});
}

export {router, navigate, switchToChannel};

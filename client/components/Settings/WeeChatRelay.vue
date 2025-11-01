<template>
	<div>
		<div id="weechat-relay" role="group" aria-labelledby="label-weechat-relay">
			<h2 id="label-weechat-relay">WeeChat Relay Settings</h2>
			<p class="help">
				Configure WeeChat Relay server to allow clients like Lith to connect. Each user
				has their own relay server on a unique port. You can use Lith and the web
				interface at the same time!
			</p>

			<div v-if="status" class="feedback" :class="status.type">
				{{ status.message }}
			</div>

			<div class="input-group">
				<label class="opt">
					<input v-model="config.enabled" type="checkbox" name="weechat_enabled" />
					Enable WeeChat Relay
					<span class="help">Allow Lith clients to connect</span>
				</label>
			</div>

			<template v-if="config.enabled">
				<div class="input-group">
					<label for="weechat-port">Port</label>
					<p class="help">
						Choose a unique port for your WeeChat Relay server. Make sure it's not
						used by other services.
					</p>
					<input
						id="weechat-port"
						v-model.number="config.port"
						type="number"
						name="weechat_port"
						class="input"
						placeholder="9001"
						min="1024"
						max="65535"
						required
					/>
				</div>

				<div class="input-group">
					<label for="weechat-password">Password</label>
					<p class="help">
						Set a password for Lith to connect. This is separate from your login
						password.
					</p>
					<RevealPassword v-slot:default="slotProps">
						<input
							id="weechat-password"
							v-model="config.password"
							:type="slotProps.isVisible ? 'text' : 'password'"
							name="weechat_password"
							autocomplete="off"
							class="input"
							placeholder="Enter WeeChat Relay password"
							:required="config.enabled"
						/>
					</RevealPassword>
				</div>

				<div class="input-group">
					<label class="opt">
						<input
							v-model="config.compression"
							type="checkbox"
							name="weechat_compression"
						/>
						Enable compression (zlib)
						<span class="help">Recommended for better performance</span>
					</label>
				</div>
			</template>

			<div class="btn-group">
				<button
					type="button"
					class="btn btn-success"
					:disabled="!canSave"
					@click="saveSettings"
				>
					Save Settings
				</button>
			</div>

			<div v-if="currentConfig" class="current-connection">
				<h3>Current Configuration</h3>
				<div class="connection-info">
					<p>
						<strong>Status:</strong>
						<span :class="currentConfig.enabled ? 'connected' : 'disconnected'">
							{{ currentConfig.enabled ? "Enabled" : "Disabled" }}
						</span>
					</p>
					<p v-if="currentConfig.enabled">
						<strong>Port:</strong> {{ currentConfig.port }}
					</p>
					<p v-if="currentConfig.enabled">
						<strong>Compression:</strong>
						{{ currentConfig.compression ? "Enabled" : "Disabled" }}
					</p>
					<p v-if="currentConfig.enabled" class="help">
						<strong>Connect with Lith:</strong><br />
						Host: {{ serverAddress }}<br />
						Port: {{ currentConfig.port }}<br />
						Path: /weechat<br />
						Use WebSocket: Yes<br />
						Password: (the password you set above)
					</p>
				</div>
			</div>
		</div>
	</div>
</template>

<style scoped>
.feedback {
	padding: 10px;
	margin-bottom: 20px;
	border-radius: 4px;
	font-weight: bold;
}

.feedback.success {
	background-color: #d4edda;
	color: #155724;
	border: 1px solid #c3e6cb;
}

.feedback.error {
	background-color: #f8d7da;
	color: #721c24;
	border: 1px solid #f5c6cb;
}

.feedback.info {
	background-color: #d1ecf1;
	color: #0c5460;
	border: 1px solid #bee5eb;
}

.current-connection {
	margin-top: 40px;
	padding-top: 20px;
	border-top: 1px solid var(--body-bg-color);
}

.connection-info p {
	margin: 10px 0;
}

.connected {
	color: #28a745;
	font-weight: bold;
}

.disconnected {
	color: #dc3545;
	font-weight: bold;
}
</style>

<script lang="ts">
import {defineComponent, ref, computed, onMounted} from "vue";
import socket from "../../js/socket";
import RevealPassword from "../RevealPassword.vue";

interface WeeChatRelayConfig {
	enabled: boolean;
	port: number;
	password: string;
	compression: boolean;
}

interface Status {
	type: "success" | "error" | "info";
	message: string;
}

export default defineComponent({
	name: "WeeChatRelay",
	components: {
		RevealPassword,
	},
	setup() {
		const config = ref<WeeChatRelayConfig>({
			enabled: false,
			port: 9001,
			password: "",
			compression: true,
		});

		const status = ref<Status | null>(null);
		const currentConfig = ref<WeeChatRelayConfig | null>(null);

		const canSave = computed(() => {
			if (!config.value.enabled) {
				return true; // Can save to disable
			}
			// If enabled, require port and password
			return (
				config.value.port >= 1024 &&
				config.value.port <= 65535 &&
				config.value.password.length > 0
			);
		});

		const serverAddress = computed(() => {
			if (typeof window !== "undefined") {
				return window.location.hostname || "your-server-address";
			}
			return "your-server-address";
		});

		const saveSettings = () => {
			console.log("[WeeChatRelay] saveSettings called", {
				canSave: canSave.value,
				config: config.value,
			});

			if (!canSave.value) {
				status.value = {
					type: "error",
					message: "Please fill in all required fields",
				};
				return;
			}

			status.value = {
				type: "info",
				message: "Saving WeeChat Relay settings...",
			};

			const payload = {
				enabled: config.value.enabled,
				port: config.value.port,
				password: config.value.password,
				compression: config.value.compression,
			};

			console.log("[WeeChatRelay] Emitting weechat:config:save", payload);
			socket.emit("weechat:config:save", payload);
		};

		const loadCurrentConfig = () => {
			console.log("[WeeChatRelay] Loading current config, socket connected:", socket.connected);
			socket.emit("weechat:config:get");
		};

		onMounted(() => {
			console.log("[WeeChatRelay] Component mounted, loading config");
			// Load existing config
			loadCurrentConfig();

			// Listen for config info
			socket.on("weechat:config:info", (data: WeeChatRelayConfig) => {
				console.log("[WeeChatRelay] Received config info", data);
				currentConfig.value = data;
				// Pre-fill form with current config (except password)
				config.value.enabled = data.enabled;
				config.value.port = data.port;
				config.value.compression = data.compression;
				// Don't pre-fill password for security
			});

			// Listen for save success
			socket.on("weechat:config:success", (data: {message: string}) => {
				console.log("[WeeChatRelay] Success", data);
				status.value = {
					type: "success",
					message: data.message,
				};
				// Reload current config
				loadCurrentConfig();
				// Clear password field after successful save
				config.value.password = "";
			});

			// Listen for errors
			socket.on("weechat:config:error", (data: {error: string}) => {
				console.log("[WeeChatRelay] Error", data);
				status.value = {
					type: "error",
					message: data.error,
				};
			});
		});

		return {
			config,
			status,
			currentConfig,
			canSave,
			serverAddress,
			saveSettings,
		};
	},
});
</script>


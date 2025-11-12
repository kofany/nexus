<template>
	<div>
		<div id="irssi-connection" role="group" aria-labelledby="label-irssi-connection">
			<h2 id="label-irssi-connection">irssi Connection Settings</h2>
			<p class="help">
				Configure connection to your irssi instance running fe-web module. The password
				should match the one set in irssi with <code>/SET fe_web_password</code>.
			</p>

			<div v-if="connectionStatus" class="feedback" :class="connectionStatus.type">
				{{ connectionStatus.message }}
			</div>

			<div class="input-group">
				<label for="irssi-host">Host / IP Address</label>
				<input
					id="irssi-host"
					v-model="config.host"
					type="text"
					name="irssi_host"
					class="input"
					placeholder="127.0.0.1 or irssi.example.com"
					required
				/>
			</div>

			<div class="input-group">
				<label for="irssi-port">Port</label>
				<input
					id="irssi-port"
					v-model.number="config.port"
					type="number"
					name="irssi_port"
					class="input"
					placeholder="9001"
					min="1"
					max="65535"
					required
				/>
			</div>

			<div class="input-group">
				<label for="irssi-password">Password</label>
				<p class="help">
					The password set in irssi with <code>/SET fe_web_password your_password</code>
				</p>
				<RevealPassword v-slot:default="slotProps">
					<input
						id="irssi-password"
						v-model="config.password"
						:type="slotProps.isVisible ? 'text' : 'password'"
						name="irssi_password"
						autocomplete="off"
						class="input"
						placeholder="Enter fe-web password"
						required
					/>
				</RevealPassword>
			</div>

			<div class="input-group">
				<label class="opt">
					<input v-model="config.useTLS" type="checkbox" name="irssi_use_tls" disabled />
					Use SSL/TLS (wss://)
					<span class="help">Required for fe-web v1.5</span>
				</label>
			</div>

			<div class="input-group">
				<label class="opt">
					<input
						v-model="config.rejectUnauthorized"
						type="checkbox"
						name="irssi_reject_unauthorized"
					/>
					Reject unauthorized certificates
					<span class="help"
						>Uncheck to accept self-signed certificates (common for local
						connections)</span
					>
				</label>
			</div>

			<div class="btn-group">
				<button type="button" class="btn btn-primary" @click="testConnection">
					Test Connection
				</button>
				<button type="button" class="btn btn-success" @click="saveConnection">
					Save Settings
				</button>
			</div>
		</div>

		<!-- Connection Status -->
		<div v-if="currentConnection" class="current-connection" role="group">
			<h2>Current Connection</h2>
			<div class="connection-info">
				<p>
					<strong>Host:</strong> {{ currentConnection.host }}:{{ currentConnection.port }}
				</p>
				<p>
					<strong>Status:</strong>
					<span :class="currentConnection.connected ? 'connected' : 'disconnected'">
						{{ currentConnection.connected ? "Connected" : "Disconnected" }}
					</span>
				</p>
				<p v-if="currentConnection.encryption">
					<strong>Encryption:</strong> AES-256-GCM (fe-web v1.5)
				</p>
			</div>
		</div>
	</div>
</template>

<style scoped>
.input-group {
	margin-bottom: 20px;
}

.input-group label {
	display: block;
	margin-bottom: 5px;
	font-weight: bold;
}

.input-group .help {
	font-size: 0.9em;
	color: var(--body-color-muted);
	margin: 5px 0;
}

.input-group .help code {
	background: var(--highlight-bg-color);
	padding: 2px 5px;
	border-radius: 3px;
	font-family: monospace;
}

.btn-group {
	display: flex;
	gap: 10px;
	margin-top: 20px;
}

.btn-primary {
	background-color: var(--link-color);
	color: white;
}

.btn-success {
	background-color: #28a745;
	color: white;
}

.feedback {
	padding: 10px;
	margin-bottom: 15px;
	border-radius: 5px;
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
import {defineComponent, ref, onMounted} from "vue";
import socket from "../../js/socket";
import RevealPassword from "../RevealPassword.vue";

interface IrssiConnectionConfig {
	host: string;
	port: number;
	password: string;
	useTLS: boolean;
	rejectUnauthorized: boolean;
	encryption: boolean;
	connected?: boolean;
}

interface ConnectionStatus {
	type: "success" | "error" | "info";
	message: string;
}

export default defineComponent({
	name: "IrssiConnection",
	components: {
		RevealPassword,
	},
	setup() {
		const config = ref<IrssiConnectionConfig>({
			host: "127.0.0.1",
			port: 9001,
			password: "",
			useTLS: true, // Always true for fe-web v1.5
			rejectUnauthorized: false, // Default to false for self-signed certs
			encryption: true, // Always true for fe-web v1.5
		});

		const connectionStatus = ref<ConnectionStatus | null>(null);
		const currentConnection = ref<IrssiConnectionConfig | null>(null);

		const testConnection = async () => {
			if (!config.value.host || !config.value.port || !config.value.password) {
				connectionStatus.value = {
					type: "error",
					message: "Please fill in all required fields",
				};
				return;
			}

			connectionStatus.value = {
				type: "info",
				message: "Testing connection...",
			};

			// Emit test request
			socket.emit("irssi:config:test", {
				host: config.value.host,
				port: config.value.port,
				password: config.value.password,
				rejectUnauthorized: config.value.rejectUnauthorized,
			});
		};

		const saveConnection = async () => {
			if (!config.value.host || !config.value.port || !config.value.password) {
				connectionStatus.value = {
					type: "error",
					message: "Please fill in all required fields",
				};
				return;
			}

			connectionStatus.value = {
				type: "info",
				message: "Saving connection settings...",
			};

			// Emit save request
			socket.emit("irssi:config:save", {
				host: config.value.host,
				port: config.value.port,
				password: config.value.password,
				rejectUnauthorized: config.value.rejectUnauthorized,
			});
		};

		const loadCurrentConfig = () => {
			socket.emit("irssi:config:get");
		};

		onMounted(() => {
			// Load existing config
			loadCurrentConfig();

			// Listen for config info
			socket.on("irssi:config:info", (data: IrssiConnectionConfig) => {
				currentConnection.value = data;
				// Pre-fill form with current config (except password)
				config.value.host = data.host;
				config.value.port = data.port;
				config.value.rejectUnauthorized = data.rejectUnauthorized;
			});

			// Listen for save success
			socket.on("irssi:config:success", (data: {message: string}) => {
				connectionStatus.value = {
					type: "success",
					message: data.message,
				};
				// Reload current config
				loadCurrentConfig();
			});

			// Listen for errors
			socket.on("irssi:config:error", (data: {error: string}) => {
				connectionStatus.value = {
					type: "error",
					message: data.error,
				};
			});

			// Listen for test success
			socket.on("irssi:config:test:success", (data: {message: string}) => {
				connectionStatus.value = {
					type: "success",
					message: data.message,
				};
			});

			// Listen for test error
			socket.on("irssi:config:test:error", (data: {error: string}) => {
				connectionStatus.value = {
					type: "error",
					message: data.error,
				};
			});
		});

		return {
			config,
			connectionStatus,
			currentConnection,
			testConnection,
			saveConnection,
		};
	},
});
</script>

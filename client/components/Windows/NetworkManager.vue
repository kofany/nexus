<template>
	<div id="network-manager" class="window" role="tabpanel" aria-label="Network Manager">
		<div class="header">
			<SidebarToggle />
		</div>
		<div class="container">
			<h1 class="title">IRC Network Manager</h1>

			<!-- Loading indicator -->
			<div v-if="isLoading" class="loading-message">
				<p>Loading...</p>
			</div>

			<!-- Success message -->
			<div v-if="successMessage" class="success-message">
				<p>{{ successMessage }}</p>
			</div>

			<!-- Error message -->
			<div v-if="errorMessage" class="error-message">
				<p>{{ errorMessage }}</p>
			</div>

			<!-- Saved Networks Section -->
			<section v-if="savedNetworks.length > 0" class="saved-networks">
				<h2>Saved Networks ({{ savedNetworks.length }})</h2>
				<div class="networks-list">
					<div
						v-for="(network, index) in savedNetworks"
						:key="index"
						class="network-item"
					>
						<div class="network-header">
							<div class="network-info">
								<h3>{{ network.name }}</h3>
								<p v-if="network.nick">Nick: {{ network.nick }}</p>
								<p v-if="network.saslMechanism">
									SASL: {{ network.saslMechanism }}
									<span v-if="network.saslUsername"
										>({{ network.saslUsername }})</span
									>
								</p>
							</div>
							<div class="network-actions">
								<button
									type="button"
									class="btn btn-edit"
									:disabled="isLoading"
									@click="editNetwork(network)"
								>
									Edit
								</button>
								<button
									type="button"
									class="btn btn-remove"
									:disabled="isLoading"
									@click="removeNetwork(network.name)"
								>
									Remove
								</button>
							</div>
						</div>

						<!-- Servers Table -->
						<div
							v-if="network.servers && network.servers.length > 0"
							class="servers-table"
						>
							<h4>Servers ({{ network.servers.length }})</h4>
							<table>
								<thead>
									<tr>
										<th>Address</th>
										<th>Port</th>
										<th>TLS</th>
										<th>Auto-connect</th>
										<th>Actions</th>
									</tr>
								</thead>
								<tbody>
									<tr
										v-for="(server, serverIndex) in network.servers"
										:key="serverIndex"
									>
										<td>{{ server.address }}</td>
										<td>{{ server.port }}</td>
										<td>{{ server.useTls || server.use_tls ? "✓" : "✗" }}</td>
										<td>{{ server.autoconnect ? "✓" : "✗" }}</td>
										<td class="server-actions">
											<button
												type="button"
												class="btn btn-small btn-connect"
												:disabled="isLoading"
												title="Connect to this server"
												@click="connectToServer(network, server)"
											>
												Connect
											</button>
											<button
												type="button"
												class="btn btn-small btn-remove"
												:disabled="isLoading"
												title="Remove this server"
												@click="removeServer(server, network.name)"
											>
												Remove
											</button>
										</td>
									</tr>
								</tbody>
							</table>
						</div>
						<div v-else class="no-servers">
							<p>No servers configured for this network.</p>
						</div>
					</div>
				</div>
			</section>

			<!-- Add/Edit Network Section -->
			<section class="add-network">
				<h2>{{ isEditing ? `Edit Network: ${editingNetworkName}` : "Add New Network" }}</h2>
				<form class="network-form" @submit.prevent="addNewNetwork">
					<!-- Basic Network Settings -->
					<fieldset>
						<legend>Basic Settings</legend>

						<div class="form-row">
							<label for="network-name">Network Name *</label>
							<input
								id="network-name"
								v-model.trim="newNetwork.name"
								class="input"
								type="text"
								placeholder="Libera.Chat"
								required
								maxlength="100"
							/>
						</div>

						<div class="form-row">
							<label for="network-nick">Nickname</label>
							<input
								id="network-nick"
								v-model.trim="newNetwork.nick"
								class="input"
								type="text"
								placeholder="myuser"
								maxlength="100"
							/>
						</div>

						<div class="form-row">
							<label for="network-alt-nick">Alternate Nick</label>
							<input
								id="network-alt-nick"
								v-model.trim="newNetwork.alternateNick"
								class="input"
								type="text"
								placeholder="myuser_"
								maxlength="100"
							/>
						</div>

						<div class="form-row">
							<label for="network-username">Username (ident)</label>
							<input
								id="network-username"
								v-model.trim="newNetwork.username"
								class="input"
								type="text"
								placeholder="myuser"
								maxlength="100"
							/>
						</div>

						<div class="form-row">
							<label for="network-realname">Real Name</label>
							<input
								id="network-realname"
								v-model.trim="newNetwork.realname"
								class="input"
								type="text"
								placeholder="My Real Name"
								maxlength="255"
							/>
						</div>
					</fieldset>

					<!-- SASL Authentication -->
					<fieldset>
						<legend>
							SASL Authentication <span class="optional">(optional)</span>
						</legend>

						<div class="form-row">
							<label for="sasl-mechanism">SASL Mechanism</label>
							<select
								id="sasl-mechanism"
								v-model="newNetwork.saslMechanism"
								class="input"
							>
								<option value="">None</option>
								<option value="PLAIN">PLAIN</option>
								<option value="EXTERNAL">EXTERNAL (client cert)</option>
								<option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
							</select>
						</div>

						<div
							v-if="
								newNetwork.saslMechanism && newNetwork.saslMechanism !== 'EXTERNAL'
							"
							class="form-row"
						>
							<label for="sasl-username">SASL Username</label>
							<input
								id="sasl-username"
								v-model.trim="newNetwork.saslUsername"
								class="input"
								type="text"
								placeholder="myaccount"
								maxlength="100"
							/>
						</div>

						<div
							v-if="
								newNetwork.saslMechanism && newNetwork.saslMechanism !== 'EXTERNAL'
							"
							class="form-row"
						>
							<label for="sasl-password">SASL Password</label>
							<input
								id="sasl-password"
								v-model="newNetwork.saslPassword"
								class="input"
								type="password"
								placeholder="secret"
								maxlength="255"
							/>
						</div>
					</fieldset>

					<!-- Advanced Network Settings -->
					<fieldset>
						<legend>
							Advanced Network Settings <span class="optional">(optional)</span>
						</legend>

						<div class="form-row">
							<label for="network-usermode">User Mode</label>
							<input
								id="network-usermode"
								v-model.trim="newNetwork.usermode"
								class="input"
								type="text"
								placeholder="+iw"
								maxlength="50"
							/>
							<span class="help-inline">e.g., +iw for invisible and wallops</span>
						</div>

						<div class="form-row">
							<label for="network-autosendcmd">Commands After Connect</label>
							<textarea
								id="network-autosendcmd"
								v-model.trim="newNetwork.autosendcmd"
								class="input"
								rows="3"
								placeholder="/msg NickServ identify password"
								maxlength="500"
							/>
							<span class="help-inline"
								>Commands to run after connecting (one per line or separated by
								;)</span
							>
						</div>

						<div class="form-row">
							<label for="network-ownhost">Bind to Address</label>
							<input
								id="network-ownhost"
								v-model.trim="newNetwork.ownHost"
								class="input"
								type="text"
								placeholder="192.168.1.100 or example.com"
								maxlength="255"
							/>
							<span class="help-inline">Bind to specific local IP/hostname</span>
						</div>
					</fieldset>

					<!-- Servers -->
					<fieldset>
						<legend>
							Servers <span class="required">(at least one required)</span>
						</legend>

						<div
							v-for="(server, index) in newNetwork.servers"
							:key="index"
							class="server-row"
						>
							<div class="server-fields">
								<!-- Basic Server Settings -->
								<div class="form-row server-address-row">
									<label :for="`server-address-${index}`">Server Address *</label>
									<div class="input-wrap">
										<input
											:id="`server-address-${index}`"
											v-model.trim="server.address"
											class="input"
											type="text"
											placeholder="irc.libera.chat"
											required
											maxlength="255"
										/>
										<span class="port-separator">:</span>
										<input
											:id="`server-port-${index}`"
											v-model.number="server.port"
											class="input port-input"
											type="number"
											min="1"
											max="65535"
											placeholder="6697"
											required
										/>
									</div>
								</div>

								<div class="form-row server-options-row">
									<label></label>
									<div class="input-wrap">
										<label class="checkbox-label">
											<input v-model="server.useTLS" type="checkbox" />
											Use TLS
										</label>
										<label class="checkbox-label">
											<input
												v-model="server.tlsVerify"
												type="checkbox"
												:disabled="!server.useTLS"
											/>
											Verify TLS Certificate
										</label>
										<label class="checkbox-label">
											<input v-model="server.autoConnect" type="checkbox" />
											Auto-connect
										</label>
									</div>
								</div>

								<!-- Server Password -->
								<div class="form-row">
									<label :for="`server-password-${index}`">Server Password</label>
									<input
										:id="`server-password-${index}`"
										v-model="server.password"
										class="input"
										type="password"
										placeholder="(optional)"
										maxlength="255"
									/>
								</div>

								<!-- TLS Client Certificates -->
								<details class="advanced-section">
									<summary>TLS Client Certificates (for SASL EXTERNAL)</summary>

									<div class="form-row">
										<label :for="`server-tls-cert-${index}`"
											>Client Certificate Path</label
										>
										<input
											:id="`server-tls-cert-${index}`"
											v-model.trim="server.tlsCert"
											class="input"
											type="text"
											placeholder="/path/to/client.crt"
											maxlength="500"
										/>
									</div>

									<div class="form-row">
										<label :for="`server-tls-pkey-${index}`"
											>Client Private Key Path</label
										>
										<input
											:id="`server-tls-pkey-${index}`"
											v-model.trim="server.tlsPkey"
											class="input"
											type="text"
											placeholder="/path/to/client.key"
											maxlength="500"
										/>
									</div>

									<div class="form-row">
										<label :for="`server-tls-pass-${index}`"
											>Private Key Password</label
										>
										<input
											:id="`server-tls-pass-${index}`"
											v-model="server.tlsPass"
											class="input"
											type="password"
											placeholder="(if key is encrypted)"
											maxlength="255"
										/>
									</div>

									<div class="form-row">
										<label :for="`server-tls-cafile-${index}`"
											>CA Certificate File</label
										>
										<input
											:id="`server-tls-cafile-${index}`"
											v-model.trim="server.tlsCafile"
											class="input"
											type="text"
											placeholder="/etc/ssl/certs/ca-certificates.crt"
											maxlength="500"
										/>
									</div>

									<div class="form-row">
										<label :for="`server-tls-capath-${index}`"
											>CA Certificate Directory</label
										>
										<input
											:id="`server-tls-capath-${index}`"
											v-model.trim="server.tlsCapath"
											class="input"
											type="text"
											placeholder="/etc/ssl/certs"
											maxlength="500"
										/>
									</div>
								</details>

								<!-- Advanced Server Settings -->
								<details class="advanced-section">
									<summary>Advanced Server Settings</summary>

									<div class="form-row">
										<label :for="`server-ownhost-${index}`"
											>Bind to Address</label
										>
										<input
											:id="`server-ownhost-${index}`"
											v-model.trim="server.ownHost"
											class="input"
											type="text"
											placeholder="192.168.1.100"
											maxlength="255"
										/>
									</div>

									<div class="form-row">
										<label :for="`server-family-${index}`">IP Protocol</label>
										<select
											:id="`server-family-${index}`"
											v-model.number="server.family"
											class="input"
										>
											<option :value="0">Auto (IPv4/IPv6)</option>
											<option :value="2">IPv4 only</option>
											<option :value="10">IPv6 only</option>
										</select>
									</div>

									<div class="form-row">
										<label></label>
										<div class="input-wrap">
											<label class="checkbox-label">
												<input v-model="server.noCap" type="checkbox" />
												Disable CAP negotiation
											</label>
											<label class="checkbox-label">
												<input v-model="server.noProxy" type="checkbox" />
												Don't use proxy
											</label>
										</div>
									</div>
								</details>
							</div>
							<button
								v-if="newNetwork.servers.length > 1"
								type="button"
								class="btn btn-small btn-remove-server"
								title="Remove this server"
								@click="removeServerFromForm(index)"
							>
								×
							</button>
						</div>

						<button
							type="button"
							class="btn btn-small btn-add-server"
							@click="addServer"
						>
							+ Add Server
						</button>
					</fieldset>

					<div class="form-actions">
						<button type="submit" class="btn" :disabled="actionInProgress">
							{{ isEditing ? "Update Network" : "Add Network" }}
						</button>
						<button
							type="button"
							class="btn btn-secondary"
							:disabled="actionInProgress"
							@click="resetForm"
						>
							{{ isEditing ? "Cancel" : "Clear" }}
						</button>
					</div>
				</form>
			</section>
		</div>
	</div>
</template>

<style scoped>
#network-manager .container {
	padding: 15px;
	max-width: 95%;
	margin: 0 auto;
	width: 100%;
}

#network-manager .title {
	margin-bottom: 10px;
}

.info-text {
	padding: 15px;
	background: var(--highlight-bg-color);
	border-left: 4px solid var(--link-color);
	margin-bottom: 30px;
	border-radius: 3px;
}

.loading-message {
	padding: 15px;
	background: var(--highlight-bg-color);
	border-left: 4px solid var(--link-color);
	margin-bottom: 20px;
	border-radius: 3px;
	text-align: center;
}

.success-message {
	padding: 15px;
	background: #d4edda;
	color: #155724;
	border-left: 4px solid #28a745;
	margin-bottom: 20px;
	border-radius: 3px;
}

.error-message {
	padding: 15px;
	background: #f8d7da;
	color: #721c24;
	border-left: 4px solid #dc3545;
	margin-bottom: 20px;
	border-radius: 3px;
}

.saved-networks {
	margin-bottom: 40px;
}

.networks-list {
	display: flex;
	flex-direction: column;
	gap: 20px;
	margin-top: 15px;
}

.network-item {
	background: var(--window-bg-color);
	border: 1px solid var(--body-bg-color);
	border-radius: 8px;
	padding: 20px;
	transition: box-shadow 0.2s;
	width: 100%;
}

.network-item:hover {
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.network-info h3 {
	margin: 0 0 10px 0;
	color: var(--link-color);
	font-size: 1.2em;
}

.network-info p {
	margin: 5px 0;
	font-size: 0.9em;
	color: var(--body-color-muted);
}

.network-actions {
	display: flex;
	gap: 10px;
	margin-top: 15px;
	flex-wrap: wrap;
}

.network-actions .btn {
	flex: 1;
	min-width: 80px;
	padding: 8px 12px;
	font-size: 0.9em;
}

.btn-connect {
	background: #28a745;
	color: white;
	border: none;
}

.btn-connect:hover:not(:disabled) {
	background: #218838;
}

.btn-edit {
	background: #007bff;
	color: white;
	border: none;
}

.btn-edit:hover:not(:disabled) {
	background: #0056b3;
}

.btn-remove {
	background: #dc3545;
	color: white;
	border: none;
}

.btn-remove:hover:not(:disabled) {
	background: #c82333;
}

.btn:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}

section {
	margin-bottom: 40px;
}

section h2 {
	margin-bottom: 15px;
	padding-bottom: 10px;
	border-bottom: 1px solid var(--body-bg-color);
}

.network-form {
	background: var(--window-bg-color);
	padding: 25px;
	border-radius: 5px;
	width: 100%;
}

fieldset {
	border: 1px solid var(--body-bg-color);
	border-radius: 5px;
	padding: 25px;
	margin-bottom: 20px;
	width: 100%;
	box-sizing: border-box;
}

fieldset legend {
	font-weight: bold;
	padding: 0 10px;
	font-size: 1.1em;
}

.optional,
.required {
	font-weight: normal;
	font-size: 0.9em;
	color: var(--body-color-muted);
}

.required {
	color: #d9534f;
}

.form-row {
	display: flex;
	margin-bottom: 15px;
	align-items: flex-start;
}

.form-row label {
	flex: 0 0 200px;
	padding-top: 8px;
	font-weight: bold;
}

.form-row .input,
.form-row .input-wrap,
.form-row select,
.form-row textarea {
	flex: 1;
	min-width: 300px;
	font-size: 14px;
	padding: 8px 12px;
}

.form-row textarea {
	resize: vertical;
	min-height: 80px;
	padding: 10px 12px;
}

.help-inline {
	display: block;
	font-size: 0.85em;
	color: var(--body-color-muted);
	margin-top: 5px;
	margin-left: 200px;
}

.input-wrap {
	display: flex;
	align-items: center;
	gap: 5px;
	flex-wrap: wrap;
}

.port-separator {
	padding: 0 5px;
}

.port-input {
	width: 80px;
}

.checkbox-label {
	display: inline-block;
	margin-right: 15px;
	font-weight: normal;
	white-space: nowrap;
}

.checkbox-label input {
	margin-right: 5px;
}

.server-row {
	display: flex;
	align-items: flex-start;
	margin-bottom: 15px;
	padding: 15px;
	background: var(--body-bg-color);
	border-radius: 5px;
}

.server-fields {
	flex: 1;
}

.server-address-row {
	margin-bottom: 10px;
}

.server-options-row {
	margin-bottom: 10px;
}

.btn-remove-server {
	margin-left: 10px;
	padding: 4px 10px;
	font-size: 1.2em;
	background: #d9534f;
	color: white;
	border: none;
	border-radius: 3px;
	cursor: pointer;
}

.btn-remove-server:hover {
	background: #c9302c;
}

.btn-add-server {
	margin-bottom: 20px;
}

.advanced-section {
	margin: 15px 0;
	padding: 10px;
	background: var(--window-bg-color);
	border: 1px solid var(--body-bg-color);
	border-radius: 3px;
}

.advanced-section summary {
	cursor: pointer;
	font-weight: bold;
	padding: 5px;
	user-select: none;
}

.advanced-section summary:hover {
	color: var(--link-color);
}

.advanced-section[open] {
	padding-bottom: 15px;
}

.advanced-section .form-row {
	margin-top: 10px;
}

.form-actions {
	display: flex;
	gap: 10px;
	margin-top: 20px;
	padding-top: 20px;
	border-top: 1px solid var(--body-bg-color);
}

.btn-secondary {
	background: var(--body-bg-color);
	color: var(--body-color);
}

.btn-secondary:hover:not(:disabled) {
	background: var(--highlight-bg-color);
}

/* Servers table styles (override for better layout) */
.servers-table {
	margin-top: 1rem;
	width: 100%;
	overflow-x: auto;
}

.servers-table h4 {
	margin: 0 0 0.75rem 0;
	font-size: 1rem;
	color: var(--body-color);
	font-weight: 600;
}

.servers-table table {
	width: 100%;
	min-width: 600px;
	border-collapse: collapse;
	background: var(--body-bg-color);
	border-radius: 4px;
	overflow: hidden;
	font-size: 0.9rem;
	table-layout: auto;
}

.servers-table thead {
	background: var(--highlight-bg-color);
}

.servers-table th {
	padding: 0.75rem 1rem;
	text-align: left;
	font-weight: 600;
	font-size: 0.9rem;
	color: var(--body-color);
	border-bottom: 2px solid var(--body-bg-color);
	white-space: nowrap;
}

.servers-table td {
	padding: 0.75rem 1rem;
	border-bottom: 1px solid var(--window-bg-color);
	font-size: 0.9rem;
}

.servers-table tbody tr:hover {
	background: var(--window-bg-color);
}

.server-actions {
	display: flex;
	gap: 0.5rem;
	white-space: nowrap;
}

.btn-small {
	padding: 0.4rem 0.9rem;
	font-size: 0.85rem;
	white-space: nowrap;
	min-width: 70px;
}

.no-servers {
	padding: 1.5rem;
	text-align: center;
	color: var(--body-color-muted);
	font-style: italic;
	background: var(--body-bg-color);
	border-radius: 4px;
	font-size: 0.9rem;
}

.network-header {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	margin-bottom: 1.5rem;
	padding-bottom: 1rem;
	border-bottom: 2px solid var(--body-bg-color);
	flex-wrap: wrap;
	gap: 1rem;
}

.network-info {
	flex: 1;
	min-width: 250px;
}

.network-info h3 {
	margin: 0 0 0.75rem 0;
	font-size: 1.3rem;
	color: var(--link-color);
	font-weight: bold;
}

.network-info p {
	margin: 0.5rem 0;
	font-size: 0.95rem;
	color: var(--body-color-muted);
}

.network-actions {
	display: flex;
	gap: 0.75rem;
	flex-wrap: wrap;
	align-items: flex-start;
}

.network-actions .btn {
	min-width: 90px;
	padding: 0.6rem 1.2rem;
	font-size: 0.95rem;
}
</style>

<script lang="ts">
import {defineComponent, ref, onMounted} from "vue";
import socket from "../../js/socket";
import SidebarToggle from "../SidebarToggle.vue";
import eventbus from "../../js/eventbus";

interface IrssiServer {
	address: string;
	port: number;
	chatnet?: string;
	password?: string;
	autoConnect: boolean;
	useTLS: boolean;
	tlsVerify: boolean;
	tlsCert?: string;
	tlsPkey?: string;
	tlsPass?: string;
	tlsCafile?: string;
	tlsCapath?: string;
	tlsCiphers?: string;
	tlsPinnedCert?: string;
	tlsPinnedPubkey?: string;
	ownHost?: string;
	family: number; // 0=auto, 2=IPv4, 10=IPv6
	maxCmdsAtOnce?: number;
	cmdQueueSpeed?: number;
	maxQueryChans?: number;
	starttls?: number;
	noCap: boolean;
	noProxy: boolean;
}

interface IrssiNetwork {
	name: string;
	chatType?: string;
	nick?: string;
	alternateNick?: string;
	username?: string;
	realname?: string;
	ownHost?: string;
	autosendcmd?: string;
	usermode?: string;
	saslMechanism?: string;
	saslUsername?: string;
	saslPassword?: string;
	maxKicks?: number;
	maxMsgs?: number;
	maxModes?: number;
	maxWhois?: number;
	maxCmdsAtOnce?: number;
	cmdQueueSpeed?: number;
	maxQueryChans?: number;
	servers: IrssiServer[];
}

export default defineComponent({
	name: "NetworkManager",
	components: {
		SidebarToggle,
	},
	setup() {
		const actionInProgress = ref(false);
		const savedNetworks = ref<IrssiNetwork[]>([]);
		const isLoading = ref(false);
		const errorMessage = ref("");
		const successMessage = ref("");
		const isEditing = ref(false);
		const editingNetworkName = ref("");

		const newNetwork = ref<IrssiNetwork>({
			name: "",
			nick: "",
			alternateNick: "",
			username: "",
			realname: "",
			ownHost: "",
			autosendcmd: "",
			usermode: "",
			saslMechanism: "",
			saslUsername: "",
			saslPassword: "",
			servers: [
				{
					address: "",
					port: 6697,
					autoConnect: false,
					useTLS: true,
					tlsVerify: true,
					family: 0,
					noCap: false,
					noProxy: false,
				},
			],
		});

		const loadNetworks = () => {
			isLoading.value = true;
			errorMessage.value = "";

			// First, load all networks
			socket.emit("network:list_irssi", (result: any) => {
				if (result.success) {
					const networks = result.networks || [];

					// Then, load servers for each network
					socket.emit("server:list_irssi", {}, (serverResult: any) => {
						isLoading.value = false;

						if (serverResult.success) {
							const servers = serverResult.servers || [];

							// Attach servers to their respective networks
							networks.forEach((network: any) => {
								network.servers = servers.filter(
									(server: any) => server.chatnet === network.name
								);
							});

							savedNetworks.value = networks;
						} else {
							// Even if server list fails, show networks without servers
							savedNetworks.value = networks;
							errorMessage.value = serverResult.error || "Failed to load servers";
						}
					});
				} else {
					isLoading.value = false;
					errorMessage.value = result.error || "Failed to load networks";
				}
			});
		};

		const resetForm = () => {
			isEditing.value = false;
			editingNetworkName.value = "";
			newNetwork.value = {
				name: "",
				nick: "",
				alternateNick: "",
				username: "",
				realname: "",
				ownHost: "",
				autosendcmd: "",
				usermode: "",
				saslMechanism: "",
				saslUsername: "",
				saslPassword: "",
				servers: [
					{
						address: "",
						port: 6697,
						autoConnect: false,
						useTLS: true,
						tlsVerify: true,
						family: 0,
						noCap: false,
						noProxy: false,
					},
				],
			};
		};

		const addNewNetwork = () => {
			if (!newNetwork.value.name || newNetwork.value.servers.length === 0) {
				errorMessage.value = "Network name and at least one server are required";
				return;
			}

			if (!newNetwork.value.servers[0].address) {
				errorMessage.value = "Server address is required";
				return;
			}

			if (!isEditing.value) {
				const exists = savedNetworks.value.some(
					(net) => net.name.toLowerCase() === newNetwork.value.name.toLowerCase()
				);

				if (exists) {
					errorMessage.value = `Network '${newNetwork.value.name}' already exists. Use Edit to modify it.`;
					return;
				}
			}

			isLoading.value = true;
			errorMessage.value = "";
			successMessage.value = "";

			socket.emit("network:add_irssi", newNetwork.value, (result: any) => {
				isLoading.value = false;

				if (result.success) {
					successMessage.value = result.message;
					resetForm();
					loadNetworks();
					setTimeout(() => {
						successMessage.value = "";
					}, 5000);
				} else {
					errorMessage.value = result.message || "Failed to add network";
				}
			});
		};

		const editNetwork = (network: IrssiNetwork) => {
			isEditing.value = true;
			editingNetworkName.value = network.name;
			newNetwork.value = JSON.parse(JSON.stringify(network));
			window.scrollTo({top: document.body.scrollHeight, behavior: "smooth"});
		};

		const removeNetwork = (networkName: string) => {
			eventbus.emit(
				"confirm-dialog",
				{
					title: "Remove Network",
					text: `Are you sure you want to remove network '${networkName}'?`,
					button: "Remove",
				},
				(result: boolean) => {
					if (!result) {
						return;
					}

					isLoading.value = true;
					errorMessage.value = "";
					successMessage.value = "";

					socket.emit("network:remove_irssi", {name: networkName}, (response: any) => {
						isLoading.value = false;

						if (response.success) {
							successMessage.value = response.message;
							loadNetworks();
							setTimeout(() => {
								successMessage.value = "";
							}, 5000);
						} else {
							errorMessage.value = response.message || "Failed to remove network";
						}
					});
				}
			);
		};

		const connectToServer = (network: IrssiNetwork, server: any) => {
			// Build CONNECT command with network name
			// Syntax: CONNECT [-4] [-network <network>] <address> [<port>]
			const connectCommand = `CONNECT -4 -network ${network.name} ${server.address} ${server.port}`;

			socket.emit(
				"irssi:command",
				{
					command: connectCommand,
				},
				(response: any) => {
					if (response && !response.success) {
						errorMessage.value = `Failed to connect: ${response.message}`;
					} else {
						successMessage.value = `Connecting to ${server.address}:${server.port} (${network.name})...`;
						setTimeout(() => {
							successMessage.value = "";
						}, 3000);
					}
				}
			);
		};

		const removeServer = (server: any, chatnet: string) => {
			eventbus.emit(
				"confirm-dialog",
				{
					title: "Remove Server",
					text: `Are you sure you want to remove server ${server.address}:${server.port} from ${chatnet}?`,
					button: "Remove",
				},
				(result: boolean) => {
					if (!result) {
						return;
					}

					isLoading.value = true;
					errorMessage.value = "";
					successMessage.value = "";

					socket.emit(
						"server:remove_irssi",
						{
							address: server.address,
							port: server.port,
							chatnet: chatnet,
						},
						(response: any) => {
							isLoading.value = false;

							if (response.success) {
								successMessage.value = response.message;
								loadNetworks();
								setTimeout(() => {
									successMessage.value = "";
								}, 5000);
							} else {
								errorMessage.value = response.message || "Failed to remove server";
							}
						}
					);
				}
			);
		};

		const addServer = () => {
			newNetwork.value.servers.push({
				address: "",
				port: 6697,
				autoConnect: false,
				useTLS: true,
				tlsVerify: true,
				family: 0,
				noCap: false,
				noProxy: false,
			});
		};

		const removeServerFromForm = (index: number) => {
			newNetwork.value.servers.splice(index, 1);
		};

		onMounted(() => {
			loadNetworks();
		});

		return {
			actionInProgress,
			savedNetworks,
			isLoading,
			errorMessage,
			successMessage,
			isEditing,
			editingNetworkName,
			newNetwork,
			loadNetworks,
			addNewNetwork,
			editNetwork,
			removeNetwork,
			connectToServer,
			removeServer,
			addServer,
			removeServerFromForm,
			resetForm,
		};
	},
});
</script>

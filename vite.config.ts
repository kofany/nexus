import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import {viteStaticCopy} from "vite-plugin-static-copy";
import path from "path";
import {fileURLToPath} from "url";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read package.json for version
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));
const isProduction = process.env.NODE_ENV === "production";

export default defineConfig({
	plugins: [
		vue({
			template: {
				compilerOptions: {
					// Match webpack vue-loader config
					whitespace: "condense",
				},
			},
		}),
		nodePolyfills({
			// Include polyfills for node built-ins
			include: ["buffer", "process", "util", "stream"],
		}),
		viteStaticCopy({
			targets: [
				// Copy FontAwesome fonts
				{
					src: path.resolve(
						__dirname,
						"node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff2"
					),
					dest: "fonts",
				},
				// Copy loading error handlers
				{
					src: path.resolve(__dirname, "client/js/loading-error-handlers.js"),
					dest: "js",
				},
				// Copy service worker with transformation
				{
					src: path.resolve(__dirname, "client/service-worker.js"),
					dest: ".",
					transform(content) {
						const version = `v${pkg.version}`;
						const hash = crypto.createHash("sha256").update(version).digest("hex");
						const cacheBust = hash.substring(0, 10);
						return content
							.toString()
							.replace("__HASH__", isProduction ? cacheBust : "dev");
					},
				},
				// Copy audio files
				{
					src: path.resolve(__dirname, "client/audio") + "/*",
					dest: "audio",
				},
				// Copy images
				{
					src: path.resolve(__dirname, "client/img") + "/*",
					dest: "img",
				},
				// Copy themes
				{
					src: path.resolve(__dirname, "client/themes") + "/*",
					dest: "themes",
				},
				// Copy other root-level client files
				{
					src: path.resolve(__dirname, "client") + "/*.{ico,webmanifest,png}",
					dest: ".",
				},
			],
		}),
	],

	root: "client",

	resolve: {
		extensions: [".ts", ".js", ".vue"],
		alias: {
			"@": path.resolve(__dirname, "./client"),
			"~": path.resolve(__dirname, "./shared"),
		},
	},

	define: {
		// Match webpack DefinePlugin
		__VUE_PROD_DEVTOOLS__: false,
		__VUE_OPTIONS_API__: false,
	},

	build: {
		outDir: path.resolve(__dirname, "public"),
		emptyOutDir: true,
		sourcemap: true,

		rollupOptions: {
			input: {
				main: path.resolve(__dirname, "client/index.html"),
			},
			output: {
				entryFileNames: "js/bundle.js",
				chunkFileNames: "js/[name].js",
				assetFileNames: (assetInfo) => {
					if (assetInfo.name?.endsWith(".css")) {
						return "css/[name][extname]";
					}
					return "[name][extname]";
				},
			},
			// External json3 library (matching webpack config)
			external: ["json3"],
		},
	},

	server: {
		port: 9001,
		strictPort: true,
		proxy: {
			// Proxy Socket.IO to backend
			"/socket.io": {
				target: "http://localhost:9000",
				ws: true,
				changeOrigin: true,
			},
			// Proxy API calls
			"/uploads": {
				target: "http://localhost:9000",
				changeOrigin: true,
			},
			"/storage": {
				target: "http://localhost:9000",
				changeOrigin: true,
			},
			"/themes": {
				target: "http://localhost:9000",
				changeOrigin: true,
			},
		},
	},

	optimizeDeps: {
		include: [
			"vue",
			"vue-router",
			"vuex",
			"socket.io-client",
			"dayjs",
			"mousetrap",
			"sortablejs",
		],
	},
});

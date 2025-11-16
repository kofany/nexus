import {defineConfig} from "vite";
import vue from "@vitejs/plugin-vue";
import {nodePolyfills} from "vite-plugin-node-polyfills";
import path from "path";
import {fileURLToPath} from "url";
import {dirname} from "path";
import * as crypto from "crypto";
import fs from "fs";
import glob from "glob";
import pkg from "./package.json" with {type: "json"};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isProduction = process.env.NODE_ENV === "production";

function copyStaticFiles() {
    // Copy static files to public directory during build
    const copyDir = (src: string, dest: string) => {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, {recursive: true});
        }
        const entries = fs.readdirSync(src, {withFileTypes: true});
        for (const entry of entries) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    };

    // Copy static assets
    const clientRoot = path.resolve(__dirname, "client");
    const publicDir = path.resolve(__dirname, "public");

    if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, {recursive: true});
    }

    // Copy audio files
    if (fs.existsSync(path.join(clientRoot, "audio"))) {
        copyDir(path.join(clientRoot, "audio"), path.join(publicDir, "audio"));
    }

    // Copy image files
    if (fs.existsSync(path.join(clientRoot, "img"))) {
        copyDir(path.join(clientRoot, "img"), path.join(publicDir, "img"));
    }

    // Copy theme files
    if (fs.existsSync(path.join(clientRoot, "themes"))) {
        copyDir(path.join(clientRoot, "themes"), path.join(publicDir, "themes"));
    }

    // Copy root files (favicon, webmanifest, robots.txt)
    const rootFiles = ["favicon.ico", "nexusirc.webmanifest", "robots.txt"];
    for (const file of rootFiles) {
        const srcFile = path.join(clientRoot, file);
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, path.join(publicDir, file));
        }
    }

    // Copy loading-error-handlers.js
    const loadingHandlers = path.join(clientRoot, "js", "loading-error-handlers.js");
    if (fs.existsSync(loadingHandlers)) {
        const jsDir = path.join(publicDir, "js");
        if (!fs.existsSync(jsDir)) {
            fs.mkdirSync(jsDir, {recursive: true});
        }
        fs.copyFileSync(loadingHandlers, path.join(jsDir, "loading-error-handlers.js"));
    }

    // Copy and process service-worker.js
    const swSource = path.join(clientRoot, "service-worker.js");
    if (fs.existsSync(swSource)) {
        let content = fs.readFileSync(swSource, "utf-8");
        const version = `v${pkg.version}`;
        const hash = crypto.createHash("sha256").update(version).digest("hex");
        const cacheBust = hash.substring(0, 10);
        content = content.replace("__HASH__", isProduction ? cacheBust : "dev");
        fs.writeFileSync(path.join(publicDir, "service-worker.js"), content);
    }

    // Copy fontawesome fonts
    const fontDir = path.join(publicDir, "fonts");
    if (!fs.existsSync(fontDir)) {
        fs.mkdirSync(fontDir, {recursive: true});
    }
    const faFontPattern = path.join(
        __dirname,
        "node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff*"
    );
    // Use glob to find font files synchronously
    try {
        const fonts = glob.sync(faFontPattern);
        for (const font of fonts) {
            const basename = path.basename(font);
            fs.copyFileSync(font, path.join(fontDir, basename));
        }
    } catch {
        // Ignore if fonts not found
    }
}

export default defineConfig({
    plugins: [
        vue({
            template: {
                compilerOptions: {
                    whitespace: "condense",
                },
            },
        }),
        nodePolyfills({
            // Include polyfills for node built-ins
            include: ["buffer", "process", "util", "stream"],
            globals: {
                Buffer: true,
                global: true,
                process: true,
            },
        }),
        {
            name: "copy-static-files",
            buildEnd() {
                copyStaticFiles();
            },
            closeBundle() {
                // Final copy after bundle is written
                copyStaticFiles();
            },
        },
    ],

    root: "client",

    define: {
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_OPTIONS_API__: false,
    },

    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./client"),
            "~": path.resolve(__dirname, "./shared"),
        },
        extensions: [".ts", ".js", ".vue", ".json"],
    },

    build: {
        outDir: path.resolve(__dirname, "public"),
        emptyOutDir: true,
        sourcemap: true,
        manifest: true,

        rollupOptions: {
            input: path.resolve(__dirname, "client/js/vue.ts"),
            output: {
                entryFileNames: "js/bundle.js",
                chunkFileNames: "js/bundle.vendor.js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name?.endsWith(".css")) {
                        return "css/style.css";
                    }
                    if (assetInfo.name?.match(/\.(woff|woff2|ttf|eot)$/)) {
                        return "fonts/[name][extname]";
                    }
                    return "assets/[name][extname]";
                },
                manualChunks: (id) => {
                    if (id.includes("node_modules")) {
                        return "bundle.vendor";
                    }
                },
            },
        },

        // Disable CSS code splitting to get a single style.css
        cssCodeSplit: false,
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
            "/packages": {
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

    css: {
        postcss: "./postcss.config.js",
    },
});

import webpack from "webpack";
import * as path from "path";
import {fileURLToPath} from "url";
import {dirname} from "path";
import * as crypto from "crypto";
import CopyPlugin from "copy-webpack-plugin";
import ForkTsCheckerWebpackPlugin from "fork-ts-checker-webpack-plugin";
import MiniCssExtractPlugin from "mini-css-extract-plugin";
import {VueLoaderPlugin} from "vue-loader";
import babelConfig from "./babel.config.cjs";
import pkg from "./package.json" with {type: "json"};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const tsCheckerPlugin = new ForkTsCheckerWebpackPlugin({
    typescript: {
        diagnosticOptions: {
            semantic: true,
            syntactic: true,
        },
        build: true,
    },
});

const vueLoaderPlugin = new VueLoaderPlugin();

const miniCssExtractPlugin = new MiniCssExtractPlugin({
    filename: "css/style.css",
});

const isProduction = process.env.NODE_ENV === "production";
const config: webpack.Configuration = {
    mode: isProduction ? "production" : "development",
    entry: {
        "js/bundle.js": [path.resolve(__dirname, "client/js/vue.ts")],
    },
    devtool: "source-map",
    output: {
        clean: true,
        path: path.resolve(__dirname, "public"),
        filename: "[name]",
        publicPath: "/",
    },
    performance: {
        hints: false,
    },
    resolve: {
        extensions: [".ts", ".js", ".vue"],
    },
    module: {
        rules: [
            {
                test: /\.vue$/,
                use: {
                    loader: "vue-loader",
                    options: {
                        compilerOptions: {
                            preserveWhitespace: false,
                        },
                        appendTsSuffixTo: [/\.vue$/],
                },
            },
            },
            {
                test: /\.ts$/i,
                include: [path.resolve(__dirname, "client"), path.resolve(__dirname, "shared")],
                exclude: path.resolve(__dirname, "node_modules"),
                use: {
                    loader: "babel-loader",
                    options: babelConfig,
                },
            },
            {
                test: /\.css$/,
                use: [
                    {
                        loader: MiniCssExtractPlugin.loader,
                        options: {
                            esModule: false,
                        },
                    },
                    {
                        loader: "css-loader",
                        options: {
                            url: false,
                            importLoaders: 1,
                            sourceMap: true,
                        },
                    },
                    {
                        loader: "postcss-loader",
                        options: {
                            sourceMap: true,
                        },
                    },
                ],
            },
        ],
    },
    optimization: {
        splitChunks: {
            cacheGroups: {
                commons: {
                    test: /[\\/]node_modules[\\/]/,
                    name: "js/bundle.vendor.js",
                    chunks: "all",
                },
            },
        },
    },
    externals: {
        json3: "JSON",
    },
    plugins: [
        tsCheckerPlugin,
        vueLoaderPlugin,
        miniCssExtractPlugin,
        new webpack.DefinePlugin({
            __VUE_PROD_DEVTOOLS__: false,
            __VUE_OPTIONS_API__: false,
        }),
        new CopyPlugin({
            patterns: [
                {
                    from: path
                        .resolve(
                            __dirname,
                            "node_modules/@fortawesome/fontawesome-free/webfonts/fa-solid-900.woff*"
                        )
                        .replace(/\\/g, "/"),
                    to: "fonts/[name][ext]",
                },
                {
                    from: path.resolve(__dirname, "./client/js/loading-error-handlers.js"),
                    to: "js/[name][ext]",
                },
                {
                    from: path.resolve(__dirname, "./client/*").replace(/\\/g, "/"),
                    to: "[name][ext]",
                    globOptions: {
                        ignore: [
                            "**/index.html.tpl",
                            "**/service-worker.js",
                            "**/*.d.ts",
                            "**/tsconfig.json",
                        ],
                    },
                },
                {
                    from: path.resolve(__dirname, "./client/service-worker.js"),
                    to: "[name][ext]",
                    transform(content) {
                        const version = `v${pkg.version}`;
                        const hash = crypto.createHash("sha256").update(version).digest("hex");
                        const cacheBust = hash.substring(0, 10);

                        return content
                            .toString()
                            .replace("__HASH__", isProduction ? cacheBust : "dev");
                    },
                },
                {
                    from: path.resolve(__dirname, "./client/audio/*").replace(/\\/g, "/"),
                    to: "audio/[name][ext]",
                },
                {
                    from: path.resolve(__dirname, "./client/img/*").replace(/\\/g, "/"),
                    to: "img/[name][ext]",
                },
                {
                    from: path.resolve(__dirname, "./client/themes/*").replace(/\\/g, "/"),
                    to: "themes/[name][ext]",
                },
            ],
        }),
        new webpack.NormalModuleReplacementPlugin(
            /debug/,
            path.resolve(__dirname, "scripts/noop.js")
        ),
    ],
};

export default (env: any, argv: any) => {
    if (argv.mode === "development") {
        config.target = "node";
        config.devtool = "eval";
        config.stats = "errors-only";
        config.output!.path = path.resolve(__dirname, "test/public");
        config.entry!["testclient.js"] = [path.resolve(__dirname, "test/client/index.ts")];

        for (const rawRule of config.module!.rules!) {
            if (!rawRule || typeof rawRule !== "object") {
                continue;
            }

            const rule = rawRule as webpack.RuleSetRule;
            const use = rule.use;

            if (
                use &&
                !Array.isArray(use) &&
                typeof use === "object" &&
                "loader" in use &&
                (use as {loader?: string}).loader === "babel-loader"
            ) {
                const options = (use as {options?: Record<string, unknown>}).options ?? {};
                (use as {options?: Record<string, unknown>}).options = {
                    ...options,
                    plugins: ["istanbul"],
                };
            }
        }

        config.optimization!.splitChunks = false;

        config.plugins = [
            tsCheckerPlugin,
            vueLoaderPlugin,
            miniCssExtractPlugin,
            new webpack.NormalModuleReplacementPlugin(
                /js(\/|\\)socket\.js/,
                path.resolve(__dirname, "scripts/noop.js")
            ),
        ];
    }

    return config;
};

import postcssImport from "postcss-import";
import postcssPresetEnv from "postcss-preset-env";
import cssnano from "cssnano";

const isProduction = process.env.NODE_ENV === "production";

export default {
	plugins: [
		postcssImport(),
		postcssPresetEnv(),
		...(isProduction
			? [
					cssnano({
						preset: [
							"default",
							{
								mergeRules: false,
								discardComments: {
									removeAll: true,
								},
							},
						],
					}),
				]
			: []),
	],
};

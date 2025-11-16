// Vite uses import.meta.glob() instead of Webpack's require.context()
// This loads all .vue files in the current directory
// { eager: true } makes it synchronous like require.context() was
const modules = import.meta.glob<{default: any}>("./*.vue", {eager: true});

export default Object.keys(modules).reduce((acc: Record<string, any>, path) => {
	// Path format: "./ComponentName.vue"
	// Extract component name without "./" and ".vue"
	const componentName = path.substring(2, path.length - 4);
	acc["message-" + componentName] = modules[path].default;

	return acc;
}, {});

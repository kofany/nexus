// Recursively load all JS files (test files) in the `js` folder
// Vite uses import.meta.glob() instead of Webpack's require.context()
const modules = import.meta.glob<any>("./js/**/*.js", {eager: true});

// Execute each module (load the tests)
Object.values(modules).forEach((module) => {
	// The modules are already loaded due to eager: true
});

export default modules;

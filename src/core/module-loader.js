/* Runtime module loader */
const OTA = (() => {
    const registry = new Map();
    const cache = new Map();
    const define = (name, dependencies, factory) => {
        if(registry.has(name)) throw new Error(`Duplicate module: ${name}`);
        registry.set(name, { dependencies, factory });
    };
    const requireModule = name => {
        if(cache.has(name)) return cache.get(name);
        const entry = registry.get(name);
        if(!entry) throw new Error(`Unknown module: ${name}`);
        const exports = entry.factory(...entry.dependencies.map(requireModule));
        cache.set(name, exports || {});
        return cache.get(name);
    };
    return {
        define,
        require: requireModule,
        start(name) { return requireModule(name); }
    };
})();
if(typeof window !== 'undefined') window.OTA = OTA;
